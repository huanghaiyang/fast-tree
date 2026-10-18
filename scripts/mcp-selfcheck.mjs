/**
 * MCP 自检 (node scripts/mcp-selfcheck.mjs)
 * ------------------------------------------------------------
 * 检查 5 项:
 *   1. 桥服务器 /health
 *   2. MCP initialize
 *   3. MCP tools/list 与命令注册表一致
 *   4. 浏览器桥是否已连接 (应用是否打开)
 *   5. 真实调用一个工具 (app.selfcheck / app.status) 并校验返回
 * 退出码: 0 全通过 / 1 有失败
 */
const PORT = Number(process.env.BRIDGE_PORT || 5275)
const BASE = `http://127.0.0.1:${PORT}`
const results = []
const add = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

async function jget(path) {
  const r = await fetch(BASE + path)
  return { status: r.status, json: await r.json().catch(() => null) }
}
async function jpost(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, json: await r.json().catch(() => null) }
}

async function mcp(method, params) {
  const r = await jpost('/mcp', { jsonrpc: '2.0', id: 1, method, params })
  return r.json
}

const main = async () => {
  // 1. health
  try {
    const h = await jget('/health')
    add('桥服务器可访问', h.status === 200 && h.json?.ok, `${BASE} (port ${PORT})`)
  } catch (e) {
    add('桥服务器可访问', false, String(e.message) + ' — 先运行 npm run mcp 或 npm run dev')
    return finish()
  }
  // 2. initialize
  try {
    const init = await mcp('initialize', {})
    add('MCP initialize', !!init?.result?.serverInfo, init?.result?.serverInfo?.name || '')
  } catch (e) {
    add('MCP initialize', false, e.message)
  }
  // 3. tools/list
  let toolNames = []
  try {
    const list = await mcp('tools/list', {})
    toolNames = (list?.result?.tools || []).map((t) => t.name)
    const reg = await jget('/api/tools')
    const cmdNames = (reg.json?.tools || []).map((c) => c.name.replace(/\./g, '_'))
    const same = toolNames.length === cmdNames.length && toolNames.every((n) => cmdNames.includes(n))
    add('MCP tools/list 与注册表一致', toolNames.length > 0 && same, `${toolNames.length} 个工具`)
  } catch (e) {
    add('MCP tools/list', false, e.message)
  }
  // 4. 浏览器连接
  let browser = false
  try {
    const sc = await jget('/api/selfcheck')
    browser = !!sc.json?.checks?.find((c) => c.name === '浏览器已连接')?.ok
    add('浏览器桥已连接', browser, browser ? '' : '请在浏览器打开应用 (它会自动连桥)')
  } catch (e) {
    add('浏览器桥已连接', false, e.message)
  }
  // 5. 真实调用工具
  if (browser) {
    try {
      const call = await mcp('tools/call', { name: 'app_status', arguments: {} })
      const text = call?.result?.content?.[0]?.text || ''
      const parsed = JSON.parse(text || '{}')
      add('真实调用 app.status', parsed.ok === true && !!parsed.data, `叶=${parsed.data?.leaves} 花=${parsed.data?.flowers} 三角=${parsed.data?.triangles}`)
      const chk = await mcp('tools/call', { name: 'app_selfcheck', arguments: {} })
      const chkData = JSON.parse(chk?.result?.content?.[0]?.text || '{}')
      add('真实调用 app.selfcheck', chkData.ok === true && chkData.data?.shaderErrors === 0, `着色器错误=${chkData.data?.shaderErrors}`)
    } catch (e) {
      add('真实调用工具', false, e.message)
    }
  } else {
    add('真实调用工具', false, '跳过 (浏览器未连接)')
  }
  // 6. 命令处理器一致性 (服务端声明的命令, 浏览器侧必须都实现)
  if (browser) {
    try {
      const help = await mcp('tools/call', { name: 'app_help', arguments: {} })
      const j = JSON.parse(help?.result?.content?.[0]?.text || '{}')
      const implemented = (j.data && j.data.commands) || []
      const reg = await jget('/api/tools')
      const toolToCmd = new Map((reg.json?.tools || []).map((c) => [c.name.replace(/\./g, '_'), c.name]))
      const tools = toolNames.map((n) => toolToCmd.get(n) || n)
      const missing = tools.filter((n) => !implemented.includes(n))
      add('命令处理器一致性', implemented.length > 0 && missing.length === 0,
        missing.length ? '缺少实现: ' + missing.join(', ') : implemented.length + ' 个命令均已实现')
    } catch (e) { add('命令处理器一致性', false, e.message) }
  }
  // 7. 冒烟: 抽查各类命令
  if (browser) {
    const smoke = [
      ['app_list_species', {}],
      ['app_list_leaf_cards', { batch: 'fl_batch1', limit: 3 }],
      ['app_list_bark_textures', { batch: 'batch3' }],
      ['app_node_tree', { limit: 3 }],
      ['app_set_wind', { strength: 0.6 }],
      ['app_toggle', { target: 'flower', value: true }],
      ['app_rebuild', {}],
    ]
    for (const [name, args] of smoke) {
      const r = await mcp('tools/call', { name, arguments: args })
      const j = JSON.parse(r?.result?.content?.[0]?.text || '{}')
      add('冒烟 ' + name, j.ok === true, j.ok ? '' : (j.error || ''))
    }
  }
  // 大模型 Key (只在服务端; 不打印 Key 本身)
  try {
    const sc = await jget('/api/selfcheck')
    const llm = sc.json?.llm || {}
    add('大模型配置 (服务端)', llm.hasKey === true, `${llm.provider}/${llm.model}${llm.hasKey ? ' Key=已配置(不下发浏览器)' : ' 未配置'}`)
  } catch (e) {
    add('大模型配置', false, e.message)
  }
  finish()
}

function finish() {
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n=== MCP 自检: ${results.length - failed} 通过 / ${failed} 失败 ===`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('自检异常:', e)
  process.exit(1)
})
