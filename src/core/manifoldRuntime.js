/**
 * Manifold 严格流形运行时
 * ------------------------------------------------------------
 * manifold-3d 是 WASM，必须异步初始化。应用启动时会预加载；
 * 如果用户切到「严格流形」模式时还没加载完，先按普通几何显示，
 * 加载完成后再触发一次重建。
 *
 * 浏览器里需要显式把 wasm 作为 Vite 资源 URL 传给 locateFile，
 * 否则 emscripten 会按 import.meta.url 去找一个不存在的路径。
 */
let api = null
let promise = null

export function getManifoldApi() {
  return api
}

export function manifoldReady() {
  return !!api
}

export function ensureManifold() {
  if (api) return Promise.resolve(api)
  if (promise) return promise
  promise = (async () => {
    const mod = await import('manifold-3d')
    let options
    if (typeof window !== 'undefined') {
      try {
        const urlMod = await import('manifold-3d/manifold.wasm?url')
        options = { locateFile: () => urlMod.default }
      } catch {
        // 回退：让 emscripten 自己按 import.meta.url 找
      }
    }
    const wasm = await mod.default(options)
    wasm.setup()
    api = wasm
    return api
  })().catch((err) => {
    promise = null
    throw err
  })
  return promise
}
