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
 *
 * 三个维度各自负责什么 (正交 = 互不覆盖):
 *   树种  -> 形态基因: 树干高矮胖瘦、分叉方式、每层枝条角度、叶形、树皮花纹、调色板基底
 *   阶段  -> 个体发育: 对成熟形态做**乘性缩放** (size/radius) + 结构与密度修正
 *   季节  -> 物候: 只改叶色/叶量/透光/树皮色调, 以及"落叶期叶片集中到枝梢"
 * 流水线 (composeTree 的顺序, 顺序本身是语义的一部分):
 *   defaultParams() --merge--> 物种 patch --applyVariation--> 个体差异
 *   --applyStage--> 发育缩放 --applySeason--> 物候 --预算回缩--> 最终参数
 *
 * 确定性与不变量 (scripts/selftest.mjs 的 [11] 会逐条验):
 *   1. 个体形态只由"树种 + 种子"决定: applyVariation 用的子流标签是 `compose:${sp.id}`,
 *      **不含阶段与季节** —— 所以换季节不会挪动树干 (树皮几何哈希必须完全一致),
 *      换阶段只是同一棵树的等比长大 (主干高度严格递增)。
 *   2. 季节子流标签是 `season:${sp.id}:${stage.id}:${seasonId}`, 含阶段与季节,
 *      所以不同阶段/季节的叶色抽样互不相同 (这是有意的: 让每个组合都有自己的色调)。
 *   3. 叶量顺序 夏 > 秋 > 冬 必须成立; 冬季仍需 >0 片 (橡树的枯叶残留);
 *      常绿树种冬季不得低于夏季的 70%。
 *   4. 同一组合 + 同一种子 = 完全相同的几何; 不同种子 = 不同个体; 7 个树种两两不同。
 * 注意: 各 apply 系列函数都是**就地修改**传入的 p (p 已是 mergeParams 产出的新对象,
 * 不会污染 defaultParams 或物种表)。
 */
import { defaultParams, cloneParams, mergeParams, MAX_LEVELS, defaultLevel } from './params.js'
import { makeRng } from './rng.js'
import { estimateScale } from './treeBuilder.js'
import { autoWind } from './autowind.js'

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

/**
 * 生成一份"5 层枝条配置", 每层在 defaultLevel(i) 之上叠加一个补丁。
 *
 * 用法: levels({...L1}, {...L2}, {...L3}, {...L4}, {...L5}) —— 参数按层下标对应,
 * 少写的层直接沿用 defaultLevel(i) 的默认值 (所以物种 patch 里只写"与默认不同"的字段即可)。
 * 合并是**浅合并** ({...base, ...patch}): 每层都是扁平字段, 不存在嵌套对象,
 * 所以浅合并足够; 若将来给某层加了嵌套对象, 这里会整体替换而不是深合并, 需留意。
 *
 * @param {...object} patches 各层的字段补丁 (可为空/缺省)
 * @returns {Array<object>} 长度恒为 MAX_LEVELS 的层配置数组
 */
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
 *
 * 其余字段说明: id 稳定标识 (会写进 classify.stage 与存档) / name+icon 面板显示 /
 * years 树龄区间文字 / desc 一句话形态说明 (两者都会被 classificationDesc 拼进说明里)。
 *
 * 表本身是**有序的**: 从 seedling 到 ancient 必须严格递增, 因为
 *   ① 自检 [11] 要求主干高度严格递增 (applyStage 里 size 直接相乘);
 *   ② presets.js 的 STAGE_WEIGHTS 按这个下标分配权重 ([0.1,0.16,0.24,0.36,0.14]);
 *   ③ stageById() 的默认回退用 GROWTH_STAGES[3] (= mature)。
 * 调换顺序会同时破坏这三处, 属于破坏性改动。
 *
 * 消费方: applyStage() 与 composeTree(); 面板的"生长阶段"选择器直接遍历本表。
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

/**
 * 四个季节的物候参数 (全局默认值, 可被 SPECIES[i].seasonal 覆盖)。
 *
 * 字段语义:
 *   leafDensity    叶量系数 (0..1.1): 不是最终叶量, 而是先记成 leaves.seasonDensity,
 *                  等预算回缩压完"基础密度"后再乘上去 —— 这样物候顺序不会被预算打乱
 *   leafScale      叶片尺寸倍率 (春叶小、夏叶大)
 *   colorVariance  单片叶色差 (秋色最大 = 层林尽染的感觉)
 *   translucency   叶肉透光度 (嫩叶/秋叶更透光, 冬枯叶几乎不透)
 *   palette        叶基色候选池 (处理时随机挑一个, 所以同一季节也有个体色差)
 *   tipPalette     叶尖色候选池 (与基色渐变混合)
 *   barkTint       乘到树皮上的色调 (冬季偏冷、秋季偏暖)
 *
 * 自检 [11] 对这些值有硬约束, 改之前先看:
 *   - 叶量必须 夏 > 秋 > 冬; 冬季仍 > 0 且 < 夏季的 30% (橡树枯叶残留)
 *   - 常绿树种冬季由 applySeason 夹到 >= 0.88, 不会跟着掉光
 *   - 色相目标: 夏 70~160° (绿), 秋 < 50° (红橙), 樱花春 > 300° (粉)
 * 顺序固定为 spring / summer / autumn / winter: presets.js 的 SEASON_WEIGHTS 按下标分配权重。
 */
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

/* 橡树的主干分叉基线, 同时被 oak.patch() 与"灌木/枯树"用不同覆盖值复用。
 * 字段与 params.js 的 trunk.fork 同名同义: height 是"占树干高度的比例",
 * angle 是度, 其余是无量纲倍率/弧度。 */
const OAK_FORK = { count: 3, height: 0.33, angle: 27, spread: 0.85, radiusScale: 0.66, lengthScale: 1.0, taper: 0.3, curve: 0.45, gravity: 0.03 }

/**
 * 树种表 (形态基因库)。每个条目的字段:
 *   id / name / icon / desc  标识与显示 (id 会写进 classify.species, 属于存档格式, 不可随意改)
 *   evergreen                常绿标记: 冬季叶量由 applySeason 兜底到 >= 0.88 (松树)
 *   bare                     光秃标记: 该树种"天然无叶", 季节不得让它长出叶子 (枯树)
 *   fork                     分叉参数基线 (供 patch 复用; 真正生效的是 patch().trunk.fork)
 *   variation                个体差异幅度表, 每项是"最大相对偏移"(0..1), 由 applyVariation 消费:
 *                            height 高度 / radius 粗细 / curve 弯曲 / lean 倾斜 / gnarl 不规则 /
 *                            crown 树冠开张度 (影响枝角与枝长) / count 每层枝数 /
 *                            leaf 叶片大小 / fork 分叉主枝数 / trunkShare 分叉高度
 *   seasonal                 季节覆盖表 { 季节id: {...} }: 浅合并到全局 SEASONS 之上,
 *                            可以只覆盖 palette, 也可以额外改 name/desc (樱花的春季)
 *   patch()                  返回一份"参数子集", 由 mergeParams 深合并到 defaultParams 之上;
 *                            **只写与默认不同的字段**, 没写的自动继承默认值
 *
 * 为什么 patch 是函数而不是常量对象: levels() / fork 这类字段每次都要生成**全新的**
 * 数组与对象。如果直接写成常量, 所有树会共享同一份 branches.level 引用,
 * 而 applyVariation / applyStage / presets 的扰动都是就地修改 —— 一棵树的扰动
 * 会顺着共享引用污染下一棵树 (表现为"越生成越歪")。函数保证每次调用都是干净副本。
 *
 * 新增树种时请注意: id 全局唯一、patch 里不要写 seed/classify(由 composeTree 负责)、
 * 并且要能通过 selftest [11] 的全部约束 (高度单调、面数预算、几何两两不同)。
 */
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
        flare: 1.5, flareHeight: 0.18, knots: 4, knotSize: 0.32, squash: 1.0,
        fork: { ...OAK_FORK, enabled: true },
      },
      // 板根贴着地面向外铺 (原来 pitch 116° 是往地下扎, 所以几乎看不见)
      roots: { enabled: false, count: 7, length: 0.2, lengthVariance: 0.32, radiusRatio: 0.42, spread: 1.0, pitch: 96, segments: 6, radialSegments: 6, curve: 0.75, sink: 0.18 },
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
        perBranch: 9, clusterCount: 4, clusterRadius: 0, clusterSpread: 0,
        size: 0.44, sizeVariance: 0.3, width: 0.72, shape: 'oak', segments: 6,
        curl: 0.16, fold: 0.3, startT: 0, endT: 1.0,
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
    /* 塔形针叶树: L1 每轮 14 根 (轮生) 且较长较平, 之后每层迅速变短;
     * apicalDominance 0.8 = 强顶端优势, 所以越靠梢部枝越短, 形成尖塔轮廓;
     * phototropism -0.08 (轻微下压) 让侧枝平展而不是全部上翘。 */
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
      roots: { enabled: false, count: 6, length: 0.18 },
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
        clusterCount: 5, clusterRadius: 0, clusterSpread: 0, perBranch: 6,
        startT: 0, pitch: -8, pitchVariance: 30, droop: 0.18,
        color: '#4e8b46', colorTip: '#87c26c', colorVariance: 0.2,
      },
      bark: { color: '#5a4030', color2: '#7d5b41', procedural: { enabled: true, style: 'pine', scale: 0.8, contrast: 0.7 } },
      leafMat: { roughness: 0.75, translucency: 0.18 },
    }),
  },
  {
    /* 细高白干: height 12m 而 baseRadius 只有 0.22 (高径比 ≈ 27, 常见乔木里最瘦),
     * taper 0.3 说明梢部收得很快; 树冠稀疏靠 perBranch 11 的小叶摊开, 秋季转金黄 (见 seasonal)。 */
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
    /* 垂柳: 形态几乎全靠重力塑造 —— gravityScale 1.6 (全局重力乘子) 叠加深层
     * L2/L3 的 gravity -0.34 / -0.42, 枝条先扬起再垂下; 叶片用披针形 lance、droop 0.55。 */
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
      // 樱花: 叶片走素材卡片 (程序化叶形用 oval); 花朵是独立的平面花卡系统
      leaves: {
        enabled: true, levels: [false, true, true, true, true], size: 0.34, width: 0.85,
        shape: 'oval', clusterCount: 2, perBranch: 6,
        color: '#edaac4', colorTip: '#f9dde6', colorVariance: 0.18, translucency: 0.65,
      },
      bark: { color: '#5a4438', color2: '#7a5c4c', procedural: { enabled: true, style: 'smooth', scale: 1.0, contrast: 0.35 } },
      leafMat: { translucency: 0.6, roughness: 0.5 },
    }),
  },
  {
    /* 灌木: 没有"主枝"概念 —— trunk 只有 1.6m 且 taper 0.35, 在 16% 高度就分叉;
     * 各层 startT 从 0.0 (基部) 起分枝, 所以看起来是丛生而不是单干。 */
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
      roots: { enabled: false, count: 4, length: 0.3 },
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
    /* 枯树: bare=true —— applySeason 会走"无叶"分支直接返回, 所以什么季节都不长叶
     * (presets.js 里"枯树随机长几片残叶"是它自己的额外扰动, 与季节无关);
     * 形态靠 gnarl 0.85 + knots 5 + twist 0.4 + 大 curveVariance 撑出枯朽感。 */
    id: 'dead', name: '枯树', icon: '🪵',
    desc: '无叶的枯朽老树: 强烈扭曲与节瘤',
    evergreen: false,
    bare: true,
    variation: { height: 0.3, radius: 0.28, curve: 0.5, lean: 0.16, gnarl: 0.5, crown: 0.6, count: 0.3 },
    seasonal: {},
    patch: () => ({
      trunk: { height: 8, baseRadius: 0.42, taper: 0.06, curve: 0.6, curveVariance: 0.6, gnarl: 0.85, twist: 0.4, knots: 5, knotSize: 0.5, flare: 1.2, fork: { enabled: true, count: 2, height: 0.42, angle: 30, radiusScale: 0.6, lengthScale: 0.9, taper: 0.22, curve: 0.6, gravity: -0.05 } },
      roots: { enabled: false, count: 7, length: 0.26, curve: 0.7 },
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

/**
 * 按 id 查树种。
 *
 * 用线性 find 而不是建 Map: 表只有 7 条, 而"树生成"是毫秒级的低频操作,
 * 这里省下的初始化复杂度比查找性能更值钱。
 *
 * @param {string} id 树种 id
 * @returns {object|null} 树种条目; 未知 id 返回 null (composeTree 会兜底到 SPECIES[0])
 */
export function speciesById(id) {
  return SPECIES.find((s) => s.id === id) || null
}

/**
 * 按 id 查生长阶段。
 * @param {string} id 阶段 id (seedling/sapling/young/mature/ancient)
 * @returns {object|null} 阶段条目; 未知 id 返回 null (composeTree 兜底到 mature)
 */
export function stageById(id) {
  return GROWTH_STAGES.find((s) => s.id === id) || null
}

/**
 * 按 id 查季节。
 * @param {string} id 季节 id (spring/summer/autumn/winter)
 * @returns {object|null} 季节条目; 未知 id 返回 null
 */
export function seasonById(id) {
  return SEASONS.find((s) => s.id === id) || null
}

/**
 * 某个树种在某个季节的物候 (树种可覆盖全局季节设定)。
 *
 * 合并顺序: 全局 SEASONS 条目 < species.seasonal[季节id] (浅合并)。
 * 覆盖项可以只补一两个字段 (例如白桦冬季只把 leafDensity 改成 0.04),
 * 也可以整体换掉文案 (樱花春季改 name/desc 为"春 (花)")。
 *
 * 两个细节:
 *   - 未知季节回退到 SEASONS[1] (= summer) 而不是第一个: 夏天是该系统的
 *     "完全展开"基准态, 用它兜底比用春天更不容易出现"叶子几乎掉光"的意外。
 *   - 返回值是**新对象**: 调用方 (applySeason / classificationName) 可以随便读改,
 *     不会污染全局季节表。
 *
 * @param {object|null} species 树种条目 (可为 null)
 * @param {string} seasonId 季节 id
 * @returns {object} 合并后的季节参数
 */
export function seasonProfile(species, seasonId) {
  const base = seasonById(seasonId) || SEASONS[1]
  const over = (species && species.seasonal && species.seasonal[seasonId]) || null
  return over ? { ...base, ...over } : { ...base }
}

/* ------------------------------------------------------------------ */
/* 组合                                                                */
/* ------------------------------------------------------------------ */

/* ---------------- 组合用的数值小工具 ----------------
 * clampNum: 区间夹取。参数经过"物种 patch → 个体扰动 → 阶段缩放 → 预算回缩"
 *           四轮乘算后极易越界, 所以几乎每个会被乘的字段都夹一次。
 * r4:       四舍五入到 4 位小数。目的是"让参数可比较": 不做这一步, 浮点尾数会让
 *           两次看似相同的组合序列化出不同 JSON, 从而破坏缓存与撤销栈的判重。 */
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const r4 = (v) => +v.toFixed(4)

/**
 * ① 个体差异: 在"该物种标准形态"上叠加种子决定的随机偏移。
 *
 * 输入 p 是 mergeParams(defaultParams, 物种 patch) 的结果 (已被就地修改),
 * rng 必须是 `compose:${sp.id}` 子流 —— 标签里**故意不含阶段与季节**,
 * 这样"换季节"不会挪动树干 (树皮几何哈希必须逐字节相同)。
 *
 * 几个设计要点:
 *   - v (sp.variation) 每项是"最大相对偏移" 0..1, 缺省 = 0 = 该维度不做个体差异;
 *     所以枯树表里没有 leaf 项, 树叶就不会被扰动。
 *   - 树干尺寸用**乘性**扰动 rng.range(1-v, 1+v): 对高矮不同的树等比生效。
 *   - lean 是直接重新采样 (rng.signed()*v.lean) 而不是叠加到设计值上:
 *     每个个体都该有自己独立的倾斜方向与幅度。
 *   - crown 是一个 **-1..1 的共享随机量**, 代表"这棵树是直立型还是开张型"。
 *     所有层级共用同一个 crown (乘以层级权), 所以整棵树风格统一,
 *     而不是每层各自乱 —— 这是"个体差异"与"畸变"的分界线。
 *   - damp = 1/(1+i*0.6): 越深层的扰动越收敛。4 层枝条的枝量是连乘的,
 *     若每层都按同样幅度抖, 深层误差会被放大成畸形树。
 *
 * @param {object} p 参数树 (就地修改)
 * @param {object} sp 树种条目 (读 sp.variation)
 * @param {object} rng 该树种专属的个体差异随机流
 */
function applyVariation(p, sp, rng) {
  const v = sp.variation || {}
  const t = p.trunk
  t.height = r4(t.height * rng.range(1 - (v.height || 0), 1 + (v.height || 0)))
  t.baseRadius = r4(t.baseRadius * rng.range(1 - (v.radius || 0), 1 + (v.radius || 0)))
  t.curve = r4(Math.max(0, t.curve + rng.signed() * (v.curve || 0) * 0.5))
  // 倾斜是"重新采样"而不是叠加到设计值上: 每个个体都有自己独立的倾斜幅度与方位
  t.lean = r4(rng.signed() * (v.lean || 0))
  t.leanDirection = Math.round(rng.range(0, 360))
  t.gnarl = r4(Math.max(0, t.gnarl * rng.range(1 - (v.gnarl || 0) * 0.5, 1 + (v.gnarl || 0) * 0.6)))
  t.twist = r4(t.twist + rng.signed() * 0.2)
  t.knots = Math.max(0, Math.round(t.knots + rng.signed() * 3))
  // 分叉也参与个体差异, 但每一项都硬夹在"生物合理区间"内:
  // 主枝数 2~6、分叉高度 0.12~0.6 (占树高)、夹角 ±20% —— 出了这个范围就不像树了
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
    // 开张型个体 (crown>0) 的主枝更下垂、更不向上翘; 深层用 0.03 (主枝 0.08) 减半,
    // 因为末梢本来就靠自身 gravity 下垂, 再叠加开张度会卷成一团
    o.gravity = r4(clampNum(L.gravity + rng.signed() * 0.16 * damp - crown * (i === 0 ? 0.08 : 0.03), -0.7, 0.5))
    o.upBias = r4(L.upBias - crown * 0.06 * damp)
    o.segments = Math.max(3, Math.round(L.segments))
    return o
  })
  p.branches.apicalDominance = r4(clampNum(p.branches.apicalDominance + rng.signed() * 0.12, 0, 0.95))
  p.branches.phototropism = r4(clampNum(p.branches.phototropism + rng.signed() * 0.05, -0.4, 0.4))
  const lf = p.leaves
  // 叶片只做温和扰动 (尺寸 ±v.leaf、宽长比 ±12%): 叶形是识别树种的关键特征,
  // 抖太狠会让"橡树看着像白桦", 所以这里刻意比枝条保守
  lf.size = r4(Math.max(0.04, lf.size * rng.range(1 - (v.leaf || 0), 1 + (v.leaf || 0))))
  lf.width = r4(clampNum(lf.width * rng.range(0.9, 1.12), 0.08, 1.4))
  lf.clusterCount = Math.max(1, Math.round(lf.clusterCount * rng.range(0.85, 1.2)))
  lf.perBranch = Math.max(1, Math.round(lf.perBranch * rng.range(0.85, 1.2)))
  lf.pitch = r4(lf.pitch + rng.signed() * 10)
  lf.droop = r4(clampNum(lf.droop + rng.signed() * 0.15, 0, 1))
}

/**
 * ② 个体发育: 把"该物种的成熟形态"按阶段缩放成树苗 / 幼树 / 小树 / 古树。
 *
 * 与 applyVariation 的分工: variation 决定"这是哪个个体", stage 决定"它几岁了"。
 * 因此这里几乎全是**乘性缩放**, 只有少数结构项需要按阶段改写:
 *   - 主干 height × stage.size、baseRadius × stage.radius, 附带 ±4~5% 抖动;
 *     抖动幅度远小于相邻阶段的 size 差 (0.13→0.3→0.55→1→1.32), 所以
 *     "主干高度严格递增"这条自检约束不会被抖动破坏;
 *   - 锥度/半径曲线/不规则度/根部外扩: 小树更细更锥、更光滑、根部外扩更弱;
 *   - 分叉: forkMul=0 时直接关闭 (树苗/幼树不分叉); 高度按 (1.35 - 0.35*size)
 *     反比修正, 即"小树的分叉点更高更靠梢部, 大树分叉更低";
 *   - 层级数 (levelOffset) 与每层枝数 (countScale);
 *   - 叶片尺寸/密度; 树苗额外 ×1.15, 因为"幼苗只有几片大叶";
 *   - 叶片层级兜底: 层级变少后可能出现"没有任何一层长叶", 这里保证最深一层长叶。
 *
 * 与 applyVariation 共用同一条随机流 (同一 seed 下仍然完全可复现)。注意分叉分支
 * 只在 forkMul>0 时才抽 3 次随机数, 所以不同阶段后续的抽样点会错开 —— 这是预期的:
 * 阶段本来就该改变形态, 不需要与其它阶段"抖动一致"。
 *
 * @param {object} p 参数树 (就地修改)
 * @param {object} stage 生长阶段条目 (GROWTH_STAGES 之一)
 * @param {object} rng 个体差异随机流 (与 applyVariation 同一条)
 * @returns {number} 缩放**前**的成熟高度 (米)。当前调用方未使用, 保留是为了将来
 *          把某些尺寸改成"相对成熟树高"的归一化参数时能直接取用
 */
function applyStage(p, stage, rng) {
  const t = p.trunk
  const matureHeight = t.height
  t.height = r4(t.height * stage.size * rng.range(0.96, 1.04))
  t.baseRadius = r4(t.baseRadius * stage.radius * rng.range(0.96, 1.05))
  t.taper = r4(clampNum(t.taper * stage.taperScale, 0.02, 0.6))
  t.radiusCurve = r4(clampNum(t.radiusCurve + stage.radiusCurveAdd, 0.8, 2.4))
  t.gnarl = r4(Math.max(0, t.gnarl * stage.gnarlScale))
  t.knots = Math.max(0, Math.round(t.knots * (0.4 + 0.6 * stage.gnarlScale)))
  // 根部外扩随年龄增强 (0.55 + 0.45*size): 幼苗几乎没有板根, 古树最夸张
  t.flare = r4(clampNum(t.flare * (0.55 + 0.45 * stage.size), 0.1, 3))
  // forkMul = 0 时只把开关关掉, fork 对象本身保留 (面板上的值还在,
  // 用户切回大树时能立刻恢复之前调好的分叉参数)
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

/**
 * ③ 物候: 只改叶色 / 叶量 / 透光 / 树皮色调, **绝不碰树干与树枝几何**。
 *
 * 这条"季节不改几何"是硬约束而不是风格偏好: 自检 [11c] 会比对同一棵树在
 * 夏/秋/冬 三个季节的树皮几何哈希, 要求逐字节相同 —— 用户的心理模型是
 * "同一棵树换物候", 换季顺手把树形换掉会一眼被看出来。往这个函数里加
 * trunk / branches 的修改之前请先想清楚这一点。
 *
 * 处理流程:
 *   - baseLeaves=false (枯树 bare, 或物种 patch 里本身就关了叶) -> 直接关叶返回,
 *     连叶色都不设, 避免"枯树到了冬天突然有颜色";
 *   - 常绿树种: 把冬季 leafDensity 抬到 >= 0.88 (松树冬天不能掉光);
 *   - 叶色从 palette / tipPalette 里随机挑 (用 seasonRng 子流, 标签含阶段与季节);
 *   - 叶量**只记录不应用**: 存进 leaves.seasonDensity, 等 composeTree 压完面数预算
 *     再乘上去, 否则预算回缩会把"夏 > 秋 > 冬"的物候顺序压乱;
 *   - 落叶期 (leafDensity < 0.4) 把 startT 往梢部推, 让残叶集中挂在枝梢;
 *   - 透光度与树皮色调直接写回材质参数。
 *
 * @param {object} p 参数树 (就地修改)
 * @param {object} sp 树种条目 (读 evergreen / bare)
 * @param {object} season seasonProfile() 合并后的季节参数
 * @param {object} rng 季节子流 `season:${sp.id}:${stage.id}:${seasonId}`
 * @param {boolean} baseLeaves 该组合原本是否长叶 (false = 枯树 / 无叶物种)
 * @returns {object|undefined} 实际生效的季节参数 (常绿已夹取过);
 *          无叶分支返回 undefined。当前调用方未使用返回值, 保留便于调试与扩展
 */
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
  // 常绿: 冬季不能跟着落叶树种掉光, 把密度底限抬到 0.88 (其余季节沿用原值)
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
  // 树皮色调: 冬季偏冷、秋季偏暖 —— 这是"季节感"在树干上的唯一体现 (不改几何)
  p.bark.tint = everScaled.barkTint || '#ffffff'
  return everScaled
}

/**
 * 组合出完整参数 (本模块唯一的对外主入口)。
 *
 * 流水线 (顺序是语义的一部分, 不要重排):
 *   ① 查表 + 兜底: 未知树种 -> SPECIES[0] (橡树), 未知阶段 -> GROWTH_STAGES[3] (大树);
 *   ② mergeParams(defaultParams, sp.patch()) 得到该物种的标准形态 (全新对象);
 *   ③ applyVariation 叠加个体差异 (子流 `compose:${sp.id}`, **不含阶段/季节**);
 *   ④ applyStage 按年龄缩放;
 *   ⑤ applySeason 改物候 (子流 `season:${sp.id}:${stage.id}:${seasonId}`);
 *   ⑥ 写回 classify / seed / chaos / 风场 (风场用 autoWind(seed, intensity) 推导);
 *   ⑦ 面数预算: 先压"枝条总数"(从最深一层开始减 count), 再压"叶片总数";
 *   ⑧ 最后才乘季节叶量系数, 保证 夏 > 秋 > 冬 的物候顺序不被预算破坏;
 *   ⑨ 删掉内部中间量 leaves.seasonDensity, 保证输出参数与 params.js 的 schema 一致。
 *
 * ⑤ 与 ③ 的子流标签差异是刻意设计: 换季节不动树干 (只有叶色/叶量变),
 * 换阶段让整棵树等比长大; 而叶色的抽样又随阶段/季节变化, 使每个组合都有自己的色调。
 *
 * @param {string} speciesId 树种 id (未知则用橡树)
 * @param {string} [stageId='mature'] 生长阶段 id (未知则用大树)
 * @param {string} [seasonId='summer'] 季节 id
 * @param {number} [seed=1] 种子, 决定个体差异 (同 seed + 同组合 = 完全相同)
 * @param {object} [opts={}] 可选覆盖:
 *   chaos         混乱度 (写进 auto.chaos, 默认 0.55)
 *   windIntensity 风力强度 (传给 autoWind, 默认 0.3)
 *   windSway      树干/树枝摆幅 (覆盖 wind.barkSway)
 *   branchBudget  枝条总数预算 (默认 900)
 *   leafBudget    叶片总数预算 (默认 14000)
 * @returns {object} 完整参数树 (结构与 defaultParams 一致, 可直接交给生成器或存 JSON)
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
  // 从**最深一层**开始减: 深层枝数量最多, 减掉一根省下的总枝数最多, 而它对树冠
  // 轮廓的影响又最小 (末梢细枝本来就密)。减到 count=1 仍超标就换上一层。
  for (let i = p.branches.levels - 1; i >= 0 && est.branches > branchBudget; i--) {
    // guard 是死循环保护: estimateScale 只是估算, 且 count 最小只到 1,
    // 极端参数下来可能永远降不到预算内 —— 那就放弃, 宁可超一点也不能卡住主线程
    let guard = 60
    while (est.branches > branchBudget && p.branches.level[i].count > 1 && guard-- > 0) {
      p.branches.level[i].count -= 1
      est = estimateScale(p)
    }
  }
  // 减层级是最后手段 (会改变树冠轮廓), 所以最多做 3 次; 缩层级后要同步修正
  // leaves.levels 的开关, 否则可能出现"最深层没叶"的空树冠
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
    // 密度分档处理 (而不是简单乘一个系数):
  //   dens < 0.5 (落叶期) -> 叶簇缩小 45%, 让残叶更"稀碎"而不是均匀变薄;
  //   dens > 1 (春季樱花等超额密度) -> 允许叶簇变大来吃掉这部分增量。
  if (dens < 0.5) p.leaves.clusterCount = Math.max(1, Math.round(p.leaves.clusterCount * 0.55))
    else if (dens > 1) p.leaves.clusterCount = Math.max(1, Math.round(p.leaves.clusterCount * dens))
  }
  // seasonDensity 是流程内部的中间量, 不在 params.js 的 schema 里;
  // 留着会被导出进 JSON / 被 mergeParams 当成正式字段, 所以收尾必须删掉
  delete p.leaves.seasonDensity
  return p
}

/**
 * 组合名, 例如 "🌳 橡树 · 大树 · 秋"。
 *
 * 季节名走 seasonProfile() 而不是直接读 SEASONS: 这样樱花春季会显示成
 * 物种覆盖后的 "春 (花)"。未知 id 时原样显示 id (不让 UI 出现空白或 undefined)。
 *
 * @param {string} speciesId 树种 id
 * @param {string} stageId 生长阶段 id
 * @param {string} seasonId 季节 id
 * @param {boolean} [withIcon=true] 是否带树种 emoji (导出文件名/标题等场景可关掉)
 * @returns {string} 形如 "🌳 橡树 · 大树 · 秋" 的一行文本
 */
export function classificationName(speciesId, stageId, seasonId, withIcon = true) {
  const sp = speciesById(speciesId)
  const st = stageById(stageId)
  const se = seasonById(seasonId)
  const prof = sp ? seasonProfile(sp, seasonId) : se
  const head = withIcon && sp ? `${sp.icon} ` : ''
  return `${head}${sp ? sp.name : speciesId} · ${st ? st.name : stageId} · ${prof ? prof.name : seasonId}`
}

/**
 * 该组合的一句话说明 (用于自动生成面板的副标题)。
 *
 * 拼接顺序: 树种 desc · "阶段名(树龄): 阶段说明" · "季节名: 季节说明",
 * 中间用 " · " 连接; 查不到的维度自动跳过 (所以未知 id 也能得到半句话而不是报错)。
 *
 * @param {string} speciesId 树种 id
 * @param {string} stageId 生长阶段 id
 * @param {string} seasonId 季节 id
 * @returns {string} 拼接后的说明文字
 */
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

/**
 * 全部组合 (树种 × 阶段 × 季节), 顺序为 树种 > 阶段 > 季节 的字典序三重循环。
 *
 * 用于自检 [11] 验证"组合矩阵完整"(数量必须等于三者长度之积), 也可供 UI
 * 做组合画廊。每项只含 id 与显示名, 不生成任何几何 (生成一次要几十毫秒, 这里不能做)。
 *
 * @returns {Array<{species: string, stage: string, season: string, name: string}>}
 *          长度 = SPECIES.length × GROWTH_STAGES.length × SEASONS.length (当前 7×5×4 = 140)
 */
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
