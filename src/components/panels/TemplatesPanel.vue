<template>
  <Section title="模板库" hint="Templates">
    <p class="muted" style="margin: 0 0 6px">
      把当前参数（含外部贴图）存成模板；点「应用」载入后可以继续调参，改完用「覆盖更新」存回同一个模板，或用「保存为模板」另存一份。
    </p>

    <div class="save-row">
      <input
        class="input"
        type="text"
        v-model="nameInput"
        placeholder="模板名称"
        @keydown.enter.prevent="onSave"
      />
      <button class="btn small primary" :disabled="busy" @click="onSave">＋ 保存为模板</button>
    </div>

    <p v-if="status" class="muted" style="margin: 4px 0 0">{{ status }}</p>

    <div v-if="active" class="active-box">
      <span class="active-tag">正在编辑模板</span>
      <span class="active-name" :title="active.name">{{ active.name }}</span>
      <div class="inline">
        <button class="btn tiny primary" :disabled="busy" @click="onUpdate(active)">覆盖更新</button>
        <button class="btn tiny" :disabled="busy" @click="onSaveAsNew">另存为新模板</button>
        <button class="btn tiny" :disabled="busy" @click="onDetach">结束编辑</button>
      </div>
    </div>

    <div class="list-head">
      <label>模板列表（{{ templates.length }}）</label>
      <button class="btn tiny" :disabled="busy" @click="refresh">刷新</button>
    </div>

    <p v-if="!templates.length" class="muted" style="margin: 0">
      还没有模板。调好一棵树后，点上面「保存为模板」即可。
    </p>

    <ul class="tpl-list">
      <li v-for="t in templates" :key="t.id" class="tpl-item" :class="{ active: t.id === state.activeTemplateId }">
        <div class="tpl-info">
          <span class="tpl-name" :title="t.name">{{ t.name }}</span>
          <span class="tpl-meta">
            seed {{ t.seed }} · {{ t.textureCount }} 贴图 · {{ formatSize(t.size) }} · {{ formatDate(t.updatedAt) }}
          </span>
        </div>
        <div class="tpl-actions">
          <button class="btn tiny" :disabled="busy" @click="onApply(t)">应用</button>
          <button class="btn tiny" :disabled="busy" @click="onDownload(t)">下载</button>
          <button class="btn tiny" :disabled="busy" @click="onRename(t)">重命名</button>
          <button class="btn tiny danger" :disabled="busy" @click="onDelete(t)">删除</button>
        </div>
      </li>
    </ul>

    <p class="muted" style="margin: 6px 0 0">
      模板存在浏览器本地数据库（IndexedDB），容量不受 localStorage 5MB 限制，贴图会一起保存在模板里。
    </p>
  </Section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import Section from '../ui/Section.vue'
import {
  state, loadTemplates, doSaveTemplate, doApplyTemplate, doUpdateTemplate,
  doDeleteTemplate, doRenameTemplate, doDownloadTemplate, suggestTemplateName,
} from '../../store/treeStore.js'

const busy = ref(false)
const status = ref('')
const nameInput = ref('')
const templates = computed(() => state.templates || [])
const active = computed(() => templates.value.find((t) => t.id === state.activeTemplateId) || null)

function formatSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}
function formatDate(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 统一包一层异常捕获 + busy, 避免每个按钮都写 try/catch */
async function run(fn, okText) {
  busy.value = true
  try {
    const msg = await fn()
    status.value = typeof msg === 'string' ? msg : okText
  } catch (e) {
    status.value = '操作失败: ' + (e?.message || e)
  } finally {
    busy.value = false
  }
}

async function refresh() {
  await run(async () => {
    await loadTemplates()
    return `已刷新（${state.templates.length} 个模板）`
  })
}

function onSave() {
  if (busy.value) return
  run(async () => {
    const r = await doSaveTemplate(nameInput.value)
    nameInput.value = suggestTemplateName()
    return `已保存模板「${r.name}」（${r.textureCount} 张贴图, ${formatSize(r.size)}）`
  })
}

/** 另存一份: 保留当前编辑态, 用当前参数再生成一条新模板 */
function onSaveAsNew() {
  onSave()
}

function onApply(t) {
  if (busy.value) return
  if (state.activeTemplateId && state.activeTemplateId !== t.id && !confirm(`当前正在编辑「${active.value?.name || '其它模板'}」，切换会丢失未保存的改动，继续？`)) return
  run(async () => {
    const r = await doApplyTemplate(t.id)
    return `已应用模板「${r.name}」（seed=${r.seed}, ${r.textureCount} 张贴图），可以继续调参后覆盖更新`
  })
}

function onUpdate(t) {
  if (busy.value) return
  if (!confirm(`用当前参数覆盖模板「${t.name}」？原内容不可恢复。`)) return
  run(async () => {
    const r = await doUpdateTemplate(t.id)
    return `已覆盖更新「${r.name}」（${r.textureCount} 张贴图, ${formatSize(r.size)}）`
  })
}

async function onRename(t) {
  if (busy.value) return
  const next = prompt('新的模板名称', t.name)
  if (next == null) return
  const trimmed = next.trim()
  if (!trimmed || trimmed === t.name) return
  await run(async () => {
    await doRenameTemplate(t.id, trimmed)
    return `已重命名为「${trimmed}」`
  })
}

async function onDelete(t) {
  if (busy.value) return
  if (!confirm(`删除模板「${t.name}」？该操作不可撤销。`)) return
  await run(async () => {
    await doDeleteTemplate(t.id)
    return `已删除「${t.name}」`
  })
}

function onDownload(t) {
  if (busy.value) return
  run(async () => {
    const r = await doDownloadTemplate(t.id)
    return `已下载 ${r.filename}（${formatSize(r.size)}）`
  })
}

function onDetach() {
  state.activeTemplateId = ''
  status.value = '已结束模板编辑（当前参数仍保留在编辑器里）'
}

onMounted(async () => {
  nameInput.value = suggestTemplateName()
  await loadTemplates()
})
</script>

<style scoped>
.save-row { display: flex; gap: 6px; align-items: center; }
.save-row .input { flex: 1; min-width: 0; }
.active-box {
  margin-top: 8px; padding: 6px 8px; border-radius: 5px;
  background: rgba(255, 209, 102, 0.08); border: 1px solid rgba(255, 209, 102, 0.28);
}
.active-tag { font-size: 10.5px; color: var(--accent); margin-right: 6px; }
.active-name { font-size: 12px; font-weight: 600; display: block; margin: 2px 0 6px; word-break: break-all; }
.list-head { display: flex; justify-content: space-between; align-items: center; margin: 10px 0 6px; }
.list-head label { font-size: 12px; font-weight: 600; }
.tpl-list { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; }
.tpl-item {
  padding: 6px 7px; border-radius: 5px; border: 1px solid transparent;
}
.tpl-item:hover { background: rgba(255, 255, 255, 0.04); }
.tpl-item.active { border-color: rgba(255, 209, 102, 0.45); background: rgba(255, 209, 102, 0.06); }
.tpl-info { display: flex; flex-direction: column; gap: 2px; }
.tpl-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpl-meta { font-size: 10.5px; color: var(--fg-dim); font-variant-numeric: tabular-nums; }
.tpl-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.btn.tiny { padding: 2px 8px; font-size: 11px; }
.btn.danger { color: #ff8a80; }
</style>
