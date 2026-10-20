import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { appBridgePlugin } from './scripts/vite-plugin-app-bridge.mjs'

// 项目根目录 + 桥端口 (BRIDGE_PORT 同时下发给浏览器端, 保证前后端端口一致)
const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const bridgePort = Number(process.env.BRIDGE_PORT || 5275)

export default defineConfig({
  // dev 时自动拉起本地应用桥 / MCP / 大模型代理 (复用或替换本机已有实例)
  plugins: [vue(), appBridgePlugin({ root: projectRoot, port: bridgePort })],
  define: {
    __APP_BRIDGE_PORT__: JSON.stringify(bridgePort),
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: false,
    // `npm run check` 会在 dev server 运行时执行生产构建并写 dist/。
    // 不忽略 dist 会触发 HMR 整页刷新, 让刚连接的 MCP 浏览器桥断开。
    watch: { ignored: ['**/dist/**', '**/.tmp-*'] },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
})
