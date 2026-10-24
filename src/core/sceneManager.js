/**
 * 场景总控 (TreeScene) —— Three.js 那一侧的唯一入口
 * ------------------------------------------------------------
 * 作用: 把 treeBuilder 算出来的几何挂进一个可交互的 3D 场景, 并负责它的一生:
 *       渲染器/相机/轨道控制、灯光与天空、材质与风场着色器的绑定、动态 LOD、
 *       视锥分块剔除、节点选中高亮、骨架叠层、单枝变换轴、叶片粒子、
 *       落叶/落花/堆积、伪装卡(Impostor)生成与预览、导出、逐帧动画循环、销毁。
 * 输入 / 输出:
 *       输入 —— build(params) 吃一份 treeStore.state.params 的完整快照;
 *               其余 update*() 方法吃"参数分片"做增量刷新(不重建几何)。
 *       输出 —— 不回调返回值给 UI 时, 通过 callbacks 往外抛事件:
 *               onStats(stats)          一次重建后的统计量(三角面/叶数/高度…)
 *               onShaderError(msg)      GLSL 编译或链接失败的日志(注入着色器出错时)
 *               onLod({level, levels})  当前 LOD 档位与各档统计(三角面/叶数)
 *               onModel({nodes, groups})模型节点表, 供节点树面板与拾取使用
 *               onGrowth(value)         自动生长进度 0..1
 *               onBranchEdit({index, patch}) 单枝变换轴提交的位移/旋转补丁
 *               onFrame(info)           每帧 renderer.info.render(draw call/三角面)
 * 与其他模块的关系:
 *       上游 —— Viewport.vue 负责 new TreeScene(host, callbacks) 并挂到
 *               window.__fastTreeScene; treeStore 决定何时调用 build/update*。
 *       下游 —— treeBuilder(几何) / materials(材质与风场 GLSL) /
 *               renderChunks(视锥分块) / fallingLeaves + litter + particles(季节特效) /
 *               impostor(伪装卡) / exportSplit + exporter(导出)。
 * 关键概念 / 约定:
 *       - 坐标系: 右手系 Y 向上, 单位米; 树根在原点, 树干沿 +Y 生长。
 *       - 场景里同时存在三套"同一棵树": 源网格(导出/统计/采样用, 被移到
 *         SOURCE_ONLY_LAYER 不参与默认渲染)、视锥分块(LOD0 真正渲染的东西)、
 *         以及 LOD1/LOD2 的低模。切换档位就是切各自的 visible。
 *       - 风场/生长/选中全部是**顶点+片元着色器**里做的, 共享一份 uniforms
 *         (createSharedUniforms), 所以改参数走 uniform 而非重建几何。
 *       - 确定性纪律: 本文件只在星空分布上用了一个硬编码种子的 Rng 子流
 *         ('starfield'), 树的几何全部由 treeBuilder 按 params.seed 决定 ——
 *         本文件任何地方都不许再引入 Math.random(), 否则会破坏"同 seed 同树"。
 * 注意: 所有几何/材质/贴图都必须在 dispose() 里释放; 重建路径上的旧资源要在
 *       build() 内先 dispose 再替换, 否则 SPA 反复重建会稳定泄漏 GPU 显存。
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { buildTree } from './treeBuilder.js'
import {
  createSharedUniforms, createBarkMaterial, createLeafMaterial, createFlowerMaterial,
  createTreeDepthMaterial,
  updateMaterials, updateWindUniforms, updateGrowthUniforms, rebindCustomShader,
} from './materials.js'
import { exportGLB, exportOBJ, exportScreenshot } from './exporter.js'
import { buildParticlePoints, updateParticleMaterial } from './particles.js'
import { buildFallingLeaves, updateFallingLeaves, fallRebuildKey } from './fallingLeaves.js'
import { buildLeafLitter, litterRebuildKey, updateLitterEffects } from './litter.js'
import { generateImpostor } from './impostor.js'
import { buildFrustumChunks, hideSourceMesh } from './renderChunks.js'
import { buildGLBPreview, buildOBJPreview, buildPNGPreview } from './exportPreview.js'
import { createFruitExportMaterial, disposeFruitExportMaterial } from './fruitMaterial.js'
import { boxInfo } from './mathUtils.js'
import { cloneParams } from './params.js'
import { makeRng } from './rng.js'
import { TWIST_TIMES } from './twist.js'
import { barkExportParts } from './exportSplit.js'

/**
 * 天空穹顶的顶点着色器: 只把局部坐标原样传给片元, 不做任何位移。
 * 之所以要 vSkyPos 而不是直接用内置的 vWorldPosition: 穹顶是跟随相机平移的
 * (见 tick 里 sky.position.copy(camera.position)), 世界坐标会随之变化,
 * 而局部坐标才是稳定的"天空球面方向"。
 */
const SKY_VERT = /* glsl */`
varying vec3 vSkyPos;
void main() {
  vSkyPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

/**
 * 天空穹顶的片元着色器: 按球面高度做上/下两色的竖直渐变。
 *
 * 公式解读:
 *   h = normalize(vSkyPos + (0, uOffset, 0)).y * 0.5 + 0.5
 *     —— 把"球面点的 Y 分量"从 [-1, 1] 线性映射到 [0, 1](0 = 天底, 1 = 天顶);
 *        uOffset 用来把渐变最亮的那条带往上抬一点, 避免地平线上出现硬切线。
 *   pow(clamp(h), 0.85)
 *     —— 0.85 是经验指数: 小于 1 会让高光带更宽、天顶更快达到纯 uTop,
 *        看起来更像真实大气而不是线性色带。
 *   mix(uBottom, uTop, t)
 *     —— 底部靠近地面雾色, 顶部是天空色; 两者都由 updateScene() 从
 *        环境预设的 skyTop / skyBottom 写入。
 */
const SKY_FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uOffset;
varying vec3 vSkyPos;
void main() {
  float h = normalize(vSkyPos + vec3(0.0, uOffset, 0.0)).y * 0.5 + 0.5;
  vec3 col = mix(uBottom, uTop, pow(clamp(h, 0.0, 1.0), 0.85));
  gl_FragColor = vec4(col, 1.0);
}`

/**
 * Three.js 场景总控。一个页面通常只有一个实例(Viewport.vue 创建并挂到
 * window.__fastTreeScene 供 MCP 桥与调试使用)。
 *
 * 生命周期:
 *   new TreeScene(container, callbacks) → 构建场景 + 启动 rAF 循环 →
 *   build(params) 反复重建几何 → 各种 update*() 增量刷新 →
 *   dispose() 释放全部 GPU 资源并断开 ResizeObserver。
 *
 * 重要成员(按用途分组):
 *   渲染骨架: renderer / scene / camera / controls / sun / hemi / sky / ground / grid
 *   树本体:   treeGroup / barkMesh / leafMesh / flowerMesh(源网格, 只在
 *             SOURCE_ONLY_LAYER 上, 不直接参与渲染)
 *   剔除与LOD: _cullChunks(LOD0 实际渲染的分块) / lodCache(Map<level, entry>)
 *             / lodLevel / lodInfo
 *   着色器:   uniforms(与 materials.js 共享的那一份)
 *   交互:     selectMode / selBox / branchGizmo / transformControls / skeletonGroup
 *   特效:     particles / fallMesh / litterMesh / flowerFallMesh / flowerLitterMesh
 *   状态:     lastParams(最近一次 build 的参数快照) / stats / treeHeight /
 *             treeSpread / treeCenter
 *
 * @param {HTMLElement} container 挂载 canvas 的宿主元素(尺寸由它决定)
 * @param {Object} [callbacks] 回调表, 见文件头 onStats/onLod/... 的说明
 */
export class TreeScene {
  constructor(container, callbacks = {}) {
    this.container = container
    this.callbacks = callbacks
    this.disposed = false
    this.stats = null
    // 生长进度 0..1; 1 = 完整成型。默认满值, 于是首帧看到的就是整棵树。
    this.growthValue = 1

    /* ---------------- ① 渲染器 ---------------- */
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      // 保留绘制缓冲: canvas.toDataURL / 导出 PNG 需要读到上一帧的像素,
      // 关掉它(默认)会在合成后被清空, 截图就只剩黑底。
      preserveDrawingBuffer: true,
      // 提示浏览器优先选独显; 集成显卡也能跑, 只是高多边形的树会掉帧。
      powerPreference: 'high-performance',
    })
    // 像素比封顶 2: 4K/5K 屏上 devicePixelRatio 可达 3, 再乘上本篇的
    // 百万级三角面会直接把填充率压死; 2 是清晰度与帧率的折中点。
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    // ACES 电影级色调映射: 高光滚降柔和, 树皮/树叶的暖色调不会一晒就爆白。
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    // 1.18 是补偿 ACES 整体压暗的曝光系数(1.0 时画面偏灰)。
    renderer.toneMappingExposure = 1.18
    renderer.shadowMap.enabled = true
    // PCF 阴影: 比 BasicShadowMap 软、比 VSM 便宜且无漏光, 适合大量细碎树叶。
    renderer.shadowMap.type = THREE.PCFShadowMap
    // 风场/选中是 onBeforeCompile 注入到标准材质里的, 一旦 GLSL 拼错,
    // 只会在编译期暴露成一条日志 —— 打开检查并转成 onShaderError 回调,
    // UI 才能把"着色器注入失败"直接显示出来, 否则表现为整棵树变黑。
    renderer.debug.checkShaderErrors = true
    renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const vLog = gl.getShaderInfoLog(vs) || ''
      const fLog = gl.getShaderInfoLog(fs) || ''
      const pLog = gl.getProgramInfoLog(program) || ''
      if (this.callbacks.onShaderError) {
        this.callbacks.onShaderError([vLog, fLog, pLog].filter(Boolean).join('\n').trim() || 'unknown shader error')
      }
    }
    this.renderer = renderer
    container.appendChild(renderer.domElement)

    /* ---------------- ② 场景 / 相机 / 轨道控制 ---------------- */
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0d1117)
    // 雾只是兜底(默认环境会由 updateScene 覆盖): 近 30 米起雾、140 米全雾,
    // 让远处的地面圆盘边缘融进背景, 看不到"地面是一个圆"的硬边。
    this.scene.fog = new THREE.Fog(0x0d1117, 30, 140)

    // 45° 是"人眼看一棵树"的自然透视; near 0.05 允许贴到树皮表面看纹理细节,
    // far 2000 足够容纳半径 360 的星空球体与外圈地平面。
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000)
    this.camera.position.set(9, 7, 13)

    this.controls = new OrbitControls(this.camera, renderer.domElement)
    // 阻尼惯性: 松手后还能滑一小段, 手感更接近 SpeedTree 的官方查看器。
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 4, 0)
    // 不锁地平线: 允许相机绕到地面以下, 从下往上观察树冠/根系/果实的底面
    this.controls.maxPolarAngle = Math.PI
    this.controls.minDistance = 0.5
    this.controls.maxDistance = 400

    /* ---------------- ③ 单枝可视化变换轴 ---------------- */
    // --- 单枝可视化变换轴 (Blender 风格) ---
    // 变换对象是一个放在枝基的空 Object3D; 拖动箭头/旋转环时
    // 约 80ms 节流提交到 params.branchEdits 并实时重建。
    this.skeleton = null
    // show=false 完全不显示; index 指 skeleton.branches 的下标(不是节点 id);
    // mode 取 translate / rotate; space 取 world / local。
    this.branchGizmo = { show: false, index: null, mode: 'translate', space: 'world' }
    // 代理对象: 真正被 TransformControls 拖的是它, 不是树枝本身。
    // 这样拖动只是改一个 Object3D 的变换, 再换算成 params 里的 move/rot 增量,
    // 由几何管线去重建 —— 树枝几何始终保持"参数驱动", 不做就地变形。
    this.branchPivot = new THREE.Object3D()
    this.branchPivot.name = 'BranchTransformPivot'
    this.scene.add(this.branchPivot)
    this.transformControls = new TransformControls(this.camera, renderer.domElement)
    // 0.78 是控制器相对屏幕的尺寸系数(1.0 会大到挡住细枝)。
    this.transformControls.setSize(0.78)
    this.transformControls.setMode('translate')
    this.transformControls.setSpace('world')
    // three r16x 起 TransformControls 自身不再是 Object3D, 要通过 getHelper()
    // 拿到可加入场景的 helper; 旧版本直接返回自身, 故这里做兼容判断。
    this.transformHelper = this.transformControls.getHelper
      ? this.transformControls.getHelper()
      : this.transformControls
    this.transformHelper.visible = false
    this.scene.add(this.transformHelper)
    // _gizmoSyncing: 我们自己在写 pivot 的变换, 期间 TransformControls 抛出的
    //   objectChange 要忽略, 否则会被误判成"用户拖动"而回写参数(自激循环)。
    // _gizmoDirty: 自上次提交以来用户是否真的动过(避免空提交触发重建)。
    // _gizmoDragging: 当前是否正按着鼠标拖(重建时据此决定不要重置轴)。
    // _gizmoCommitTimer: 节流用的定时器句柄, 0 表示没有待执行的提交。
    this._gizmoSyncing = false
    this._gizmoDirty = false
    this._gizmoDragging = false
    this._gizmoCommitTimer = 0
    // 旋转提交要用它做基准: 单纯读 pivot.quaternion 得到的是"含朝向"的绝对旋转,
    // 减去基准才是用户施加的增量。
    this._gizmoBaseQuat = new THREE.Quaternion()
    // 拖动期间禁用轨道控制, 否则同一个鼠标拖动会同时转相机和拖轴。
    this.transformControls.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value
      this._gizmoDragging = !!e.value
      // 松手时补一次"最终提交", 保证最后一帧的位移不丢。
      if (!e.value) this._commitBranchGizmo()
    })
    this.transformControls.addEventListener('objectChange', () => {
      if (this._gizmoSyncing) return
      this._gizmoDirty = true
      // 拖动过程中实时提交 (约 80ms 一次): 几何 watcher 会重建树，
      // 但重建时不会重置仍处于拖动中的轴, 所以轴和鼠标可以继续跟手。
      if (!this._gizmoDragging || this._gizmoCommitTimer) return
      this._gizmoCommitTimer = setTimeout(() => {
        this._gizmoCommitTimer = 0
        if (this._gizmoDragging) this._commitBranchGizmo(false)
      }, 80)
    })

    /* ---------------- ④ 天空穹顶 + 星空 ---------------- */
    // --- 天空穹顶 (跟随相机的渐变球; 半径远小于远裁剪面, 避免被裁出硬边) ---
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTop: { value: new THREE.Color(0x2a3c52) },
        uBottom: { value: new THREE.Color(0x111820) },
        // 渐变高光带竖直偏移量(单位: 球面局部半径的比例), 0.1 让最亮处落在地平线之上。
        uOffset: { value: 0.1 },
      },
      // BackSide: 只画球体内壁, 相机永远在球内。
      side: THREE.BackSide,
      // 天空是最远的背景, 不写深度, 免得挡住后面的东西(它自己 renderOrder=-1 先画)。
      depthWrite: false,
      fog: false,
    })
    // 半径 90: 大于场景尺度(树高通常 <20)又小于 far(2000 或树高换算值),
    // 配合"跟随相机"就等价于无限远天空, 同时不会因透视产生可见的球面畸变。
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), this.skyMat)
    // 穹顶始终包住相机, 视锥剔除没有意义(而且跟随相机会让它每帧都被判出界)。
    this.sky.frustumCulled = false
    // -1: 保证在一切不透明物之前绘制, 让后面的物体正常覆盖它。
    this.sky.renderOrder = -1
    this.scene.add(this.sky)

    // --- 星空 (黑夜 / 群星环境; 默认隐藏) ---
    this.stars = this._createStars()
    this.scene.add(this.stars)

    /* ---------------- ⑤ 灯光 ----------------
     * 布光思路: 一盏主平行光(太阳, 投影) + 半球光(天光/地面反射)
     * + 两盏弱补光(背光面/顶光)。树冠是自遮挡极重的中空结构,
     * 只有主光时内部会黑成一团, 补光是为了"看清结构"而非模拟真实光照。
     * 强度都是 PBR 物理单位下的经验值, 与 exposure 1.18 搭配。
     */
    // 半球光: 上方天空色偏冷、下方地面色偏暖, 给整体一个环境底光。
    this.hemi = new THREE.HemisphereLight(0xc8dcff, 0x3a2f24, 0.95)
    this.scene.add(this.hemi)
    // 主光(太阳)。3.0 的强度配合 ACES 才不会过曝。
    this.sun = new THREE.DirectionalLight(0xfff2e0, 3.0)
    this.sun.position.set(12, 18, 8)
    this.sun.castShadow = true
    // 2048² 阴影图: 树叶是小而多的投影体, 分辨率太低会糊成一片; 4096 又太贵。
    this.sun.shadow.mapSize.set(2048, 2048)
    // bias/normalBias 是消除阴影痤疮(self-shadow acne)的经验值:
    // 树皮是曲面, 纯 bias 会在细枝上出现漏光, 再叠一点 normalBias 更稳。
    this.sun.shadow.bias = -0.0008
    this.sun.shadow.normalBias = 0.03
    this.scene.add(this.sun)
    // 平行光的方向由 position → target 决定, target 必须也在场景里, 否则不更新。
    this.scene.add(this.sun.target)
    // 冷调侧补光: 把背光面的冷色反射补回来, 边缘不至于死黑。
    this.fill = new THREE.DirectionalLight(0x9fc0ff, 0.9)
    this.fill.position.set(-10, 6, -9)
    this.scene.add(this.fill)
    // 逆光/顶光补光: 让背光面也有细节 (整体更亮, 不再发暗)
    this.back = new THREE.DirectionalLight(0xbfd8ff, 0.55)
    this.back.position.set(-6, 4, 12)
    this.scene.add(this.back)
    this.topFill = new THREE.DirectionalLight(0xffffff, 0.35)
    this.topFill.position.set(0, 20, 0)
    this.scene.add(this.topFill)

    /* ---------------- ⑥ 地面 + 网格 ---------------- */
    // 近黑的中性灰地面: 主要作用是"接住"阴影, 颜色不能抢树的视觉重心。
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.96, metalness: 0.0 })
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), this.groundMat)
    // CircleGeometry 默认在 XY 平面, 绕 X 转 -90° 才是水平地面。
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    // 网格: 40m × 40 格 = 每格 1 米, 提供一个直观的尺度参照。
    this.grid = new THREE.GridHelper(40, 40, 0x3a4150, 0x252a33)
    // 抬高 2mm: 与地面共面会产生 z-fighting(远端网格线闪烁)。
    this.grid.position.y = 0.002
    this.grid.material.transparent = true
    this.grid.material.opacity = 0.55
    this.scene.add(this.grid)

    /* ---------------- ⑦ 树的容器与状态字段 ---------------- */
    // --- 树 ---
    // 共享 uniforms: 风场/生长/选中/太阳方向等, 树皮与树叶两个材质引用同一份,
    // 因此改一次 uniform 就同时作用在两个网格上(见 materials.js)。
    this.uniforms = createSharedUniforms()
    this.treeGroup = new THREE.Group()
    this.treeGroup.name = 'FastTree'
    this.scene.add(this.treeGroup)

    // 材质延迟到 ensureMaterials() 里创建: 第一次 build 时才有 params 可以配置。
    this.materials = null
    // 三块源网格。注意它们被 hideSourceMesh 移到 SOURCE_ONLY_LAYER(31),
    // 默认相机看不到 —— 真正渲染的是下面的 _cullChunks 或 LOD 网格。
    this.barkMesh = null
    this.leafMesh = null
    this.flowerMesh = null
    // 果实导出材质(只在导出且拆出 Bark_Fruit 时创建), 缓存键见 _getFruitExportMaterial
    this._fruitExportMaterial = null
    this._fruitExportKey = ''
    // 视锥分块: 只用于 LOD0 渲染; 源网格保留给导出/统计/粒子采样
    this._cullChunks = []
    // 动态阴影用的深度材质(懒创建, 每个主材质一份): 注入与主材质相同的
    // 风场/生长顶点位移与每材质 uniform, 让影子跟着树一起动。
    // 静态阴影下不挂这个材质, 由 three 用默认的静止姿态深度材质。
    this._depthMaterials = new Map()
    // 阴影总开关与"是否每帧重算"缓存(updateScene 写入, applyShadowFlags 读取)
    this.shadowsEnabled = true
    this.dynamicShadows = true
    // 动态 LOD: LOD0 = 上面的主网格; LOD1/2 首次需要时才构建并缓存
    // lastParams 是"重建参数快照", LOD 生成、导出拆件都从这里取参数。
    this.lastParams = null
    // Map<level, {level, barkMesh, leafMesh, flowerMesh, stats}>; 惰性填充。
    this.lodCache = new Map()
    // 当前显示档位 0/1/2。
    this.lodLevel = 0
    // 各档位的统计量表 [{level, triangles, leaves}], 推给 UI 的 LOD 面板。
    this.lodInfo = []
    // 扭曲句柄用的骨架投影数据(世界坐标扁平数组: x,y,z,x,y,z,...)
    this.twistGuides = null
    this.skeletonGroup = null
    this.showSkeleton = false
    // three r186 起 THREE.Clock 已废弃, 这里自己计时
    // 单位: 秒(用 performance.now()/1000, 单调递增不受系统时间调整影响)。
    this.lastTime = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000
    // playing 控制风场时间是否推进(暂停后树叶定格, 但相机仍可自由绕行)。
    this.playing = true
    this.lastSample = 0
    // 风场时间倍率: 只缩放 uTime 的增量, 不影响 dt 本身, 因此不会引起 LOD 误判。
    this.windTimeScale = 1
    this.growthAuto = false
    // 自动生长速度, 单位 = 归一化进度/秒; 0.35 约等于 3 秒长成。
    this.growthSpeed = 0.35

    /* ---------------- ⑧ 尺寸自适应 + 渲染循环 ---------------- */
    // 用 ResizeObserver 而不是 window.resize: 侧栏折叠/分屏时宿主宽度会变,
    // 但窗口尺寸没变; 只有观察容器本身才拿得到正确尺寸。
    this._onResize = () => this.resize()
    this._ro = new ResizeObserver(this._onResize)
    this._ro.observe(container)
    this.resize()

    // 循环用 rAF 自驱动(tick 内部再排下一帧), 不需要外部传时间戳进来。
    this._loop = () => this.tick()
    this._raf = requestAnimationFrame(this._loop)
  }

  /**
   * 星空点云: 半球随机分布 (种子固定, 每次启动一致); 跟随相机。
   *
   * 分布做法: 在单位球上取"y 在 [0.03, 0.97] 均匀"+ "方位角 theta 均匀",
   * 此时环半径 r = sqrt(1 - y²) 自动成立 —— 球面上按 y 均匀采样等价于按面积
   * 均匀采样, 所以星星不会在两极堆成一片。y 的下限 0.03 避免星星压在
   * 地平线/地面高度上(那样会像飘在地面的雪)。
   *
   * 半径取 300~360(米): 远大于树与地面的尺度, 又落在相机的远裁剪面之内,
   * 加上 tick 里每帧把点云位置贴到相机上, 效果等同无限远天球。
   *
   * 种子写死 20260214 + 固定阶段标签 'starfield': 星空不属于树的随机流,
   * 用独立子流可保证"换 seed 重建树时星空不闪变"。
   *
   * @returns {THREE.Points} 已配置好材质与颜色的点云(初始 visible=false)
   */
  _createStars() {
    const rng = makeRng(20260214, 'starfield')
    const n = 2200
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const theta = rng.next() * Math.PI * 2
      const y = 0.03 + rng.next() * 0.97
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const radius = 300 + rng.next() * 60
      pos[i * 3] = Math.cos(theta) * r * radius
      pos[i * 3 + 1] = y * radius
      pos[i * 3 + 2] = Math.sin(theta) * r * radius
      // 冷白 / 暖白 / 微蓝混合
      // 三个通道各给一个基准 + 小幅随机: R 波动最大(控冷暖), B 只微调,
      // 整体亮度落在 0.7~1.0, 配合 AdditiveBlending 才不会过曝成白点簇。
      const warm = rng.next()
      col[i * 3] = 0.72 + warm * 0.28
      col[i * 3 + 1] = 0.78 + rng.next() * 0.22
      col[i * 3 + 2] = 0.9 + rng.next() * 0.1
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const mat = new THREE.PointsMaterial({
      size: 1.5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      vertexColors: true,
      fog: false,
      blending: THREE.AdditiveBlending,
    })
    this.starsMat = mat
    const pts = new THREE.Points(geo, mat)
    pts.name = 'Stars'
    pts.frustumCulled = false
    pts.renderOrder = -2
    pts.visible = false
    return pts
  }

  /**
   * 按宿主容器的 CSS 尺寸同步渲染器与相机。
   *
   * 三个细节:
   *   - clientWidth/clientHeight 至少夹到 1: 容器折叠(宽高 0)时 aspect 会变
   *     Infinity/NaN, 投影矩阵一旦变 NaN 整个画面就黑了, 且很难恢复;
   *   - setSize(w, h, false): 第三个参数 false = 不改 canvas 的 CSS 尺寸,
   *     让 canvas 仍由布局拉伸, 避免出现"设置尺寸 → 触发布局 → 再设置"的循环;
   *   - 必须 updateProjectionMatrix(), 否则新的 aspect 不会生效。
   *
   * @sideeffect 修改 renderer 绘制缓冲尺寸与 camera 投影矩阵
   */
  resize() {
    const el = this.container
    const w = Math.max(1, el.clientWidth)
    const h = Math.max(1, el.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /* ------------------------------------------------------------------ */
  /* 材质                                                                */
  /* ------------------------------------------------------------------ */
  /**
   * 惰性创建三块材质(树皮 / 树叶 / 花朵), 并缓存到 this.materials。
   *
   * 三种材质的构造都在 materials.js 里完成(标准材质 + onBeforeCompile 注入
   * 风场/生长/选中 GLSL), 它们共享同一个 this.uniforms 对象, 所以这里只需
   * 建一次; 之后再调用只是取缓存 —— 材质是热重载不了的 GPU 资源, 反复创建
   * 会让 shader program 数量爆炸。
   *
   * @param {Object} params 树参数快照(用于贴图路径、颜色、风场开关等)
   * @returns {{bark: THREE.Material, leaf: THREE.Material,
   *            flower: THREE.Material, uniforms: Object}} 材质表
   */
  ensureMaterials(params) {
    if (!this.materials) {
      this.materials = {
        bark: createBarkMaterial(params, this.uniforms),
        leaf: createLeafMaterial(params, this.uniforms),
        flower: createFlowerMaterial(params, this.uniforms),
        uniforms: this.uniforms,
      }
    }
    return this.materials
  }

  /**
   * 只改材质/特效参数的轻量刷新路径(不重建几何)。
   *
   * 顺序有讲究: 五个 update*(params) 先跑 —— 它们可能会因参数变化而**重建**
   * 粒子/落叶/落花/堆积网格, 重建时会读 this.materials 里的贴图做跟随;
   * 之后才 updateMaterials 刷新公共材质属性, 最后才把材质指针重新指派给
   * 源网格与视锥分块。如果顺序反过来, 特效会拿到上一轮的旧贴图。
   *
   * @param {Object} params 树参数快照
   * @sideeffect 更新材质属性、替换网格 material 引用、可能重建若干特效网格
   */
  updateMaterialParams(params) {    this.updateParticles(params)
    this.updateFall(params)
    this.updateFlowerFall(params)
    this.updateLitter(params)
    this.updateFlowerLitter(params)
    const mats = this.ensureMaterials(params)
    updateMaterials(mats, params)
    if (this.barkMesh) this.barkMesh.material = mats.bark
    if (this.leafMesh) this.leafMesh.material = mats.leaf
    if (this.flowerMesh) this.flowerMesh.material = mats.flower || mats.leaf
    for (const c of this._cullChunks) {
      c.mesh.material = c.kind === 'bark' ? mats.bark : c.kind === 'leaf' ? mats.leaf : (mats.flower || mats.leaf)
    }
  }

  /**
   * 用户切换"自定义着色器"(custom shader)后重新装配注入代码。
   *
   * 标准材质的 onBeforeCompile 只在首次编译 program 时执行一次, 之后改注入
   * 代码不会自动生效。rebindCustomShader 负责改 material.customProgramCacheKey
   * 并触发重新编译, 让新的 GLSL 片段被真正用上。
   * 只处理树皮和树叶 —— 花朵材质共用树叶那套着色器逻辑, 不单独注入。
   *
   * @param {Object} params 树参数快照(含 customShader 相关开关与源码)
   */
  rebindCustomShader(params) {
    const mats = this.ensureMaterials(params)
    rebindCustomShader(mats.bark, params, this.uniforms)
    rebindCustomShader(mats.leaf, params, this.uniforms)
  }

  /**
   * 刷新风场参数。
   *
   * 风场分成两层 uniform, 这里是唯一的汇合点:
   *
   * ① **共享层** this.uniforms(createSharedUniforms, 树皮与树叶材质引用同一份)
   *    —— 描述"这一阵风"本身:
   *      uWindDir        vec2  风向单位向量(由 UI 的"度"转弧度后取 cos/sin)
   *      uWindStrength   风力 0..1 量级, 直接乘在顶点位移上(米级幅度)
   *      uWindSpeed      摆动频率倍率, 越大越快
   *      uWindFrequency  空间频率, 决定同一棵树不同部位是否同相
   *      uGust / uGustSpeed / uTurbulence / uSpatialScale
   *                      阵风包络: 让摆幅在时间上缓慢起伏, 而不是等幅摆动
   *      uWindBias       顺风方向的静态偏移占比(0.3 ≈ 树整体被吹偏一点)
   *      uFlexFalloff    柔度沿高度的衰减指数: 根部硬、梢部软
   *      uWindEnabled    0/1 总开关(关掉后顶点位置完全静止, 省 GPU)
   *
   * ② **材质私有层** material.userData.uniforms(每个材质各一份, 因为树皮与
   *    树叶的响应完全不同):
   *      uSway         树皮的整体弯曲幅度(barkSway)
   *      uLeafFlutter  叶片高频抖动幅度(leafFlutter), 决定"哗啦"感
   *      uLeafTwist    叶片绕自身长轴的翻转角度(leafTwist), 表现为反光闪烁
   *
   * 这两层都只是改 uniform 值, 不会触发任何几何重建 —— 拖风场滑块是实时的。
   *
   * @param {Object} params 树参数快照, 只读 params.wind
   * @sideeffect 写入共享 uniforms 与两个材质的私有 uniforms
   */
  updateWind(params) {
    updateWindUniforms(this.uniforms, params.wind)
    const bu = this.materials?.bark?.userData?.uniforms
    const lu = this.materials?.leaf?.userData?.uniforms
    if (bu) bu.uSway.value = params.wind.barkSway
    if (lu) {
      lu.uLeafFlutter.value = params.wind.leafFlutter
      lu.uLeafTwist.value = params.wind.leafTwist
    }
  }

  /* ------------------------------------------------------------------ */
  /* 几何                                                                */
  /* ------------------------------------------------------------------ */
  /**
   * 用一份完整参数快照重建整棵树(重活: 会重新跑一遍 treeBuilder)。
   *
   * 执行顺序(改这里要格外小心, 每一步都依赖前一步的结果):
   *   ① 释放上一轮的 LOD 与视锥分块, 并把档位复位到 0 —— 它们引用的旧几何
   *      马上就要被 dispose, 留着就是悬垂引用;
   *   ② buildTree(params) 生成新几何 —— 这是唯一"贵"的一步(随叶数线性增长);
   *   ③ 先把旧网格从 treeGroup 摘下再 dispose 几何, 然后挂上新网格;
   *   ④ 重新切视锥分块、同步阴影标记、重建四类季节特效;
   *   ⑤ 从 stats 里算出树高/冠幅/中心, 供 LOD 阈值、取景、伪装卡使用;
   *   ⑥ 更新节点表与骨架叠层、复位单枝变换轴、最后按需取景并抛出回调。
   *
   * @param {Object} params 完整树参数(treeStore.state.params 的快照, 不要传 proxy)
   * @param {{frameCamera?: boolean}} [opts] frameCamera=false 时保留当前机位
   * @returns {Object} stats —— 本次重建的统计量, 至少含
   *   {height(米), spread(米), leaves, flowers, fruit, barkTriangles,
   *    leafTriangles, flowerTriangles, nodeCount, totalMs(本次耗时, 毫秒)}
   * @sideeffect 替换全部几何资源; 触发 onStats / onLod / onModel 回调
   */
  build(params, opts = {}) {
    const t = performance.now()
    this.lastParams = params
    /* ---------------- ① 清掉上一轮的可变资源 ---------------- */
    this._disposeLods()
    this._disposeCullChunks()
    // LOD 几何没了, 档位必须回到 0, 否则 updateLod 会以为还在低模档。
    this.lodLevel = 0
    /* ---------------- ② 生成几何 + 同步材质参数 ---------------- */
    const result = buildTree(params)
    this.ensureMaterials(params)
    updateMaterials(this.materials, params)

    /* ---------------- ③ 替换源网格(先摘除再 dispose) ---------------- */
    // 顺序不能反: 先 remove 再 dispose, 避免中间有一帧渲染到已释放的 geometry
    // (那会在控制台刷 "GL_INVALID_OPERATION" 甚至崩掉 GPU 进程)。
    if (this.barkMesh) {
      this.treeGroup.remove(this.barkMesh)
      this.barkMesh.geometry.dispose()
    }
    if (this.leafMesh) {
      this.treeGroup.remove(this.leafMesh)
      this.leafMesh.geometry.dispose()
      this.leafMesh = null
    }
    if (this.flowerMesh) {
      this.treeGroup.remove(this.flowerMesh)
      this.flowerMesh.geometry.dispose()
      // 花朵与树叶共用材质实例 -> 只释放几何, 不 dispose 材质
      this.flowerMesh.material = null
      this.flowerMesh = null
    }

    this.barkMesh = new THREE.Mesh(result.barkGeometry, this.materials.bark)
    this.barkMesh.castShadow = true
    this.barkMesh.receiveShadow = true
    this.barkMesh.name = 'Bark'
    this.treeGroup.add(this.barkMesh)

    // 树叶可能一片都没有(冬季/关闭树叶) —— 此时 result.leafGeometry 为 null。
    if (result.leafGeometry) {
      this.leafMesh = new THREE.Mesh(result.leafGeometry, this.materials.leaf)
      this.leafMesh.castShadow = true
      // 树叶是双面薄片, 接收阴影会产生自阴影条纹(acne), 因此只投影不接收。
      this.leafMesh.receiveShadow = false
      this.leafMesh.name = 'Leaves'
      this.treeGroup.add(this.leafMesh)
    }
    // 花朵: 独立网格, 材质继承树叶 (基础功能继承) —— 与树叶是否启用无关
    if (result.flowerGeometry) {
      this.flowerMesh = new THREE.Mesh(result.flowerGeometry, this.materials.flower || this.materials.leaf)
      this.flowerMesh.castShadow = true
      this.flowerMesh.receiveShadow = false
      this.flowerMesh.name = 'Flowers'
      this.treeGroup.add(this.flowerMesh)
    }
    /* ---------------- ④ 分块剔除 + 阴影 + 季节特效 ---------------- */
    // 把合并几何切成空间块: 每块独立包围球, 相机视锥外的块由 Three 自动剔除。
    // 源网格仍在 treeGroup 中 (隐藏于默认相机层), 供导出/统计/粒子采样/LOD/线框复用。
    this._buildCullChunks()
    this.applyShadowFlags()
    // 叶片粒子发射 (从叶片位置采样发射点)
    this.rebuildParticles(params)
    // 落叶 (真实叶片卡片, 从树冠落下)
    this.rebuildFall(params)
    this.rebuildFlowerFall(params)
    // 地面落叶堆积
    this.rebuildLitter(params)
    this.rebuildFlowerLitter(params)

    // 线框可能是"上次开着"的状态(wireBark/wireLeaf 已存在), 或本次参数要求开启;
    // 两种情况都要重挂一遍 —— 因为线框网格引用的是刚被 dispose 的旧几何。
    if (this.wireBark || this.wireLeaf || (params.scene && params.scene.wireframe && params.scene.wireframe !== 'off')) {
      this.applyWireframe(params.scene && params.scene.wireframe)
    }

    // 重建会新建/重新显示 mesh -> 伪装卡预览期间必须重新隐藏, 否则与真树叠加
    this._rehideForImpostorPreview()

    /* ---------------- ⑤ 统计量与场景尺度 ---------------- */
    // totalMs 记录"从进入 build 到几何就绪"的耗时, 是性能面板的主要指标。
    this.stats = { ...result.stats, totalMs: performance.now() - t }
    this.twistGuides = result.twistGuides || null
    // boxInfo 给的是树皮几何的包围盒中心; 用它而不是 (0,h/2,0),
    // 是因为树可能因为风偏/不对称生长而整体偏离原点。
    const info = boxInfo(result.barkGeometry)
    // 下限 0.5 米是防退化: 极小树苗或空几何会让 h 趋近 0, 后面的
    // LOD 距离阈值(h × 2.2)与阴影相机范围全部会塌成 0, 直接导致画面全黑。
    this.treeHeight = Math.max(0.5, this.stats.height)
    this.treeSpread = Math.max(0.5, this.stats.spread || 1)
    this.treeCenter = info.center.clone()

    /* ---------------- ⑥ 节点表 / 骨架叠层 / 回调 ---------------- */
    // 模型节点表 (节点树面板 + 选中高亮)
    this.nodes = result.nodes || []
    this.groups = result.groups || []
    this.skeleton = result.skeleton || null
    this._updateSkeletonOverlay(result.skeleton)
    // 重建后把变换轴重新贴到当前选中枝的最新枝基
    if (this.branchGizmo.show) this._syncBranchGizmo()

    if (opts.frameCamera !== false) this.frameCamera()
    // 重建后 LOD 缓存已清空, lodInfo 先只放 LOD0 一行; 之后 _ensureLod 会补 1/2。
    this.lodInfo = [{ level: 0, triangles: this._meshTriangles(this.barkMesh, this.leafMesh, this.flowerMesh), leaves: this.stats.leaves || 0 }]
    // 立刻按当前相机距离判一次档位: 如果重建时相机在远处, 这一帧就切到低模,
    // 不必等到下一帧 updateLod 才降级(否则远处重建会有一次满载渲染的卡顿)。
    this.updateLod()
    if (this.callbacks.onLod) this.callbacks.onLod({ level: this.lodLevel, levels: this.lodInfo })
    if (this.callbacks.onStats) this.callbacks.onStats(this.stats)
    if (this.callbacks.onModel) this.callbacks.onModel({ nodes: this.nodes, groups: this.groups })
    return this.stats
  }

  /* ------------------------------------------------------------------ */
  /* 骨架显示 (顶栏「骨架」按钮)                                          */
  /* ------------------------------------------------------------------ */
  /**
   * 显示/隐藏骨架叠层(顶栏「骨架」按钮)。
   *
   * 只切 visible, 不重建几何 —— 骨架数据在 build 时已经一次性烘成
   * 两个 BufferGeometry(线段 + 节点), 这里切换是零成本的。
   *
   * @param {boolean} v true = 显示
   */
  setSkeletonVisible(v) {
    this.showSkeleton = !!v
    if (this.skeletonGroup) this.skeletonGroup.visible = this.showSkeleton
  }

  /**
   * 用树骨架数据重建"骨架叠层"对象(线段 + 节点球点云)。
   *
   * 数据形状: skeleton = { nodes:[{pos,branch}], edges:[{from,to,branch}],
   *             branches:[{type,level,...}] }, 索引都是数组下标。
   *
   * 配色规则(肉眼快速分辨枝级):
   *   主干 trunk → 暖黄 (1.0, 0.82, 0.25)
   *   根系 root  → 橙   (1.0, 0.55, 0.2)
   *   普通枝     → 随 level 从青绿渐变到蓝 (level 1→5)
   *   未知       → 亮青 (0.35, 0.95, 1.0)
   *   level 被夹在 1..5 再归一化: 再深的枝在视觉上已无区分意义, 合并为同色。
   *
   * 渲染约定: depthTest=false + renderOrder 1000/1001 —— 骨架要"穿透"树皮可见,
   * 否则树冠内部的节点会被完全遮挡, 根本看不到结构。
   *
   * @param {Object|null} skeleton 来自 treeBuilder 的骨架; 空值表示只清除旧叠层
   * @sideeffect dispose 旧叠层的几何与材质, 新建并挂到 treeGroup
   */
  _updateSkeletonOverlay(skeleton) {
    // 先彻底拆掉旧叠层: traverse 里逐个 dispose, 因为线段与点云各有一套资源。
    if (this.skeletonGroup) {
      this.treeGroup.remove(this.skeletonGroup)
      this.skeletonGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) o.material.dispose()
      })
      this.skeletonGroup = null
    }
    if (!skeleton || !skeleton.nodes || !skeleton.edges) return
    const nodes = skeleton.nodes
    const branches = skeleton.branches
    const colorOf = (branch) => {
      if (!branch) return [0.35, 0.95, 1.0]
      if (branch.type === 'trunk') return [1.0, 0.82, 0.25]
      if (branch.type === 'root') return [1.0, 0.55, 0.2]
      const lv = Math.min(5, Math.max(1, branch.level || 1))
      const t = (lv - 1) / 4
      return [0.25 + 0.15 * t, 0.9 - 0.15 * t, 1.0]
    }
    // 四个扁平数组直接对应两个 BufferGeometry 的 position/color 属性:
    // line* 用于 LineSegments(每条边 2 个顶点, 颜色也要复制两份),
    // point* 用于 Points(每个节点 1 个顶点)。
    const linePos = [], lineCol = [], pointPos = [], pointCol = []
    for (const e of skeleton.edges) {
      const a = nodes[e.from], b = nodes[e.to]
      // 边界防御: 骨架里有悬空索引(理论上不该有)时跳过而不是产生 NaN 顶点,
      // 否则一个 NaN 就会让整个 BufferGeometry 的包围球失效、整层不渲染。
      if (!a || !b) continue
      const c = colorOf(branches[e.branch])
      linePos.push(a.pos.x, a.pos.y, a.pos.z, b.pos.x, b.pos.y, b.pos.z)
      lineCol.push(c[0], c[1], c[2], c[0], c[1], c[2])
    }
    for (const n of nodes) {
      const c = colorOf(branches[n.branch])
      pointPos.push(n.pos.x, n.pos.y, n.pos.z)
      pointCol.push(c[0], c[1], c[2])
    }
    const group = new THREE.Group()
    group.name = 'SkeletonOverlay'
    group.visible = this.showSkeleton
    if (linePos.length) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3))
      const m = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        fog: false,
      })
      const lines = new THREE.LineSegments(g, m)
      lines.name = 'SkeletonEdges'
      lines.frustumCulled = false
      lines.renderOrder = 1000
      group.add(lines)
    }
    if (pointPos.length) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pointPos, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(pointCol, 3))
      const m = new THREE.PointsMaterial({
        size: 2.4,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        fog: false,
      })
      const pts = new THREE.Points(g, m)
      pts.name = 'SkeletonNodes'
      pts.frustumCulled = false
      pts.renderOrder = 1001
      group.add(pts)
    }
    this.skeletonGroup = group
    this.treeGroup.add(group)
  }

  /* ------------------------------------------------------------------ */
  /* 单枝可视化变换轴 (Blender 风格 XYZ 轴/旋转环)                         */
  /* ------------------------------------------------------------------ */
  /**
   * 设置单枝变换轴: 显示/隐藏、选哪根枝、平移还是旋转、世界还是局部坐标系。
   *
   * 这是"单枝微调"的入口(UI 点某根枝后调用)。只有 index 有效且 show=true 时
   * 才真正把控制器贴到枝基; 其余情况一律走 _hideBranchGizmo 收起,
   * 保证不会出现"轴还在但指向已取消选中的枝"的错位状态。
   *
   * @param {{index?: number, mode?: string, space?: string, show?: boolean}} [opts]
   *   index = skeleton.branches 的下标; mode = 'translate' | 'rotate';
   *   space = 'world' | 'local'; show = 是否显示
   */
  setBranchTransformGizmo(opts = {}) {
    if (!this.transformControls) return
    if (opts.index !== undefined) this.branchGizmo.index = opts.index
    if (opts.mode) this.branchGizmo.mode = opts.mode
    if (opts.space) this.branchGizmo.space = opts.space
    if (opts.show !== undefined) this.branchGizmo.show = !!opts.show
    if (!this.branchGizmo.show || this.branchGizmo.index === null || this.branchGizmo.index === undefined) {
      this._hideBranchGizmo()
      return
    }
    this._syncBranchGizmo()
  }

  /**
   * 收起变换轴(脱离代理对象 + 隐藏 helper + 清掉脏标记)。
   * 注意只是 detach, 不销毁 TransformControls 本身 —— 它要复用。
   */
  _hideBranchGizmo() {
    if (!this.transformControls) return
    this.transformControls.detach()
    if (this.transformHelper) this.transformHelper.visible = false
    this._gizmoDirty = false
  }

  /**
   * 把变换轴的代理对象(branchPivot)贴到"当前选中枝"的枝基上。
   *
   * 难点在于**反解原始姿态**: 骨架里的 frames[0].pos / .dir 已经是"应用过
   * branchEdits"之后的结果, 而用户拖轴时给的是"相对原始姿态的增量"。
   * 所以要先把已应用的编辑量减/除回去, 得到原始枝基与原始方向:
   *
   *   原始枝基 = 当前枝基 - move           (位移可直接反解)
   *   原始方向 = 当前方向 · qEdit⁻¹         (旋转用四元数逆)
   *   基准姿态 baseQ = 把 +Y 旋到原始方向的四元数
   *   当前姿态 finalQ = qEdit · baseQ      (先摆正朝向, 再叠加用户旋转)
   *
   * 这样做的收益: 局部坐标系下的轴永远沿"枝自身的轴向", 而且连续拖动不会
   * 因为"把已有旋转又叠一次"而指数级放大角度。
   *
   * 期间用 _gizmoSyncing 屏蔽 objectChange 回调, 防止自己的写入被误判成拖动。
   * @sideeffect 修改 pivot 的 position/quaternion; 把 controller 重新 attach 到它
   */
  _syncBranchGizmo() {
    if (!this.skeleton || !this.branchGizmo.show) return
    // 拖动期间重建树时不要重置代理/控制器, 否则拖拽会被打断。
    if (this._gizmoDragging) return
    const idx = this.branchGizmo.index
    const branch = this.skeleton.branches && this.skeleton.branches[idx]
    if (!branch || !branch.frames || !branch.frames.length) {
      this._hideBranchGizmo()
      return
    }
    const edit = (this.lastParams && this.lastParams.branchEdits && this.lastParams.branchEdits[idx]) || {}
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    const move = new THREE.Vector3(num(edit.moveX), num(edit.moveY), num(edit.moveZ))
    // 骨架里的枝基已经是"编辑后"的位置: 原始枝基 = 当前枝基 - move。
    const finalBase = branch.frames[0].pos
    const originalBase = finalBase.clone().sub(move)
    const rot = new THREE.Euler(
      num(edit.rotX) * Math.PI / 180,
      num(edit.rotY) * Math.PI / 180,
      num(edit.rotZ) * Math.PI / 180,
      'XYZ',
    )
    const qEdit = new THREE.Quaternion().setFromEuler(rot)
    const dir = branch.frames[0].dir
    if (!dir || dir.lengthSq() < 1e-10) {
      this._hideBranchGizmo()
      return
    }
    // 骨架方向已经含 qEdit; 先反解出原始方向, 保证旋转轴/局部轴不会把
    // 已有的 rotX/Y/Z 再叠一次。
    const baseDir = dir.clone().applyQuaternion(qEdit.clone().invert()).normalize()
    // setFromUnitVectors(+Y, baseDir): 让代理对象的局部 +Y 指向枝条生长方向。
    // 用 +Y 是因为模型的"长轴约定"是 Y 向上, 旋转环在局部空间才有直觉含义。
    const baseQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), baseDir)
    // 先摆正朝向(baseQ), 再叠加用户编辑旋转(qEdit); 左乘=在世界系旋转。
    const finalQ = qEdit.clone().multiply(baseQ).normalize()
    // 记下基准, 提交时用它把绝对姿态换算回增量。
    this._gizmoBaseQuat.copy(baseQ)
    this._gizmoOriginalBase = originalBase

    this._gizmoSyncing = true
    this.branchPivot.position.copy(finalBase)
    this.branchPivot.quaternion.copy(finalQ)
    this.branchPivot.updateMatrixWorld(true)
    this.transformControls.setMode(this.branchGizmo.mode)
    this.transformControls.setSpace(this.branchGizmo.space)
    this.transformControls.attach(this.branchPivot)
    if (this.transformHelper) this.transformHelper.visible = true
    this._gizmoSyncing = false
    this._gizmoDirty = false
  }

  /**
   * 把代理对象当前的姿态换算成"相对原始枝基的增量", 通过 onBranchEdit 抛给上层,
   * 由上层写进 params.branchEdits 并触发重建 —— 本函数自己不改参数。
   *
   * 两种模式:
   *   translate: patch.moveX/Y/Z = pivot.position - 原始枝基 (单位: 米)
   *   rotate:    先算 qEdit = pivot.quaternion · baseQ⁻¹(剥掉朝向基准),
   *              再转成 XYZ 欧拉角并换成"度", 与 UI/参数的度数口径一致。
   *
   * 精度: 位移保留 5 位小数(≈0.01 毫米)、角度保留 3 位(≈0.001°)。
   * 这不是为了好看 —— 重建是"参数驱动"的, 若把 1e-17 级的浮点噪声写进参数,
   * 每一帧都会被判成"参数变了"从而无限重建; 取整等于给系统一个死区。
   *
   * @param {boolean} [final=true] true = 拖动结束的最终提交(会清掉待执行的节流定时器)
   * @sideeffect 调用 callbacks.onBranchEdit({index, patch}); 清 _gizmoDirty
   */
  _commitBranchGizmo(final = true) {
    if (!this._gizmoDirty || !this.skeleton || this.branchGizmo.index === null) return
    if (final && this._gizmoCommitTimer) {
      clearTimeout(this._gizmoCommitTimer)
      this._gizmoCommitTimer = 0
    }
    const idx = this.branchGizmo.index
    const branch = this.skeleton.branches && this.skeleton.branches[idx]
    if (!branch) return
    const patch = {}
    if (this.branchGizmo.mode === 'translate') {
      // 原始枝基在 _syncBranchGizmo 里算好后缓存; 万一还没算过(极端时序)就退回
      // 用当前枝基, 结果等价于"本次位移为 0", 安全但不会误写参数。
      const base = this._gizmoOriginalBase || (branch.frames[0].pos.clone())
      patch.moveX = +(this.branchPivot.position.x - base.x).toFixed(5)
      patch.moveY = +(this.branchPivot.position.y - base.y).toFixed(5)
      patch.moveZ = +(this.branchPivot.position.z - base.z).toFixed(5)
    } else if (this.branchGizmo.mode === 'rotate') {
      // 右乘 baseQ⁻¹: 把"绝对姿态"变成"相对基准的纯旋转增量"。
      const qEdit = this.branchPivot.quaternion.clone()
        .multiply(this._gizmoBaseQuat.clone().invert())
      // XYZ 顺序与参数面板的 rotX/rotY/rotZ 语义保持一致, 否则回填会跳变。
      const e = new THREE.Euler().setFromQuaternion(qEdit, 'XYZ')
      patch.rotX = +(e.x * 180 / Math.PI).toFixed(3)
      patch.rotY = +(e.y * 180 / Math.PI).toFixed(3)
      patch.rotZ = +(e.z * 180 / Math.PI).toFixed(3)
    }
    this._gizmoDirty = false
    // patch 为空(比如刚 attach 就被触发一次)时不提交, 避免无意义的重建。
    if (Object.keys(patch).length && this.callbacks.onBranchEdit) {
      this.callbacks.onBranchEdit({ index: idx, patch })
    }
  }

  /* ------------------------------------------------------------------ */
  /* 视锥分块渲染                                                        */
  /* ------------------------------------------------------------------ */
  /**
   * 把三块"整棵树一个几何"的合并网格切成空间分块, 交给 Three 的视锥剔除。
   *
   * 为什么需要: 合并后一棵树是一个 mesh, 它的包围球覆盖整棵树 —— 相机只要
   * 拍到任何一片叶子, 整棵树(几十万三角面)都会被提交绘制。切块后每块有
   * 自己的包围球, 画面外/背后的块整块被剔除, 典型视角能省掉 40%~60% 的三角形。
   *
   * 关键约定:
   *   - grid [2,2,2] → 最多 8 块。块数越多剔除越细, 但 draw call 也越多;
   *     8 块是"树这种近球形分布"的经验折中(更细的切分在树内部几乎不会再剔除)。
   *   - 分块网格放在默认相机层(layer 0), 源网格被 hideSourceMesh 移到
   *     SOURCE_ONLY_LAYER —— 两者合成后画面与切块前完全一致。
   *   - 树叶/花朵不接收阴影, 与源网格的标记保持一致。
   *
   * @sideeffect 向 treeGroup 添加分块 mesh, 并把源网格移出默认渲染层
   */
  _buildCullChunks() {
    // 先清掉旧的: 分块几何是从源几何复制出来的, 源几何一换就必须重建。
    this._disposeCullChunks()
    const add = (kind, mesh, material, shadow) => {
      if (!mesh || !mesh.geometry) return
      const chunks = buildFrustumChunks(mesh.geometry, material, {
        name: mesh.name || kind,
        grid: [2, 2, 2],
        castShadow: shadow.castShadow,
        receiveShadow: shadow.receiveShadow,
      })
      if (!chunks.length) return
      for (const m of chunks) {
        // enable(0): 确保分块在默认相机层可见(hideSourceMesh 把源网格移到了 31 层,
        // 这里显式打开 layer 0, 避免分块也继承了什么奇怪的层设置)。
        m.layers.enable(0)
        this.treeGroup.add(m)
        this._cullChunks.push({ kind, mesh: m })
      }
      // 源网格只保留给导出/统计/粒子/线框, 不参与默认相机层渲染
      hideSourceMesh(mesh)
    }
    add('bark', this.barkMesh, this.materials.bark, { castShadow: true, receiveShadow: true })
    add('leaf', this.leafMesh, this.materials.leaf, { castShadow: true, receiveShadow: false })
    add('flower', this.flowerMesh, this.materials.flower || this.materials.leaf, { castShadow: true, receiveShadow: false })
    this._syncCullChunks(0)
  }

  /**
   * 释放全部分块网格。
   * 只 dispose 几何: 材质是共享的(mats.bark / mats.leaf), 由 dispose() 统一释放。
   */
  _disposeCullChunks() {
    for (const c of this._cullChunks) {
      this.treeGroup.remove(c.mesh)
      // 分块几何是独立 BufferGeometry(顶点索引被重排过), 必须单独释放。
      c.mesh.geometry.dispose()
    }
    this._cullChunks = []
  }

  /**
   * 源网格的逻辑可见性(visible)同步到分块; LOD0 才用分块渲染。
   *
   * 为什么需要"同步": 分块和源网格是两套对象, 但对外应该表现为同一个东西。
   * 上层(线框模式、LOD 切换、伪装卡隐藏)改的是源网格的 visible, 这里把它
   * 传播给分块 —— 否则会出现"逻辑上隐藏了但画面还在"。
   *
   * @param {number} [level=this.lodLevel] 当前 LOD 档位; 只有 0 档才显示分块
   */
  _syncCullChunks(level = this.lodLevel) {
    if (!this._cullChunks.length) return
    const on = level === 0
    for (const c of this._cullChunks) {
      const src = c.kind === 'bark' ? this.barkMesh : c.kind === 'leaf' ? this.leafMesh : this.flowerMesh
      // 源网格可能整块不存在(例如此刻没有花), 那就一律隐藏。
      c.mesh.visible = on && !!src && src.visible !== false
    }
  }

  /* ------------------------------------------------------------------ */
  /* 动态 LOD (SpeedTree 式远景降级)                                      */
  /* ------------------------------------------------------------------ */
  /**
   * 统计若干网格的三角面总数(LOD 面板与统计口径的唯一实现)。
   *
   * 算法: 有索引的几何用 index.count / 3; 无索引(非索引几何, 顶点即三角形角点)
   * 用 position.count / 3。两者都是"每 3 个索引/顶点构成一个三角形"。
   * 结果四舍五入: 索引数理论上总能被 3 整除, 但若几何被手工裁过(比如视锥分块),
   * 可能出现不完整的尾巴, 这里不抛错而是直接取整, 保证面板上永远是整数。
   *
   * @param {...(THREE.Mesh|null|undefined)} meshes 可传任意个网格, 空值自动跳过
   * @returns {number} 三角面总数(非负整数)
   */
  _meshTriangles(...meshes) {
    let n = 0
    for (const m of meshes) {
      if (!m || !m.geometry) continue
      const g = m.geometry
      n += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0)
    }
    return Math.round(n)
  }

  /**
   * 释放全部低模: 摘出场景 + dispose 几何 + 断开材质引用 + 清空缓存。
   * 材质是共享的(与 LOD0 同一份), 所以只置 null 不 dispose。
   */
  _disposeLods() {
    for (const e of this.lodCache.values()) {
      for (const m of [e.barkMesh, e.leafMesh, e.flowerMesh]) {
        if (!m) continue
        this.treeGroup.remove(m)
        m.geometry.dispose()
        m.material = null
      }
    }
    this.lodCache.clear()
  }

  /**
   * 按需生成某一级 LOD 几何 (只在相机远离时第一次触发, 避免每次重建都算三套树)。
   *
   * 设计要点 —— **只抽稀叶片, 不动枝干**:
   *   远景下最先看不出差异的是叶片密度; 而树干/树枝的拓扑一旦变化, 树冠的
   *   分叉轮廓也会跟着变, 拉远/拉近就变成"换了一棵树"。所以这里沿用 LOD0
   *   的树参数, 只把 leafRatio 与 maxLeaves 按 keep 系数缩小, 其余参数原样克隆。
   *   叶片抽样是确定性等间隔的(见 treeBuilder), 保留下来的叶片位置与全模一致,
   *   切档时不会看到叶子"跳位置"。
   *
   * keep 系数(参数里可覆盖):
   *   LOD1 = keep1, 默认 0.30 → 叶量约 30%
   *   LOD2 = keep2, 默认 0.08 → 叶量约 8%
   * 都夹了 0.01 下限(几何上有意义的最小比例)与 leafRatio 的 0.002 下限,
   * 否则会出现 zero-division 或者"算出来 0 片叶子"的空网格。
   *
   * validate:false —— LOD 的树皮与 LOD0 逐字节相同, 拓扑校验已在 LOD0 做过;
   * 远景切换是高频路径, 不能再付一次 O(面数) 的扫描。
   *
   * @param {number} level 1 或 2(0 直接返回 null, 因为 0 档就是主网格)
   * @returns {Object|null} {level, barkMesh, leafMesh, flowerMesh, stats};
   *   生成失败(几何异常)时 warn 并返回 null, 由调用方降级回 0 档
   * @sideeffect 新几何加入 treeGroup(初始 visible=false)、更新 lodInfo、触发 onLod
   */
  _ensureLod(level) {
    if (level <= 0) return null
    if (this.lodCache.has(level)) return this.lodCache.get(level)
    const base = this.lastParams
    if (!base || !base.lod || !this.treeGroup) return null
    const cfg = base.lod
    // 该档位的叶量保留比例; level 只会是 1/2(前面已挡掉 <=0), 故用三元即可。
    const keep = level === 1 ? (cfg.keep1 === undefined ? 0.3 : cfg.keep1) : (cfg.keep2 === undefined ? 0.08 : cfg.keep2)
    // 深拷贝参数: buildTree 内部会就地写默认值, 直接传 base 会污染"当前参数"。
    const p = cloneParams(base)
    // 远景 LOD 只抽稀叶片: 树干/树枝/果实/花朵的几何必须与 LOD0 完全一致,
    // 否则相机拉远时会看到"换了一棵树"(枝条/分叉/果实形状全变了)。
    // 叶片抽稀是确定性等间隔抽样, 保留下来的叶片位置与全模一致。
    p.lod.leafRatio = Math.max(0.002, Math.min(1, (base.lod.leafRatio || 1) * Math.max(0.01, keep)))
    p.lod.maxLeaves = Math.max(40, Math.round((base.lod.maxLeaves || 60000) * Math.max(0.01, keep)))
    let r
    try {
      // LOD 几何与 LOD0 的树皮完全相同 (只抽稀叶片), 拓扑校验已由 LOD0 覆盖,
      // 这里跳过校验以免相机拉远时多花一次 O(面数) 的扫描。
      r = buildTree(p, { validate: false })
    } catch (err) {
      console.warn('[LOD] 生成失败:', err)
      return null
    }
    const entry = {
      level,
      barkMesh: new THREE.Mesh(r.barkGeometry, this.materials.bark),
      leafMesh: r.leafGeometry ? new THREE.Mesh(r.leafGeometry, this.materials.leaf) : null,
      flowerMesh: r.flowerGeometry ? new THREE.Mesh(r.flowerGeometry, this.materials.flower || this.materials.leaf) : null,
      stats: r.stats,
    }
    entry.barkMesh.name = 'Bark-LOD' + level
    entry.barkMesh.castShadow = true
    entry.barkMesh.receiveShadow = true
    if (entry.leafMesh) {
      entry.leafMesh.name = 'Leaves-LOD' + level
      entry.leafMesh.castShadow = true
      entry.leafMesh.receiveShadow = false
    }
    if (entry.flowerMesh) {
      entry.flowerMesh.name = 'Flowers-LOD' + level
      entry.flowerMesh.castShadow = true
      entry.flowerMesh.receiveShadow = false
    }
    for (const m of [entry.barkMesh, entry.leafMesh, entry.flowerMesh]) {
      if (!m) continue
      // 先隐藏: 只有 applyLod 切到该档时才打开, 避免刚生成就"跳"出来。
      m.visible = false
      this.treeGroup.add(m)
    }
    this.lodCache.set(level, entry)
    this.lodInfo = this._buildLodInfo()
    if (this.callbacks.onLod) this.callbacks.onLod({ level: this.lodLevel, levels: this.lodInfo })
    return entry
  }

  /**
   * 汇总所有已知档位的统计数据, 供 LOD 面板展示与外部自检。
   * 第 0 行永远存在(LOD0 = 主网格); 之后按 level 升序追加缓存里的档位。
   * triangles 的统计口径与 _meshTriangles 一致(同一实现, 保证可比)。
   *
   * @returns {Array<{level: number, triangles: number, leaves: number}>}
   */
  _buildLodInfo() {
    const info = [{ level: 0, triangles: this._meshTriangles(this.barkMesh, this.leafMesh, this.flowerMesh), leaves: this.stats ? this.stats.leaves || 0 : 0 }]
    for (const level of [...this.lodCache.keys()].sort((a, b) => a - b)) {
      const e = this.lodCache.get(level)
      info.push({
        level,
        triangles: this._meshTriangles(e.barkMesh, e.leafMesh, e.flowerMesh),
        leaves: (e.stats && e.stats.leaves) || 0,
      })
    }
    return info
  }

  /**
   * 切换显示的 LOD 档位 (0 = 全模)。
   *
   * 可见性矩阵只有一行"真值": 目标档位 = 0 时显示三块源网格对应的**分块**,
   * 否则显示缓存里 level 相同的那套低模, 其余全部隐藏。
   * 注意档位被硬夹在 0..2(只有两级降级几何); 若请求的档位生成失败,
   * 静默降级回 0 —— 宁可多画三角形, 也不能让画面空掉。
   *
   * @param {number} level 期望档位 0/1/2(会被四舍五入并夹紧)
   * @sideeffect 修改大量 mesh.visible、重建 lodInfo、触发 onLod 回调
   */
  applyLod(level) {
    let target = Math.max(0, Math.min(2, Math.round(level || 0)))
    // 惰性生成: LOD1/2 第一次被切到才算, 算完立刻用。
    if (target > 0 && !this._ensureLod(target)) target = 0
    this.lodLevel = target
    // 源网格本身永远"逻辑可见"(导出/统计要用), 真正渲染的是分块, 由下面同步。
    if (this.barkMesh) this.barkMesh.visible = target === 0
    if (this.leafMesh) this.leafMesh.visible = target === 0
    if (this.flowerMesh) this.flowerMesh.visible = target === 0
    this._syncCullChunks(target)
    for (const e of this.lodCache.values()) {
      const on = e.level === target
      if (e.barkMesh) e.barkMesh.visible = on
      if (e.leafMesh) e.leafMesh.visible = on
      if (e.flowerMesh) e.flowerMesh.visible = on
    }
    // 阴影标记与档位相关(隔离模式会关投影), 切档后要重算一遍。
    this.applyShadowFlags()
    this.lodInfo = this._buildLodInfo()
    if (this.callbacks.onLod) this.callbacks.onLod({ level: target, levels: this.lodInfo })
  }

  /**
   * 每帧检查相机距离, 在 LOD 档位之间切换 (带滞回, 避免边界抖动)。
   *
   * 阈值定义(都以树高 h 为单位, 因此不同尺寸的树行为一致):
   *   d1 = h × distance1 (默认 2.2)  —— 超过它降到 LOD1
   *   d2 = h × distance2 (默认 4.5)  —— 超过它降到 LOD2
   * 用"树高倍数"而不是绝对米数: 一棵 3 米的小树和 30 米的大树, 在各自
   * 直径的同样倍数处视觉密度才相当。
   *
   * 滞回(hysteresis): 若只按单阈值判断, 相机停在边界上时会每帧来回切换,
   * 造成可见的"叶量闪烁"。所以进入某档用 1.06 倍的宽容边界, 退回用 0.94 倍,
   * 形成一个 6% 的死区 —— 只有明确越过才换档。
   *
   * 强制全模的三种情况: 未开启动态 LOD / 处于选中(高亮或隔离) / 线框模式。
   * 后两者都是基于 LOD0 的节点 id 与几何实现的, 切到低模会出现
   * "高亮错位"或"线框缺枝", 因此宁可牺牲性能。
   *
   * @sideeffect 需要换档时调用 applyLod
   */
  updateLod() {
    const cfg = this.lastParams && this.lastParams.lod
    if (!cfg) return
    // force 是"手动锁档"通道: 'auto' 表示按距离自动; 数字字符串则强制该档。
    const force = String(cfg.force === undefined ? 'auto' : cfg.force)
    let desired = 0
    if (!cfg.dynamic) {
      desired = 0
    } else if (this.selectMode !== 0 || this.wireBark || this.wireLeaf) {
      // 选中高亮 / 线框叠加都基于 LOD0 的节点 id 与几何, 强制全模
      desired = 0
    } else if (force !== 'auto') {
      desired = Math.max(0, Math.min(2, Math.round(Number(force) || 0)))
    } else if (this.treeCenter && this.camera) {
      // 树高下限 0.5 米: 防止未建树/退化几何导致阈值塌成 0(那样会一直卡在低模)。
      const h = Math.max(0.5, this.treeHeight || 8)
      const d1 = h * Math.max(0.2, cfg.distance1 === undefined ? 2.2 : cfg.distance1)
      const d2 = h * Math.max(0.3, cfg.distance2 === undefined ? 4.5 : cfg.distance2)
      // 用相机到树心(而非最近点)的距离: 树心稳定, 不会因树冠摆动而抖。
      const dist = this.camera.position.distanceTo(this.treeCenter)
      const cur = this.lodLevel
      desired = dist < d1 ? 0 : dist < d2 ? 1 : 2
      // 滞回: 已经在该档附近时不要来回跳
      if (cur === 0 && dist < d1 * 1.06) desired = 0
      else if (cur === 1 && dist > d1 * 0.94 && dist < d2 * 1.06) desired = 1
      else if (cur === 2 && dist > d2 * 0.94) desired = 2
    }
    // 只有真要换档才 applyLod(它会重建 lodInfo 并回调 UI), 避免每帧无谓开销。
    if (desired !== this.lodLevel) this.applyLod(desired)
  }

  /* ------------------------------------------------------------------ */
  /* 扭曲句柄: 把树干/代表枝的骨架投影到屏幕 (给 TwistGizmo 叠层用)       */
  /* ------------------------------------------------------------------ */
  /**
   * 把树干(或某一级代表枝)的骨架折线投影到**屏幕像素坐标**, 供 TwistGizmo
   * 这类 2D 叠层控件画手柄。
   *
   * 坐标转换链:
   *   世界坐标 → project(camera) 得到 NDC(-1..1, 注意 Y 向上) →
   *   x = (ndc.x * 0.5 + 0.5) * 宽, y = (-ndc.y * 0.5 + 0.5) * 高(翻 Y 成屏幕坐标)。
   *   宽高取 canvas 的 CSS 尺寸(clientWidth/Height), 而不是绘制缓冲尺寸 ——
   *   叠层 DOM 是按 CSS 像素布局的, 拿 devicePixelRatio 放大后的尺寸会错位。
   *
   * 手柄位置: TWIST_TIMES 是一组固定的归一化位置(0..1, 沿枝长), 用线性插值
   * 在自己的折线点列上取对应点 —— 每个手柄返回 {x, y, t}, 其中 t 是归一化弧长,
   * 上层把它当作"沿枝的哪一段"再映射回参数。
   *
   * @param {string} [target='trunk'] 'trunk' 取主干投影; 'branches' 取指定级代表枝
   * @param {number} [level=1] target='branches' 时的枝级(1 起)
   * @returns {{width: number, height: number,
   *            points: Array<{x: number, y: number}>,
   *            handles: Array<{x: number, y: number, t: number}>}|null}
   *   null 表示没有骨架数据(还没建树 / 该级不存在 / 点数不足以插值)
   */
  projectTwistGuide(target = 'trunk', level = 1) {
    if (!this.twistGuides || !this.camera) return null
    // 投影数据是扁平数组 [x0,y0,z0, x1,y1,z1, ...](世界坐标)。
    const guide = target === 'branches'
      ? (this.twistGuides.branches && this.twistGuides.branches[level])
      : this.twistGuides.trunk
    // 少于 2 个点(6 个分量)画不出折线, 也就无法插值出手柄。
    if (!guide || guide.length < 6) return null
    const n = Math.floor(guide.length / 3)
    const el = this.renderer.domElement
    // 尺寸兜底为 1: 隐藏中的 viewport 宽高为 0, 会得到 Infinity/NaN 坐标。
    const w = el.clientWidth || 1
    const h = el.clientHeight || 1
    const v = new THREE.Vector3()
    const points = []
    for (let i = 0; i < n; i++) {
      v.set(guide[i * 3], guide[i * 3 + 1], guide[i * 3 + 2]).project(this.camera)
      points.push({ x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h })
    }
    // 手柄: 把 t∈[0,1] 映射到点列下标 x = t*(n-1), 在相邻两点间线性插值。
    // i0 夹到 n-2 是因为 x 可能正好等于 n-1, 此时 i0+1 会越界。
    const handles = TWIST_TIMES.map((t) => {
      const x = t * (n - 1)
      const i0 = Math.max(0, Math.min(n - 2, Math.floor(x)))
      const f = x - i0
      const a = points[i0]
      const b = points[Math.min(n - 1, i0 + 1)]
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, t }
    })
    return { width: w, height: h, points, handles }
  }

  /* ------------------------------------------------------------------ */
  /* 模型节点: 选中高亮 / 隔离 / 包围盒 / 聚焦                            */
  /* ------------------------------------------------------------------ */
  /**
   * 应用"模型节点选中"状态 —— 高亮 / 只显示 / 其余变暗。
   *
   * 数据流(整条链上没有 raycast: 选中**不是**靠鼠标射线拾取, 而是从节点树面板
   * 或 MCP 的 app.select_node 拿到节点 id, 再下发给着色器):
   *   NodePanel.vue / app.select_node
   *     → treeStore.selectNodes(ids) 组装 state.selection
   *       { ids, material, mode, ranges, color, glow, dim, box }
   *     → Viewport.vue 的 watch 调 scene.setSelection(sel)
   *     → 本函数把 ids 压成"节点 id 区间"写进 uniform
   *     → 顶点着色器比较顶点属性 aNodeId 是否落在区间内 → vTreeSelected
   *     → 片元着色器据 uSelectMode 决定: 提亮/丢弃/变暗
   *   ！注意: 高亮完全是 GPU 侧按节点 id 算的, 不重建几何, 所以拖选是实时的。
   *
   * 为什么传"区间"而不是 id 列表: uniform 数组长度有限(这里固定 8 个 vec2),
   * 而一次选中可能有上千个节点。树骨架的节点 id 是按生成顺序连续分配的,
   * 一棵子树往往对应一段连续 id, 因此用 [startId, endId] 闭区间就够表达了;
   * 每种材质的分组再各自压成最多 8 段。
   *
   * @param {{ids?: number[], material?: string, mode?: string,
   *          ranges?: Array<[number, number]>, color?: string,
   *          glow?: number, dim?: number,
   *          box?: {min: number[], max: number[]}}} sel
   *   mode: 'highlight' 高亮 | 'isolate' 只显示 | 'dim' 其余变暗
   *   material: 'bark' 只作用于树皮 | 'leaf' 只作用于树叶 | 其它=不过滤
   *   ranges: 节点 id 闭区间, 最多取前 8 段
   *   box: 选中范围的世界坐标包围盒(米), 用于画黄框
   * @sideeffect 写入 6 个选中 uniform、刷新选中框与阴影标记
   */
  setSelection(sel) {
    const u = this.uniforms
    // 没有任何目标(ids 空且未指定材质) 视为"取消选中", 直接把模式归 0。
    const hasTarget = (sel.ids && sel.ids.length > 0) || sel.material != null
    const modeMap = { highlight: 1, isolate: 2, dim: 3 }
    this.selectMode = hasTarget ? (modeMap[sel.mode] || 1) : 0
    u.uSelectMode.value = this.selectMode
    // uSelectMaterial: -1 不过滤(树皮+树叶都算) / 0 树皮 / 1 树叶;
    // 着色器里用 abs(uSelectMaterial - uIsLeaf) < 0.5 做判定。
    u.uSelectMaterial.value = sel.material === 'bark' ? 0 : sel.material === 'leaf' ? 1 : -1
    const ranges = sel.ranges || []
    // 8 是 uniform 数组的固定长度(uSelRanges[8]), 超出部分只能丢弃。
    const n = Math.min(8, ranges.length)
    u.uSelRangeCount.value = n
    for (let i = 0; i < 8; i++) {
      const v = u.uSelRanges.value[i]
      // 未使用的槽位填 (0, -1): start > end 的空区间, 保证永远不会命中任何节点
      // (节点 id 从 0 起非负)。必须显式填, 否则会残留上一轮的选中范围。
      if (i < n) v.set(ranges[i][0], ranges[i][1])
      else v.set(0, -1)
    }
    // 默认琥珀色: 在深色树皮与绿色树叶上都够醒目, 且不像纯红那样像报错。
    u.uSelColor.value.set(sel.color || '#ffd166')
    // glow = 高亮叠加的自发光强度; dim = 非选中部分的亮度衰减系数
    u.uSelGlow.value = sel.glow === undefined ? 0.35 : sel.glow
    u.uSelDim.value = sel.dim === undefined ? 0.35 : sel.dim
    this.setSelectionBox(sel.box || null)
    this.applyShadowFlags()
  }

  /**
   * 同步阴影标记：总开关、隔离模式、以及"静态/动态"两套投影材质。
   *
   * 隔离模式下被隐藏的几何不该再投影 (阴影 pass 用的是独立depth材质, 看不到选中逻辑)。
   *
   * 原因: "只显示选中"是靠片元里 discard 实现的, 但阴影贴图是用另一套 depth 材质
   * 渲染的, 那里没有我们的选中判定 —— 于是被隐藏的叶子仍然在地上投出影子,
   * 看起来像"树叶幽灵"。解决办法是在隔离模式下直接关掉 castShadow。
   *
   * 动态阴影(dynamicShadows)开启时, 每个投影网格挂上 `customDepthMaterial`:
   * 它注入了与主材质相同的风场/生长顶点位移, 影子会跟着树一起摆动/生长。
   * 关闭时不挂(还原默认的静止姿态深度材质), 并由 updateScene 冻结阴影重算。
   *
   * 覆盖范围: 源树皮/树叶/花朵、所有视锥分块(含花朵分块)、所有 LOD 档位的
   * 树皮/树叶/花朵。花朵源网格的 castShadow 在 build 里固定为 true, 不参与
   * 这里的开关 —— 花朵在隔离模式下的表现由分块统一处理。
   *
   * @sideeffect 批量修改 mesh.castShadow / mesh.customDepthMaterial;
   *   静态阴影模式下标记阴影贴图需要重算一次。
   */
  applyShadowFlags() {
    const isolate = this.selectMode === 2
    const on = !!this.shadowsEnabled && !isolate
    const dynamic = on && !!this.dynamicShadows
    if (this.barkMesh) this.barkMesh.castShadow = on
    if (this.leafMesh) this.leafMesh.castShadow = on
    for (const c of this._cullChunks) {
      c.mesh.castShadow = on
      c.mesh.customDepthMaterial = dynamic ? this._depthMaterialFor(c.mesh.material) : undefined
    }
    for (const e of this.lodCache.values()) {
      if (e.leafMesh) e.leafMesh.castShadow = on
      if (e.barkMesh) e.barkMesh.castShadow = on
      if (e.flowerMesh) e.flowerMesh.castShadow = on
      for (const m of [e.barkMesh, e.leafMesh, e.flowerMesh]) {
        if (m) m.customDepthMaterial = dynamic ? this._depthMaterialFor(m.material) : undefined
      }
    }
    // 静态阴影只在"标志变了"时重算一次; 动态阴影由 autoUpdate 每帧刷新。
    if (this.shadowsEnabled && !this.dynamicShadows) this.renderer.shadowMap.needsUpdate = true
  }

  /**
   * 懒创建某个主材质对应的动态阴影深度材质。
   * 每个主材质一份: uIsLeaf / uSway / uLeafFlutter / uLeafTwist 这些"每材质不同"的
   * uniform 必须与主材质一致, 否则树叶在阴影里的运动形态会与树体对不上。
   * 同材质的多个网格(分块/LOD)共用一份; three 在投影时会各自复制 map/alphaTest/side。
   *
   * @param {THREE.Material} material 主材质(树皮/树叶/花朵)
   * @returns {THREE.MeshDepthMaterial}
   */
  _depthMaterialFor(material) {
    let dm = this._depthMaterials.get(material)
    if (!dm) {
      dm = createTreeDepthMaterial(this.uniforms, (material.userData && material.userData.uniforms) || {})
      this._depthMaterials.set(material, dm)
    }
    return dm
  }

  /**
   * 显示/隐藏选中范围的包围框(琥珀色线框立方体)。
   *
   * 做法: 用一个 Box3Helper 长期复用(惰性创建), 只改它内部 Box3 的 min/max。
   * depthTest=false —— 包围框要能"透过"树皮看到, 否则选中细枝时框会被树干挡住。
   * renderOrder=10: 在全部不透明物之后画, 保证叠在画面上层。
   *
   * @param {{min: number[], max: number[]}|null} box 世界坐标 min/max(米);
   *   传 null / 缺字段表示隐藏
   */
  setSelectionBox(box) {
    if (!box || !box.min || !box.max) {
      if (this.selBox) this.selBox.visible = false
      return
    }
    if (!this.selBox) {
      const b3 = new THREE.Box3()
      this.selBox = new THREE.Box3Helper(b3, 0xffd166)
      this.selBox.material.depthTest = false
      this.selBox.material.transparent = true
      this.selBox.material.opacity = 0.9
      this.selBox.renderOrder = 10
      this.scene.add(this.selBox)
    }
    this.selBox.box.min.set(box.min[0], box.min[1], box.min[2])
    this.selBox.box.max.set(box.max[0], box.max[1], box.max[2])
    this.selBox.visible = true
    this.selBox.updateMatrixWorld(true)
  }

  /**
   * 把相机聚焦到某个包围盒(节点树双击 / MCP 的定位指令)。
   *
   * 保持当前视线方向不变, 只沿它推近/拉远:
   *   方向 dir = 相机位置 - 控制点, 归一化后作为"观察朝向";
   *   新机位 = 中心 + dir × (最大边长 × 2.3)。
   * 2.3 是经验系数: 让目标占画面约 2/3, 既不贴脸也不至于太小。
   * size 下限 0.4 米: 选中单个细枝时包围盒可能只有几厘米, 不设下限相机会
   * 一头钻进枝条内部(近裁剪面内), 画面变成一坨糊。
   *
   * @param {number[]} min 包围盒最小角(世界坐标, 米)
   * @param {number[]} max 包围盒最大角(世界坐标, 米)
   */
  focusBox(min, max) {
    if (!min || !max) return
    const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0.4)
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target)
    // 相机与控制点重合时方向为零向量(无法归一化) -> 退回到一个固定的斜侧视角。
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.5, 0.8)
    dir.normalize()
    this.controls.target.copy(c)
    this.camera.position.copy(c).addScaledVector(dir, size * 2.3)
    this.controls.update()
  }

  /**
   * 按当前树的尺寸自动取景(重建完成后默认调用)。
   *
   * 取景逻辑:
   *   观察距离 d = max(树高 × padding, 冠幅 × 1.75) —— 取两者较大值,
   *   保证"又高又窄"和"又矮又宽"的树都不会出画; 1.75 是冠幅的经验系数
   *   (冠幅是直径, 换算成视野需要约 1.6~1.8 倍)。
   *   控制点放在树高 45% 处(视觉重心略低于几何中点, 因为树冠更吸睛)。
   *   机位 = (0.62d, 0.66h, 0.78d): 斜侧 45° 左右的经典 3/4 视角。
   *
   * 同时按树高重算远近裁剪面:
   *   near = max(0.03, 树高 × 0.004) —— 大树也要能贴近看树皮纹理;
   *   far  = max(400, 树高 × 60)    —— 要能容纳星空球(半径约 360)。
   * 最后把太阳的阴影正交相机范围贴合到树(±1.25h), 否则小树只用到阴影图的
   * 一小块分辨率、大树则会超出阴影范围丢阴影。
   *
   * @param {number} [padding=1.35] 取景余量系数, 大于 1 会把镜头拉远
   * @sideeffect 修改 camera 位置/裁剪面、controls.target、太阳阴影相机
   */
  frameCamera(padding = 1.35) {
    const h = this.treeHeight || 8
    const spread = this.treeSpread || h * 0.6
    const d = Math.max(h * padding, spread * 1.75)
    this.controls.target.set(0, h * 0.45, 0)
    this.camera.position.set(d * 0.62, h * 0.66, d * 0.78)
    this.camera.near = Math.max(0.03, h * 0.004)
    this.camera.far = Math.max(400, h * 60)
    this.camera.updateProjectionMatrix()
    this.controls.update()
    // 阴影相机贴合树木
    const size = h * 1.25
    this.sun.shadow.camera.left = -size
    this.sun.shadow.camera.right = size
    this.sun.shadow.camera.top = size
    this.sun.shadow.camera.bottom = -size
    this.sun.shadow.camera.near = 0.5
    this.sun.shadow.camera.far = size * 6
    this.sun.shadow.camera.updateProjectionMatrix()
  }

  /* ------------------------------------------------------------------ */
  /* 场景参数                                                            */
  /* ------------------------------------------------------------------ */
  /**
   * 应用"场景/环境"设置(背景、天空、星空、地面、灯光、雾、线框)。
   *
   * 数据来源是 UI 的"环境"面板(以及季节/时段预设), 本函数只动灯光与材质外的
   * 场景对象, **不重建任何树的几何** —— 换背景/调曝光都是实时的。
   *
   * 几个容易踩的点:
   *   - 线框模式只在"模式真的变了"时才重挂: applyWireframe 会新建/销毁 mesh,
   *     每帧调用会持续产生垃圾并且闪烁。
   *   - 星空强度 0 表示关闭; 大于 0 时同时调 opacity 与点尺寸, 让"微星/满天星"
   *     的观感差异明显, 而不是只有亮度变化。
   *   - 雾的近端固定为 far × 0.35: 保持"远处渐隐、近处清晰"的固定比例,
   *     far 随树高与 fogScale 缩放, 所以不同尺度的树看起来雾感一致。
   *   - 太阳位置用球坐标: 方位角 azimuth、仰角 elevation(都是度, 0° 仰角 = 地平线),
   *     r 至少 12 米(树高的 2.4 倍), 保证平行光方向在树附近基本恒定。
   *
   * @param {Object} s 场景参数分片；字段含 background / wireframe / gradient /
   *   skyTop / skyBottom / stars / ground / groundColor / grid / exposure /
   *   autoRotate / shadows / dynamicShadows / sunColor / sunIntensity / hemiSky /
   *   hemiGround / ambient / fog / fogColor / fogScale / sunAzimuth / sunElevation
   * @sideeffect 修改场景背景与雾、天空材质、星空材质、灯光与阴影开关、
   *   renderer 曝光、轨道自动旋转、线框网格
   */
  updateScene(s) {
    this.scene.background = new THREE.Color(s.background)
    // 线框展示模式 (展示三角面)
    const wire = s.wireframe || 'off'
    if (wire !== (this._wireMode || 'off')) {
      this._wireMode = wire
      if (this.barkMesh) this.applyWireframe(wire)
    }

    // 渐变天空: 关掉时把穹顶整体隐藏, 露出 scene.background 的纯色背景。
    if (s.gradient) {
      this.sky.visible = true
      this.skyMat.uniforms.uTop.value.set(s.skyTop)
      this.skyMat.uniforms.uBottom.value.set(s.skyBottom)
    } else {
      this.sky.visible = false
    }
    // 星空: 强度 0 关闭; 否则按强度调透明/大小 (黑夜/群星预设使用)
    const starStrength = Math.max(0, Math.min(1, Number(s.stars) || 0))
    if (this.stars) {
      this.stars.visible = starStrength > 0
      if (this.starsMat) {
        this.starsMat.opacity = 0.35 + starStrength * 0.65
        this.starsMat.size = 1.1 + starStrength * 1.6
      }
    }
    this.ground.visible = !!s.ground
    this.groundMat.color.set(s.groundColor)
    this.grid.visible = !!s.grid
    this.renderer.toneMappingExposure = s.exposure
    this.controls.autoRotate = !!s.autoRotate
    // 0.8 是"慢速巡览"的经验值: OrbitControls 的速度单位约为 30°/秒 × 系数,
    // 再快就像在转盘上甩, 慢到 0.5 又几乎看不出在动。
    this.controls.autoRotateSpeed = 0.8
    // 三处必须同步: renderer 的总开关、太阳的 castShadow、以及本类缓存的
    // shadowsEnabled —— applyShadowFlags 只认最后这个, 漏一处就会出现
    // "阴影明明关了但地上还有黑块"或反之。
    this.renderer.shadowMap.enabled = !!s.shadows
    this.shadowsEnabled = !!s.shadows
    this.sun.castShadow = !!s.shadows
    // 动态阴影: 开 = 阴影贴图每帧重算, 随太阳角度/风场/生长实时变化;
    // 关 = 只在场景参数或几何变化时重算一次(autoUpdate=false), 省掉每帧
    // 多一遍全树深度绘制。老预设没有该字段时按开启处理。
    this.dynamicShadows = s.dynamicShadows === undefined ? true : !!s.dynamicShadows
    this.renderer.shadowMap.autoUpdate = this.shadowsEnabled && this.dynamicShadows
    this.sun.color.set(s.sunColor || '#fff2e0')
    this.sun.intensity = s.sunIntensity === undefined ? 3.1 : s.sunIntensity
    this.hemi.color.set(s.hemiSky || '#c8dcff')
    this.hemi.groundColor.set(s.hemiGround || '#3a2f24')
    this.hemi.intensity = s.ambient === undefined ? (s.gradient ? 1.15 : 0.85) : s.ambient
    if (s.fog) {
      // far 至少 60 米(再近会让中等大小的树都被雾吞掉); fogScale 允许预设
      // 单独拉远/压缩雾的可见距离, 下限 0.1 防止设成 0 之后整个场景糊成一片。
      const far = Math.max(60, (this.treeHeight || 8) * 14) * (s.fogScale === undefined ? 1 : Math.max(0.1, s.fogScale))
      const fogColor = new THREE.Color(s.fogColor || s.background)
      // 近端固定取 far 的 35%: 保持"近处清晰、远处渐隐"的固定比例,
      // 这样换树/换预设时雾的观感不会突变。
      this.scene.fog = new THREE.Fog(fogColor, far * 0.35, far)
    } else {
      this.scene.fog = null
    }
    // 太阳位置: 球坐标 → 世界坐标。azimuth/elevation 都是"度"。
    //   x = cos(az)·cos(el)·r, y = sin(el)·r, z = sin(az)·cos(el)·r
    // 即 az=0 时光从 +X 方向照来, el=90 时是正上方顶光。
    const az = (s.sunAzimuth || 0) * Math.PI / 180
    const el = (s.sunElevation || 40) * Math.PI / 180
    const r = Math.max(12, (this.treeHeight || 8) * 2.4)
    this.sun.position.set(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r)
    // 平行光的 target 落在树高 35% 处: 让阴影相机大致以树干中部为中心,
    // 树冠与根部都能落在阴影图范围内。
    this.sun.target.position.set(0, (this.treeHeight || 8) * 0.35, 0)
    this.sun.target.updateMatrixWorld()
    // 把太阳方向与强度同步给自定义着色器(树皮/树叶的 PBR 补光用):
    // 方向必须是单位向量; 颜色按强度做归一化衰减, 2.5 是"白色主光"的参考强度,
    // 超过它的部分不再继续变亮(避免自发光过曝)。
    this.uniforms.uSunDir.value.copy(this.sun.position).normalize()
    this.uniforms.uSunColor.value.copy(this.sun.color).multiplyScalar(Math.min(1, this.sun.intensity / 2.5))
    this.applyShadowFlags()
  }

  /**
   * 设置生长动画状态。
   *
   * 生长不是"几何重算", 而是顶点着色器里的一次插值:
   * 每个顶点带 aGrow = (开始时间, 结束时间) 属性, 着色器按
   * growK = clamp((uGrowth - start) / (end - start), 0, 1) 把顶点从 aOrigin
   * 移到最终位置 —— 于是树干先长、枝梢后长, 呈现"抽枝"效果。
   * 因此这里只需把 value 写进 uGrowth, 完全不动几何。
   *
   * @param {Object} growth 生长配置(含 enabled 开关)
   * @param {number} value 生长进度 0..1(0 = 尚未长出, 1 = 完整)
   * @sideeffect 写 uGrowth / uGrowthEnabled; 更新 this.growthValue
   */
  updateGrowth(growth, value) {
    this.growthValue = value
    updateGrowthUniforms(this.uniforms, growth, value)
  }

  /**
   * 自动生长: 每帧把 uGrowth 从当前值推到 1。
   *
   * @param {boolean} auto true = 由 tick 每帧自增
   * @param {number} [speed] 速度(归一化进度/秒); 省略则沿用当前值, 传 0 会被忽略
   * @sideeffect 修改 growthAuto / growthSpeed
   */
  setGrowthAuto(auto, speed) {
    this.growthAuto = !!auto
    // 用 truthy 判断而不是 !== undefined: 速度 0 会让生长永远停在原地,
    // 语义上等于"关掉自动", 没有使用价值, 直接忽略更安全。
    if (speed) this.growthSpeed = speed
  }

  /**
   * 暂停/继续风场时间(相机依旧可自由操作, 只是树木静止)。
   * @param {boolean} p true = 继续推进 uTime
   */
  setPlaying(p) {
    this.playing = !!p
  }

  /**
   * 把相机的地面基交给风向指示器: 屏幕右方向 + 屏幕"远去"方向的水平投影。
   *
   * 返回两个世界空间单位向量, 供 UI 上的罗盘把"风向角度"画成屏幕上看得懂的箭头:
   *   right = 相机局部 +X(世界化后归一化) —— 屏幕水平向右
   *   fwd   = 相机视线方向(相机看向 -Z, 故作负)的水平投影再归一化
   *           —— 即"画面往里"的地面方向, 用来把风向投影成 2D 箭头。
   * fwd 必须先压平到水平面(Y 置 0)再归一化: 俯视时视线的水平分量会趋近 0,
   * 这里用 hypot 兜底为 1 避免除零(NaN 会让指示器直接消失)。
   *
   * @returns {{right: number[], fwd: number[]}} 两个 [x, y, z] 世界向量
   */
  getWindScreenBasis() {
    const m = this.camera.matrixWorld.elements
    const right = new THREE.Vector3(m[0], m[1], m[2]).normalize()
    const fwd = new THREE.Vector3(-m[8], -m[9], -m[10]) // 相机看向 -Z
    const fl = Math.hypot(fwd.x, fwd.z) || 1
    return {
      right: [right.x, right.y, right.z],
      fwd: [fwd.x / fl, 0, fwd.z / fl],
    }
  }

  /**
   * 线框展示: off / overlay (实体+线框) / only (只看三角面)。
   *
   * 实现方式是**另建一层 MeshBasicMaterial + wireframe:true 的副本网格**,
   * 而不是把材质自身的 wireframe 打开 —— 因为标准材质的 wireframe 会把
   * PBR 光照/贴图全丢掉变成纯色线, 而且无法与实体同时显示。
   *
   * 副本与源网格共享同一份 geometry(不复制顶点数据, 零额外显存),
   * 只新建材质; polygonOffset -2 把线往镜头方向拉一点, 避免与实体面 z-fighting。
   *
   * 三种模式:
   *   off     —— 删掉线框副本, 实体照常显示
   *   overlay —— 实体 + 线框叠加(看拓扑结构)
   *   only    —— 只留线框(检查三角面分布/密度)
   *
   * @param {string} mode 'off' | 'overlay' | 'only'
   * @sideeffect 删除旧线框网格并 dispose 其材质、按需新建并挂到 treeGroup
   */
  applyWireframe(mode) {
    const m = mode || 'off'
    // 先无条件清掉上一轮的线框副本: 它们引用的是旧几何, 几何一换就是悬垂引用。
    for (const key of ['wireBark', 'wireLeaf']) {
      if (this[key]) {
        this.treeGroup.remove(this[key])
        // 只 dispose 材质: geometry 是与源网格共享的那一份, 由源网格负责释放。
        this[key].material.dispose()
        this[key] = null
      }
    }
    const solid = m === 'off'
    // 源网格的 visible 在这里被"重置为 true", 随后按模式再改;
    // 这一步是必要的, 因为上一次退出 only 模式时它是 false。
    this.barkMesh.visible = true
    if (this.leafMesh) this.leafMesh.visible = true
    if (solid) {
      this.barkMesh.material.wireframe = false
      if (this.leafMesh) this.leafMesh.material.wireframe = false
      this._syncCullChunks(this.lodLevel)
      return
    }
    // overlay: 保留实体, 叠加线框; only: 只显示线框
    this.barkMesh.visible = m === 'overlay'
    if (this.leafMesh) this.leafMesh.visible = m === 'overlay'
    this._syncCullChunks(this.lodLevel)
    // mk: 造一个"共享几何 + 纯色线框材质"的副本网格。
    // color 只是区分树皮(青绿)与树叶(琥珀), 没有语义。
    const mk = (geo, color) => {
      const mat = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.9,
        // 线框是叠加层, 不该写深度(否则会把后画的实体挡掉)。
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
      const mesh = new THREE.Mesh(geo, mat)
      // renderOrder=2: 在实体之后绘制, 保证线压在面上看得见。
      mesh.renderOrder = 2
      // 线框不参与阴影(否则地上会多出一堆网格状阴影)。
      mesh.castShadow = false
      mesh.receiveShadow = false
      return mesh
    }
    this.wireBark = mk(this.barkMesh.geometry, 0x7fe0c0)
    this.treeGroup.add(this.wireBark)
    if (this.leafMesh) {
      this.wireLeaf = mk(this.leafMesh.geometry, 0xffd166)
      this.treeGroup.add(this.wireLeaf)
    }
  }

  /* ------------------------------------------------------------------ */
  /* 叶片粒子发射                                                        */
  /* ------------------------------------------------------------------ */
  /**
   * 重建叶片粒子发射器(从叶片位置采样发射点)。
   *
   * 采样源是**树叶几何本身**: 每个粒子的初始位置取一片叶子的位置, 于是粒子
   * 从树冠各处冒出来而不是从一个点喷出。几何一变就必须重建(位置过期),
   * 所以 build 与"叶片参数变化"都会走到这里。
   *
   * @param {Object} params 树参数快照, 读 params.particles 与 params.seed
   * @sideeffect 释放旧粒子几何与材质; 新粒子挂到 treeGroup(renderOrder=3)
   */
  rebuildParticles(params) {
    if (!this.treeGroup) return
    if (this.particles) {
      this.treeGroup.remove(this.particles)
      // 粒子的几何与材质都是 buildParticlePoints 现造的独立资源, 两个都要释放。
      this.particles.geometry.dispose()
      this.particles.material.dispose()
      this.particles = null
    }
    const P = params.particles || {}
    // 没有树叶就没有可采样位置 —— 直接返回, 保持"无粒子"状态。
    if (!P.enabled || !this.leafMesh) return
    this.particles = buildParticlePoints(this.leafMesh.geometry, params, this.uniforms, params.seed)
    // renderOrder=3: 落在树叶(默认 0)与落叶/堆积(1~2)之上, 保证小光点不被遮掉。
    this.particles.renderOrder = 3
    this.treeGroup.add(this.particles)
  }

  /**
   * 只改粒子参数 (不重建整树): 数量变化才重新采样, 其余只更新 uniform。
   *
   * 这是"拖滑块实时预览"的关键优化: 改颜色/速度/大小都走 uniform, 只有数量变了
   * 才需要重采样(因为顶点缓冲长度必须跟着变)。位置数从几何属性里读, 不额外记账。
   *
   * @param {Object} params 树参数快照
   * @sideeffect 可能触发 rebuildParticles(仅当 count 变化或首次启用)
   */
  updateParticles(params) {
    const P = params.particles || {}
    if (!this.particles) {
      if (P.enabled) this.rebuildParticles(params)
      return
    }
    this.particles.visible = !!P.enabled
    // 数量默认 240: 少到不吓人、多到能看出"有东西在飘"。
    const want = Math.max(0, Math.round(P.count === undefined ? 240 : P.count))
    // 顶点数就是粒子数(每粒子 1 个 position), 用它和期望值比较即可。
    const have = this.particles.geometry.attributes.position.count
    if (want !== have) {
      this.rebuildParticles(params)
      return
    }
    // 数量没变 -> 只刷新材质 uniform; 传叶片包围盒是为了把粒子限制在树冠范围内。
    updateParticleMaterial(this.particles.material, params, this.leafMesh ? this.leafMesh.geometry.boundingBox : null)
  }

  /* ------------------------------------------------------------------ */
  /* 落叶                                                                */
  /* ------------------------------------------------------------------ */
  /**
   * 重建"落叶"特效网格(真实叶片卡片从树冠往下降落)。
   *
   * 参数适配: 落叶与树叶共用参数结构, 但落叶构建器只认 `fall` 分组。
   * 这里用三个约定字段把两者接起来:
   *   effectSource  = 'leaf'  —— 告诉构建器"贴图/卡片取自树叶"
   *   effectInherit          —— 是否继承树叶贴图(关掉则用落叶自己的贴图)
   *   leafMat.texture        —— 实际取图用的键(followMap 更进一步直接给出贴图)
   * 另外 fall 分组里没写的字段会用 params.fall 的默认值兜底(它本身总是存在)。
   *
   * boundingBox 是必需的: 落叶的初始位置在树冠包围盒内随机采样, 没有它就没法
   * 确定"从哪里开始掉"。这里按需 computeBoundingBox 一次并缓存到几何上。
   *
   * @param {Object} params 树参数快照, 读 params.fall 与 params.leafMat
   * @sideeffect 释放旧落叶网格; 新网格挂到 treeGroup(renderOrder=2)
   */
  rebuildFall(params) {
    if (!this.treeGroup) return
    if (this.fallMesh) {
      this.treeGroup.remove(this.fallMesh)
      this.fallMesh.geometry.dispose()
      this.fallMesh.material.dispose()
      this.fallMesh = null
    }
    const F = params.fall || {}
    // 没有树叶 = 没有卡片来源, 也就没法生成落叶。
    if (!F.enabled || !this.leafMesh) return
    const geo = this.leafMesh.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    // followMap 只在"确实设置了树叶贴图"时给: 否则叶子是纯色卡, 落叶也跟着纯色。
    const followMap = params.leafMat && params.leafMat.texture ? (this.materials.leaf.map || null) : null
    const adapted = { ...params, effectSource: 'leaf', effectInherit: params.fall.inheritLeafMat !== false }
    this.fallMesh = buildFallingLeaves(geo, adapted, this.uniforms, followMap, geo.boundingBox)
    // renderOrder=2: 落叶要压在堆积(1)之上、粒子(3)之下, 层次才符合真实前后关系。
    this.fallMesh.renderOrder = 2
    this.treeGroup.add(this.fallMesh)
  }

  /**
   * 增量更新落叶: 只改能靠 uniform 表达的参数, 结构性变化才重建。
   *
   * 什么算"结构性变化"(由 fallRebuildKey 汇总成一个字符串):
   *   贴图卡片、数量、宽高比、是否继承树叶材质 —— 这些决定了顶点缓冲的布局,
   *   改不了 uniform。若不重建, 用户换贴图后会看不到任何变化(表现为
   *   "跟随树叶失效")。键相同则只更新材质, 这叫"字符串键差量重建"。
   *
   * @param {Object} params 树参数快照
   * @sideeffect 可能重建网格; 关闭时只隐藏(不释放, 便于再次开启时秒回)
   */
  updateFall(params) {
    const F = params.fall || {}
    if (!F.enabled) {
      if (this.fallMesh) this.fallMesh.visible = false
      return
    }
    // 贴图卡片/数量/宽高比变化时必须重建 (否则换贴图不生效 -> 看起来像"跟随树叶失效")
    const adapted = { ...params, effectSource: 'leaf', effectInherit: params.fall.inheritLeafMat !== false }
    const key = fallRebuildKey(adapted)
    if (!this.fallMesh || key !== this._fallKey) {
      this._fallKey = key
      this.rebuildFall(params)
      return
    }
    updateFallingLeaves(this.fallMesh, adapted)
  }

  /* ------------------------------------------------------------------ */
  /* 落花 / 落花堆积 (参照落叶实现, 参数/贴图独立)                       */
  /* ------------------------------------------------------------------ */
  /** 把花朵参数映射成落叶构建器认识的"fall 形状" */
  _flowerFallParams(params) {
    const FF = params.flowerFall || {}
    const F = params.flower || {}
    return {
      ...params,
      fall: { ...params.fall, ...FF },
      effectSource: 'flower',
      effectInherit: FF.inheritFlowerMat !== false,
      // 让重建键/取贴图都跟着"花朵贴图"走
      leafMat: { ...params.leafMat, texture: F.texture || '' },
    }
  }
  /**
   * 把花朵参数映射成"litter 形状"(落花堆积), 与 _flowerFallParams 同构:
   *   litter      = params.litter 打底, 再用 flowerLitter 覆盖 ——
   *                 所以落花未单独设置的字段自动继承落叶堆积的默认值,
   *                 但一旦用户调了落花参数就以其为准(展开顺序即优先级);
   *   effectSource= 'flower' 指明取花朵卡片;
   *   effectInherit = 是否继承花朵贴图(inheritFlowerMat, 默认继承);
   *   leafMat.texture = 强制换成花朵贴图, 让重建键与贴图查找都跟着走。
   *
   * @param {Object} params 树参数快照
   * @returns {Object} 适配后的参数对象(浅拷贝, 不修改入参)
   */
  _flowerLitterParams(params) {
    const FL2 = params.flowerLitter || {}
    const F = params.flower || {}
    return {
      ...params,
      litter: { ...params.litter, ...FL2 },
      effectSource: 'flower',
      effectInherit: FL2.inheritFlowerMat !== false,
      leafMat: { ...params.leafMat, texture: F.texture || '' },
    }
  }
  /**
   * 取"落花来源几何"。
   * 优先用花朵几何(花朵卡片在哪就从哪掉); 若这棵树没有花(或花被关闭),
   * 退回用树叶几何 —— 至少让落花特效能显示出来, 而不是直接消失。
   *
   * @returns {THREE.BufferGeometry|null} 没有树叶也没有花时返回 null
   */
  _flowerCanopyGeometry() {
    if (this.flowerMesh) return this.flowerMesh.geometry
    return this.leafMesh ? this.leafMesh.geometry : null
  }
  /**
   * 重建落花网格。结构与 rebuildFall 完全对称, 差别只在参数映射
   * (_flowerFallParams) 与贴图来源(花朵材质)。
   *
   * @param {Object} params 树参数快照, 读 params.flowerFall / params.flower
   * @sideeffect 释放旧落花网格; 新网格挂到 treeGroup(renderOrder=2)
   */
  rebuildFlowerFall(params) {
    if (!this.treeGroup) return
    if (this.flowerFallMesh) {
      this.treeGroup.remove(this.flowerFallMesh)
      this.flowerFallMesh.geometry.dispose()
      this.flowerFallMesh.material.dispose()
      this.flowerFallMesh = null
    }
    const FF = params.flowerFall || {}
    if (!FF.enabled) return
    const geo = this._flowerCanopyGeometry()
    if (!geo) return
    if (!geo.boundingBox) geo.computeBoundingBox()
    const followMap = (this.materials.flower && this.materials.flower.map) || null
    const adapted = this._flowerFallParams(params)
    this.flowerFallMesh = buildFallingLeaves(geo, adapted, this.uniforms, followMap, geo.boundingBox)
    this.flowerFallMesh.renderOrder = 2
    this.treeGroup.add(this.flowerFallMesh)
  }
  /**
   * 增量更新落花: 与 updateFall 同一套"重建键"策略, 只是键来自落花参数。
   * @param {Object} params 树参数快照
   * @sideeffect 可能重建落花网格; 关闭时仅隐藏
   */
  updateFlowerFall(params) {
    const FF = params.flowerFall || {}
    if (!FF.enabled) {
      if (this.flowerFallMesh) this.flowerFallMesh.visible = false
      return
    }
    const adapted = this._flowerFallParams(params)
    const key = fallRebuildKey(adapted)
    if (!this.flowerFallMesh || key !== this._flowerFallKey) {
      this._flowerFallKey = key
      this.rebuildFlowerFall(params)
      return
    }
    updateFallingLeaves(this.flowerFallMesh, adapted)
  }
  /**
   * 重建落花堆积(地面上的落花层)。
   *
   * 与落叶堆积(litter)的区别: 贴图与参数独立, 但几何来源相同(花朵几何或
   * 退化为树叶几何), 且 renderOrder=1 —— 贴着地面, 要在落叶(2)之下。
   * 注意这里用的是 buildLeafLitter(不是 buildFallingLeaves): 堆积是静态的
   * 贴地卡片, 不需要下落动画。
   *
   * @param {Object} params 树参数快照, 读 params.flowerLitter / params.flower
   * @sideeffect 释放旧堆积网格; 新网格挂到 treeGroup
   */
  rebuildFlowerLitter(params) {
    if (!this.treeGroup) return
    if (this.flowerLitterMesh) {
      this.treeGroup.remove(this.flowerLitterMesh)
      this.flowerLitterMesh.geometry.dispose()
      this.flowerLitterMesh.material.dispose()
      this.flowerLitterMesh = null
    }
    const FL2 = params.flowerLitter || {}
    if (!FL2.enabled) return
    const geo = this._flowerCanopyGeometry()
    if (!geo) return
    if (!geo.boundingBox) geo.computeBoundingBox()
    const followMap = (this.materials.flower && this.materials.flower.map) || null
    const adapted = this._flowerLitterParams(params)
    this.flowerLitterMesh = buildLeafLitter(adapted, followMap, geo.boundingBox)
    this.flowerLitterMesh.renderOrder = 1
    this.treeGroup.add(this.flowerLitterMesh)
  }
  /**
   * 增量更新落花堆积: 重建键来自 litterRebuildKey(堆积与落叶用的是不同键函数,
   * 因为两者的顶点布局/参数项不同)。
   * @param {Object} params 树参数快照
   * @sideeffect 可能重建堆积网格; 关闭时仅隐藏
   */
  updateFlowerLitter(params) {
    const FL2 = params.flowerLitter || {}
    if (!FL2.enabled) {
      if (this.flowerLitterMesh) this.flowerLitterMesh.visible = false
      return
    }
    const adapted = this._flowerLitterParams(params)
    const key = litterRebuildKey(adapted)
    if (!this.flowerLitterMesh || key !== this._flowerLitterKey) {
      this._flowerLitterKey = key
      this.rebuildFlowerLitter(params)
      return
    }
    this.flowerLitterMesh.visible = true
    updateLitterEffects(this.flowerLitterMesh, adapted)
  }

  /* ------------------------------------------------------------------ */
  /* 地面落叶堆积                                                        */
  /* ------------------------------------------------------------------ */
  /**
   * 重建地面落叶堆积层。
   *
   * 与"落叶"的区别: 落叶是空中的动态卡片(顶点着色器按时间下落), 堆积是
   * 贴地静态卡片, 只在地面附近铺一层, 用来"落在地上"的视觉收尾。
   * 参数适配同样是 effectSource / effectInherit / leafMat.texture 三件套,
   * 但写进的是 `litter` 分组。
   *
   * leafGeo 可能为 null(没有树叶时不生成堆积): 此时传 null 给构建器,
   * 由它内部退化处理, 不在这里提前 return —— 花/果实的堆积也要能存在于无叶的树。
   *
   * @param {Object} params 树参数快照, 读 params.litter 与 params.leafMat
   * @sideeffect 释放旧堆积网格; 新网格挂到 treeGroup(renderOrder=1)
   */
  rebuildLitter(params) {
    if (!this.treeGroup) return
    if (this.litterMesh) {
      this.treeGroup.remove(this.litterMesh)
      this.litterMesh.geometry.dispose()
      this.litterMesh.material.dispose()
      this.litterMesh = null
    }
    const L = params.litter || {}
    if (!L.enabled) return
    const leafGeo = this.leafMesh ? this.leafMesh.geometry : null
    if (leafGeo && !leafGeo.boundingBox) leafGeo.computeBoundingBox()
    const followMap = params.leafMat && params.leafMat.texture ? (this.materials.leaf.map || null) : null
    const adapted = { ...params, effectSource: 'leaf', effectInherit: params.litter.inheritLeafMat !== false }
    this.litterMesh = buildLeafLitter(adapted, followMap, leafGeo ? leafGeo.boundingBox : null)
    // renderOrder=1: 紧贴地面, 应在所有空中特效之前绘制。
    this.litterMesh.renderOrder = 1
    this.treeGroup.add(this.litterMesh)
  }

  /**
   * 增量更新落叶堆积: 结构与 updateFall 相同(键不同则重建, 否则只刷 uniform)。
   * @param {Object} params 树参数快照
   * @sideeffect 可能重建堆积网格; 关闭时仅隐藏
   */
  updateLitter(params) {
    const L = params.litter || {}
    if (!L.enabled) {
      if (this.litterMesh) this.litterMesh.visible = false
      return
    }
    const adapted = { ...params, effectSource: 'leaf', effectInherit: params.litter.inheritLeafMat !== false }
    const key = litterRebuildKey(adapted)
    if (!this.litterMesh || key !== this._litterKey) {
      this._litterKey = key
      this.rebuildLitter(params)
      return
    }
    this.litterMesh.visible = true
    updateLitterEffects(this.litterMesh, adapted)
  }

  /* ------------------------------------------------------------------ */
  /* 伪装卡生成 (Impostor / Cross-card)                                  */
  /* ------------------------------------------------------------------ */
  /**
   * 生成伪装卡(把真树离屏拍成图集, 供远景用一张面片代替整棵树)。
   *
   * 为什么必须先 clearImpostorPreview:
   *   ① 预览状态下真树是被隐藏的(见 setImpostorPreview), 不撤销就拍到空场景;
   *   ② 上一张伪装卡本身也在场景里, 不撤掉会被拍进新图集(卡里套卡)。
   *
   * 包围盒只统计树皮与树叶: 花/果/落叶都在 hide 名单里会被隐藏,
   * 把它们算进包围盒只会让取景变松、图集分辨率变低。
   *
   * hide 名单 = 地面/网格/天空/各类特效 + 花朵相关的分块。
   * 花朵之所以要单独按分块过滤: 花朵源网格虽然列在名单里, 但 LOD0 真正渲染的是
   * 它的视锥分块(_cullChunks 里 kind==='flower' 的项), 不隐藏就会出现"花朵
   * 悬在空中的残影"。
   *
   * @param {Object} [opts] 透传给 generateImpostor 的选项
   *   (mode 'atlas'|'cross' / views 方位角数量 / size 单帧像素 / elevations 仰角列表)
   * @returns {{dataUrl: string, meta: Object, width: number, height: number,
   *            coverage: number}} 图集与相机元信息
   * @sideeffect 临时隐藏场景对象(由 generateImpostor 负责恢复)
   * @throws {Error} 场景里还没有任何树时可渲染内容时抛错
   */
  makeImpostor(opts = {}) {
    // 生成前先撤掉上一张伪装卡:
    // 1) 它会让真树处于隐藏状态 -> 新图集拍不到树
    // 2) 它本身也在场景里 -> 会被拍进新图集 (卡里套卡 = 叠加态)
    if (this._impostorGroup) this.clearImpostorPreview()

    const box = new THREE.Box3()
    if (this.barkMesh) box.expandByObject(this.barkMesh)
    if (this.leafMesh) box.expandByObject(this.leafMesh)
    if (box.isEmpty()) throw new Error('还没有可用的树')
    const bbox = { min: box.min, max: box.max }
    const hide = [this.ground, this.grid, this.sky, this.particles, this.fallMesh, this.litterMesh, this.flowerMesh, this.flowerFallMesh, this.flowerLitterMesh, this._impostorGroup,
      ...this._cullChunks.filter((c) => c.kind === 'flower').map((c) => c.mesh)]
    return generateImpostor({
      renderer: this.renderer,
      scene: this.scene,
      bbox,
      hide,
      ...opts,
    })
  }

  /* ------------------------------------------------------------------ */
  /* 伪装卡 3D 预览 (可以像模型一样环绕 — 按相机方位角切图集帧)           */
  /* ------------------------------------------------------------------ */
  /**
   * 用伪装卡图集搭一个"可以环绕观察"的 3D 预览。
   *
   * 两种模式:
   *   cross —— 每个方位角一张面片, 各自按角度绕 Y 旋转摆放, 形成交叉十字;
   *            好处是任意水平方向都有正对镜头的一片, 结构上像真的;
   *   atlas —— 只用**一张**面片, 靠片元着色器按相机方位/俯仰动态选图集格子
   *            (见 updateImpostorPreview), 面片始终朝向相机(球面 billboard)。
   *
   * 面片尺寸推导:
   *   拍摄时的视锥在树心处的半高 halfH = distance × tan(fov/2),
   *   所以整幅画面的高度 tile = 2 × distance × tan(fov/2)。
   *   面片用 tile/2 作为半宽半高(即整体 w*2 × h*2), 与真树同尺寸对齐 ——
   *   这样"切到伪装卡"时视觉尺寸不跳变。
   *
   * UV 映射(图集模式): uv = ((vUv + cell) / grid), 即把 0..1 的局部 UV 平移到
   * 指定格子的子矩形; alpha < 0.3 直接 discard, 因为图集里树的轮廓外是透明的,
   * 不过滤会画出整块矩形。
   * 片元末尾 include 了 tonemapping/colorspace, 保证与前向渲染的色调一致。
   *
   * 最后会把场景里除灯光和本组之外的一切都隐藏 —— 不依赖固定名单, 于是
   * 之后重建出来的新对象也会被 _rehideForImpostorPreview 兜住。
   *
   * @param {{dataUrl: string, meta: Object}|null} result makeImpostor 的返回值;
   *   null 表示只清理不显示
   * @sideeffect 新建 group 与贴图; 隐藏其它场景对象并记录到 _impostorHidden
   */
  setImpostorPreview(result) {
    this.clearImpostorPreview()
    if (!result) return
    const meta = result.meta || {}
    const layout = meta.layout || { cols: 1, rows: 1 }
    const views = Math.max(1, meta.views || 1)
    const center = new THREE.Vector3(
      meta.center ? meta.center[0] : 0,
      meta.center ? meta.center[1] : 5,
      meta.center ? meta.center[2] : 0,
    )
    const r = Math.max(1, meta.radius || 5)
    const tex = new THREE.TextureLoader().load(result.dataUrl)
    this._impostorTexture = tex
    // 图集是 canvas 导出的 PNG, 内容已经是 sRGB 编码, 必须声明色彩空间,
    // 否则会再被当作线性贴图二次转换一遍(整张卡发灰/发白)。
    tex.colorSpace = THREE.SRGBColorSpace
    // ClampToEdge 而不是 Repeat: 图集里相邻格子紧挨着, 用 Repeat 或镜像时
    // 采样一旦越界就会"串格"——树边上会出现隔壁角度的碎片。
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping

    const group = new THREE.Group()
    group.position.copy(center)
    const mkMat = (cell) => new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uGrid: { value: new THREE.Vector2(layout.cols, layout.rows) },
        uCell: { value: new THREE.Vector2(cell.x, cell.y) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D uMap; uniform vec2 uGrid; uniform vec2 uCell;
        varying vec2 vUv;
        void main(){
          vec2 cell = 1.0 / uGrid;
          vec2 uv = vec2((vUv.x + uCell.x) / uGrid.x, (vUv.y + uCell.y) / uGrid.y);
          vec4 c = texture2D(uMap, uv);
          if (c.a < 0.3) discard;
          gl_FragColor = c;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
    })
    // 渲染用的视锥在树心处的半高 = dist * tan(fov/2); 面片应与之一致, 这样和真树同尺寸
    // fov 默认 18°(长焦): 伪装卡是正交化的替身, 视场越窄透视畸变越小,
    // 一张平面贴图才可能在各个角度都"看起来对"; 拍宽了边缘会明显拉伸。
    const fov = (meta.fov || 18) * Math.PI / 180
    // distance 缺失时用树半径 × 3 估算(拍摄时相机大致退到 3 倍半径外)。
    const tile = 2 * (meta.distance || r * 3) * Math.tan(fov / 2)
    // 面片整体尺寸是 tile 的两倍边长(w*2 × h*2), 即半宽 = tile/2。
    const w = tile / 2
    const h = tile / 2
    if (meta.mode === 'cross') {
      // 交叉卡: 每行是一张面片贴图, 按各自角度摆放 -> 真的"从各角度看都是树"
      const angles = meta.angles || []
      angles.forEach((ang, i) => {
        const geo = new THREE.PlaneGeometry(w * 2, h * 2)
        const mat = mkMat(new THREE.Vector2(0, layout.rows - 1 - i))
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.y = (ang * Math.PI) / 180
        group.add(mesh)
      })
    } else {
      // 图集: 一张面片 + 按相机方位角切帧
      const geo = new THREE.PlaneGeometry(w * 2, h * 2)
      const mat = mkMat(new THREE.Vector2(0, 0))
      const mesh = new THREE.Mesh(geo, mat)
      mesh.userData.atlasCell = true
      group.add(mesh)
      this._impostorAtlas = { mesh, mat, layout, views, angles: meta.angles || [], azCount: layout.cols, elevations: meta.elevations || [0] }
    }
    this._impostorGroup = group
    this.scene.add(group)
    // 隐藏除灯光与伪装卡以外的一切 (不依赖固定名单: 后续重建出来的新对象也会被藏起来,
    // 否则真树和伪装卡会"叠加"显示)
    this._impostorHidden = []
    for (const obj of this.scene.children) {
      if (!obj.visible) continue
      if (obj === group) continue
      if (obj.isLight) continue
      this._impostorHidden.push(obj)
      obj.visible = false
    }
  }

  /**
   * 重建后如果还在伪装卡预览状态, 把新对象重新藏起来 (否则会叠加真树)。
   *
   * 与 setImpostorPreview 里的隐藏循环几乎一样, 但多做一件事: 把**新出现**的
   * 对象也记进 _impostorHidden, 这样退出预览时它们同样会被恢复 ——
   * 否则重建产生的新网格会永远停在"可见"状态(看起来像伪装卡上叠了半棵树)。
   * 已经隐藏过的对象不会被重复登记(includes 判断), 避免数组无限增长。
   */
  _rehideForImpostorPreview() {
    if (!this._impostorGroup) return
    for (const obj of this.scene.children) {
      if (!obj.visible) continue
      if (obj === this._impostorGroup) continue
      if (obj.isLight) continue
      if (!this._impostorHidden.includes(obj)) this._impostorHidden.push(obj)
      obj.visible = false
    }
  }

  /**
   * 每帧更新: 图集模式下按相机方位角 + 俯仰角选帧。
   *
   * 选帧算法(与拍摄时 generateImpostor 的分格方式必须严格互逆, 否则画面会"跳格"):
   *   方位角 ang = atan2(dx, dz), 归一到 [0,360) —— 注意用 (x, z) 而不是 (x, y),
   *     因为树木的环绕是在水平面上转的;
   *   col = round(ang / (360/azCount)) mod azCount —— 就近取格(不是 floor),
   *     这样误差被均分到每格两侧, 不会出现"某个角度总是慢一格";
   *   仰角 el = atan2(dy, 水平距离), 即视线的抬头角度(90° = 正俯视);
   *   row = 与 elevations 列表里最接近的那一层(argmin |e - el|)。
   *   送进 uniform 时行号要翻转: layout.rows - 1 - row,
   *   因为图像纹理的 V 轴向上, 而图集是按"从上到下"排列的。
   *
   * 朝向: 面片始终面向相机(球面 billboard)。如果只让它绕 Y 转, 相机绕到背面时
   * 会看到同一张图的**镜像**, 视觉上就像"只拍了 180°, 另一半是镜像对称"。
   * 俯仰接近 ±90°(|el|>88)时球面基失效(视线与 up 平行), 此时把 up 换成 (0,0,-1)
   * 才能得到有效的 lookAt 矩阵 —— 否则面片会瞬间翻成侧倒。
   *
   * @sideeffect 写入 uCell uniform、设置面片四元数
   */
  updateImpostorPreview() {
    const a = this._impostorAtlas
    if (!a || !this._impostorGroup) return
    const c = this._impostorGroup.position
    const cam = this.camera.position
    const dx = cam.x - c.x, dy = cam.y - c.y, dz = cam.z - c.z
    let ang = (Math.atan2(dx, dz) * 180) / Math.PI
    if (ang < 0) ang += 360
    // 俯仰角: 相机越高越接近俯视 (90 = 正俯视)
    const horiz = Math.hypot(dx, dz)
    const el = Math.abs(dy) < 1e-4 && horiz < 1e-4 ? 0 : (Math.atan2(dy, horiz) * 180) / Math.PI
    const azStep = 360 / Math.max(1, a.azCount)
    const col = Math.round(ang / azStep) % Math.max(1, a.azCount)
    // 选最接近的仰角层
    let row = 0
    let best = Infinity
    ;(a.elevations || [0]).forEach((e, i) => {
      const dd = Math.abs(e - el)
      if (dd < best) { best = dd; row = i }
    })
    a.mat.uniforms.uCell.value.set(col, a.layout.rows - 1 - row)
    // 面片始终转向相机 (球面 billboard): 否则绕到背面看到的是同一张图的**镜像**,
    // 看起来就像"只拍了 180°, 之后对称排列"。
    const upVec = Math.abs(el) > 88 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0)
    const mt = new THREE.Matrix4()
    mt.lookAt(cam, c, upVec)
    a.mesh.quaternion.setFromRotationMatrix(mt)
  }

  /**
   * 退出伪装卡预览: 释放图集贴图/材质/几何, 并把之前隐藏的场景对象全部恢复。
   *
   * 释放顺序: 先材质(它引用贴图), 再几何, 再贴图本身, 最后清引用。
   * _impostorHidden 里存的是"被隐藏前的对象引用", 必须逐个恢复 visible,
   * 否则退出预览后整个场景会一片黑(地面/天空/真树都还是隐藏状态)。
   *
   * @sideeffect 释放 GPU 资源、恢复场景对象可见性、清空 _impostor* 状态
   */
  clearImpostorPreview() {
    if (this._impostorAtlas && this._impostorAtlas.mat) this._impostorAtlas.mat.dispose()
    if (this._impostorAtlas && this._impostorAtlas.mesh) this._impostorAtlas.mesh.geometry.dispose()
    if (this._impostorGroup) {
      this._impostorGroup.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose() } })
      this.scene.remove(this._impostorGroup)
    }
    if (this._impostorTexture) { this._impostorTexture.dispose(); this._impostorTexture = null }
    this._impostorGroup = null
    this._impostorAtlas = null
    for (const m of this._impostorHidden || []) m.visible = true
    this._impostorHidden = []
  }

  /* ------------------------------------------------------------------ */
  /* 导出                                                                */
  /* ------------------------------------------------------------------ */
  /**
   * 导出用的静态模型组: 只含 树皮(含果实) / 树叶 / 花朵 三个网格。
   * 不导出粒子、落叶、落花、堆积、线框叠加等"场景效果"——
   * 它们由顶点着色器按时间驱动, 静态导出只会得到错位/塌陷的垃圾几何,
   * 且部分特效材质是 ShaderMaterial, glTF 无法表达。
   * 用 clone() 只复制节点(共享 geometry/material), 不改动场景里的原对象。
   */
  /**
   * 果实导出材质 (独立于树皮; 参数变了才重建, 避免每次预览都生成 1K 贴图)。
   *
   * 为什么要独立: 场景里果实是"长在树皮几何上的一段"由着色器按节点 id 上色,
   * 但 glTF/OBJ 导出没有节点 id 这个概念, 拆件时 Bark_Fruit 需要一张**烘焙好的
   * 静态贴图**。createFruitExportMaterial 会按果实参数程序化生成那张贴图,
   * 成本较高(1K 级别的 canvas 绘制), 所以用参数键做缓存。
   *
   * 缓存键 = 果实类型/果皮色/果蒂色/种子 —— 只放"会影响贴图像素"的字段;
   * seed 也带上是让同一参数下的果实在多次导出间保持一致(确定性纪律)。
   *
   * @returns {THREE.Material} 可复用的果实导出材质
   * @sideeffect 参数变化时释放旧材质并新建
   */
  _getFruitExportMaterial() {
    const F = (this.lastParams && this.lastParams.fruit) || {}
    const seed = (this.lastParams && this.lastParams.seed) || 1
    const key = JSON.stringify({
      type: F.type, color: F.color, capColor: F.capColor, seed,
    })
    if (this._fruitExportMaterial && this._fruitExportKey === key) return this._fruitExportMaterial
    disposeFruitExportMaterial(this._fruitExportMaterial)
    this._fruitExportMaterial = createFruitExportMaterial(F, seed)
    this._fruitExportKey = key
    return this._fruitExportMaterial
  }

  /**
   * 构建"导出用的临时 Group"(不加入场景, 只用于序列化)。
   *
   * 为什么要另造一个 Group 而不是直接导 treeGroup:
   *   treeGroup 里还挂着视锥分块、骨架叠层、线框副本、粒子与各类季节特效,
   *   直接导出会得到一堆语义混乱的节点(甚至重复几何)。这里只挑三块源网格,
   *   按导出规范重命名, 树皮还会按节点组拆成 Bark_Trunk / Bark_Branch / Bark_Fruit。
   *
   * 坐标处理: 复制 mesh 的 matrixWorld 再 decompose 成 position/quaternion/scale。
   * 源网格自身一般无变换, 但"按世界矩阵归一化"能保证即便将来给 treeGroup 加了
   * 位移/旋转, 导出结果也不会跑偏。
   *
   * @returns {THREE.Group} 纯净的可导出模型树
   * @sideeffect 可能在需要 Bark_Fruit 时创建/更新果实导出材质
   */
  buildExportGroup() {
    const g = new THREE.Group()
    g.name = this.treeGroup.name || 'FastTree'
    const add = (mesh, geometry, name, material) => {
      const c = new THREE.Mesh(geometry, material || mesh.material)
      c.name = name
      // 网格自身一般无变换, 但仍按世界矩阵归一化, 保证导出坐标正确
      c.matrix.copy(mesh.matrixWorld)
      c.matrix.decompose(c.position, c.quaternion, c.scale)
      c.visible = true
      g.add(c)
    }
    // 树皮导出: 默认按节点组拆开; 用户可在导出面板选择合并树干与树枝
    if (this.barkMesh) {
      const opts = (this.lastParams && this.lastParams.exportOptions) || {}
      const onePiece = !!(this.lastParams && this.lastParams.trunk && this.lastParams.trunk.onePiece)
      const parts = barkExportParts(this.barkMesh.geometry, this.nodes || [], !!opts.mergeBark || onePiece, onePiece)
      const fruitMat = parts.some((p) => p.name === 'Bark_Fruit') ? this._getFruitExportMaterial() : null
      if (parts.length) {
        for (const p of parts) add(this.barkMesh, p.geometry, p.name, p.name === 'Bark_Fruit' ? fruitMat : null)
      } else {
        add(this.barkMesh, this.barkMesh.geometry, 'Bark')
      }
    }
    if (this.leafMesh) add(this.leafMesh, this.leafMesh.geometry, 'Leaves')
    if (this.flowerMesh) add(this.flowerMesh, this.flowerMesh.geometry, 'Flowers')
    g.updateMatrixWorld(true)
    return g
  }

  /**
   * 导出 GLB(二进制 glTF, 含贴图)并触发浏览器下载。
   * @param {string} name 下载文件名(可省略扩展名, 由 exporter 负责)
   * @returns {*} exportGLB 的返回值(失败信息或成功标记)
   */
  exportGLB(name) {
    return exportGLB(this.buildExportGroup(), name)
  }

  /**
   * 导出 OBJ(+MTL)并触发浏览器下载。
   * @param {string} name 下载文件名
   * @returns {*} exportOBJ 的返回值
   */
  exportOBJ(name) {
    return exportOBJ(this.buildExportGroup(), name)
  }

  /**
   * 只构建导出预览, 不触发下载。
   *
   * 预览与真正导出走的是同一套序列化逻辑(buildGLBPreview/buildOBJPreview),
   * 所以看到的大小/文件数就是下载后的大小 —— 不是另写一份"估算"。
   * png 走的是直接读 canvas(必须先手动 render 一次, 理由同上截图)。
   * 默认文件名带 params.seed, 便于把预览图/模型和"哪棵树"对应起来。
   *
   * @param {'glb'|'obj'|'png'} kind 预览类型
   * @param {string} [name] 输出文件名, 省略则用 fasttree-<seed>.<ext>
   * @returns {Promise<Object>} 预览对象(含 blob/dataUrl/byteSize 等, 由 exportPreview 决定)
   * @throws {Error} kind 不支持时抛错(这是编程错误, 不该静默)
   */
  async prepareExport(kind, name) {
    if (kind === 'glb') return buildGLBPreview(this.buildExportGroup(), name || `fasttree-${this.lastParams?.seed || 'tree'}.glb`)
    if (kind === 'obj') return buildOBJPreview(this.buildExportGroup(), name || `fasttree-${this.lastParams?.seed || 'tree'}.obj`)
    if (kind === 'png') {
      this.renderer.render(this.scene, this.camera)
      const el = this.renderer.domElement
      const dataUrl = el.toDataURL('image/png')
      return buildPNGPreview(dataUrl, name || `fasttree-${this.lastParams?.seed || 'tree'}.png`, el.width, el.height)
    }
    throw new Error('不支持的导出预览类型: ' + kind)
  }

  /**
   * 立即渲染一帧并导出 PNG 截图(下载)。
   * 先手动 render: 保证拿到的是"此刻"的画面, 而不是浏览器上一次合成的结果。
   *
   * @param {string} [name] 文件名
   * @returns {*} exportScreenshot 的返回值
   */
  screenshot(name) {
    this.renderer.render(this.scene, this.camera)
    return exportScreenshot(this.renderer, name)
  }

  /* ------------------------------------------------------------------ */
  /* 循环                                                                */
  /* ------------------------------------------------------------------ */
  /**
   * 渲染循环 —— 每帧按固定顺序做七件事。
   *
   * 顺序不能随意调换, 每一步都依赖前一步的状态:
   *   ① 先排下一帧(rAF) —— 放在最前面, 这样即使下面某步抛异常, 循环也不会停;
   *   ② 更新伪装卡朝向/选帧 —— 依赖本帧的相机位置, 必须在渲染前算好;
   *   ③ 算 dt(秒) —— 上限 0.05 秒(20fps)。切标签页回来时两帧间隔可能是好几秒,
   *      不夹紧会让风场"瞬间跳一大步"、生长动画直接跳到终点;
   *   ④ 推进风场时间 uTime —— 只在 playing 时; 乘 windTimeScale 实现"慢动作"。
   *      注意 uTime 只增不减, 停顿时不要清零, 否则树叶会"弹回原位";
   *   ⑤ 推进自动生长 —— 每帧加 dt×speed 直到 1, 到位后停手(不再浪费 uniform 写入);
   *   ⑥ 天空/星空跟随相机 —— 让它们看起来在无限远, 永不穿帮;
   *   ⑦ 相机控制更新 → LOD 判定 → 分块可见性同步 → 渲染 → 回调 draw call 统计。
   *
   * 为什么 controls.update() 必须在 render 之前: OrbitControls 的阻尼是"每帧衰减",
   * 不 update 的话松手后相机不再惯性滑动, 而且 target 的改动不会反映到矩阵。
   *
   * 为什么 _syncCullChunks 每帧都要跑: visible 可能被 LOD/线框/选中在"帧与帧之间"
   * 改掉(来自 UI 事件), 每帧同步一次是最省心的收敛手段(成本是几十次布尔赋值)。
   */
  tick() {
    if (this.disposed) return
    this._raf = requestAnimationFrame(this._loop)
    this.updateImpostorPreview()
    // 用 performance.now() 而不是 Date.now(): 后者会被系统时间同步/时区跳变影响,
    // 一次校时就能让 dt 变成负数或巨大值。除以 1000 得到秒。
    const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000
    // dt 同时夹下界 0(防负)与上界 0.05 秒(防卡顿后跳帧, 理由见上面 ③)。
    const dt = Math.min(0.05, Math.max(0, nowSec - this.lastTime))
    this.lastTime = nowSec
    if (this.playing) {
      this.uniforms.uTime.value += dt * (this.windTimeScale || 1)
    }
    if (this.growthAuto && this.growthValue < 1) {
      this.growthValue = Math.min(1, this.growthValue + dt * this.growthSpeed)
      this.uniforms.uGrowth.value = this.growthValue
      // uGrowthEnabled=1: 生长动画"正在播放"时才让着色器做插值;
      // 到 1 之后停在 1 也不会再变(下一次进入 updateGrowth 会重新判定)。
      this.uniforms.uGrowthEnabled.value = 1
      if (this.callbacks.onGrowth) this.callbacks.onGrowth(this.growthValue)
    }
    // 天空与星空每帧贴到相机位置: 它们半径固定(90 / 300+), 只有跟着走才像在无限远。
    this.sky.position.copy(this.camera.position)
    if (this.stars) this.stars.position.copy(this.camera.position)
    this.controls.update()
    this.updateLod()
    this._syncCullChunks(this.lodLevel)
    this.renderer.render(this.scene, this.camera)
    // renderer.info.render 是"上一帧"的实际绘制统计(calls/triangles/points),
    // 交给 UI 的性能面板; 只有需要时才回调, 避免每帧都触发一次响应式更新。
    if (this.callbacks.onFrame) this.callbacks.onFrame(this.renderer.info.render)
  }

  /**
   * 销毁整个场景, 释放全部 GPU 与 DOM 资源。用完这个实例就作废, 不可复用。
   *
   * 资源释放边界(哪些归本类管):
   *   ✓ 自建的几何/材质/贴图: 地面、天空、星空、源网格几何、分块几何、LOD 几何、
   *     选中框、三块主材质、果实导出材质、粒子/落叶/落花/堆积网格;
   *   ✓ 控制器: OrbitControls / TransformControls / 变换 helper / 代理对象;
   *   ✓ 定时器与观察者: rAF、_gizmoCommitTimer、ResizeObserver;
   *   ✓ renderer 本体与它插进 DOM 的 canvas。
   *   ✗ 不归本类管: treeBuilder 产生的中间数据(纯 JS 对象, 交给 GC)、
   *     state.params(属于 store)、window.__fastTreeScene(由 Viewport 负责清)。
   *
   * 为什么先置 disposed=true 再取消 rAF: tick 里也判断了 disposed,
   * 双保险 —— 已经排队但还没执行的那一帧会自己退出, 不会去碰已释放的资源。
   *
   * 注意源网格的材质是共享的, 所以这里对三块源网格只 dispose geometry,
   * 材质统一由 materials.bark/.leaf 那两行释放; 花朵材质与树叶同实例, 不重复释放。
   *
   * @sideeffect 不可逆; 之后任何方法都不应再被调用
   */
  dispose() {
    this.disposed = true
    cancelAnimationFrame(this._raf)
    this._ro.disconnect()
    this.controls.dispose()
    /* ---- 交互控制器 ---- */
    if (this._gizmoCommitTimer) {
      clearTimeout(this._gizmoCommitTimer)
      this._gizmoCommitTimer = 0
    }
    if (this.transformControls) {
      this.transformControls.detach()
      this.transformControls.dispose()
      this.transformControls = null
    }
    if (this.transformHelper) {
      this.scene.remove(this.transformHelper)
      this.transformHelper = null
    }
    if (this.branchPivot) {
      this.scene.remove(this.branchPivot)
      this.branchPivot = null
    }
    /* ---- 几何缓存(低模 + 分块) ---- */
    this._disposeLods()
    // 源网格只释放几何; 材质是共享的, 由下面的 materials 统一释放。
    this.barkMesh?.geometry.dispose()
    this.leafMesh?.geometry.dispose()
    this.flowerMesh?.geometry.dispose()
    this._disposeCullChunks()
    /* ---- 选中框 ---- */
    if (this.selBox) {
      this.scene.remove(this.selBox)
      this.selBox.geometry.dispose()
      this.selBox.material.dispose()
      this.selBox = null
    }
    /* ---- 主材质(树皮/树叶; 花朵与树叶共用实例, 不重复释放) ---- */
    this.materials?.bark?.dispose()
    this.materials?.leaf?.dispose()
    // 动态阴影深度材质(每个主材质一份)
    for (const dm of this._depthMaterials.values()) dm.dispose()
    this._depthMaterials.clear()
    disposeFruitExportMaterial(this._fruitExportMaterial)
    this._fruitExportMaterial = null
    /* ---- 场景背景资源(地面 / 天空 / 星空) ---- */
    this.ground.geometry.dispose()
    this.groundMat.dispose()
    this.sky.geometry.dispose()
    this.skyMat.dispose()
    if (this.stars) {
      this.stars.geometry.dispose()
      this.starsMat.dispose()
    }
    /* ---- renderer 与 canvas ---- */
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}
