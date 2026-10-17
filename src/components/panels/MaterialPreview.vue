<template>
  <Section title="材质球预览" hint="Preview">
    <div class="mat-preview">
      <div class="mp-item">
        <img v-if="barkSrc" :src="barkSrc" alt="bark" />
        <div v-else class="mp-empty">…</div>
        <span>树皮</span>
      </div>
      <div class="mp-item">
        <img v-if="leafSrc" :src="leafSrc" alt="leaf" />
        <div v-else class="mp-empty">…</div>
        <span>树叶</span>
      </div>
    </div>
    <p class="mp-tip">用当前参数实时烘焙 (独立光照: 主光+补光+轮廓光)，看材质本身的效果</p>
  </Section>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import Section from '../ui/Section.vue'
import { state } from '../../store/treeStore.js'
import { renderMaterialPreview } from '../../core/materialPreview.js'

const barkSrc = ref('')
const leafSrc = ref('')
let timer = 0

function refresh() {
  const out = renderMaterialPreview(state.params)
  if (out) {
    barkSrc.value = out.bark
    leafSrc.value = out.leaf
  }
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(refresh, 120)
}

onMounted(() => {
  // 等主场景把贴图/材质准备好再画
  setTimeout(refresh, 300)
})

// 材质组任一参数变化就重画 (不重建树)
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
.mat-preview { display: flex; gap: 10px; justify-content: center; padding: 2px 0 6px; }
.mp-item { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.mp-item img { width: 76px; height: 76px; border-radius: 50%; background: #0b0e13; border: 1px solid var(--line); }
.mp-empty { width: 76px; height: 76px; border-radius: 50%; background: #0b0e13; border: 1px solid var(--line); }
.mp-item span { font-size: 10.5px; color: var(--text-2); }
.mp-tip { margin: 0; font-size: 10.5px; color: var(--text-2); }
</style>
