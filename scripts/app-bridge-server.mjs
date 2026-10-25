/**
 * 应用桥 / MCP 服务器 / 大模型代理 (纯 Node, 无第三方依赖)
 * ------------------------------------------------------------
 * 为什么放在 Node 侧:
 *   - MCP 是"外部程序调用应用"的入口, 必须随应用启动 (npm run dev 时一起拉起)
 *   - 大模型的 API Key 只在服务端使用, 浏览器永远拿不到 (敏感数据不泄露)
 *
 * 端口 5275:
 *   GET  /api/selfcheck        应用/MCP/大模型 自检
 *   GET  /api/tools            命令清单 (规范化接口)
 *   POST /mcp                  MCP JSON-RPC (initialize / tools/list / tools/call)
 *   GET  /bridge/poll          浏览器轮询待执行命令
 *   POST /bridge/result        浏览器回传执行结果
 *   POST /api/llm/chat         大模型对话代理 (非流式: 文本/图片/思考/工具/联网)
 *   POST /api/llm/chat/stream  大模型对话代理 (SSE 流式: thinking/content/tool/sources 事件)
 *   GET  /api/llm/models       模型清单 (含视觉能力/上下文长度)
 *   GET|POST /api/search       联网搜索 (Bing RSS, 免 Key)
 *
 * 启动: node scripts/app-bridge-server.mjs [--port 5275]
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || process.env.BRIDGE_PORT || 5275)
/** 桥服务版本 + 能力清单: 供 vite 插件判断本机已有实例是否兼容 (旧实例会自动替换) */
const BRIDGE_VERSION = '2.2.0'
const BRIDGE_FEATURES = ['bridge', 'mcp', 'llm.chat', 'llm.chat.stream', 'llm.models', 'search']
/** 一次对话里最多允许几轮"模型 -> 工具 -> 模型"; 参考图还原需要 读参数/预设/精调/重建/截图 + 修正, 4 轮会被探索类调用耗尽 */
const MAX_TOOL_ROUNDS = 8

/* ---------------- 配置 (Key 只在服务端) ---------------- */
const CONFIG_PATHS = [
  path.join(ROOT, 'config', 'llm.json'),
  path.join(ROOT, '.local', 'llm.json'),
]
function loadLlmConfig() {
  for (const p of CONFIG_PATHS) {
    try {
      if (fs.existsSync(p)) return { ...JSON.parse(fs.readFileSync(p, 'utf8')), source: p }
    } catch (e) { /* ignore */ }
  }
  return {
    provider: 'deepseek',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    source: 'env',
  }
}
const llm = loadLlmConfig()

/* ---------------- 命令注册表: 直接复用浏览器侧唯一定义 ---------------- */
import { COMMANDS, toolsForMcp, toToolName, fromToolName } from '../src/core/apiRegistry.js'
export { COMMANDS }

/* ---------------- 浏览器桥 (轮询模式, 零依赖) ---------------- */
const pending = new Map()   // id -> { id, name, args, at, target }
const consumers = new Map() // consumerId -> { commands: string[], lastSeen, path, version }
/** tabId(标签页, sessionStorage 持久) -> consumerId: 同一标签页的所有轮询循环共用一个实例 id */
const tabCid = new Map()
const results = new Map() // id -> { ok, data, error }
let lastPollAt = 0
let bridgeCalls = 0
let bridgeErrors = 0
let seq = 1

/** 选一个"能力最完整且最近活跃"的浏览器实例 (多标签页时避免发到旧代码实例) */
function pickConsumer() {
  const now = Date.now()
  const alive = [...consumers.entries()].filter(([, c]) => now - c.lastSeen < 5000)
  if (!alive.length) return null
  // 前台可见的标签优先: 后台标签的 setInterval 会被节流, 轮询间隔可达分钟级,
  // 而且最小化时 canvas 可能只有 1x1, 用它截图会让模型"看到"错误画面。
  alive.sort((a, b) =>
    ((b[1].visible ? 1 : 0) - (a[1].visible ? 1 : 0)) ||
    (b[1].commands.length - a[1].commands.length) ||
    (b[1].lastSeen - a[1].lastSeen))
  return alive[0][0]
}

/**
 * 把命令发给浏览器执行。
 * preferId: 一次对话内钉住同一个标签页, 避免 set_params 与 screenshot 落在不同标签上
 * (多标签时会各自维护一套场景, 混用会导致"改了 A 却截图 B")。
 */
function callBrowser(name, args, timeoutMs = 8000, preferId = null) {
  const id = 'c' + seq++
  const now = Date.now()
  const pinned = preferId && consumers.get(preferId) && now - consumers.get(preferId).lastSeen < 5000
    ? preferId : pickConsumer()
  pending.set(id, { id, name, args, at: now, target: pinned })
  bridgeCalls++
  return new Promise((resolve) => {
    const t0 = Date.now()
    const tick = setInterval(() => {
      const r = results.get(id)
      if (r) {
        clearInterval(tick)
        results.delete(id)
        resolve({ ...r, id })
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(tick)
        pending.delete(id)
        bridgeErrors++
        resolve({ ok: false, error: '浏览器无响应 (应用未打开或已断开)', id })
      }
    }, 50)
  })
}

/* ---------------- 自检 ---------------- */
async function selfcheck() {
  const checks = []
  const push = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' })
  push('bridge 轮询参数', true, `port=${PORT}`)
  const alive = [...consumers.values()].some((c) => Date.now() - c.lastSeen < 5000)
  push('浏览器已连接', alive, alive ? `最近轮询 ${Date.now() - lastPollAt}ms 前` : '应用未打开或未连上桥')
  push('命令注册表', COMMANDS.length > 0, `${COMMANDS.length} 个命令`)
  push('大模型配置', !!llm.apiKey, llm.apiKey ? `${llm.provider}/${llm.model} (Key 仅服务端持有)` : '未配置 Key (config/llm.json 或环境变量 DEEPSEEK_API_KEY)')
  push('联网搜索', true, 'Bing RSS (免 Key, 服务端执行)')
  if (alive) {
    // 命令处理器一致性: 服务端声明的每个命令, 浏览器侧都必须有实现
    const help = await callBrowser('app.help', {}, 4000)
    const impl = new Set((help.ok && help.data && help.data.commands) || [])
    const missing = COMMANDS.map((c) => c.name).filter((n) => !impl.has(n))
    push('命令处理器一致性', impl.size > 0 && missing.length === 0,
      missing.length ? `缺少实现: ${missing.join(', ')}` : `${impl.size} 个命令均有实现`)
  }
  let appCheck = null
  if (alive) {
    appCheck = await callBrowser('app.selfcheck', {}, 6000)
    push('应用侧自检', appCheck.ok, appCheck.ok ? JSON.stringify(appCheck.data).slice(0, 400) : appCheck.error)
  }
  return { ok: checks.every((c) => c.ok), checks, port: PORT, bridgeCalls, bridgeErrors, llm: { provider: llm.provider, model: llm.model, hasKey: !!llm.apiKey, source: llm.source } }
}

/* ---------------- MCP (JSON-RPC 2.0 over HTTP) ---------------- */
function mcpHandle(body) {
  const { id, method, params } = body || {}
  const ok = (result) => ({ jsonrpc: '2.0', id: id ?? null, result })
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
  if (method === 'initialize') {
    return ok({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fast-tree-mcp', version: '1.0.0' },
    })
  }
  if (method === 'tools/list' || method === 'tools.list') {
    return ok({ tools: toolsForMcp() })
  }
  if (method === 'resources/list' || method === 'resources.list') {
    return ok({
      resources: [
        { uri: 'fasttree://params', name: '当前参数 (JSON)', mimeType: 'application/json' },
        { uri: 'fasttree://status', name: '应用状态', mimeType: 'application/json' },
        { uri: 'fasttree://node-tree', name: '节点树', mimeType: 'application/json' },
        { uri: 'fasttree://selfcheck', name: 'MCP 自检', mimeType: 'application/json' },
      ],
    })
  }
  if (method === 'resources/read' || method === 'resources.read') {
    const uri = params?.uri || ''
    if (uri === 'fasttree://params') return callBrowser('app.get_params', {}).then((r) => ok({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(r) }] }))
    if (uri === 'fasttree://status') return callBrowser('app.status', {}).then((r) => ok({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(r) }] }))
    if (uri === 'fasttree://node-tree') return callBrowser('app.node_tree', {}).then((r) => ok({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(r) }] }))
    if (uri === 'fasttree://selfcheck') return selfcheck().then((r) => ok({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(r) }] }))
    return err(-32602, '未知资源: ' + uri)
  }
  if (method === 'tools/call' || method === 'tools.call') {
    const rawName = params?.name || ''
    const name = fromToolName(rawName)
    const cmd = COMMANDS.find((c) => c.name === name)
    if (!cmd) return err(-32602, `未知工具: ${rawName}`)
    for (const [k, s] of Object.entries(cmd.params || {})) {
      if (s.required && (params?.arguments?.[k] === undefined)) return err(-32602, `缺少参数 ${k}`)
    }
    return callBrowser(name, params?.arguments || {}).then((r) =>
      ok({ content: [{ type: 'text', text: JSON.stringify(r) }], isError: !r.ok }),
    )
  }
  if (method === 'ping') return ok({})
  return err(-32601, `不支持的方法: ${method}`)
}

/* ---------------- 大模型代理 (OpenAI 兼容; Key 只在服务端) ---------------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'
const LLM_SYSTEM = `你是"快速树生成工具 (FastTree)"的建模助手。用户用中文描述需求或上传参考照片, 你通过工具把应用里的程序化树调成目标样子。
基本规则:
- 只能通过给定工具操作应用, 不要臆造命令; 改参数用 app.set_params, 换树用 app.apply_preset, 开关用 app.toggle, 改完用 app.rebuild
- 参数键名必须来自 app.get_params 返回的真实参数树 (全量约 8KB, 一次读完即可); 不确定某组键时用 app.get_params({path:'leaves'}) 精确读, 禁止猜键名
- 路径写法: 分组.键, 数组用下标, 如 'branches.level[1].count'、'traffic' 不存在; 批量改一次发一个 patch 即可
- 单位: 长度=米, 角度=度, 比例=0~1 或相对父级的倍率; 改完参数后 app.rebuild 会重新生长 (约 1 秒)
- 回复用简短中文, 可用 Markdown, 说明改了什么、依据是什么; 不要输出大段代码或完整参数 JSON
意图分流 (先判断这次是"只看"还是"要动手", 判断错会被用户认为多做了或没做):
- 用户只要"识别/描述/分析/看看这张图/这是什么树", 没有说还原、照着做、改成这样 -> 只输出 3~6 条视觉要点与结论, 不调用任何改动类工具 (apply_preset/set_params/rebuild/apply_leaf_card/set_bark_texture), 也不 rebuild; 末尾可补一句"要我按这张图建模吗?"
- 用户说"还原/照着这张图建模/改成这样/和参考图一致/按图重建" -> 必须走下方参考图还原流程, 至少 set_params + rebuild + screenshot 各一次, 不能只给方案
- 一句话里两者都有 ("识别并还原") -> 先简短描述要点, 再直接建模, 不要反问
取值与语义 (都已确定, 不要靠 list_* 或试错去猜):
- 树种 species: oak 橡树 / maple 枫树 / pine 松树 / birch 白桦 / willow 垂柳 / sakura 樱花 / shrub 灌木 / dead 枯树 (没有 banyan)
- 生长阶段 stage: seedling 树苗 / sapling 幼树 / young 小树 / mature 大树 / ancient 古树
- 季节 season: spring / summer / autumn / winter
- leaves.shape (程序化叶形): oval 椭圆 / birch 桦叶 / lance 披针 / needle 针叶 / maple 枫(浅裂) / oak 橡叶 / palmate 掌状 5 裂 / cordate 心形
- leaves.cardMode=true 时显示卡片贴图, shape 不生效; 要用程序化叶形就同时设 cardMode=false
- leafMat.tintMode: 'texture' 保持贴图原色 / 'season' 跟随叶色染色 / 'custom' 自定义; 改了 leaves.color 却看不出变化, 多半是 tintMode 还停在 texture
- app.camera action: frame 框住整树 / front 正视图 / top 俯视 / side 侧视 / reset 复位
- app.toggle target: leaves/flower/fruit/fall/litter/flowerFall/flowerLitter/particles/roots/playing/wireframe
- app.set_material target: bark/leaf/flower
- app.apply_preset 省略 stage/season 会沿用当前值 (不用硬填); 它直接返回 summary (树高/分叉/层数/叶色/卡片状态/树皮), 用 summary 判断即可, 不要再 get_params 复核预设结果
- app.set_params 只接受参数树里已存在的键; 返回的 ignored 非空就说明键名写错了, 按 get_params 里的真实键名改正后重发, 不许装作没看见
- 树皮贴图: set_bark_texture 用 batch + row/col (都从 1 开始, 默认第 1 行第 1 列), 不要猜坐标; 批次中文名: 灰褐裂隙 / 红褐块状 / 黑白桦皮 / 白桦 / 灌木 褐裂 / 灌木 霜裂 / 松树 赤裂 / 松树 鳞片
- 叶片批次推荐: 秋色阔叶(枫/橡) -> ① 秋色系; 绿色阔叶 -> ② 绿色系; 白桦 -> ③/④; 樱花 -> ⑤~⑩; 柳 -> ⑪; 灌木 -> ⑭/⑮; 松 -> ⑯/⑰
工具调用纪律 (违反就会来回空转, 必须遵守):
- 严禁用 app.help / app.list_species / app.status / app.node_tree 做"探索"; 工具清单与树种枚举已在上面给出, 需要状态直接读 get_params
- 每一轮把所有能并行的调用一次性发出 (同一个 assistant 消息里多个 tool_calls), 不要一轮只发一个只读调用
- 工具轮只做操作, 不要长篇叙述; 拿到全部结果后, 最后一轮再用 2~4 句话总结
- 整个还原过程应在 5 轮内完成主体 (读参数、换预设、精调、重建、截图), 只有截图对比后确实需要修正才追加第 6、7 轮
- 截图回传后, 必须先用 2~3 句话说出"当前画面 vs 参考图"的具体差异 (冠幅/树高比例、冠形、疏密、叶色/叶形、树皮/地面), 再据此调参; 不允许截完图就直接结束
- 换树种/换参考图时先清掉上一轮残留的卡片贴图, 否则旧卡片会盖掉季节叶色: 在 set_params 里同时带 'leaves.cardMode':false、'leafMat.texture':''、'leafMat.tintMode':'season' (只有当参考图的叶片形态与某个卡片批次一致时才保留卡片)
参考图还原流程 (用户发图, 或说"照着这张图/这棵树建模"时, 必须按顺序执行):
1. 先在思考里定 3~6 条要点: 树种/生长阶段/季节, 树冠轮廓(圆/伞/塔/垂/不规则)与冠幅/树高比例, 主干分叉(高度/条数/角度), 枝条走向与疏密, 叶片形状/大小/颜色, 花或果, 树皮质感, 地面与天空氛围
2. 第 1 轮: app.apply_preset 定树种+阶段+季节 (可用树种 oak/maple/pine/birch/willow/sakura/shrub/dead, 季节 spring/summer/autumn/winter); 需要完整键名时同一轮并行 app.get_params
3. 第 2 轮: app.set_params 一次批量精调树形/枝条/叶/花/果/树皮/地面, 参考下方映射
4. 第 3 轮: app.rebuild
5. 第 4 轮: app.screenshot (默认 900px JPEG, 会作为图片回传给你), 与参考图对比轮廓/比例/疏密/颜色
6. 需要修正就再 1~2 轮 set_params + rebuild + screenshot, 然后汇报关键参数与取舍
- 用户要求还原时, 必须至少改动一次参数并 rebuild, 不允许"只给方案不动手"; 读完参数不要再重复读同一组
视觉特征 -> 参数速查:
- 树高/干径/树干弯曲: trunk.height, trunk.baseRadius, trunk.taper, trunk.curve, trunk.lean, trunk.gnarl, trunk.flare
- 主干分叉(低分叉/多主枝): trunk.fork { enabled,count,height,angle,spread,radiusScale,lengthScale }
- 冠形与疏密: branches.levels(有效层数 1~5), branches.level[i] { count,pitch,lengthRatio,startT,endT,gravity,spread,upBias,curve }, branches.apicalDominance(顶端优势), branches.gravityScale/phototropism/lengthScale
  圆形浓密冠: levels 3~4, 主枝 count 4~6, pitch 55~70, 上层 pitch 40~55, apicalDominance 0.25~0.5
  塔形/针叶: pine 预设 + 上层 pitch 小 + upBias 大; 垂枝: gravity 取负 + pitch 大
- 叶片: leaves.enabled/size(米)/width/shape/perBranch/clusterCount/levels(哪几层长叶), 叶色 leaves.color/colorTip/colorVariance, 卡片贴图 app.list_leaf_cards + app.apply_leaf_card
  shape 只在 cardMode=false 时生效; 掌状/裂叶用 palmate 或 oak, 浅裂枫叶用 maple, 阔叶用 oval
  list_leaf_cards 会返回 batches 的中文名(如 ① 秋色系 / ② 绿色系 / ⑬ 柳花穗), 按名字选批次, 不要凭 id 猜; 阔叶参考图优先用叶片形状接近的批次, 形态不符就关掉卡片用程序化叶形
- 秋色(黄/橙/红): maple 或 oak 预设 + season=autumn; 枫树的黄橙由 maple 自带调色板给出, 再按需改 leaves.color/colorTip 与 colorVariance
- 花/果: flower.enabled/color/size/density/levels; fruit.enabled/type/color/size; 参考图没花就不要开
- 树皮: app.list_bark_textures + app.set_bark_texture, 或 bark.color/color2/tint/roughness/normalScale
- 地面与氛围: scene.ground/groundColor/gradient/skyTop/skyBottom, litter.enabled, fall.enabled, particles.enabled
- 用户只给文字时同样先 app.get_params, 再 apply_preset + set_params; 不要只调一两个参数就结束
- 本次对话可能允许联网搜索: 仅当需要外部/实时信息 (真实树种形态、季节特征) 时调用 web_search (最多 2 次), 拿到结果立刻建模, 不要反复换关键词; 引用时在句末用 [1][2] 标注
- 用户上传的图片可能出现在消息的 image_url 里; 若模型无法看图, 明确告诉用户切换到带"视觉"标记的模型`

/** 模型清单 (带视觉/上下文能力), 缓存 10 分钟 */
let modelsCache = { at: 0, value: null }
async function listModels() {
  if (modelsCache.value && Date.now() - modelsCache.at < 10 * 60 * 1000) return modelsCache.value
  const fallback = [{ id: llm.model || 'deepseek-chat', name: llm.model || 'deepseek-chat', vision: false, contextWindow: 0, maxOutput: 0 }]
  try {
    const res = await fetch(`${llm.baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: 'Bearer ' + llm.apiKey },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const json = await res.json()
    const list = (json.data || []).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      vision: Array.isArray(m.input_modalities) ? m.input_modalities.includes('image') : null,
      contextWindow: m.context_window || 0,
      maxOutput: m.max_output_tokens || 0,
    }))
    if (!list.length) throw new Error('空模型列表')
    modelsCache = { at: Date.now(), value: list }
    return list
  } catch (e) {
    return { ...fallback, error: String(e && e.message ? e.message : e) }
  }
}

/* ---------------- 联网搜索 (Bing RSS, 免 Key) ---------------- */
const SEARCH_CACHE = new Map()
function searchDecode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}
function searchStrip(s) {
  return searchDecode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}
async function webSearch(query, limit = 6) {
  const q = String(query || '').trim().slice(0, 200)
  if (!q) return { ok: false, error: '空搜索词', query: q, items: [] }
  const key = q.toLowerCase()
  const hit = SEARCH_CACHE.get(key)
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.value
  try {
    const url = `https://www.bing.com/search?format=rss&count=${Math.max(8, limit)}&mkt=zh-CN&q=${encodeURIComponent(q)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', Accept: 'application/rss+xml,text/xml,*/*' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error('搜索接口 HTTP ' + res.status)
    const xml = await res.text()
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map((m) => {
      const block = m[1]
      const pick = (tag) => {
        const mm = block.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'))
        return mm ? mm[1] : ''
      }
      return {
        title: searchStrip(pick('title')),
        url: searchDecode(pick('link')).trim(),
        snippet: searchStrip(pick('description')).slice(0, 400),
        date: searchStrip(pick('pubDate')),
      }
    }).filter((it) => it.title && /^https?:\/\//.test(it.url))
    const value = { ok: true, query: q, items }
    SEARCH_CACHE.set(key, { at: Date.now(), value })
    if (SEARCH_CACHE.size > 100) SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value)
    return value
  } catch (e) {
    return { ok: false, query: q, error: '联网搜索失败: ' + String(e && e.message ? e.message : e), items: [] }
  }
}

/* ---------------- OpenAI 兼容请求封装 ---------------- */
function llmUrl() {
  return `${llm.baseUrl.replace(/\/$/, '')}/chat/completions`
}
function appTools() {
  return COMMANDS.map((c) => ({
    type: 'function',
    function: {
      name: toToolName(c.name),
      description: c.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(c.params || {}).map(([k, s]) => {
          const prop = { type: s.type }
          // enum 必须透传给上游: 否则模型看不到 stage/season/camera action 等合法取值,
          // 只能靠猜或额外调用 list_* 去探索, 白烧工具轮次。
          if (Array.isArray(s.enum)) prop.enum = s.enum
          if (s.items) prop.items = s.items
          if (s.description) prop.description = s.description
          return [k, prop]
        })),
        required: Object.entries(c.params || {}).filter(([, s]) => s.required).map(([k]) => k),
      },
    },
  }))
}
const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '联网搜索公开网页, 返回标题/链接/摘要。需要外部或实时信息时使用。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索关键词' } },
      required: ['query'],
    },
  },
}

/** 规范化客户端消息: 允许 role/content(字符串或 OpenAI 多模态数组), 限制体积 */
function normalizeChatMessages(input) {
  const out = []
  const list = Array.isArray(input) ? input : [{ role: 'user', content: String(input || '') }]
  for (const m of list.slice(-40)) {
    if (!m || !['user', 'assistant', 'system'].includes(m.role)) continue
    let content = m.content
    if (Array.isArray(content)) {
      const parts = []
      for (const p of content.slice(0, 12)) {
        if (!p) continue
        if (p.type === 'text' && p.text) parts.push({ type: 'text', text: String(p.text).slice(0, 20000) })
        else if (p.type === 'image_url' && p.image_url && p.image_url.url) {
          const url = String(p.image_url.url)
          if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url) || url.length > 6e6) continue
          parts.push({ type: 'image_url', image_url: { url } })
        }
      }
      if (!parts.some((p) => p.type === 'text')) parts.unshift({ type: 'text', text: '' })
      content = parts
    } else {
      content = String(content || '').slice(0, 20000)
      if (!content.trim()) continue
    }
    out.push({ role: m.role, content })
  }
  return out
}
function buildMessages(body, allowSearch) {
  return [
    { role: 'system', content: LLM_SYSTEM + (allowSearch ? '\n本次允许联网搜索 (web_search 工具可用)。' : '') },
    ...normalizeChatMessages(body.messages || body.message),
  ]
}
/** 模型是否支持图片输入: true/false 已知, null = 上游没给能力字段 (按未知处理, 允许尝试) */
async function modelSupportsVision(model) {
  try {
    const list = await listModels()
    if (!Array.isArray(list)) return null
    const hit = list.find((m) => m.id === model)
    return hit ? !!hit.vision : null
  } catch (e) { return null }
}
function parseToolArgs(s) {
  try { return JSON.parse(s || '{}') } catch { return {} }
}
function briefTool(name, args) {
  if (name === 'web_search') return '联网搜索: ' + String((args && args.query) || '').slice(0, 40)
  if (name === 'app.screenshot') return '截图 (用于与参考图对比)'
  return name
}
/**
 * 工具轮用尽 / 模型没给正文时的兜底回复。
 * 之前直接返回 "(已完成)", 用户只看到思考过程却不知道有没有真的建模。
 */
function fallbackReply(executed) {
  const names = [...new Set((executed || []).map((e) => e.brief || e.name))]
  if (!names.length) return '(未收到模型回复, 请重试或将模型切换到 视觉 🖼 版本)'
  return `已执行 ${executed.length} 个操作: ${names.join('、')}。若效果还不理想, 再发一句具体要求即可继续调整。`
}
/** 上游 HTTP 错误 -> 可读提示 (图片相关错误单独给出可操作的建议) */
function llmHttpError(status, txt) {
  const s = String(txt || '')
  if (/(image|vision|multimodal|image_url|图片|图像)/i.test(s)) {
    return new Error('当前模型不支持图片输入: 请在右上角切换到带 "视觉 🖼" 标记的模型后重试')
  }
  return new Error(`大模型接口错误 ${status}: ${s.slice(0, 300)}`)
}
async function callLlm(model, messages, tools, timeoutMs = 120000) {
  const payload = { model, messages, temperature: 0.3 }
  if (tools && tools.length) { payload.tools = tools; payload.tool_choice = 'auto' }
  const res = await fetch(llmUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + llm.apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw llmHttpError(res.status, JSON.stringify(json))
  const msg = json.choices?.[0]?.message || {}
  return { msg, usage: json.usage || null, model: json.model || model }
}

/** 执行一次工具调用 (应用命令走浏览器桥; web_search 在服务端) */
async function runToolCall(tc, searchState, targetTab) {
  const name = fromToolName(tc.name)
  const args = tc.args || {}
  if (name === 'web_search') {
    const st = searchState || { count: 0 }
    st.count = (st.count || 0) + 1
    if (st.count > 2) {
      return { name: 'web_search', args, sources: [], ok: false, result: { ok: false, error: '联网搜索次数已达上限 (2 次), 请直接基于已有结果回答, 不要继续搜索' } }
    }
    const r = await webSearch(args.query || args.q || '')
    return { name: 'web_search', args, result: r, sources: r.ok ? r.items : [], ok: r.ok }
  }
  const r = await callBrowser(name, args, 8000, targetTab || null)
  // 截图单独摘出来: dataUrl 有几十万字符, 塞进 tool 文本会被 12000 字符上限截断,
  // 必须改由下面 toolMessages 追加成一条真正的图片消息, 模型才能"看见"画面。
  const image = name === 'app.screenshot' && r && r.ok !== false && r.data && typeof r.data.dataUrl === 'string'
    ? r.data.dataUrl : ''
  return { name, args, result: r, sources: [], ok: r.ok !== false, image }
}

/**
 * 工具结果 -> 发给大模型的消息数组。
 * 普通结果就是一条 tool 消息; 截图额外补一条 user(image_url) 消息。
 * allowImage=false (模型明确不支持图片) 时只保留占位文本, 避免请求被上游拒绝。
 */
function toolMessages(callId, r, allowImage) {
  const out = []
  let result = r.result
  if (r.image) {
    const placeholder = allowImage ? '[截图已作为图片消息附在下方]' : '[当前模型不支持图片输入, 截图已省略]'
    result = { ...result, data: { ...((result && result.data) || {}), dataUrl: placeholder } }
  }
  // 参数树是建模的核心输入, 给更大上限, 避免刚好越过 12000 被截成非法 JSON
  const limit = r.name === 'app.get_params' ? 30000 : 12000
  out.push({ role: 'tool', tool_call_id: callId, content: JSON.stringify(result).slice(0, limit) })
  if (r.image && allowImage) {
    out.push({
      role: 'user',
      content: [
        { type: 'text', text: '[FastTree 当前视口截图] 请把这张截图与用户给的参考图对比: 轮廓/冠幅/枝条疏密/叶色/地面氛围, 决定是否还要微调。' },
        { type: 'image_url', image_url: { url: r.image } },
      ],
    })
  }
  return out
}

/** 非流式对话: 多轮工具调用 + 思考内容 + 来源 */
async function llmChat(body) {
  if (!llm.apiKey) return { ok: false, error: '服务端未配置大模型 Key' }
  const allowSearch = !!body.search
  const model = String(body.model || llm.model)
  const messages = buildMessages(body, allowSearch)
  const tools = appTools().concat(allowSearch ? [WEB_SEARCH_TOOL] : [])
  let thinking = ''
  let reply = ''
  let finalModel = model
  const executed = []
  const sources = []
  const searchState = { count: 0 }
  // 一次对话钉住同一个标签页: 多标签时每个标签有独立场景, 混用会出现"改了 A 却截图 B"
  // clientId 由聊天面板上报(它知道自己所在的页面), 优先用它, 保证改的就是用户眼前的树
  const targetTab = (body.clientId && consumers.has(body.clientId)) ? body.clientId : pickConsumer()
  // 只有真的产生截图时才查询模型能力, 避免普通对话多一次上游 /models 请求
  let canImages = null
  const imageAllowed = async () => {
    if (canImages === null) canImages = (await modelSupportsVision(model)) !== false
    return canImages
  }
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let got
    try { got = await callLlm(model, messages, tools) } catch (e) { return { ok: false, error: String(e.message || e), executed, sources } }
    finalModel = got.model
    const msg = got.msg
    if (msg.reasoning_content) thinking += msg.reasoning_content
    if (msg.content) reply = msg.content
    const calls = (msg.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function.name, args: parseToolArgs(tc.function.arguments) }))
    if (!calls.length) break
    reply = ''
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls })
    for (const call of calls) {
      const r = await runToolCall(call, searchState, targetTab)
      executed.push({ name: r.name, ok: !!r.ok, brief: briefTool(r.name, r.args) })
      if (r.sources && r.sources.length) sources.push(...r.sources)
      const allow = r.image ? await imageAllowed() : true
      messages.push(...toolMessages(call.id || call.name, r, allow))
    }
  }
  return { ok: true, reply: reply || fallbackReply(executed), thinking, executed, sources: dedupeSources(sources), model: finalModel }
}
function dedupeSources(list) {
  const seen = new Set()
  const out = []
  for (const s of list || []) {
    if (!s || !s.url || seen.has(s.url)) continue
    seen.add(s.url)
    out.push({ title: s.title, url: s.url, snippet: s.snippet, date: s.date })
    if (out.length >= 8) break
  }
  return out
}

/** SSE 流式对话: 事件 thinking/content/tool/sources/phase/done/error */
async function llmChatStream(body, res) {
  const send = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch (e) { /* client gone */ } }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  let closed = false
  res.on('close', () => { closed = true })
  if (!llm.apiKey) { send({ type: 'error', error: '服务端未配置大模型 Key' }); res.end(); return }
  const allowSearch = !!body.search
  const model = String(body.model || llm.model)
  const messages = buildMessages(body, allowSearch)
  const tools = appTools().concat(allowSearch ? [WEB_SEARCH_TOOL] : [])
  const executed = []
  const sources = []
  const searchState = { count: 0 }
  // 流式对话同样钉住同一个标签页, 避免工具与截图落到不同标签
  const targetTab = (body.clientId && consumers.has(body.clientId)) ? body.clientId : pickConsumer()
  let canImages = null
  const imageAllowed = async () => {
    if (canImages === null) canImages = (await modelSupportsVision(model)) !== false
    return canImages
  }
  let thinking = ''
  let reply = ''
  let finalModel = model
  // 浏览器断开时中止上游请求, 避免继续计费
  const upstreamAbort = new AbortController()
  const abortTimer = setTimeout(() => upstreamAbort.abort(), 600000)
  res.on('close', () => { closed = true; try { upstreamAbort.abort() } catch (e) { /* ignore */ } })
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS && !closed; round++) {
      const payload = { model, messages, temperature: 0.3, stream: true }
      if (tools.length) { payload.tools = tools; payload.tool_choice = 'auto' }
      const upstream = await fetch(llmUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + llm.apiKey },
        body: JSON.stringify(payload),
        signal: upstreamAbort.signal,
      })
      if (!upstream.ok || !upstream.body) {
        const txt = await upstream.text().catch(() => '')
        throw llmHttpError(upstream.status, txt)
      }
      const reader = upstream.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      const toolCalls = new Map()
      let roundContent = ''
      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          let evt
          try { evt = JSON.parse(data) } catch { continue }
          if (evt.model) finalModel = evt.model
          const delta = evt.choices?.[0]?.delta || {}
          if (delta.reasoning_content) { thinking += delta.reasoning_content; send({ type: 'thinking', delta: delta.reasoning_content }) }
          if (delta.content) { roundContent += delta.content; send({ type: 'content', delta: delta.content }) }
          for (const tc of delta.tool_calls || []) {
            const i = tc.index || 0
            const cur = toolCalls.get(i) || { id: '', name: '', args: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function && tc.function.name) cur.name = tc.function.name
            if (tc.function && tc.function.arguments) cur.args += tc.function.arguments
            toolCalls.set(i, cur)
          }
        }
      }
      if (closed) break
      if (!toolCalls.size) { reply = roundContent; break }
      // 工具轮: 先让前端清空刚才的过渡文本, 再执行工具
      send({ type: 'phase', round: round + 1, message: '正在执行工具…' })
      reply = ''
      const calls = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => ({
        id: c.id, name: c.name, arguments: c.args,
      }))
      messages.push({
        role: 'assistant',
        content: roundContent || '',
        tool_calls: calls.map((c) => ({ id: c.id || c.name, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } })),
      })
      for (const call of calls) {
        const args = parseToolArgs(call.arguments)
        send({ type: 'tool', name: call.name, args, brief: briefTool(call.name, args), status: 'running' })
        const r = await runToolCall({ name: call.name, args }, searchState, targetTab)
        executed.push({ name: r.name, ok: !!r.ok, brief: briefTool(r.name, r.args) })
        send({ type: 'tool', name: r.name, args: r.args, brief: briefTool(r.name, r.args), status: r.ok ? 'done' : 'error' })
        if (r.sources && r.sources.length) {
          sources.push(...r.sources)
          const merged = dedupeSources(sources)
          send({ type: 'sources', items: merged })
        }
        if (closed) break
        const allow = r.image ? await imageAllowed() : true
        messages.push(...toolMessages(call.id || call.name, r, allow))
      }
    }
    if (!closed) send({ type: 'done', reply: reply || fallbackReply(executed), thinking, executed, sources: dedupeSources(sources), model: finalModel })
  } catch (e) {
    if (!closed) send({ type: 'error', error: String(e && e.message ? e.message : e) })
  } finally {
    clearTimeout(abortTimer)
    try { res.end() } catch (e) { /* ignore */ }
  }
}

/* ---------------- HTTP ---------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const MAX = 32 * 1024 * 1024 // 允许带图片的多模态消息
    const len = Number(req.headers['content-length'] || 0)
    if (len > MAX) { reject(new Error('请求体过大 (上限 32MB)')); req.destroy(); return }
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX) { reject(new Error('请求体过大 (上限 32MB)')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(Buffer.concat(chunks).toString('utf8') ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    return res.end()
  }
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const route = u.pathname
  try {
    if (route === '/api/selfcheck' && req.method === 'GET') return json(res, 200, await selfcheck())
    if (route === '/api/tools' && req.method === 'GET') return json(res, 200, { ok: true, tools: COMMANDS })
    if (route === '/mcp' && req.method === 'POST') return json(res, 200, await mcpHandle(await readBody(req)))
    if (route === '/bridge/hello' && req.method === 'POST') {
      const body = await readBody(req)
      const tabId = typeof body.tabId === 'string' ? body.tabId : ''
      // 同一个标签页复用同一个 consumerId。
      // 为什么不是"删掉旧实例再发新 id": HMR 会重新执行客户端模块, 如果 dispose 没跑成功,
      // 同一页面里会同时存在多个轮询循环; 每次 hello 都换 id 会让它们轮流把对方从
      // consumers 里删掉 -> 一方轮询 404 -> 重新注册 -> 再删掉另一方, 无限乒乓,
      // 期间任何命令的 target 都会立刻失效, 表现为"浏览器无响应"。
      // 复用 id 后所有循环都轮询同一个实例, 命令拿到一次就删, 不会被重复执行。
      let cid = tabId ? tabCid.get(tabId) : ''
      if (!cid) {
        cid = 'p' + seq++
        if (tabId) tabCid.set(tabId, cid)
      }
      consumers.set(cid, {
        commands: Array.isArray(body.commands) ? body.commands : [],
        lastSeen: Date.now(),
        path: body.path || '',
        version: body.version || '',
        visible: body.visible !== false,
        tabId,
      })
      return json(res, 200, { ok: true, consumerId: cid })
    }
    if (route === '/bridge/poll' && req.method === 'GET') {
      const cid = u.searchParams.get('id') || ''
      lastPollAt = Date.now()
      const c = consumers.get(cid)
      if (!c) return json(res, 404, { ok: false, error: '未知实例 (桥已重启), 请重新注册' })
      {
        c.lastSeen = Date.now()
        const v = u.searchParams.get('visible')
        if (v !== null) c.visible = v === '1'
      }
      const mine = []
      for (const [id, cmd] of pending.entries()) {
        if (!cmd.target || cmd.target === cid) {
          mine.push({ id, name: cmd.name, args: cmd.args })
          pending.delete(id)
        }
      }
      return json(res, 200, { commands: mine, consumerId: cid })
    }
    if (route === '/bridge/consumers' && req.method === 'GET') {
      const now = Date.now()
      return json(res, 200, {
        consumers: [...consumers.entries()].map(([id, c]) => ({
          id, commands: c.commands.length, idleMs: now - c.lastSeen, path: c.path, version: c.version, visible: !!c.visible,
        })),
      })
    }
    if (route === '/bridge/result' && req.method === 'POST') {
      const body = await readBody(req)
      if (body && body.id) results.set(body.id, { ok: !!body.ok, data: body.data, error: body.error })
      return json(res, 200, { ok: true })
    }
    if (route === '/api/llm/chat' && req.method === 'POST') return json(res, 200, await llmChat(await readBody(req)))
    if (route === '/api/llm/chat/stream' && req.method === 'POST') return llmChatStream(await readBody(req), res)
    if (route === '/api/llm/models' && req.method === 'GET') return json(res, 200, { ok: true, models: await listModels() })
    if (route === '/api/search' && req.method === 'POST') {
      const body = await readBody(req)
      return json(res, 200, await webSearch(body.q || body.query || '', Number(body.limit) || 6))
    }
    if (route === '/api/search' && req.method === 'GET') {
      return json(res, 200, await webSearch(u.searchParams.get('q') || '', Number(u.searchParams.get('limit')) || 6))
    }
    if (route === '/api/call' && req.method === 'POST') {
      const body = await readBody(req)
      const r = await callBrowser(body.name, body.args || {})
      return json(res, 200, r)
    }
    if (route === '/health') {
      return json(res, 200, {
        ok: true,
        port: PORT,
        pid: process.pid,
        version: BRIDGE_VERSION,
        features: BRIDGE_FEATURES,
        startedAt: Math.round(Date.now() - Math.round(process.uptime() * 1000)),
      })
    }
    json(res, 404, { ok: false, error: 'not found' })
  } catch (e) {
    json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
  }
})

/* ---------------- stdio 模式: 桌面 MCP 客户端 (Claude Desktop 等) ---------------- */
const STDIO = process.argv.includes('--stdio')
if (STDIO) {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', async (chunk) => {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      let req
      try { req = JSON.parse(line) } catch { continue }
      const res = await mcpHandle(req)
      process.stdout.write(JSON.stringify(res) + '\n')
    }
  })
  console.error('[bridge] stdio 模式已启动 (MCP JSON-RPC over stdio)')
} else {
server.listen(PORT, '127.0.0.1', () => {
  const hasKey = !!llm.apiKey
  console.log(`[bridge] 应用桥 / MCP 已启动 http://127.0.0.1:${PORT}`)
  console.log(`[bridge] 命令数 ${COMMANDS.length} | 大模型 ${llm.provider}/${llm.model} | Key ${hasKey ? '已配置(仅服务端)' : '未配置'}`)
  console.log(`[bridge] 自检: curl http://127.0.0.1:${PORT}/api/selfcheck`)
})
}
