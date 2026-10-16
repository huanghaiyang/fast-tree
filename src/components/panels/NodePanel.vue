<template>
  <Section title="模型节点" hint="Model Nodes" :default-collapsed="false">
    <!-- 选中模式 -->
    <div class="row-head">
      <label>选中显示方式</label>
    </div>
    <div class="level-tabs">
      <div v-for="m in modes" :key="m.id" class="level-tab" :class="{ active: sel.mode === m.id }"
        :title="m.hint" @click="setSelectionMode(m.id)">{{ m.name }}</div>
    </div>
    <div class="row-head">
      <label>高亮颜色</label>
      <input type="color" :value="sel.color" @input="setSel('color', $event.target.value)" />
      <button class="btn small" @click="focusSelection" :disabled="!sel.box">⛶ 聚焦</button>
      <button class="btn small" :disabled="!sel.label" @click="clearSelection()">清除</button>
    </div>
    <SliderRow label="高亮自发光强度" v-model="glowProxy" :min="0" :max="2" :step="0.05" />
    <SliderRow label="其余变暗系数" v-model="dimProxy" :min="0.05" :max="1" :step="0.01"
      hint="仅在「其余变暗」模式生效" />

    <div class="node-summary">
      <span class="tag on">节点 {{ model.nodes.length }}</span>
      <span class="tag">树枝 {{ stats.branches }}</span>
      <span class="tag">叶片 {{ stats.leaves }}</span>
      <span class="tag">三角面 {{ fmt(stats.barkTriangles + stats.leafTriangles) }}</span>
    </div>

    <input class="input" type="search" v-model="filter" placeholder="搜索节点 (名称 / 编号 / 层级)…" />

    <div class="node-toolbar">
      <button class="btn small" @click="expandAll">{{ allOpen ? '全部折叠' : '全部展开' }}</button>
      <button class="btn small" @click="selectAll">全选可见</button>
      <span class="muted">{{ visibleGroups.length }} 组</span>
    </div>

    <div class="node-tree">
      <template v-for="g in visibleGroups" :key="g.id">
        <div class="node-row group" :class="{ selected: isGroupSelected(g) }"
          @click="clickGroup(g, $event)" @dblclick="dblGroup(g)">
          <span class="tw" @click.stop="toggle(g.id)">{{ open.has(g.id) ? '▾' : '▸' }}</span>
          <span class="ico">{{ g.icon }}</span>
          <span class="name">{{ g.name }}</span>
          <span class="badge">{{ g.count }}</span>
          <span class="tri">{{ fmt(g.stats.triangles) }}</span>
        </div>
        <template v-if="open.has(g.id)">
          <div v-for="n in visibleChildren(g)" :key="n.id" class="node-row child"
            :class="{ selected: sel.ids.includes(n.id) }"
            @click="clickNode(n, $event)" @dblclick="focusNode(n.id)">
            <span class="tw"></span>
            <span class="ico">·</span>
            <span class="name">{{ n.name }}</span>
            <span class="tri">{{ fmt(n.stats.triangles) }}</span>
          </div>
          <div v-if="hiddenChildren(g) > 0" class="node-row more">
            … 还有 {{ hiddenChildren(g) }} 个节点（用搜索缩小范围）
          </div>
          <div v-if="!g.children.length" class="node-row more">（该组暂无几何）</div>
        </template>
      </template>
      <div v-if="!visibleGroups.length" class="node-row more">没有匹配的节点</div>
    </div>
  </Section>

  <Section title="节点详情" hint="Inspector" :default-collapsed="false">
    <template v-if="activeNode">
      <div class="kv"><span class="k">名称</span><b>{{ activeNode.name }}</b></div>
      <div class="kv"><span class="k">类型</span><b>{{ typeLabel(activeNode.type) }}</b></div>
      <div class="kv"><span class="k">所属组</span><b>{{ activeNode.groupName }}</b></div>
      <div class="kv"><span class="k">父节点</span><b>{{ parentName(activeNode) }}</b></div>
      <div class="kv"><span class="k">三角面</span><b>{{ fmt(activeNode.stats.triangles) }}</b></div>
      <div class="kv"><span class="k">顶点</span><b>{{ fmt(activeNode.stats.vertices) }}</b></div>
      <div v-if="activeNode.meta.length" class="kv"><span class="k">长度</span><b>{{ activeNode.meta.length.toFixed(2) }} m</b></div>
      <div v-if="activeNode.meta.radius" class="kv"><span class="k">基部半径</span><b>{{ activeNode.meta.radius.toFixed(3) }} m</b></div>
      <div v-if="activeNode.meta.segments" class="kv"><span class="k">分段</span><b>{{ activeNode.meta.segments }}</b></div>
      <div v-if="activeNode.meta.leaves" class="kv"><span class="k">叶片数</span><b>{{ activeNode.meta.leaves }}</b></div>
      <div v-if="activeNode.bbox" class="kv">
        <span class="k">包围盒</span>
        <b>{{ boxSize(activeNode.bbox) }}</b>
      </div>
      <div class="wrap">
        <button class="btn small" @click="focusNode(activeNode.id)">⛶ 聚焦该节点</button>
        <button class="btn small" @click="onlyNode(activeNode.id)">仅显示它</button>
        <button class="btn small ghost" @click="clearSelection()">清除</button>
      </div>
    </template>
    <p v-else class="muted" style="margin: 0">
      在节点树里点选任意节点：单击=选中并高亮，双击=相机聚焦，Ctrl/Cmd+单击=多选。
      选中的节点会在视口里以高亮色描出，并显示黄色包围盒。
    </p>
    <p class="muted" style="margin: 0">
      节点结构与随机种子绑定：同一个 seed 生成同一套节点（id 顺序稳定，按组连续编号）。
    </p>
  </Section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import {
  state, getNodeModel, selectNodes, selectGroup, clearSelection, setSelectionMode,
  focusSelection, focusNode,
} from '../../store/treeStore.js'

const sel = state.selection
const stats = computed(() => state.stats)
const nodeVersion = computed(() => state.nodeVersion)
const model = computed(() => {
  void nodeVersion.value
  return getNodeModel()
})

const filter = ref('')
const open = ref(new Set(['trunk', 'branch-L1', 'branch-L2']))

const modes = [
  { id: 'highlight', name: '高亮', hint: '选中项加高亮色与自发光，其余不变' },
  { id: 'isolate', name: '仅显示选中', hint: '隐藏其它所有几何' },
  { id: 'dim', name: '其余变暗', hint: '未选中的部分变暗，便于看清结构' },
]

const glowProxy = computed({ get: () => sel.glow, set: (v) => (sel.glow = v) })
const dimProxy = computed({ get: () => sel.dim, set: (v) => (sel.dim = v) })
const MAX_CHILDREN = 300

const visibleGroups = computed(() => {
  const f = filter.value.trim().toLowerCase()
  const groups = model.value.groups || []
  if (!f) return groups
  return groups
    .map((g) => {
      const children = g.children.filter((c) => matchNode(c, f))
      const groupHit = g.name.toLowerCase().includes(f)
      if (!children.length && !groupHit) return null
      return { ...g, children: groupHit ? g.children : children }
    })
    .filter(Boolean)
})

const allOpen = computed(() => visibleGroups.value.length > 0 && visibleGroups.value.every((g) => open.value.has(g.id)))

const activeNode = computed(() => (sel.activeId == null ? null : model.value.byId.get(sel.activeId) || null))

function matchNode(c, f) {
  return c.name.toLowerCase().includes(f) || String(c.id).includes(f)
}

function fmt(n) {
  const v = Math.round(n || 0)
  return v >= 10000 ? (v / 1000).toFixed(1) + 'k' : String(v)
}

function typeLabel(t) {
  return { trunk: '树干', branch: '树枝', leaves: '树叶簇', root: '树根', material: '材质' }[t] || t
}

function parentName(n) {
  if (n.parent == null) return '—'
  const p = model.value.byId.get(n.parent)
  return p ? `${p.groupName} · ${p.name}` : '—'
}

function boxSize(bbox) {
  const d = [0, 1, 2].map((i) => (bbox.max[i] - bbox.min[i]).toFixed(2))
  return `${d[0]} × ${d[1]} × ${d[2]} m`
}

function childrenShown(g) {
  return g.children.slice(0, MAX_CHILDREN)
}
function visibleChildren(g) {
  return childrenShown(g)
}
function hiddenChildren(g) {
  return Math.max(0, g.children.length - MAX_CHILDREN)
}

function toggle(id) {
  const s = new Set(open.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  open.value = s
}

function expandAll() {
  if (allOpen.value) open.value = new Set()
  else open.value = new Set(visibleGroups.value.map((g) => g.id))
}

function isGroupSelected(g) {
  if (g.material) return sel.material === g.material
  if (!sel.ids.length) return false
  return sel.ids.length >= g.count && g.nodeIds.every((id) => sel.ids.includes(id))
}

function clickGroup(g, e) {
  selectGroup(g.id, { additive: e.ctrlKey || e.metaKey })
}

function dblGroup(g) {
  if (!g.material) selectGroup(g.id)
  focusSelection()
}

function clickNode(n, e) {
  selectNodes([n.id], { additive: e.ctrlKey || e.metaKey, activeId: n.id })
}

function onlyNode(id) {
  selectNodes([id], { activeId: id })
  setSelectionMode('isolate')
}

function selectAll() {
  const ids = []
  for (const g of visibleGroups.value) {
    if (g.material) continue
    for (const c of g.children) ids.push(c.id)
  }
  if (ids.length) selectNodes(ids, { activeId: ids[0] })
}

function setSel(key, value) {
  sel[key] = value
}

// 展开的组在过滤时自动展开，避免"搜到了但看不见"
watch(visibleGroups, (gs) => {
  if (!filter.value.trim()) return
  const s = new Set(open.value)
  for (const g of gs) s.add(g.id)
  open.value = s
})
</script>

<style scoped>
.node-summary { display: flex; flex-wrap: wrap; gap: 5px; }
.node-toolbar { display: flex; align-items: center; gap: 6px; }
.node-tree {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #0d1117;
  padding: 3px;
}
.node-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 5px;
  border-radius: 4px;
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
}
.node-row:hover { background: #171d27; }
.node-row.group { font-weight: 600; color: #d7e0ec; }
.node-row.child { padding-left: 18px; color: #b3bfcd; }
.node-row.more { color: var(--fg-dim); cursor: default; font-style: italic; }
.node-row.selected { background: #23404f; color: #eaf6ff; }
.node-row .tw { width: 10px; color: var(--fg-dim); flex: none; }
.node-row .ico { width: 14px; flex: none; }
.node-row .name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.node-row .badge {
  color: var(--accent);
  font-size: 10.5px;
  padding: 0 4px;
  border-radius: 8px;
  background: #14342a;
  flex: none;
}
.node-row .tri { color: var(--fg-dim); font-size: 10.5px; flex: none; width: 44px; text-align: right; }
.kv { display: flex; justify-content: space-between; font-size: 11.5px; gap: 8px; }
.kv b { color: var(--accent); font-weight: 600; text-align: right; }
.kv .k { color: var(--fg-dim); flex: none; }
</style>
