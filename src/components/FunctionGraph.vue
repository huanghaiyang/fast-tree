<template>
  <div class="fg-backdrop" @click.self="emit('close')">
    <div class="fg-dialog">
      <header class="fg-head">
        <div class="fg-title">
          <b>参数与调用关系图谱</b>
          <small>只读 · 自动扫描 src/core 与 src/store 生成 · {{ summary }}</small>
        </div>
        <div class="spacer"></div>
        <input class="input fg-search" v-model="query" placeholder="搜索参数 / 模块 / 函数…" />
        <button class="btn small" @click="expandAll">展开全部</button>
        <button class="btn small" @click="collapseAll">收起全部</button>
        <button class="btn small" @click="fit">适应窗口</button>
        <button class="btn small" @click="zoomBy(0.85)">－</button>
        <button class="btn small" @click="zoomBy(1.18)">＋</button>
        <button class="btn small" @click="resetView">1:1</button>
        <button class="btn small" title="关闭 (Esc)" @click="emit('close')">✕</button>
      </header>

      <div class="fg-filters">
        <span class="muted">分类</span>
        <button v-for="c in categories" :key="c" class="chip" :class="{ on: visibleCats.has(c) }"
          :style="{ borderColor: visibleCats.has(c) ? catColor(c) : undefined }" @click="toggleCat(c)">
          {{ c }} <small>{{ catCount(c) }}</small>
        </button>
        <span class="spacer"></span>
        <span class="legend"><i class="dot param"></i>参数组</span>
        <span class="legend"><i class="dot module"></i>模块</span>
        <span class="legend"><i class="dot fn"></i>函数</span>
        <span class="legend"><i class="line param"></i>参数引用</span>
        <span class="legend"><i class="line call"></i>函数调用</span>
      </div>

      <div class="fg-body">
        <div class="fg-canvas" ref="canvasRef">
          <svg ref="svgRef" class="fg-svg" @mousedown="onDown" @wheel.prevent="onWheel">
            <defs>
              <marker id="fg-arrow-call" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7"
                markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#5ac8a0" />
              </marker>
              <marker id="fg-arrow-param" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7"
                markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#7bb7ff" />
              </marker>
            </defs>
            <g :transform="`translate(${view.x},${view.y}) scale(${view.s})`">
              <!-- 边: 参数 -> 模块 -->
              <path v-for="e in paramPaths" :key="e.id" :d="e.d" class="edge param"
                :class="{ hl: isHl(e) }" marker-end="url(#fg-arrow-param)" />
              <!-- 边: 模块 <-> 模块 -->
              <path v-for="e in modulePaths" :key="e.id" :d="e.d" class="edge call"
                :class="{ hl: isHl(e) }" marker-end="url(#fg-arrow-call)" />
              <!-- 边: 函数 -> 函数 (仅展开的模块内部) -->
              <path v-for="e in fnPaths" :key="e.id" :d="e.d" class="edge call thin"
                :class="{ hl: isHl(e) }" marker-end="url(#fg-arrow-call)" />

              <!-- 参数节点 -->
              <g v-for="p in paramNodes" :key="'p-' + p.id" class="node param"
                :class="{ hl: isHl({ kind: 'param', id: p.id }), dim: !paramHit(p), sel: sel && sel.kind === 'param' && sel.id === p.id }"
                @mouseenter="hover = { kind: 'param', id: p.id }" @mouseleave="hover = null"
                @click.stop="select({ kind: 'param', id: p.id })">
                <rect :x="p.x" :y="p.y" :width="p.w" :height="p.h" rx="7" />
                <text :x="p.x + 9" :y="p.y + 19" class="name">{{ p.id }}</text>
                <text :x="p.x + p.w - 9" :y="p.y + 19" class="meta" text-anchor="end">{{ p.count }}</text>
              </g>

              <!-- 模块卡片 -->
              <g v-for="m in moduleCards" :key="'m-' + m.id" class="mod"
                :class="{ hl: isHl({ kind: 'module', id: m.id }), dim: !moduleHit(m), sel: sel && sel.kind === 'module' && sel.id === m.id }">
                <rect :x="m.x" :y="m.y" :width="m.w" :height="m.h" rx="8" class="mod-bg"
                  :style="{ stroke: catColor(m.category) }" @click.stop="select({ kind: 'module', id: m.id })" />
                <rect :x="m.x" :y="m.y" :width="m.w" height="30" rx="8" class="mod-head"
                  :style="{ fill: catColor(m.category) + '22' }"
                  @click.stop="select({ kind: 'module', id: m.id })" />
                <text :x="m.x + 10" :y="m.y + 20" class="mod-title"
                  @click.stop="toggleModule(m.id)">{{ m.expanded ? '▾' : '▸' }} {{ m.title }}</text>
                <text :x="m.x + m.w - 10" :y="m.y + 20" class="meta" text-anchor="end">{{ m.fnCount }} fn</text>
                <g v-for="f in m.fns" :key="f.id" class="fn"
                  :class="{ hl: isHl({ kind: 'fn', id: f.id }), dim: !fnHit(f), sel: sel && sel.kind === 'fn' && sel.id === f.id }"
                  @mouseenter="hover = { kind: 'fn', id: f.id }" @mouseleave="hover = null"
                  @click.stop="select({ kind: 'fn', id: f.id })">
                  <rect :x="f.x" :y="f.y" :width="f.w" :height="f.h" rx="4" />
                  <text :x="f.x + 8" :y="f.y + 13" class="fn-name">{{ f.name }}</text>
                  <circle v-if="f.paramCount" :cx="f.x + f.w - 26" :cy="f.y + 9" r="2.6" class="pdot" />
                  <text :x="f.x + f.w - 8" :y="f.y + 13" class="meta" text-anchor="end">{{ f.callCount }}</text>
                </g>
              </g>
            </g>
          </svg>
          <div class="fg-hint">滚轮缩放 · 拖拽平移 · 点击节点查看详情</div>
        </div>

        <!-- 详情面板 -->
        <aside class="fg-detail">
          <template v-if="sel && sel.kind === 'param' && selectedParam">
            <div class="d-head">
              <span class="k">参数组</span>
              <h3>{{ selectedParam.id }}</h3>
              <span class="muted">{{ selectedParam.fields.length }} 个字段 · {{ groupFnCount(selectedParam.id) }} 个函数引用</span>
            </div>
            <div class="d-sec">
              <div class="d-sub">字段</div>
              <div class="d-list fields">
                <div v-for="f in selectedParam.fields" :key="f.path" class="row">
                  <span class="mono">{{ f.path }}</span><span class="val">{{ f.value }}</span>
                </div>
              </div>
            </div>
            <div class="d-sec">
              <div class="d-sub">引用的函数</div>
              <div class="d-list">
                <button v-for="r in groupRefs(selectedParam.id)" :key="r.fnId" class="linkrow" @click="gotoFn(r.fnId)">
                  <span>{{ fnLabel(r.fnId) }}</span><small>{{ r.keys.join(', ') }}</small>
                </button>
                <div v-if="!groupRefs(selectedParam.id).length" class="muted pad">
                  该参数组暂未检测到直接引用（可能经局部变量间接传递）。
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="sel && sel.kind === 'module' && selectedModule">
            <div class="d-head">
              <span class="k">模块 · {{ selectedModule.category }}</span>
              <h3>{{ selectedModule.title }}</h3>
              <span class="muted">{{ selectedModule.file }}</span>
              <span class="muted">{{ selectedModule.functions.length }} 个函数</span>
            </div>
            <div class="d-sec">
              <div class="d-sub">调用关系</div>
              <div class="kv">
                <span>出向</span><b>{{ moduleOut(selectedModule.id).length }}</b>
                <span>入向</span><b>{{ moduleIn(selectedModule.id).length }}</b>
              </div>
              <div class="d-list">
                <button v-for="e in moduleOut(selectedModule.id)" :key="'o' + e.to" class="linkrow"
                  @click="gotoModule(e.to)">
                  <span>→ {{ moduleTitle(e.to) }}</span><small>{{ e.count }} 次</small>
                </button>
                <button v-for="e in moduleIn(selectedModule.id)" :key="'i' + e.from" class="linkrow"
                  @click="gotoModule(e.from)">
                  <span>← {{ moduleTitle(e.from) }}</span><small>{{ e.count }} 次</small>
                </button>
              </div>
            </div>
            <div class="d-sec">
              <div class="d-sub">函数</div>
              <div class="d-list">
                <button v-for="f in selectedModule.functions" :key="f.id" class="linkrow" @click="gotoFn(f.id)">
                  <span>{{ f.name }} <small v-if="f.exported" class="exp">export</small></span>
                  <small>L{{ f.line }} · {{ f.calls.length }}c</small>
                </button>
              </div>
            </div>
          </template>

          <template v-else-if="sel && sel.kind === 'fn' && selectedFn">
            <div class="d-head">
              <span class="k">{{ moduleTitle(selectedFn.module) }}</span>
              <h3>{{ selectedFn.name }}</h3>
              <span class="muted mono">{{ selectedFn.file }}:{{ selectedFn.line }}</span>
            </div>
            <div class="d-sec">
              <div class="kv">
                <span>调用</span><b>{{ callersOf(selectedFn.id).length }}</b>
                <span>被调用</span><b>{{ calleesOf(selectedFn.id).length }}</b>
                <span>参数引用</span><b>{{ fnRefs(selectedFn.id).length }}</b>
              </div>
            </div>
            <div class="d-sec">
              <div class="d-sub">调用的函数</div>
              <div class="d-list">
                <button v-for="id in calleesOf(selectedFn.id)" :key="'c' + id" class="linkrow" @click="gotoFn(id)">
                  <span>{{ fnLabel(id) }}</span>
                </button>
                <div v-if="!calleesOf(selectedFn.id).length" class="muted pad">无（或只调用未纳入扫描的外部 API）。</div>
              </div>
            </div>
            <div class="d-sec">
              <div class="d-sub">被这些函数调用</div>
              <div class="d-list">
                <button v-for="id in callersOf(selectedFn.id)" :key="'p' + id" class="linkrow" @click="gotoFn(id)">
                  <span>{{ fnLabel(id) }}</span>
                </button>
                <div v-if="!callersOf(selectedFn.id).length" class="muted pad">没有被 core/store 内的函数调用。</div>
              </div>
            </div>
            <div class="d-sec">
              <div class="d-sub">引用的参数</div>
              <div class="d-list">
                <div v-for="r in fnRefs(selectedFn.id)" :key="r.group + r.key" class="row">
                  <span class="mono">{{ r.group }}</span><span class="val">{{ r.key === '*' ? '(整组)' : r.key }}</span>
                </div>
                <div v-if="!fnRefs(selectedFn.id).length" class="muted pad">未检测到直接引用（参数可能由调用方传入）。</div>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="d-empty">
              <b>点击任一节点查看详情</b>
              <p>左侧蓝色节点是参数组，右侧卡片是源码模块。展开模块可查看内部函数，节点右侧数字为被调用次数。</p>
              <p>数据由 <span class="mono">scripts/gen-graph.mjs</span> 自动扫描生成，只读，不可编辑。</p>
              <div class="muted">覆盖 {{ dataStats.modules }} 个模块 · {{ dataStats.functions }} 个函数 · {{ dataStats.params }} 组参数 · {{ dataStats.callEdges }} 条调用边 · {{ dataStats.paramEdges }} 条参数引用</div>
              <div class="muted">静态数据文件（labelIndex / leafCards / leafCardAspects / graphData）为生成资源，不绘制为模块。</div>
              <div class="muted">源码改动后运行 <span class="mono">npm run graph</span> 重新生成图谱数据。</div>
            </div>
          </template>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { GRAPH_DATA } from '../core/graphData.generated.js'

const emit = defineEmits(['close'])

/* ------------------------- 静态索引 (模块加载时构建一次) ------------------------- */
const DATA = GRAPH_DATA
const MODULE_BY_ID = new Map(DATA.modules.map((m) => [m.id, m]))
const FN_BY_ID = new Map()
for (const m of DATA.modules) {
  for (const f of m.functions) FN_BY_ID.set(f.id, { ...f, module: m.id, file: m.file })
}
const FN_PARAM_REFS = new Map()
for (const e of DATA.paramEdges) {
  if (!FN_PARAM_REFS.has(e.to)) FN_PARAM_REFS.set(e.to, [])
  FN_PARAM_REFS.get(e.to).push({ group: e.group, key: e.key })
}
// 参数组 -> 函数引用 (按函数聚合 key)
const GROUP_REFS = new Map()
for (const e of DATA.paramEdges) {
  if (!GROUP_REFS.has(e.group)) GROUP_REFS.set(e.group, new Map())
  const m = GROUP_REFS.get(e.group)
  if (!m.has(e.to)) m.set(e.to, new Set())
  m.get(e.to).add(e.key)
}
// 参数组 -> 目标模块 (画聚合边用)
const GROUP_TARGET_MODULES = new Map()
for (const e of DATA.paramEdges) {
  const fn = FN_BY_ID.get(e.to)
  if (!fn) continue
  if (!GROUP_TARGET_MODULES.has(e.group)) GROUP_TARGET_MODULES.set(e.group, new Map())
  const m = GROUP_TARGET_MODULES.get(e.group)
  m.set(fn.module, (m.get(fn.module) || 0) + 1)
}
// 函数调用: 调用者/被调用者/模块级聚合
const CALLEES = new Map()
const CALLERS = new Map()
const MODULE_EDGES = new Map()
for (const e of DATA.callEdges) {
  if (!CALLEES.has(e.from)) CALLEES.set(e.from, new Set())
  CALLEES.get(e.from).add(e.to)
  if (!CALLERS.has(e.to)) CALLERS.set(e.to, new Set())
  CALLERS.get(e.to).add(e.from)
  const a = FN_BY_ID.get(e.from)?.module
  const b = FN_BY_ID.get(e.to)?.module
  if (!a || !b || a === b) continue
  const key = `${a}>${b}`
  if (!MODULE_EDGES.has(key)) MODULE_EDGES.set(key, { from: a, to: b, count: 0 })
  MODULE_EDGES.get(key).count++
}

const CATEGORY_ORDER = ['参数与预设', '几何生成', '材质与贴图', '场景与风', '导出与统计', '应用与接口', '其他']
const CATEGORIES = CATEGORY_ORDER.filter((c) => DATA.modules.some((m) => m.category === c))
const CAT_COLORS = {
  参数与预设: '#7bb7ff',
  几何生成: '#5ac8a0',
  材质与贴图: '#c792ea',
  场景与风: '#ffb454',
  导出与统计: '#ff8f8f',
  应用与接口: '#9ecbff',
  其他: '#8d99ab',
}
const catColor = (c) => CAT_COLORS[c] || CAT_COLORS['其他']

const dataStats = {
  modules: DATA.modules.length,
  functions: FN_BY_ID.size,
  params: DATA.params.length,
  callEdges: DATA.callEdges.length,
  paramEdges: DATA.paramEdges.length,
}
const summary = `已扫描 ${dataStats.modules} 个模块 / ${dataStats.functions} 个函数 / ${dataStats.params} 组参数`

/* ------------------------- 交互状态 ------------------------- */
const query = ref('')
const hover = ref(null)
const sel = ref(null)
const expanded = reactive(new Set())
const visibleCats = reactive(new Set(CATEGORIES))
const view = reactive({ x: 20, y: 20, s: 1 })
const canvasRef = ref(null)

/* ------------------------- 过滤 ------------------------- */
const q = computed(() => query.value.trim().toLowerCase())
const matchParam = (p) => !q.value || p.id.toLowerCase().includes(q.value) ||
  GROUP_REFS.get(p.id) && [...GROUP_REFS.get(p.id).keys()].some((fn) => {
    const f = FN_BY_ID.get(fn)
    return f && f.name.toLowerCase().includes(q.value)
  })
// 注意: 这里收到的是布局后的卡片对象 (只有 id/category), 需要用 MODULE_BY_ID 取回
// 真正的模块数据再匹配函数名; 直接读 m.functions 会 undefined 崩溃。
const matchModule = (m) => {
  if (!q.value) return true
  if (m.id.toLowerCase().includes(q.value) || (m.title || '').toLowerCase().includes(q.value)) return true
  const mod = MODULE_BY_ID.get(m.id)
  return !!mod && mod.functions.some((f) => f.name.toLowerCase().includes(q.value))
}
const fnMatches = (f) => {
  if (!q.value) return true
  if (f.name.toLowerCase().includes(q.value)) return true
  const fn = FN_BY_ID.get(f.id)
  return !!fn && fn.module.toLowerCase().includes(q.value)
}

function paramHit(p) { return matchParam(p) }
function moduleHit(m) { return visibleCats.has(m.category) && matchModule(m) }
function fnHit(f) { return fnMatches(f) }

watch(q, (v) => {
  if (!v) return
  // 搜索命中函数时自动展开所在模块, 让命中项可见
  for (const m of DATA.modules) {
    if (m.functions.some((f) => f.name.toLowerCase().includes(v))) expanded.add(m.id)
  }
})

/* ------------------------- 布局 (参数列 + 分类列) ------------------------- */
const PARAM_W = 180
const PARAM_H = 28
const PARAM_GAP = 7
const CARD_W = 216
const CARD_GAP = 16
const COL_GAP = 34
const HEAD_H = 30

const layout = computed(() => {
  const params = DATA.params.map((p, i) => ({
    id: p.id, x: 16, y: 20 + i * (PARAM_H + PARAM_GAP), w: PARAM_W, h: PARAM_H,
    count: GROUP_REFS.get(p.id) ? GROUP_REFS.get(p.id).size : 0,
  }))
  const paramBottom = 20 + DATA.params.length * (PARAM_H + PARAM_GAP)
  let x = 16 + PARAM_W + COL_GAP
  const cards = []
  for (const cat of CATEGORIES) {
    if (!visibleCats.has(cat)) continue
    const mods = DATA.modules.filter((m) => m.category === cat)
    if (!mods.length) continue
    let y = 20
    for (const m of mods) {
      const isExp = expanded.has(m.id)
      const fns = isExp ? m.functions.map((f, i) => ({
        id: f.id,
        name: f.name,
        x: x + 8,
        y: y + HEAD_H + 6 + i * 22,
        w: CARD_W - 16,
        h: 18,
        callCount: CALLEES.get(f.id)?.size || 0,
        paramCount: FN_PARAM_REFS.get(f.id)?.length || 0,
      })) : []
      const h = HEAD_H + (isExp ? 6 + fns.length * 22 + 8 : 10)
      cards.push({
        id: m.id, title: m.title, category: m.category,
        x, y, w: CARD_W, h, fnCount: m.functions.length, expanded: isExp, fns,
      })
      y += h + CARD_GAP
    }
    x += CARD_W + COL_GAP
  }
  const cardById = new Map(cards.map((c) => [c.id, c]))
  return { params, paramBottom, cards, cardById, width: x + 20, height: Math.max(paramBottom, ...cards.map((c) => c.y + c.h), 300) + 40 }
})

const paramNodes = computed(() => layout.value.params)
const moduleCards = computed(() => layout.value.cards)

/* ------------------------- 边 ------------------------- */
function curveH(x1, y1, x2, y2, bend = 0.5) {
  const dx = Math.max(40, Math.abs(x2 - x1) * bend)
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
}

const paramPaths = computed(() => {
  const out = []
  const L = layout.value
  for (const p of L.params) {
    const targets = GROUP_TARGET_MODULES.get(p.id)
    if (!targets) continue
    for (const [modId, count] of targets) {
      const c = L.cardById.get(modId)
      if (!c) continue
      out.push({
        id: `pm:${p.id}:${modId}`,
        kind: 'param', from: p.id, to: modId, count,
        d: curveH(p.x + p.w, p.y + p.h / 2, c.x, c.y + Math.min(HEAD_H, c.h) / 2 + (c.h > HEAD_H ? 0 : 2)),
      })
    }
  }
  return out
})

const modulePaths = computed(() => {
  const out = []
  const L = layout.value
  for (const e of MODULE_EDGES.values()) {
    const a = L.cardById.get(e.from)
    const b = L.cardById.get(e.to)
    if (!a || !b) continue
    const x1 = a.x + a.w
    const y1 = a.y + Math.min(HEAD_H, a.h) / 2
    const x2 = b.x
    const y2 = b.y + Math.min(HEAD_H, b.h) / 2
    const d = x2 >= x1
      ? curveH(x1, y1, x2, y2, 0.5)
      : `M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`
    out.push({ id: `mm:${e.from}:${e.to}`, kind: 'module', from: e.from, to: e.to, count: e.count, d })
  }
  return out
})

const fnPaths = computed(() => {
  const out = []
  const L = layout.value
  for (const c of L.cards) {
    if (!c.expanded) continue
    const rows = new Map(c.fns.map((f) => [f.id, f]))
    for (const f of c.fns) {
      const targets = CALLEES.get(f.id)
      if (!targets) continue
      for (const to of targets) {
        const t = rows.get(to)
        if (!t) continue
        const x = f.x + f.w
        const y1 = f.y + f.h / 2
        const y2 = t.y + t.h / 2
        const bulge = 14 + Math.abs(y2 - y1) * 0.12
        out.push({
          id: `ff:${f.id}:${to}`, kind: 'fn', from: f.id, to,
          d: `M${x},${y1} C${x + bulge},${y1} ${x + bulge},${y2} ${x},${y2}`,
        })
      }
    }
  }
  return out
})

/* ------------------------- 高亮 ------------------------- */
/** 当前悬停/选中节点关联的模块集合, 用于跨层高亮 (参数->模块、函数->所属模块)。 */
function relatedModules(node) {
  if (!node) return new Set()
  if (node.kind === 'param') return new Set([...(GROUP_TARGET_MODULES.get(node.id)?.keys() || [])])
  if (node.kind === 'module') return new Set([node.id])
  if (node.kind === 'fn') return new Set([FN_BY_ID.get(node.id)?.module].filter(Boolean))
  return new Set()
}

function isHl(e) {
  const h = hover.value || sel.value
  if (!h) return false
  const mods = relatedModules(h)
  if (e.kind === 'param') return h.kind === 'param' ? e.from === h.id : mods.has(e.to)
  if (e.kind === 'module') return mods.has(e.from) || mods.has(e.to)
  if (e.kind === 'fn') {
    if (h.kind === 'fn') return e.from === h.id || e.to === h.id
    const a = FN_BY_ID.get(e.from)?.module
    const b = FN_BY_ID.get(e.to)?.module
    return mods.has(a) || mods.has(b)
  }
  return false
}

/* ------------------------- 详情访问器 ------------------------- */
const selectedParam = computed(() => sel.value?.kind === 'param' ? DATA.params.find((p) => p.id === sel.value.id) : null)
const selectedModule = computed(() => sel.value?.kind === 'module' ? MODULE_BY_ID.get(sel.value.id) : null)
const selectedFn = computed(() => sel.value?.kind === 'fn' ? FN_BY_ID.get(sel.value.id) : null)

const moduleTitle = (id) => MODULE_BY_ID.get(id)?.title || id
const moduleOut = (id) => [...MODULE_EDGES.values()].filter((e) => e.from === id)
const moduleIn = (id) => [...MODULE_EDGES.values()].filter((e) => e.to === id)
const fnRefs = (id) => FN_PARAM_REFS.get(id) || []
const calleesOf = (id) => [...(CALLEES.get(id) || [])]
const callersOf = (id) => [...(CALLERS.get(id) || [])]
const fnLabel = (id) => {
  const f = FN_BY_ID.get(id)
  return f ? `${moduleTitle(f.module)} · ${f.name}` : id
}
const groupFnCount = (g) => GROUP_REFS.get(g)?.size || 0
const groupRefs = (g) => {
  const m = GROUP_REFS.get(g)
  if (!m) return []
  return [...m.entries()].map(([fnId, keys]) => ({ fnId, keys: [...keys].sort() }))
}

/* ------------------------- 选择/跳转 ------------------------- */
function select(s) { sel.value = s }
function toggleModule(id) {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
}
function gotoModule(id) {
  if (!visibleCats.has(MODULE_BY_ID.get(id)?.category)) visibleCats.add(MODULE_BY_ID.get(id).category)
  expanded.add(id)
  sel.value = { kind: 'module', id }
}
function gotoFn(id) {
  const m = FN_BY_ID.get(id)?.module
  if (!m) return
  const cat = MODULE_BY_ID.get(m)?.category
  if (cat && !visibleCats.has(cat)) visibleCats.add(cat)
  expanded.add(m)
  sel.value = { kind: 'fn', id }
}

/* ------------------------- 分类过滤 ------------------------- */
const catCount = (c) => DATA.modules.filter((m) => m.category === c).length
function toggleCat(c) {
  if (visibleCats.has(c)) visibleCats.delete(c)
  else visibleCats.add(c)
}
function expandAll() { for (const m of DATA.modules) expanded.add(m.id); nextTick(fit) }
function collapseAll() { expanded.clear(); nextTick(fit) }

/* ------------------------- 缩放/平移 ------------------------- */
function zoomBy(f) {
  const el = canvasRef.value
  const rect = el ? el.getBoundingClientRect() : { width: 800, height: 600 }
  const cx = rect.width / 2
  const cy = rect.height / 2
  const gx = (cx - view.x) / view.s
  const gy = (cy - view.y) / view.s
  const s = Math.min(2.6, Math.max(0.12, view.s * f))
  view.s = s
  view.x = cx - gx * s
  view.y = cy - gy * s
}
function fit() {
  const el = canvasRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const L = layout.value
  const s = Math.min(rect.width / L.width, rect.height / L.height, 1)
  view.s = Math.max(0.12, s * 0.96)
  view.x = Math.max(12, (rect.width - L.width * view.s) / 2)
  view.y = Math.max(12, (rect.height - L.height * view.s) / 2)
}
function resetView() {
  view.s = 1
  view.x = 20
  view.y = 20
}

let pan = null
function onDown(e) {
  if (e.button !== 0) return
  // 点击节点由各自 @click.stop 处理; 这里只在空白处开始平移
  const tgt = e.target
  if (!(tgt.classList && tgt.classList.contains('fg-svg'))) return
  pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
function onMove(e) {
  if (!pan) return
  view.x = pan.vx + (e.clientX - pan.x)
  view.y = pan.vy + (e.clientY - pan.y)
}
function onUp() {
  pan = null
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
}
function onWheel(e) {
  const el = canvasRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const gx = (px - view.x) / view.s
  const gy = (py - view.y) / view.s
  const f = e.deltaY < 0 ? 1.12 : 1 / 1.12
  const s = Math.min(2.6, Math.max(0.12, view.s * f))
  view.s = s
  view.x = px - gx * s
  view.y = py - gy * s
}

/* 打开时自动适应窗口; Esc 关闭; 组件销毁时清理监听 */
let fitted = false
function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  requestAnimationFrame(() => { if (!fitted) { fitted = true; fit() } })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
})
</script>

<style scoped>
.fg-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(4, 7, 11, 0.72);
  backdrop-filter: blur(2px);
  display: flex;
}
.fg-dialog {
  margin: auto;
  width: min(1720px, 96vw);
  height: 92vh;
  background: #0d1117;
  border: 1px solid var(--line-2);
  border-radius: 10px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, #151a22, #10141a);
  flex-wrap: wrap;
}
.fg-title { display: flex; flex-direction: column; gap: 1px; }
.fg-title b { font-size: 14px; }
.fg-title small { color: var(--fg-dim); font-size: 11px; }
.fg-head .spacer { flex: 1; }
.fg-search { width: 230px; }

.fg-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  color: var(--fg-dim);
  flex-wrap: wrap;
}
.fg-filters .spacer { flex: 1; }
.chip {
  background: #131922;
  border: 1px solid var(--line-2);
  color: var(--fg-dim);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 11px;
  cursor: pointer;
}
.chip.on { color: var(--fg); background: #1a2331; }
.chip small { opacity: 0.6; }
.legend { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }
.dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.dot.param { background: #7bb7ff; }
.dot.module { background: #5ac8a0; }
.dot.fn { background: #9aa7b8; }
.line { width: 16px; height: 0; border-top: 2px solid; display: inline-block; }
.line.param { border-color: rgba(123, 183, 255, 0.55); }
.line.call { border-color: rgba(90, 200, 160, 0.55); }

.fg-body { flex: 1; display: flex; min-height: 0; }
.fg-canvas { position: relative; flex: 1; min-width: 0; background: #0a0e14; overflow: hidden; }
.fg-svg { width: 100%; height: 100%; display: block; cursor: grab; }
.fg-svg:active { cursor: grabbing; }
.fg-hint {
  position: absolute; left: 12px; bottom: 10px;
  color: var(--fg-dim); font-size: 11px;
  background: rgba(10, 14, 20, 0.75); padding: 3px 8px; border-radius: 5px;
  pointer-events: none;
}

/* --- SVG 节点 --- */
.edge { fill: none; stroke-width: 1.4; opacity: 0.34; pointer-events: none; transition: opacity 0.1s, stroke-width 0.1s; }
.edge.param { stroke: #7bb7ff; }
.edge.call { stroke: #5ac8a0; }
.edge.thin { stroke-width: 1; opacity: 0.28; }
.edge.hl { opacity: 0.95; stroke-width: 2; }

.node.param rect { fill: #142133; stroke: #2f4d6b; }
.node.param .name { fill: #cfe2ff; font-size: 12px; font-weight: 600; }
.node.param .meta { fill: #7bb7ff; font-size: 10px; }
.node.param.hl rect { fill: #1b2f49; stroke: #7bb7ff; }
.node.param.sel rect { stroke: #7bb7ff; stroke-width: 2; }

.mod-bg { fill: #11161e; stroke-width: 1; opacity: 0.95; }
.mod-head { stroke: none; }
.mod-title { fill: var(--fg); font-size: 12px; font-weight: 600; cursor: pointer; }
.mod .meta { fill: var(--fg-dim); font-size: 10px; }
.mod.hl .mod-bg { fill: #16202b; }
.mod.sel .mod-bg { stroke-width: 2; }
.mod.dim, .node.dim, .fn.dim { opacity: 0.2; }

.fn rect { fill: #151c26; stroke: #223042; }
.fn-name { fill: #c3cedd; font-size: 11px; }
.fn .meta { fill: #66758a; font-size: 9px; }
.fn .pdot { fill: #7bb7ff; opacity: 0.8; }
.fn.hl rect { fill: #1c2a3a; stroke: #5ac8a0; }
.fn.sel rect { stroke: #5ac8a0; stroke-width: 1.6; }

/* --- 详情 --- */
.fg-detail {
  width: 320px;
  border-left: 1px solid var(--line);
  background: #0e131a;
  overflow-y: auto;
  padding: 12px;
  flex-shrink: 0;
}
.d-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
.d-head .k { color: var(--accent-2); font-size: 11px; }
.d-head h3 { margin: 0; font-size: 15px; word-break: break-all; }
.d-head .muted { font-size: 11px; }
.d-sec { margin-bottom: 12px; }
.d-sub { font-size: 11px; color: var(--fg-dim); margin-bottom: 5px; }
.d-list { display: flex; flex-direction: column; gap: 3px; max-height: 260px; overflow-y: auto; }
.d-list.fields { max-height: 320px; }
.row {
  display: flex; justify-content: space-between; gap: 8px;
  padding: 3px 6px; background: #131922; border-radius: 4px;
  font-size: 11px;
}
.row .mono { color: #9ecbff; word-break: break-all; }
.row .val { color: var(--fg-dim); text-align: right; word-break: break-all; }
.linkrow {
  display: flex; justify-content: space-between; gap: 8px;
  background: #131922; border: 1px solid transparent; border-radius: 4px;
  padding: 4px 6px; color: var(--fg); font-size: 11px; cursor: pointer; text-align: left;
}
.linkrow:hover { border-color: #2f4d6b; background: #17202b; }
.linkrow small { color: var(--fg-dim); }
.exp { color: var(--accent); }
.kv { display: flex; gap: 10px; align-items: center; font-size: 11px; color: var(--fg-dim); margin-bottom: 6px; }
.kv b { color: var(--fg); }
.muted { color: var(--fg-dim); }
.pad { padding: 6px; font-size: 11px; }
.d-empty { font-size: 12px; color: var(--fg-dim); display: flex; flex-direction: column; gap: 8px; }
.d-empty b { color: var(--fg); }
.d-empty p { margin: 0; line-height: 1.7; }
.mono { font-family: ui-monospace, Consolas, monospace; }
</style>
