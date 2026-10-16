<template>
  <div v-if="visible" class="param-tip" :style="style">
    <div class="tip-title">{{ title }}</div>
    <div class="tip-body">{{ body }}</div>
  </div>
</template>

<script setup>
/**
 * 属性 hover 说明 (事件委托, 全局只需要挂一个)
 * ------------------------------------------------------------
 * 鼠标停在任意面板行/分节标题上时, 读取其标签文字, 从 paramDocs 里查说明并浮层显示。
 * 这样所有参数自动获得提示, 不需要在每个面板里逐行写 hint。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { docFor } from '../core/paramDocs.js'

const visible = ref(false)
const title = ref('')
const body = ref('')
const pos = ref({ x: 0, y: 0 })
const below = ref(true)
let hoverTimer = 0
let currentEl = null

function findLabelEl(target) {
  if (!target || !target.closest) return null
  // 面板行标签 / 分节标题 / 折叠头
  const el = target.closest('.row-head label, .section-head .title, .dock-head .title, label.switch, .node-summary')
  if (!el) return null
  const text = (el.textContent || '').trim()
  return text ? el : null
}

function show(el) {
  const text = (el.textContent || '').trim()
  const doc = docFor(text)
  if (!doc) {
    hide()
    return
  }
  title.value = text
  body.value = doc
  const r = el.getBoundingClientRect()
  const width = 268
  let x = Math.min(window.innerWidth - width - 10, Math.max(8, r.left - 6))
  const estHeight = 64
  below.value = r.bottom + estHeight + 16 < window.innerHeight
  pos.value = { x, y: below.value ? r.bottom + 6 : r.top - 6 }
  visible.value = true
}

function hide() {
  visible.value = false
  currentEl = null
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = 0
  }
}

function onOver(e) {
  const el = findLabelEl(e.target)
  if (!el) {
    if (currentEl) hide()
    return
  }
  if (el === currentEl) return
  currentEl = el
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    hoverTimer = 0
    if (currentEl === el) show(el)
  }, 160)
}

function onOut(e) {
  const el = findLabelEl(e.target)
  if (el && el === currentEl) hide()
}

function onScroll() {
  if (visible.value) hide()
}

onMounted(() => {
  document.addEventListener('mouseover', onOver, true)
  document.addEventListener('mouseout', onOut, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('blur', hide)
})

onBeforeUnmount(() => {
  document.removeEventListener('mouseover', onOver, true)
  document.removeEventListener('mouseout', onOut, true)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('blur', hide)
})

const style = computed(() => ({
  left: pos.value.x + 'px',
  top: pos.value.y + 'px',
  transform: below.value ? 'none' : 'translateY(-100%)',
}))
</script>

<style scoped>
.param-tip {
  position: fixed;
  z-index: 40;
  width: 268px;
  padding: 7px 9px;
  border-radius: 7px;
  background: rgba(12, 16, 22, 0.97);
  border: 1px solid var(--line-2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
.tip-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 3px;
}
.tip-body {
  font-size: 11.5px;
  line-height: 1.55;
  color: #cfd8e3;
}
</style>
