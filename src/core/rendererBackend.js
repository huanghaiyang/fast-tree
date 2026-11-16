/**
 * 渲染后端工厂 (WebGPU 优先, WebGL 回退)
 * ------------------------------------------------------------
 * 作用: 把"用哪种 renderer"这件事从 TreeScene 里拆出来, 统一在这里做三件事:
 *       ① 尝试创建 WebGPURenderer (three/webgpu), 失败/不可用时回退经典 WebGLRenderer;
 *       ② 给两种渲染器套同一套输出设置 (色彩空间/色调映射/阴影/像素比),
 *          保证换后端只换"怎么画", 不换"画出来是什么颜色";
 *       ③ 返回一个描述对象, 让场景层知道要不要走 NodeMaterial / Node 渲染路径。
 *
 * 为什么是 async: WebGPURenderer 必须 `await renderer.init()` 之后才能渲染
 * (内部要申请 adapter/device 并编译初始管线)。经典 WebGLRenderer 的构造是同步的,
 * 所以调用方 (Viewport.vue) 在 onMounted 里 await 本函数即可, 不阻塞首屏其他逻辑。
 *
 * three r187 的 WebGPURenderer 在 `navigator.gpu` 缺失或 requestAdapter 失败时
 * **会自行回退到 WebGL 2 后端**; 此时 renderer 仍然是 WebGPURenderer 实例
 * (isNodeRenderer=true, 需要 NodeMaterial), 只是底层用 WebGL 2 执行。
 * 因此这里区分三个概念:
 *   isNodeRenderer —— 是否是 WebGPURenderer 实例 (决定材质体系: NodeMaterial)
 *   isWebGPU       —— 底层是否真的跑在 WebGPU 上 (决定能力提示: 后处理/读回)
 *   backendName    —— 给人看的名字, 显示在状态栏 / 面板提示里
 *
 * 已知能力边界 (WebGPU 路径):
 *   - ShaderMaterial / onBeforeCompile 不可用 -> 树材质走 materialsGPU.js 的 TSL 版本;
 *   - EffectComposer 是 WebGL 专用 -> Bloom/DOF 暂时跳过 (UI 会提示);
 *   - 伪装卡生成依赖 WebGL 的 readRenderTargetPixels -> WebGPU 下暂不可用。
 */

import * as THREE from 'three'

/**
 * 给任意 renderer 套统一输出设置。可重复调用 (幂等)。
 *
 * @param {import('three').WebGLRenderer|import('three/webgpu').WebGPURenderer} renderer
 */
export function applyRendererSettings(renderer) {
  // 像素比封顶 2: 4K/5K 屏上 devicePixelRatio 可达 3, 再乘上百万级三角面
  // 会直接把填充率压死; 2 是清晰度与帧率的折中点。
  renderer.setPixelRatio(Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // ACES 电影级色调映射: 高光滚降柔和, 树皮/树叶的暖色调不会一晒就爆白。
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  // 1.18 是补偿 ACES 整体压暗的曝光系数 (1.0 时画面偏灰)。
  renderer.toneMappingExposure = 1.18
  if (renderer.shadowMap) {
    renderer.shadowMap.enabled = true
    // PCF 阴影: 比 BasicShadowMap 软、比 VSM 便宜且无漏光, 适合大量细碎树叶。
    renderer.shadowMap.type = THREE.PCFShadowMap
  }
}

/**
 * 创建渲染器。auto = 先试 WebGPU, 不可用再回退。
 *
 * @param {{mode?: 'auto'|'webgpu'|'webgl'}} [opts]
 * @returns {Promise<{renderer: Object, isNodeRenderer: boolean, isWebGPU: boolean,
 *   backendName: string}>}
 *   isNodeRenderer=true 时调用方必须使用 NodeMaterial (materialsGPU.js),
 *   并且不能用 EffectComposer / ShaderMaterial / customDepthMaterial。
 */
export async function createRenderer(opts = {}) {
  const mode = opts.mode === 'webgl' ? 'webgl' : opts.mode === 'webgpu' ? 'webgpu' : 'auto'

  if (mode !== 'webgl') {
    try {
      // 动态 import: three/webgpu 体积很大, 只在真的需要时才加载 (Vite 会单独切块)。
      const { WebGPURenderer } = await import('three/webgpu')
      const renderer = new WebGPURenderer({
        antialias: true,
        alpha: false,
        // 独显优先; 集成显卡也能跑, 只是高多边形的树会掉帧。
        powerPreference: 'high-performance',
      })
      // 必须等到 device 就绪; 失败会 reject (下面 catch 后改用经典 WebGL)。
      await renderer.init()
      const isWebGPU = !!(renderer.backend && renderer.backend.isWebGPUBackend)
      applyRendererSettings(renderer)
      return {
        renderer,
        isNodeRenderer: true,
        isWebGPU,
        backendName: isWebGPU ? 'WebGPU' : 'WebGL 2 (Node)',
      }
    } catch (err) {
      // 不用 throw: WebGPU 只是"更快的那条路", 失败必须能继续用 WebGL 看树。
      console.warn('[fast-tree] WebGPU 初始化失败, 回退到经典 WebGL 渲染器:', err)
    }
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    // 保留绘制缓冲: canvas.toDataURL / 导出 PNG 需要读到上一帧的像素,
    // 关掉它(默认)会在合成后被清空, 截图就只剩黑底。
    preserveDrawingBuffer: true,
    // 提示浏览器优先选独显; 集成显卡也能跑, 只是高多边形的树会掉帧。
    powerPreference: 'high-performance',
  })
  applyRendererSettings(renderer)
  return {
    renderer,
    isNodeRenderer: false,
    isWebGPU: false,
    backendName: 'WebGL',
  }
}
