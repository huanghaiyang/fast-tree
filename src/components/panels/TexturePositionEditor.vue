<template>
  <Teleport to="body">
    <div v-show="open" class="fte-mask" @click.self="close" @pointerdown="beginHold">
      <div class="fte-panel">
        <div class="fte-head">
          <b>{{ isLeaf ? '🍃 叶片贴图位置调整' : '🌸 花朵贴图位置调整' }}</b>
          <span class="fte-hint">左键拖动 = 移动贴图 · 右键拖动 = 旋转模型 · 滚轮 = 缩放贴图 · Shift+左键 = 旋转贴图</span>
          <button class="btn small" @click="resetView" title="只重置 3D 视角, 不动贴图">↺ 视角</button>
          <button class="btn small" @click="reset">重置贴图</button>
          <button class="btn small primary" @click="close">完成</button>
        </div>
        <div class="fte-body">
          <div class="fte-canvas-wrap">
            <canvas ref="cv" class="fte-canvas" />
            <!-- Blender 风格 XYZ 坐标轴指示器 (跟随右键旋转实时更新, 点击轴字母切到正视图) -->
            <canvas ref="axisCv" class="fte-axis" @pointerdown="onAxisPick" />
          </div>
          <div class="fte-side">
            <div class="fte-row"><span>形态</span><b>{{ isLeaf ? '平面叶片卡（贴图 alpha 决定叶形）' : '平面花卡（贴图 alpha 决定花形）' }}</b></div>
            <div class="fte-pad-row">
              <div>
                <div class="fte-pad-label">贴图偏移（二维）</div>
                <TexturePad v-model="texOffset" :min="-1" :max="1" />
              </div>
              <div class="fte-pad-sliders">
                <SliderRow label="横向平铺" v-model="t.textureRepeatU" :min="0.1" :max="8" :step="0.05" />
                <SliderRow label="纵向平铺" v-model="t.textureRepeatV" :min="0.1" :max="8" :step="0.05" />
              </div>
            </div>
            <SliderRow label="贴图旋转" v-model="t.textureRotation" :min="-3.14" :max="3.14" :step="0.02" />
            <SliderRow label="贴图裁切" v-model="t.alphaTest" :min="0" :max="0.9" :step="0.01" />
            <p class="fte-tip">
              {{ isLeaf ? '叶片卡' : '花卡' }}按贴图 alpha 裁形；拖动偏移/平铺可以调整贴图在卡片上的位置与密度。
            </p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import * as THREE from 'three'
import SliderRow from '../ui/SliderRow.vue'
import TexturePad from '../ui/TexturePad.vue'
import { state } from '../../store/treeStore.js'
import { createSharedUniforms, createFlowerMaterial, createLeafMaterial } from '../../core/materials.js'
import { buildLeafCardTemplate } from '../../core/leaf.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 'flower' = 花朵 (params.flower + 花朵材质); 'leaf' = 叶片 (params.leafMat + 树叶材质)
  kind: { type: String, default: 'flower' },
})
const emit = defineEmits(['update:modelValue'])
const open = ref(props.modelValue)
const cv = ref(null)
const axisCv = ref(null)
const isLeaf = computed(() => props.kind === 'leaf')
// 贴图参数所在组: 花朵在 params.flower, 叶片在 params.leafMat。
// 用 computed 而不是缓存引用: 换种子/换预设会整体替换 state.params。
const t = computed(() => (isLeaf.value ? state.params.leafMat : state.params.flower))
// 卡片形状参数: 花朵在 params.flower, 叶片在 params.leaves (cardAspect/cardCurl/cardFold)
const shape = computed(() => (isLeaf.value ? state.params.leaves : state.params.flower))
const texOffset = computed({
  get: () => [t.value.textureU || 0, t.value.textureV || 0],
  set: (v) => { t.value.textureU = v[0]; t.value.textureV = v[1] },
})

let renderer = null
let scene = null
let camera = null
let mesh = null
let material = null
let whiteMesh = null
let whiteEdges = null
let whiteMaterial = null
let edgeMaterial = null
let dragging = null
let rafId = 0
// 默认正面居中: 相机在 +Z 看向原点, 卡片本身朝 +Z, 旋转为 0 即正视图
const modelRot = { x: 0, y: 0 }
if (typeof window !== 'undefined') window.__flowerTexEditorState = modelRot
// 每次重绘记录三个轴字母的屏幕位置, 供点击命中判定
let axisHits = []

/* ---------------- 几何: 平面卡 + 白模 ---------------- */
function rebuildGeometry() {
  const q = shape.value
  const src = buildLeafCardTemplate({
    aspect: q.cardAspect || 1, cols: 1, rows: 3,
    curl: q.cardCurl === undefined ? 0.1 : q.cardCurl,
    fold: q.cardFold === undefined ? 0.12 : q.cardFold,
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(src.positions, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(src.normals, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(src.uvs, 2))
  g.setIndex(src.index)
  const n = src.positions.length / 3
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3))
  // 把几何的包围球中心平移到原点 —— 旋转枢轴必须是卡片中心。
  // (之前是给对象设 position=-center, 但 three 的 rotation 绕对象自身原点,
  //  会导致右键旋转时卡片绕着画面外的一点公转, 看起来像"白模偏出预览区中心")
  g.computeBoundingSphere()
  const c = g.boundingSphere ? g.boundingSphere.center.clone() : new THREE.Vector3()
  g.translate(-c.x, -c.y, -c.z)
  g.computeBoundingSphere()
  if (!scene) return

  // 贴图卡片
  if (!mesh) {
    mesh = new THREE.Mesh(g, material)
    mesh.name = 'FlowerCardPreview'
    mesh.renderOrder = 1 // 白模(-1) -> 卡片(1) -> 轮廓线(2)
    scene.add(mesh)
  } else {
    mesh.geometry.dispose()
    mesh.geometry = g
    mesh.material = material
  }
  // 白模: 与卡片共用几何, 用同一张卡片当底板
  // —— 贴图 alpha 裁掉的区域会露出白模, 从而看清卡片本身的形状与位置
  if (!whiteMesh) {
    whiteMesh = new THREE.Mesh(g, whiteMaterial)
    whiteMesh.name = 'FlowerCardWhite'
    // 先画白模, 再画贴图卡片 (两者同一几何, 共面 -> 靠 renderOrder 定先后)
    whiteMesh.renderOrder = -1
    scene.add(whiteMesh)
  } else {
    whiteMesh.geometry = g
    whiteMesh.material = whiteMaterial
  }
  // 卡片轮廓: 只保留被单个三角形引用的边 (网格内部的共用边不算轮廓)
  const eg = buildBoundaryLineGeometry(src)
  // 网格几何已经平移到中心, 轮廓线也必须用同一个偏移, 否则会看到一条错位的边
  eg.translate(-c.x, -c.y, -c.z)
  if (!whiteEdges) {
    whiteEdges = new THREE.LineSegments(eg, edgeMaterial)
    whiteEdges.name = 'FlowerCardEdges'
    whiteEdges.renderOrder = 2
    scene.add(whiteEdges)
  } else {
    whiteEdges.geometry.dispose()
    whiteEdges.geometry = eg
  }

  // 清掉重建残留的旧对象 (不含当前这三个)
  for (const child of [...scene.children]) {
    if (child === mesh || child === whiteMesh || child === whiteEdges) continue
    if (child.isMesh || child.isLine) {
      scene.remove(child)
      child.geometry.dispose()
    }
  }
  frame()
  applyModelRotation()
}

/** 从网格 index 中提取边界边, 生成 LineSegments 用的几何 */
function buildBoundaryLineGeometry(src) {
  const use = new Map()
  const idx = src.index
  for (let i = 0; i < idx.length; i += 3) {
    const tri = [idx[i], idx[i + 1], idx[i + 2]]
    for (let k = 0; k < 3; k++) {
      const a = tri[k]
      const b = tri[(k + 1) % 3]
      const key = a < b ? a + '_' + b : b + '_' + a
      use.set(key, (use.get(key) || 0) + 1)
    }
  }
  const out = []
  const p = src.positions
  for (const [key, count] of use) {
    if (count !== 1) continue
    const [a, b] = key.split('_').map(Number)
    out.push(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  return g
}

/* ---------------- 材质 ---------------- */
function rebuildMaterial() {
  if (material) material.dispose()
  const uniforms = createSharedUniforms()
  // 预览必须是"静止姿态": 关掉风场与生长。
  // 风场顶点位移在 uTime=0 时仍有一个静态偏置 (uWindBias), 会把卡片整体斜着推离原位,
  // 卡片与白模就不再共面, 白模会从贴图前面透出来 —— 看起来就像"贴图一部分跑到背面去了"。
  uniforms.uWindEnabled.value = 0
  uniforms.uGrowthEnabled.value = 0
  uniforms.uGrowth.value = 1
  material = isLeaf.value
    ? createLeafMaterial(state.params, uniforms)
    : createFlowerMaterial(state.params, uniforms)
  material.side = THREE.DoubleSide
  material.alphaTest = Math.max(0.05, Math.min(0.9, t.value.alphaTest === undefined ? 0.35 : t.value.alphaTest))
  material.transparent = false
  material.needsUpdate = true
  // 没有贴图时用 UV 棋盘兜底 (树叶材质会自动生成程序化叶形贴图, 但棋盘更能看清位置)
  if (!t.value.texture || !material.map) {
    material.map = makeCheckerTexture()
    material.color = new THREE.Color(0xffffff)
  }
  if (mesh) mesh.material = material
  applyUvTransform()
}

/** 没有贴图时的 UV 棋盘 (保证模型可见) */
function makeCheckerTexture() {
  const size = 256
  const c2 = document.createElement('canvas')
  c2.width = c2.height = size
  const g = c2.getContext('2d')
  const cells = 8
  const cell = size / cells
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      g.fillStyle = (x + y) % 2 ? '#d8dde6' : '#7f8b9c'
      g.fillRect(x * cell, y * cell, cell, cell)
    }
  }
  g.strokeStyle = 'rgba(255,255,255,0.35)'
  g.lineWidth = 1
  for (let i = 0; i <= cells; i++) {
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, size); g.stroke()
    g.beginPath(); g.moveTo(0, i * cell); g.lineTo(size, i * cell); g.stroke()
  }
  const tex = new THREE.CanvasTexture(c2)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function applyUvTransform() {
  const map = material && material.map
  if (!map) return
  const p = t.value
  map.center.set(0.5, 0.5)
  map.offset.set(p.textureU || 0, p.textureV || 0)
  map.repeat.set(
    p.textureRepeatU === undefined ? 1 : p.textureRepeatU,
    p.textureRepeatV === undefined ? 1 : p.textureRepeatV,
  )
  map.rotation = p.textureRotation || 0
  map.needsUpdate = true
}

/* ---------------- 相机/渲染 ---------------- */
function frame() {
  if (!mesh || !camera) return
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
  const sphere = mesh.geometry.boundingSphere
  const r = Math.max(0.001, sphere ? sphere.radius : 1)
  // 几何已按包围球中心平移到原点 -> 对象不需要再平移, 旋转/取景都绕卡片中心
  for (const o of [mesh, whiteMesh, whiteEdges]) {
    if (o) o.position.set(0, 0, 0)
  }
  const dist = (r / Math.tan((35 * Math.PI) / 180 / 2)) / 0.72
  camera.position.set(0, 0, Math.max(0.6, dist))
  camera.lookAt(0, 0, 0)
}

function applyModelRotation() {
  for (const o of [mesh, whiteMesh, whiteEdges]) {
    if (o) o.rotation.set(modelRot.x, modelRot.y, 0, 'YXZ')
  }
}

function render() {
  if (!renderer || !scene || !camera) return
  renderer.setRenderTarget(null)
  renderer.setClearColor(0x0b0e13, 1)
  renderer.clear(true, true, true)
  renderer.render(scene, camera)
  drawAxes()
}

/* ---------------- Blender 风格 XYZ 坐标轴指示器 ---------------- */
const AXIS_SIZE = 84
function drawAxes() {
  const el = axisCv.value
  if (!el) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const px = Math.round(AXIS_SIZE * dpr)
  if (el.width !== px || el.height !== px) { el.width = px; el.height = px }
  const g = el.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, AXIS_SIZE, AXIS_SIZE)
  const ox = AXIS_SIZE / 2
  const oy = AXIS_SIZE / 2
  const R = 24
  // 与 applyModelRotation 的 'YXZ' 欧拉角一致: R = Ry(y) * Rx(x)
  const sy = Math.sin(modelRot.y), cyy = Math.cos(modelRot.y)
  const sx = Math.sin(modelRot.x), cxx = Math.cos(modelRot.x)
  // 相机在 +Z 看向原点: 屏幕 x = 世界 x, 屏幕 y = -世界 y, 深度 = 世界 z
  const axes = [
    { k: 'X', v: [cyy, 0, -sy], color: '#e8574b' },
    { k: 'Y', v: [sy * sx, cxx, cyy * sx], color: '#8bd450' },
    { k: 'Z', v: [sy * cxx, -sx, cyy * cxx], color: '#4f9cf0' },
  ].sort((a, b) => a.v[2] - b.v[2]) // 指向屏幕里的轴先画, 前面的盖住它
  axisHits = []
  for (const a of axes) {
    const [vx, vy, vz] = a.v
    const ex = ox + vx * R
    const ey = oy - vy * R
    const back = vz < -0.15
    g.globalAlpha = back ? 0.4 : 1
    g.strokeStyle = a.color
    g.lineWidth = 2.4
    g.lineCap = 'round'
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(ex, ey); g.stroke()
    g.fillStyle = a.color
    g.beginPath(); g.arc(ex, ey, 8, 0, Math.PI * 2); g.fill()
    g.globalAlpha = 1
    g.fillStyle = back ? 'rgba(255,255,255,0.6)' : '#0b0e13'
    g.font = 'bold 10px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(a.k, ex, ey + 0.5)
    axisHits.push({ k: a.k, x: ex, y: ey })
  }
}

/** 点击 XYZ 指示器上的轴字母: 把模型转到该轴正对相机的姿态 */
function onAxisPick(e) {
  const el = axisCv.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  const hit = axisHits.find((h) => (h.x - x) ** 2 + (h.y - y) ** 2 <= 13 * 13)
  if (!hit) return
  // 不把这次点击当成"开始拖动贴图/触发主预览重建"
  e.preventDefault()
  e.stopPropagation()
  setAxisView(hit.k)
}

const AXIS_VIEWS = {
  X: { x: 0, y: -Math.PI / 2 },   // 沿 +X 看卡片 (卡面朝屏幕右侧)
  Y: { x: Math.PI / 2, y: 0 },    // 沿 +Y 看卡片 (俯视)
  Z: { x: 0, y: 0 },              // 沿 +Z 看卡片 (正视图)
}
const AXIS_VIEWS_OPPOSITE = {
  X: { x: 0, y: Math.PI / 2 },
  Y: { x: -Math.PI / 2, y: 0 },
  Z: { x: 0, y: Math.PI },
}
function setAxisView(k) {
  const target = AXIS_VIEWS[k]
  if (!target) return
  const same = Math.abs(modelRot.x - target.x) < 0.02 &&
    Math.abs(Math.atan2(Math.sin(modelRot.y - target.y), Math.cos(modelRot.y - target.y))) < 0.02
  const next = same ? AXIS_VIEWS_OPPOSITE[k] : target
  modelRot.x = next.x
  modelRot.y = next.y
  applyModelRotation()
  render()
}

/* ---------------- 生命周期 ---------------- */
function disposePreview() {
  stopLoop()
  if (mesh) { if (scene) scene.remove(mesh); mesh.geometry.dispose(); mesh = null }
  if (whiteMesh) { if (scene) scene.remove(whiteMesh); whiteMesh = null }
  if (whiteEdges) { if (scene) scene.remove(whiteEdges); whiteEdges.geometry.dispose(); whiteEdges = null }
  if (material) { material.dispose(); material = null }
  if (whiteMaterial) { whiteMaterial.dispose(); whiteMaterial = null }
  if (edgeMaterial) { edgeMaterial.dispose(); edgeMaterial = null }
  if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); renderer = null }
  scene = null
  camera = null
}

function startLoop() {
  stopLoop()
  const tick = () => { rafId = requestAnimationFrame(tick); render() }
  rafId = requestAnimationFrame(tick)
}
function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

function init() {
  const el = cv.value
  if (!el) return
  const size = 320
  if (renderer && renderer.domElement !== el) disposePreview()
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, preserveDrawingBuffer: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(2, 2.6, 3)
    const fill = new THREE.DirectionalLight(0xcfe2ff, 1.1); fill.position.set(-3, 0.6, 2)
    const rim = new THREE.DirectionalLight(0xffe8c8, 1.2); rim.position.set(-1, -2, -3)
    scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 1.1))
    // 白模: 不透明浅灰白底板, 先画; 卡片随后按 alphaTest 画在它上面
    // 两者共面, 白模用 polygonOffset 往后退一点, 保证卡片稳定压在上面
    whiteMaterial = new THREE.MeshStandardMaterial({
      color: 0xc9d2de, roughness: 0.95, metalness: 0,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    })
    // 卡片轮廓线
    edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xa9bed4, transparent: true, opacity: 0.9,
      depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    })
    bindPointer(el)
  }
  // setSize 必须在每次打开时都执行: 重开面板时 canvas 的 drawingBuffer 可能已经被
  // 浏览器/上一次赋值改过, 而 renderer 内部 viewport 仍是旧的 ratio 尺寸,
  // 两者不一致会让画面被放大/裁剪 (表现为"贴图没显示完全""白模偏出中心")。
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(size, size, false)
  rebuildMaterial()
  rebuildGeometry()
  applyModelRotation()
  applyUvTransform()
  render()
  startLoop()
  installDebug()
}

/* ---------------- 拖动 → 贴图偏移 ----------------
 * 拖动时贴图内容必须在屏幕上严格跟着鼠标走, 与"贴图旋转"、"卡片朝向(右键旋转模型)"都无关。
 * 分两步换算:
 *   ① 屏幕位移 -> 卡片 UV 位移: 用卡片 U/V 轴在屏幕上的投影反解 (视角/朝向都包含在内);
 *   ② 卡片 UV 位移 -> map.offset 增量: offset 是采样坐标的平移, 会被 map.rotation 再转一次、
 *      被 repeat 放大, 必须反向补偿 —— 否则贴图转到 180° 附近时拖动方向会整体反过来。
 */
function repeatOf() {
  const p = t.value
  return {
    u: p.textureRepeatU === undefined ? 1 : p.textureRepeatU,
    v: p.textureRepeatV === undefined ? 1 : p.textureRepeatV,
  }
}

/** 卡片 U/V 轴在屏幕上的投影: 每 1 个 UV 单位对应多少 CSS 像素 */
function cardScreenBasis() {
  if (!mesh || !camera || !renderer) return null
  const g = mesh.geometry
  if (!g.boundingBox) g.computeBoundingBox()
  const bb = g.boundingBox
  if (!bb) return null
  const w = bb.max.x - bb.min.x
  const h = bb.max.y - bb.min.y
  if (!(w > 1e-6) || !(h > 1e-6)) return null
  const rect = renderer.domElement.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  mesh.updateMatrixWorld()
  camera.updateMatrixWorld()
  const v0 = new THREE.Vector3()
  // uv.u 沿卡片 +X 从 0 到 1, uv.v 沿 +Y 从 0 到 1 (见 buildLeafCardTemplate)
  const project = (x, y) => {
    v0.set(x, y, 0).applyMatrix4(mesh.matrixWorld).project(camera)
    return { x: (v0.x * 0.5 + 0.5) * rect.width, y: (0.5 - v0.y * 0.5) * rect.height }
  }
  const cx = (bb.min.x + bb.max.x) / 2
  const cy = (bb.min.y + bb.max.y) / 2
  const p0 = project(cx, cy)
  const pU = project(cx + w, cy)
  const pV = project(cx, cy + h)
  const su = { x: pU.x - p0.x, y: pU.y - p0.y }
  const sv = { x: pV.x - p0.x, y: pV.y - p0.y }
  if (!Number.isFinite(su.x) || !Number.isFinite(sv.y)) return null
  return { su, sv }
}

/** 鼠标位移 (CSS px) -> 贴图 offset 增量, 保证贴图内容在屏幕上追随鼠标 */
function dragToOffsetDelta(dx, dy) {
  const b = cardScreenBasis()
  let mU = 0
  let mV = 0
  if (b) {
    const { su, sv } = b
    // 解 [su sv]·[mU mV]ᵀ = [dx dy]ᵀ (mU/mV 为卡片 UV 单位的内容位移)。
    // 用 2×2 截断最小二乘 (TSVD) 而不是直接求逆: 卡片几乎侧对相机时某一轴在屏幕上
    // 退化 (奇异值≈0), 直接求逆会炸出巨大位移并把拖动方向带反; 截断掉退化方向后,
    // 只会沿屏幕上仍可表示的方向移动, 既不反向也不会突跳。
    const a11 = su.x * su.x + su.y * su.y
    const a12 = su.x * sv.x + su.y * sv.y
    const a22 = sv.x * sv.x + sv.y * sv.y
    const t = a11 + a22
    const detA = Math.max(0, a11 * a22 - a12 * a12)
    const disc = Math.sqrt(Math.max(0, t * t - 4 * detA))
    const l1 = (t + disc) / 2
    const l2 = (t - disc) / 2
    // 特征方向 e (UV 空间) 及其屏幕投影; 沿该方向的解为 (投影·鼠标位移)/λ
    const addDir = (lam, fallbackX, fallbackY) => {
      if (!(lam > 1e-12)) return
      let ex = a12, ey = lam - a11
      let n = Math.hypot(ex, ey)
      const ex2 = lam - a22, ey2 = a12
      const n2 = Math.hypot(ex2, ey2)
      if (n2 > n) { ex = ex2; ey = ey2; n = n2 }
      // λ 恰等于某个对角元时两种形式都是零向量 (如两列正交), 用调用方给的基向量兜底
      if (n < 1e-9) { ex = fallbackX; ey = fallbackY; n = Math.hypot(ex, ey) }
      if (n < 1e-9) return
      ex /= n
      ey /= n
      const px = su.x * ex + sv.x * ey
      const py = su.y * ex + sv.y * ey
      const gain = (px * dx + py * dy) / lam
      mU += gain * ex
      mV += gain * ey
    }
    addDir(l1, 1, 0)
    // 奇异值比 σ2/σ1 < 0.12 视为"屏幕上看不到的方向", 截断掉 (否则会反向/突跳)
    if (l2 > 0.12 * 0.12 * l1) addDir(l2, 0, 1)
    if (!Number.isFinite(mU) || !Number.isFinite(mV)) { mU = dx / 200; mV = -dy / 200 }
  } else {
    mU = dx / 200
    mV = -dy / 200
  }
  const rep = repeatOf()
  const th = t.value.textureRotation || 0
  const c = Math.cos(th)
  const s = Math.sin(th)
  const x = mU * rep.u
  const y = mV * rep.v
  // uv 采样: sample = R(θ)·(repeat ⊙ uv) + offset, 内容位移 m = -R(-θ)·offsetΔ/repeat
  return { dU: -(c * x + s * y), dV: -(-s * x + c * y) }
}

/* ---------------- 交互 ---------------- */
function bindPointer(el) {
  el.addEventListener('contextmenu', (e) => e.preventDefault())
  el.addEventListener('pointerdown', (e) => {
    const mode = e.button === 2 ? 'orbit' : (e.shiftKey ? 'texRot' : 'texMove')
    dragging = {
      mode, x: e.clientX, y: e.clientY,
      // 贴图移动用"按下点到当前位置"的总位移计算, 避免贴图被夹在 ±1 后产生累积误差
      x0: e.clientX, y0: e.clientY,
      rot: t.value.textureRotation, u: t.value.textureU, v: t.value.textureV,
      rx: modelRot.x, ry: modelRot.y,
    }
    try { el.setPointerCapture?.(e.pointerId) } catch { /* 合成事件无真实指针 */ }
    el.style.cursor = mode === 'orbit' ? 'move' : 'grabbing'
  })
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return
    if (dragging.mode === 'orbit') {
      const dx = (e.clientX - dragging.x) / 200
      const dy = (e.clientY - dragging.y) / 200
      modelRot.y = dragging.ry + dx * 4.2
      modelRot.x = Math.max(-1.45, Math.min(1.45, dragging.rx + dy * 3.2))
      dragging.x = e.clientX
      dragging.y = e.clientY
      applyModelRotation()
      render()
      return
    }
    if (dragging.mode === 'texRot') {
      const dx = (e.clientX - dragging.x) / 200
      t.value.textureRotation = Math.max(-3.14, Math.min(3.14, dragging.rot + dx * 3.14))
      dragging.x = e.clientX
      dragging.y = e.clientY
      refresh()
      return
    }
    const { dU, dV } = dragToOffsetDelta(e.clientX - dragging.x0, e.clientY - dragging.y0)
    t.value.textureU = Math.max(-1, Math.min(1, dragging.u + dU))
    t.value.textureV = Math.max(-1, Math.min(1, dragging.v + dV))
    refresh()
  })
  const stop = () => { dragging = null; el.style.cursor = 'grab' }
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)
  el.addEventListener('wheel', (e) => {
    e.preventDefault()
    const k = e.deltaY > 0 ? 0.92 : 1.08
    t.value.textureRepeatU = Math.max(0.1, Math.min(8, (t.value.textureRepeatU || 1) * k))
    t.value.textureRepeatV = Math.max(0.1, Math.min(8, (t.value.textureRepeatV || 1) * k))
    refresh()
  }, { passive: false })
  el.style.cursor = 'grab'
}

function refresh() {
  applyUvTransform()
  render()
}

function resetView() {
  modelRot.x = 0
  modelRot.y = 0
  applyModelRotation()
  render()
}

function reset() {
  t.value.textureU = 0
  t.value.textureV = 0
  t.value.textureRepeatU = 1
  t.value.textureRepeatV = 1
  t.value.textureRotation = 0
  refresh()
}

/* ---------------- 主窗口预览节流 ----------------
 * 拖动贴图/滑杆期间不重建主窗口的树: 只让本面板的预览即时反馈,
 * 松开鼠标 (pointerup) 后才让 Viewport 统一更新一次。 */
let holding = false
function beginHold() {
  if (holding) return
  holding = true
  state.previewHold = (state.previewHold || 0) + 1
  window.addEventListener('pointerup', endHold, true)
  window.addEventListener('pointercancel', endHold, true)
}
function endHold() {
  if (!holding) return
  holding = false
  // 指针在画布外松开 (或被系统取消) 时, 拖动状态也要一起清掉
  dragging = null
  window.removeEventListener('pointerup', endHold, true)
  window.removeEventListener('pointercancel', endHold, true)
  state.previewHold = Math.max(0, (state.previewHold || 0) - 1)
}

function close() {
  endHold()
  open.value = false
  stopLoop()
}

/* ---------------- 监听 ---------------- */
watch(() => props.modelValue, (v) => {
  open.value = v
  if (v) nextTick(init)
})
watch(open, (v) => emit('update:modelValue', v))
watch(() => [t.value.textureU, t.value.textureV, t.value.textureRepeatU, t.value.textureRepeatV, t.value.textureRotation, t.value.texture], refresh)
watch(() => [shape.value.cardAspect, shape.value.cardCurl, shape.value.cardFold, t.value.alphaTest, t.value.texture], () => {
  rebuildMaterial()
  rebuildGeometry()
  applyModelRotation()
  applyUvTransform()
  render()
})

onBeforeUnmount(() => { endHold(); disposePreview() })

/* ---------------- 调试钩子 (自动化验证用) ---------------- */
function debugSnapshot() {
  return {
    kind: props.kind,
    hasRenderer: !!renderer,
    hasMesh: !!mesh,
    meshVisible: mesh ? mesh.visible : null,
    // 只统计"贴图卡片"的网格数 (白模是新增的固定一层, 单独在 whiteMesh 字段报告)
    meshCount: scene ? scene.children.filter((o) => o && o.isMesh && o.name === 'FlowerCardPreview').length : 0,
    hasWhiteMesh: !!whiteMesh,
    whiteVisible: whiteMesh ? whiteMesh.visible : null,
    hasWhiteEdges: !!whiteEdges,
    verts: mesh && mesh.geometry.attributes.position ? mesh.geometry.attributes.position.count : 0,
    rot: [modelRot.x, modelRot.y],
    tex: [t.value.textureU || 0, t.value.textureV || 0],
    cam: camera ? [camera.position.x, camera.position.y, camera.position.z] : null,
    matMap: !!(material && material.map),
    matMapImage: !!(material && material.map && material.map.image),
    matAlphaTest: material ? material.alphaTest : null,
    // 轴字母的屏幕位置 (点击命中判定用)
    axes: axisHits.map((h) => [h.k, Math.round(h.x), Math.round(h.y)]),
    // 拖动方向自检: 给定归一化贴图坐标 (0..1), 反算它当前落在屏幕上的 CSS 像素位置。
    // 拖动前后各取同一个贴图特征点, 位移应当与鼠标位移一致 (不受贴图旋转/卡片朝向影响)。
    featureScreen: (su, sv) => {
      if (!material || !material.map || !mesh || !camera || !renderer) return null
      const map = material.map
      if (map.matrixAutoUpdate) map.updateMatrix()
      const inv = map.matrix.clone().invert()
      const s = new THREE.Vector3(su, sv, 1).applyMatrix3(inv)
      const g = mesh.geometry
      if (!g.boundingBox) g.computeBoundingBox()
      const bb = g.boundingBox
      if (!bb) return null
      const x = bb.min.x + s.x * (bb.max.x - bb.min.x)
      const y = bb.min.y + s.y * (bb.max.y - bb.min.y)
      const rect = renderer.domElement.getBoundingClientRect()
      mesh.updateMatrixWorld()
      camera.updateMatrixWorld()
      const p = new THREE.Vector3(x, y, 0).applyMatrix4(mesh.matrixWorld).project(camera)
      return [+((p.x * 0.5 + 0.5) * rect.width).toFixed(2), +((0.5 - p.y * 0.5) * rect.height).toFixed(2)]
    },
    // 白模是否真的挡在贴图前面: 分别渲染"显示/隐藏白模"两帧, 统计有差异的像素与包围盒。
    // 贴图 alpha 裁掉的地方会露出白模 (这是设计), 所以差异只应出现在透明区域;
    // 若在贴图不透明的中心区域也出现差异, 说明白模真的盖住了贴图。
    whiteDiff: () => {
      if (!renderer || !scene) return null
      const gl = renderer.getContext()
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const grab = () => {
        const px = new Uint8Array(w * h * 4)
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
        return px
      }
      const was = whiteMesh ? whiteMesh.visible : false
      if (whiteMesh) whiteMesh.visible = true
      render()
      const a = grab()
      if (whiteMesh) whiteMesh.visible = false
      render()
      const b = grab()
      if (whiteMesh) whiteMesh.visible = was
      render()
      let diff = 0, minX = w, minY = h, maxX = -1, maxY = -1
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) {
            diff++
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      return { diff, bbox: maxX < 0 ? null : [minX, minY, maxX, maxY] }
    },
    setWhite: (v) => {
      if (whiteMesh) whiteMesh.visible = !!v
      render()
      return whiteMesh ? whiteMesh.visible : null
    },
    // 画布 drawingBuffer 与 renderer viewport 必须一致 (否则画面会被放大/裁剪)
    canvas: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
    viewport: renderer ? [renderer.getDrawingBufferSize(new THREE.Vector2()).x, renderer.getDrawingBufferSize(new THREE.Vector2()).y] : null,
    render: () => { render(); return true },
    pixels: () => {
      if (!renderer || !scene || !camera) return null
      render()
      const gl = renderer.getContext()
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const px = new Uint8Array(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
      let nonClear = 0, sr = 0, sg = 0, sb = 0
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2]
        const isClear = Math.abs(r - 11) < 8 && Math.abs(g - 14) < 8 && Math.abs(b - 19) < 8
        if (!isClear) { nonClear++; sr += r; sg += g; sb += b }
      }
      return {
        w, h,
        nonClearPct: +(nonClear / (w * h) * 100).toFixed(2),
        avg: nonClear ? [Math.round(sr / nonClear), Math.round(sg / nonClear), Math.round(sb / nonClear)] : null,
      }
    },
  }
}
function installDebug() {
  if (typeof window !== 'undefined') window.__flowerTexEditorDebug = debugSnapshot
}
installDebug()
</script>

<style scoped>
.fte-mask { position: fixed; inset: 0; z-index: 80; background: rgba(6, 9, 13, 0.72); display: flex; align-items: center; justify-content: center; }
.fte-panel { background: #11161d; border: 1px solid var(--line-2); border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,.65); width: 660px; max-width: 94vw; }
.fte-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.fte-hint { font-size: 11px; color: var(--text-2); margin-right: auto; }
.fte-body { display: flex; gap: 14px; padding: 14px; }
.fte-canvas-wrap { position: relative; flex: 0 0 auto; width: 320px; height: 320px; }
.fte-canvas { display: block; width: 320px; height: 320px; border-radius: 8px; background: #0b0e13; border: 1px solid var(--line); touch-action: none; cursor: grab; }
/* Blender 风格坐标轴: 预览区右上角; 轴字母可点击切正视图 */
.fte-axis { position: absolute; top: 6px; right: 6px; width: 84px; height: 84px; cursor: pointer; }
.fte-side { flex: 1; min-width: 0; }
.fte-row { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-2); margin-bottom: 6px; }
.fte-pad-row { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 6px; }
.fte-pad-label { font-size: 11px; color: var(--text-2); margin-bottom: 3px; }
.fte-pad-sliders { flex: 1; min-width: 0; }
.fte-tip { font-size: 10.5px; color: var(--text-2); line-height: 1.5; margin: 8px 0 0; }
</style>
