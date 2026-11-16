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
  const culms = clamp(Math.round(num(b.culms, 10)), 1, 12)
  const tilt = clamp(num(b.tilt, 7), 0, 40)
  const nodeCount = clamp(Math.round(num(b.nodeCount, 14)), 2, 60)
  // 竹节几何凸起强度 (半径倍率): 0 = 只剩贴图环, 0.2 = 默认的真实鼓包
  const nodeBulge = clamp(num(b.nodeBulge, 0.2), 0, 0.6)
  const branchStart = clamp(num(b.branchStart, 0.42), 0.05, 0.95)
  const twigs = clamp(Math.round(num(b.twigs, 5)), 0, 8)
  const twigLength = Math.max(0.1, num(b.twigLength, 0.9))
  const leafPerTwig = clamp(Math.round(num(b.leafPerTwig, 14)), 0, 30)
  const leafSize = Math.max(0.03, num(b.leafSize, 0.3))
  const leafWidth = clamp(num(b.leafWidth, 0.16), 0.04, 0.6)
  const leafDroop = clamp(num(b.leafDroop, 0.55), 0, 1)
  // ---- 根盘 / 竿基离散 ----
  // 现实里的竹丛不是"所有竿从同一个点冒出来": 竿基散落在根茎堆(根盘)的斜面上,
  // 彼此相隔几十厘米, 外圈竿比内圈竿更往外趴。三个参数分别控制
  //   ① 根盘半径: 竿基离丛心的水平距离 (0 = 全部抱在一点, 即旧行为);
  //   ② 竿基离散: 半径/方位的不规则程度 (靠 根盘锥度 + 方位散布 + 根盘椭圆度 实现);
  //   ③ 竿基错落: 每根竿出土高度差 (沿根盘斜面分布, 直接改变它们的半径)。
  const rootSpread = clamp(num(b.rootSpread, 0.8), 0, 2)
  const rootScatter = clamp(num(b.rootScatter, 0.55), 0, 1)
  const rootStagger = clamp(num(b.rootStagger, 0.12), 0, 0.6)

  // 丛基不再是一根"细短茎", 而是**根盘**: 一块低矮的锥形根茎堆。
  // 竿基贴在它的斜面上 —— 半径由"贴附高度"决定, 所以竿与竿的基部天然相隔一段距离;
  // rootSpread=0 时退化成旧行为 (细短茎, 所有竿抱在一起)。
  const clumped = rootSpread <= 0.02
  const moundRadius = clumped ? culmRadius * 1.6 : rootSpread
  // 锥度决定"上下半径差": 越锥, 贴在根盘不同高度的竿半径差越大 = 离散感越强
  const moundTaper = clumped ? 0.85 : clamp(0.52 - rootScatter * 0.22, 0.26, 0.6)
  // 根盘埋入地下: 竿基全部在地面以下、按根盘半径散开, 各自"破土而出"。
  // 为什么要埋: 竹子的根茎本来就在地下 —— 地面上留一个 1.6 m 宽的绿锥体会被读成
  // "花盆/石头"(实测过), 埋掉之后只剩每根竿自己的出土点, 丛基离散才不突兀。
  // rootSpread=0 (抱团模式) 不埋: 保持旧形态 (细短茎直接立在地面上)。
  // 下沉 1.15×高度: 竿基的 t 抖动上限是 0.45, startJitter 会把个别竿抬到 t≈1,
  // 1.0 倍下沉时那根竿的基部正好卡在地面 (实测能看到一小截断口贴地), 留 0.15 余量即可埋干净。
  const moundSink = clumped ? 0 : baseHeight * 1.15
  const trunk = {
    ...params.trunk,
    height: baseHeight,
    // 根盘下沉 (米): 埋进地下, 见上面 moundSink 的说明
    baseY: -moundSink,
    baseRadius: moundRadius,
    taper: moundTaper,
    radiusCurve: 1.0,
    segments: 6,
    radialSegments: 10,
    curve: 0.02,
    curveVariance: 0.02,
    lean: 0.02,
    leanDirection: 0,
    twist: 0,
    // 根盘不能被读成"一根柱子/一个光滑圆球": 加节瘤 + 截面噪声, 让它像一团根茎堆。
    // (实测: 光滑锥体在这个尺度上看起来像"花盆", 加了噪声才像根盘)
    gnarl: 0.5,
    crossNoise: 0.25,
    knots: clumped ? 0 : 2,
    knotSize: 0.5,
    knotStrength: 0.7,
    knotSpread: 0.12,
    knotAngle: 1.0,
    // 根盘贴着地面外扩: 一点点 flare 让底盘略胖, 像一坨根茎堆而不是一根柱子。
    // 注意 flare 会把底部半径成倍放大 (flare=1.25 时最外圈能到 2 倍 rootSpread),
    // 所以这里只给 0.35 —— 竿基半径要贴近用户设定的"根盘半径"。
    flare: clumped ? 1.1 : 0.35,
    flareHeight: clumped ? 0.9 : 0.5,
    // 椭圆度: 让根盘不是正圆, 竿基半径随方位变化 (离散度的来源之一)
    squash: clumped ? 1 : 1 - rootScatter * 0.28,
    // 竹丛不分叉 (竿数由 bamboo.culms 控制, 走 L1 而不是 trunk.fork)
    fork: { enabled: false },
  }

  // 竿长 = 竹高 → 相对丛基高度的比例。这里不受 applyStage 的 lengthRatio 夹取影响
  // (夹取发生在物种预设阶段, 而本函数在 build 时执行)。
  // 注意不要再给下沉量做补偿: 竿基埋在地下, 顶端本来就跟着低 ~0.3 m,
  // 补回来反而让 HUD 树高比"竹高"多出 1.5 m (实测过)。
  const culmRatio = height / baseHeight
  // 半径比按"竿基实际贴附处的根盘半径"算: 竿径应当约等于 culmRadius,
  // 不能拿根部半径直接除 (那样竿子会随根盘一起变粗)。
  const attachRadius = Math.max(culmRadius * 1.2, moundRadius * (1 + moundTaper) * 0.5)
  const culmRadiusRatio = culmRadius / (attachRadius * 0.95)

  // 竹节做成实体几何: 沿竿长每隔 1/nodeCount 处有一圈环状突起。
  // 纵向分段必须跟着"每竿节数"走 —— 实测 14 段/竿时，14 个节里每个节只分到 1 个环,
  // 凸起会被抹平成一个斜坡; 8 环/节 (segments = 8×nodeCount) 才能看出硬边的节。
  const segs = clamp(Math.round(nodeCount * 8), 24, 160)
  const culmLevel = {
    enabled: true,
    count: culms,
    // pitch 是"离父枝轴的夹角": 丛林里的竿几乎与丛基同向, 7° 左右只有轻微外倾
    pitch: tilt,
    pitchVariance: Math.min(6, Math.max(1, tilt * 0.6)),
    lengthRatio: culmRatio,
    lengthVariance: 0.06,
    radiusRatio: culmRadiusRatio,
    // 竿径用绝对值: 竿基散落在根盘不同半径处, 用"相对父枝"的比值会得到
    // 外圈粗、内圈细的竿 (实测相差 4 倍), 与真实竹丛不符。
    radiusAbsolute: culmRadius,
    radiusVariance: 0.08,
    // 竿基沿根盘 8%~88% 高度分布: 视觉上像一丛从根茎堆上冒出来的笋;
    // 高低差由 rootStagger(米) 换算成 t 的抖动 -> 顺带改变它们的贴附半径
    startT: 0.08,
    endT: 0.88,
    startJitter: clamp(rootStagger / Math.max(0.08, baseHeight), 0.02, 0.45),
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
    // 方位散布 (单位 π 弧度): 默认 0.18 时竿基在根盘圆周上还算均匀,
    // 离散度越大越"乱", 避免看出是规则的圆环
    spread: 0.15 + rootScatter * 0.45,
    segments: segs,
    radialSegments: 10,
    // 竹节突起: count = 每竿节数, width 用 t 单位 (1.5 个环 ≈ 节距的 19%)
    // bulge 是整圈鼓包, ridge 是鼓包中央更窄的凸脊 (节的硬边), ridge 固定取 bulge 的 0.6 倍。
    // 默认 0.2 是"3 m 外能看出鼓包、特写能看出硬边"的折中; 再大就像一串竹笛的接头。
    nodeBands: {
      count: nodeCount,
      bulge: nodeBulge,
      ridge: nodeBulge * 0.6,
      width: 1.5 / segs,
    },
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
