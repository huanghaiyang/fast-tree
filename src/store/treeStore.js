/**
 * 全局状态 (轻量 store, 不引入 pinia)
 */
import { reactive, computed } from 'vue'
import { defaultParams, cloneParams, normalizeParams, mergeParams } from '../core/params.js'
import { autoGenerate, autoWind, applyPreset, randomSeed, presetById, archetypeName } from '../core/presets.js'
import { selectionRanges } from '../core/treeBuilder.js'

export const state = reactive({
  params: defaultParams(),
  stats: {
    branches: 0, leaves: 0, barkTriangles: 0, leafTriangles: 0,
    barkVertices: 0, leafVertices: 0, buildMs: 0, height: 0, spread: 0, nodeCount: 0,
  },
  renderInfo: { calls: 0, triangles: 0 },
  shaderError: '',
  busy: false,
  ready: false,
  playing: true,
  archetype: 'oak',
  autoType: null,      // 强制树种 (null = 随机)
  timeScale: 1,
  frameVersion: 0,     // 请求重新取景
  rebuildVersion: 0,   // 请求强制重建
  materialVersion: 0,  // 请求重新编译自定义 GLSL
  nodeVersion: 0,      // 模型节点表刷新计数
  // --- 模型节点选中 ---
  selection: {
    ids: [],           // 选中的 node id
    material: null,    // 'bark' | 'leaf' | null
    mode: 'highlight', // highlight | isolate | dim
    activeId: null,    // 详情面板展示的节点
    color: '#ffd166',
    glow: 0.35,
    dim: 0.35,
    label: '',
  },
})

/* ------------------------------------------------------------------ */
/* 模型节点表 (数量可能上千, 放在非响应式容器里, 用 nodeVersion 触发刷新)   */
/* ------------------------------------------------------------------ */
const nodeModel = { nodes: [], groups: [], byId: new Map(), groupById: new Map() }

export function getNodeModel() {
  return nodeModel
}

export function setNodeModel(model) {
  nodeModel.nodes = model.nodes || []
  nodeModel.groups = model.groups || []
  nodeModel.byId = new Map(nodeModel.nodes.map((n) => [n.id, n]))
  nodeModel.groupById = new Map(nodeModel.groups.map((g) => [g.id, g]))
  state.nodeVersion++
  // 重建后之前选中的节点可能已不存在
  const alive = new Set(nodeModel.nodes.map((n) => n.id))
  const kept = state.selection.ids.filter((id) => alive.has(id))
  if (kept.length !== state.selection.ids.length) {
    state.selection.ids = kept
    if (kept.length === 0 && !state.selection.material) state.selection.activeId = null
  }
  if (!kept.length && state.selection.material) {
    // 材质节点恒在
  }
  refreshSelectionRanges()
}

function refreshSelectionRanges() {
  const sel = state.selection
  sel.ranges = selectionRanges(sel.ids)
  sel.label = describeSelection(sel)
}

function describeSelection(sel) {
  if (!sel.ids.length && !sel.material) return ''
  const parts = []
  if (sel.material === 'bark') parts.push('材质 · 树皮')
  else if (sel.material === 'leaf') parts.push('材质 · 树叶')
  const groups = new Set()
  let single = null
  for (const id of sel.ids) {
    const n = nodeModel.byId.get(id)
    if (!n) continue
    groups.add(n.groupName)
    single = n
  }
  if (groups.size === 1 && sel.ids.length > 1) {
    const g = [...groups][0]
    parts.push(`${g} · ${sel.ids.length} 个节点`)
  } else if (sel.ids.length === 1 && single) {
    parts.push(groups.has('树干') || groups.has('树根') ? single.name : `${single.groupName} · ${single.name}`)
  } else if (sel.ids.length > 1) {
    parts.push(`${sel.ids.length} 个节点 (${groups.size} 组)`)
  }
  return parts.join(' + ')
}

export function selectNodes(ids, opts = {}) {
  const sel = state.selection
  const list = Array.isArray(ids) ? ids : [ids]
  if (opts.additive) {
    const set = new Set(sel.ids)
    for (const id of list) {
      if (set.has(id)) set.delete(id)
      else set.add(id)
    }
    sel.ids = [...set]
  } else {
    sel.ids = [...new Set(list)]
  }
  sel.material = opts.material || null
  if (opts.activeId !== undefined) sel.activeId = opts.activeId
  else sel.activeId = sel.ids.length ? sel.ids[sel.ids.length - 1] : null
  refreshSelectionRanges()
  updateSelectionBox()
}

export function selectGroup(groupId, opts = {}) {
  const g = nodeModel.groupById.get(groupId)
  if (!g) return
  if (g.material) {
    state.selection.material = g.material
    state.selection.ids = []
    state.selection.activeId = null
    refreshSelectionRanges()
    state.selection.box = g.bbox
    return
  }
  selectNodes(opts.additive && !g.material ? g.nodeIds : g.nodeIds.slice(), {
    additive: opts.additive,
    activeId: opts.activeId !== undefined ? opts.activeId : g.nodeIds[0],
  })
}

export function clearSelection() {
  const sel = state.selection
  sel.ids = []
  sel.material = null
  sel.activeId = null
  sel.ranges = []
  sel.box = null
  sel.label = ''
}

export function setSelectionMode(mode) {
  state.selection.mode = mode
}

export function focusSelection() {
  const box = state.selection.box
  if (box && sceneApi.focusBox) sceneApi.focusBox(box.min, box.max)
}

export function focusNode(nodeId) {
  const n = nodeModel.byId.get(nodeId)
  if (n && n.bbox && sceneApi.focusBox) sceneApi.focusBox(n.bbox.min, n.bbox.max)
}

function updateSelectionBox() {
  const sel = state.selection
  if (!sel.ids.length) {
    const n = sel.material ? nodeModel.groupById.get('material-' + sel.material) : null
    sel.box = n && n.bbox ? n.bbox : null
    return
  }
  let box = null
  for (const id of sel.ids) {
    const n = nodeModel.byId.get(id)
    if (!n || !n.bbox) continue
    if (!box) box = { min: [...n.bbox.min], max: [...n.bbox.max] }
    else {
      for (let i = 0; i < 3; i++) {
        if (n.bbox.min[i] < box.min[i]) box.min[i] = n.bbox.min[i]
        if (n.bbox.max[i] > box.max[i]) box.max[i] = n.bbox.max[i]
      }
    }
  }
  sel.box = box
}

/** 选中状态签名 (给 Viewport 做变更监听) */
export function selectionSignature() {
  const s = state.selection
  return [
    s.mode, s.material || '', s.color, s.glow, s.dim,
    (s.ranges || []).map((r) => r.join('-')).join(','),
    s.box ? s.box.min.join(',') + '|' + s.box.max.join(',') : '',
  ].join(';')
}

const undoStack = []
const redoStack = []
const MAX_UNDO = 40

/** 由 Viewport 注入的场景操作 (导出/截图/取景) */
export const sceneApi = {
  exportGLB: null,
  exportOBJ: null,
  screenshot: null,
  frameCamera: null,
  focusBox: null,
}

function snapshot() {
  return JSON.stringify(state.params)
}

/** 记录一次可撤销的快照 (在修改前调用) */
export function pushUndo() {
  const snap = snapshot()
  if (undoStack[undoStack.length - 1] === snap) return
  undoStack.push(snap)
  if (undoStack.length > MAX_UNDO) undoStack.shift()
  redoStack.length = 0
}

export const canUndo = computed(() => undoStack.length > 0)
export const canRedo = computed(() => redoStack.length > 0)

export function undo() {
  if (!undoStack.length) return false
  const cur = snapshot()
  const prev = undoStack.pop()
  redoStack.push(cur)
  state.params = normalizeParams(JSON.parse(prev))
  return true
}

export function redo() {
  if (!redoStack.length) return false
  const cur = snapshot()
  const next = redoStack.pop()
  undoStack.push(cur)
  state.params = normalizeParams(JSON.parse(next))
  return true
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */

export function setSeed(seed) {
  state.params.seed = Math.max(1, Math.floor(seed) || 1)
}

export function randomizeSeed() {
  pushUndo()
  state.params.seed = randomSeed()
  if (state.params.wind.auto) {
    Object.assign(state.params.wind, autoWind(state.params.seed, state.params.wind.intensity))
  }
}

export function regenerateNow() {
  state.rebuildVersion++
}

/** 由种子自动生成一棵完整的树 */
export function doAutoGenerate(opts = {}) {
  pushUndo()
  const seed = opts.seed !== undefined ? opts.seed : (randomSeed())
  const chaos = opts.chaos !== undefined ? opts.chaos : state.params.auto.chaos
  const type = opts.type !== undefined ? opts.type : state.autoType
  const { params, type: usedType } = autoGenerate(seed, chaos, type || null)
  // 保留场景/材质/自定义 GLSL 等用户设置
  const keep = {
    scene: cloneParams(state.params.scene),
    custom: cloneParams(state.params.custom),
    bark: { ...cloneParams(state.params.bark), ...pickBarkOverrides(state.params) },
    leafMat: { ...cloneParams(state.params.leafMat) },
    growth: cloneParams(state.params.growth),
    lod: cloneParams(state.params.lod),
  }
  const next = mergeParams(params, keep)
  state.params = normalizeParams(next)
  state.params.seed = seed
  state.params.auto.chaos = chaos
  state.archetype = usedType
  return usedType
}

function pickBarkOverrides(p) {
  // 保留用户自定义贴图 / 调节值, 但让预设的花纹风格生效
  const b = p.bark
  const out = {
    texture: b.texture,
    normalTexture: b.normalTexture,
    tint: b.tint,
    uvScaleU: b.uvScaleU,
    uvScaleV: b.uvScaleV,
    vertexColorMix: b.vertexColorMix,
    roughness: b.roughness,
    metalness: b.metalness,
    normalScale: b.normalScale,
    bump: b.bump,
  }
  if (b.texture) out.procedural = b.procedural
  return out
}

export function doApplyPreset(id) {
  pushUndo()
  state.params = normalizeParams(applyPreset(state.params, id))
  state.archetype = id
  if (state.params.wind.auto) {
    Object.assign(state.params.wind, autoWind(state.params.seed, state.params.wind.intensity))
  }
}

/** 风力滑杆: 自动模式下一并重算风向/阵风/湍流 */
export function setWindIntensity(v) {
  state.params.wind.intensity = v
  if (state.params.wind.auto) {
    Object.assign(state.params.wind, autoWind(state.params.seed, v))
  }
}

export function randomizeWind() {
  pushUndo()
  const dir = Math.floor(Math.random() * 360)
  const next = autoWind(Math.floor(Math.random() * 900000) + 1, state.params.wind.intensity)
  Object.assign(state.params.wind, next, { direction: dir })
}

export function setWindAuto(v) {
  state.params.wind.auto = v
  if (v) Object.assign(state.params.wind, autoWind(state.params.seed, state.params.wind.intensity))
}

export function resetSection(section) {
  pushUndo()
  const d = defaultParams()
  if (section === 'all') {
    state.params = d
    return
  }
  if (section === 'branches') {
    state.params.branches = d.branches
    return
  }
  if (state.params[section] !== undefined) {
    state.params[section] = d[section]
  }
}

export function importParamsJSON(text) {
  const data = JSON.parse(text)
  const raw = data && data.params ? data.params : data
  pushUndo()
  state.params = normalizeParams(raw)
  return state.params
}

export function applyWindAutoFromSeed() {
  Object.assign(state.params.wind, autoWind(state.params.seed, state.params.wind.intensity))
}

export const archetypeLabel = computed(() => {
  if (state.autoType) return archetypeName(state.autoType)
  return presetById(state.archetype) ? archetypeName(state.archetype) : '随机'
})

export const totalTriangles = computed(() =>
  Math.round(state.stats.barkTriangles + state.stats.leafTriangles))

// 开发期把 store 挂到 window, 方便在浏览器控制台里调试 / 脚本化验证
if (typeof window !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  window.__fastTree = state
  window.__fastTreeApi = { pushUndo, doAutoGenerate, doApplyPreset, setSeed, randomizeSeed }
}
