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
            <div class="fte-row"><span>形状</span><b>碗形（{{ state.params.flower.flowerBowlOpen }}° / R{{ state.params.flower.flowerBowlRadius }}）</b></div>
            <SliderRow label="贴图横向偏移" v-model="f.textureU" :min="-1" :max="1" :step="0.01" />
            <SliderRow label="贴图纵向偏移" v-model="f.textureV" :min="-1" :max="1" :step="0.01" />
            <SliderRow label="贴图缩放" v-model="f.textureRepeat" :min="0.1" :max="8" :step="0.05" />
            <SliderRow label="贴图旋转" v-model="f.textureRotation" :min="-3.14" :max="3.14" :step="0.02" />
            <p class="fte-tip">
              贴图会按上面的偏移/缩放/旋转映射到花朵模型表面。<br />
              碗形花冠会自动关掉 alphaTest，贴图作为表面花纹包裹在碗壁上。
            </p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import * as THREE from 'three'
import SliderRow from '../ui/SliderRow.vue'
import { state } from '../../store/treeStore.js'
import { createSharedUniforms, createFlowerMaterial } from '../../core/materials.js'
import { buildLeafTemplate, buildLeafCardTemplate } from '../../core/leaf.js'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])
const open = ref(props.modelValue)
watch(() => props.modelValue, (v) => { open.value = v; if (v) nextTick(init) })
watch(open, (v) => emit('update:modelValue', v))

const cv = ref(null)
const f = state.params.flower
let renderer = null
let scene = null
let camera = null
let mesh = null
let material = null
let dragging = null
let rafId = 0
const modelRot = { x: -0.25, y: 0.6 }
if (typeof window !== 'undefined') window.__flowerTexEditorState = modelRot

function rebuildGeometry() {
  const q = state.params.flower
  const geo = q.cardMode
    ? buildLeafCardTemplate({
        aspect: q.cardAspect || 1, cols: 1, rows: 3,
        curl: q.cardCurl === undefined ? 0.1 : q.cardCurl,
        fold: q.cardFold === undefined ? 0.12 : q.cardFold,
      })
    : buildLeafTemplate({
        shape: 'bowl',
        flowerBowlOpen: q.flowerBowlOpen,
        flowerBowlRadius: q.flowerBowlRadius,
        flowerBowlRound: q.flowerBowlRound,
        flowerBowlDepth: q.flowerBowlDepth,
        flowerLobes: q.flowerLobes, flowerThickness: q.flowerThickness,
        flowerStamen: q.flowerStamen, flowerTilt: q.flowerTilt, flowerQuality: q.flowerQuality,
        flowerPetals: q.flowerPetals, flowerCluster: 1,
      })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(geo.positions, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(geo.normals, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(geo.uvs, 2))
  if (geo.index) g.setIndex(geo.index)
  // 预览用顶点色 (白色 -> 只看贴图)
  const n = geo.positions.length / 3
  const colors = new Float32Array(n * 3).fill(1)
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.computeBoundingSphere()
  if (!scene) return
  // 场景里只允许存在一个模型网格: 清掉历史遗留 (重复打开/热更新可能留下旧网格)
  for (const child of [...scene.children]) {
    if (child.isMesh && child !== mesh) {
      scene.remove(child)
      child.geometry.dispose()
    }
  }
  if (!mesh) {
    mesh = new THREE.Mesh(g, material)
    mesh.name = 'FlowerPreview'
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

/** 预览用 UV 棋盘 (没有贴图时也能看清模型与映射) */
function makeCheckerTexture() {
  const size = 256
  const cv2 = document.createElement('canvas')
  cv2.width = cv2.height = size
  const g = cv2.getContext('2d')
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
  const tex = new THREE.CanvasTexture(cv2)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function rebuildMaterial() {
  if (material) material.dispose()
  const q = state.params.flower
  material = createFlowerMaterial(state.params, createSharedUniforms())
  material.side = THREE.DoubleSide
  if (q.cardMode) {
    // 平面花卡: 用贴图 alpha 裁出花形 (否则整块矩形会被画成深色, 看起来"没有模型")
    material.alphaTest = Math.max(0.2, Math.min(0.9, q.alphaTest || 0.35))
    material.transparent = false
  } else {
    // 三维花冠: 贴图是表面花纹, 不裁形
    material.alphaTest = 0
  }
  // 没有贴图 -> 用棋盘 (便于看清模型/映射; 不影响主场景)
  if (!material.map) {
    material.map = makeCheckerTexture()
    material.color = new THREE.Color(0xffffff)
  }
  material.needsUpdate = true
  if (mesh) mesh.material = material
  applyUvTransform()
}

function frame() {
  if (!mesh || !camera) return
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
  const sphere = mesh.geometry.boundingSphere
  const r = sphere ? sphere.radius : 1
  const c = sphere ? sphere.center : new THREE.Vector3()
  mesh.position.set(-c.x, -c.y, -c.z)
  // fov 35°: 距 = r / tan(fov/2) / 填充比
  const dist = (r / Math.tan((35 * Math.PI) / 180 / 2)) / 0.72
  camera.position.set(0, 0, Math.max(0.6, dist))
  camera.lookAt(0, 0, 0)
  applyModelRotation()
}

function render() {
  if (!renderer || !scene || !camera) return
  renderer.setRenderTarget(null)
  renderer.setClearColor(0x0b0e13, 1)
  renderer.clear(true, true, true)
  renderer.render(scene, camera)
}

/** 彻底释放预览资源 (canvas 被替换/组件卸载时) */
function disposePreview() {
  stopLoop()
  if (mesh) { if (scene) scene.remove(mesh); mesh.geometry.dispose(); mesh = null }
  if (material) { material.dispose(); material = null }
  if (renderer) {
    renderer.dispose()
    renderer.forceContextLoss?.()
    renderer = null
  }
  scene = null
  camera = null
}

function init() {
  const el = cv.value
  if (!el) return
  const size = 300
  el.width = size
  el.height = size
  // canvas 元素被换掉 (关闭后重开/热更新) -> 旧渲染器画的是"已卸载的 canvas", 必须重建
  if (renderer && renderer.domElement !== el) disposePreview()
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(size, size, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    const key = new THREE.DirectionalLight(0xffffff, 3.4); key.position.set(2.2, 3.2, 3.2)
    const fill = new THREE.DirectionalLight(0xcfe2ff, 1.6); fill.position.set(-3.2, 0.8, 2.2)
    const rim = new THREE.DirectionalLight(0xffe8c8, 1.8); rim.position.set(-1.5, -2.2, -3.2)
    const top = new THREE.DirectionalLight(0xffffff, 1.0); top.position.set(0, 4, 0.5)
    scene.add(key, fill, rim, top, new THREE.AmbientLight(0xffffff, 1.05))
    bindPointer(el)
  }
  rebuildMaterial()
  rebuildGeometry()
  applyUvTransform()
  render()
  startLoop()
}

/** 面板打开期间持续渲染: 贴图/材质是异步的, 只画一帧会永远停在"没贴图"的状态 */
function startLoop() {
  stopLoop()
  const tick = () => {
    rafId = requestAnimationFrame(tick)
    render()
  }
  rafId = requestAnimationFrame(tick)
}
function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

function bindPointer(el) {
  el.addEventListener('contextmenu', (e) => e.preventDefault())
  el.addEventListener('pointerdown', (e) => {
    // 右键 = 旋转模型; Shift+左键 = 旋转贴图; 左键 = 移动贴图
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
    f.textureRepeat = Math.max(0.1, Math.min(8, (f.textureRepeat || 1) * (e.deltaY > 0 ? 0.92 : 1.08)))
    refresh()
  }, { passive: false })
  el.style.cursor = 'grab'
}

/** 右键拖动 = 旋转花朵模型 (只看贴图的绕身效果) */
function applyModelRotation() {
  if (!mesh) return
  mesh.rotation.set(modelRot.x, modelRot.y, 0, 'YXZ')
}

function resetView() {
  modelRot.x = -0.25
  modelRot.y = 0.6
  applyModelRotation()
  render()
}

/** 只更新贴图的 UV 变换 (offset/repeat/rotation), 不重建材质, 不会丢贴图 */
function applyUvTransform() {
  const map = material && material.map
  if (!map) return
  map.center.set(0.5, 0.5)
  map.offset.set(f.textureU || 0, f.textureV || 0)
  map.repeat.set(f.textureRepeat === undefined ? 1 : f.textureRepeat, f.textureRepeat === undefined ? 1 : f.textureRepeat)
  map.rotation = f.textureRotation || 0
  map.needsUpdate = true
}

function refresh() {
  applyUvTransform()
  render()
}

function reset() {
  f.textureU = 0
  f.textureV = 0
  f.textureRepeat = 1
  f.textureRotation = 0
  refresh()
}

function close() { open.value = false; stopLoop() }

// 调试钩子 (自动化验证用): 暴露内部对象, 便于检查为什么"看不到模型"
if (typeof window !== 'undefined') {
  window.__flowerTexEditorDebug = () => ({
    hasRenderer: !!renderer,
    hasScene: !!scene,
    hasMesh: !!mesh,
    meshCount: scene ? scene.children.filter((o) => o && o.isMesh).length : 0,
    meshVisible: mesh ? mesh.visible : null,
    meshRotation: mesh ? [mesh.rotation.x, mesh.rotation.y] : null,
    meshPos: mesh ? [mesh.position.x, mesh.position.y, mesh.position.z] : null,
    verts: mesh && mesh.geometry.attributes.position ? mesh.geometry.attributes.position.count : 0,
    bs: mesh && mesh.geometry.boundingSphere ? { c: [mesh.geometry.boundingSphere.center.x, mesh.geometry.boundingSphere.center.y, mesh.geometry.boundingSphere.center.z], r: mesh.geometry.boundingSphere.radius } : null,
    cam: camera ? [camera.position.x, camera.position.y, camera.position.z] : null,
    matMap: !!(material && material.map),
    matMapImage: !!(material && material.map && material.map.image),
    matType: material ? material.type : null,
    render: () => { render(); return true },
    pixels: () => {
      if (!renderer) return null
      render()
      const gl = renderer.getContext()
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const px = new Uint8Array(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
      let nonClear = 0, sumR = 0, sumG = 0, sumB = 0
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2]
        const isClear = Math.abs(r - 11) < 8 && Math.abs(g - 14) < 8 && Math.abs(b - 19) < 8
        if (!isClear) { nonClear++; sumR += r; sumG += g; sumB += b }
      }
      return { w, h, nonClearPct: +(nonClear / (w * h) * 100).toFixed(2), avg: nonClear ? [Math.round(sumR / nonClear), Math.round(sumG / nonClear), Math.round(sumB / nonClear)] : null }
    },
  })
}

watch(() => [f.textureU, f.textureV, f.textureRepeat, f.textureRotation, f.texture], refresh)
// 这些改动影响几何 -> 重建几何 (否则切卡片模式/换花形后预览还是旧模型)
watch(
  () => [f.cardMode, f.cardAspect, f.flowerBowlOpen, f.flowerBowlRadius, f.flowerBowlRound, f.flowerBowlDepth, f.flowerLobes, f.flowerThickness, f.flowerQuality, f.flowerPetals, f.flowerTilt, f.flowerStamen],
  () => { rebuildMaterial(); rebuildGeometry(); render() },
)
watch(() => props.modelValue, (v) => { if (v) { init() } })

onBeforeUnmount(() => {
  disposePreview()
})
</script>

<style scoped>
.fte-mask { position: fixed; inset: 0; z-index: 80; background: rgba(6, 9, 13, 0.72); display: flex; align-items: center; justify-content: center; }
.fte-panel { background: #11161d; border: 1px solid var(--line-2); border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,.65); width: 620px; max-width: 94vw; }
.fte-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.fte-hint { font-size: 11px; color: var(--text-2); margin-right: auto; }
.fte-body { display: flex; gap: 14px; padding: 14px; }
.fte-canvas { width: 300px; height: 300px; cursor: grab; border-radius: 8px; background: #0b0e13; border: 1px solid var(--line); touch-action: none; }
.fte-side { flex: 1; min-width: 0; }
.fte-row { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-2); margin-bottom: 6px; }
.fte-tip { font-size: 10.5px; color: var(--text-2); line-height: 1.5; margin: 8px 0 0; }
</style>
