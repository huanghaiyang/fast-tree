<template>
  <div v-if="ready" class="twist-gizmo">
    <svg class="twist-svg" :width="size.w" :height="size.h" :viewBox="`0 0 ${size.w} ${size.h}`">
      <polyline v-if="points.length" :points="polyline" class="twist-guide" />
      <g v-for="(h, i) in handles" :key="i">
        <line :x1="h.x" :y1="h.y" :x2="h.x" :y2="h.y - 16" class="twist-stem" />
        <circle
          :cx="h.x" :cy="h.y" r="9" class="twist-handle"
          :class="{ active: dragIndex === i }"
          @pointerdown="startDrag(i, $event)"
        />
        <text :x="h.x + 13" :y="h.y - 10" class="twist-value">{{ valueAt(i) }}°</text>
      </g>
    </svg>
    <div class="twist-tip">
      <b>扭曲句柄</b> · {{ targetLabel }}<span v-if="!handles.length"> · 当前层级没有可编辑树枝</span>
      <span v-else> · 左右拖拽圆点调整扭转角 (1px ≈ 1.2°)</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { state, sceneApi } from '../store/treeStore.js'
import { normalizeTwistProfile, TWIST_MAX_DEG } from '../core/twist.js'

const profile = computed(() => state.twistTarget === 'trunk'
  ? state.params.trunk.twistProfile
  : state.params.branches.twistProfile)
const targetLabel = computed(() => state.twistTarget === 'trunk' ? '树干' : `树枝 L${state.twistLevel}`)
const ready = computed(() => !!state.twistEdit)
const size = reactive({ w: 1, h: 1 })
const points = ref([])
const handles = ref([])
const dragIndex = ref(-1)
let raf = 0
let dragStartX = 0
let dragStartValue = 0
let lastEmit = 0

const polyline = computed(() => points.value.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))

function values() {
  return normalizeTwistProfile(profile.value)
}
function valueAt(i) {
  return Math.round(values()[i] || 0)
}

function tick() {
  raf = requestAnimationFrame(tick)
  if (!ready.value) return
  const screen = sceneApi.getTwistScreen
    ? sceneApi.getTwistScreen(state.twistTarget, state.twistLevel)
    : null
  if (!screen) {
    points.value = []
    handles.value = []
    return
  }
  size.w = screen.width
  size.h = screen.height
  points.value = screen.points
  handles.value = screen.handles
}

function startDrag(i, e) {
  e.preventDefault()
  e.stopPropagation()
  dragIndex.value = i
  dragStartX = e.clientX
  dragStartValue = values()[i] || 0
  lastEmit = 0
  sceneApi.setControlsEnabled && sceneApi.setControlsEnabled(false)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}
function onMove(e) {
  if (dragIndex.value < 0) return
  const now = performance.now()
  // 拖拽时 60ms 节流, 避免每一像素都触发几何重建
  if (now - lastEmit < 60) return
  lastEmit = now
  applyDrag(e)
}
function applyDrag(e) {
  const deg = Math.max(-TWIST_MAX_DEG, Math.min(TWIST_MAX_DEG, dragStartValue + (e.clientX - dragStartX) * 1.2))
  const arr = normalizeTwistProfile(profile.value)
  arr[dragIndex.value] = Math.round(deg)
  profile.value.splice(0, profile.value.length, ...arr)
}
function onUp(e) {
  if (dragIndex.value < 0) return
  applyDrag(e)
  dragIndex.value = -1
  sceneApi.setControlsEnabled && sceneApi.setControlsEnabled(true)
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onUp)
}

onMounted(() => { tick() })
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  sceneApi.setControlsEnabled && sceneApi.setControlsEnabled(true)
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onUp)
})
</script>

<style scoped>
.twist-gizmo {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
}
.twist-svg {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
}
.twist-guide {
  fill: none;
  stroke: rgba(120, 230, 255, 0.55);
  stroke-width: 1.6;
  stroke-dasharray: 5 5;
}
.twist-stem {
  stroke: rgba(120, 230, 255, 0.8);
  stroke-width: 1.2;
}
.twist-handle {
  fill: #0c1a22;
  stroke: #7fe7ff;
  stroke-width: 2.4;
  pointer-events: auto;
  cursor: ew-resize;
}
.twist-handle:hover,
.twist-handle.active {
  fill: #7fe7ff;
  stroke: #ffffff;
}
.twist-value {
  fill: #bfeeff;
  font: 11px monospace;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.75);
  stroke-width: 3;
  pointer-events: none;
}
.twist-tip {
  position: absolute;
  left: 10px;
  top: 10px;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(8, 16, 22, 0.78);
  border: 1px solid rgba(127, 231, 255, 0.35);
  color: #cfeeff;
  font-size: 12px;
  pointer-events: none;
}
</style>
