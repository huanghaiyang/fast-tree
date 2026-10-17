/**
 * 全局状态 (轻量 store, 不引入 pinia)
 */
import { reactive, computed } from 'vue'
import { defaultParams, cloneParams, normalizeParams, mergeParams } from '../core/params.js'
import { autoGenerate, autoWind, applyPreset, randomSeed, presetById, archetypeName } from '../core/presets.js'
import { SPECIES, GROWTH_STAGES, SEASONS } from '../core/species.js'
import { LEAF_CARDS, LEAF_CARD_BY_ID, leafCardsFor, leafCardRows, LEAF_CARD_BATCHES } from '../core/leafCards.generated.js'
import { selectionRanges } from '../core/treeBuilder.js'

export const state = reactive({
  // 初始参数 = 默认树种 (oak) 的成熟/夏季预设 -> 一进页面就是带果实的橡树
  params: normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer')),
  stats: {
    branches: 0, leaves: 0, barkTriangles: 0, leafTriangles: 0,
    barkVertices: 0, leafVertices: 0, buildMs: 0, height: 0, spread: 0, nodeCount: 0,
  },
  renderInfo: { calls: 0, triangles: 0 },
  // 伪装卡生成结果 + 预览开关 (主预览区显示 2D 卡片还是 3D 树)
  impostorResult: null,
  impostorBusy: false,
  impostorPreview: false,
  shaderError: '',
  busy: false,
  ready: false,
  playing: true,
  activeTab: 'auto',        // 当前参数标签页 (属性搜索跳转会改它)
  archetype: 'oak',
  autoType: null,      // 强制树种 (null = 随机)
  timeScale: 1,
  frameVersion: 0,     // 请求重新取景
  regrowToken: 0,      // 请求"重新长一遍"(只有真正生成新树时才用)
  rebuildVersion: 0,   // 请求强制重建
  materialVersion: 0,  // 请求重新编译自定义 GLSL
  nodeVersion: 0,      // 模型节点表刷新计数
  nodePanelOpen: false, // 右侧「模型节点」面板 (默认不展示)
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

/** 右侧模型节点面板 (默认收起) */
export function toggleNodePanel(force) {
  state.nodePanelOpen = force === undefined ? !state.nodePanelOpen : !!force
}

/** 从视口/别处点"节点"时: 打开面板并选中一批节点 */
export function openNodePanel(selectId) {
  state.nodePanelOpen = true
  if (selectId !== undefined && selectId !== null) selectNodes([selectId], { activeId: selectId })
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
  getWindScreenBasis: null,
  makeImpostor: null,
  setImpostorModel: null,
  rebuildNow: null,
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
  state.regrowToken++   // 这是一棵新树: 让它重新长一遍
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
  state.rebuildVersion++   // 重建并重新取景
}

/** 按"树种 + 生长阶段 + 季节"重新生成 (三维预设) */
export function applyClassification(speciesId, stageId, seasonId) {
  pushUndo()
  state.params = normalizeParams(applyPreset(state.params, speciesId, stageId, seasonId))
  state.archetype = speciesId
  state.classifySig = `${speciesId}/${stageId}/${seasonId}`
  if (state.params.wind.auto) {
    Object.assign(state.params.wind, autoWind(state.params.seed, state.params.wind.intensity))
  }
  // 大树 -> 树苗这种尺寸剧变要重新取景, 否则新树可能只有几个像素
  state.rebuildVersion++
  return state.params.classify
}

/** 随机换一组组合 (树种/阶段/季节都随机) */
/** 应用一张内置叶片卡片 (贴图 + 卡片几何 + 宽高比) */
export function applyLeafCard(cardId, opts = {}) {
  const card = LEAF_CARD_BY_ID.get(cardId)
  if (!card) return null
  pushUndo()
  const p = state.params
  p.leaves.cardMode = true
  p.leaves.cardAspect = card.aspect
  p.leafMat.texture = card.url
  p.leafMat.textureHasAlpha = true
  // 卡片是照片级贴图: 默认直接用贴图原色 (顶点色是季节调色板, 乘上去会把橙色叶子染绿)
  p.leafMat.tintMode = 'texture'
  if (opts.alphaTest !== undefined) p.leafMat.alphaTest = opts.alphaTest
  p.leafMat.alphaTest = Math.max(0.2, Math.min(0.5, p.leafMat.alphaTest || 0.35))
  state.cardId = card.id
  // 注意: 不要 bump rebuildVersion —— 它的语义是"重建 + 重新取景",
  // 换叶片贴图/叶形不该把用户正在看的视角拉回去。
  // 几何变化 (leaves.cardMode/cardAspect) 由 Viewport 的几何组 watcher 自动触发重建。
  return card
}

/** 随机换一张内置叶片卡片 (可指定批次/叶形) */
/** 生成伪装卡 (atlas = 图集伪装卡, cross = 交叉卡) */
export function doGenerateImpostor(opts = {}) {
  state.impostorBusy = true
  try {
    const res = sceneApi.makeImpostor(opts)
    state.impostorResult = res
    setImpostorPreview(true)        // 生成后自动在主预览区以 3D 面片展示 (可环绕)
    return res
  } finally {
    state.impostorBusy = false
  }
}

/** 下载伪装卡 PNG (+ 可选元信息 JSON) */
/** 切换参数标签页 (属性搜索跳转会用到) */
export function setActiveTab(tab) {
  if (tab) state.activeTab = tab
}

export function setImpostorPreview(on) {
  state.impostorPreview = !!on
  // 3D 预览: 把伪装卡作为一个 impostor 面片放进场景 (可以像模型一样环绕观察)
  if (on && state.impostorResult) {
    sceneApi.setImpostorModel(state.impostorResult)
  } else {
    sceneApi.setImpostorModel(null)
  }
}

export function downloadImpostor(withMeta = true) {
  const res = state.impostorResult
  if (!res) return false
  const a = document.createElement('a')
  a.href = res.dataUrl
  a.download = `impostor-${res.meta.mode}-${res.meta.views}v-${res.meta.size}.png`
  a.click()
  if (withMeta) {
    const blob = new Blob([JSON.stringify(res.meta, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `impostor-${res.meta.mode}-${res.meta.views}v.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 2000)
  }
  return true
}

export function randomLeafCard(batch, row) {
  const pool = LEAF_CARDS.filter((c) => (!batch || c.batch === batch) && (!row || c.row === row))
  if (!pool.length) return null
  return applyLeafCard(pool[Math.floor(Math.random() * pool.length)].id)
}

export function randomClassification() {
  const species = SPECIES[Math.floor(Math.random() * SPECIES.length)].id
  const stage = GROWTH_STAGES[Math.floor(Math.random() * GROWTH_STAGES.length)].id
  const season = SEASONS[Math.floor(Math.random() * SEASONS.length)].id
  return applyClassification(species, stage, season)
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
  window.__fastTreeApi = {
    pushUndo, doAutoGenerate, doApplyPreset, setSeed, randomizeSeed,
    doGenerateImpostor, downloadImpostor, setImpostorPreview,
    applyClassification, randomClassification, applyLeafCard, randomLeafCard,
  }
}

