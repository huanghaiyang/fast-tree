/**
 * 全局状态 (轻量 store, 不引入 pinia)
 */
import { reactive, computed } from 'vue'
import { defaultParams, cloneParams, normalizeParams, mergeParams } from '../core/params.js'
import { autoGenerate, autoWind, applyPreset, randomSeed, presetById, archetypeName } from '../core/presets.js'

export const state = reactive({
  params: defaultParams(),
  stats: {
    branches: 0, leaves: 0, barkTriangles: 0, leafTriangles: 0,
    barkVertices: 0, leafVertices: 0, buildMs: 0, height: 0, spread: 0,
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
})

const undoStack = []
const redoStack = []
const MAX_UNDO = 40

/** 由 Viewport 注入的场景操作 (导出/截图/取景) */
export const sceneApi = {
  exportGLB: null,
  exportOBJ: null,
  screenshot: null,
  frameCamera: null,
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
