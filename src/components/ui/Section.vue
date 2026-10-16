<template>
  <section class="section">
    <header class="section-head" @click="collapsed = !collapsed">
      <span class="chev">{{ collapsed ? '▶' : '▼' }}</span>
      <span class="title">{{ title }}</span>
      <span v-if="hint" class="hint">{{ hint }}</span>
      <slot name="head" />
    </header>
    <div v-show="!collapsed" class="section-body">
      <slot />
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue'
const props = defineProps({
  title: { type: String, default: '' },
  hint: { type: String, default: '' },
  defaultCollapsed: { type: Boolean, default: false },
})
const collapsed = ref(props.defaultCollapsed)
</script>
