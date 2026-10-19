<template>
  <div class="leaf-gallery">
    <div
      ref="stage"
      class="leaf-gallery-stage"
      :style="{ aspectRatio: `${columns} / ${rows * 1.18}` }"
    >
      <canvas ref="canvasEl" class="leaf-gallery-canvas"></canvas>
      <div
        class="leaf-gallery-grid"
        :style="{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }"
      >
        <div
          v-for="(s, i) in shapes"
          :key="s.value"
          class="leaf-cell" :class="{ active: modelValue === s.value }"
          :data-shape="s.value"
          title="拖拽旋转查看 · 双击复位 · 点击选中该叶形"
          @pointerdown="onDown(i, $event)"
          @dblclick="resetView(i)"
        >
          <div class="leaf-cell-label">{{ s.label }}</div>
          <span v-if="modelValue === s.value" class="leaf-cell-badge">当前</span>
        </div>
      </div>
    </div>
    <div class="leaf-gallery-hint">
      真实白模预览 · 拖拽任一叶形多视角查看 · 双击复位 · 点击切换当前叶形
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { buildLeafTemplate } from '../core/leaf.js'

/* 所有叶形共用**一个** WebGL 上下文:
 * 一个 canvas 按 3×N 分格, 每格用 scissor/viewport 渲染自己的白模相机。
 * 这样不会像"每张卡片一个 WebGLRenderer"那样触发浏览器 context 上限。 */
const props = defineProps({
  modelValue: { type: String, default: 'oval' },
  shapes: { type: Array, default: () => [] },
  segments: { type: Number, default: 5 },
  curl: { type: Number, default: 0.18 },
  fold: { type: Number, default: 0.28 },
  petiole: { type: Number, default: 0.12 },
  width: { type: Number, default: 0.78 },
  columns: { type: Number, default: 3 },
})
const emit = defineEmits(['update:modelValue'])

const stage = ref(null)
const canvasEl = ref(null)
const rows = computed(() => Math.max(1, Math.ceil((props.shapes.length || 1) / props.columns)))
const BASE_YAW = 0.52
const BASE_PITCH = 0.18
const GAP = 6
const items = []
let renderer = null
let material = null
let ro = null
let dragIndex = -1
let dragMoved = false
let dragStartX = 0
let dragStartY = 0
let dragBaseYaw = 0
let dragBasePitch = 0
let raf = 0

function makeItem() {
  const scene = new THREE.Scene()
  const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.4)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(2.4, 3.2, 2.8)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x93c5fd, 0.9)
  rim.position.set(-2.6, 1.2, -2.4)
  scene.add(rim)
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50)
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
  scene.add(mesh)
  return { scene, camera, mesh, yaw: BASE_YAW, pitch: BASE_PITCH, viewRadius: 3 }
}

function buildItems() {
  while (items.length) {
    const it = items.pop()
    it.mesh.geometry.dispose()
  }
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: 0xf1efe6,
      roughness: 0.62,
      metalness: 0.02,
      side: THREE.DoubleSide,
    })
  }
  for (const s of props.shapes) {
    const it = makeItem()
    items.push(it)
    buildGeometry(it, s.value)
  }
}

function buildGeometry(it, shape) {
  const tpl = buildLeafTemplate({
    shape,
    segments: Math.max(3, Math.round(props.segments || 5)),
    curl: props.curl,
    fold: props.fold,
    petiole: props.petiole,
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tpl.positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(tpl.normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(tpl.uvs, 2))
  geo.setIndex(tpl.index)
  geo.center()
  geo.computeBoundingSphere()
  it.mesh.geometry.dispose()
  it.mesh.geometry = geo
  const radius = geo.boundingSphere ? geo.boundingSphere.radius : 0.6
  const fov = 32 * Math.PI / 180
  it.viewRadius = Math.max(1.2, radius / Math.sin(fov / 2) * 1.25)
  const w = Math.max(0.35, props.width || 0.78)
  it.mesh.scale.set(w, 1, w)
}

function rebuildGeometry() {
  props.shapes.forEach((s, i) => { if (items[i]) buildGeometry(items[i], s.value) })
  scheduleRender()
}

function updateCamera(it) {
  const cp = Math.cos(it.pitch)
  it.camera.position.set(
    Math.sin(it.yaw) * cp * it.viewRadius,
    Math.sin(it.pitch) * it.viewRadius,
    Math.cos(it.yaw) * cp * it.viewRadius,
  )
  it.camera.lookAt(0, 0, 0)
}

function resize() {
  const stageEl = stage.value
  const canvas = canvasEl.value
  if (!stageEl || !canvas) return
  const w = stageEl.clientWidth
  const h = stageEl.clientHeight
  if (w < 2 || h < 2) return
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, preserveDrawingBuffer: true,
    })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setClearColor(0x000000, 0)
  }
  renderer.setSize(w, h, false)
  const cellW = (w - GAP * (props.columns - 1)) / props.columns
  const cellH = (h - GAP * (rows.value - 1)) / rows.value
  for (const it of items) {
    it.camera.aspect = cellW / cellH
    it.camera.updateProjectionMatrix()
    updateCamera(it)
  }
  renderAll()
}

function renderAll() {
  if (!renderer) return
  const w = stage.value.clientWidth
  const h = stage.value.clientHeight
  const cols = props.columns
  const rws = rows.value
  const cellW = (w - GAP * (cols - 1)) / cols
  const cellH = (h - GAP * (rws - 1)) / rws
  renderer.setScissorTest(false)
  renderer.setViewport(0, 0, w, h)
  renderer.clear()
  renderer.setScissorTest(true)
  for (let i = 0; i < items.length; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    // WebGL 视口原点在左下角, CSS 网格原点在左上角; 让每格严格对齐 CSS gap
    const x = col * (cellW + GAP)
    const y = h - (row + 1) * cellH - row * GAP
    renderer.setViewport(x, y, cellW, cellH)
    renderer.setScissor(x, y, cellW, cellH)
    renderer.render(items[i].scene, items[i].camera)
  }
  renderer.setScissorTest(false)
}

function scheduleRender() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    renderAll()
  })
}

function onDown(i, e) {
  e.preventDefault()
  dragIndex = i
  dragMoved = false
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragBaseYaw = items[i].yaw
  dragBasePitch = items[i].pitch
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}
function onMove(e) {
  if (dragIndex < 0) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true
  const it = items[dragIndex]
  it.yaw = dragBaseYaw - dx * 0.018
  it.pitch = Math.max(-1.25, Math.min(1.25, dragBasePitch - dy * 0.018))
  updateCamera(it)
  scheduleRender()
}
function onUp() {
  if (dragIndex < 0) return
  const idx = dragIndex
  dragIndex = -1
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onUp)
  if (!dragMoved && props.shapes[idx] && props.shapes[idx].value !== props.modelValue) {
    emit('update:modelValue', props.shapes[idx].value)
  }
}
function resetView(i) {
  if (!items[i]) return
  items[i].yaw = BASE_YAW
  items[i].pitch = BASE_PITCH
  updateCamera(items[i])
  scheduleRender()
}

function handleResize() {
  resize()
}

onMounted(() => {
  buildItems()
  ro = new ResizeObserver(handleResize)
  if (stage.value) ro.observe(stage.value)
  handleResize()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  raf = 0
  if (ro) ro.disconnect()
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onUp)
  for (const it of items) it.mesh.geometry.dispose()
  items.length = 0
  material?.dispose()
  material = null
  renderer?.dispose()
  renderer = null
})
watch(() => [props.segments, props.curl, props.fold, props.petiole, props.width], rebuildGeometry)
watch(() => props.shapes, () => { buildItems(); resize() }, { deep: true })
</script>

<style scoped>
.leaf-gallery {
  margin-top: 4px;
}
.leaf-gallery-stage {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 8px;
  background:
    radial-gradient(circle at 50% 28%, #26313d 0%, #111820 62%, #0b1118 100%);
}
.leaf-gallery-canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.leaf-gallery-grid {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  gap: 6px;
  padding: 0;
  pointer-events: none;
}
.leaf-cell {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  background: transparent;
  overflow: hidden;
  cursor: grab;
  user-select: none;
  touch-action: none;
  pointer-events: auto;
}
.leaf-cell:active {
  cursor: grabbing;
}
.leaf-cell.active {
  border-color: #7fe7ff;
  box-shadow: 0 0 0 1px rgba(127, 231, 255, 0.55), inset 0 0 18px rgba(127, 231, 255, 0.08);
}
.leaf-cell-label {
  position: relative;
  z-index: 3;
  width: 100%;
  padding: 3px 4px 5px;
  text-align: center;
  font-size: 11px;
  line-height: 1.25;
  color: #cfe6f2;
  background: linear-gradient(rgba(4, 9, 14, 0), rgba(4, 9, 14, 0.78));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.leaf-cell-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 3;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 9px;
  line-height: 1.4;
  color: #06222b;
  background: #7fe7ff;
  pointer-events: none;
}
.leaf-gallery-hint {
  margin-top: 5px;
  font-size: 10.5px;
  line-height: 1.5;
  color: #8b98a8;
}
</style>
