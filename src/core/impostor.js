import * as THREE from 'three'

/**
 * 伪装卡生成器 (Impostor / Cross-card)
 * ------------------------------------------------------------
 * A. 图集伪装卡 (atlas): 把整棵树从 N 个水平视角 × M 个仰角渲染成图集,
 *    远景时用一张带 alpha 的贴图替代 3D 树 (SpeedTree 的 Impostor 思路)。
 * B. 交叉卡 (cross card): 渲染一张侧视贴图, 生成 2/3 张交叉四边形,
 *    用于中远景树冠 —— 比图集简单, 侧面看有厚度感。
 *
 * 实现: 离屏 WebGLRenderTarget + readRenderTargetPixels -> 拼到 canvas -> PNG。
 *      RT 纹理设为 sRGB, 这样取回的就是显示值 (不用手动 gamma)。
 */

/** 视角角度列表 (水平, 度) */
export function viewAngles(count) {
  const n = Math.max(1, Math.round(count || 8))
  const out = []
  for (let i = 0; i < n; i++) out.push(Math.round((360 / n) * i))
  return out
}

/** 俯仰层 -> 仰角列表 (度, 0=水平, 90=正俯视) */
export function elevationAngles(count) {
  const n = Math.max(1, Math.min(5, Math.round(count || 1)))
  if (n === 1) return [0]
  if (n === 2) return [0, 90]        // 水平 + 正俯视 (最常用: 从上往下看)
  if (n === 3) return [0, 45, 90]
  if (n === 4) return [0, 30, 60, 90]
  return [0, 22.5, 45, 67.5, 90].map((v) => Math.round(v))
}

/** 图集排版: 视图数 -> {cols, rows} (尽量接近正方形) */
export function atlasLayout(count) {
  const n = Math.max(1, Math.round(count || 8))
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return { cols, rows }
}

/** 交叉卡的四边形布局 (角度, 宽, 高) —— 用于生成网格 */
export function crossCardQuads(count) {
  const n = Math.max(1, Math.min(20, Math.round(count || 2)))
  const out = []
  for (let i = 0; i < n; i++) out.push({ angle: Math.round((180 / n) * i), width: 1, height: 1 })
  return out
}

/** 统计 alpha 覆盖率 (0~1), 用于判断渲染是否真的抓到树 */
export function alphaCoverage(pixels, w, h) {
  let hit = 0
  for (let i = 3; i < w * h * 4; i += 4) if (pixels[i] > 24) hit++
  return hit / (w * h)
}

/** 把 WebGL 的像素 (自下而上) 转成 canvas 可用的 ImageData (自上而下) */
function pixelsToImageData(pixels, w, h) {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4
    out.set(pixels.subarray(src, src + w * 4), y * w * 4)
  }
  return new ImageData(out, w, h)
}

/**
 * 渲染单个视角到像素
 * @returns {{pixels: Uint8Array, size: number}}
 */
function renderView(renderer, scene, camera, size) {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
  })
  rt.texture.colorSpace = THREE.SRGBColorSpace
  const pixels = new Uint8Array(size * size * 4)
  const prevTarget = renderer.getRenderTarget()
  const prevClear = new THREE.Color()
  renderer.getClearColor(prevClear)
  const prevAlpha = renderer.getClearAlpha()
  // 必须保存/还原视口与裁剪状态: 否则生成完主画布只渲染在左下角一个小方块里
  const prevViewport = renderer.getViewport(new THREE.Vector4())
  const prevScissor = renderer.getScissor(new THREE.Vector4())
  const prevScissorTest = renderer.getScissorTest()
  const prevRatio = renderer.getPixelRatio()
  try {
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, size, size)
    renderer.setPixelRatio(1)
    renderer.setRenderTarget(rt)
    renderer.setClearColor(0x000000, 0)
    // 明确全清 (颜色+深度+模板) 并保证 autoClear, 否则多视角会互相叠加
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = true
    renderer.clear(true, true, true)
    renderer.render(scene, camera)
    renderer.autoClear = prevAutoClear
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels)
  } finally {
    renderer.setRenderTarget(prevTarget)
    renderer.setClearColor(prevClear, prevAlpha)
    renderer.setViewport(prevViewport)
    renderer.setScissor(prevScissor)
    renderer.setScissorTest(prevScissorTest)
    renderer.setPixelRatio(prevRatio)
    rt.dispose()
  }
  return pixels
}

/**
 * 生成伪装卡
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {{min:{x,y,z},max:{x,y,z}}} o.bbox 树的包围盒 (世界坐标)
 * @param {'atlas'|'cross'} o.mode
 * @param {number} o.views 图集视角数 / 交叉卡张数
 * @param {number} o.size 单视角分辨率
 * @param {THREE.Object3D[]} o.hide 渲染时要隐藏的场景装饰 (地面/网格/天空/落叶等)
 * @returns {{dataUrl:string, width:number, height:number, coverage:number, meta:object}}
 */
export function generateImpostor(o) {
  if (typeof document === 'undefined') throw new Error('伪装卡生成需要浏览器环境')
  const { renderer, scene, bbox } = o
  const mode = o.mode === 'cross' ? 'cross' : 'atlas'
  const size = Math.max(64, Math.min(2048, Math.round(o.size || 512)))
  const count = Math.max(1, Math.round(o.views || (mode === 'cross' ? 2 : 8)))

  const center = new THREE.Vector3(
    (bbox.min.x + bbox.max.x) / 2,
    (bbox.min.y + bbox.max.y) / 2,
    (bbox.min.z + bbox.max.z) / 2,
  )
  const radius = Math.max(
    0.5,
    0.5 * Math.hypot(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z),
  )
  // 用窄 FOV + 远距离近似正交, 减少视角间透视差异 (impostor 的标准做法)
  const fov = 18
  const dist = (radius / Math.tan((fov * Math.PI) / 360)) * 1.06 + radius * 0.15
  const cam = new THREE.PerspectiveCamera(fov, 1, Math.max(0.05, radius * 0.02), dist + radius * 4)
  cam.up.set(0, 1, 0)

  // 隐藏场景装饰 + 清掉场景背景 (否则离屏渲染出来的背景是不透明的, 卡片就成了矩形)
  const restore = []
  for (const obj of o.hide || []) if (obj) { restore.push([obj, obj.visible]); obj.visible = false }
  const prevBg = scene.background
  scene.background = null
  // ---- 拍摄用全 360 光照: 环境 + 半球 + 6 向平行光, 保证任何角度都不背光发黑 ----
  const captureLights = []
  const prevExposure = renderer.toneMappingExposure
  const addLight = (L) => { captureLights.push(L); scene.add(L) }
  addLight(new THREE.AmbientLight(0xffffff, 0.85))
  addLight(new THREE.HemisphereLight(0xdce9ff, 0x4a3d2e, 0.9))
  const dirs = [
    [1, 0.6, 0], [-1, 0.6, 0], [0, 0.6, 1], [0, 0.6, -1], [0, 1, 0], [0, -0.7, 0],
  ]
  for (const d of dirs) {
    const L = new THREE.DirectionalLight(0xffffff, 1.15)
    L.position.set(d[0] * 20, d[1] * 20, d[2] * 20)
    addLight(L)
  }
  renderer.toneMappingExposure = Math.max(prevExposure, 1.15)
  const horiz = mode === 'cross' ? crossCardQuads(count).map((q) => q.angle) : viewAngles(count)
  const elevs = mode === 'cross' ? [0] : elevationAngles(o.elevations === undefined ? 1 : o.elevations)
  const views = []
  let totalCoverage = 0
  try {
    for (const el of elevs) {
      for (const ang of horiz) {
        const arad = (ang * Math.PI) / 180
        const erad = (el * Math.PI) / 180
        cam.position.set(
          center.x + Math.sin(arad) * Math.cos(erad) * dist,
          center.y + Math.sin(erad) * dist,
          center.z + Math.cos(arad) * Math.cos(erad) * dist,
        )
        // 关键: 正俯视/正仰视时视线与 up(0,1,0) 平行 -> lookAt 退化(画面变乱),
        // 这时把 up 换成水平方向, 保持旋转确定
        if (Math.abs(el) > 89.5) cam.up.set(0, 0, -1)
        else cam.up.set(0, 1, 0)
        cam.lookAt(center)
        cam.updateMatrixWorld()
        const px = renderView(renderer, scene, cam, size)
        totalCoverage += alphaCoverage(px, size, size)
        const cv = document.createElement('canvas')
        cv.width = size
        cv.height = size
        cv.getContext('2d').putImageData(pixelsToImageData(px, size, size), 0, 0)
        views.push({ angle: ang, elevation: el, canvas: cv })
      }
    }
  } finally {
    for (const [obj, v] of restore) obj.visible = v
    for (const L of captureLights) scene.remove(L)
    renderer.toneMappingExposure = prevExposure
    scene.background = prevBg
    renderer.setRenderTarget(null)
  }

  const coverage = totalCoverage / Math.max(1, views.length)
  const layout = mode === 'cross'
    ? { cols: 1, rows: views.length }
    : { cols: horiz.length, rows: elevs.length }
  const out = document.createElement('canvas')
  out.width = size * layout.cols
  out.height = size * layout.rows
  const ctx = out.getContext('2d')
  views.forEach((v, i) => {
    const cx = (i % layout.cols) * size
    const cy = Math.floor(i / layout.cols) * size
    ctx.drawImage(v.canvas, cx, cy)
  })

  return {
    dataUrl: out.toDataURL('image/png'),
    width: out.width,
    height: out.height,
    coverage,
    meta: {
      mode,
      size,
      views: views.length,
      cols: horiz.length,
      rows: elevs.length,
      angles: horiz,
      elevations: elevs,
      layout,
      fov,
      distance: +dist.toFixed(3),
      center: [center.x, center.y, center.z].map((v) => +v.toFixed(3)),
      radius: +radius.toFixed(3),
      coverage: +coverage.toFixed(4),
      generatedAt: new Date().toISOString(),
    },
  }
}
