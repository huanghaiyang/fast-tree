<template>
  <div class="viewport-wrap">
    <div ref="host" class="viewport-canvas"></div>

    <div v-if="state.shaderError" class="error-banner">
      <button class="btn small ghost" style="position: absolute; right: 6px; top: 6px" @click="state.shaderError = ''">✕</button>
      <b>着色器编译错误 / 运行错误</b>
      <pre style="margin: 4px 0 0; white-space: pre-wrap">{{ state.shaderError }}</pre>
    </div>

    <div v-if="state.busy" class="busy">重建几何中…</div>

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
} from '../store/treeStore.js'

const host = ref(null)
const fps = ref(0)
const axisCv = ref(null)

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
let rebuildTimer = 0
let rebuildQueued = false
let rebuildFrame = false
let fpsFrames = 0
let lastCustomCode = ''

onMounted(() => {
  startBridgeClient()
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
  })

  sceneApi.exportGLB = (name) => scene.exportGLB(name)
  sceneApi.exportOBJ = (name) => scene.exportOBJ(name)
  sceneApi.screenshot = (name) => scene.screenshot(name)
  sceneApi.prepareExport = (kind, name) => scene.prepareExport(kind, name)
  sceneApi.frameCamera = () => scene.frameCamera()
  sceneApi.focusBox = (min, max) => scene.focusBox(min, max)
  sceneApi.setSkeletonVisible = (v) => { if (scene) scene.setSkeletonVisible(!!v) }
  sceneApi.getWindScreenBasis = () => scene.getWindScreenBasis()
  sceneApi.getTwistScreen = (target, level) => (scene ? scene.projectTwistGuide(target, level) : null)
  sceneApi.setControlsEnabled = (v) => { if (scene) scene.controls.enabled = !!v }
  sceneApi.setBranchTransformGizmo = (opts) => { if (scene) scene.setBranchTransformGizmo(opts) }
  sceneApi.setForceTransformGizmo = (opts) => { if (scene) scene.setForceTransformGizmo(opts) }
  sceneApi.setForcePicking = (v) => { if (scene) scene.setForcePicking(!!v) }
  sceneApi.updateForceGizmos = () => { if (scene) scene.updateForceGizmos(state.params.forces) }
sceneApi.makeImpostor = (opts) => scene.makeImpostor(opts)
sceneApi.setImpostorModel = (res) => scene.setImpostorPreview(res)
  // 验证/脚本用的同步重建 (应用内重建走 rAF, 后台标签页会被节流)
  sceneApi.rebuildNow = (frame = true) => {
    if (!scene) return null
    const stats = scene.build(state.params, { frameCamera: !!frame })
    scene.setSelection(state.selection)
    return stats
  }
  if (import.meta.env && import.meta.env.DEV) {
    window.__fastTreeScene = scene
    window.__fastTreeSceneApi = sceneApi
  }

  scene.updateScene(state.params.scene)
  scene.updateGrowth(state.params.growth, state.params.growth.value)
  scene.setGrowthAuto(state.params.growth.enabled && state.params.growth.auto, state.params.growth.speed)
  scene.windTimeScale = state.params.wind.timeScale
  scene.setPlaying(state.playing)
  rebuild(true)
  lastCustomCode = customSignature()

  // FPS 统计
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

onBeforeUnmount(() => {
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
</style>
