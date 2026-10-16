<template>
  <div class="row-head">
    <label :title="hint || label">{{ label }}</label>
    <select class="input" style="width: 132px" :value="value" @change="value = $event.target.value">
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  hint: { type: String, default: '' },
})
const value = defineModel({ type: [String, Number], default: '' })
</script>
