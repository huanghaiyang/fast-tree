<template>
  <div class="row">
    <div class="row-head">
      <label :title="hint || label">{{ label }}</label>
      <input class="num" type="number" :min="min" :max="max" :step="step" v-model.number="value" />
      <span v-if="unit" class="unit">{{ unit }}</span>
    </div>
    <input class="rng" type="range" :min="min" :max="max" :step="step" v-model.number="value" />
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, default: '' },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 1 },
  step: { type: Number, default: 0.01 },
  unit: { type: String, default: '' },
  hint: { type: String, default: '' },
})
const value = defineModel({ type: Number, default: 0 })
</script>
