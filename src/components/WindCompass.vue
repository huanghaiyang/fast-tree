<template>
  <div class="wind-compass" :class="{ off: !wind.enabled }" :title="title">
    <canvas ref="cv" width="104" height="104"></canvas>
    <div class="cap">
      <span class="deg">{{ Math.round(wind.direction) }}°</span>
      <span class="mil">{{ wind.enabled ? wind.strength.toFixed(2) + 'm' : '关' }}</span>
    </div>
  </div>
</template>

<script setup>
/**
 * 风向指示器
 * ------------------------------------------------------------
 * 罗盘箭头指向"风在屏幕上的实际吹向"(把世界风向投影到相机的地面基上),
 * 所以它和你在视口里看到的摆动方向一致；
 * 外圈蓝色 "N" 刻度表示世界 +Z 方向, 便于对照绝对方位。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state, sceneApi } from '../store/treeStore.js'

const cv = ref(null)
const wind = computed(() => state.params.wind)
const title = computed(() =>
  `风向 ${Math.round(state.params.wind.direction)}° · 强度 ${state.params.wind.strength.toFixed(2)}m` +
  (state.params.wind.enabled ? '' : '（风已关闭）'))

let raf = 0
let last = 0
let camBasis = { right: [1, 0, 0], fwd: [0, 0, 1] }

function draw() {
  const canvas = cv.value
  if (!canvas) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const size = 104
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr
    canvas.height = size * dpr
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size, size)

  const cx = size / 2
  const cy = size / 2
  const R = 42
  const w = state.params.wind
  const enabled = !!w.enabled
  const accent = enabled ? '#5ac8a0' : '#4a5260'

  // 底盘
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(10,13,18,0.72)'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(120,140,170,0.45)'
  ctx.stroke()

  // 刻度
  ctx.strokeStyle = 'rgba(140,160,190,0.28)'
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const r0 = i % 2 === 0 ? R - 8 : R - 5
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R)
    ctx.stroke()
  }

  // 世界 +Z (= "N") 刻度, 同样投影到屏幕
  const inv = (v) => (Math.hypot(v[0], v[1]) > 1e-6 ? v : [0, -1])
  const nScreen = inv([-camBasis.right[2], -camBasis.fwd[2]])
  const nAng = Math.atan2(nScreen[1], nScreen[0])
  ctx.fillStyle = 'rgba(123,183,255,0.85)'
  ctx.font = 'bold 9px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', cx + Math.cos(nAng) * (R - 13), cy + Math.sin(nAng) * (R - 13))

  // 风向量: 世界 (cosθ, 0, sinθ) 投影到相机的 右 / 屏幕下 基
  const rad = (w.direction * Math.PI) / 180
  const wx = Math.cos(rad)
  const wz = Math.sin(rad)
  const sx = wx * camBasis.right[0] + wz * camBasis.right[2]
  const sy = -(wx * camBasis.fwd[0] + wz * camBasis.fwd[2]) // 屏幕 y 向下
  const len = Math.hypot(sx, sy)
  const ang = len > 1e-4 ? Math.atan2(sy, sx) : 0
  // 投影长度 = 屏幕上的可见幅度, 用它决定箭头长度 (正对相机时会变短)
  const L = 8 + (R - 20) * Math.min(1, len)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(ang)
  ctx.strokeStyle = accent
  ctx.fillStyle = accent
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.moveTo(-L * 0.55, 0)
  ctx.lineTo(L * 0.55, 0)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(L * 0.62, 0)
  ctx.lineTo(L * 0.22, -5.2)
  ctx.lineTo(L * 0.22, 5.2)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // 中心点
  ctx.beginPath()
  ctx.arc(cx, cy, 2.4, 0, Math.PI * 2)
  ctx.fillStyle = '#0b0e13'
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.stroke()
}

function tick(t) {
  raf = requestAnimationFrame(tick)
  // 相机可能一直在动 => 约 20fps 更新足够
  if (t - last < 50) return
  last = t
  const basis = sceneApi.getWindScreenBasis ? sceneApi.getWindScreenBasis() : null
  if (basis) camBasis = basis
  draw()
}

onMounted(() => {
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => cancelAnimationFrame(raf))

watch(() => [wind.value.direction, wind.value.strength, wind.value.enabled], () => draw())
</script>

<style scoped>
.wind-compass {
  position: absolute;
  right: 12px;
  /* 顶部 12px 是“从 0 播放生长”按钮；罗盘下移，避免和按钮叠在一起 */
  top: 58px;
  width: 104px;
  height: 122px;
  pointer-events: auto;
}
.wind-compass.off { opacity: 0.55; }
.wind-compass canvas { display: block; width: 104px; height: 104px; }
.cap {
  position: absolute;
  left: 0;
  right: 0;
  /* 文字放到画布下方，避免和圆内的 N / 箭头尖端重叠 */
  bottom: 0;
  display: flex;
  justify-content: center;
  gap: 5px;
  line-height: 1;
  font-size: 10px;
  color: #b9c6d6;
  text-shadow: 0 1px 3px #000;
}
.cap .deg { color: var(--accent); font-weight: 600; }
</style>
