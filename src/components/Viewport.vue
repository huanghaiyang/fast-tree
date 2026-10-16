<template>
  <div class="viewport-wrap">
    <div ref="host" class="viewport-canvas"></div>

    <div v-if="state.shaderError" class="error-banner">
      <button class="btn small ghost" style="position: absolute; right: 6px; top: 6px" @click="state.shaderError = ''">✕</button>
      <b>着色器编译错误 / 运行错误</b>
      <pre style="margin: 4px 0 0; white-space: pre-wrap">{{ state.shaderError }}</pre>
    </div>

    <div v-if="state.busy" class="busy">重建几何中…</div>

    <div class="overlay stats">
      <div><span class="k">树枝</span> <b>{{ state.stats.branches }}</b> · <span class="k">叶片</span> <b>{{ state.stats.leaves }}</b></div>
      <div><span class="k">三角面</span> <b>{{ totalTriangles.toLocaleString() }}</b></div>
      <div><span class="k">构建</span> <b>{{ state.stats.buildMs.toFixed(1) }} ms</b> · <span class="k">FPS</span> <b>{{ fps }}</b></div>
      <div><span class="k">树高</span> <b>{{ state.stats.height.toFixed(2) }} m</b> · <span class="k">冠幅</span> <b>{{ state.stats.spread.toFixed(2) }} m</b></div>
      <div><span class="k">绘制调用</span> <b>{{ state.renderInfo.calls }}</b></div>
    </div>

    <div class="overlay help">
      左键旋转 · 右键平移 · 滚轮缩放 · N 节点面板 · W 线框
    </div>

    <WindCompass />

    <div v-if="state.selection.label" class="overlay selection">
      <span class="dot"></span>
      <b>{{ state.selection.label }}</b>
      <span class="muted">· {{ modeLabel }}</span>
      <button v-if="!state.nodePanelOpen" class="btn small ghost" @click="toggleNodePanel(true)">🧩 节点面板</button>
      <button class="btn small ghost" @click="clearSelection">清除</button>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch, computed } from 'vue'
import { TreeScene } from '../core/sceneManager.js'
import { serializeGroup } from '../core/params.js'
import WindCompass from './WindCompass.vue'
import {
  state, sceneApi, totalTriangles, setNodeModel, selectionSignature,
  clearSelection as clearSelectionAction, toggleNodePanel,
} from '../store/treeStore.js'

const host = ref(null)
const fps = ref(0)

const MODE_LABEL = { highlight: '高亮', isolate: '仅显示选中', dim: '其余变暗' }
const modeLabel = computed(() => MODE_LABEL[state.selection.mode] || '高亮')

function clearSelection() {
  clearSelectionAction()
}

let scene = null
let rebuildTimer = 0
let rebuildQueued = false
let rebuildFrame = false
let fpsFrames = 0
let lastCustomCode = ''

onMounted(() => {
  scene = new TreeScene(host.value, {
    onStats: (s) => { state.stats = s; state.ready = true },
    onShaderError: (msg) => { state.shaderError = msg },
    onFrame: (info) => {
      state.renderInfo = { calls: info.calls, triangles: info.triangles }
    },
    onGrowth: (v) => { state.params.growth.value = v },
    onModel: (m) => setNodeModel(m),
  })

  sceneApi.exportGLB = (name) => scene.exportGLB(name)
  sceneApi.exportOBJ = (name) => scene.exportOBJ(name)
  sceneApi.screenshot = (name) => scene.screenshot(name)
  sceneApi.frameCamera = () => scene.frameCamera()
  sceneApi.focusBox = (min, max) => scene.focusBox(min, max)
  sceneApi.getWindScreenBasis = () => scene.getWindScreenBasis()
  // 验证/脚本用的同步重建 (应用内重建走 rAF, 后台标签页会被节流)
  sceneApi.rebuildNow = (frame = true) => {
    if (!scene) return null
    const stats = scene.build(state.params, { frameCamera: !!frame })
    scene.setSelection(state.selection)
    return stats
  }
  if (import.meta.env && import.meta.env.DEV) {
    window.__fastTreeScene = scene
    window.__fastTreeSceneApi = sceneApi
  }

  scene.updateScene(state.params.scene)
  scene.updateGrowth(state.params.growth, state.params.growth.value)
  scene.setGrowthAuto(state.params.growth.enabled && state.params.growth.auto, state.params.growth.speed)
  scene.windTimeScale = state.params.wind.timeScale
  scene.setPlaying(state.playing)
  rebuild(true)
  lastCustomCode = customSignature()

  // FPS 统计
  let last = performance.now()
  const tickFps = () => {
    const now = performance.now()
    fpsFrames++
    if (now - last >= 500) {
      fps.value = Math.round((fpsFrames * 1000) / (now - last))
      fpsFrames = 0
      last = now
    }
    requestAnimationFrame(tickFps)
  }
  requestAnimationFrame(tickFps)

  setupWatchers()
})

onBeforeUnmount(() => {
  scene?.dispose()
  scene = null
})

function scheduleRebuild(frame) {
  rebuildQueued = true
  // 只要有一次请求带取景, 这次重建就取景 (状态切换后需要重新框住新尺寸)
  if (frame) rebuildFrame = true
  if (rebuildTimer) return
  rebuildTimer = setTimeout(() => {
    rebuildTimer = 0
    if (!rebuildQueued) return
    rebuildQueued = false
    const f = rebuildFrame
    rebuildFrame = false
    rebuild(f)
  }, 90)
}

function rebuild(frame) {
  if (!scene) return
  state.busy = true
  requestAnimationFrame(() => {
    if (!scene) return
    try {
      scene.build(state.params, { frameCamera: !!frame })
      state.shaderError = ''
      // 重建后 node id 会变, 重新套用选中状态 (高亮 uniform + 包围盒)
      scene.setSelection(state.selection)
    } catch (e) {
      console.error(e)
      state.shaderError = String((e && e.stack) || e)
    } finally {
      state.busy = false
    }
  })
}

function customSignature() {
  const c = state.params.custom
  return (c.enabled ? '1' : '0') + '|' + c.vertex + '|' + c.fragment
}

function setupWatchers() {
  watch(() => serializeGroup(state.params, 'geometry'), () => scheduleRebuild(false))
  watch(() => selectionSignature(), () => {
    scene?.setSelection(state.selection)
  })
  watch(() => serializeGroup(state.params, 'material'), () => {
    if (!scene) return
    scene.updateMaterialParams(state.params)
    const sig = customSignature()
    if (sig !== lastCustomCode && state.ready) {
      scene.rebindCustomShader(state.params)
      lastCustomCode = sig
    }
  })
  watch(() => serializeGroup(state.params, 'wind'), () => {
    if (!scene) return
    scene.updateWind(state.params)
    scene.windTimeScale = state.params.wind.timeScale
  })
  watch(() => serializeGroup(state.params, 'scene'), () => {
    scene?.updateScene(state.params.scene)
  })
  watch(() => state.params.growth, (g) => {
    if (!scene) return
    scene.updateGrowth(g, g.value)
    scene.setGrowthAuto(g.enabled && g.auto, g.speed)
  }, { deep: true })
  watch(() => state.playing, (v) => scene?.setPlaying(v))
  watch(() => state.frameVersion, () => {
    // 注意: 这里不能重置生长进度 —— 否则切换树种/阶段/季节或点取景时整棵树会先消失再长出来
    // (需要"重新长一遍"的动作会显式调用 state.regrowToken)
    scene?.frameCamera()
  })
  watch(() => state.regrowToken, () => {
    if (!scene) return
    state.params.growth.value = 0
    scene.updateGrowth(state.params.growth, 0)
    scene.setGrowthAuto(state.params.growth.enabled && state.params.growth.auto, state.params.growth.speed)
  })
  watch(() => state.rebuildVersion, () => scheduleRebuild(true))
  watch(() => state.materialVersion, () => {
    scene?.rebindCustomShader(state.params)
    lastCustomCode = customSignature()
  })
}
</script>
