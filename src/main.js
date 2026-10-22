/**
 * 应用入口 (index.html 唯一加载的脚本)
 * ------------------------------------------------------------
 * 作用: 组装 Vue 应用并挂载到 `#app` —— 执行到这里, UI 与 Three.js 管线才真正启动。
 * 输入 / 输出: 无入参、无返回值; 副作用 = 替换 `#app` 内容 + 初始化全局响应式状态。
 * 与其他模块的关系:
 *   main.js -> App.vue -> 各参数面板 + Viewport.vue(场景/材质/拾取)
 *                     -> store/treeStore.js (真正的全局状态, 模块求值时即创建)
 *   注意 treeStore.js 一被 import 就已经建立了 `state.params`(= oak / 成熟 / 夏季),
 *   所以下面的 `randomizeFoliageAssets()` 必须排在 createApp 之前 ——
 *   否则首帧可能先按"未选卡片"的默认贴图生成一次树叶, 再被随机结果覆盖 (视觉上闪一下)。
 * 关键约定: `./style.css` 是全局样式, 必须早于挂载被 import, 否则首帧是无样式内容。
 */
import { createApp } from 'vue'
import App from './App.vue'
import { randomizeFoliageAssets } from './store/treeStore.js'
import './style.css'

// 首屏立刻按默认种子挑一套叶片/花朵素材:
// 同步部分先定下贴图与宽高比; 函数内部还有一段异步"探测卡片是否真实存在"的校正,
// 会在图片加载完成后把 404 的卡片换成可用卡片 (失败则退回程序化叶形)。
randomizeFoliageAssets()
// 创建 Vue 根实例并挂载到 index.html 里 id="app" 的节点上
createApp(App).mount('#app')
