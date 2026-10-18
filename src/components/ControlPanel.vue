<template>
  <div class="tabs">
    <div v-for="t in tabs" :key="t.id" class="tab" :class="{ active: activeTab === t.id }" @click="setActiveTab(t.id)">
      {{ t.icon }} {{ t.name }}
    </div>
  </div>

  <AutoPanel v-if="activeTab === 'auto'" />
  <TrunkPanel v-else-if="activeTab === 'trunk'" />
  <BranchPanel v-else-if="activeTab === 'branch'" />
  <LeafPanel v-else-if="activeTab === 'leaf'" />
  <FlowerPanel v-else-if="activeTab === 'flower'" />
  <FruitPanel v-else-if="activeTab === 'fruit'" />
  <WindPanel v-else-if="activeTab === 'wind'" />
  <MaterialPanel v-else-if="activeTab === 'material'" />
  <ScenePanel v-else-if="activeTab === 'scene'" />
  <ExportPanel v-else-if="activeTab === 'export'" />
</template>

<script setup>
import { computed } from 'vue'
import { state, setActiveTab } from '../store/treeStore.js'

const activeTab = computed(() => state.activeTab)
import AutoPanel from './panels/AutoPanel.vue'
import TrunkPanel from './panels/TrunkPanel.vue'
import BranchPanel from './panels/BranchPanel.vue'
import LeafPanel from './panels/LeafPanel.vue'
import FlowerPanel from './panels/FlowerPanel.vue'
import FruitPanel from './panels/FruitPanel.vue'
import WindPanel from './panels/WindPanel.vue'
import MaterialPanel from './panels/MaterialPanel.vue'
import ScenePanel from './panels/ScenePanel.vue'
import ExportPanel from './panels/ExportPanel.vue'

const tabs = [
  { id: 'auto', name: '种子', icon: '🎲' },
  { id: 'trunk', name: '树干', icon: '🪵' },
  { id: 'branch', name: '树枝', icon: '🌿' },
  { id: 'leaf', name: '树叶', icon: '🍃' },
  { id: 'flower', name: '花朵', icon: '🌸' },
    { id: 'fruit', name: '果实', icon: '🌰' },
  { id: 'wind', name: '风/生长', icon: '💨' },
  { id: 'material', name: '材质', icon: '🎨' },
  { id: 'scene', name: '场景', icon: '🌅' },
  { id: 'export', name: '导出', icon: '📦' },
]
</script>
