<template>
  <Teleport to="body">
    <div v-show="open" class="fte-mask" @click.self="close">
      <div class="fte-panel">
        <div class="fte-head">
          <b>🌸 花朵贴图位置调整</b>
          <span class="fte-hint">左键拖动 = 移动贴图 · 右键拖动 = 旋转模型 · 滚轮 = 缩放贴图 · Shift+左键 = 旋转贴图</span>
          <button class="btn small" @click="resetView" title="只重置 3D 视角, 不动贴图">↺ 视角</button>
          <button class="btn small" @click="reset">重置贴图</button>
          <button class="btn small primary" @click="close">完成</button>
        </div>
        <div class="fte-body">
          <canvas ref="cv" class="fte-canvas" />
          <div class="fte-side">
            <div class="fte-row"><span>形态</span><b>平面花卡（贴图 alpha 决定花形）</b></div>
            <div class="fte-pad-row">
              <div>
                <div class="fte-pad-label">贴图偏移（二维）</div>
                <TexturePad v-model="texOffset" :min="-1" :max="1" />
              </div>
              <div class="fte-pad-sliders">
                <SliderRow label="横向平铺" v-model="f.textureRepeatU" :min="0.1" :max="8" :step="0.05" />
                <SliderRow label="纵向平铺" v-model="f.textureRepeatV" :min="0.1" :max="8" :step="0.05" />
              </div>
            </div>
            <SliderRow label="贴图旋转" v-model="f.textureRotation" :min="-3.14" :max="3.14" :step="0.02" />
            <SliderRow label="贴图裁切" v-model="f.alphaTest" :min="0" :max="0.9" :step="0.01" />
            <p class="fte-tip">
              花卡按贴图 alpha 裁形；拖动偏移/平铺可以调整贴图在卡片上的位置与密度。
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
import { createSharedUniforms, createFlowerMaterial } from '../../core/materials.js'
import { buildLeafCardTemplate } from '../../core/leaf.js'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])
const open = ref(props.modelValue)
const cv = ref(null)
const f = state.params.flower
const texOffset = computed({
  get: () => [f.textureU || 0, f.textureV || 0],
  set: (v) => { f.textureU = v[0]; f.textureV = v[1] },
})

let renderer = null
let scene = null
let camera = null
let mesh = null
let material = null
let dragging = null
let rafId = 0
const modelRot = { x: -0.25, y: 0.6 }
if (typeof window !== 'undefined') window.__flowerTexEditorState = modelRot

/* ---------------- 几何: 平面花卡 ---------------- */
function rebuildGeometry() {
  const q = state.params.flower
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
  g.computeBoundingSphere()
  if (!scene) return
  for (const child of [...scene.children]) {
    if (child.isMesh && child !== mesh) {
      scene.remove(child)
      child.geometry.dispose()
    }
  }
  if (!mesh) {
    mesh = new THREE.Mesh(g, material)
    mesh.name = 'FlowerCardPreview'
    scene.add(mesh)
    frame()
    applyModelRotation()
  } else {
    mesh.geometry.dispose()
    mesh.geometry = g
    mesh.material = material
    frame()
  }
}

/* ---------------- 材质 ---------------- */
function rebuildMaterial() {
  if (material) material.dispose()
  const q = state.params.flower
  material = createFlowerMaterial(state.params, createSharedUniforms())
  material.side = THREE.DoubleSide
  material.alphaTest = Math.max(0.05, Math.min(0.9, q.alphaTest === undefined ? 0.35 : q.alphaTest))
  material.transparent = false
  material.needsUpdate = true
  if (!material.map) {
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
  map.center.set(0.5, 0.5)
  map.offset.set(f.textureU || 0, f.textureV || 0)
  map.repeat.set(
    f.textureRepeatU === undefined ? 1 : f.textureRepeatU,
    f.textureRepeatV === undefined ? 1 : f.textureRepeatV,
  )
  map.rotation = f.textureRotation || 0
  map.needsUpdate = true
}

/* ---------------- 相机/渲染 ---------------- */
function frame() {
  if (!mesh || !camera) return
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
  const sphere = mesh.geometry.boundingSphere
  const r = sphere ? sphere.radius : 1
  const c = sphere ? sphere.center : new THREE.Vector3()
  mesh.position.set(-c.x, -c.y, -c.z)
  const dist = (r / Math.tan((35 * Math.PI) / 180 / 2)) / 0.72
  camera.position.set(0, 0, Math.max(0.6, dist))
  camera.lookAt(0, 0, 0)
}

function applyModelRotation() {
  if (!mesh) return
  mesh.rotation.set(modelRot.x, modelRot.y, 0, 'YXZ')
}

function render() {
  if (!renderer || !scene || !camera) return
  renderer.setRenderTarget(null)
  renderer.setClearColor(0x0b0e13, 1)
  renderer.clear(true, true, true)
  renderer.render(scene, camera)
}

/* ---------------- 生命周期 ---------------- */
function disposePreview() {
  stopLoop()
  if (mesh) { if (scene) scene.remove(mesh); mesh.geometry.dispose(); mesh = null }
  if (material) { material.dispose(); material = null }
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
  el.width = size
  el.height = size
  if (renderer && renderer.domElement !== el) disposePreview()
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(size, size, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(2, 2.6, 3)
    const fill = new THREE.DirectionalLight(0xcfe2ff, 1.1); fill.position.set(-3, 0.6, 2)
    const rim = new THREE.DirectionalLight(0xffe8c8, 1.2); rim.position.set(-1, -2, -3)
    scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 1.1))
    bindPointer(el)
  }
  rebuildMaterial()
  rebuildGeometry()
  applyModelRotation()
  applyUvTransform()
  render()
  startLoop()
}

/* ---------------- 交互 ---------------- */
function bindPointer(el) {
  el.addEventListener('contextmenu', (e) => e.preventDefault())
  el.addEventListener('pointerdown', (e) => {
    const mode = e.button === 2 ? 'orbit' : (e.shiftKey ? 'texRot' : 'texMove')
    dragging = {
      mode, x: e.clientX, y: e.clientY,
      rot: f.textureRotation, u: f.textureU, v: f.textureV,
      rx: modelRot.x, ry: modelRot.y,
    }
    try { el.setPointerCapture?.(e.pointerId) } catch { /* 合成事件无真实指针 */ }
    el.style.cursor = mode === 'orbit' ? 'move' : 'grabbing'
  })
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = (e.clientX - dragging.x) / 200
    const dy = (e.clientY - dragging.y) / 200
    if (dragging.mode === 'orbit') {
      modelRot.y = dragging.ry + dx * 4.2
      modelRot.x = Math.max(-1.45, Math.min(1.45, dragging.rx + dy * 3.2))
      applyModelRotation()
      render()
      return
    }
    if (dragging.mode === 'texRot') f.textureRotation = Math.max(-3.14, Math.min(3.14, dragging.rot + dx * 3.14))
    else {
      f.textureU = Math.max(-1, Math.min(1, dragging.u + dx))
      f.textureV = Math.max(-1, Math.min(1, dragging.v - dy))
    }
    dragging.x = e.clientX
    dragging.y = e.clientY
    dragging.u = f.textureU
    dragging.v = f.textureV
    dragging.rot = f.textureRotation
    refresh()
  })
  const stop = () => { dragging = null; el.style.cursor = 'grab' }
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)
  el.addEventListener('wheel', (e) => {
    e.preventDefault()
    const k = e.deltaY > 0 ? 0.92 : 1.08
    f.textureRepeatU = Math.max(0.1, Math.min(8, (f.textureRepeatU || 1) * k))
    f.textureRepeatV = Math.max(0.1, Math.min(8, (f.textureRepeatV || 1) * k))
    refresh()
  }, { passive: false })
  el.style.cursor = 'grab'
}

function refresh() {
  applyUvTransform()
  render()
}

function resetView() {
  modelRot.x = -0.25
  modelRot.y = 0.6
  applyModelRotation()
  render()
}

function reset() {
  f.textureU = 0
  f.textureV = 0
  f.textureRepeatU = 1
  f.textureRepeatV = 1
  f.textureRotation = 0
  refresh()
}

function close() { open.value = false; stopLoop() }

/* ---------------- 监听 ---------------- */
watch(() => props.modelValue, (v) => {
  open.value = v
  if (v) nextTick(init)
})
watch(open, (v) => emit('update:modelValue', v))
watch(() => [f.textureU, f.textureV, f.textureRepeatU, f.textureRepeatV, f.textureRotation, f.texture], refresh)
watch(() => [f.cardAspect, f.cardCurl, f.cardFold, f.alphaTest, f.texture], () => {
  rebuildMaterial()
  rebuildGeometry()
  applyModelRotation()
  applyUvTransform()
  render()
})

onBeforeUnmount(() => { disposePreview() })

/* ---------------- 调试钩子 (自动化验证用) ---------------- */
if (typeof window !== 'undefined') {
  window.__flowerTexEditorDebug = () => ({
    hasRenderer: !!renderer,
    hasMesh: !!mesh,
    meshVisible: mesh ? mesh.visible : null,
    meshCount: scene ? scene.children.filter((o) => o && o.isMesh).length : 0,
    verts: mesh && mesh.geometry.attributes.position ? mesh.geometry.attributes.position.count : 0,
    cam: camera ? [camera.position.x, camera.position.y, camera.position.z] : null,
    matMap: !!(material && material.map),
    matMapImage: !!(material && material.map && material.map.image),
    matAlphaTest: material ? material.alphaTest : null,
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
  })
}
</script>

<style scoped>
.fte-mask { position: fixed; inset: 0; z-index: 80; background: rgba(6, 9, 13, 0.72); display: flex; align-items: center; justify-content: center; }
.fte-panel { background: #11161d; border: 1px solid var(--line-2); border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,.65); width: 660px; max-width: 94vw; }
.fte-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.fte-hint { font-size: 11px; color: var(--text-2); margin-right: auto; }
.fte-body { display: flex; gap: 14px; padding: 14px; }
.fte-canvas { width: 320px; height: 320px; border-radius: 8px; background: #0b0e13; border: 1px solid var(--line); touch-action: none; cursor: grab; }
.fte-side { flex: 1; min-width: 0; }
.fte-row { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-2); margin-bottom: 6px; }
.fte-pad-row { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 6px; }
.fte-pad-label { font-size: 11px; color: var(--text-2); margin-bottom: 3px; }
.fte-pad-sliders { flex: 1; min-width: 0; }
.fte-tip { font-size: 10.5px; color: var(--text-2); line-height: 1.5; margin: 8px 0 0; }
</style>
