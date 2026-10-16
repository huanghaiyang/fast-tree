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
      左键旋转 · 右键平移 · 滚轮缩放
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TreeScene } from '../core/sceneManager.js'
import { serializeGroup } from '../core/params.js'
import { state, sceneApi, totalTriangles } from '../store/treeStore.js'

const host = ref(null)
const fps = ref(0)

let scene = null
let rebuildTimer = 0
let rebuildQueued = false
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
  })

  sceneApi.exportGLB = (name) => scene.exportGLB(name)
  sceneApi.exportOBJ = (name) => scene.exportOBJ(name)
  sceneApi.screenshot = (name) => scene.screenshot(name)
  sceneApi.frameCamera = () => scene.frameCamera()
  if (import.meta.env && import.meta.env.DEV) {
    window.__fastTreeScene = scene
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
  if (rebuildTimer) return
  rebuildTimer = setTimeout(() => {
    rebuildTimer = 0
    if (!rebuildQueued) return
    rebuildQueued = false
    rebuild(frame)
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
    if (state.params.growth.auto) {
      state.params.growth.value = 0
    }
    scene?.frameCamera()
  })
  watch(() => state.rebuildVersion, () => scheduleRebuild(true))
  watch(() => state.materialVersion, () => {
    scene?.rebindCustomShader(state.params)
    lastCustomCode = customSignature()
  })
}
</script>
