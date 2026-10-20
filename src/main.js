import { createApp } from 'vue'
import App from './App.vue'
import { randomizeFoliageAssets, state as treeState } from './store/treeStore.js'
import { ensureManifold } from './core/manifoldRuntime.js'
import './style.css'

randomizeFoliageAssets(treeState.params.seed)
// 预加载严格流形用的 WASM, 用户切到该模式时无需再等
ensureManifold().then(() => {
  if (treeState.params.trunk.junctionMode === 'manifold') treeState.rebuildVersion++
}).catch((err) => console.warn('[FastTree] manifold WASM 预加载失败:', err))
createApp(App).mount('#app')
