import * as THREE from 'three'
import { createSharedUniforms, createBarkMaterial, createLeafMaterial, createFlowerMaterial } from './materials.js'

/**
 * 材质球预览 (实时 + 可拖动旋转)
 * ------------------------------------------------------------
 * 每个实例一个独立 WebGLRenderer + 球体, 画到传入的 <canvas> 上。
 * - setParams(params): 用当前参数重建材质并重绘 (贴图异步加载完会自动补画)
 * - 鼠标拖动: 相机绕球体旋转 (光照固定 -> 从各角度看高光/法线/贴图)
 * - 只在需要时渲染, 没有常驻 rAF 循环
 *
 * 作用: 给材质编辑面板里的每个"材质球"提供独立的小画布预览, 让用户在不看整棵树
 *       的情况下判断贴图路径 / 颜色 / 粗糙度 / 自发光参数是否对。
 * 输入 / 输出: 输入是真实 `<canvas>` 元素 + 与主场景同一份的 params 参数对象;
 *       输出是控制句柄 { setParams, render, dispose, getCamera, rotateBy },
 *       不返回任何 DOM (画在哪由调用方决定)。
 * 与其他模块的关系:
 *       - 材质一律由 `materials.js` 的 create*Material() 生产, 本文件不自己拼材质,
 *         所以预览观感与 `sceneManager.js` 的主视口一致 (唯一差别是固定三点光);
 *       - 材质的 uniform 来自 `createSharedUniforms()`, 与场景**不共享**同一个对象
 *         (每个预览一份), 避免预览的时间/种子影响主场景;
 *       - 与 `exporter.js` 无关: 这里用的是视口材质, 不是导出期临时补槽的材质。
 * 关键概念 / 约定:
 *       - 单位: 球半径 1 (无量纲), 相机轨道半径 3.05 个球半径, FOV 30°, 近远裁面 0.1/20;
 *       - 每个实例独占一个 WebGLRenderer —— WebGL 上下文是浏览器级稀缺资源,
 *         面板里同时存在的球数量必须由调用方控制、不用时调用 dispose();
 *       - 颜色管线与主场景对齐: outputColorSpace = sRGB + ACESFilmic 色调映射,
 *         否则预览偏暗/偏灰会误导用户调参。
 * 注意: 贴图是异步解码的, setParams() 返回时纹理往往还没上传到 GPU,
 *       首次渲染球上可能是纯色 —— 所以必须有 scheduleRetries() 的补画机制。
 */

/**
 * 贴图解码完成前的补画时刻 (毫秒, 相对 setParams 的延时)。
 * 四档 120 / 350 / 800 / 1600 递增覆盖不同耗时: 前两档对应已在内存里的图片
 * (解码通常在 1 帧内完成), 后两档对应网络加载或大图解码。
 * 4 次之后仍没画上就说明加载失败, 不再重试 —— 避免残留定时器一直跑。
 */
const RETRY_MS = [120, 350, 800, 1600]

/**
 * 创建一个材质球预览实例。
 *
 * 内部会立刻建好 WebGLRenderer / 场景 / 三点光 / 球体, 但**不建材质** ——
 * 材质要等调用方给出 params 后由 setParams() 创建 (首次 setParams 前球是黑的)。
 *
 * @param {HTMLCanvasElement} canvas 预览画布 (由调用方提供, 尺寸由本函数接管)
 * @param {'bark'|'leaf'|'flower'} [kind] 预览哪种材质; 未知值按 'bark' 处理
 * @returns {{setParams: Function, render: Function, dispose: Function,
 *            getCamera: Function, rotateBy: Function}|null}
 *          无 canvas 或非浏览器环境 (无 document) 时返回 null, 调用方据此跳过挂载
 */
export function createMaterialPreview(canvas, kind = 'bark') {
  if (!canvas || typeof document === 'undefined') return null
  // 固定 96×96 逻辑像素: 材质球足够看出贴图细节, 又不会让面板里的十几个球
  // 各自吃掉一张大 framebuffer。
  const size = 96
  // alpha: true + preserveDrawingBuffer: true 是刻意组合:
  //   - alpha: 让球以外的区域透明, 才能叠在面板背景/圆角卡片上;
  //   - preserveDrawingBuffer: 保证合成器取帧之后画布内容仍可读取 (截图/导出)。
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  // 上限 2 倍: 3x DPR 手机上一张 96px 的球没必要渲染成 288px (4 倍像素量换不到观感)。
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  // 第三个参数 false = 不让 renderer 改 canvas 的 CSS 尺寸 (由布局/样式决定)。
  renderer.setSize(size, size, false)
  // 与主视口同一套输出管线, 否则预览的明暗和饱和度和真实结果对不上。
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  const scene = new THREE.Scene()
  // FOV 30° 的窄视角: 透视畸变小, 球体轮廓接近正圆, 便于判断法线/高光。
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20)
  /* ---------------- 三点光照: 主光 / 补光 / 轮廓光 ---------------- */
  // 光放进 Group 便于整体旋转; 目前只在初始化时设置一次, 相机绕球转、光保持固定,
  // 这样拖动时看到的是"同一盏灯下的不同角度", 能暴露法线/高光问题。
  const light = new THREE.Group()
  const key = new THREE.DirectionalLight(0xffffff, 2.8)   // 主光: 右上前方, 强度足以压出高光
  key.position.set(2.4, 2.8, 3.2)
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.75) // 补光: 左前方偏冷, 抬起阴影里树皮的青蓝色调
  fill.position.set(-2.8, 0.5, 1.6)
  const rim = new THREE.DirectionalLight(0xffe2b8, 1.0)   // 轮廓光: 后方偏暖, 勾出球体边缘与叶片透光
  rim.position.set(-1.0, -1.8, -2.6)
  light.add(key, fill, rim)
  scene.add(light, new THREE.AmbientLight(0xffffff, 0.3)) // 环境光: 保证背光面不是纯黑, 否则看不出固有色

  // 64×40 分段的球: 材质无 displacement, 分段只为让高光过渡平滑 (低分段会出现棱面)。
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), null)
  scene.add(mesh)

  let mat = null
  // 初始机位: yaw 0.55 rad (≈31.5°) + pitch 0.28 rad (≈16°) —— 四分之三侧前方视角,
  // 能同时看到高光、法线和贴图的横向走向, 比正对球面更有信息量。
  let yaw = 0.55
  let pitch = 0.28
  let drag = null          // 拖动状态: {x, y} = 上一次 pointer 的屏幕坐标; null = 未拖动
  let retryTimers = []     // 待执行的补画定时器 id 列表 (重新 setParams 时全部清掉)

  /**
   * 按 (yaw, pitch) 把相机放到球面外的轨道上并看向原点。
   *
   * 球坐标约定 (Y 轴向上, 右手系):
   *   x = sin(yaw)·cos(pitch)·r
   *   y = sin(pitch)·r
   *   z = cos(yaw)·cos(pitch)·r
   * pitch 被调用方钳在 ±1.45 rad (≈±83°) 内, 所以 cos(pitch) 恒为正, 不会在
   * 极点处出现相机翻转/万向锁。
   */
  function placeCamera() {
    const r = 3.05            // 轨道半径: FOV 30° 下球体约占画面 2/3, 四周留白便于看轮廓
    camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * r,
      Math.sin(pitch) * r,
      Math.cos(yaw) * Math.cos(pitch) * r,
    )
    camera.lookAt(0, 0, 0)
  }

  /** 立刻画一帧 (无 mat 时直接返回, 避免用 null 材质着色出黑球) */
  function render() {
    if (!mat) return
    placeCamera()
    // 兜底把渲染目标切回画布自身: 外部若曾把 renderer 指向 RT, 这里要复位,
    // 否则这一帧会画到离屏目标上、画布看起来没刷新。
    renderer.setRenderTarget(null)
    // 透明清屏 (alpha=0): 球外区域必须透出面板背景。
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, true)
    renderer.render(scene, camera)
  }

  /** 贴图可能还没解码完 -> 过一会儿补画几次, 保证纹理真的出现在球上 */
  function scheduleRetries() {
    // 先清掉上一轮的定时器: 参数连续变化时不会累积出几十次重绘。
    retryTimers.forEach(clearTimeout)
    retryTimers = RETRY_MS.map((ms) => setTimeout(render, ms))
  }

  /**
   * 用一份新的参数重建材质并重绘 (面板滑杆变化时的主要入口)。
   *
   * 每次都会**新建**材质实例而不是原地改参数: 树皮/叶片的贴图缓存键、着色器注入
   * 都绑在创建流程里, 重建最省心; 旧材质立即 dispose(), 否则每次滑杆都会泄漏
   * 一份 GPU 资源。
   *
   * @param {object} params 与主场景相同的参数树 (bark / leafMat / flower / wind ...)
   */
  function setParams(params) {
    const uniforms = createSharedUniforms(params)
    if (mat) mat.dispose()
    mat = kind === 'leaf'
      ? createLeafMaterial(params, uniforms)
      : kind === 'flower'
        ? createFlowerMaterial(params, uniforms)
        : createBarkMaterial(params, uniforms)
    mesh.material = mat
    // 贴图 onUpdate -> 立刻补画 (比定时重试更快)
    // 注: 该标记位目前只写不读 (历史遗留的钩子, 由贴图侧消费); 保留是为了不改变行为。
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) {
      if (t) t.userData.__mpHook = true
    }
    render()
    scheduleRetries()
  }

  /* ---------------- 指针拖动: 相机绕球旋转 ---------------- */
  // 用 Pointer Events 而不是 mouse/touch 两套: 一套代码同时覆盖鼠标、触控笔、手指。
  function onDown(e) {
    drag = { x: e.clientX, y: e.clientY }
    // 捕获指针: 手指/鼠标拖出 canvas 边界时仍能继续收到 move/up (不会"拖丢")。
    canvas.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }
  function onMove(e) {
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    drag = { x: e.clientX, y: e.clientY }
    yaw -= dx * 0.012                  // 左右拖 -> 绕 Y 轴
    // pitch 钳在 ±1.45 rad (≈±83°): 留 7° 余量避免相机贴到极点时 up 向量退化、
    // 画面在球顶附近抖一下。
    pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.012))  // 上下拖 -> 俯仰
    render()
  }
  function onUp(e) {
    drag = null
    canvas.releasePointerCapture?.(e.pointerId)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  // pointercancel: 系统抢占 (来电、手势返回) 时不会补发 pointerup, 不处理会永久卡在拖动态。
  canvas.addEventListener('pointercancel', onUp)
  canvas.style.cursor = 'grab'

  return {
    setParams,
    render,
    /** 释放全部资源: 定时器 / 事件监听 / 材质 / 几何 / WebGL 上下文。不可再用。 */
    dispose() {
      retryTimers.forEach(clearTimeout)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      if (mat) mat.dispose()
      mesh.geometry.dispose()
      // forceContextLoss 省略: dispose() 已让上下文可回收, 强制丢失会让同页其它
      // 共享该 GPU 进程的上下文也短暂受影响。
      renderer.dispose()
    },
    // 便于测试/外部控制
    getCamera: () => camera,
    /**
     * 供程序化控制机位 (自检截图、参数复位), 与鼠标拖动等效但屏幕上没有指针。
     * @param {number} dx 水平增量 (像素量级, 内部乘 0.012 rad/px)
     * @param {number} dy 垂直增量 (像素量级, 内部乘 0.012 rad/px, 并钳在 ±1.45 rad)
     */
    rotateBy(dx, dy) {
      yaw -= dx * 0.012
      pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.012))
      render()
    },
  }
}
