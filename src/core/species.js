/**
 * 树种 × 生长阶段 × 季节
 * ------------------------------------------------------------
 * 三个正交维度组合出一套完整参数:
 *   树种 (species): 形态基因 (分叉方式/枝角/叶形/树皮/调色板)
 *   生长阶段 (stage): 个体发育 (树苗 → 幼树 → 小树 → 大树 → 古树)
 *   季节 (season): 物候 (春芽 / 夏盛 / 秋色 / 冬枯, 含落叶与常绿例外)
 * 同一个"树种+阶段+季节"配不同种子 = 同一个种群里的不同个体 (variation 控制形态空间)。
 *
 * 参考图组 (橡树) 提炼出的形态要点:
 *   - 主干粗壮且**短** (约占总高 1/3), 根部明显外扩
 *   - 在 1/3 高度附近**分成 2~4 条主枝** (重点! 图 4/6/8 都是低分叉)
 *   - 低位大枝: 长、粗, 先外展再趋于平伸 (拱形)
 *   - 树冠比高度**宽** (活橡树尤其夸张), 末梢细枝密集, 叶片成簇挂在枝梢
 *   - 叶形为羽状裂叶 (用 maple 轮廓近似), 秋色红/橙/黄, 冬季仍有枯叶残留 (marcescence)
 */
import { defaultParams, cloneParams, mergeParams, MAX_LEVELS, defaultLevel } from './params.js'
import { makeRng } from './rng.js'
import { estimateScale } from './treeBuilder.js'
import { autoWind } from './autowind.js'

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function levels(...patches) {
  const arr = []
  for (let i = 0; i < MAX_LEVELS; i++) {
    const base = defaultLevel(i)
    arr.push(patches[i] ? { ...base, ...patches[i] } : base)
  }
  return arr
}

/* ------------------------------------------------------------------ */
/* 生长阶段 (个体发育)                                                  */
/* ------------------------------------------------------------------ */
/**
 * size/radius 是相对"该树种成熟个体"的倍率, 其余是形态修正:
 *  - levelOffset  层级数偏移 (小树分枝层级少)
 *  - countScale   每级枝条数量倍率
 *  - lengthScale  枝条长度倍率
 *  - leafScale/leafDensity 叶片大小 / 叶簇密度倍率
 *  - gnarlScale   不规则度 (小树更光滑)
 *  - forkMul      分叉主枝数的倍率 (0 = 还不分叉)
 *  - apicalAdd    顶端优势加成 (小树更"笔直向上")
 *  - radiusCurveAdd / taperScale 树干胖瘦与锥度 (小树更细更锥)
 *  - rootMul      根系强度
 */
export const GROWTH_STAGES = [
  {
    id: 'seedling', name: '树苗', icon: '🌱', years: '当年生',
    desc: '一根细主干 + 几片叶: 还没开始分枝',
    size: 0.13, radius: 0.055, levelOffset: -2, countScale: 0.34, lengthScale: 0.55,
    leafScale: 0.55, leafDensity: 0.5, gnarlScale: 0.12, forkMul: 0, apicalAdd: 0.32,
    radiusCurveAdd: 0.4, taperScale: 2.6, rootMul: 0.5,
  },
  {
    id: 'sapling', name: '幼树', icon: '🌿', years: '1~3 年',
    desc: '主干明显, 第一轮侧枝开始出现',
    size: 0.3, radius: 0.16, levelOffset: -1, countScale: 0.55, lengthScale: 0.72,
    leafScale: 0.7, leafDensity: 0.68, gnarlScale: 0.3, forkMul: 0, apicalAdd: 0.22,
    radiusCurveAdd: 0.24, taperScale: 1.8, rootMul: 0.7,
  },
  {
    id: 'young', name: '小树', icon: '🌳', years: '3~10 年',
    desc: '树冠成型, 开始出现主枝分化',
    size: 0.55, radius: 0.44, levelOffset: -1, countScale: 0.8, lengthScale: 0.86,
    leafScale: 0.86, leafDensity: 0.85, gnarlScale: 0.55, forkMul: 0.6, apicalAdd: 0.1,
    radiusCurveAdd: 0.12, taperScale: 1.35, rootMul: 0.85,
  },
  {
    id: 'mature', name: '大树', icon: '🌳', years: '10~60 年',
    desc: '该树种的典型形态: 完整层级 + 分叉主枝',
    size: 1, radius: 1, levelOffset: 0, countScale: 1, lengthScale: 1,
    leafScale: 1, leafDensity: 1, gnarlScale: 1, forkMul: 1, apicalAdd: 0,
    radiusCurveAdd: 0, taperScale: 1, rootMul: 1,
  },
  {
    id: 'ancient', name: '古树', icon: '🪵', years: '60 年以上',
    desc: '主干更粗、更矮壮, 分叉更多更扭曲, 树冠更开展',
    size: 1.32, radius: 1.6, levelOffset: 1, countScale: 1.08, lengthScale: 1.1,
    leafScale: 1.04, leafDensity: 1.02, gnarlScale: 1.75, forkMul: 1.4, apicalAdd: -0.14,
    radiusCurveAdd: 0.28, taperScale: 1.2, rootMul: 1.25,
  },
]

/* ------------------------------------------------------------------ */
/* 季节 (物候)                                                         */
/* ------------------------------------------------------------------ */

export const SEASONS = [
  {
    id: 'spring', name: '春', icon: '🌸', desc: '新芽初展: 叶小而稀、嫩绿透光',
    leafDensity: 0.6, leafScale: 0.78, colorVariance: 0.3, translucency: 0.62,
    palette: ['#7cbf4a', '#8fcf5c', '#a8d96a'], tipPalette: ['#c6e98a', '#dff3ab'],
    barkTint: '#ffffff',
  },
  {
    id: 'summer', name: '夏', icon: '☀️', desc: '枝繁叶茂: 叶厚色深、透光低',
    leafDensity: 1, leafScale: 1.05, colorVariance: 0.2, translucency: 0.42,
    palette: ['#3f7a2a', '#4f8c31', '#57993a'], tipPalette: ['#7fbf4f', '#95cd66'],
    barkTint: '#ffffff',
  },
  {
    id: 'autumn', name: '秋', icon: '🍂', desc: '秋色叶: 红/橙/黄明显, 叶片略稀',
    leafDensity: 0.9, leafScale: 0.98, colorVariance: 0.5, translucency: 0.58,
    palette: ['#b8431c', '#cc6a1e', '#d98b25', '#a8481a'], tipPalette: ['#e5ae3a', '#f0d060'],
    barkTint: '#ffe9cf',
  },
  {
    id: 'winter', name: '冬', icon: '❄️', desc: '落叶期: 只剩少量枯叶 (橡树等有残留叶), 常绿树种例外',
    leafDensity: 0.14, leafScale: 0.62, colorVariance: 0.26, translucency: 0.16,
    palette: ['#6b4a2a', '#7d5a30', '#8a6134'], tipPalette: ['#9c7546', '#7a5730'],
    barkTint: '#e8eef6',
  },
]

/* ------------------------------------------------------------------ */
/* 树种                                                                */
/* ------------------------------------------------------------------ */

const OAK_FORK = { count: 3, height: 0.33, angle: 27, spread: 0.85, radiusScale: 0.66, lengthScale: 1.0, taper: 0.3, curve: 0.45, gravity: 0.03 }

export const SPECIES = [
  {
    /* 参考图: 白橡/红橡的树形 + 活橡树的开张 + 羽状裂叶 + 秋色红橙 + 冬留枯叶 */
    id: 'oak', name: '橡树', icon: '🌳',
    desc: '低分叉、粗壮、树冠开张的阔叶乔木 (白橡 / 红橡 / 活橡)',
    evergreen: false,
    fork: OAK_FORK,
    // 个体差异幅度: 同一树种配不同种子时"长得不一样"的范围
    variation: {
      height: 0.3, radius: 0.26, curve: 0.32, lean: 0.12, gnarl: 0.42,
      crown: 0.95, count: 0.28, leaf: 0.26, fork: 0.28, trunkShare: 0.16,
    },
    seasonal: {
      autumn: { palette: ['#b8431c', '#cc5a1a', '#d97f22', '#a33517'], tipPalette: ['#e8a836', '#f0c95a'] },
      winter: { leafDensity: 0.2, palette: ['#6b4a2a', '#7d5a30'], tipPalette: ['#9c7546'] },
    },
    patch: () => ({
      trunk: {
        height: 11.5, baseRadius: 0.56, taper: 0.09, radiusCurve: 1.5,
        segments: 16, radialSegments: 16, curve: 0.3, curveVariance: 0.45,
        lean: 0.05, leanDirection: 20, twist: 0.12, gnarl: 0.8,
        flare: 1.5, flareHeight: 0.18, knots: 4, knotSize: 0.32, squash: 1.0, capBase: true,
        fork: { ...OAK_FORK, enabled: true },
      },
      // 板根贴着地面向外铺 (原来 pitch 116° 是往地下扎, 所以几乎看不见)
      roots: { enabled: true, count: 7, length: 0.2, lengthVariance: 0.32, radiusRatio: 0.42, spread: 1.0, pitch: 96, segments: 6, radialSegments: 6, curve: 0.75, sink: 0.18 },
      branches: {
        levels: 4, apicalDominance: 0.3, phototropism: 0.03, gravityScale: 1.15,
        lengthScale: 1.0, radiusScale: 1.0, startSpread: 0,
        level: levels(
          {
            count: 4, pitch: 66, pitchVariance: 14, lengthRatio: 0.6, lengthVariance: 0.2,
            radiusRatio: 0.5, radiusVariance: 0.14, startT: 0.16, endT: 0.82, startJitter: 0.05,
            taper: 0.34, radiusCurve: 1.3, curve: 0.52, curveVariance: 0.5, gravity: 0.14,
            twist: 0.25, upBias: 0.12, phyllotaxis: 137.5, spread: 0.55,
            segments: 12, radialSegments: 8, windGain: 0.5,
          },
          {
            count: 4, pitch: 52, pitchVariance: 16, lengthRatio: 0.6, lengthVariance: 0.22,
            radiusRatio: 0.5, radiusVariance: 0.14, startT: 0.2, endT: 0.95, startJitter: 0.06,
            taper: 0.36, radiusCurve: 1.25, curve: 0.55, curveVariance: 0.55, gravity: -0.06,
            upBias: 0.08, spread: 0.6, segments: 8, radialSegments: 6, windGain: 0.7,
          },
          {
            count: 4, pitch: 46, pitchVariance: 18, lengthRatio: 0.58, lengthVariance: 0.24,
            radiusRatio: 0.46, startT: 0.25, endT: 1.0, startJitter: 0.07,
            taper: 0.4, curve: 0.5, gravity: -0.14, upBias: 0.04, spread: 0.7,
            segments: 6, radialSegments: 4, windGain: 0.9,
          },
          {
            count: 3, pitch: 42, pitchVariance: 20, lengthRatio: 0.58, lengthVariance: 0.26,
            radiusRatio: 0.5, startT: 0.3, endT: 1.0, startJitter: 0.08,
            taper: 0.45, curve: 0.45, gravity: -0.16, spread: 0.8,
            segments: 4, radialSegments: 3, windGain: 1.0,
          },
        ),
      },
      leaves: {
        enabled: true, levels: [false, false, true, true, true],
        perBranch: 9, clusterCount: 4, clusterRadius: 0.2, clusterSpread: 0.75,
        size: 0.44, sizeVariance: 0.3, width: 0.72, shape: 'oak', segments: 6,
        curl: 0.16, fold: 0.3, startT: 0.42, endT: 1.0,
        pitch: -26, pitchVariance: 30, droop: 0.3, rollVariance: 180, faceUp: 0.55,
        twist: 0.22, color: '#4f8330', colorTip: '#8dbf52', colorVariance: 0.24, petiole: 0.1,
        shapeMix: [{ shape: 'oak', weight: 5 }, { shape: 'oval', weight: 1 }],
      },
      bark: {
        color: '#6f6250', color2: '#9c8b74', roughness: 0.92, metalness: 0.0,
        uvScaleU: 1.0, uvScaleV: 0.55, bump: 1.2, normalScale: 1.1,
        procedural: { enabled: true, style: 'rough', scale: 1.25, contrast: 0.72 },
      },
      fruit: {
        enabled: true, type: 'acorn',
        levels: [false, false, true, true, false],
        perBranch: 2, clusterCount: 2, clusterRadius: 0.07,
        size: 0.15, sizeVariance: 0.22, droop: 0.55,
        color: '#c9a86b', capColor: '#8a6f45', colorVariance: 0.16, maxCount: 380, chance: 0.5, radial: 8,
      },
      leafMat: { roughness: 0.72, metalness: 0.0, translucency: 0.5, emissive: 0.02 },
    }),
  },
  {
    id: 'pine', name: '松树', icon: '🌲',
    desc: '轮生侧枝 + 针叶, 常绿, 塔形',
    evergreen: true,
    variation: { height: 0.26, radius: 0.22, curve: 0.6, lean: 0.1, gnarl: 0.4, crown: 0.5, count: 0.3, leaf: 0.2 },
    seasonal: {
      winter: { leafDensity: 0.92, palette: ['#3c6f3a', '#4d8347'], colorVariance: 0.18 },
      autumn: { leafDensity: 0.98, palette: ['#4a8443', '#5f9a4f'], colorVariance: 0.2 },
      spring: { leafDensity: 0.9, palette: ['#5aa04a', '#7bbb62'], translucency: 0.28 },
    },
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
        color: '#4e8b46', colorTip: '#87c26c', colorVariance: 0.2,
      },
      bark: { color: '#5a4030', color2: '#7d5b41', procedural: { enabled: true, style: 'pine', scale: 0.8, contrast: 0.7 } },
      leafMat: { roughness: 0.75, translucency: 0.18 },
    }),
  },
  {
    id: 'birch', name: '白桦', icon: '🌿',
    desc: '细高白干、稀疏透光的树冠, 秋色金黄',
    evergreen: false,
    variation: { height: 0.3, radius: 0.24, curve: 0.5, lean: 0.16, gnarl: 0.3, crown: 0.5, count: 0.3, leaf: 0.22 },
    seasonal: {
      autumn: { palette: ['#d9a827', '#e8c24a', '#c98f1e'], tipPalette: ['#f2dc7a', '#e8c24a'], leafDensity: 0.82 },
      winter: { leafDensity: 0.04 },
      spring: { palette: ['#8fc45a', '#b7d97e'], leafDensity: 0.7 },
    },
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
      leaves: { enabled: true, levels: [false, true, true, true, true], size: 0.28, width: 0.7, shape: 'birch', clusterCount: 2, perBranch: 11, color: '#8cc04f', colorTip: '#dcec8e', colorVariance: 0.22 },
      bark: { color: '#d8d3c4', color2: '#a9a396', roughness: 0.72, procedural: { enabled: true, style: 'birch', scale: 1.0, contrast: 0.75 } },
    }),
  },
  {
    id: 'willow', name: '垂柳', icon: '🍃',
    desc: '强下垂的细长枝条 + 披针叶',
    evergreen: false,
    variation: { height: 0.28, radius: 0.24, curve: 0.5, lean: 0.18, gnarl: 0.35, crown: 0.4, count: 0.3, leaf: 0.24 },
    seasonal: {
      autumn: { palette: ['#c9a52c', '#d9bb4a'], leafDensity: 0.7 },
      winter: { leafDensity: 0.02 },
      spring: { palette: ['#9ccb5c', '#c3e08a'], translucency: 0.68 },
    },
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
      leaves: { enabled: true, levels: [false, true, true, true, true], size: 0.4, width: 0.22, shape: 'lance', perBranch: 12, clusterCount: 2, pitch: -22, droop: 0.55, color: '#7cab41', colorTip: '#b6d878', colorVariance: 0.2 },
      bark: { color: '#4f4230', color2: '#6d5c44', procedural: { enabled: true, style: 'rough', scale: 1.2, contrast: 0.45 } },
    }),
  },
  {
    id: 'sakura', name: '樱花', icon: '🌸',
    desc: '矮壮多曲枝, 春季满树粉花',
    evergreen: false,
    variation: { height: 0.26, radius: 0.24, curve: 0.5, lean: 0.14, gnarl: 0.45, crown: 0.7, count: 0.28, leaf: 0.22 },
    seasonal: {
      spring: { name: '春 (花)', leafDensity: 1.05, leafScale: 1.0, palette: ['#edaac4', '#f4c3d6', '#f9dde6'], tipPalette: ['#fbe8ef', '#f6d0de'], colorVariance: 0.16, translucency: 0.72, desc: '满树花: 叶密、粉白、高透光' },
      summer: { palette: ['#4e8b3a', '#79b055'], leafDensity: 0.95, translucency: 0.5 },
      autumn: { palette: ['#c8641f', '#e0a13c'], leafDensity: 0.85 },
      winter: { leafDensity: 0.03 },
    },
    patch: () => ({
      trunk: { height: 5.2, baseRadius: 0.34, taper: 0.2, curve: 0.55, gnarl: 0.5, knots: 3, flare: 0.8, radialSegments: 10 },
      branches: {
        levels: 3, apicalDominance: 0.28, phototropism: 0.02, gravityScale: 1.15,
        level: levels(
          { count: 5, pitch: 66, pitchVariance: 18, lengthRatio: 0.5, radiusRatio: 0.42, gravity: -0.04, curve: 0.55, curveVariance: 0.5, segments: 9 },
          { count: 4, pitch: 52, lengthRatio: 0.6, radiusRatio: 0.46, gravity: -0.1, curve: 0.6, segments: 7 },
          { count: 3, pitch: 48, lengthRatio: 0.6, radiusRatio: 0.5, gravity: -0.12, curve: 0.6, segments: 5 },
        ),
      },
      // 樱花的花朵用"喇叭/钟形"轮廓 (没有照片卡片时的程序化花形)
      leaves: {
        enabled: true, levels: [false, true, true, true, true], size: 0.34, width: 0.85,
        shape: 'trumpet', flower3d: true, flowerLobes: 5, flowerThickness: 0.05,
        shapeMix: [{ shape: 'trumpet', weight: 3 }, { shape: 'bell', weight: 1 }, { shape: 'oval', weight: 1 }],
        clusterCount: 2, perBranch: 6,
        color: '#edaac4', colorTip: '#f9dde6', colorVariance: 0.18, translucency: 0.65,
      },
      bark: { color: '#5a4438', color2: '#7a5c4c', procedural: { enabled: true, style: 'smooth', scale: 1.0, contrast: 0.35 } },
      leafMat: { translucency: 0.6, roughness: 0.5 },
    }),
  },
  {
    id: 'shrub', name: '灌木', icon: '🪴',
    desc: '无明显主干, 从基部分出多枝',
    evergreen: false,
    variation: { height: 0.3, radius: 0.26, curve: 0.5, lean: 0.1, gnarl: 0.45, crown: 0.6, count: 0.32, leaf: 0.25 },
    seasonal: {
      autumn: { palette: ['#b8621f', '#d99a2c'], leafDensity: 0.85 },
      winter: { leafDensity: 0.06 },
    },
    patch: () => ({
      trunk: { height: 1.6, baseRadius: 0.14, taper: 0.35, segments: 6, curve: 0.5, gnarl: 0.5, flare: 0.5, fork: { enabled: true, count: 3, height: 0.16, angle: 34, radiusScale: 0.7, lengthScale: 1.05, taper: 0.42, curve: 0.5 } },
      roots: { enabled: true, count: 4, length: 0.3 },
      branches: {
        levels: 3, apicalDominance: 0.1, phototropism: 0.1,
        level: levels(
          { count: 7, pitch: 58, pitchVariance: 22, lengthRatio: 0.55, radiusRatio: 0.45, gravity: 0.06, startT: 0.0, endT: 0.9, segments: 6 },
          { count: 5, pitch: 50, lengthRatio: 0.6, radiusRatio: 0.5, gravity: 0.0, startT: 0.05, segments: 5 },
          { count: 4, pitch: 46, lengthRatio: 0.6, radiusRatio: 0.55, gravity: -0.05, segments: 4 },
        ),
      },
      leaves: { enabled: true, levels: [true, true, true, true, false], size: 0.24, width: 0.8, shape: 'oval', clusterCount: 3, perBranch: 8, color: '#5a9243', colorTip: '#96c463', colorVariance: 0.24 },
    }),
  },
  {
    id: 'dead', name: '枯树', icon: '🪵',
    desc: '无叶的枯朽老树: 强烈扭曲与节瘤',
    evergreen: false,
    bare: true,
    variation: { height: 0.3, radius: 0.28, curve: 0.5, lean: 0.16, gnarl: 0.5, crown: 0.6, count: 0.3 },
    seasonal: {},
    patch: () => ({
      trunk: { height: 8, baseRadius: 0.42, taper: 0.06, curve: 0.6, curveVariance: 0.6, gnarl: 0.85, twist: 0.4, knots: 5, knotSize: 0.5, flare: 1.2, fork: { enabled: true, count: 2, height: 0.42, angle: 30, radiusScale: 0.6, lengthScale: 0.9, taper: 0.22, curve: 0.6, gravity: -0.05 } },
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
      bark: { color: '#57493a', color2: '#6f6152', roughness: 0.95, procedural: { enabled: true, style: 'rough', scale: 1.4, contrast: 0.8 } },
    }),
  },
]

export function speciesById(id) {
  return SPECIES.find((s) => s.id === id) || null
}

export function stageById(id) {
  return GROWTH_STAGES.find((s) => s.id === id) || null
}

export function seasonById(id) {
  return SEASONS.find((s) => s.id === id) || null
}

/** 某个树种在某个季节的物候 (树种可覆盖全局季节设定) */
export function seasonProfile(species, seasonId) {
  const base = seasonById(seasonId) || SEASONS[1]
  const over = (species && species.seasonal && species.seasonal[seasonId]) || null
  return over ? { ...base, ...over } : { ...base }
}

/* ------------------------------------------------------------------ */
/* 组合                                                                */
/* ------------------------------------------------------------------ */

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const r4 = (v) => +v.toFixed(4)

function applyVariation(p, sp, rng) {
  const v = sp.variation || {}
  const t = p.trunk
  t.height = r4(t.height * rng.range(1 - (v.height || 0), 1 + (v.height || 0)))
  t.baseRadius = r4(t.baseRadius * rng.range(1 - (v.radius || 0), 1 + (v.radius || 0)))
  t.curve = r4(Math.max(0, t.curve + rng.signed() * (v.curve || 0) * 0.5))
  t.lean = r4(rng.signed() * (v.lean || 0))
  t.leanDirection = Math.round(rng.range(0, 360))
  t.gnarl = r4(Math.max(0, t.gnarl * rng.range(1 - (v.gnarl || 0) * 0.5, 1 + (v.gnarl || 0) * 0.6)))
  t.twist = r4(t.twist + rng.signed() * 0.2)
  t.knots = Math.max(0, Math.round(t.knots + rng.signed() * 3))
  if (t.fork && t.fork.enabled) {
    t.fork.count = Math.round(clampNum(t.fork.count * rng.range(1 - (v.fork || 0), 1 + (v.fork || 0)), 2, 6))
    t.fork.height = r4(clampNum(t.fork.height * rng.range(1 - (v.trunkShare || 0), 1 + (v.trunkShare || 0)), 0.12, 0.6))
    t.fork.angle = r4(t.fork.angle * rng.range(0.8, 1.2))
  }
  // 树冠开张度: 同一个树种也会有个体差异 (直立型 vs 开张型, 参考图 6 vs 图 4)
  const crown = rng.range(-1, 1) * (v.crown || 0)
  p.branches.level = p.branches.level.map((L, i) => {
    const o = { ...L }
    // 深层级的扰动要收敛, 否则 4 层连乘会把个体差放大成"畸形树"
    const damp = 1 / (1 + i * 0.6)
    o.count = Math.max(1, Math.round(L.count * rng.range(1 - (v.count || 0) * damp, 1 + (v.count || 0) * damp)))
    o.pitch = r4(clampNum(L.pitch + crown * 16 * damp + rng.signed() * 8 * damp, 4, 150))
    o.pitchVariance = r4(Math.max(0, L.pitchVariance + rng.signed() * 6))
    o.lengthRatio = r4(Math.max(0.05, L.lengthRatio * rng.range(1 - (v.crown || 0) * 0.3 * damp, 1 + (v.crown || 0) * 0.35 * damp)))
    o.lengthVariance = r4(clampNum(L.lengthVariance + rng.signed() * 0.12, 0, 0.75))
    o.radiusRatio = r4(clampNum(L.radiusRatio * rng.range(0.9, 1.12), 0.1, 0.9))
    o.curve = r4(Math.max(0, L.curve + rng.signed() * 0.25))
    o.gravity = r4(clampNum(L.gravity + rng.signed() * 0.16 * damp - crown * (i === 0 ? 0.08 : 0.03), -0.7, 0.5))
    o.upBias = r4(L.upBias - crown * 0.06 * damp)
    o.segments = Math.max(3, Math.round(L.segments))
    return o
  })
  p.branches.apicalDominance = r4(clampNum(p.branches.apicalDominance + rng.signed() * 0.12, 0, 0.95))
  p.branches.phototropism = r4(clampNum(p.branches.phototropism + rng.signed() * 0.05, -0.4, 0.4))
  const lf = p.leaves
  lf.size = r4(Math.max(0.04, lf.size * rng.range(1 - (v.leaf || 0), 1 + (v.leaf || 0))))
  lf.width = r4(clampNum(lf.width * rng.range(0.9, 1.12), 0.08, 1.4))
  lf.clusterCount = Math.max(1, Math.round(lf.clusterCount * rng.range(0.85, 1.2)))
  lf.perBranch = Math.max(1, Math.round(lf.perBranch * rng.range(0.85, 1.2)))
  lf.pitch = r4(lf.pitch + rng.signed() * 10)
  lf.droop = r4(clampNum(lf.droop + rng.signed() * 0.15, 0, 1))
}

function applyStage(p, stage, rng) {
  const t = p.trunk
  const matureHeight = t.height
  t.height = r4(t.height * stage.size * rng.range(0.96, 1.04))
  t.baseRadius = r4(t.baseRadius * stage.radius * rng.range(0.96, 1.05))
  t.taper = r4(clampNum(t.taper * stage.taperScale, 0.02, 0.6))
  t.radiusCurve = r4(clampNum(t.radiusCurve + stage.radiusCurveAdd, 0.8, 2.4))
  t.gnarl = r4(Math.max(0, t.gnarl * stage.gnarlScale))
  t.knots = Math.max(0, Math.round(t.knots * (0.4 + 0.6 * stage.gnarlScale)))
  t.flare = r4(clampNum(t.flare * (0.55 + 0.45 * stage.size), 0.1, 3))
  if (t.fork) t.fork.enabled = !!t.fork.enabled && stage.forkMul > 0
  if (t.fork && t.fork.enabled) {
    t.fork.count = Math.round(clampNum(t.fork.count * stage.forkMul, 2, 6))
    // 小树的"分叉"更高 (更靠近梢部), 大树分叉更低
    t.fork.height = r4(clampNum(t.fork.height * (1.35 - 0.35 * Math.min(1.6, stage.size)), 0.1, 0.62))
  }
  if (p.roots) {
    p.roots.count = Math.max(0, Math.round(p.roots.count * (0.5 + 0.5 * stage.rootMul)))
    p.roots.length = r4(p.roots.length * (0.6 + 0.4 * Math.min(1.4, stage.size)))
  }
  p.branches.levels = Math.round(clampNum(p.branches.levels + stage.levelOffset, 1, MAX_LEVELS))
  p.branches.apicalDominance = r4(clampNum(p.branches.apicalDominance + stage.apicalAdd, 0, 0.95))
  p.branches.level = p.branches.level.map((L) => ({
    ...L,
    count: Math.max(1, Math.round(L.count * stage.countScale)),
    lengthRatio: r4(clampNum(L.lengthRatio * stage.lengthScale, 0.04, 1.2)),
  }))
  // 小树叶片相对更大 (幼苗只有几片大叶)
  const leaf = p.leaves
  leaf.size = r4(Math.max(0.04, leaf.size * stage.leafScale * (stage.size < 0.4 ? 1.15 : 1)))
  leaf.perBranch = Math.max(1, Math.round(leaf.perBranch * stage.leafDensity))
  leaf.clusterCount = Math.max(1, Math.round(leaf.clusterCount * (0.6 + 0.4 * stage.leafDensity)))
  // 小树的层级少, 原来的"叶片层级"可能整片落空 -> 保证最深一级一定长叶
  const validLevels = p.branches.levels
  const on = new Array(MAX_LEVELS).fill(false)
  leaf.levels.forEach((v, i) => { if (v && i < validLevels) on[i] = true })
  if (!on.some(Boolean)) on[Math.max(0, validLevels - 1)] = true
  leaf.levels = on
  if (stage.size < 0.4) {
    // 幼苗/幼树: 叶片只长在梢部, 但个体更大 (只有几片大叶)
    leaf.startT = r4(clampNum(leaf.startT + 0.1, 0, 0.9))
    leaf.perBranch = Math.max(2, leaf.perBranch)
  }
  return matureHeight
}

function applySeason(p, sp, season, rng, baseLeaves) {
  const leaf = p.leaves
  // 枯树 (baseline 无叶) 不因季节长叶
  if (!baseLeaves) {
    leaf.enabled = false
    leaf.colorVariance = r4(clampNum(season.colorVariance, 0, 1))
    leaf.seasonDensity = 0
    p.bark.tint = season.barkTint || '#ffffff'
    return
  }
  leaf.enabled = true
  const everScaled = sp.evergreen
    ? { ...season, leafDensity: Math.max(season.leafDensity, season.id === 'winter' ? 0.88 : season.leafDensity) }
    : season
  leaf.color = rng.pick(everScaled.palette)
  leaf.colorTip = rng.pick(everScaled.tipPalette || everScaled.palette)
  leaf.colorVariance = r4(clampNum(everScaled.colorVariance, 0, 1))
  leaf.size = r4(Math.max(0.04, leaf.size * everScaled.leafScale))
  // 叶密度先只记录成系数, 等预算压完"基础密度"后再乘上去 ——
  // 否则预算回缩会把"夏 > 秋 > 冬"的物候顺序打乱
  leaf.seasonDensity = clampNum(everScaled.leafDensity, 0.02, 1.1)
  if (everScaled.leafDensity < 0.4) {
    // 落叶期: 叶片更少更小, 且集中在枝梢 (枯叶残留)
    leaf.startT = r4(clampNum(leaf.startT + 0.18, 0, 0.92))
  }
  p.leafMat.translucency = r4(clampNum(everScaled.translucency, 0, 1))
  p.bark.tint = everScaled.barkTint || '#ffffff'
  return everScaled
}

/**
 * 组合出完整参数
 * @param {string} speciesId 树种
 * @param {string} stageId 生长阶段
 * @param {string} seasonId 季节
 * @param {number} seed 种子 (决定个体差异)
 */
export function composeTree(speciesId, stageId = 'mature', seasonId = 'summer', seed = 1, opts = {}) {
  const sp = speciesById(speciesId) || SPECIES[0]
  const stage = stageById(stageId) || GROWTH_STAGES[3]
  // 关键: 个体形态只由"树种 + 种子"决定 ——
  //   * 换季节 = 同一棵树换物候 (不改变大小)
  //   * 换生长阶段 = 同一棵树长大了 (纯缩放, 高度/枝量严格递增)
  const varRng = makeRng(seed, `compose:${sp.id}`)
  const seasonRng = makeRng(seed, `season:${sp.id}:${stage.id}:${seasonId}`)
  let p = mergeParams(defaultParams(), sp.patch())
  const baseLeaves = !!(p.leaves && p.leaves.enabled) && !sp.bare

  applyVariation(p, sp, varRng)
  applyStage(p, stage, varRng)
  applySeason(p, sp, seasonProfile(sp, seasonId), seasonRng, baseLeaves)

  p.classify = { species: sp.id, stage: stage.id, season: seasonId }
  p.seed = seed
  p.auto.chaos = opts.chaos === undefined ? 0.55 : opts.chaos
  if (opts.windSway !== undefined) p.wind.barkSway = opts.windSway
  p.wind = { ...p.wind, ...autoWind(seed, opts.windIntensity === undefined ? 0.3 : opts.windIntensity) }

  // 规模预算: 枝条数先压住 (层级越深越先回缩), 再把叶片数压进预算
  const branchBudget = opts.branchBudget === undefined ? 900 : opts.branchBudget
  let est = estimateScale(p)
  for (let i = p.branches.levels - 1; i >= 0 && est.branches > branchBudget; i--) {
    let guard = 60
    while (est.branches > branchBudget && p.branches.level[i].count > 1 && guard-- > 0) {
      p.branches.level[i].count -= 1
      est = estimateScale(p)
    }
  }
  let levelGuard = 3
  while (est.branches > branchBudget * 1.3 && p.branches.levels > 2 && levelGuard-- > 0) {
    p.branches.levels -= 1
    const on = new Array(MAX_LEVELS).fill(false)
    p.leaves.levels.forEach((v, i) => { if (v && i < p.branches.levels) on[i] = true })
    if (!on.some(Boolean)) on[Math.max(0, p.branches.levels - 1)] = true
    p.leaves.levels = on
    est = estimateScale(p)
  }

  const leafBudget = opts.leafBudget === undefined ? 14000 : opts.leafBudget
  let leafGuard = 200
  while (est.leaves > leafBudget && leafGuard-- > 0) {
    if (p.leaves.clusterCount > 1) p.leaves.clusterCount -= 1
    else if (p.leaves.perBranch > 1) p.leaves.perBranch -= 1
    else break
    est = estimateScale(p)
  }

  // 预算压完"基础密度"后, 再乘季节系数 -> 物候顺序 (春 < 夏, 秋 < 夏, 冬 ≪ 夏) 一定成立
  const dens = p.leaves.seasonDensity === undefined ? 1 : p.leaves.seasonDensity
  if (!p.leaves.enabled || dens <= 0) {
    p.leaves.perBranch = 1
    p.leaves.clusterCount = 1
  } else {
    p.leaves.perBranch = Math.max(1, Math.round(p.leaves.perBranch * Math.min(1, dens)))
    if (dens < 0.5) p.leaves.clusterCount = Math.max(1, Math.round(p.leaves.clusterCount * 0.55))
    else if (dens > 1) p.leaves.clusterCount = Math.max(1, Math.round(p.leaves.clusterCount * dens))
  }
  delete p.leaves.seasonDensity
  return p
}

/** 组合名, 例如 "🌳 橡树 · 大树 · 秋" */
export function classificationName(speciesId, stageId, seasonId, withIcon = true) {
  const sp = speciesById(speciesId)
  const st = stageById(stageId)
  const se = seasonById(seasonId)
  const prof = sp ? seasonProfile(sp, seasonId) : se
  const head = withIcon && sp ? `${sp.icon} ` : ''
  return `${head}${sp ? sp.name : speciesId} · ${st ? st.name : stageId} · ${prof ? prof.name : seasonId}`
}

/** 该组合的一句话说明 */
export function classificationDesc(speciesId, stageId, seasonId) {
  const sp = speciesById(speciesId)
  const st = stageById(stageId)
  const prof = sp ? seasonProfile(sp, seasonId) : seasonById(seasonId)
  const parts = []
  if (sp) parts.push(sp.desc)
  if (st) parts.push(`${st.name}(${st.years}): ${st.desc}`)
  if (prof) parts.push(`${prof.name}: ${prof.desc}`)
  return parts.join(' · ')
}

/** 全部组合 (树种 × 阶段 × 季节) */
export function allCombinations() {
  const out = []
  for (const sp of SPECIES) {
    for (const st of GROWTH_STAGES) {
      for (const se of SEASONS) {
        out.push({ species: sp.id, stage: st.id, season: se.id, name: classificationName(sp.id, st.id, se.id) })
      }
    }
  }
  return out
}
