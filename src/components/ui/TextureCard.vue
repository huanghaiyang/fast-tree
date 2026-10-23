<template>
  <button v-if="!failed" type="button" class="tex-card" :class="{ active }"
    :title="hintText" @click="$emit('pick')">
    <span class="tex-card-img">
      <img :src="src" alt="" @load="onLoad" @error="onError" />
    </span>
    <span v-if="showSize" class="tex-card-size">{{ sizeText || '\u00a0' }}</span>
  </button>
</template>

<script setup>
import { computed, ref } from 'vue'

/* 贴图卡片: 统一负责「不裁剪 + 按贴图真实宽高比展示 + 标注像素尺寸」
 * 缩略图高度固定, 宽度随图片比例自适应 (max-width 兜底), 因此长条/竖图都不会被压扁或裁掉一角。
 */
const props = defineProps({
  src: { type: String, required: true },
  active: { type: Boolean, default: false },
  title: { type: String, default: '' },
  showSize: { type: Boolean, default: true },
})
defineEmits(['pick', 'error'])

const failed = ref(false)
const size = ref(null)

const sizeText = computed(() => (size.value ? `${size.value.w}×${size.value.h}` : ''))
const hintText = computed(() => [props.title, sizeText.value].filter(Boolean).join(' · '))

function onLoad(e) {
  const img = e && e.target
  if (!img) return
  size.value = { w: img.naturalWidth, h: img.naturalHeight }
}
function onError() {
  failed.value = true
}
</script>

<style scoped>
.tex-card {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px;
  background: var(--bg-3);
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
}
.tex-card:hover { border-color: var(--line-2); }
.tex-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(90, 200, 160, 0.35);
}
.tex-card-img {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 56px;
  min-width: 52px;
}
.tex-card-img img {
  display: block;
  width: auto;
  height: 56px;
  max-width: 140px;
  object-fit: contain;
}
.tex-card-size {
  font-size: 10px;
  line-height: 1;
  color: var(--fg-dim);
  letter-spacing: 0.2px;
  white-space: nowrap;
}
</style>
