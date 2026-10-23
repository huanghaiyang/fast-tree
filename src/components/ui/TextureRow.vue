<template>
  <div class="row">
    <div class="row-head">
      <label :title="hint || label">{{ label }}</label>
      <span class="tag" :class="{ on: !!value }">{{ value ? '已自定义' : '程序化' }}</span>
    </div>
    <div class="wrap">
      <button class="btn small" @click="pick">上传贴图…</button>
      <button class="btn small ghost" :disabled="!value" @click="value = ''">恢复程序化</button>
      <img v-if="value" :src="value" class="thumb" alt="texture" />
    </div>
    <input ref="file" type="file" accept="image/*" hidden @change="onFile" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { readImageAsDataURL } from '../../core/exporter.js'

defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
})
const value = defineModel({ type: String, default: '' })
const file = ref(null)

function pick() {
  file.value?.click()
}
async function onFile(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  value.value = await readImageAsDataURL(f)
  e.target.value = ''
}
</script>

<style scoped>
/* 预览按贴图真实宽高比展示, 不裁掉任何部分 */
.thumb {
  width: auto;
  height: auto;
  max-width: 120px;
  max-height: 40px;
  object-fit: contain;
  border-radius: 5px;
  border: 1px solid var(--line-2);
}
</style>
