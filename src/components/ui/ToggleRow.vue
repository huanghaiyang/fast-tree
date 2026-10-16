<template>
  <div class="inline" style="justify-content: space-between">
    <label :title="hint" style="flex: 1; cursor: pointer; color: #c3ccd9; font-size: 11.5px" @click="value = !value">{{ label }}</label>
    <input type="checkbox" :checked="value" @change="value = $event.target.checked" />
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
})
const value = defineModel({ type: Boolean, default: false })
</script>
