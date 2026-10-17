/**
 * 预设树种 + 自动生成器 (薄封装: 真正的数据在 species.js / autowind.js)
 * ------------------------------------------------------------
 * - PRESETS: 树种列表 (橡树/松树/白桦/垂柳/樱花/灌木/枯树)
 * - applyPreset(params, id, stage, season): 按"树种+生长阶段+季节"组合出参数
 * - autoGenerate(seed, chaos): 由种子推导出"生物上说得通"的随机树
 * - autoWind(seed, intensity): 自动出风向 / 强度 / 阵风等风场参数
 */
import { defaultParams, cloneParams, mergeParams } from './params.js'
import { makeRng } from './rng.js'
import { estimateScale } from './treeBuilder.js'
import {
  SPECIES, GROWTH_STAGES, SEASONS, speciesById, stageById, seasonById,
  seasonProfile, composeTree, classificationName, classificationDesc, allCombinations,
} from './species.js'
import { autoWind } from './autowind.js'

export { autoWind, classificationName, classificationDesc, allCombinations }
export { SPECIES, GROWTH_STAGES, SEASONS, speciesById, stageById, seasonById, seasonProfile, composeTree }

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

export function randomSeed() {
  return Math.floor(Math.random() * 900000000) + 1
}

/* ------------------------------------------------------------------ */
/* 树种预设 (对外保持原有接口: id/name/icon/patch)                       */
/* ------------------------------------------------------------------ */

export const PRESETS = SPECIES.map((sp) => ({
  id: sp.id,
  name: sp.name,
  icon: sp.icon,
  desc: sp.desc,
  evergreen: !!sp.evergreen,
  patch: sp.patch,
}))

/* ------------------------------------------------------------------ */
/* 预设应用 (树种 + 生长阶段 + 季节)                                     */
/* ------------------------------------------------------------------ */

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null
}

const deepCopy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/** 组合时保留"用户自己的东西": 自定义 GLSL / 上传的贴图 / 场景 / 生长 / 风偏好 */
export function preserveUserBits(next, prev) {
  if (!prev) return next
  if (prev.custom) next.custom = deepCopy(prev.custom)
  if (prev.scene) next.scene = deepCopy(prev.scene)
  if (prev.growth) next.growth = deepCopy(prev.growth)
  if (prev.lod) next.lod = deepCopy(prev.lod)
  if (prev.bark) {
    next.bark.texture = prev.bark.texture || ''
    next.bark.normalTexture = prev.bark.normalTexture || ''
  }
  if (prev.leafMat) {
    next.leafMat.texture = prev.leafMat.texture || ''
    next.leafMat.normalTexture = prev.leafMat.normalTexture || ''
    // 染色相关是用户对"贴图怎么用"的选择, 切树种/季节时不应被重置
    next.leafMat.tintMode = prev.leafMat.tintMode
    next.leafMat.vertexColorMix = prev.leafMat.vertexColorMix
    next.leafMat.alphaTest = prev.leafMat.alphaTest
    next.leafMat.emissiveColor = prev.leafMat.emissiveColor
    next.leafMat.tint = prev.leafMat.tint
  }
  if (prev.wind) {
    next.wind.enabled = prev.wind.enabled
    next.wind.auto = prev.wind.auto
    next.wind.direction = prev.wind.direction
    next.wind.intensity = prev.wind.intensity
  }
  return next
}

/**
 * 应用"树种 + 生长阶段 + 季节"预设 -> 完整参数
 * @param {object} params 当前参数 (用于保留用户设置与种子)
 * @param {string} id 树种
 * @param {string} stage 生长阶段
 * @param {string} season 季节
 */
export function applyPreset(params, id, stage = 'mature', season = 'summer') {
  const seed = params && params.seed ? params.seed : 1
  const intensity = params && params.wind ? params.wind.intensity : 0.3
  const next = composeTree(id, stage, season, seed, { windIntensity: intensity })
  return preserveUserBits(next, params)
}

/* ------------------------------------------------------------------ */
/* 树种原型 / 自动生成                                                  */
/* ------------------------------------------------------------------ */

const LEAF_PALETTES = {
  oak: ['#5d9c37', '#a3cd63'],
  maple: ['#d3712c', '#efb454'],
  birch: ['#8cc04f', '#dcec8e'],
  willow: ['#7cab41', '#b6d878'],
  pine: ['#4e8b46', '#87c26c'],
  sakura: ['#edaac4', '#f9dde6'],
  shrub: ['#5a9243', '#96c463'],
  dead: ['#7d7d6a', '#a3a38c'],
}

/* 自动生成: 一个种子 => 一棵随机但合理的树                              */
/* ------------------------------------------------------------------ */

const ARCHETYPE_IDS = ['oak', 'pine', 'birch', 'willow', 'sakura', 'shrub', 'dead']
const ARCHETYPE_WEIGHTS = [0.22, 0.16, 0.16, 0.12, 0.12, 0.12, 0.1]
// 随机时"大树/小树"更常见, 树苗与古树是少数
const STAGE_IDS = GROWTH_STAGES.map((s) => s.id)
const STAGE_WEIGHTS = [0.1, 0.16, 0.24, 0.36, 0.14]
const SEASON_IDS = SEASONS.map((s) => s.id)
const SEASON_WEIGHTS = [0.26, 0.34, 0.26, 0.14]

function weightedPick(rng, ids, weights) {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < ids.length; i++) {
    r -= weights[i]
    if (r <= 0) return ids[i]
  }
  return ids[ids.length - 1]
}

/**
 * 自动生成: 树种 × 生长阶段 × 季节 都随机抽, 再叠加 chaos 幅度的个体扰动
 * @param {number} seed
 * @param {number} chaos 0..1 混乱度 (0 = 规整, 1 = 狂野)
 * @param {string|null} forceType 指定树种
 * @param {string|null} forceStage 指定生长阶段
 * @param {string|null} forceSeason 指定季节
 */
export function autoGenerate(seed, chaos = 0.6, forceType = null, forceStage = null, forceSeason = null) {
  const rng = makeRng(seed, 'auto-tree')
  const k = Math.max(0, Math.min(1, chaos))
  const type = forceType || weightedPick(rng, ARCHETYPE_IDS, ARCHETYPE_WEIGHTS)
  const stage = forceStage || weightedPick(rng, STAGE_IDS, STAGE_WEIGHTS)
  const season = forceSeason || weightedPick(rng, SEASON_IDS, SEASON_WEIGHTS)

  // 1. 从"树种 + 阶段 + 季节"组合出发
  let params = composeTree(type, stage, season, seed, { chaos: k, windIntensity: rng.range(0.25, 0.6) })

  // 2. 再叠加 chaos 幅度的个体扰动 (阶段/季节已经定了形态与物候, 这里只做微调)
  const t = params.trunk
  t.height = +(t.height * rng.range(1 - 0.4 * k, 1 + 0.45 * k)).toFixed(3)
  t.baseRadius = +(t.baseRadius * rng.range(1 - 0.3 * k, 1 + 0.35 * k)).toFixed(4)
  t.curve = +Math.max(0, t.curve + rng.signed() * 0.35 * k).toFixed(3)
  t.lean = +(rng.signed() * 0.14 * k).toFixed(3)
  t.leanDirection = Math.round(rng.range(0, 360))
  t.gnarl = +Math.max(0, t.gnarl + rng.signed() * 0.35 * k).toFixed(3)
  t.knots = Math.max(0, Math.round(t.knots + rng.signed() * 3 * k))
  t.twist = +Math.max(-0.6, t.twist + rng.signed() * 0.3 * k).toFixed(3)

  const lv = params.branches.level.map((L) => {
    const o = { ...L }
    o.count = Math.max(1, Math.round(L.count * rng.range(1 - 0.45 * k, 1 + 0.5 * k)))
    o.pitch = +Math.max(5, Math.min(145, L.pitch + rng.signed() * 22 * k)).toFixed(2)
    o.pitchVariance = +Math.max(0, L.pitchVariance + rng.signed() * 14 * k).toFixed(2)
    o.lengthRatio = +Math.max(0.05, L.lengthRatio * rng.range(1 - 0.3 * k, 1 + 0.35 * k)).toFixed(4)
    o.lengthVariance = +Math.max(0, Math.min(0.8, L.lengthVariance + rng.signed() * 0.2 * k)).toFixed(3)
    o.radiusRatio = +Math.max(0.1, Math.min(0.9, L.radiusRatio * rng.range(1 - 0.2 * k, 1 + 0.25 * k))).toFixed(4)
    o.curve = +Math.max(0, L.curve + rng.signed() * 0.4 * k).toFixed(3)
    o.gravity = +Math.max(-0.6, Math.min(0.5, L.gravity + rng.signed() * 0.3 * k)).toFixed(3)
    o.twist = +Math.max(-0.8, Math.min(0.8, L.twist + rng.signed() * 0.3 * k)).toFixed(3)
    o.phyllotaxis = +(rng.chance(0.7) ? 137.5 : rng.range(90, 200)).toFixed(2)
    o.spread = +Math.min(1.2, L.spread + rng.signed() * 0.3 * k).toFixed(3)
    return o
  })
  params.branches.level = lv
  params.branches.levels = Math.max(1, Math.min(5, Math.round(params.branches.levels + rng.signed() * 1.4 * k)))
  params.branches.apicalDominance = +Math.max(0, Math.min(0.95, params.branches.apicalDominance + rng.signed() * 0.3 * k)).toFixed(3)
  params.branches.phototropism = +Math.max(-0.4, Math.min(0.4, params.branches.phototropism + rng.signed() * 0.15 * k)).toFixed(3)

  // 3. 树叶: 大小/密度微调 (颜色由季节决定, 这里只在同色系里做个体色差)
  const leaf = params.leaves
  if (leaf.enabled) {
    leaf.size = +Math.max(0.05, leaf.size * rng.range(1 - 0.25 * k, 1 + 0.3 * k)).toFixed(3)
    leaf.width = +Math.max(0.08, Math.min(1.4, leaf.width * rng.range(1 - 0.2 * k, 1 + 0.25 * k))).toFixed(3)
    leaf.clusterCount = Math.max(1, Math.round(leaf.clusterCount * rng.range(1 - 0.3 * k, 1 + 0.4 * k)))
    leaf.perBranch = Math.max(1, Math.round(leaf.perBranch * rng.range(1 - 0.3 * k, 1 + 0.35 * k)))
    leaf.colorVariance = +Math.min(0.7, leaf.colorVariance + rng.signed() * 0.12 * k).toFixed(3)
    leaf.pitch = +(leaf.pitch + rng.signed() * 16 * k).toFixed(2)
    leaf.droop = +Math.max(0, Math.min(1, leaf.droop + rng.signed() * 0.25 * k)).toFixed(3)
    // 少量个体的色相整体偏移 (例如某些橡树偏黄而非偏红)
    if (rng.chance(0.35)) leaf.color = rng.pick([leaf.color, leaf.colorTip])
  }

  // 4. 枯树有概率长几片残叶
  if (type === 'dead' && rng.chance(0.35)) {
    leaf.enabled = true
    leaf.levels = [false, false, true, false, false]
    leaf.perBranch = rng.int(2, 5)
    leaf.clusterCount = 1
    leaf.size = +(leaf.size * 0.6).toFixed(3)
  }

  // 5. 风场: 档位再随种子浮动一点
  params.wind = { ...params.wind, ...autoWind(seed, rng.range(0.25, 0.95)) }
  params.auto.chaos = k
  params.classify = { species: type, stage, season }
  params.seed = seed

  // 6. 叶片预算: 枝条一多, 叶子就指数爆炸, 这里按估算量回缩密度
  const est = estimateScale(params)
  const budget = 14000
  if (est.leaves > budget) {
    const scale = Math.max(1, Math.cbrt(budget / est.leaves))
    leaf.perBranch = Math.max(1, Math.round(leaf.perBranch * scale))
    leaf.clusterCount = Math.max(1, Math.round(leaf.clusterCount * scale))
  }

  return { params, type }
}

export function archetypeName(type) {
  const p = presetById(type)
  return p ? `${p.icon} ${p.name}` : type
}
