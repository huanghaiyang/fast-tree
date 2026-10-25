<template>
  <Section title="导出" hint="Export">
    <div class="wrap">
      <button class="btn primary" :disabled="busy" @click="onGLB">⬇ 导出 GLB (glTF)</button>
      <button class="btn" :disabled="busy" @click="onOBJ">⬇ 导出 OBJ</button>
      <button class="btn" :disabled="busy" @click="onPNG">📷 截图 PNG</button>
      <button class="btn" @click="onJSON">💾 保存参数 JSON</button>
      <button class="btn" @click="fileInput?.click()">📂 载入参数 JSON</button>
      <button class="btn primary" :disabled="ftreeBusy" @click="onExportFtree">📦 导出 .ftree (含贴图)</button>
      <button class="btn" @click="ftreeInput?.click()">📂 载入 .ftree</button>
    </div>
    <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onLoadJSON" />
    <input ref="ftreeInput" type="file" accept=".ftree,application/zip,application/octet-stream" hidden @change="onImportFtree" />
    <p v-if="ftreeStatus" class="muted" style="margin: 0">{{ ftreeStatus }}</p>
    <div v-if="ftreeHistory.length" class="ftree-history">
      <div class="history-head">
        <label>.ftree 历史记录</label>
        <button class="btn tiny" @click="clearHistory">清空</button>
      </div>
      <ul class="history-list">
        <li v-for="h in ftreeHistory" :key="h.id" class="history-item">
          <span class="h-action" :class="h.action">{{ h.action === 'export' ? '⬇ 导出' : '⬆ 导入' }}</span>
          <span class="h-name" :title="h.name">{{ h.name }}</span>
          <span class="h-meta">
            seed {{ h.seed }} · {{ h.textureCount }} 贴图 · {{ formatSize(h.size) }}
          </span>
          <span class="h-date">{{ formatDate(h.date) }}</span>
        </li>
      </ul>
    </div>
    <ExportPreviewDialog :open="previewOpen" :title="preview?.title || ''" :filename="preview?.filename || ''"
      :artifacts="preview?.artifacts || []" :nodes="preview?.nodes || []"
      @confirm="confirmExport" @cancel="cancelPreview" />
    <ToggleRow label="合并树干与树枝 mesh" v-model="eo.mergeBark"
      hint="关闭 = 按节点拆分树干/树枝各层/根/果实 (默认); 打开 = 树干与树枝合并为一个 Bark mesh。若树干面板开启「一体建模」, 树根也会一起合并。" />
    <p v-if="status" class="muted" style="margin: 0">{{ status }}</p>
    <p class="muted" style="margin: 0">
      GLB = glTF 2.0 二进制 (含贴图/顶点色, 标准格式, 静态网格); OBJ = 纯几何 (Wavefront, 不含材质/贴图/顶点色);
      参数 JSON 带 format/version/seed, 载入即可完整复现。
      点击导出会先打开预览面板：列出产物文件、贴图缩略图与节点列表，确认后才下载。
    </p>
    <p class="muted" style="margin: 0">
      贴图资源命名: <code>_diff</code> / <code>_alpha</code> / <code>_nor_gl</code> / <code>_rough</code>；
      1K/2K/4K 贴图自动追加 <code>_1k</code>/<code>_2k</code>/<code>_4k</code>，其它尺寸不加 <code>_xk</code> 后缀。
      GLB 导出会补全材质的 normal/roughness 贴图；叶片/花朵 alpha 以 baseColor 的 alpha 通道 + <code>MASK</code> 导出。
      果实导出使用独立的 <code>Fruit</code> 材质，附带 <code>fruit_diff/alpha/nor_gl/rough</code> 资源。
    </p>
    <p class="muted" style="margin: 0">
      风场/生长是顶点着色器效果, 导出的静态网格不含动画; 粒子/落叶等场景特效也不会写进模型文件。
      动态 LOD 只影响视口, 导出的是 LOD0 全模; 程序化 AO 已烘焙进顶点色 (COLOR_0) 一起导出。
      当前导出节点: {{ onePiece
        ? '树干+树枝+树根合并为一个 Bark mesh (果实/树叶/花朵仍独立)'
        : eo.mergeBark
          ? '树干+树枝合并为一个 Bark mesh (根/果实仍分开)'
          : '树干、树枝各层、树根、果实、树叶、花朵都是独立节点' }}。
      但如果自定义 GLSL 改动过材质, 参数 JSON 可以完整复现。
    </p>
  </Section>

  <Section title="伪装卡生成器" hint="Impostor">
    <SelectRow label="生成模式" v-model="impMode" :options="impModes"
      hint="图集伪装卡 = 多视角拼成一张图, 远景替换整棵 3D 树; 交叉卡 = 2~4 张交叉面片, 用于中远景树冠" />
    <SliderRow v-if="impMode === 'cross'" label="卡片张数" v-model="impViews" :min="2" :max="20" :step="1" />
    <SliderRow v-else label="视角数" v-model="impViews" :min="1" :max="64" :step="1" />
    <SliderRow v-if="impMode === 'atlas'" label="俯仰层数" v-model="impElev" :min="1" :max="3" :step="1"
      hint="从几个高度拍: 1 = 仅水平; 2 = 水平 + 俯视 (俯视层就是从顶部往下看的伪装卡); 3 = 再加仰视" />
    <SliderRow label="单视角分辨率" v-model="impSize" :min="128" :max="1024" :step="64" unit="px" />
    <div class="inline">
      <button class="btn small primary" :disabled="!!state.impostorBusy" @click="onImpostor">
        {{ state.impostorBusy ? '生成中…' : '生成伪装卡' }}
      </button>
      <button class="btn small" :disabled="!state.impostorResult" @click="onDownloadImpostor">⬇ 下载 PNG</button>
      <button class="btn small" :disabled="!state.impostorResult" @click="onTogglePreview">
        {{ state.impostorPreview ? '回 3D 模型' : '在主预览区查看' }}
      </button>
    </div>
    <p v-if="state.impostorResult" class="muted" style="margin: 0">
      {{ state.impostorResult.meta.mode }} · {{ state.impostorResult.meta.views }} 视角 ·
      {{ state.impostorResult.width }}×{{ state.impostorResult.height }} ·
      alpha 覆盖率 {{ (state.impostorResult.coverage * 100).toFixed(1) }}% ·
      距离 {{ state.impostorResult.meta.distance }}
    </p>
    <img v-if="state.impostorResult" :src="state.impostorResult.dataUrl" alt="impostor"
      style="width: 100%; border: 1px solid var(--line); border-radius: 4px; background: #0b0e13" />
  </Section>

  <Section title="统计" hint="Stats">
    <div class="kv"><span class="k">树枝数量</span><b>{{ stats.branches }}</b></div>
    <div class="kv"><span class="k">叶片数量</span><b>{{ stats.leaves }}</b></div>
    <div class="kv"><span class="k">三角面</span><b>{{ totalTriangles.toLocaleString() }}</b></div>
    <div class="kv"><span class="k">顶点</span><b>{{ modelVertices.toLocaleString() }}</b></div>
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
import { ref, computed, onBeforeUnmount } from 'vue'
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import ExportPreviewDialog from '../ExportPreviewDialog.vue'
import { state, sceneApi, totalTriangles, doGenerateImpostor, downloadImpostor, setImpostorPreview,
  importParamsJSON, doExportFtree, doImportFtree, clearFtreeHistory } from '../../store/treeStore.js'
import { modelVertexCount } from '../../core/modelStats.js'
import { buildParamsJSON, downloadBlob, downloadText, readTextFile } from '../../core/exporter.js'

const stats = computed(() => state.stats)
const renderInfo = computed(() => state.renderInfo)
const modelVertices = computed(() => modelVertexCount(state.stats))
const eo = state.params.exportOptions
const onePiece = computed(() => !!state.params.trunk.onePiece)
const busy = ref(false)
/* 伪装卡生成器 */
const impMode = ref('atlas')
const impViews = ref(8)
const impSize = ref(512)
const impElev = ref(2)   // 俯仰层数 (1 = 仅水平, 2 = 水平 + 俯视)
const impModes = [
  { value: 'atlas', label: '图集伪装卡 (多视角)' },
  { value: 'cross', label: '交叉卡 (2~4 面片)' },
]
function onImpostor() {
  try {
    doGenerateImpostor({ mode: impMode.value, views: impViews.value, elevations: impElev.value, size: impSize.value })
  } catch (e) {
    status.value = '伪装卡生成失败: ' + (e && e.message ? e.message : e)
  }
}
function onTogglePreview() {
  setImpostorPreview(!state.impostorPreview)
}
function onDownloadImpostor() {
  downloadImpostor(true)
}

const status = ref('')
const fileInput = ref(null)
const ftreeInput = ref(null)
const ftreeBusy = ref(false)
const ftreeStatus = ref('')
const ftreeHistory = computed(() => state.ftreeHistory || [])
const previewOpen = ref(false)
const preview = ref(null)

/* ---- .ftree 工程文件 ---- */
function formatSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}
function formatDate(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function onExportFtree() {
  try {
    const { filename, textureCount, size } = doExportFtree()
    ftreeStatus.value = `已导出 ${filename} (${textureCount} 张贴图, ${formatSize(size)})`
  } catch (e) {
    ftreeStatus.value = '导出失败: ' + (e?.message || e)
  }
}
async function onImportFtree(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  ftreeBusy.value = true
  ftreeStatus.value = '正在解析 ' + f.name + '…'
  try {
    const { seed, textureCount } = await doImportFtree(f)
    state.frameVersion++
    ftreeStatus.value = `已导入 ${f.name} (seed=${seed}, ${textureCount} 张贴图)`
  } catch (err) {
    ftreeStatus.value = '导入失败: ' + (err?.message || err)
  } finally {
    ftreeBusy.value = false
    e.target.value = ''
  }
}
function clearHistory() {
  if (confirm('确定清空全部 .ftree 历史记录?')) clearFtreeHistory()
}

function revokePreviewUrls(p) {
  for (const url of (p && p.objectUrls) || []) {
    try { URL.revokeObjectURL(url) } catch { /* ignore */ }
  }
}

function closePreview() {
  revokePreviewUrls(preview.value)
  previewOpen.value = false
  preview.value = null
}

function cancelPreview() {
  closePreview()
  status.value = '已取消导出'
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

async function openExportPreview(kind) {
  if (!sceneApi.prepareExport) {
    status.value = '导出预览尚未就绪'
    return
  }
  if (previewOpen.value) return
  busy.value = true
  status.value = '正在准备导出预览…'
  try {
    const seed = state.params.seed
    if (kind === 'json') {
      const filename = `fasttree-params-${seed}.json`
      const { text } = buildParamsJSON(state.params)
      preview.value = {
        kind: 'json',
        title: '参数 JSON 导出预览',
        filename,
        artifacts: [{ name: filename, kind: 'file', size: new Blob([text]).size, detail: 'fast-tree/params JSON' }],
        nodes: [],
        payload: { type: 'text', text, mime: 'application/json' },
        objectUrls: [],
      }
    } else if (kind === 'glb') {
      preview.value = await sceneApi.prepareExport('glb', `fasttree-${seed}.glb`)
    } else if (kind === 'obj') {
      preview.value = await sceneApi.prepareExport('obj', `fasttree-${seed}.obj`)
    } else if (kind === 'png') {
      preview.value = await sceneApi.prepareExport('png', `fasttree-${seed}.png`)
    }
    previewOpen.value = true
    status.value = ''
  } catch (e) {
    status.value = '导出预览失败: ' + (e?.message || e)
  } finally {
    busy.value = false
  }
}

function confirmExport() {
  const p = preview.value
  if (!p) return
  try {
    if (p.payload?.type === 'blob') downloadBlob(p.payload.blob, p.filename)
    else if (p.payload?.type === 'text') downloadText(p.payload.text, p.filename, p.payload.mime || 'text/plain')
    else if (p.payload?.type === 'dataUrl') downloadDataUrl(p.payload.dataUrl, p.filename)
    status.value = p.kind === 'glb' ? 'GLB 导出完成'
      : p.kind === 'obj' ? 'OBJ 导出完成'
        : p.kind === 'png' ? '截图已保存'
          : '参数 JSON 已保存'
  } finally {
    closePreview()
  }
}

async function onGLB() {
  await openExportPreview('glb')
}

function onOBJ() {
  openExportPreview('obj')
}

async function onPNG() {
  await openExportPreview('png')
}

function onJSON() {
  openExportPreview('json')
}

onBeforeUnmount(() => {
  revokePreviewUrls(preview.value)
})

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
.ftree-history { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
.history-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.history-head label { font-size: 12px; font-weight: 600; }
.history-list { list-style: none; margin: 0; padding: 0; max-height: 180px; overflow-y: auto; }
.history-item {
  display: grid; grid-template-columns: auto 1fr auto auto; gap: 6px; align-items: center;
  padding: 5px 6px; border-radius: 4px; font-size: 11px;
}
.history-item:hover { background: rgba(255,255,255,0.04); }
.h-action { font-weight: 600; }
.h-action.export { color: #6ec6ff; }
.h-action.import { color: #b5e6a0; }
.h-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }
.h-meta { color: var(--fg-dim); }
.h-date { color: var(--fg-dim); font-variant-numeric: tabular-nums; }
.btn.tiny { padding: 2px 8px; font-size: 11px; }
</style>
