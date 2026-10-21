<template>
  <Section title="材质球预览" hint="Preview">
    <div class="mat-preview">
      <div v-for="kind in kinds" :key="kind" class="mp-item">
        <canvas :ref="(el) => setCanvas(kind, el)" class="mp-canvas" title="拖动可旋转" />
        <span>{{ labels[kind] || kind }}</span>
      </div>
    </div>
    <p class="mp-tip">拖动材质球可四方旋转 · 显示当前参数与所选贴图</p>
  </Section>
</template>

<script setup>
import { watch, onMounted, onBeforeUnmount } from 'vue'
import Section from '../ui/Section.vue'
import { state } from '../../store/treeStore.js'
import { createMaterialPreview } from '../../core/materialPreview.js'

const props = defineProps({
  kinds: { type: Array, default: () => ['bark'] },
})

const labels = { bark: '树皮', leaf: '树叶', flower: '花朵' }
const canvases = {}
const previews = {}
let timer = 0

function setCanvas(kind, el) {
  if (el) canvases[kind] = el
}

function refresh() {
  for (const pv of Object.values(previews)) {
    try { pv?.setParams(state.params) } catch (e) { /* 单个预览失败不影响其他 */ }
  }
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(refresh, 100)
}

onMounted(() => {
  for (const kind of props.kinds) {
    const canvas = canvases[kind]
    if (!canvas) continue
    previews[kind] = createMaterialPreview(canvas, kind)
  }
  // 主场景先完成首帧再画 (贴图缓存已就绪时纹理能立刻显示)
  setTimeout(refresh, 350)
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  for (const pv of Object.values(previews)) pv?.dispose()
})

watch(
  () => JSON.stringify({
    bark: state.params.bark,
    leafMat: state.params.leafMat,
    flower: state.params.flower,
    leaves: state.params.leaves,
    custom: state.params.custom,
    wind: { leafFlutter: state.params.wind.leafFlutter, leafTwist: state.params.wind.leafTwist },
  }),
  schedule,
)
</script>

<style scoped>
.mat-preview { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; padding: 4px 0 6px; }
.mp-item { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.mp-canvas {
  width: 88px; height: 88px; border-radius: 50%; background: #0b0e13;
  border: 1px solid var(--line); touch-action: none; display: block;
}
.mp-item span { font-size: 10.5px; color: var(--text-2); }
.mp-tip { margin: 0; font-size: 10.5px; color: var(--text-2); }
</style>
