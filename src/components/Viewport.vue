<template>
  <div class="viewport-wrap">
    <div ref="host" class="viewport-canvas"></div>

    <div v-if="state.shaderError" class="error-banner">
      <button class="btn small ghost" style="position: absolute; right: 6px; top: 6px" @click="state.shaderError = ''">✕</button>
      <b>着色器编译错误 / 运行错误</b>
      <pre style="margin: 4px 0 0; white-space: pre-wrap">{{ state.shaderError }}</pre>
    </div>

    <div v-if="state.busy" class="busy">{{ state.engineSwitching ? '切换渲染引擎中…' : '重建几何中…' }}</div>

    <div class="overlay stats">
      <div><span class="k">树枝</span> <b>{{ state.stats.branches }}</b> · <span class="k">叶片</span> <b>{{ state.stats.leaves }}</b></div>
      <div><span class="k">全模三角面</span> <b>{{ totalTriangles.toLocaleString() }}</b></div>
      <div><span class="k">构建</span> <b>{{ state.stats.buildMs.toFixed(1) }} ms</b> · <span class="k">FPS</span> <b>{{ fps }}</b></div>
      <div><span class="k">树高</span> <b>{{ state.stats.height.toFixed(2) }} m</b> · <span class="k">冠幅</span> <b>{{ state.stats.spread.toFixed(2) }} m</b></div>
      <div><span class="k">绘制调用</span> <b>{{ state.renderInfo.calls }}</b></div>
      <div v-if="state.params.lod.dynamic">
        <span class="k">LOD</span> <b>L{{ state.lodLevel }}</b>
        · <span class="k">当前面数</span> <b>{{ activeLodTriangles.toLocaleString() }}</b>
      </div>
    </div>

    <div class="overlay help">
      左键旋转 (可转到地下从下往上看) · 右键平移 · 滚轮缩放 · N 节点面板 · W 线框
    </div>

    <div class="overlay growth-quick">
      <button class="btn small" @click="playGrowth">🌱 从 0 播放生长</button>
    </div>

    <!-- 渲染引擎切换: 视口右上角悬浮 (顶栏在窄窗口下已经排满, 塞那里会被挤出屏幕)。
         左边是"意图"(auto/webgpu/webgl), 右边是"实际后端"徽标 —— auto 在没 WebGPU 的机器上
         会落到 WebGL 2 (Node) 或经典 WebGL, 两个都得看得到。
         切换是热切换 (重建场景、保留视角), 不需要刷新页面。 -->
    <div class="overlay engine-switch" :title="engineTitle">
      <span class="engine-label">引擎</span>
      <select
        class="engine-select"
        :value="engineMode"
        :disabled="state.engineSwitching"
        aria-label="渲染引擎"
        @change="onEngineChange($event.target.value)"
      >
        <option value="auto">自动</option>
        <option value="webgpu">WebGPU</option>
        <option value="webgl">WebGL</option>
      </select>
      <span class="engine-badge" :class="{ busy: state.engineSwitching }">
        {{ state.engineSwitching ? '切换中…' : (state.renderBackend || '…') }}
      </span>
    </div>

    <WindCompass />

    <!-- Blender 风格 XYZ 坐标轴指示器 (跟随主相机旋转, 点击轴字母切到该轴正视图) -->
    <canvas ref="axisCv" class="axis-gizmo" @pointerdown="onAxisPick" />

    <!-- 扭曲句柄叠层 (树干/树枝扭转曲线) -->
    <TwistGizmo v-if="state.twistEdit" />

    <!-- 预览切换: 3D 模型 <-> 伪装卡 -->
    <div v-if="state.impostorResult" class="overlay preview-switch">
      <button class="btn small" :class="{ active: !state.impostorPreview }" @click="setImpostorPreview(false)">3D 模型</button>
      <button class="btn small" :class="{ active: state.impostorPreview }" @click="setImpostorPreview(true)">伪装卡预览</button>
      <span class="tag" :class="{ on: state.impostorPreview }">{{ state.impostorPreview ? '伪装卡 (可环绕)' : '3D 模型' }}</span>
    </div>


    <div v-if="state.selection.label" class="overlay selection">
      <span class="dot"></span>
      <b>{{ state.selection.label }}</b>
      <span class="muted">· {{ modeLabel }}</span>
      <button v-if="!state.nodePanelOpen" class="btn small ghost" @click="toggleNodePanel(true)">🧩 节点面板</button>
      <button class="btn small ghost" @click="clearSelection">清除</button>
    </div>
  </div>
</template>

<script setup>
import { startBridgeClient } from '../core/appApi.js'
import { onBeforeUnmount, onMounted, ref, watch, computed } from 'vue'
import { TreeScene } from '../core/sceneManager.js'
import { serializeGroup } from '../core/params.js'
import { Vector3, Quaternion } from 'three'
import WindCompass from './WindCompass.vue'
import TwistGizmo from './TwistGizmo.vue'
import {
  state, sceneApi, totalTriangles, setNodeModel, selectionSignature, setImpostorPreview,
  clearSelection as clearSelectionAction, toggleNodePanel,
  addAttachmentAt,
  moveAttachmentAt,
} from '../store/treeStore.js'

const host = ref(null)
const fps = ref(0)
const axisCv = ref(null)

/* ---------------- 渲染引擎切换 (右上角悬浮控件) ----------------
 * engineMode 是用户的**意图** (auto/webgpu/webgl, 存在 params.scene.renderer 里,
 * 会随 .ftree 导出/导入走); state.renderBackend 是**实际**后端。
 * 两者可能不一致: auto 在没 WebGPU 的机器上会落到 WebGL 2 (Node) 或经典 WebGL —— 这正是要展示的信息。
 * 真正的重建在 switchBackend() 里 (保存位姿 -> dispose -> 新后端重建 -> 还原视角)。 */
const engineMode = computed(() => state.params.scene.renderer || 'auto')
const engineTitle = computed(() => {
  const cur = state.renderBackend || '初始化中'
  if (engineMode.value === 'auto') {
    return `当前实际后端: ${cur}\n自动模式: 优先 WebGPU, 不可用时回退 WebGL 2 (Node) / 经典 WebGL\n切换会立即重建场景, 保留当前视角, 无需刷新页面`
  }
  const want = engineMode.value === 'webgpu' ? 'WebGPU' : 'WebGL'
  return `当前实际后端: ${cur}\n已指定: ${want}\n切换会立即重建场景, 保留当前视角, 无需刷新页面`
})
const ENGINE_KEY = 'fasttree.renderer'

/** 读上次手动选择的渲染引擎 (localStorage)。参数表本身不持久化, 所以引擎选择单独存一份。 */
function loadEnginePreference() {
  try {
    const v = localStorage.getItem(ENGINE_KEY)
    return v === 'webgl' || v === 'webgpu' || v === 'auto' ? v : null
  } catch { return null }
}

function saveEnginePreference(v) {
  try { localStorage.setItem(ENGINE_KEY, v) } catch { /* 隐私模式下忽略 */ }
}

function onEngineChange(v) {
  if (v !== 'auto' && v !== 'webgpu' && v !== 'webgl') return
  // 参数立即写回 (下次启动 / 导出工程时沿用); **不要**在这里请求取景, 否则视角会被冲掉
  state.params.scene.renderer = v
  saveEnginePreference(v)
  // 手动切换后把 URL 上的 ?renderer= 去掉: 它会让下次刷新又跳回旧后端,
  // 而用户刚刚明确选过 (探针页从不点这个控件, 所以不影响 A/B 回归)。
  try {
    const u = new URL(window.location.href)
    if (u.searchParams.has('renderer')) {
      u.searchParams.delete('renderer')
      window.history.replaceState(null, '', u.toString())
    }
  } catch { /* ignore */ }
  switchBackend(v)
}

/* ---------------- Blender 风格 XYZ 坐标轴指示器 ----------------
 * 世界坐标系的 X/Y/Z 三个轴通过相机四元数的逆变换投到屏幕:
 * 相机空间里 +X 向右、+Y 向上、+Z 朝向观察者, 所以绘制顺序按 z 从远到近。 */
const AXIS_DIRS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const AXIS_META = [
  { k: 'X', color: '#e8574b' },
  { k: 'Y', color: '#8bd450' },
  { k: 'Z', color: '#4f9cf0' },
]
const _axisQ = new Quaternion()
// 每次重绘记录三个轴字母的屏幕位置, 供点击命中判定
let axisHits = []
// 世界轴方向: 点击某轴 = 把相机放到该轴正方向去看树 (再点一次切到反方向)
const AXIS_VEC = { X: new Vector3(1, 0, 0), Y: new Vector3(0, 1, 0), Z: new Vector3(0, 0, 1) }
function drawAxes() {
  const el = axisCv.value
  const camera = scene && scene.camera
  if (!el || !camera) return
  const size = 84
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const px = Math.round(size * dpr)
  if (el.width !== px || el.height !== px) { el.width = px; el.height = px }
  const g = el.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, size, size)
  const ox = size / 2
  const oy = size / 2
  const R = 23
  // 深色圆形底, 保证在亮色天空/雪景上也看得清
  g.fillStyle = 'rgba(10,13,18,0.55)'
  g.beginPath()
  g.arc(ox, oy, 32, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.12)'
  g.lineWidth = 1
  g.stroke()
  _axisQ.copy(camera.quaternion).invert()
  axisHits = []
  const axes = AXIS_META.map((a, i) => ({ ...a, v: AXIS_DIRS[i].clone().applyQuaternion(_axisQ) }))
    .sort((a, b) => a.v.z - b.v.z) // 指向屏幕里的轴先画
  for (const a of axes) {
    const ex = ox + a.v.x * R
    const ey = oy - a.v.y * R
    const back = a.v.z < -0.15
    g.globalAlpha = back ? 0.4 : 1
    g.strokeStyle = a.color
    g.lineWidth = 2.2
    g.lineCap = 'round'
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(ex, ey); g.stroke()
    g.fillStyle = a.color
    g.beginPath(); g.arc(ex, ey, 7.5, 0, Math.PI * 2); g.fill()
    g.globalAlpha = 1
    g.fillStyle = back ? 'rgba(255,255,255,0.6)' : '#0b0e13'
    g.font = 'bold 9.5px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(a.k, ex, ey + 0.5)
    axisHits.push({ k: a.k, x: ex, y: ey })
  }
}

/** 点击 XYZ 指示器上的轴字母: 把相机移到该轴方向, 保持到 controls.target 的距离不变 */
function onAxisPick(e) {
  const el = axisCv.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  const hit = axisHits.find((h) => (h.x - x) ** 2 + (h.y - y) ** 2 <= 13 * 13)
  if (!hit) return
  e.preventDefault()
  e.stopPropagation()
  setAxisView(hit.k)
}

function setAxisView(k) {
  const cam = scene && scene.camera
  if (!cam) return
  const controls = scene.controls
  const target = controls && controls.target ? controls.target.clone() : new Vector3()
  const dist = Math.max(0.5, cam.position.distanceTo(target))
  const dir = AXIS_VEC[k].clone()
  // 已经在这个轴的正方向时, 再点一次切到反方向 (与 Blender 一致)
  const cur = cam.position.clone().sub(target)
  if (cur.lengthSq() > 1e-8 && cur.normalize().dot(dir) > 0.999) dir.negate()
  // 顶视图 (沿 Y 轴看) 时默认 up=(0,1,0) 与视线平行, 改用 -Z 作屏幕上方
  cam.up.set(0, 1, 0)
  if (Math.abs(dir.y) > 0.9) cam.up.set(0, 0, -1)
  cam.position.copy(target).addScaledVector(dir, dist)
  cam.lookAt(target)
  if (controls) controls.update()
}

const MODE_LABEL = { highlight: '高亮', isolate: '仅显示选中', dim: '其余变暗' }
const modeLabel = computed(() => MODE_LABEL[state.selection.mode] || '高亮')
const activeLodTriangles = computed(() => {
  const e = (state.lodInfo || []).find((x) => x.level === state.lodLevel)
  return e ? e.triangles : totalTriangles.value
})

function clearSelection() {
  clearSelectionAction()
}

function playGrowth() {
  state.params.growth.enabled = true
  state.params.growth.value = 0
  state.params.growth.auto = true
}

let scene = null
let unmounted = false
let rebuildTimer = 0
let rebuildQueued = false
let rebuildFrame = false
let fpsFrames = 0
let lastCustomCode = ''

onMounted(async () => {
  startBridgeClient()
  // 渲染器初始化是异步的 (WebGPU 要 await device 就绪)。
  // URL 覆盖: dev/renderer-backend-check.html 需要同一棵树分别在两种后端下截图对比,
  // 而参数表每次刷新都回到默认值('auto'), 没有 URL 入口就没法在页面间固定后端。
  // 只接受 webgl / webgpu 两个值, 其它一律忽略 (避免把非法值带进 createRenderer)。
  try {
    const forced = new URLSearchParams(window.location.search).get('renderer')
    if (forced === 'webgl' || forced === 'webgpu') state.params.scene.renderer = forced
    else {
      // URL 没指定时, 用上次手动选择的引擎 (存 localStorage): 引擎是个"环境偏好",
      // 不该每刷新一次就悄悄回到 auto。
      const saved = loadEnginePreference()
      if (saved) state.params.scene.renderer = saved
    }
  } catch { /* 老浏览器不支持 URLSearchParams / localStorage 被禁时静默忽略 */ }
  await mountScene({ frameCamera: true })

  if (import.meta.env && import.meta.env.DEV) {
    window.__fastTreeScene = scene
    window.__fastTreeSceneApi = sceneApi
  }

  // FPS 统计 (只挂一次: 切换后端时 scene 会被换掉, 循环本身不重建)
  let last = performance.now()
  const tickFps = () => {
    const now = performance.now()
    fpsFrames++
    if (now - last >= 500) {
      fps.value = Math.round((fpsFrames * 1000) / (now - last))
      fpsFrames = 0
      last = now
    }
    drawAxes()
    requestAnimationFrame(tickFps)
  }
  requestAnimationFrame(tickFps)

  setupWatchers()
})

/**
 * 建渲染器 + 建场景 + 把当前 state 灌进去。
 *
 * 为什么单独抽成函数: 前端「渲染引擎」切换是**热切换** —— 销毁旧 renderer 之后,
 * 用同一套参数在新后端上重新建一遍。渲染器本身无法原地换类型 (材质体系都不同),
 * 所以"换引擎"必然等于"重建 scene"; 抽出来是为了让首屏和切换走同一条代码路径,
 * 不存在"初始化能用、切换走另一套魔法"的分叉。
 *
 * @param {{frameCamera?: boolean, pose?: {pos: Vector3, target: Vector3} | null}} opts
 *   frameCamera: 建完是否重新取景 (首屏 true; 切换时 false, 用 pose 还原用户视角)
 * @returns {Promise<void>}
 */
async function mountScene(opts = {}) {
  const { createRenderer } = await import('../core/rendererBackend.js')
  const mode = (state.params.scene && state.params.scene.renderer) || 'auto'
  // createRenderer 内部已处理"WebGPU 不可用 -> 回退 WebGL", 不会 throw。
  const backend = await createRenderer({ mode })
  let gpuMaterials = null
  if (backend.isNodeRenderer) {
    // 只有 Node 渲染路径才需要 TSL 材质; 动态 import 避免 WebGL 用户白下载这份代码。
    try {
      gpuMaterials = await import('../core/materialsGPU.js')
    } catch (e) {
      console.warn('[fast-tree] TSL 材质加载失败, 将退回经典材质 (风场/苔藓等注入效果会失效):', e)
    }
  }
  if (unmounted) {
    try { backend.renderer.dispose() } catch { /* ignore */ }
    return
  }
  state.renderBackend = backend.backendName
  scene = new TreeScene(host.value, {
    onStats: (s) => { state.stats = s; state.ready = true },
    onShaderError: (msg) => { state.shaderError = msg },
    onFrame: (info) => {
      // 这个回调每帧都来一次; 直接赋值会让 Vue 每秒调度 60 次响应式更新, 而数值
      // 只在 LOD 切换 / 线框开关 / 参数重建时才变。做变化检测后几乎不再触发重渲染。
      const prev = state.renderInfo
      if (prev.calls !== info.calls || prev.triangles !== info.triangles) {
        state.renderInfo = { calls: info.calls, triangles: info.triangles }
      }
    },
    onGrowth: (v) => { state.params.growth.value = v },
    onModel: (m) => setNodeModel(m),
    onLod: (m) => { state.lodLevel = m.level; state.lodInfo = m.levels },
    onBranchEdit: ({ index, patch }) => {
      // 3D 变换轴释放后提交: 合并到该骨架分支的 branchEdits
      if (!state.params.branchEdits) state.params.branchEdits = {}
      const key = String(index)
      state.params.branchEdits[key] = { ...(state.params.branchEdits[key] || {}), ...patch }
    },
    onForceEdit: ({ id, patch }) => {
      // 视口轴拖动时实时写回力场参数 (拖动期间 previewHold, 树不会重建)
      const items = state.params.forces && Array.isArray(state.params.forces.items)
        ? state.params.forces.items : []
      const it = items.find((x) => x.id === id)
      if (it) Object.assign(it, patch)
    },
    onForceDragChange: (dragging) => {
      // 拖动/松手配对增减, 松开后 scheduleRebuild 会统一重建一次树
      state.previewHold = Math.max(0, (state.previewHold || 0) + (dragging ? 1 : -1))
    },
    onForceSelect: (id) => {
      // 视口点选力场 -> 同步面板下拉框与变换轴
      if (id && state.activeForceId !== id) state.activeForceId = id
    },
    onAttachmentPick: ({ node, t }) => {
      // 附属物面板的"点选摆放": 在命中的枝条位置追加一件手工挂件。
      // 单次生效 (放完立即退出点选): 否则用户想挪视角时随手一点就会多一件。
      if (!state.attachmentPicking) return
      if (state.attachmentPickMode === 'move') moveAttachmentAt(node, t)
      else addAttachmentAt(node, t, state.attachmentType)
      state.attachmentPicking = false
    },
  }, {
    renderer: backend.renderer,
    isNodeRenderer: backend.isNodeRenderer,
    isWebGPU: backend.isWebGPU,
    gpuMaterials,
    backendName: backend.backendName,
  })

  sceneApi.exportGLB = (name) => (scene ? scene.exportGLB(name) : null)
  sceneApi.exportOBJ = (name) => (scene ? scene.exportOBJ(name) : null)
  sceneApi.screenshot = (name) => (scene ? scene.screenshot(name) : null)
  sceneApi.prepareExport = (kind, name) => (scene ? scene.prepareExport(kind, name) : null)
  sceneApi.frameCamera = () => { if (scene) scene.frameCamera() }
  sceneApi.focusBox = (min, max) => { if (scene) scene.focusBox(min, max) }
  sceneApi.setSkeletonVisible = (v) => { if (scene) scene.setSkeletonVisible(!!v) }
  sceneApi.getWindScreenBasis = () => (scene ? scene.getWindScreenBasis() : null)
  sceneApi.getTwistScreen = (target, level) => (scene ? scene.projectTwistGuide(target, level) : null)
  sceneApi.setControlsEnabled = (v) => { if (scene) scene.controls.enabled = !!v }
  sceneApi.setBranchTransformGizmo = (opts) => { if (scene) scene.setBranchTransformGizmo(opts) }
  sceneApi.setForceTransformGizmo = (opts) => { if (scene) scene.setForceTransformGizmo(opts) }
  sceneApi.setForcePicking = (v) => { if (scene) scene.setForcePicking(!!v) }
  sceneApi.setAttachmentPicking = (v) => { if (scene) scene.setAttachmentPicking(!!v) }
  sceneApi.updateForceGizmos = () => { if (scene) scene.updateForceGizmos(state.params.forces) }
  sceneApi.makeImpostor = (opts) => (scene ? scene.makeImpostor(opts) : null)
  sceneApi.setImpostorModel = (res) => { if (scene) scene.setImpostorPreview(res) }
  // 验证/脚本用的同步重建 (应用内重建走 rAF, 后台标签页会被节流)
  sceneApi.rebuildNow = (frame = true) => {
    if (!scene) return null
    const stats = scene.build(state.params, { frameCamera: !!frame })
    scene.setSelection(state.selection)
    return stats
  }
  // 渲染引擎热切换 (顶栏「引擎」下拉 / 场景面板"渲染后端"共用这一个入口)
  sceneApi.switchBackend = (mode) => switchBackend(mode)
  sceneApi.captureCameraPose = () => captureCameraPose()

  scene.updateScene(state.params.scene)
  scene.updateGrowth(state.params.growth, state.params.growth.value)
  scene.setGrowthAuto(state.params.growth.enabled && state.params.growth.auto, state.params.growth.speed)
  scene.windTimeScale = state.params.wind.timeScale
  scene.setPlaying(state.playing)
  scene.updateForceGizmos(state.params.forces)
  lastCustomCode = customSignature()
  if (opts.frameCamera || !opts.pose) {
    rebuild(true)
  } else {
    // 热切换: 不重新取景 —— 用户刚摆好的视角不能因为换引擎就跳走
    scene.build(state.params, { frameCamera: false })
    scene.setSelection(state.selection)
    scene.camera.position.copy(opts.pose.pos)
    scene.controls.target.copy(opts.pose.target)
    scene.controls.update()
    state.busy = false
    state.shaderError = ''
  }
  if (import.meta.env && import.meta.env.DEV) {
    window.__fastTreeScene = scene
    window.__fastTreeSceneApi = sceneApi
  }
}

/** 取当前相机位姿 (热切换前后还原视角用) */
function captureCameraPose() {
  if (!scene || !scene.camera || !scene.controls) return null
  return {
    pos: scene.camera.position.clone(),
    target: scene.controls.target.clone(),
  }
}

/**
 * 热切换渲染后端: auto / webgpu / webgl。
 *
 * 为什么不能"原地换": 两条路径的材质体系完全不同 (NodeMaterial/TSL vs PBR+onBeforeCompile),
 * 后处理管线、阴影深度材质、粒子材质也都绑在 renderer 上。所以只能
 * 保存相机位姿 -> dispose 旧 scene(连带 renderer/canvas) -> 用新后端重建 -> 还原视角。
 * 参数全在 state.params 里 (含 seed), 重建出来的是**同一棵树**, 无缝切换。
 *
 * @param {'auto'|'webgpu'|'webgl'} mode
 * @returns {Promise<boolean>} 是否真的执行了切换 (重复点击同一模式返回 false)
 */
async function switchBackend(mode) {
  const want = mode === 'webgl' || mode === 'webgpu' ? mode : 'auto'
  state.params.scene.renderer = want
  if (state.engineSwitching || !scene) return false
  // 已经是目标后端时不要白重建一次 (auto 与 webgpu 在真有 WebGPU 的机器上等价)
  const cur = state.renderBackend
  if (want === 'webgl' && cur === 'WebGL') return false
  if (want === 'webgpu' && cur === 'WebGPU') return false
  if (want === 'auto' && cur === 'WebGPU') return false
  const pose = captureCameraPose()
  state.engineSwitching = true
  state.busy = true
  try {
    scene.dispose()
    scene = null
    await mountScene({ frameCamera: false, pose })
    state.rebuildVersion++ // 让外部(桥接/脚本)知道场景换了实例
    return true
  } catch (e) {
    console.error('[fast-tree] 切换渲染引擎失败:', e)
    state.shaderError = String((e && e.stack) || e)
    return false
  } finally {
    state.engineSwitching = false
    state.busy = false
  }
}

onBeforeUnmount(() => {
  unmounted = true
  scene?.dispose()
  scene = null
})

function scheduleRebuild(frame) {
  rebuildQueued = true
  // 只要有一次请求带取景, 这次重建就取景 (状态切换后需要重新框住新尺寸)
  if (frame) rebuildFrame = true
  if (rebuildTimer) return
  rebuildTimer = setTimeout(() => {
    rebuildTimer = 0
    if (!rebuildQueued) return
    rebuildQueued = false
    const f = rebuildFrame
    rebuildFrame = false
    rebuild(f)
  }, 90)
}

function rebuild(frame) {
  if (!scene) return
  state.busy = true
  // 整树重建是同步的几百毫秒, 直接把 build 放进 rAF 回调会把这一帧占满, 浏览器来不及
  // 绘制 "重建几何中…" 提示, 用户只看到画面冻结。rAF 之后再挂一个 0ms 定时器:
  // 帧回调返回 -> 浏览器完成绘制 (提示上屏) -> 才进同步重建。
  requestAnimationFrame(() => setTimeout(() => {
    if (!scene) return
    try {
      scene.build(state.params, { frameCamera: !!frame })
      state.shaderError = ''
      // 重建后 node id 会变, 重新套用选中状态 (高亮 uniform + 包围盒)
      scene.setSelection(state.selection)
    } catch (e) {
      console.error(e)
      state.shaderError = String((e && e.stack) || e)
    } finally {
      state.busy = false
    }
  }, 0))
}

function customSignature() {
  const c = state.params.custom
  return (c.enabled ? '1' : '0') + '|' + c.vertex + '|' + c.fragment
}

function setupWatchers() {
  // 贴图位置调整面板拖动期间 (state.previewHold > 0) 不重建主窗口: 只记脏标记,
  // 松手后统一补一次, 避免拖动时每帧重建整棵树。
  let heldGeometry = false
  let heldMaterial = false
  const applyMaterialUpdate = () => {
    if (!scene) return
    scene.updateMaterialParams(state.params)
    const sig = customSignature()
    if (sig !== lastCustomCode && state.ready) {
      scene.rebindCustomShader(state.params)
      lastCustomCode = sig
    }
  }
  watch(() => serializeGroup(state.params, 'geometry'), () => {
    if (state.previewHold > 0) { heldGeometry = true; return }
    scheduleRebuild(false)
  })
  // 空间引导力: 示意图与变换轴是轻量的, 即使树在 previewHold 期间暂停重建,
  // 也要立刻跟手更新 (只动 gizmo, 不碰几何管线)。
  watch(() => serializeGroup(state.params, 'forces'), () => {
    scene?.updateForceGizmos(state.params.forces)
  })
  // 树皮几何管线虽然在 bark 材质组里, 但切换会改变整张树皮拓扑 -> 必须重建几何
  watch(() => state.params.bark && state.params.bark.pipeline, () => scheduleRebuild(false))
  watch(() => selectionSignature(), () => {
    scene?.setSelection(state.selection)
  })
  watch(() => serializeGroup(state.params, 'material'), () => {
    if (state.previewHold > 0) { heldMaterial = true; return }
    applyMaterialUpdate()
  })
  watch(() => state.previewHold, (n) => {
    if (n > 0) return
    if (heldGeometry) { heldGeometry = false; scheduleRebuild(false) }
    if (heldMaterial) { heldMaterial = false; applyMaterialUpdate() }
  })
  watch(() => serializeGroup(state.params, 'wind'), () => {
    if (!scene) return
    scene.updateWind(state.params)
    scene.windTimeScale = state.params.wind.timeScale
  })
  watch(() => serializeGroup(state.params, 'scene'), () => {
    scene?.updateScene(state.params.scene)
  })
  watch(() => state.params.growth, (g) => {
    if (!scene) return
    scene.updateGrowth(g, g.value)
    scene.setGrowthAuto(g.enabled && g.auto, g.speed)
  }, { deep: true })
  watch(() => state.playing, (v) => scene?.setPlaying(v))
  watch(() => state.frameVersion, () => {
    // 注意: 这里不能重置生长进度 —— 否则切换树种/阶段/季节或点取景时整棵树会先消失再长出来
    // (需要"重新长一遍"的动作会显式调用 state.regrowToken)
    scene?.frameCamera()
  })
  watch(() => state.regrowToken, () => {
    if (!scene) return
    state.params.growth.value = 0
    scene.updateGrowth(state.params.growth, 0)
    scene.setGrowthAuto(state.params.growth.enabled && state.params.growth.auto, state.params.growth.speed)
  })
  watch(() => state.rebuildVersion, () => scheduleRebuild(true))
  watch(() => state.materialVersion, () => {
    scene?.rebindCustomShader(state.params)
    lastCustomCode = customSignature()
  })
}
</script>

<style scoped>
/* XYZ 指示器: 放在风向罗盘下方, 右上角区域; 轴字母可点击切视角 */
.axis-gizmo {
  position: absolute;
  right: 12px;
  top: 190px;
  width: 84px;
  height: 84px;
  cursor: pointer;
  z-index: 5;
}

/* 渲染引擎切换: 贴左下角、压在操作提示上方。
   为什么不在顶栏: 顶栏按钮多, 窄窗口(≈1150px)已经排满, 塞进去会被挤出屏幕;
   为什么不在右上: 那里是"播放生长 / 风向罗盘 / XYZ 指示器"三件套。 */
.overlay.engine-switch {
  left: 12px;
  bottom: 44px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px;
  pointer-events: auto;
  z-index: 6;
  font-size: 11px;
}
.engine-label { color: var(--fg-dim); }
.engine-select {
  height: 24px;
  padding: 0 4px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: rgba(10, 18, 26, 0.9);
  color: var(--fg);
  font-size: 11px;
  cursor: pointer;
}
.engine-select:disabled { cursor: progress; opacity: 0.6; }
.engine-badge {
  min-width: 62px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}
.engine-badge.busy { color: var(--fg-dim); }
</style>
