<template>
  <div class="tp-wrap">
    <div ref="pad" class="tp-pad" @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop">
      <div class="tp-grid" />
      <div class="tp-dot" :style="{ left: dotLeft, top: dotTop }" />
      <span class="tp-axis tp-u">U</span>
      <span class="tp-axis tp-v">V</span>
    </div>
    <div class="tp-vals">
      <span>U {{ Number(modelValue[0]).toFixed(2) }}</span>
      <span>V {{ Number(modelValue[1]).toFixed(2) }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

/** 二维贴图偏移手柄: 拖动 = 同时改 U/V (比两个滑块直观) */
const props = defineProps({
  modelValue: { type: Array, default: () => [0, 0] },
  min: { type: Number, default: -1 },
  max: { type: Number, default: 1 },
})
const emit = defineEmits(['update:modelValue'])
const pad = ref(null)
let dragging = false

const dotLeft = computed(() => {
  const t = (Number(props.modelValue[0]) - props.min) / (props.max - props.min || 1)
  return `${Math.max(0, Math.min(1, t)) * 100}%`
})
const dotTop = computed(() => {
  // V 向上为正 -> 屏幕上要反过来
  const t = (Number(props.modelValue[1]) - props.min) / (props.max - props.min || 1)
  return `${(1 - Math.max(0, Math.min(1, t))) * 100}%`
})

function apply(e) {
  const el = pad.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const u = props.min + ((e.clientX - r.left) / r.width) * (props.max - props.min)
  const v = props.min + (1 - (e.clientY - r.top) / r.height) * (props.max - props.min)
  emit('update:modelValue', [
    Math.max(props.min, Math.min(props.max, u)),
    Math.max(props.min, Math.min(props.max, v)),
  ])
}
function start(e) {
  dragging = true
  pad.value?.setPointerCapture?.(e.pointerId)
  apply(e)
}
function move(e) { if (dragging) apply(e) }
function stop() { dragging = false }
</script>

<style scoped>
.tp-wrap { display: flex; flex-direction: column; gap: 3px; }
.tp-pad { position: relative; width: 100%; aspect-ratio: 1 / 1; max-width: 132px; border-radius: 6px;
  border: 1px solid var(--line-2); background: #0c1016; cursor: crosshair; touch-action: none; overflow: hidden; }
.tp-grid { position: absolute; inset: 0;
  background-image: linear-gradient(to right, rgba(255,255,255,.08) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,.08) 1px, transparent 1px);
  background-size: 25% 25%; }
.tp-dot { position: absolute; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%;
  background: var(--accent); box-shadow: 0 0 0 2px rgba(0,0,0,.5); pointer-events: none; }
.tp-axis { position: absolute; font-size: 9px; color: var(--text-2); }
.tp-u { right: 3px; bottom: 2px; }
.tp-v { left: 3px; top: 2px; }
.tp-vals { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--text-2); }
</style>
