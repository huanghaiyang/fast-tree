/**
 * 预设树种 + 自动生成器
 * ------------------------------------------------------------
 * - PRESETS: 手工调好的树种
 * - autoGenerate(seed, chaos): 由种子推导出"生物上说得通"的随机树
 * - autoWind(seed, intensity): 自动出风向 / 强度 / 阵风等风场参数
 */
import { defaultParams, defaultLevel, cloneParams, mergeParams, MAX_LEVELS } from './params.js'
import { makeRng } from './rng.js'
import { estimateScale } from './treeBuilder.js'

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

export function randomSeed() {
  return Math.floor(Math.random() * 900000000) + 1
}

function levels(...patches) {
  const arr = []
  for (let i = 0; i < MAX_LEVELS; i++) {
    const base = defaultLevel(i)
    arr.push(patches[i] ? { ...base, ...patches[i] } : base)
  }
  return arr
}

/* ------------------------------------------------------------------ */
/* 自动风场: 风向 / 强度 / 阵风 / 湍流 / 抖动量                         */
/* ------------------------------------------------------------------ */
export function autoWind(seed, intensity = 0.5) {
  const rng = makeRng(seed, 'auto-wind')
  const k = Math.max(0, Math.min(1, intensity))
  const dir = Math.round(rng.range(0, 360))
  // 主风向附近 ±35° 内做一次"副风向"扰动
  const gusty = 0.15 + k * 0.75 + rng.range(-0.08, 0.12)
  return {
    enabled: true,
    auto: true,
    intensity: k,
    direction: dir,
    strength: +(0.06 + k * 0.85 * rng.range(0.75, 1.25)).toFixed(3),
    speed: +(0.55 + k * 1.5 * rng.range(0.8, 1.2)).toFixed(3),
    frequency: +(0.7 + k * 1.8 * rng.range(0.8, 1.25)).toFixed(3),
    gust: +Math.max(0, Math.min(1, gusty)).toFixed(3),
    gustSpeed: +(0.08 + k * 0.45 * rng.range(0.7, 1.3)).toFixed(3),
    turbulence: +(0.08 + k * 0.72 * rng.range(0.75, 1.25)).toFixed(3),
    spatialScale: +(0.12 + k * 0.55 * rng.range(0.8, 1.2)).toFixed(3),
    flexFalloff: +(1.9 - k * 0.85).toFixed(3),
    barkSway: +(0.45 + k * 0.85).toFixed(3),
    leafFlutter: +(0.35 + k * 2.0 * rng.range(0.85, 1.2)).toFixed(3),
    leafTwist: +(0.2 + k * 1.4 * rng.range(0.8, 1.2)).toFixed(3),
    timeScale: 1.0,
  }
}

/* ------------------------------------------------------------------ */
/* 树种原型                                                            */
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

export const PRESETS = [
  {
    id: 'oak', name: '橡树', icon: '🌳',
    patch: () => ({
      trunk: { height: 10.5, baseRadius: 0.52, taper: 0.08, curve: 0.42, gnarl: 0.45, flare: 1.1, knots: 3, radialSegments: 12 },
      branches: {
        levels: 3, apicalDominance: 0.42, phototropism: 0.06,
        level: levels(
          { count: 5, pitch: 58, pitchVariance: 14, lengthRatio: 0.46, radiusRatio: 0.44, gravity: 0.10, segments: 10, radialSegments: 8, curve: 0.34 },
          { count: 4, pitch: 50, lengthRatio: 0.58, radiusRatio: 0.5, gravity: 0.0, segments: 7 },
          { count: 4, pitch: 45, lengthRatio: 0.62, radiusRatio: 0.52, gravity: -0.05, segments: 5 },
        ),
      },
      leaves: { enabled: true, levels: [false, false, true, true, false], size: 0.5, width: 0.85, shape: 'maple', clusterCount: 3, perBranch: 10, color: LEAF_PALETTES.oak[0], colorTip: LEAF_PALETTES.oak[1] },
      bark: { color: '#5b4630', color2: '#7d6244', procedural: { style: 'rough', scale: 1.1, contrast: 0.6 } },
    }),
  },
  {
    id: 'pine', name: '松树', icon: '🌲',
    patch: () => ({
      trunk: { height: 11, baseRadius: 0.42, taper: 0.06, radiusCurve: 1.5, curve: 0.06, gnarl: 0.14, radialSegments: 11 },
      roots: { enabled: true, count: 6, length: 0.18 },
      branches: {
        levels: 3, apicalDominance: 0.8, phototropism: -0.08, gravityScale: 1.1,
        level: levels(
          { count: 14, pitch: 76, pitchVariance: 12, lengthRatio: 0.3, lengthVariance: 0.22, radiusRatio: 0.3, gravity: -0.12, startT: 0.06, endT: 0.95, upBias: -0.06, phyllotaxis: 137.5, spread: 0.1, segments: 5, radialSegments: 5, curve: 0.3, windGain: 0.5 },
          { count: 5, pitch: 56, lengthRatio: 0.46, radiusRatio: 0.4, gravity: -0.16, segments: 4, startT: 0.15, spread: 0.3 },
          { count: 4, pitch: 48, lengthRatio: 0.52, radiusRatio: 0.46, gravity: -0.2, segments: 3, spread: 0.4 },
        ),
      },
      leaves: {
        enabled: true, levels: [true, true, true, false, false],
        size: 0.5, width: 0.3, shape: 'needle',
        clusterCount: 5, clusterRadius: 0.26, clusterSpread: 1.0, perBranch: 6,
        startT: 0.22, pitch: -8, pitchVariance: 30, droop: 0.18,
        color: LEAF_PALETTES.pine[0], colorTip: LEAF_PALETTES.pine[1], translucency: 0.18,
      },
      bark: { color: '#5a4030', color2: '#7d5b41', procedural: { style: 'pine', scale: 0.8, contrast: 0.7 } },
      leafMat: { roughness: 0.75, translucency: 0.18 },
    }),
  },
  {
    id: 'birch', name: '白桦', icon: '🌿',
    patch: () => ({
      trunk: { height: 12, baseRadius: 0.22, taper: 0.3, radiusCurve: 1.05, curve: 0.3, gnarl: 0.1, radialSegments: 9 },
      branches: {
        levels: 3, phototropism: 0.12, apicalDominance: 0.3,
        level: levels(
          { count: 8, pitch: 52, pitchVariance: 12, lengthRatio: 0.3, lengthVariance: 0.2, radiusRatio: 0.3, gravity: -0.02, segments: 7, radialSegments: 5, curve: 0.5, curveVariance: 0.5 },
          { count: 5, pitch: 46, lengthRatio: 0.45, radiusRatio: 0.4, gravity: -0.05, segments: 5 },
          { count: 3, pitch: 42, lengthRatio: 0.55, radiusRatio: 0.5, gravity: -0.05, segments: 4 },
        ),
      },
      leaves: { enabled: true, levels: [false, true, true, true, true], size: 0.28, width: 0.7, shape: 'birch', clusterCount: 2, perBranch: 11, color: LEAF_PALETTES.birch[0], colorTip: LEAF_PALETTES.birch[1] },
      bark: { color: '#d8d3c4', color2: '#a9a396', roughness: 0.72, procedural: { style: 'birch', scale: 1.0, contrast: 0.75 } },
    }),
  },
  {
    id: 'willow', name: '垂柳', icon: '🍃',
    patch: () => ({
      trunk: { height: 8.5, baseRadius: 0.45, taper: 0.14, curve: 0.5, gnarl: 0.3, radialSegments: 11 },
      branches: {
        levels: 3, gravityScale: 1.6, phototropism: 0.16,
        level: levels(
          { count: 6, pitch: 72, pitchVariance: 16, lengthRatio: 0.44, radiusRatio: 0.4, gravity: -0.1, segments: 9, curve: 0.28 },
          { count: 4, pitch: 44, lengthRatio: 0.62, radiusRatio: 0.44, gravity: -0.34, segments: 8, curve: 0.2, lengthVariance: 0.3 },
          { count: 2, pitch: 36, lengthRatio: 0.5, radiusRatio: 0.5, gravity: -0.42, segments: 6, curve: 0.15 },
        ),
      },
      leaves: { enabled: true, levels: [false, true, true, true, true], size: 0.4, width: 0.22, shape: 'lance', perBranch: 12, clusterCount: 2, pitch: -22, droop: 0.55, color: LEAF_PALETTES.willow[0], colorTip: LEAF_PALETTES.willow[1] },
      bark: { color: '#4f4230', color2: '#6d5c44', procedural: { style: 'rough', scale: 1.2, contrast: 0.45 } },
    }),
  },
  {
    id: 'sakura', name: '樱花', icon: '🌸',
    patch: () => ({
      trunk: { height: 5.2, baseRadius: 0.34, taper: 0.2, curve: 0.55, gnarl: 0.5, knots: 3, flare: 0.8, radialSegments: 10 },
      branches: {
        levels: 3, apicalDominance: 0.28, phototropism: 0.02,
        level: levels(
          { count: 5, pitch: 66, pitchVariance: 18, lengthRatio: 0.5, radiusRatio: 0.42, gravity: -0.04, curve: 0.55, curveVariance: 0.5, segments: 9 },
          { count: 4, pitch: 52, lengthRatio: 0.6, radiusRatio: 0.46, gravity: -0.1, curve: 0.6, segments: 7 },
          { count: 3, pitch: 48, lengthRatio: 0.6, radiusRatio: 0.5, gravity: -0.12, curve: 0.6, segments: 5 },
        ),
      },
      leaves: { enabled: true, levels: [false, true, true, true, true], size: 0.3, width: 0.8, shape: 'oval', clusterCount: 4, perBranch: 12, color: LEAF_PALETTES.sakura[0], colorTip: LEAF_PALETTES.sakura[1], colorVariance: 0.18, translucency: 0.6 },
      bark: { color: '#5a4438', color2: '#7a5c4c', procedural: { style: 'smooth', scale: 1.0, contrast: 0.35 } },
      leafMat: { translucency: 0.6, roughness: 0.5 },
    }),
  },
  {
    id: 'shrub', name: '灌木', icon: '🪴',
    patch: () => ({
      trunk: { height: 1.6, baseRadius: 0.14, taper: 0.35, segments: 6, curve: 0.5, gnarl: 0.5, flare: 0.5 },
      roots: { enabled: true, count: 4, length: 0.3 },
      branches: {
        levels: 3, apicalDominance: 0.1, phototropism: 0.1,
        level: levels(
          { count: 7, pitch: 58, pitchVariance: 22, lengthRatio: 0.55, radiusRatio: 0.45, gravity: 0.06, startT: 0.0, endT: 0.9, segments: 6 },
          { count: 5, pitch: 50, lengthRatio: 0.6, radiusRatio: 0.5, gravity: 0.0, startT: 0.05, segments: 5 },
          { count: 4, pitch: 46, lengthRatio: 0.6, radiusRatio: 0.55, gravity: -0.05, segments: 4 },
        ),
      },
      leaves: { enabled: true, levels: [true, true, true, true, false], size: 0.24, width: 0.8, shape: 'oval', clusterCount: 3, perBranch: 8, color: LEAF_PALETTES.shrub[0], colorTip: LEAF_PALETTES.shrub[1] },
    }),
  },
  {
    id: 'dead', name: '枯树', icon: '🪵',
    patch: () => ({
      trunk: { height: 8, baseRadius: 0.42, taper: 0.06, curve: 0.6, curveVariance: 0.6, gnarl: 0.85, twist: 0.4, knots: 5, knotSize: 0.5, flare: 1.2 },
      roots: { enabled: true, count: 7, length: 0.26, curve: 0.7 },
      branches: {
        levels: 4, phototropism: -0.05, gravityScale: 1.3,
        level: levels(
          { count: 6, pitch: 60, pitchVariance: 26, lengthRatio: 0.42, radiusRatio: 0.4, gravity: -0.12, curve: 0.55, curveVariance: 0.7, segments: 10, startT: 0.15, endT: 0.98 },
          { count: 4, pitch: 48, pitchVariance: 30, lengthRatio: 0.6, radiusRatio: 0.44, gravity: -0.2, curve: 0.6, curveVariance: 0.8, segments: 8 },
          { count: 3, pitch: 42, lengthRatio: 0.6, radiusRatio: 0.5, gravity: -0.25, curve: 0.6, segments: 6 },
          { count: 2, pitch: 38, lengthRatio: 0.6, radiusRatio: 0.5, gravity: -0.2, curve: 0.6, segments: 4 },
        ),
      },
      leaves: { enabled: false, levels: [false, false, false, false, false] },
      bark: { color: '#57493a', color2: '#6f6152', roughness: 0.95, procedural: { style: 'rough', scale: 1.4, contrast: 0.8 } },
    }),
  },
]

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null
}

/** 应用预设 -> 返回新的完整参数 */
export function applyPreset(params, id) {
  const preset = presetById(id)
  if (!preset) return cloneParams(params)
  return mergeParams(params, preset.patch())
}

/* ------------------------------------------------------------------ */
/* 自动生成: 一个种子 => 一棵随机但合理的树                              */
/* ------------------------------------------------------------------ */

const ARCHETYPE_IDS = ['oak', 'pine', 'birch', 'willow', 'sakura', 'shrub', 'dead']
const ARCHETYPE_WEIGHTS = [0.22, 0.16, 0.16, 0.12, 0.12, 0.12, 0.1]

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
 * @param {number} seed
 * @param {number} chaos 0..1 混乱度 (0 = 规整, 1 = 狂野)
 * @param {string|null} forceType 指定树种
 */
export function autoGenerate(seed, chaos = 0.6, forceType = null) {
  const rng = makeRng(seed, 'auto-tree')
  const k = Math.max(0, Math.min(1, chaos))
  const type = forceType || weightedPick(rng, ARCHETYPE_IDS, ARCHETYPE_WEIGHTS)

  // 1. 从原型出发
  let params = applyPreset(defaultParams(), type)

  // 2. 用种子做"个体差异": 每个原型都有 ±k 幅度的扰动
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

  // 3. 树叶: 从调色板里再挑一次, 大小/密度扰动
  const pal = LEAF_PALETTES[type] || LEAF_PALETTES.oak
  const leaf = params.leaves
  leaf.size = +Math.max(0.05, leaf.size * rng.range(1 - 0.35 * k, 1 + 0.4 * k)).toFixed(3)
  leaf.width = +Math.max(0.08, Math.min(1.4, leaf.width * rng.range(1 - 0.25 * k, 1 + 0.3 * k))).toFixed(3)
  leaf.clusterCount = Math.max(1, Math.round(leaf.clusterCount * rng.range(1 - 0.4 * k, 1 + 0.5 * k)))
  leaf.perBranch = Math.max(1, Math.round(leaf.perBranch * rng.range(1 - 0.4 * k, 1 + 0.4 * k)))
  leaf.color = rng.chance(0.75) ? pal[0] : rng.pick(['#4a7a2c', '#3d6b34', '#6f8f3a', '#8a9b3f', '#b5713a'])
  leaf.colorTip = pal[1]
  leaf.pitch = +(leaf.pitch + rng.signed() * 20 * k).toFixed(2)
  leaf.droop = +Math.max(0, Math.min(1, leaf.droop + rng.signed() * 0.3 * k)).toFixed(3)

  // 4. 枯树有概率长几片残叶
  if (type === 'dead' && rng.chance(0.35)) {
    leaf.enabled = true
    leaf.levels = [false, false, true, false, false]
    leaf.perBranch = rng.int(2, 5)
    leaf.clusterCount = 1
    leaf.size = +(leaf.size * 0.6).toFixed(3)
  }

  // 5. 风场也自动
  params.wind = { ...params.wind, ...autoWind(seed, rng.range(0.25, 0.95)) }
  params.auto.chaos = k

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
