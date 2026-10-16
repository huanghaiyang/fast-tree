<template>
  <div class="tabs">
    <div v-for="t in tabs" :key="t.id" class="tab" :class="{ active: active === t.id }" @click="active = t.id">
      {{ t.icon }} {{ t.name }}
    </div>
  </div>

  <AutoPanel v-if="active === 'auto'" />
  <TrunkPanel v-else-if="active === 'trunk'" />
  <BranchPanel v-else-if="active === 'branch'" />
  <LeafPanel v-else-if="active === 'leaf'" />
  <FruitPanel v-else-if="active === 'fruit'" />
  <WindPanel v-else-if="active === 'wind'" />
  <MaterialPanel v-else-if="active === 'material'" />
  <ScenePanel v-else-if="active === 'scene'" />
  <ExportPanel v-else-if="active === 'export'" />
</template>

<script setup>
import { ref } from 'vue'
import AutoPanel from './panels/AutoPanel.vue'
import TrunkPanel from './panels/TrunkPanel.vue'
import BranchPanel from './panels/BranchPanel.vue'
import LeafPanel from './panels/LeafPanel.vue'
import FruitPanel from './panels/FruitPanel.vue'
import WindPanel from './panels/WindPanel.vue'
import MaterialPanel from './panels/MaterialPanel.vue'
import ScenePanel from './panels/ScenePanel.vue'
import ExportPanel from './panels/ExportPanel.vue'

const active = ref('auto')
const tabs = [
  { id: 'auto', name: '种子', icon: '🎲' },
  { id: 'trunk', name: '树干', icon: '🪵' },
  { id: 'branch', name: '树枝', icon: '🌿' },
  { id: 'leaf', name: '树叶', icon: '🍃' },
  { id: 'fruit', name: '果实', icon: '🌰' },
  { id: 'wind', name: '风/生长', icon: '💨' },
  { id: 'material', name: '材质', icon: '🎨' },
  { id: 'scene', name: '场景', icon: '🌅' },
  { id: 'export', name: '导出', icon: '📦' },
]
</script>
