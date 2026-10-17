<template>
  <Section title="材质球预览" hint="Preview">
    <div class="mat-preview">
      <div class="mp-item">
        <canvas ref="barkCanvas" class="mp-canvas" title="拖动可旋转" />
        <span>树皮</span>
      </div>
      <div class="mp-item">
        <canvas ref="leafCanvas" class="mp-canvas" title="拖动可旋转" />
        <span>树叶</span>
      </div>
    </div>
    <p class="mp-tip">拖动材质球可四方旋转 · 显示当前参数与所选贴图</p>
  </Section>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import Section from '../ui/Section.vue'
import { state } from '../../store/treeStore.js'
import { createMaterialPreview } from '../../core/materialPreview.js'

const barkCanvas = ref(null)
const leafCanvas = ref(null)
let barkPv = null
let leafPv = null
let timer = 0

function refresh() {
  if (!barkPv) return
  barkPv.setParams(state.params)
  leafPv?.setParams(state.params)
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(refresh, 100)
}

onMounted(() => {
  barkPv = createMaterialPreview(barkCanvas.value, 'bark')
  leafPv = createMaterialPreview(leafCanvas.value, 'leaf')
  // 主场景先完成首帧再画 (贴图缓存已就绪时纹理能立刻显示)
  setTimeout(refresh, 350)
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  barkPv?.dispose()
  leafPv?.dispose()
})

watch(
  () => JSON.stringify({
    bark: state.params.bark,
    leafMat: state.params.leafMat,
    leaves: state.params.leaves,
    custom: state.params.custom,
    wind: { leafFlutter: state.params.wind.leafFlutter, leafTwist: state.params.wind.leafTwist },
  }),
  schedule,
)
</script>

<style scoped>
.mat-preview { display: flex; gap: 14px; justify-content: center; padding: 4px 0 6px; }
.mp-item { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.mp-canvas {
  width: 88px; height: 88px; border-radius: 50%; background: #0b0e13;
  border: 1px solid var(--line); touch-action: none; display: block;
}
.mp-item span { font-size: 10.5px; color: var(--text-2); }
.mp-tip { margin: 0; font-size: 10.5px; color: var(--text-2); }
</style>
