<template>
  <div class="app">
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
      <span class="tag" :class="{ on: state.playing }" style="cursor: pointer" @click="state.playing = !state.playing">
        {{ state.playing ? '▶ 风中' : '⏸ 暂停' }}
      </span>
    </header>

    <aside class="sidebar">
      <ControlPanel />
    </aside>

    <Viewport />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import ControlPanel from './components/ControlPanel.vue'
import Viewport from './components/Viewport.vue'
import {
  state, randomizeSeed, setSeed, doAutoGenerate, sceneApi, pushUndo,
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
</script>
