<template>
  <div class="row-head">
    <label :title="hint || label">{{ label }}</label>
    <input type="color" :value="value" @input="value = $event.target.value" />
    <input class="num" style="width: 78px" type="text" :value="value" @change="value = $event.target.value" />
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
})
const value = defineModel({ type: String, default: '#ffffff' })
</script>
