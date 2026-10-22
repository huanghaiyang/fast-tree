/**
 * 导出专用的果实材质（GLB 里对应 `Bark_Fruit` 节点 + 独立的 `Fruit` 材质）。
 * ============================================================================
 * 为什么视口里不用这套材质？
 *   视口中果实与树皮共用同一张 bark 材质（靠顶点色区分坚果/壳斗帽），这样渲染
 *   只有 2 个 draw call。但导出时若继续复用 bark 贴图，美术拿到 GLB 后无法单独
 *   调果实 —— 所以导出组会挂一个独立材质，产出完整的四张图：
 *     fruit_diff_1k / fruit_alpha_1k / fruit_nor_gl_1k / fruit_rough_1k
 *
 * 四张图必须**同尺寸 + 同朝向**（由 `textureNaming.ensureExportTextureAlignment`
 * 再兜底校验一次）。这里生成时就统一用 `SIZE`，并且：
 *   - diff / rough：来自同一段随机纹理（rough 由 diff 亮度场推导，天然同朝向）；
 *   - nor / alpha：来自同一张果皮**高度场** `detailPixels`（壳斗帽棱线/鳞片），
 *     所以法线凸起与 alpha 沟槽指向同一处；
 *   - alpha 是"沟槽蒙版"（黑色=沟），不是叶卡那种轮廓镂空 —— 所以它放在
 *     `userData.exportAlphaDataUrl` 里由导出管线直接采用，而不是从 diff 的 alpha
 *     通道反推（果实的 diffuse 是全不透明的）。
 *
 * 颜色说明：果实几何自带 COLOR_0（坚果色/帽色/每实例色差），所以 diffuse 只画
 * **中性果皮细节**（不染色）；最终颜色 = 顶点色 × 这张中性 diffuse，不会丢掉
 * 每颗果实的颜色变化。
 */
import * as THREE from 'three'
import { makeRng } from './rng.js'
import {
  makeNormalTextureFromPixels,
  makeRoughnessTextureFromTexture,
} from './textureNaming.js'

/**
 * 果皮贴图的统一边长。
 * 取 1024：果皮细节（鳞片/棱线/凹坑）在高频处需要足够像素，且 1024 正好命中
 * `_1k` 命名档位，四张图的资源名后缀一致。
 * 改这个值要同步检查 `dev/export-material-check.html` 里的 `fruit_*_1k` 断言。
 */
const SIZE = 1024

/** 建一张离屏 canvas；无 DOM（Node 自检）时返回 null，调用方据此降级 */
// 说明: 所有果皮贴图都在这张 canvas 上画, 再交给 CanvasTexture。
// 调用方必须处理 null —— 自检环境没有 canvas, 返回值会一路传成空贴图。
function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * 生成果皮表面的高对比**高度场**（灰度图），法线与 alpha 都从它派生。
 *
 * 为什么需要单独的"高度场"而不是直接用 diffuse？
 *   - 法线需要的是梯度（凹凸），不是颜色；从高度场求梯度比从彩色图亮度求更干净；
 *   - alpha 需要的是"沟槽在哪里"（黑色=沟），同样来自高度场；
 *   - 两者共用同一张高度场 ⇒ 法线凸起与 alpha 沟槽**必然对齐**。
 *
 * 图案按果实类型区分（`fruit.type`）：
 *   - cone  松果：更多、更小的鳞片 + 更强的横向波纹；
 *   - berry 浆果：小而密的凹坑；
 *   - acorn / nut 橡果：少量凸起 + 壳斗帽的纵向棱线。
 *
 * 随机源为 `makeRng(seed, 'fruit-export-height')`：同一 seed 图案可复现，
 * 所以导出预览与正式导出看到的是同一张果皮。
 *
 * @param {object} fruit state.params.fruit（type 决定图案风格）
 * @param {number} seed  随机种子
 * @returns {Uint8ClampedArray|null} SIZE×SIZE 的 RGBA 像素；无 DOM 时 null
 */
function makeDetailPixels(fruit, seed) {
  const cv = makeCanvas(SIZE, SIZE)
  if (!cv) return null
  const ctx = cv.getContext('2d')
  const rng = makeRng(seed || 1, 'fruit-export-height')
  ctx.fillStyle = 'rgb(128, 128, 128)'
  ctx.fillRect(0, 0, SIZE, SIZE)

  const type = fruit.type || 'acorn'
  // 高频小凸起/凹坑: 法线贴图能看到明确的果皮细节
  // 数量按类型区分: 松果鳞片最多 (5200), 浆果其次 (3200), 橡果/坚果 (3800)
  const count = type === 'cone' ? 5200 : type === 'berry' ? 3200 : 3800
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, SIZE)
    const y = rng.range(0, SIZE)
    // 半径: 松果鳞片更大 (上限 8px), 其余 5px; 下限 0.8px 防止小到被 mipmap 抹平
    const r = rng.range(0.8, type === 'cone' ? 8 : 5)
    // 一半画暗坑 (40..100)、一半画亮凸 (170..235): 两极分化 -> 高度梯度更强, 法线更明显
    const v = rng.chance(0.5) ? rng.range(40, 100) : rng.range(170, 235)
    // globalAlpha 随机 0.35..0.9: 斑点深浅不一, 避免看起来像规则点阵
    ctx.globalAlpha = rng.range(0.35, 0.9)
    ctx.fillStyle = `rgb(${v}, ${v}, ${v})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 松果鳞片 / 橡果帽的交叉纹理
  // step = 横纹的行距 (像素): 松果 46 更密, 其它 74 更疏; 线宽同理 (5 / 3)。
  // x += 8 是采样步长, 配合 sin(x*0.025)*9 让每条横线轻微起伏, 避免机械的直线感。
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = '#3c3c3c'
  ctx.lineWidth = type === 'cone' ? 5 : 3
  const step = type === 'cone' ? 46 : 74
  for (let y = 20; y < SIZE; y += step) {
    ctx.beginPath()
    // y+20 起画: 避开贴图上边缘, 否则平铺时顶部会出现半条线
    for (let x = 0; x <= SIZE; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.025) * 9)
    ctx.stroke()
  }
  if (type === 'acorn' || type === 'nut') {
    // 帽沿的纵向棱
    // 每 58px 一条, 并向右倾斜 16px (从 (x,0) 到 (x+16,SIZE)) -> 呈放射状而非完全垂直,
    // 更像壳斗帽上一圈圈叠起来的鳞片棱。
    for (let x = 0; x < SIZE; x += 58) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + 16, SIZE)
      ctx.stroke()
    }
  }

  // 大面积深浅斑块
  for (let i = 0; i < 30; i++) {
    ctx.globalAlpha = rng.range(0.1, 0.25)
    ctx.fillStyle = rng.chance(0.5) ? '#5a5a5a' : '#d8d8d8'
    ctx.beginPath()
    ctx.arc(rng.range(0, SIZE), rng.range(0, SIZE), rng.range(20, 80), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  return ctx.getImageData(0, 0, SIZE, SIZE).data
}

/**
 * 生成中性果皮 diffuse（不染色，颜色由顶点色 COLOR_0 乘出来）。
 *
 * 注意：
 *   - 底色刻意选很亮的 `#e8ddc8`：最终颜色 = 顶点色 × 这张图，底色越接近白，
 *     顶点色还原得越准（避免和 COLOR_0 双重染色导致果实发暗）；
 *   - 图案与高度场**不是**同一段随机序列（`fruit-export-tex` vs
 *     `fruit-export-height`），所以 rough 的图案与 nor/alpha 的图案本就不同；
 *     这不影响"方向/尺寸一致"（四张图仍同尺寸同朝向），只是它们的细节描述
 *     不是同一个物理表面 —— 果皮纹理比较均匀，肉眼看不出冲突；
 *   - 这里不写 alpha（恒为不透明），叶卡那种镂空 alpha 不适用于果实。
 *
 * @param {object} fruit state.params.fruit（capColor/color/type）
 * @param {number} seed  随机种子
 * @returns {THREE.CanvasTexture|null} sRGB 颜色贴图（flipY 用 CanvasTexture 默认 true）
 */
function makeDiffuseTexture(fruit, seed) {
  const cv = makeCanvas(SIZE, SIZE)
  if (!cv) return null
  const ctx = cv.getContext('2d')
  const rng = makeRng(seed || 1, 'fruit-export-tex')
  const cap = new THREE.Color(fruit.capColor || '#8a6f45')
  const nut = new THREE.Color(fruit.color || '#c8a86a')
  // 中性果皮底色; 真实颜色由顶点色提供 (避免和 COLOR_0 双重染色)
  ctx.fillStyle = '#e8ddc8'
  ctx.fillRect(0, 0, SIZE, SIZE)
  const type = fruit.type || 'acorn'
  const dots = type === 'cone' ? 900 : type === 'berry' ? 520 : 380
  for (let i = 0; i < dots; i++) {
    const x = rng.range(0, SIZE)
    const y = rng.range(0, SIZE)
    const r = rng.range(1.2, type === 'cone' ? 12 : 7)
    const c = rng.chance(0.5) ? cap : nut
    ctx.globalAlpha = rng.range(0.12, 0.34)
    ctx.fillStyle = `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 0.14
  ctx.strokeStyle = '#8a6f45'
  ctx.lineWidth = 2
  for (let k = 0; k < 42; k++) {
    const x = rng.range(0, SIZE)
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.bezierCurveTo(x + rng.range(-18, 18), SIZE * 0.35, x + rng.range(-18, 18), SIZE * 0.7, x + rng.range(-10, 10), SIZE)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/**
 * 从高度场生成黑白 alpha 蒙版（白=不透明，黑=沟槽/鳞片缝隙）。
 *
 * 语义与叶卡不同：叶卡的 alpha 是"叶片轮廓镂空"，果实的 alpha 是"果皮细节蒙版"
 * （整颗果子依然不透明，只是把沟槽标记成 0）。它作为独立的 `fruit_alpha_1k`
 * 资源交付，材质本身仍是不透明的（不设 alphaMode）。
 *
 * **朝向**：diff / nor 是 CanvasTexture（flipY=true），GLTFExporter 写 GLB 时
 * 会把它们上下翻转；而 alpha 是独立 data URI、不走导出器，所以这里必须先
 * 自己翻转一次，否则引擎里 `fruit_alpha` 与 `fruit_diff` 上下镜像（这正是
 * "四张图方向必须一致"要防的问题）。
 *
 * 阈值取 105/255：把高度场里明显偏暗的区域（凹坑/沟缝）压成 0，其余为 255，
 * 得到干净的二值蒙版，方便引擎当遮罩或叠加细节用。
 *
 * @param {Uint8ClampedArray} detailPixels makeDetailPixels() 的输出
 * @returns {string|null} PNG data URL（不透明，灰度写在 RGB）；无 DOM 时 null
 */
function makeAlphaMaskDataUrl(detailPixels) {
  const cv = makeCanvas(SIZE, SIZE)
  if (!cv) return null
  const ctx = cv.getContext('2d')
  const out = ctx.createImageData(SIZE, SIZE)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const lum = (detailPixels[i * 4] + detailPixels[i * 4 + 1] + detailPixels[i * 4 + 2]) / 3
    // alpha 资源也带细节: 白色主体 + 黑色沟槽/鳞片
    const a = lum < 105 ? 0 : 255
    out.data[i * 4] = a
    out.data[i * 4 + 1] = a
    out.data[i * 4 + 2] = a
    out.data[i * 4 + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  try {
    // 方向必须和导出的 diff / nor 一致: 这两张是 CanvasTexture (flipY=true),
    // GLTFExporter 写进 GLB 时会上下翻转, 而 alpha 资源是独立 data URI 不走导出器,
    // 所以这里先自己翻转一次, 否则引擎里 fruit_alpha 与 fruit_diff 上下镜像。
    const flipped = makeCanvas(SIZE, SIZE)
    const fctx = flipped.getContext('2d')
    fctx.translate(0, SIZE)
    fctx.scale(1, -1)
    fctx.drawImage(cv, 0, 0)
    return flipped.toDataURL('image/png')
  } catch {
    return null
  }
}

/**
 * 创建导出用的独立果实材质，一次性生成果皮的四张图。
 *
 * 生成顺序与依赖关系（不要随便调换）：
 *   1. `detail`     果皮高度场（nor / alpha 的唯一来源）
 *   2. `map`        中性果皮 diffuse（颜色由 COLOR_0 提供）
 *   3. `roughnessMap` 由 **diffuse** 亮度场推导（暗=粗、亮=滑）→ 与 diff 同尺寸同朝向
 *   4. `normalMap`  由 **高度场** 求 Sobel 梯度 → 与 alpha 细节对齐
 *   5. `alphaDataUrl` 由高度场二值化 → 与 nor 细节对齐（并已按导出朝向翻转）
 *
 * 材质参数说明：
 *   - `vertexColors: true`：果实颜色来自 COLOR_0（坚果色/帽色/实例色差），
 *     diffuse 只提供中性细节，所以材质 `color` 必须是白色，不能额外染色；
 *   - `metalness: 0`：配合 `ensureExportRoughnessGrayscale()`，让 `_rough`
 *     资源保持灰白（否则 glTF 会合成绿/蓝 metal-rough 打包图）；
 *   - `side: FrontSide`：果实是封闭实体，不需要双面；
 *   - `normalScale = 1.4`：果皮细节偏强，1.4 让鳞片/棱线在掠射光下更明显。
 *
 * 约定：
 *   - `userData.kind = 'fruit'` 是 `textureNaming` 的契约：决定资源名前缀
 *     `fruit_*`、以及要不要单独补 `fruit_alpha`；
 *   - `userData.exportAlphaDataUrl` 让导出管线直接用这张"沟槽蒙版"作为
 *     alpha 资源，而不是从 diff 的（全不透明）alpha 通道反推。
 *
 * @param {object} fruit state.params.fruit（type/capColor/color）
 * @param {number} seed  随机种子（决定果皮图案，导出预览与正式导出一致）
 * @returns {THREE.MeshStandardMaterial} name='Fruit'，带完整四图
 */
export function createFruitExportMaterial(fruit = {}, seed = 1) {
  // 1) 高度场：nor / alpha 的唯一来源，保证两者细节对齐
  const detail = makeDetailPixels(fruit, seed)
  // 2) 中性果皮颜色（最终颜色 = 顶点色 × 这张图）
  const map = makeDiffuseTexture(fruit, seed)
  // 3) 法线：由高度场求梯度；强 2.8 让鳞片/棱线在掠射光下有明确凹凸
  const normalMap = detail ? makeNormalTextureFromPixels(detail, SIZE, SIZE, 2.8) : null
  // 4) 粗糙度：由 diffuse 亮度场推导（0.68 = 果皮基准粗糙度）
  const roughnessMap = map ? makeRoughnessTextureFromTexture(map, SIZE, SIZE, 0.68) : null
  // 5) alpha：高度场二值化成的"沟槽蒙版"（已按导出朝向翻转）
  const alphaDataUrl = detail ? makeAlphaMaskDataUrl(detail) : null
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap,
    color: 0xffffff,   // 必须纯白：果实颜色来自 COLOR_0，不能在这里再染一次
    roughness: 0.68,
    metalness: 0,
    vertexColors: true,
    side: THREE.FrontSide,
  })
  mat.name = 'Fruit'
  // 契约：textureNaming 靠 kind 决定 `fruit_*` 资源名与 alpha 资源
  mat.userData.kind = 'fruit'
  // 契约：优先使用这张"沟槽蒙版"作为独立 alpha 资源（见 makeAlphaMaskDataUrl）
  mat.userData.exportAlphaDataUrl = alphaDataUrl
  // 果皮细节偏强，1.4 让鳞片/棱线更明显；与视口无关（只在导出材质上）
  mat.normalScale.set(1.4, 1.4)
  return mat
}

/**
 * 释放导出材质及其三张贴图。
 * 调用时机：`sceneManager._getFruitExportMaterial()` 在参数/种子变化后重建
 * 导出材质之前。三张 CanvasTexture 都归这个函数释放（alpha 是 data URL，
 * 由 patchGlbTextureNames 直接写进 GLB，没有 GPU 资源需要释放）。
 *
 * @param {THREE.MeshStandardMaterial|null} mat createFruitExportMaterial 的返回值
 */
export function disposeFruitExportMaterial(mat) {
  if (!mat) return
  mat.map?.dispose()
  mat.normalMap?.dispose()
  mat.roughnessMap?.dispose()
  mat.dispose()
}
