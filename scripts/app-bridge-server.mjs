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
 *   POST /api/llm/chat         大模型对话代理 (在服务端拼 Key, 带 tool-calling)
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

/* ---------------- 大模型代理 (DeepSeek OpenAI 兼容) ---------------- */
const LLM_SYSTEM = `你是"快速树生成工具"的助手。用户用中文描述需求, 你要调用工具修改应用。
规则:
- 只能通过给定工具操作应用, 不要臆造命令
- 改参数用 app.set_params, 换树用 app.apply_preset, 开关用 app.toggle
- 修改后一般要 app.rebuild 让改动生效
- 回复用简短中文, 说明你做了什么`
async function llmChat(body) {
  if (!llm.apiKey) return { ok: false, error: '服务端未配置大模型 Key' }
  const messages = [
    { role: 'system', content: LLM_SYSTEM },
    ...(Array.isArray(body.messages) ? body.messages : [{ role: 'user', content: String(body.message || '') }]),
  ]
  const tools = COMMANDS.map((c) => ({
    type: 'function',
    function: {
      name: c.name.replace(/\./g, '_'),
      description: c.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(c.params || {}).map(([k, s]) => [k, { type: s.type, description: s.description || '' }])),
        required: Object.entries(c.params || {}).filter(([, s]) => s.required).map(([k]) => k),
      },
    },
  }))
  const url = `${llm.baseUrl.replace(/\/$/, '')}/chat/completions`
  const payload = { model: body.model || llm.model, messages, tools, tool_choice: 'auto', temperature: 0.3 }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + llm.apiKey },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: `大模型接口错误 ${res.status}: ${JSON.stringify(json).slice(0, 300)}` }
  const msg = json.choices?.[0]?.message || {}
  const calls = (msg.tool_calls || []).map((tc) => ({
    name: fromToolName(tc.function.name),
    args: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })(),
  }))
  // 服务端直接执行工具调用 (浏览器桥), 再把结果回给模型做二次总结
  const executed = []
  for (const call of calls) executed.push({ call, result: await callBrowser(call.name, call.args) })
  let reply = msg.content || ''
  if (executed.length) {
    const followup = [
      ...messages,
      msg,
      ...executed.map((e) => ({ role: 'tool', tool_call_id: e.call.name, content: JSON.stringify(e.result) })),
    ]
    try {
      const res2 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + llm.apiKey },
        body: JSON.stringify({ model: payload.model, messages: followup, temperature: 0.3 }),
      })
      const j2 = await res2.json().catch(() => ({}))
      if (j2.choices?.[0]?.message?.content) reply = j2.choices[0].message.content
    } catch (e) { /* 保留第一段回复 */ }
  }
  return { ok: true, reply: reply || '(已执行)', executed: executed.map((e) => ({ name: e.call.name, ok: e.result.ok })), model: payload.model }
}

/* ---------------- HTTP ---------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => { buf += c; if (buf.length > 4e6) req.destroy() })
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}) } catch { resolve({}) } })
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
    if (route === '/api/call' && req.method === 'POST') {
      const body = await readBody(req)
      const r = await callBrowser(body.name, body.args || {})
      return json(res, 200, r)
    }
    if (route === '/health') return json(res, 200, { ok: true, port: PORT })
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
