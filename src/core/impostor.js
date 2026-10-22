/**
 * 伪装卡 (Impostor / 交叉卡) 的离屏渲染与拼图
 * ------------------------------------------------------------
 * 作用: 把当前这棵 3D 树"拍"成一张带 alpha 的 2D 贴图 (可选拼成多视角图集 / 交叉四边形贴图),
 *       使远景可以用一张面片替代整棵树, 省掉大量 draw call 与三角形。
 * 输入 / 输出: `generateImpostor({renderer, scene, camera 相关 bbox, mode, views, size})`
 *       -> `{dataUrl, width, height, coverage, meta}`; 其中 `meta` 是给下游摆放面片用的
 *       相机/视角元数据 (fov, distance, angles, layout …)。
 * 调用关系: `store/treeStore.js` 的 `doGenerateImpostor()` -> `sceneApi.makeImpostor()`
 *       (由 Viewport.vue 注入, 内部转调本模块); 生成结果再交回
 *       `setImpostorModel()` 作为 3D 面片显示在主视口。
 * 关键约定:
 *   - 这里的渲染**不经过主画布**: 用独立的 WebGLRenderTarget, 且必须在 finally 里把
 *     renderer 的 viewport/scissor/pixelRatio/clearColor/renderTarget 全部还原,
 *     否则主视口会变成一个角落小方块 (这是最容易踩的坑);
 *   - 像素读回是"自下而上"的 GL 顺序, 拼 canvas 前必须翻转 (见 pixelsToImageData);
 *   - RT 纹理设为 sRGB, 读回值即显示值, 不需要再做 gamma 转换;
 *   - `meta.angles` / `meta.elevations` 的顺序与图集格子顺序严格一致:
 *     行 = 仰角 (外层循环), 列 = 水平角 (内层循环)。
 */
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
 *
 * 两种模式的差异:
 *   - atlas: 视角矩阵 = 水平角 × 仰角, 输出一张 `cols × rows` 的网格图;
 *     运行时按相机相对树的方向在两维上做插值/就近取格, 即可在任何角度看都对;
 *   - cross: 只取水平角 (仰角恒为 0, 即"侧视"), 输出 `1 × N` 的竖条;
 *     每个格子对应一张绕 Y 轴旋转 `180/n` 的四边形, 交叉摆放制造体积感。
 */


/**
 * 视角角度列表 (水平, 度)。
 * 均匀铺满整圈: 第 i 个视角在 `360/n * i`, 从 +X 方向开始逆时针。
 * @param {number} count 视角数; 非数值/0 按 8 处理, 内部四舍五入并夹到 >= 1
 * @returns {number[]} 角度数组 (度, 0..359, 整数)
 */
export function viewAngles(count) {
  const n = Math.max(1, Math.round(count || 8))
  const out = []
  for (let i = 0; i < n; i++) out.push(Math.round((360 / n) * i))
  return out
}

/**
 * 俯仰层 -> 仰角列表 (度, 0=水平, 90=正俯视)。
 *
 * 只允许 1..5 层, 且对每一档用**手调的固定组合**而不是均匀插值:
 *   - 2 层用 [0, 90]: 伪装卡最常用的"侧视 + 俯视"组合, 中间角度靠插值;
 *   - 3/4/5 层才逐步加密, 因为每多一层图集面积翻倍, 而收益递减。
 *
 * @param {number} count 层数; 非数值按 1 处理, 超过 5 夹到 5
 * @returns {number[]} 仰角数组 (度, 升序, 0..90)
 */
export function elevationAngles(count) {
  const n = Math.max(1, Math.min(5, Math.round(count || 1)))
  if (n === 1) return [0]
  if (n === 2) return [0, 90]        // 水平 + 正俯视 (最常用: 从上往下看)
  if (n === 3) return [0, 45, 90]
  if (n === 4) return [0, 30, 60, 90]
  return [0, 22.5, 45, 67.5, 90].map((v) => Math.round(v))
}

/**
 * 图集排版: 视图数 -> {cols, rows} (尽量接近正方形)。
 * 先取 `ceil(sqrt(n))` 列, 再用 `ceil(n/cols)` 行兜住余数 ——
 * 这样总格子数 >= n 且不会出现某一行空一半以上, 图集纹理利用率最高。
 * @param {number} count 视图数
 * @returns {{cols: number, rows: number}} 网格行列数
 */
export function atlasLayout(count) {
  const n = Math.max(1, Math.round(count || 8))
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return { cols, rows }
}

/**
 * 交叉卡的四边形布局 (角度, 宽, 高) —— 用于生成网格。
 *
 * n 张卡片均匀分布在 180° 内 (不是 360°): 因为一张四边形从正反两面看是一样的,
 * 转 180° 就重复了。宽高固定为 1, 实际尺寸由调用方按树的包围盒缩放。
 *
 * @param {number} count 卡片张数 (夹到 1..20; 超过 ~6 张以后视觉收益极小且过度绘制变严重)
 * @returns {Array<{angle: number, width: number, height: number}>} 每张卡的绕 Y 轴角度(度)与归一化尺寸
 */
export function crossCardQuads(count) {
  const n = Math.max(1, Math.min(20, Math.round(count || 2)))
  const out = []
  for (let i = 0; i < n; i++) out.push({ angle: Math.round((180 / n) * i), width: 1, height: 1 })
  return out
}

/**
 * 统计 alpha 覆盖率 (0~1), 用于判断渲染是否真的抓到树。
 *
 * 阈值 24 (0..255) 而不是 0: 抗锯齿与预乘 alpha 会在边缘留下 1~20 的极低 alpha 值,
 * 若按 >0 统计, 空场景也会被算成"有内容", 从而掩盖"相机没对准树"这类问题。
 *
 * @param {Uint8Array|Uint8ClampedArray} pixels RGBA 像素 (长度 = w*h*4)
 * @param {number} w 宽 (像素)
 * @param {number} h 高 (像素)
 * @returns {number} 不透明像素占比 0..1
 */
export function alphaCoverage(pixels, w, h) {
  let hit = 0
  // 从下标 3 开始每次 +4: 只读每个像素的 alpha 通道
  for (let i = 3; i < w * h * 4; i += 4) if (pixels[i] > 24) hit++
  return hit / (w * h)
}

/**
 * 把 WebGL 的像素 (自下而上) 转成 canvas 可用的 ImageData (自上而下)。
 * GL 的 readPixels 原点在左下角, 而 canvas/ImageData 原点在左上角,
 * 所以按行翻转: 目标第 y 行取源第 (h-1-y) 行。
 * @param {Uint8Array} pixels RGBA 像素, 长度 w*h*4
 * @param {number} w 宽
 * @param {number} h 高
 * @returns {ImageData} 可直接 putImageData 的图像数据
 */
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
  // 渲染期间把 renderer 的"全局状态"改掉, finally 必须逐项还原 —— 少还原一项,
  // 回到主视口时就会表现为"只渲染左下角小方块"/"背景变透明"/"分辨率错乱"
  try {
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, size, size)
    // 离屏渲染强制 pixelRatio=1: 否则高分屏会按 2x 分配, 读回的像素数与 size*size*4 对不上
    renderer.setPixelRatio(1)
    renderer.setRenderTarget(rt)
    // 透明背景: 伪装卡必须带 alpha, 否则远景就成了一块不透明的矩形
    renderer.setClearColor(0x000000, 0)
    // 明确全清 (颜色+深度+模板) 并保证 autoClear, 否则多视角会互相叠加
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = true
    renderer.clear(true, true, true)
    renderer.render(scene, camera)
    renderer.autoClear = prevAutoClear
    // 读回 RGBA8 像素 (自下而上的 GL 顺序, 逆序翻转在 pixelsToImageData 里做)
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels)
  } finally {
    renderer.setRenderTarget(prevTarget)
    renderer.setClearColor(prevClear, prevAlpha)
    renderer.setViewport(prevViewport)
    renderer.setScissor(prevScissor)
    renderer.setScissorTest(prevScissorTest)
    renderer.setPixelRatio(prevRatio)
    // 每个视角一个 RT, 用完立刻 dispose, 不然 N 个视角会积累 N 张显存纹理
    rt.dispose()
  }
  return pixels
}

/**
 * 生成伪装卡
 *
 * 流程:
 *   ① 按包围盒算出树的中心与包围球半径, 反推相机距离 (窄 FOV 近似正交);
 *   ② 临时隐藏场景装饰 (地面/网格/天空/落叶) 并把背景清成透明;
 *   ③ 临时加一组"全向光照"(环境 + 半球 + 6 向平行光), 保证任何视角都不背光发黑;
 *   ④ 逐视角: 摆相机 -> 离屏渲染 -> 读像素 -> 画到单视角 canvas, 同时累计 alpha 覆盖率;
 *   ⑤ 恢复场景/光照/曝光/背景, 把各视角 canvas 按 layout 拼成大图并 toDataURL。
 *
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer 主渲染器 (会临时改状态并在 finally 还原)
 * @param {THREE.Scene} o.scene 场景 (只读, 但会临时增删灯光)
 * @param {{min:{x,y,z},max:{x,y,z}}} o.bbox 树的包围盒 (世界坐标)
 * @param {'atlas'|'cross'} o.mode
 * @param {number} o.views 图集视角数 / 交叉卡张数
 * @param {number} o.size 单视角分辨率
 * @param {number} [o.elevations] 仰角层数 (仅 atlas; cross 恒为 1 层水平视角)
 * @param {THREE.Object3D[]} o.hide 渲染时要隐藏的场景装饰 (地面/网格/天空/落叶等)
 * @returns {{dataUrl:string, width:number, height:number, coverage:number, meta:object}}
 *   `coverage` 是各视角 alpha 覆盖率的平均值 (0..1), 太小说明相机没框住树, 应提示用户
 */
export function generateImpostor(o) {
  // 依赖 canvas/ImageData, 纯 Node 环境直接给出明确错误而不是 "document is not defined"
  if (typeof document === 'undefined') throw new Error('伪装卡生成需要浏览器环境')
  const { renderer, scene, bbox } = o
  const mode = o.mode === 'cross' ? 'cross' : 'atlas'
  // 单视角分辨率夹到 64..2048: 太小看不出树形, 太大图集面积爆炸 (size² × 格子数)
  const size = Math.max(64, Math.min(2048, Math.round(o.size || 512)))
  const count = Math.max(1, Math.round(o.views || (mode === 'cross' ? 2 : 8)))

  // 包围盒中心当作"取景中心"(不是树的几何重心, 避免树冠稀疏时相机偏下)
  const center = new THREE.Vector3(
    (bbox.min.x + bbox.max.x) / 2,
    (bbox.min.y + bbox.max.y) / 2,
    (bbox.min.z + bbox.max.z) / 2,
  )
  // 包围盒对角线的一半 = 包围球半径; 下限 0.5m 防止空/退化包围盒导致相机贴脸
  const radius = Math.max(
    0.5,
    0.5 * Math.hypot(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z),
  )
  // 用窄 FOV + 远距离近似正交, 减少视角间透视差异 (impostor 的标准做法)
  const fov = 18
  // 距离 = 让半径恰好落在视锥内的距离 × 1.06 留边 + 0.15·radius 的额外余量(给树冠突出物)。
  // tan(fov/2) 里的 fov 由度转弧度, 所以是 `fov*PI/360` (= 半角)
  const dist = (radius / Math.tan((fov * Math.PI) / 360)) * 1.06 + radius * 0.15
  // near 用 radius*0.02 (避免精度问题), far 覆盖到"球后方再留 4 倍半径", 保证不裁掉树梢
  const cam = new THREE.PerspectiveCamera(fov, 1, Math.max(0.05, radius * 0.02), dist + radius * 4)
  cam.up.set(0, 1, 0)

  // 隐藏场景装饰 + 清掉场景背景 (否则离屏渲染出来的背景是不透明的, 卡片就成了矩形)
  const restore = []
  // 记下每个装饰原本的 visible, 结束后原样恢复; 不隐藏地面的话, 贴图底部会带一块地板
  for (const obj of o.hide || []) if (obj) { restore.push([obj, obj.visible]); obj.visible = false }
  const prevBg = scene.background
  scene.background = null
  // ---- 拍摄用全 360 光照: 环境 + 半球 + 6 向平行光, 保证任何角度都不背光发黑 ----
  // 这些灯是"临时的": 只在拍摄期间加入场景, finally 里逐个移除。
  // 6 个方向覆盖 ±X/±Z/上/下: 单靠太阳光会让背光面的视角糊成一团黑, 无法用于插图集。
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
    // 方向光的实际位置只决定照射方向, 乘 20 是为了让阴影相机不被近裁剪面切掉 (若开阴影)
    L.position.set(d[0] * 20, d[1] * 20, d[2] * 20)
    addLight(L)
  }
  // 只允许调亮不允许调暗: 用户可能把曝光调到 0.4 做夜景, 但伪装卡需要能看清树
  renderer.toneMappingExposure = Math.max(prevExposure, 1.15)
  // 水平角列表: cross 复用卡片的朝向角 (180° 内均分), atlas 用整圈均分
  const horiz = mode === 'cross' ? crossCardQuads(count).map((q) => q.angle) : viewAngles(count)
  // 仰角列表: cross 只拍水平一张; atlas 默认 1 层(水平), 可传 elevations 增加俯视层
  const elevs = mode === 'cross' ? [0] : elevationAngles(o.elevations === undefined ? 1 : o.elevations)
  const views = []
  let totalCoverage = 0
  try {
    // 外层仰角 / 内层水平角 -> 与 layout 的 (rows=仰角, cols=水平角) 一一对应
    for (const el of elevs) {
      for (const ang of horiz) {
        const arad = (ang * Math.PI) / 180
        const erad = (el * Math.PI) / 180
        // 球坐标布点: 先在水平面绕一圈(含仰角的 cos 收缩), 再按仰角抬高。
        // 用 sin/cos 而不是 lookAt 后旋转, 是为了让"角度 -> 位置"可预测、可复现。
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
        // 单视角内容先画到独立 canvas: 这样最后拼图只是 drawImage, 不必反复操作大 canvas
        const cv = document.createElement('canvas')
        cv.width = size
        cv.height = size
        cv.getContext('2d').putImageData(pixelsToImageData(px, size, size), 0, 0)
        views.push({ angle: ang, elevation: el, canvas: cv })
      }
    }
  } finally {
    // 无论成功/抛错都要还原现场: 装饰可见性、临时灯光、曝光、背景、renderTarget
    for (const [obj, v] of restore) obj.visible = v
    for (const L of captureLights) scene.remove(L)
    renderer.toneMappingExposure = prevExposure
    scene.background = prevBg
    renderer.setRenderTarget(null)
  }

  // 平均 alpha 覆盖率: 偏低说明取景没框住树 (或树被装饰挡住), 上层据此提示用户
  const coverage = totalCoverage / Math.max(1, views.length)
  // 拼图网格: cross 是竖排 N 张; atlas 是 rows × cols (注意与上面的循环顺序一致)
  const layout = mode === 'cross'
    ? { cols: 1, rows: views.length }
    : { cols: horiz.length, rows: elevs.length }
  const out = document.createElement('canvas')
  out.width = size * layout.cols
  out.height = size * layout.rows
  const ctx = out.getContext('2d')
  // 按 layout 把每个视角贴到对应格子。i 的顺序与生成 views 的顺序一致:
  // i % cols = 列 (水平角), floor(i / cols) = 行 (仰角)
  views.forEach((v, i) => {
    const cx = (i % layout.cols) * size
    const cy = Math.floor(i / layout.cols) * size
    ctx.drawImage(v.canvas, cx, cy)
  })

  return {
    // PNG dataURL: 直接可做 <img> 源, 也可作为下载地址 (无需再转 Blob)
    dataUrl: out.toDataURL('image/png'),
    width: out.width,
    height: out.height,
    coverage,
    // meta 是"运行时怎么用这张卡"的全部参数: 下游按 angles/elevations/layout 取格子,
    // 按 fov/distance/radius 重建同样的取景, 因此这里的字段名不可随意改。
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
      // 浮点收敛到 3 位小数: meta 会被写进 JSON 一起下载, 保持可读且稳定
      distance: +dist.toFixed(3),
      center: [center.x, center.y, center.z].map((v) => +v.toFixed(3)),
      radius: +radius.toFixed(3),
      coverage: +coverage.toFixed(4),
      generatedAt: new Date().toISOString(),
    },
  }
}
