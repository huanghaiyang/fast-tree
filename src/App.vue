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
      <button class="btn" :class="{ active: wireMode !== 'off' }"
        :title="`线框展示 (展示三角面): 当前 ${wireLabel} — 点击依次切换 关闭 / 实体+线框 / 仅线框 (快捷键 W)`"
        @click="cycleWire">🕸 线框{{ wireMode === 'off' ? '' : wireMode === 'overlay' ? '·叠加' : '·仅' }}</button>
      <button class="btn" :class="{ active: showSkeleton || skeletonOnly }"
        :title="`骨架显示 (当前: ${skeletonModeText}): 点击依次切换 关闭 / 叠加在树上 / 仅显示骨架 (快捷键 K)`"
        @click="cycleSkeleton">🦴 骨架{{ skeletonOnly ? '·仅' : showSkeleton ? '·叠加' : '' }}</button>
      <button class="btn" :class="{ active: graphOpen }"
        title="参数与函数调用关系图谱 (只读, 快捷键 G)"
        @click="graphOpen = !graphOpen">🗺 图谱</button>
      <button class="btn" :class="{ active: state.nodePanelOpen }" title="模型节点面板 (N)"
        @click="toggleNodePanel()">🧩 节点</button>
      <span class="tag" :class="{ on: state.playing }" style="cursor: pointer" @click="state.playing = !state.playing">
        {{ state.playing ? '▶ 风中' : '⏸ 暂停' }}
      </span>
    </header>

    <aside class="sidebar">
      <PropertySearch />
      <ChatPanel />
      <ControlPanel />
    </aside>

    <Viewport />

    <NodeDock v-if="state.nodePanelOpen" />

    <FunctionGraph v-if="graphOpen" @close="graphOpen = false" />

    <ParamTip />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { loadFtreeHistory, loadTemplates } from './store/treeStore.js'
import ControlPanel from './components/ControlPanel.vue'
import PropertySearch from './components/PropertySearch.vue'
import ChatPanel from './components/ChatPanel.vue'
import Viewport from './components/Viewport.vue'
import NodeDock from './components/NodeDock.vue'
import FunctionGraph from './components/FunctionGraph.vue'
import ParamTip from './components/ParamTip.vue'
import {
  state, randomizeSeed, setSeed, doAutoGenerate, sceneApi, pushUndo, toggleNodePanel,
} from './store/treeStore.js'
import { ensureFeatureDefaults } from './core/params.js'

const p = state.params
// 兼容 HMR/旧会话：补齐后加的继承开关（默认开启），避免页面停在旧参数结构
ensureFeatureDefaults(p)
const ready = computed(() => state.ready)

/* 线框展示 (展示三角面): 顶栏按钮 / W 键 / 场景页下拉三处共用 */
const WIRE_MODES = ['off', 'overlay', 'only']
const WIRE_LABELS = { off: '关闭', overlay: '实体 + 线框', only: '仅线框' }
const wireMode = computed(() => state.params.scene.wireframe || 'off')
const wireLabel = computed(() => WIRE_LABELS[wireMode.value] || '关闭')
function cycleWire() {
  const cur = WIRE_MODES.indexOf(wireMode.value)
  state.params.scene.wireframe = WIRE_MODES[(cur + 1) % WIRE_MODES.length]
}

/* 骨架显示: 三态循环 关闭 → 叠加 → 仅骨架。
   - 叠加: 只在树上加骨架线段/节点 (showSkeleton 仅控制视口叠层, 不进参数/审计);
   - 仅骨架: 复用 params.scene.skeletonOnly, 隐藏树皮/叶片/花果, 只留骨架。 */
const showSkeleton = ref(false)
const skeletonOnly = computed(() => !!state.params.scene.skeletonOnly)
const skeletonModeText = computed(() => (skeletonOnly.value ? '仅骨架' : showSkeleton.value ? '叠加' : '关闭'))
const graphOpen = ref(false)
function cycleSkeleton() {
  if (skeletonOnly.value) {
    // 仅骨架 -> 关闭 (骨架叠层与实体一起恢复)
    state.params.scene.skeletonOnly = false
    showSkeleton.value = false
    sceneApi.setSkeletonVisible?.(false)
  } else if (showSkeleton.value) {
    // 叠加 -> 仅骨架 (骨架叠层保持显示, 网格由 updateScene 隐藏)
    state.params.scene.skeletonOnly = true
  } else {
    // 关闭 -> 叠加
    showSkeleton.value = true
    sceneApi.setSkeletonVisible?.(true)
  }
}

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
  if (e.key === 'w' || e.key === 'W') {
    e.preventDefault()
    cycleWire()
  }
  if (e.key === 'k' || e.key === 'K') {
    e.preventDefault()
    cycleSkeleton()
  }
  if (e.key === 'g' || e.key === 'G') {
    e.preventDefault()
    graphOpen.value = !graphOpen.value
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // 载入 .ftree 导出/导入历史 (localStorage 持久化)
  loadFtreeHistory()
  // 载入模板库元信息 (IndexedDB 持久化)
  loadTemplates()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
