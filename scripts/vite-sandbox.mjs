/**
 * 沙箱 / CI 兼容的构建入口 (不改动 node_modules)
 * ------------------------------------------------------------
 * Vite 在 Windows 上会用 `exec("net use")` 探测网络驱动器。在没有权限
 * 派生带管道子进程的环境里 (受限沙箱 / 部分 CI), 这一步抛 EPERM。
 *
 * Vite 自己的代码里有一条更早的退路:
 *   try { fs.realpathSync.native(path.resolve("./")) }
 *   catch (e) { if (e.message 含 "EISDIR: illegal operation on a directory")
 *                 return  // 直接用 fs.realpathSync, 跳过 net use
 *             }
 * 我们在加载 vite 之前, 让「对当前工作目录的第一次 native realpath 调用」
 * 抛出这个特定错误, 于是 Vite 走退路, 完全不派生子进程。
 * 其他路径与后续调用保持原生行为。
 *
 * 普通本地环境不需要它, 直接 `npm run dev` / `npm run build` 即可。
 * 用法:
 *   node scripts/vite-sandbox.mjs dev
 *   node scripts/vite-sandbox.mjs build
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = process.cwd()
const origNative = fs.realpathSync.native
let probePending = true

fs.realpathSync.native = function patchedRealpathNative(p, options) {
  if (probePending) {
    let resolved = ''
    try { resolved = path.resolve(String(p)) } catch { resolved = '' }
    if (resolved === cwd) {
      probePending = false
      const err = new Error('EISDIR: illegal operation on a directory, realpath \'' + resolved + '\'')
      err.code = 'EISDIR'
      throw err
    }
  }
  return origNative.call(fs.realpathSync, p, options)
}

const mode = (process.argv[2] || 'dev').toLowerCase()
const vite = await import('vite')

if (mode === 'build') {
  const root = path.dirname(fileURLToPath(new URL('../vite.config.js', import.meta.url)))
  const loaded = await vite.loadConfigFromFile(
    { command: 'build', mode: 'production', isSsrBuild: false, isPreview: false },
    path.join(root, 'vite.config.js'),
  )
  await vite.build({ ...loaded.config, configFile: false, root, logLevel: 'info' })
  console.log('[vite-sandbox] build 完成')
} else {
  const server = await vite.createServer({
    server: { host: '127.0.0.1', port: Number(process.env.PORT || 5273), strictPort: true },
  })
  await server.listen()
  server.printUrls()
}
