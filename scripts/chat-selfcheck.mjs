/**
 * 大模型对话链路自检 (Node, 无浏览器)
 * ------------------------------------------------------------
 * 覆盖:
 *   - 桥服务 / 模型清单 (含视觉能力) / 联网搜索
 *   - 非流式对话: 文本 / 图片识别 / 思考字段
 *   - 工具调用: 用"假浏览器消费者"接住 app.* 命令 (验证服务端 tool loop)
 *   - SSE 流式: thinking/content/tool/sources/done 事件
 *   - 联网搜索: 模型调用 web_search 并把来源回传
 *
 * 用法: npm run chat:check
 * 说明: 需要 config/llm.json 里的 Key 与网络; 不启动浏览器, 对话界面本身由
 *       dev/chat-check.html 在浏览器里校验。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = 5300 + Math.floor(Math.random() * 300)
const BASE = `http://127.0.0.1:${PORT}`
const PNG_RED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let pass = 0
let fail = 0
let warn = 0
const failures = []
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
function warning(name, detail = '') { warn++; console.log(`  ⚠ ${name}${detail ? ' — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function jsonGet(pathname, timeoutMs = 20000) {
  const res = await fetch(BASE + pathname, { signal: AbortSignal.timeout(timeoutMs) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function jsonPost(pathname, body, timeoutMs = 180000) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function readSSE(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240000),
  })
  if (!res.ok || !res.body) return { status: res.status, events: [], text: await res.text().catch(() => '') }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const events = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      try { events.push(JSON.parse(data)) } catch (e) { /* ignore */ }
    }
  }
  return { status: res.status, events }
}
function eventsOf(events, type) { return events.filter((e) => e.type === type) }
function joinDeltas(events, type) { return eventsOf(events, type).map((e) => e.delta || '').join('') }

/* ---------------- 假浏览器消费者 (让 app.* 工具能执行) ---------------- */
const handled = []
let consumerId = ''
async function startFakeBrowser() {
  const res = await jsonPost('/bridge/hello', { commands: ['app.help', 'app.status', 'app.selfcheck', 'app.rebuild', 'app.get_params', 'app.set_params', 'app.toggle'], path: '/fake', version: 'chat-selfcheck' })
  consumerId = (res.json && res.json.consumerId) || ''
  if (!consumerId) return
  ;(async () => {
    while (true) {
      await sleep(120)
      try {
        const r = await jsonGet('/bridge/poll?id=' + encodeURIComponent(consumerId))
        for (const c of r.json.commands || []) {
          handled.push(c.name)
          await jsonPost('/bridge/result', { id: c.id, ok: true, data: { ok: true, fake: true, name: c.name } })
        }
      } catch (e) { break }
    }
  })()
}

/* ---------------- 启动服务 ---------------- */
console.log('\n=== 大模型对话自检 ===\n')
const child = spawn(process.execPath, [path.join('scripts', 'app-bridge-server.mjs'), `--port=${PORT}`], {
  cwd: ROOT, stdio: 'ignore',
})
let ready = false
for (let i = 0; i < 60; i++) {
  await sleep(150)
  try {
    const r = await jsonGet('/health', 1000)
    if (r.status === 200 && r.json.ok) { ready = true; break }
  } catch (e) { /* 还没起来 */ }
}
if (!ready) {
  console.log('✗ 桥服务启动失败 (端口 ' + PORT + ')')
  try { child.kill() } catch (e) { /* ignore */ }
  process.exit(1)
}
console.log(`  · 测试桥服务端口 ${PORT}`)

try {
  /* 1. 基础 / 模型 / 搜索 */
  console.log('\n[1] 桥服务 · 模型清单 · 联网搜索')
  const health = await jsonGet('/health')
  ok('健康检查', health.status === 200 && health.json.ok === true)
  const models = await jsonGet('/api/llm/models')
  const list = models.json.models || []
  ok('模型清单可用', models.json.ok && list.length > 0, list.map((m) => m.id).join(', '))
  ok('存在视觉模型 (图片识别前提)', list.some((m) => m.vision), list.filter((m) => m.vision).map((m) => m.id).join(', '))
  let search = await jsonPost('/api/search', { q: '程序化 树木 生成', limit: 4 })
  if (!search.json.ok) { await sleep(1200); search = await jsonPost('/api/search', { q: 'procedural tree generation', limit: 4 }) }
  ok('联网搜索返回结果', search.json.ok && (search.json.items || []).length > 0, `items=${(search.json.items || []).length}`)
  const s0 = (search.json.items || [])[0]
  ok('搜索结果字段完整 (title/url/snippet)', !!s0 && !!s0.title && /^https?:\/\//.test(s0.url) && !!s0.snippet)

  /* 2. 非流式: 文本 + 思考字段 */
  console.log('\n[2] 非流式对话 (文本)')
  const chat = await jsonPost('/api/llm/chat', {
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: '只回答两个字母: OK' }],
    search: false,
  })
  ok('非流式对话成功', chat.json.ok === true, JSON.stringify(chat.json).slice(0, 160))
  ok('回复非空', typeof chat.json.reply === 'string' && chat.json.reply.trim().length > 0, JSON.stringify(chat.json.reply).slice(0, 60))
  ok('响应包含 thinking 字段 (思考过程接口)', Object.prototype.hasOwnProperty.call(chat.json, 'thinking'))
  ok('响应包含 sources/executed 字段', Array.isArray(chat.json.sources) && Array.isArray(chat.json.executed))

  /* 3. 图片识别 */
  console.log('\n[3] 图片识别 (视觉模型)')
  const vision = await jsonPost('/api/llm/chat', {
    model: 'deepseek-flash',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '这张图片是什么颜色? 只回答颜色名称' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PNG_RED } },
      ],
    }],
  })
  ok('图片对话成功', vision.json.ok === true, JSON.stringify(vision.json).slice(0, 160))
  const vReply = String(vision.json.reply || '')
  ok('图片内容被识别 (回复提到颜色)', /(红|粉|红粉|玫|珊瑚|red|pink|coral)/i.test(vReply), JSON.stringify(vReply).slice(0, 60))

  /* 4. 工具调用 (假浏览器) */
  console.log('\n[4] 工具调用 (app.* 命令)')
  await startFakeBrowser()
  await sleep(300)
  const tools = await jsonPost('/api/llm/chat', {
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: '请调用 app_status 工具查看应用状态, 然后用一句话回复' }],
  })
  ok('工具调用对话成功', tools.json.ok === true, JSON.stringify(tools.json).slice(0, 160))
  ok('服务端执行了 app.* 工具', (tools.json.executed || []).some((e) => String(e.name).startsWith('app.')), JSON.stringify(tools.json.executed))
  ok('假浏览器收到了命令', handled.some((n) => n.startsWith('app.')), handled.slice(0, 6).join(', '))

  /* 5. SSE 流式: thinking/content/done */
  console.log('\n[5] SSE 流式对话')
  const stream = await readSSE('/api/llm/chat/stream', {
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: '比较 9.11 和 9.9 哪个大? 请一步步推理' }],
    search: false,
  })
  const evTypes = new Set(stream.events.map((e) => e.type))
  ok('流式响应成功', stream.status === 200 && evTypes.has('done'), [...evTypes].join(','))
  ok('收到 content 增量', eventsOf(stream.events, 'content').length > 0, 'deltas=' + eventsOf(stream.events, 'content').length)
  const doneEv = eventsOf(stream.events, 'done')[0] || {}
  ok('done 事件包含完整回复', typeof doneEv.reply === 'string' && doneEv.reply.length > 0)
  ok('流式拼接 = done.reply', joinDeltas(stream.events, 'content').trim() === String(doneEv.reply || '').trim())
  ok('思考过程增量事件', eventsOf(stream.events, 'thinking').length > 0, 'deltas=' + eventsOf(stream.events, 'thinking').length)
  ok('done 包含 thinking', typeof doneEv.thinking === 'string' && doneEv.thinking.length > 0, 'len=' + String(doneEv.thinking || '').length)

  /* 6. 流式联网搜索 (web_search 工具 + sources 事件) */
  console.log('\n[6] 流式联网搜索')
  const searchStream = await readSSE('/api/llm/chat/stream', {
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: '必须联网搜索 "SpeedTree 是什么", 用一句话回答并标注来源编号' }],
    search: true,
  })
  const sDone = eventsOf(searchStream.events, 'done')[0] || {}
  const searchTools = (sDone.executed || []).filter((e) => e.name === 'web_search')
  const sources = sDone.sources || []
  ok('联网搜索对话成功', searchStream.status === 200 && !!sDone.reply, String(sDone.reply || '').slice(0, 100))
  ok('模型调用了 web_search 工具', searchTools.length > 0, 'calls=' + searchTools.length)
  ok('返回联网来源列表', sources.length > 0, 'sources=' + sources.length)
  ok('来源可点击 (url 合法)', sources.every((s) => /^https?:\/\//.test(s.url)))
  ok('发送了 sources 流事件', eventsOf(searchStream.events, 'sources').length > 0)

  /* 汇总 */
  console.log('\n=== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + warn + ' 提醒 ===')
  if (fail) {
    console.log('\n失败项:')
    for (const f of failures) console.log('  - ' + f)
  }
  process.exitCode = fail ? 1 : 0
} finally {
  try { child.kill() } catch (e) { /* ignore */ }
}
