/**
 * Vite 插件: `npm run dev` 时自动拉起本地应用桥 / MCP 服务器
 * ------------------------------------------------------------
 * 目标:
 *   - 普通 `npm run dev` (vite) 也会自动启动 scripts/app-bridge-server.mjs
 *   - 已有一个"兼容版本"的桥在跑时直接复用 (多开 dev / 命令行先用 npm run mcp 都行)
 *   - 发现旧版本桥占用端口时自动结束旧进程再启动 (开发期自愈), 除非 BRIDGE_AUTO_REPLACE=0
 *   - 桥日志写到 .local/app-bridge.log, 终端只打印关键信息
 *
 * 环境变量:
 *   BRIDGE_PORT=5275        桥/MCP 端口 (默认 5275)
 *   BRIDGE_AUTO_START=0     关闭随 dev 自动启动
 *   BRIDGE_AUTO_REPLACE=0   不自动替换旧版本桥 (只提示)
 *
 * 说明: 桥以 detached 方式启动 (dev server 配置热重启时不会丢);
 *       dev 正常退出 (Ctrl+C / SIGTERM) 时插件会结束自己启动的桥; 若被强杀,
 *       残留实例会被下次 dev 检测并复用 (版本不兼容则自动替换)。
 *       单独结束桥: Windows `taskkill /PID <pid> /F`, *nix `kill <pid>` (pid 见 /health)。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const REQUIRED_FEATURES = ['bridge', 'mcp', 'llm.chat.stream', 'llm.models', 'search']
const DEFAULT_PORT = 5275

function healthUrl(port) { return `http://127.0.0.1:${port}/health` }
async function getHealth(port, timeoutMs = 900) {
  try {
    const res = await fetch(healthUrl(port), { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    const json = await res.json().catch(() => ({}))
    return res.ok && json.ok ? json : null
  } catch (e) {
    return null
  }
}
function isCompatible(h) {
  return !!(h && Array.isArray(h.features) && REQUIRED_FEATURES.every((f) => h.features.includes(f)))
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }
async function waitHealth(port, timeoutMs = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const h = await getHealth(port)
    if (h) return h
    await wait(150)
  }
  return null
}
async function waitGone(port, timeoutMs = 2500) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (!(await getHealth(port, 400))) return true
    await wait(120)
  }
  return false
}

/**
 * @param {{root?:string, port?:number, logRelativePath?:string}} [options]
 * @returns {import('vite').Plugin}
 */
export function appBridgePlugin(options = {}) {
  const root = options.root || process.cwd()
  const port = Number(options.port || process.env.BRIDGE_PORT || DEFAULT_PORT)
  const logRel = options.logRelativePath || path.join('.local', 'app-bridge.log')
  const logPath = path.resolve(root, logRel)
  let spawned = null
  let shutdownHooked = false

  function stopSpawned() {
    if (!spawned || spawned.killed) return
    try { spawned.kill() } catch (e) { /* ignore */ }
    spawned = null
  }
  function hookShutdown(server, logger) {
    if (shutdownHooked) return
    shutdownHooked = true
    const cleanup = () => {
      // 只结束本插件启动的桥; 复用的外部实例不动 (可能是另一个 dev / 手动 npm run mcp)
      if (!spawned) return
      logger.info('[app-bridge] dev server 退出, 结束随 dev 启动的应用桥')
      stopSpawned()
    }
    server.httpServer?.once('close', cleanup)
    process.once('exit', () => { if (spawned) { try { spawned.kill() } catch (e) { /* ignore */ } } })
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.once(sig, () => { cleanup(); process.exit(0) })
    }
  }
  function spawnBridge(logger) {
    try { fs.mkdirSync(path.dirname(logPath), { recursive: true }) } catch (e) { /* ignore */ }
    // 日志超过 4MB 时轮转一次, 避免长期开发无限增长
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 4 * 1024 * 1024) {
        fs.writeFileSync(logPath, '')
        fs.appendFileSync(logPath, `[app-bridge] ${new Date().toISOString()} 日志超过 4MB, 已清空\n`)
      }
    } catch (e) { /* ignore */ }
    let stdio = 'ignore'
    let logFd = null
    try {
      logFd = fs.openSync(logPath, 'a')
      stdio = ['ignore', logFd, logFd]
    } catch (e) { stdio = 'ignore' }
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'app-bridge-server.mjs'), `--port=${port}`], {
      cwd: root,
      env: { ...process.env, BRIDGE_PORT: String(port) },
      stdio,
      windowsHide: true,
      detached: true,
    })
    if (logFd !== null) { try { fs.closeSync(logFd) } catch (e) { /* ignore */ } }
    child.on('error', (err) => logger.error(`[app-bridge] 启动失败: ${err.message}`))
    child.on('exit', (code, signal) => {
      if (spawned === child) {
        spawned = null
        logger.warn(`[app-bridge] 应用桥进程退出 (code=${code}, signal=${signal}), 日志: ${logRel}`)
      }
    })
    child.unref()
    spawned = child
    logger.info(`[app-bridge] 正在随 dev 启动应用桥/MCP (端口 ${port}, 日志 ${logRel})`)
    return child
  }

  return {
    name: 'fasttree-app-bridge',
    apply: 'serve',
    async configureServer(server) {
      const logger = server.config.logger
      const autoStart = !['0', 'false', 'off'].includes(String(process.env.BRIDGE_AUTO_START || '').toLowerCase())
      const autoReplace = !['0', 'false', 'off'].includes(String(process.env.BRIDGE_AUTO_REPLACE || '').toLowerCase())
      if (!autoStart) {
        logger.info('[app-bridge] BRIDGE_AUTO_START=0, 跳过自动启动 (可单独 npm run mcp)')
        return
      }
      const existing = await getHealth(port)
      if (existing) {
        if (isCompatible(existing)) {
          logger.info(`[app-bridge] 检测到兼容的应用桥/MCP, 直接复用: http://127.0.0.1:${port} (pid ${existing.pid || '?'}, v${existing.version || '?'})`)
          hookShutdown(server, logger)
          return
        }
        // 旧版本占用端口: 自动替换 (否则新功能/新接口不会生效)
        const old = `该端口已有旧版本桥 (pid ${existing.pid || '未知'}, v${existing.version || '未知'}, 缺少 ${REQUIRED_FEATURES.filter((f) => !(existing.features || []).includes(f)).join('/')})`
        if (autoReplace && Number.isFinite(Number(existing.pid)) && Number(existing.pid) > 0) {
          logger.warn(`[app-bridge] ${old}, 自动结束旧进程后启动新版本…`)
          try { process.kill(Number(existing.pid), 'SIGTERM') } catch (e) { /* ignore */ }
          if (!(await waitGone(port, 2500))) {
            try { process.kill(Number(existing.pid), 'SIGKILL') } catch (e) { /* ignore */ }
            await waitGone(port, 1200)
          }
        } else {
          logger.error(`[app-bridge] ${old}`)
          logger.error(`[app-bridge] 请先结束旧进程再启动 dev (Windows: taskkill /PID ${existing.pid || '<pid>'} /F; 或设置 BRIDGE_AUTO_REPLACE=1 自动替换)`)
          return
        }
      }
      spawnBridge(logger)
      hookShutdown(server, logger)
      const ready = await waitHealth(port)
      if (ready && isCompatible(ready)) {
        logger.info(`[app-bridge] 应用桥/MCP 已就绪: http://127.0.0.1:${port}  · MCP 端点 /mcp  · pid ${ready.pid || '?'}`)
        logger.info(`[app-bridge] 大模型对话接口: /api/llm/chat/stream  · 联网搜索: /api/search  · 日志: ${logRel}`)
      } else {
        logger.error(`[app-bridge] 启动后 8s 内未就绪 (端口 ${port}); 可能端口被占用, 详见日志: ${logRel}`)
      }
    },
  }
}

export default appBridgePlugin
