<template>
  <div class="right-dock">
    <header class="dock-head">
      <span class="ico">🧩</span>
      <span class="title">模型节点</span>
      <span class="muted">{{ model.nodes.length }} 个节点</span>
      <span class="spacer"></span>
      <button class="btn small ghost" title="关闭 (快捷键 N)" @click="toggleNodePanel(false)">✕</button>
    </header>
    <div class="dock-body">
      <NodePanel />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import NodePanel from './panels/NodePanel.vue'
import { state, getNodeModel, toggleNodePanel } from '../store/treeStore.js'

const nodeVersion = computed(() => state.nodeVersion)
const model = computed(() => {
  void nodeVersion.value
  return getNodeModel()
})
</script>

<style scoped>
.right-dock {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--bg-2);
  border-left: 1px solid var(--line);
}
.dock-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  height: 34px;
  flex: none;
  background: #131820;
  border-bottom: 1px solid var(--line);
}
.dock-head .ico { font-size: 13px; }
.dock-head .title { font-weight: 600; font-size: 12.5px; }
.dock-head .spacer { flex: 1; }
.dock-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
