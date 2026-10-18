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
const BRIDGE_VERSION = '2.1.0'
const BRIDGE_FEATURES = ['bridge', 'mcp', 'llm.chat', 'llm.chat.stream', 'llm.models', 'search']

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
  alive.sort((a, b) => (b[1].commands.length - a[1].commands.length) || (b[1].lastSeen - a[1].lastSeen))
  return alive[0][0]
}

function callBrowser(name, args, timeoutMs = 8000) {
  const id = 'c' + seq++
  pending.set(id, { id, name, args, at: Date.now(), target: pickConsumer() })
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
const LLM_SYSTEM = `你是"快速树生成工具 (FastTree)"的助手。用户用中文描述需求, 你通过工具修改应用里的程序化树。
规则:
- 只能通过给定工具操作应用, 不要臆造命令; 改参数用 app.set_params, 换树用 app.apply_preset, 开关用 app.toggle, 改完一般要 app.rebuild
- 用户可能上传图片: 先准确描述/识别图片里的内容 (树、叶、花、颜色、结构), 再据此操作应用
- 本次对话可能允许联网搜索: 仅当需要外部/实时信息时调用 web_search (最多 2 次), 拿到结果后立刻基于结果回答, 不要反复换关键词搜索; 引用搜索结果时在句末用 [1][2] 标注来源编号
- 回复用简短中文, 可以用 Markdown (列表/加粗/行内代码), 说明你做了什么、依据是什么`

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
      vision: Array.isArray(m.input_modalities) ? m.input_modalities.includes('image') : false,
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
        properties: Object.fromEntries(Object.entries(c.params || {}).map(([k, s]) => [k, { type: s.type, description: s.description || '' }])),
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
function parseToolArgs(s) {
  try { return JSON.parse(s || '{}') } catch { return {} }
}
function briefTool(name, args) {
  if (name === 'web_search') return '联网搜索: ' + String((args && args.query) || '').slice(0, 40)
  return name
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
  if (!res.ok) throw new Error(`大模型接口错误 ${res.status}: ${JSON.stringify(json).slice(0, 400)}`)
  const msg = json.choices?.[0]?.message || {}
  return { msg, usage: json.usage || null, model: json.model || model }
}

/** 执行一次工具调用 (应用命令走浏览器桥; web_search 在服务端) */
async function runToolCall(tc, searchState) {
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
  const r = await callBrowser(name, args)
  return { name, args, result: r, sources: [], ok: r.ok !== false }
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
  for (let round = 0; round < 4; round++) {
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
      const r = await runToolCall(call, searchState)
      executed.push({ name: r.name, ok: !!r.ok, brief: briefTool(r.name, r.args) })
      if (r.sources && r.sources.length) sources.push(...r.sources)
      messages.push({ role: 'tool', tool_call_id: call.id || call.name, content: JSON.stringify(r.result).slice(0, 12000) })
    }
  }
  return { ok: true, reply: reply || '(已完成)', thinking, executed, sources: dedupeSources(sources), model: finalModel }
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
  let thinking = ''
  let reply = ''
  let finalModel = model
  // 浏览器断开时中止上游请求, 避免继续计费
  const upstreamAbort = new AbortController()
  const abortTimer = setTimeout(() => upstreamAbort.abort(), 180000)
  res.on('close', () => { closed = true; try { upstreamAbort.abort() } catch (e) { /* ignore */ } })
  try {
    for (let round = 0; round < 4 && !closed; round++) {
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
        throw new Error(`大模型接口错误 ${upstream.status}: ${txt.slice(0, 300)}`)
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
        const r = await runToolCall({ name: call.name, args }, searchState)
        executed.push({ name: r.name, ok: !!r.ok, brief: briefTool(r.name, r.args) })
        send({ type: 'tool', name: r.name, args: r.args, brief: briefTool(r.name, r.args), status: r.ok ? 'done' : 'error' })
        if (r.sources && r.sources.length) {
          sources.push(...r.sources)
          const merged = dedupeSources(sources)
          send({ type: 'sources', items: merged })
        }
        if (closed) break
        messages.push({ role: 'tool', tool_call_id: call.id || call.name, content: JSON.stringify(r.result).slice(0, 12000) })
      }
    }
    if (!closed) send({ type: 'done', reply: reply || '(已完成)', thinking, executed, sources: dedupeSources(sources), model: finalModel })
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
      const cid = 'p' + seq++
      consumers.set(cid, {
        commands: Array.isArray(body.commands) ? body.commands : [],
        lastSeen: Date.now(),
        path: body.path || '',
        version: body.version || '',
      })
      return json(res, 200, { ok: true, consumerId: cid })
    }
    if (route === '/bridge/poll' && req.method === 'GET') {
      const cid = u.searchParams.get('id') || ''
      lastPollAt = Date.now()
      const c = consumers.get(cid)
      if (c) c.lastSeen = Date.now()
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
          id, commands: c.commands.length, idleMs: now - c.lastSeen, path: c.path, version: c.version,
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
