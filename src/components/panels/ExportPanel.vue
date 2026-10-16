<template>
  <Section title="导出" hint="Export">
    <div class="wrap">
      <button class="btn primary" :disabled="busy" @click="onGLB">⬇ 导出 GLB (glTF)</button>
      <button class="btn" :disabled="busy" @click="onOBJ">⬇ 导出 OBJ</button>
      <button class="btn" :disabled="busy" @click="onPNG">📷 截图 PNG</button>
      <button class="btn" @click="onJSON">💾 保存参数 JSON</button>
      <button class="btn" @click="fileInput?.click()">📂 载入参数 JSON</button>
    </div>
    <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onLoadJSON" />
    <p v-if="status" class="muted" style="margin: 0">{{ status }}</p>
    <p class="muted" style="margin: 0">
      GLB 会带上贴图 (程序化贴图会烘焙进 GLB)。风场/生长是顶点着色器效果,
      导出的静态网格不含动画 —— 但如果自定义 GLSL 改动过材质, 参数 JSON 可以完整复现。
    </p>
  </Section>

  <Section title="统计" hint="Stats">
    <div class="kv"><span class="k">树枝数量</span><b>{{ stats.branches }}</b></div>
    <div class="kv"><span class="k">叶片数量</span><b>{{ stats.leaves }}</b></div>
    <div class="kv"><span class="k">三角面</span><b>{{ totalTriangles.toLocaleString() }}</b></div>
    <div class="kv"><span class="k">顶点</span><b>{{ (stats.barkVertices + stats.leafVertices).toLocaleString() }}</b></div>
    <div class="kv"><span class="k">构建耗时</span><b>{{ stats.buildMs.toFixed(1) }} ms</b></div>
    <div class="kv"><span class="k">树高</span><b>{{ stats.height.toFixed(2) }} m</b></div>
    <div class="kv"><span class="k">冠幅</span><b>{{ stats.spread.toFixed(2) }} m</b></div>
    <div class="kv"><span class="k">绘制调用</span><b>{{ renderInfo.calls }}</b></div>
  </Section>

  <Section title="快捷键 / 帮助" hint="Help" :default-collapsed="true">
    <ul class="help-list">
      <li>左键拖动 = 旋转 · 右键 = 平移 · 滚轮 = 缩放</li>
      <li>同一 seed + 同一参数 = 完全相同的树 (逐字节可复现)</li>
      <li>参数分组: 改「树干/树枝/树叶」重建几何; 改「风/材质」实时生效</li>
      <li>每个生成阶段使用独立随机子流, 所以调树叶不会挪动树干</li>
    </ul>
  </Section>
</template>

<script setup>
import { ref, computed } from 'vue'
import Section from '../ui/Section.vue'
import { state, sceneApi, totalTriangles } from '../../store/treeStore.js'
import { exportParamsJSON, readTextFile } from '../../core/exporter.js'
import { importParamsJSON } from '../../store/treeStore.js'

const stats = computed(() => state.stats)
const renderInfo = computed(() => state.renderInfo)
const busy = ref(false)
const status = ref('')
const fileInput = ref(null)

async function onGLB() {
  if (!sceneApi.exportGLB) return
  busy.value = true
  status.value = '正在导出 GLB…'
  try {
    await sceneApi.exportGLB(`fasttree-${state.params.seed}.glb`)
    status.value = 'GLB 导出完成'
  } catch (e) {
    status.value = 'GLB 导出失败: ' + (e?.message || e)
  } finally {
    busy.value = false
  }
}

function onOBJ() {
  if (!sceneApi.exportOBJ) return
  sceneApi.exportOBJ(`fasttree-${state.params.seed}.obj`)
  status.value = 'OBJ 导出完成'
}

async function onPNG() {
  if (!sceneApi.screenshot) return
  await sceneApi.screenshot(`fasttree-${state.params.seed}.png`)
  status.value = '截图已保存'
}

function onJSON() {
  exportParamsJSON(state.params, `fasttree-params-${state.params.seed}.json`)
  status.value = '参数 JSON 已保存'
}

async function onLoadJSON(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  try {
    const text = await readTextFile(f)
    importParamsJSON(text)
    state.frameVersion++
    status.value = '参数已载入: ' + f.name
  } catch (err) {
    status.value = '载入失败: ' + (err?.message || err)
  }
  e.target.value = ''
}
</script>

<style scoped>
.kv { display: flex; justify-content: space-between; font-size: 11.5px; }
.kv b { color: var(--accent); font-weight: 600; }
.kv .k { color: var(--fg-dim); }
.help-list { margin: 0; padding-left: 16px; color: var(--fg-dim); font-size: 11.5px; line-height: 1.8; }
</style>
