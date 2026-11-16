/**
 * 竹子 (bamboo) 形态展开
 * ------------------------------------------------------------
 * 作用: 把 `params.bamboo` 这组「竹子特有参数」在**生成前**翻译成通用生成器
 * 能直接吃的 trunk / branches / leaves / bark 结构。这样:
 *   - 竹子的形态完全由竹类参数控制 (竿数、竹高、竿径、节数、外倾角、侧枝、竹叶),
 *     调这些滑杆不需要另写一套生成器;
 *   - treeBuilder 的风场 / 蒙皮 / 节点表 / LOD / 选择 / 导出全部照常复用,
 *     不会出现"竹子在别的功能里是二等公民"的问题。
 *
 * 为什么不是简单的树种 patch:
 *   通用模型是"一根主干 + 逐层递减的分枝", 竹子是"一丛近乎平行的细竿"。
 *   如果只写 patch, 竿数是固定常量, 用户无法在面板里改; 也不能把竿长算成
 *   "竹高 ÷ 丛基高"这种相对比 (patch 里的 lengthRatio 会被 applyStage 夹到 1.2)。
 *   放在 build 时展开就没有这个夹取, 竿长能精确等于用户设定的竹高。
 *
 * 结构约定 (与 treeBuilder 的语义对齐, 改这里前先看 buildTree 的注释):
 *   - 主干 = **丛基**: 一段很矮的茎 (baseHeight), 竹竿从它身上分出。
 *     之所以留一个矮主干而不是把第一根竿当主干: 通用生成器只在分支上挂叶
 *     (spawnLeaves 只在 buildBranch 里调用), 主干不长叶 —— 若第一根竿当主干,
 *     它会是一根光秃秃的竿, 一眼就能看出"少了一根"。
 *   - L1 = 竹竿 (count = culms), 近乎竖直 (pitch≈tilt), 长度比 = 竹高/丛基高, 细锥度;
 *   - L2 = 侧枝 (挂在竿的上段), 短、外张, 承载大部分竹叶;
 *   - 竹节环不生成几何: 由 bark 的 'bamboo' 程序化贴图沿 V 方向画等距暗环,
 *     uvScaleV 由 nodeCount 反推 (见 BAMBOO_NODE_BANDS 的约定)。
 *
 * 单位: 长度米, 角度度 (与 params.js 一致)。
 */

/**
 * 'bamboo' 树皮贴图**每一块贴图**里画几条竹节环。
 * 这个常量被三处共享, 改它必须同时改 textures.js 的竹节绘制:
 *   1) textures.js makeBarkTextures({ style: 'bamboo' }) 画 BAMBOO_NODE_BANDS 条环;
 *   2) 本文件按 nodeCount / BAMBOO_NODE_BANDS 反推 uvScaleV (贴图沿竿长重复几次);
 *   3) 结果: 一根竿上的环数 ≈ nodeCount。
 */
export const BAMBOO_NODE_BANDS = 5

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/**
 * 把竹子特有参数展开成通用参数 (不修改入参)。
 *
 * @param {object} params 完整参数树 (含 params.bamboo)
 * @returns {object} 需要重建时返回**新的**参数树; 非竹子直接返回原对象 (零拷贝开销)
 */
export function applyBambooParams(params) {
  const b = params && params.bamboo
  if (!b || !b.enabled) return params

  const height = Math.max(0.6, num(b.height, 9))
  const culmRadius = Math.max(0.006, num(b.culmRadius, 0.048))
  // 丛基高度不能超过竹高的一半: 否则"竿长比"会把竿子拉到地下去 (下限 8cm 保证有实体根基)
  const baseHeight = clamp(num(b.baseHeight, 0.4), 0.08, height * 0.5)
  const culms = clamp(Math.round(num(b.culms, 8)), 1, 12)
  const tilt = clamp(num(b.tilt, 7), 0, 40)
  const nodeCount = clamp(Math.round(num(b.nodeCount, 14)), 2, 60)
  const branchStart = clamp(num(b.branchStart, 0.42), 0.05, 0.95)
  const twigs = clamp(Math.round(num(b.twigs, 5)), 0, 8)
  const twigLength = Math.max(0.1, num(b.twigLength, 0.9))
  const leafPerTwig = clamp(Math.round(num(b.leafPerTwig, 14)), 0, 30)
  const leafSize = Math.max(0.03, num(b.leafSize, 0.3))
  const leafWidth = clamp(num(b.leafWidth, 0.16), 0.04, 0.6)
  const leafDroop = clamp(num(b.leafDroop, 0.55), 0, 1)

  // 丛基比竿子粗: 多根竿从同一段短茎上分出, 茎太细的话蒙皮窗口会挤在一起
  const baseRadius = culmRadius * 1.6
  const trunk = {
    ...params.trunk,
    height: baseHeight,
    baseRadius,
    // 丛基几乎不锥化: 竿基处仍需足够粗度承载所有竿的开口
    taper: 0.85,
    radiusCurve: 1.0,
    segments: 6,
    radialSegments: 10,
    curve: 0.02,
    curveVariance: 0.02,
    lean: 0.02,
    leanDirection: 0,
    twist: 0,
    gnarl: 0,
    flare: 1.1,
    flareHeight: 0.9,
    knots: 0,
    knotSize: 0,
    squash: 1,
    // 竹丛不分叉 (竿数由 bamboo.culms 控制, 走 L1 而不是 trunk.fork)
    fork: { enabled: false },
  }

  // 竿长 = 竹高 → 相对丛基高度的比例。这里不受 applyStage 的 lengthRatio 夹取影响
  // (夹取发生在物种预设阶段, 而本函数在 build 时执行)。
  const culmRatio = height / baseHeight
  const culmRadiusRatio = culmRadius / (baseRadius * 0.95)

  const culmLevel = {
    enabled: true,
    count: culms,
    // pitch 是"离父枝轴的夹角": 丛林里的竿几乎与丛基同向, 7° 左右只有轻微外倾
    pitch: tilt,
    pitchVariance: Math.min(6, Math.max(1, tilt * 0.6)),
    lengthRatio: culmRatio,
    lengthVariance: 0.06,
    radiusRatio: culmRadiusRatio,
    radiusVariance: 0.1,
    // 竿基沿丛基 10%~90% 高度分布: 视觉上像一丛从根盘上冒出来的笋
    startT: 0.1,
    endT: 0.9,
    startJitter: 0.04,
    // 竹竿锥度很小 (上下粗细接近), 这是它和树的第一个显著区别
    taper: 0.42,
    radiusCurve: 1.05,
    curve: 0.02,
    curveVariance: 0.03,
    // 这两个都必须是 0: rotateTowardUp 会把方向朝竖直拉,
    // 原本 7° 的外倾角叠加 0.15 rad (≈8.6°) 后会被抵消成"竿竿平行重合"。
    gravity: 0,
    upBias: 0,
    phyllotaxis: 137.5,
    spread: 0.18,
    segments: 14,
    radialSegments: 8,
    windGain: 1.3,
  }

  const twigLevel = {
    enabled: twigs > 0,
    count: Math.max(1, twigs),
    pitch: 55,
    pitchVariance: 18,
    lengthRatio: twigLength / height,
    lengthVariance: 0.3,
    radiusRatio: 0.08,
    radiusVariance: 0.2,
    startT: branchStart,
    endT: 0.98,
    startJitter: 0.02,
    taper: 0.4,
    radiusCurve: 1.0,
    curve: 0.45,
    curveVariance: 0.5,
    gravity: -0.05,
    upBias: 0.12,
    phyllotaxis: 137.5,
    spread: 0.5,
    segments: 5,
    radialSegments: 4,
    windGain: 0.7,
  }

  const leaves = {
    ...params.leaves,
    enabled: leafPerTwig > 0,
    // 竿本身也带叶 (竹子顶端本来就密): L1 = 竿, L2 = 侧枝
    levels: [leafPerTwig > 0, leafPerTwig > 0],
    perBranch: Math.max(1, leafPerTwig),
    clusterCount: 1,
    clusterRadius: 0.05,
    clusterSpread: 0.02,
    size: leafSize,
    sizeVariance: 0.18,
    width: leafWidth,
    // 竹子是细长披针叶 (lance), 不用叶形混合, 免得混进橡树/椭圆叶
    shape: 'lance',
    shapeMix: [],
    segments: 4,
    curl: 0.08,
    fold: 0.12,
    // 竿上的叶只长在上段 (branchStart 以下光竿, 这是竹林最容易被认出的剪影)
    startT: branchStart,
    endT: 1.0,
    pitch: -18,
    pitchVariance: 26,
    droop: leafDroop,
    rollVariance: 120,
    faceUp: 0.35,
    twist: 0.1,
    petiole: 0.02,
  }

  const bark = {
    ...params.bark,
    // 竹竿是革质光滑面: 高频绒毛噪声要压低, 否则会像橡树皮
    roughness: 0.6,
    bump: 0.75,
    normalScale: 0.6,
    // 顶点色混合必须压低: 默认 0.9 时树皮贴图只占 10% 权重, 竹节环会被顶点色吞掉
    // (实测: 只有把贴图权重提上来, 竿上才看得见"节")。
    vertexColorMix: 0.25,
    // V 方向按"节数 / 每块贴图几条环"反推贴图重复次数。
    // 注意 barkSkin 的 UV **以米为单位** (v = 沿枝弧长, u = 周长), 不是 0..1,
    // 所以每米重复次数 R 满足: 竿长高度 × R × BAMBOO_NODE_BANDS = nodeCount
    //   -> R = nodeCount / (BAMBOO_NODE_BANDS × height)。
    // 早先写成 nodeCount / BANDS (漏了 height) 会得到每米 40+ 道环, 糊成一片看不出竹节。
    uvScaleV: nodeCount / (BAMBOO_NODE_BANDS * height),
    uvScaleU: 1.0,
    procedural: {
      ...params.bark.procedural,
      enabled: true,
      style: 'bamboo',
      scale: 1,
      contrast: 0.32,
    },
  }

  return {
    ...params,
    trunk,
    bark,
    branches: {
      ...params.branches,
      levels: 2,
      // 竿与竿之间不该有"顶端优势"造成的递减 (每根竿都接近同样高),
      // 侧枝也交给 twigLevel 自己的窗口控制
      apicalDominance: 0,
      phototropism: 0,
      gravityScale: 1,
      lengthScale: 1,
      radiusScale: 1,
      startSpread: 0,
      mode: 'levels',
      level: [culmLevel, twigLevel],
    },
    leaves,
    // 竹子不结果/不开花 (花是几十年一遇的奇观, 不要默认出现)
    fruit: { ...params.fruit, enabled: false },
    flower: { ...params.flower, enabled: false },
    roots: { ...params.roots, enabled: false },
  }
}
