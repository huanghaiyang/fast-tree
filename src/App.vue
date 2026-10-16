<template>
  <div class="app" :class="{ 'with-right': state.nodePanelOpen }">
    <header class="topbar">
      <div class="brand">
        <span class="logo">🌳</span>
        <span>FastTree</span>
        <small>程序化快速树生成器 · Vue 3 + Three.js</small>
      </div>
      <div class="spacer"></div>
      <div class="seed-box">
        <span class="muted">seed</span>
        <input type="number" min="1" :value="p.seed" @change="onSeed($event.target.value)" />
        <button class="btn small" title="随机种子" @click="onRandomSeed">🎲</button>
      </div>
      <button class="btn primary" @click="onAuto">✨ 自动生成</button>
      <button class="btn" @click="onRebuild">⟳ 重建</button>
      <button class="btn" @click="onFrame">⛶ 取景</button>
      <button class="btn" :disabled="!ready" @click="onGLB">📦 GLB</button>
      <button class="btn" :class="{ active: state.nodePanelOpen }" title="模型节点面板 (N)"
        @click="toggleNodePanel()">🧩 节点</button>
      <span class="tag" :class="{ on: state.playing }" style="cursor: pointer" @click="state.playing = !state.playing">
        {{ state.playing ? '▶ 风中' : '⏸ 暂停' }}
      </span>
    </header>

    <aside class="sidebar">
      <ControlPanel />
    </aside>

    <Viewport />

    <NodeDock v-if="state.nodePanelOpen" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'
import ControlPanel from './components/ControlPanel.vue'
import Viewport from './components/Viewport.vue'
import NodeDock from './components/NodeDock.vue'
import {
  state, randomizeSeed, setSeed, doAutoGenerate, sceneApi, pushUndo, toggleNodePanel,
} from './store/treeStore.js'

const p = state.params
const ready = computed(() => state.ready)

function onSeed(v) {
  pushUndo()
  setSeed(Number(v))
}

function onRandomSeed() {
  randomizeSeed()
  state.frameVersion++
}

function onAuto() {
  doAutoGenerate({})
  state.frameVersion++
}

function onRebuild() {
  state.rebuildVersion++
}

function onFrame() {
  state.frameVersion++
}

function onGLB() {
  sceneApi.exportGLB?.(`fasttree-${p.seed}.glb`)
}

/* 快捷键: N 开关模型节点面板 (输入框里打字时不拦截) */
function onKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const el = e.target
  const tag = el && el.tagName ? el.tagName.toLowerCase() : ''
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || (el && el.isContentEditable)) return
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault()
    toggleNodePanel()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
