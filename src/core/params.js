/**
 * 参数中心 (single source of truth)
 * ------------------------------------------------------------
 * 所有面板都读写这个结构; 生成器只读它。
 * serializeGroup() 用来做"变更分组"判断:
 *   geometry 变更 -> 重建几何体
 *   material 变更 -> 只更新材质 / uniform (无需重建)
 *   wind     变更 -> 只更新风场 uniform
 *
 * 作用: 定义整棵树的"参数树"形状 (defaultParams), 以及围绕它的三个基本操作:
 *   cloneParams   深拷贝 (参数树是纯 JSON, 用 JSON 往返实现)
 *   mergeParams   深合并一个"补丁" (预设/导入用), 只覆盖目标里已存在的键
 *   normalizeParams 补齐结构 (导入旧版本 JSON 时保证字段齐全、数组长度对)
 * 输入 / 输出: 全是纯数据对象, 没有副作用; 三个函数都**返回新对象**, 不修改入参。
 * 与其他模块的关系:
 *   species.js / presets.js 用 mergeParams 把"物种形态补丁"盖到 defaultParams 上
 *   store/treeStore.js      持有唯一一份 params, 改动后按 serializeGroup 分组派发重建
 *   各生成器 (treeBuilder / leaf / fruit / materials / sceneManager) 只读不写
 * 单位约定 (整套参数统一):
 *   长度 = 米; 角度参数在参数树里**多数是度** (pitch/leanDirection/fork.angle…),
 *   少数明确标注为弧度的 (curve/gravity/twist/lean/knotAngle) 是弧度;
 *   比例类参数是 0..1 归一化或"相对父级"的倍率 (如 lengthRatio / radiusRatio)。
 * 确定性约定: 参数树里没有随机量, 随机全靠 seed 在生成器内部由 rng.js 推导,
 *   因此同一份 params + 同一 seed 必然生成同一棵树。
 */

/** 树枝最大层级数 (树干算第 0 层, 所以最多 5 级枝条 = L1..L5)。多处硬编码夹取都用它 */
export const MAX_LEVELS = 5

/**
 * 枝条层级默认值 (按层级递增: 越细碎、越柔)。
 *
 * 返回的是 L(i) 这一层"一根枝条"的完整配置。字段含义 (逐级递增的规律见下方表):
 *   enabled        该层是否参与生成 (false = 整层跳过, 但 level 数组长度仍保持 MAX_LEVELS)
 *   count          每根父枝上生成几根; 总枝量是各层连乘, 所以这一项最危险
 *   pitch          与父枝轴线的夹角 (度); 越深层越接近 40°, 枝条越平展
 *   pitchVariance  夹角随机幅度 (度, ±)
 *   lengthRatio    长度 = 父枝长度 × 该值 (相对值, 不是米)
 *   lengthVariance 各枝长度的随机偏差 (0..1 的比例)
 *   radiusRatio    基部半径 = 父枝在该处的半径 × 该值 (相对值)
 *   radiusVariance 各枝半径的随机偏差 (比例)
 *   startT/endT    在父枝上的分布区间, 0 = 父枝基部, 1 = 父枝梢部
 *   startJitter    每个枝条起始位置的随机偏移量 (避免整齐的梳齿状排列)
 *   taper          锥度 = 梢部半径 ÷ 基部半径
 *   radiusCurve    半径沿枝长的衰减曲线指数 (>1 = 基部更粗、梢部骤细)
 *   curve          枝条自身的弯曲弧度 (弧度制)
 *   curveVariance  弯曲量的随机幅度
 *   gravity        重力弯曲 (弧度, 负值下垂); 深层为负 = 末梢自然下垂
 *   twist          沿枝长的截面扭转量 (弧度)
 *   phyllotaxis    相邻枝条绕父枝的方位角差 (度); 137.5 = 黄金角
 *   spread         方位角的随机离散程度 (0 = 严格按叶序角)
 *   upBias         额外向上 (趋光) 偏置, 度
 *   segments       沿长度的分段数 (越多越平滑, 顶点也越多)
 *   radialSegments 截面周向边数 (受 LOD 的 barkDetail 整体缩放)
 *   crossSection   截面形状: 'round' 圆 / 星形 / 方形 (省面数)
 *   starDepth      星形截面的棱深 (只在 crossSection 为星形时生效)
 *   windGain       该级枝条的柔度增益, 累加成顶点的 aWind (越大摆得越凶)
 *
 * 消费方: treeBuilder.js 递归生长时读取 (几何骨架);
 *         barkSkin / speedtreeBark 读取 segments / radialSegments / crossSection 定拓扑;
 *         materials 的风场着色器读取 windGain。
 *
 * @param {number} i 层下标 (0 = L1 主枝); 越界时夹到最后一层, 不会返回 undefined
 * @returns {object} 该层的默认配置, **深拷贝** (调用方可随意修改, 不会污染这张表)
 */
export function defaultLevel(i) {
  const table = [
    // L1 主枝
    {
      enabled: true, count: 7, pitch: 62, pitchVariance: 14,
      lengthRatio: 0.42, lengthVariance: 0.22, radiusRatio: 0.40, radiusVariance: 0.18,
      startT: 0.22, endT: 0.96, startJitter: 0.05,
      taper: 0.50, radiusCurve: 1.25, curve: 0.30, curveVariance: 0.35,
      gravity: 0.06, twist: 0.25, phyllotaxis: 137.5, spread: 0.14,
      upBias: 0.06, segments: 9, radialSegments: 7,
      crossSection: 'round', starDepth: 0.2, windGain: 0.55,
    },
    // L2
    {
      enabled: true, count: 5, pitch: 52, pitchVariance: 16,
      lengthRatio: 0.55, lengthVariance: 0.25, radiusRatio: 0.46, radiusVariance: 0.2,
      startT: 0.10, endT: 0.99, startJitter: 0.06,
      taper: 0.50, radiusCurve: 1.2, curve: 0.34, curveVariance: 0.4,
      gravity: 0.0, twist: 0.3, phyllotaxis: 137.5, spread: 0.25,
      upBias: 0.04, segments: 7, radialSegments: 5,
      crossSection: 'round', starDepth: 0.2, windGain: 0.75,
    },
    // L3
    {
      enabled: true, count: 4, pitch: 46, pitchVariance: 18,
      lengthRatio: 0.62, lengthVariance: 0.28, radiusRatio: 0.5, radiusVariance: 0.22,
      startT: 0.08, endT: 1.0, startJitter: 0.07,
      taper: 0.45, radiusCurve: 1.15, curve: 0.38, curveVariance: 0.45,
      gravity: -0.04, twist: 0.35, phyllotaxis: 137.5, spread: 0.35,
      upBias: 0.02, segments: 5, radialSegments: 4,
      crossSection: 'round', starDepth: 0.2, windGain: 0.9,
    },
    // L4
    {
      enabled: true, count: 3, pitch: 42, pitchVariance: 20,
      lengthRatio: 0.68, lengthVariance: 0.3, radiusRatio: 0.55, radiusVariance: 0.25,
      startT: 0.05, endT: 1.0, startJitter: 0.08,
      taper: 0.4, radiusCurve: 1.1, curve: 0.42, curveVariance: 0.5,
      gravity: -0.08, twist: 0.4, phyllotaxis: 137.5, spread: 0.45,
      upBias: 0.0, segments: 4, radialSegments: 4,
      crossSection: 'round', starDepth: 0.2, windGain: 1.0,
    },
    // L5
    {
      enabled: true, count: 2, pitch: 40, pitchVariance: 22,
      lengthRatio: 0.7, lengthVariance: 0.32, radiusRatio: 0.6, radiusVariance: 0.28,
      startT: 0.05, endT: 1.0, startJitter: 0.08,
      taper: 0.35, radiusCurve: 1.05, curve: 0.45, curveVariance: 0.55,
      gravity: -0.1, twist: 0.45, phyllotaxis: 137.5, spread: 0.55,
      upBias: 0.0, segments: 3, radialSegments: 3,
      crossSection: 'round', starDepth: 0.2, windGain: 1.0,
    },
  ]
  return JSON.parse(JSON.stringify(table[Math.min(i, table.length - 1)]))
}

/**
 * 兼容旧会话/旧 JSON：补齐后加的功能开关默认值。
 * HMR 不会重新执行 normalizeParams，已打开的页面需要主动调用一次。
 *
 * 为什么需要单独一个函数: localStorage 里的会话与用户导出的 JSON 都是"当时那一刻"
 * 的参数树, 后加的分组 (落叶/落叶堆积/落花/落花堆积) 在这些旧数据里根本不存在,
 * 直接读 params.fall.count 会抛 TypeError。normalizeParams 能补全整棵树,
 * 但它必须走 mergeParams 的深合并 (较慢), 而 HMR 场景下参数对象已经在内存里,
 * 只需要把"缺的顶层键"补上, 所以提供一个轻量版。
 *
 * 行为:
 *   - 只补**顶层缺失键** (undefined), 已存在的值一律不动 (包括用户显式设成 null 的)
 *   - 就地修改 params 并返回同一个引用 (与 deep merge 返回新对象不同)
 *   - 只覆盖 6 个后来新增的分组; 更早的字段由参数树天然保证存在
 *
 * @param {object} params 参数树 (可为 null/undefined, 此时原样返回)
 * @returns {object} 同一个 params 引用
 */
export function ensureFeatureDefaults(params) {
  if (!params) return params
  const d = defaultParams()
  const fill = (obj, def) => {
    if (!obj) return
    for (const [k, v] of Object.entries(def)) {
      if (obj[k] === undefined) obj[k] = v
    }
  }
  fill(params.fall, d.fall)
  fill(params.litter, d.litter)
  fill(params.flowerFall, d.flowerFall)
  fill(params.flowerLitter, d.flowerLitter)
  fill(params.leaves, d.leaves)
  fill(params.flower, d.flower)
  return params
}

/**
 * 全量默认参数树 (即 schema 定义 + 出厂默认值, 两者合一)。
 *
 * 顶层分组一览 (按重建代价从高到低):
 *   seed / auto / classify   元数据: 种子、混乱度、树种/阶段/季节标签 (不直接参与几何)
 *   trunk                    树干: 高度/半径/锥度/弯曲/节瘤/分叉 (含 fork 子对象)
 *   roots                    树根
 *   branches                 树枝: levels(层级数) + level[5] 每层配置 + 全局修正
 *   leaves / flower / fruit  植被: 叶片 / 花朵 / 果实
 *   fall / litter            落叶与地面落叶堆 (纯特效, 不改几何拓扑)
 *   flowerFall / flowerLitter 落花与落花堆 (与落叶同构)
 *   particles                从叶片位置发射的粒子
 *   branchEdits              单枝手工编辑 (key = 骨架分支下标)
 *   bark / leafMat / custom  材质: 树皮 / 树叶 / 自定义 GLSL
 *   wind / growth            动画: 风场与生长 (纯 uniform, 不重建几何)
 *   exportOptions / scene    导出开关 / 场景灯光
 *   lod / ao                 性能 (动态 LOD) 与顶点色环境光遮蔽
 *
 * 约定: 每次调用都新建整棵树 (包括嵌套对象与数组), 所以调用方可以放心改返回值;
 * 不要把它缓存成模块级常量, 否则会被 mergeParams / 面板就地改坏。
 *
 * @returns {object} 一份全新的、可自由修改的完整参数树
 */
export function defaultParams() {
  return {
    // 出厂种子: 决定"打开页面第一眼看到的那棵树"; 换种子 = 换同种群的另一个个体
    seed: 20240607,
    // auto 只是"自动生成面板的状态记忆" (混乱度滑杆上次停在哪), 不直接影响几何
    auto: { chaos: 0.6 },

    // ---------------- 分类 (树种 / 生长阶段 / 季节) ----------------
    // 这三个只作为"预设元数据"记录在参数里 (方便 JSON 复现), 由 store 组合出实际参数。
    // 也就是说: 改这里**不会**改变已经展开进各分组的形态, 真正生效的是 species.composeTree()。
    classify: { species: 'oak', stage: 'mature', season: 'summer' },

    /* 树干 = 第 0 层, 也是所有长度/半径的基准:
     * 树枝长度按 lengthRatio 相对它缩放, 半径按 radiusRatio 相对父枝半径缩放。
     * 单位: height / baseRadius / flareHeight 相关的是米; curve / lean / twist /
     *       knotAngle 是弧度; leanDirection 是度; twistProfile 的 5 个点是度。
     * 几何由 treeBuilder.js 生成; segments / radialSegments 直接决定顶点数。 */
    // ---------------- 树干 ----------------
    trunk: {
      height: 9.0,
      baseRadius: 0.34,
      taper: 0.06,          // 顶部半径 / 底部半径
      radiusCurve: 1.35,    // 锥度曲线指数 (>1 = 根部粗壮)
      segments: 14,         // 纵向分段
      radialSegments: 10,   // 周向分段
      curve: 0.38,          // 总弯曲弧度
      curveVariance: 0.3,
      lean: 0.06,           // 倾斜 (弧度)
      leanDirection: 20,    // 倾斜方向(度)
      twist: 0.18,          // 沿高度的扭转
      // 扭曲曲线: 5 个控制点 (t=0/25/50/75/100%) 的额外扭转角(度), 由视口句柄编辑
      twistProfile: [0, 0, 0, 0, 0],
      gnarl: 0.35,          // 不规则/节瘤感
      flare: 0.9,           // 根部外扩
      flareHeight: 0.18,    // 外扩影响的高度比例
      knots: 2,             // 节瘤数量
      knotSize: 0.35,       // 节瘤凸起强度
      knotStrength: 0.75,   // 节瘤整体倍率 (1 = 原始强度, 0 = 关闭凸起)
      knotSpread: 0.05,     // 节瘤纵向跨度 (t 方向半宽)
      knotAngle: 0.7,       // 节瘤角向跨度 (弧度半宽)
      squash: 1.0,          // 椭圆化 (1 = 圆)
      onePiece: false,      // 树干/树枝/树根一体建模: 导出合并为单个 Bark, 分支基部更融合
      fork: {
        enabled: false,    // 主干分叉 (多主枝): 橡树这类乔木常在 1/3 高处分成 2~4 条主枝
        count: 3,          // 分出的主枝数 (2~6)
        height: 0.34,      // 分叉高度 (占树干比例)
        angle: 26,         // 主枝与主干轴线的夹角(度)
        spread: 0.8,       // 方位离散度 (0 = 完全均匀)
        radiusScale: 0.62, // 主枝基部半径 ÷ 分叉处主干半径
        lengthScale: 1.0,  // 主枝长度倍率 (基准 = 分叉点以上的剩余高度)
        taper: 0.3,        // 主枝自身锥度
        curve: 0.4,        // 主枝弯曲
        gravity: 0.03,     // 主枝重力 (负 = 下垂)
        trunkShrink: 0.62, // 分叉点以上主干变细的比例 (避免半径台阶)
      },
    },

    /* 树根: 从树干基部向外下方生长的锥形管, 独立于树干几何 (单独节点)。
     * pitch > 90° 表示向下扎; sink 控制沿长度继续下弯的量;
     * autoStagger 用来解决"多根方位重叠时窗口挤在同一高度"的观感问题。 */
    // ---------------- 树根 ----------------
    roots: {
      enabled: false,
      count: 5,
      length: 0.22,        // 相对树干高度
      lengthVariance: 0.35,
      radiusRatio: 0.35,
      spread: 1.0,         // 0..1, 1 = 完全辐射
      pitch: 118,          // 与树干夹角(>90 = 向下)
      segments: 5,
      radialSegments: 5,
      curve: 0.5,
      sink: 0.35,          // 向下垂的强度
      heightOffset: 0,     // 树根整体上下偏移 (相对树高; 正=上移)
      autoStagger: true,   // 自动把方位重叠的根错开到不同高度, 避免窗口挤在一起
    },

    /* 树枝: levels 是有效层数 (1..MAX_LEVELS), level[i] 是第 i+1 层的配置 (字段见 defaultLevel)。
     * 下面几个 *Scale 是全局乘算修正 —— 想整体压一下形状时改这里, 不必逐层调;
     * twistProfile 是视口句柄编辑出来的 5 控制点扭转曲线 (度), 叠加在每层 twist 之上。
     * 注意: level 数组长度恒为 MAX_LEVELS, 即使某层 enabled=false 也保留占位。 */
    // ---------------- 树枝 ----------------
    branches: {
      levels: 3,                              // 有效层级数 1..5
      level: Array.from({ length: MAX_LEVELS }, (_, i) => defaultLevel(i)),
      gravityScale: 1.0,                      // 全局重力倍率
      phototropism: 0.05,                     // 全局向上趋光
      lengthScale: 1.0,                       // 全局枝条长度倍率
      radiusScale: 1.0,                       // 全局枝条半径倍率
      startSpread: 0.0,                       // 上层枝条起始位置的整体上下偏移
      apicalDominance: 0.35,                  // 顶端优势: 越靠顶端枝条越短
      // 扭曲曲线: 沿每条枝条长度 5 个控制点 (t=0/25/50/75/100%) 的额外扭转角(度)
      twistProfile: [0, 0, 0, 0, 0],
    },

    /* 树叶: 按"叶簇"挂在 branches.levels 指定的层上。
     * 叶片总数 ≈ 每枝叶簇位置数 × 每簇叶片数 × 枝条数 —— 面数压力主要来自这里,
     * 所以 species.js / presets.js 都有预算回缩逻辑来压这两个密度参数。
     * levels[5] 是"每层枝条是否长叶"的开关, 与 branches.level[i].enabled 是两件事:
     *   前者说"这层的枝上有没有叶子", 后者说"这层枝存不存在"。
     * cardMode=true 时叶形轮廓来自贴图 alpha (照片级); shape 只在程序化模式下使用。
     * 单位: size/叶柄 相关的长度是米; pitch/pitchVariance/rollVariance/modelRotation 是度。 */
    // ---------------- 树叶 ----------------
    leaves: {
      enabled: true,
      levels: [false, false, true, true, true], // 每层枝条是否长叶
      perBranch: 9,        // 每条枝条上的叶簇位置数量
      clusterCount: 3,     // 每个位置的叶片数量
      clusterRadius: 0,    // 叶簇半径(米): 默认 0 = 叶簇不额外散开
      clusterSpread: 0,    // 叶簇离散度: 默认 0 = 叶片贴着取样点生长
      size: 0.42,          // 叶片长度(米)
      sizeVariance: 0.28,
      width: 0.78,         // 宽/长
      shape: 'oval',        // 程序化叶形: oval/birch/lance/needle/maple/oak/palmate/cordate
      segments: 5,
      curl: 0.18,          // 纵向弯曲
      fold: 0.28,          // 横向 V 形折叠
      startT: 0,           // 分布起始位置: 默认 0 = 从枝条基部开始长叶
      endT: 1.0,
      // 树枝环绕式生长: 沿每根树枝螺旋分布叶簇 (不依赖树干)
      branchWrap: false,
      branchWrapTurns: 2.0,
      pitch: -30,          // 相对枝条方向的俯仰(度, 负=下垂)
      pitchVariance: 28,
      droop: 0.35,         // 自重下垂
      rollVariance: 180,
      faceUp: 0.5,         // 叶面朝上程度 0..1
      twist: 0.25,         // 叶柄扭转
      modelRotation: 0,    // 叶模型绕叶面法线旋转 (度); 贴图偏移导致叶柄反向时用 ±180 校正
      color: '#5da03a',
      colorTip: '#a6d45e',
      colorVariance: 0.22,
      petiole: 0.12,       // 叶柄长度(相对叶长)
      // 叶形混合: 同一棵树可混用多种叶形 (不同树种叶形差别很大)
      // 每项 { shape, weight }, weight 为相对比例; 留空 = 只用 shape
      // shapeMix 保留给树叶使用; 花朵固定为碗形
      // 叶片卡片模式: 叶形轮廓直接用贴图 alpha (照片级), 而不是程序化轮廓
      cardMode: true,        // 默认用素材卡片 (启动时随机挑选)
      cardAspect: 1,       // 选中卡片的 宽/高 (由 UI 从卡片库写入)
      cardCurl: 0.1,       // 卡片的轻微弓弯
      cardFold: 0.12,      // 卡片沿中脉的折叠
    },

    /* 落叶: 每片都是真实叶片卡片, 全部合批成一个几何体, 翻滚/打旋/受风在顶点着色器里算,
     * 所以改变 count 只影响一次绘制, 不增加 draw call。
     * 纯特效: 不改树的几何; inheritLeafMat 决定是否跟随树叶材质的光照/自发光参数。 */
    // ---------------- 落叶 (从树冠落下的叶片) ----------------
    fall: {
      enabled: false,
      inheritLeafMat: true, // 落叶继承树叶的自发光/反光/散光
      cardId: '',          // 落叶自己的贴图卡片 (空 = 跟随树叶当前卡片)
      count: 80,           // 同时飘落的叶片数
      speed: 1.0,          // 下落速度倍率
      size: 0.55,          // 落叶大小 (相对叶片)
      swirl: 1.0,          // 打旋/摆动幅度
      spinSpeed: 1.2,      // 翻滚自旋速度
      stagger: 0.6,        // 横向错开幅度 (避免叠在一起落)
      spread: 1.0,         // 出生点范围 = 树冠半径 × 该值
      windFollow: 1.0,     // 受风影响倍率 (与树木/粒子同一套风场)
      color: '#d9a441',    // 无贴图时的落叶颜色 (秋叶)
      opacity: 1.0,
      alphaTest: 0.35,
    },

    /* 地面落叶堆积: 随机朝向/倾斜/层叠铺在树冠投影圆盘内, 中心更厚。
     * 用无光照材质渲染 (不吃灯光), 所以亮度只能靠 shade 控制, 也不参与 AO 计算。 */
    // ---------------- 地面落叶堆积 ----------------
    litter: {
      enabled: false,
      inheritLeafMat: true, // 落叶堆继承树叶的自发光/反光/散光
      cardId: '',          // 堆积自己的贴图卡片 (空 = 跟随树叶当前卡片)
      count: 260,          // 地面落叶数
      radius: 1.0,         // 分布半径 = 树冠半径 × 该值
      size: 0.55,          // 单片落叶大小 (相对叶片)
      thickness: 0.06,     // 堆积厚度(米): 越大层叠越高
      color: '#ffffff',    // 落叶基色 (与贴图相乘; 白色=保持贴图原色)
      colorVariance: 0.45, // 单片色差 (枯黄/褐/橙 混杂)
      alphaTest: 0.35,
      shade: 0.78,         // 明暗系数 (地面落叶用无光照渲染, 这个是唯一的亮度控制)
    },

    /* 粒子发射: 从叶片位置采样发射, 纯顶点着色器动画 (CPU 不更新)。
     * windFollow 让粒子与树木共用同一套风向/强度/阵风, 叶子与光点才会同步飘。 */
    // ---------------- 粒子发射 (从叶片位置发射) ----------------
    particles: {
      enabled: false,
      count: 240,          // 粒子数
      size: 0.05,          // 粒子大小(米, 世界尺度)
      speed: 0.35,         // 生命循环速度 (每秒循环比例)
      fall: 1.0,           // 下落距离倍率
      sway: 1.0,           // 横向飘动幅度倍率
      swirl: 0.6,          // 打旋
      color: '#fff0b8',    // 粒子颜色 (花粉末/光点)
      opacity: 0.85,
      glow: 0.8,           // 自发光强度 (叠加模式更亮)
      spread: 1.0,         // 采样范围 = 树冠半径 × 该值
      windFollow: 1.0,     // 受风影响倍率 (与树木同一套风向/强度/阵风)
    },

    /* 果实: 旋转体建模 (坚果 + 粗糙壳斗帽 + 果柄), 顶点色区分坚果与壳斗两部分。
     * maxCount / chance 是面数保护 (每个果实约 200~300 面): 只有一部分枝条结果才自然。
     * 单位: size / clusterRadius 米; droop 0..1 无量纲。 */
    // ---------------- 果实 ----------------
    fruit: {
      enabled: false,
      type: 'acorn',       // acorn | berry | cone | nut
      levels: [false, false, false, true, false], // 挂在哪些层级
      perBranch: 2,        // 每条枝条上的果实簇数量
      clusterCount: 2,     // 每簇果实数量 (参考图: 橡果 2~3 个一簇)
      maxCount: 420,       // 整棵树果实上限 (控制面数)
      chance: 0.5,         // 只有一部分枝条结果
      clusterRadius: 0.07,
      size: 0.16,          // 果实长度(米)
      sizeVariance: 0.2,
      droop: 0.5,          // 下垂程度 (橡果挂在枝下)
      color: '#c8a86a',    // 坚果色
      capColor: '#8a6f45', // 壳斗帽色
      colorVariance: 0.18,
      radial: 8,
    },

    // 单枝手工编辑: 以骨架分支下标为 key (同一 seed/结构下稳定)
    // { radiusScale, moveX, moveY, moveZ, rotX, rotY, rotZ, twist }
    branchEdits: {},

    /* 树皮材质: pipeline 决定走哪条几何管线 ——
     *   'speedtree' = 分枝管 + 领口 (默认, 多闭合分量)
     *   'skin'      = 单张连续蒙皮 (boundary = 0 的单连通面)
     * 程序化花纹由 color (深色端) / color2 (浅色端) 生成; uvScaleU / uvScaleV 都是
     * "每米"重复次数 (分别沿周长 / 沿树高), 因为 UV 坐标本身就是米为单位的物理弧长,
     * 所以树干与细枝的纹素密度一致, 树越高纹路越多, 天然不会拉伸。
     * texture / normalTexture 是用户上传的 dataURL: 一旦有值就替换程序化花纹。 */
    // ---------------- 树皮材质 ----------------
    bark: {
      pipeline: 'speedtree',    // 'skin' = 单张连续蒙皮; 'speedtree' = 分枝管+领口 (默认)
      color: '#9a7a54',
      color2: '#b99b73',
      tint: '#ffffff',
      vertexColorMix: 0.9,
      roughness: 0.88,
      metalness: 0.0,
      normalScale: 1.0,
      normalFromAlbedo: 1.4,   // 照片树皮: 从颜色贴图自动生成法线 (0 = 关闭)
      uvWarp: 0.0,             // 贴图扭曲强度 (0 = 不扭曲; 打散平铺重复感)
      uvWarpScale: 8.0,        // 扭曲频率
      uvScaleU: 1.0,
      uvScaleV: 1.0,
      bump: 1.0,
      texture: '',         // 用户上传的贴图(dataURL)
      normalTexture: '',
      procedural: { enabled: true, style: 'rough', scale: 1.0, contrast: 0.5 },
    },

    /* 花朵: 独立于树叶的第二套植被系统 (复用同一套生成代码, 但参数完全独立)。
     * cardMode=true 时是平面花卡, 轮廓由贴图 alpha 决定; useShape=true 才改用程序化叶形。
     * 光照三件套 (emissive 自发光 / specular 反光 / scatter 散光) 与 leafMat 同构,
     * 但两边互不影响 —— 调花不会动叶子。 */
    // ---------------- 花朵 (独立于树叶, 但基础功能继承树叶) ----------------
    flower: {
      enabled: false,        // 与树叶可同时开启
      levels: [false, true, true, true, true],
      perBranch: 4,          // 每个枝端的花簇数
      // 树枝环绕式生长: 与枝条花朵独立
      branchWrap: false,
      branchWrapTurns: 2.0,
      density: 1,            // 开花密度 (按比例从树叶位置采样)
      clusterCount: 2,       // 每个点位几朵花
      startT: 0,             // 分布起始位置: 默认 0 = 从枝条基部开始开
      endT: 1.0,
      size: 0.42,            // 花朵尺寸 (通常比叶大)
      sizeVariance: 0.2,     // 花朵尺寸随机
      clusterRadius: 0,      // 每簇花朵散布半径: 默认 0 = 不额外散开
      clusterSpread: 0,      // 花朵离散度: 默认 0 = 贴着取样点生长
      pitch: 55,             // 花朵朝向俯仰角
      pitchVariance: 20,
      droop: 0,              // 花朵下垂
      rollVariance: 0.6,     // 朝向随机
      faceUp: true,          // 花朵尽量朝上
      twist: 0,
      modelRotation: 0,      // 花朵模型绕花面法线旋转 (度); 贴图偏移导致花梗反方向时用 ±180 校正
      segments: 3,           // 程序化花形分段
      curl: 0.1,
      fold: 0.05,
      petiole: 0,
      cardCurl: 0.1,
      cardFold: 0.12,
      width: 1.0,
      color: '#f2a7c3',
      colorTip: '#fbe3ec',
      colorVariance: 0.16,
      translucency: 0.7,
      // 花朵材质: 与树叶一致的自发光/反光/散光
      emissive: 0.0,
      emissiveColor: '#ffffff',
      specular: 0.2,
      specularShininess: 24,
      specularColor: '#ffffff',
      scatter: 0.0,
      scatterPower: 2.0,

      texture: '',           // 花朵贴图 (平面花卡, 贴图 alpha 决定轮廓)
      textureU: 0,           // 贴图在模型上的横向偏移
      textureV: 0,           // 贴图在模型上的纵向偏移
      textureRepeat: 1,      // 贴图缩放 (U/V 统一)
      textureRepeatU: 1,     // 贴图横向平铺次数
      textureRepeatV: 1,     // 贴图纵向平铺次数
      textureRotation: 0,    // 贴图旋转 (弧度)
      tintMode: 'texture',   // 花朵贴图染色模式 (同树叶)
      alphaTest: 0.35,      // 贴图裁切阈值: 0 会让透明区变黑边
      normalFromAlbedo: 1.5, // 花朵贴图自动法线 (默认从花瓣明暗生成轮廓, 0 = 关闭)
      cardId: '',
      cardAspect: 1,
      cross: 'none',          // 十字交叉: none | v (竖向交叉) | h (横向交叉) | both
      useShape: false,        // true = 用程序化平面叶形 (shape) 代替照片卡片
      shape: 'oval',          // useShape 时的叶形轮廓
      cardMode: true,        // 花朵 = 平面花卡 (无 3D 模型)
    },

    /* 落花 / 落花堆积: 与落叶、落叶堆积结构一一对应 (字段含义参考 fall / litter),
     * 区别只在于贴图与材质继承的是"花朵"而不是"树叶"。 */
    // ---------------- 落花 / 落花堆积 (参照落叶实现) ----------------
    flowerFall: {
      enabled: false,
      inheritFlowerMat: true, // 落花继承花朵材质的自发光/反光/散光
      cardId: '',          // 空 = 跟随花朵贴图
      count: 140,
      speed: 0.9,
      size: 0.5,
      swirl: 0.8,
      spinSpeed: 1.6,
      stagger: 0.55,
      spread: 1.1,
      windFollow: 0.85,
      color: '#f6c6d8',
      opacity: 0.95,
      alphaTest: 0.3,
    },
    flowerLitter: {
      enabled: false,
      inheritFlowerMat: true, // 落花堆继承花朵材质的自发光/反光/散光
      cardId: '',          // 空 = 跟随花朵贴图
      count: 320,
      radius: 1.25,
      size: 0.42,
      thickness: 0.02,
      color: '#f2b8cf',
      colorVariance: 0.35,
      alphaTest: 0.3,
      shade: 0.82,
    },

    /* 树叶材质: 颜色主要来自顶点色 (烘焙了季节叶色与 AO), 这里控制 PBR、贴图与光照响应。
     * tintMode 决定贴图与叶色的三种关系: texture 原色 / season 跟随季节 / custom 自定义强度。
     * 反光 specular、散光 scatter、自发光 emissive 是三个独立的物理项, 互不替代:
     *   反光 = 湿叶/蜡质叶面的高光; 散光 = 逆光时叶肉透亮; 自发光 = 暗部不发黑。 */
    // ---------------- 树叶材质 ----------------
    leafMat: {
      tint: '#ffffff',
      // 贴图染色模式: texture = 贴图原色 (全彩照片卡片); season = 跟随季节叶色;
      // custom = 用下面的"染色强度"手动控制
      tintMode: 'season',
      vertexColorMix: 1.0,
      roughness: 0.62,
      metalness: 0.0,
      alphaTest: 0.4,
      doubleSided: true,
      // ---- 双面叶片: 正面/背面独立颜色与贴图 ----
      backEnabled: false,       // true = 背面使用下面的颜色/贴图 (自动启用双面渲染)
      backColor: '#b9d49a',     // 背面基础颜色 (与背面贴图相乘)
      backTexture: '',          // 背面贴图 (含 alpha); 留空则沿用正面贴图, 只换颜色
      translucency: 0.45,
      // ---- 反光 (叶面高光: 湿叶/蜡质叶面) ----
      specular: 0.25,          // 高光强度
      specularShininess: 28,   // 高光锐度 (越大越集中)
      specularColor: '#ffffff',
      // ---- 散光 (叶肉散射: 边缘/逆光处发亮) ----
      scatter: 0.0,            // 边缘散射强度
      scatterPower: 2.0,       // 边缘锐度 (越大越贴边)
      emissive: 0.0,
      emissiveColor: '#ffffff',   // 自发光底色 (与季节叶色解耦)
      // 从颜色贴图自动生成法线贴图 (亮度当高度场 -> Sobel 梯度); 0 = 关闭
      normalFromAlbedo: 0.8,
      normalScale: 1.0,           // 法线强度 (normalMap 缩放)
      texture: '',
      textureU: 0,              // 叶片贴图横向偏移 (与花朵一致的 UV 偏移)
      textureV: 0,              // 叶片贴图纵向偏移
      textureRepeatU: 1,        // 叶片贴图横向平铺
      textureRepeatV: 1,        // 叶片贴图纵向平铺
      textureRotation: 0,       // 叶片贴图旋转 (弧度)
      normalTexture: '',
    },

    /* 自定义 GLSL: 注入到标准 PBR 材质的顶点/片元阶段。
     * 执行时机 (materials.js 里的注入点): 顶点代码在风场与生长位移**之后**,
     * 片元代码在顶点色与色调相乘**之后** —— 所以能改到最终颜色。
     * 编译失败不会黑屏, 而是把编译日志抛到视口顶部 (由 sceneManager 处理)。 */
    // ---------------- 自定义 GLSL ----------------
    custom: {
      enabled: true,
      vertex: '// 可用: position / transformed / normal / uv / uTime / uSeed / aWind\n// transformed.xz += sin(uTime + position.y) * 0.05;',
      fragment: '// 可用: diffuseColor / vTreeUv / vColor(需用 .rgb) / uTime / uSeed\n// diffuseColor.rgb *= 0.9 + 0.1 * sin(uTime + vTreeUv.y * 10.0);',
    },

    /* 风场: 全部在顶点着色器里算, 这里的参数只是 uniform, 改动**不重建几何**。
     * auto=true 时整组参数由 autoWind(seed, intensity) 重新推导 (见 autowind.js);
     * 手改任意细节参数会让面板关掉自动模式 (那是 UI 的约定, 不是这里的逻辑)。
     * 相位沿枝条累积 → 梢部摆幅最大; flexFalloff 控制"只有梢部在动"的程度。
     * 单位: strength 米; direction 度 (0° = +X, 90° = +Z); 其余多为无量纲倍率。 */
    // ---------------- 风场 ----------------
    wind: {
      enabled: true,
      auto: true,
      intensity: 0.3,      // 用户看到的"风力"总滑杆
      direction: 45,       // 风向(度)
      strength: 0.15,      // 基础位移(米): 树梢顺风偏移量级 (动态摆动占绝大部分)
      speed: 0.8,          // 摆动速度
      frequency: 1.0,      // 高频分量密度 (次波/抖动的频率倍率)
      gust: 0.5,           // 阵风强度: 压低摆动低谷, 越大起伏越明显
      gustSpeed: 0.16,
      turbulence: 0.12,    // 湍流(横向小摆动)
      spatialScale: 0.22,  // 相位空间尺度
      bias: 0.3,           // 顺风偏置: 只抬摆动低谷 (=风只推不拉), 不削峰值
      flexFalloff: 1.5,    // 柔度衰减指数
      barkSway: 0.6,       // 树干/树枝摆幅倍率
      leafFlutter: 0.6,    // 叶片扇动倍率
      leafTwist: 0.5,      // 叶片铰链俯仰角
      timeScale: 1.0,
    },

    /* 生长动画: 用进度值控制枝条长度与叶片弹出, 纯顶点着色器实现 (不重建几何)。
     * value 是手动进度, auto=true 时由动画循环推进到 1。 */
    // ---------------- 生长动画 ----------------
    growth: { enabled: true, value: 1.0, auto: true, speed: 0.35 },

    // ---------------- 导出选项 ----------------
    exportOptions: {
      // false = 按节点拆分 (树干/树枝各层/根/果实/树叶/花)
      // true  = 树干与树枝合并为一个 Bark mesh (旧行为)
      mergeBark: false,
    },

    /* 场景: 灯光/天空/地面/雾/后处理。与树的形态无关, 换树种时由 preserveUserBits 保留。
     * 角度单位是度; 方位角约定与风向一致 (0° = +X, 90° = +Z);
     * 颜色一律是 CSS hex ('#rrggbb'), 由 sceneManager 转成 THREE.Color。 */
    // ---------------- 场景 ----------------
    scene: {
      env: 'custom',       // 最近一次应用的环境预设 (daylight/forest/...), 手动微调后保留名字
      background: '#111820',
      skyTop: '#2a3c52',
      skyBottom: '#111820',
      gradient: true,
      ground: true,
      groundColor: '#262b34',
      grid: true,
      wireframe: 'off',   // off | overlay (实体+线框) | only (仅线框看三角面)
      fog: true,
      fogColor: '#111820',
      fogScale: 1.0,      // 雾距离倍率: <1 雾更近, >1 雾更远
      shadows: true,
      dynamicShadows: true,  // 阴影是否每帧重算(跟随太阳角度/风场/生长); 关 = 冻结阴影省性能
      sunColor: '#fff2e0',
      sunAzimuth: 35,
      sunElevation: 40,
      sunIntensity: 3.3,
      ambient: 1.05,
      exposure: 1.25,
      hemiSky: '#c8dcff',
      hemiGround: '#3a2f24',
      stars: 0,           // 星空强度 0..1
      autoRotate: false,
    },

    /* LOD: 细节倍率 + SpeedTree 式动态降级（相机拉远自动换低模, 拉近再切回）。
     * distance1/distance2 的单位是"树高"（相对值）, 这样同一套参数换大树/小树都不用重调;
     * keep1/keep2 是相对全模的叶片保留比例。
     * 纪律: 远景 LOD 只抽稀叶片, 绝不改变树干/树枝/果实/花朵几何 —— 否则拉远时
     * 看起来像换了一棵树。force 仅供调试/截图强制某一档。 */
    // ---------------- 细节 / LOD ----------------
    lod: {
      barkDetail: 1.0,   // 周向分段倍率
      leafRatio: 1.0,    // 保留叶片比例
      maxLeaves: 60000,
      // SpeedTree 式动态 LOD: 相机远离时自动切到低模, 切近再切回全模
      dynamic: true,
      distance1: 2.2,    // LOD0 -> LOD1 的距离 (× 树高)
      distance2: 4.5,    // LOD1 -> LOD2
      keep1: 0.3,        // LOD1 叶片保留比例 (相对 LOD0)
      keep2: 0.08,       // LOD2 叶片保留比例
      force: 'auto',     // 调试/截图用: auto | 0 | 1 | 2
      // 注意: 远景 LOD 只抽稀叶片, 绝不改变树干/树枝/果实/花朵几何
      // (否则相机拉远时看起来像换了一棵树); 低模骨架与全模保持完全一致
    },

    /* 顶点色 AO: 用叶片/花朵点云近似互相遮挡, 把结果乘进 COLOR_0（导出的 GLB 也会带上）。
     * radius 是米（世界尺度）, 所以树越大越需要调大, 否则只有紧贴的叶簇才互相压暗。 */
    // ---------------- 程序化环境光遮蔽 (烘焙进顶点色) ----------------
    // 参考 SpeedTree 的顶点色 AO: 用叶片点云近似互相遮挡, 树冠内部/枝条根部更暗。
    ao: {
      enabled: true,
      strength: 0.55,    // 0 = 关闭, 1 = 最强
      radius: 0.9,       // 遮挡采样半径 (米)
    },
  }
}

/**
 * 参数树深拷贝。
 *
 * 参数树约定为纯 JSON 结构 (object/array/number/string/boolean/null), 没有函数、
 * Date、Map 或循环引用, 所以 JSON 往返就是最简便且够用的深拷贝。它比
 * structuredClone 弱的地方 (丢失 undefined 键、无法处理循环) 对本参数树都不成立。
 *
 * 用途: 撤销栈快照、把参数交给生成器前先复制一份 (防止生成过程顺手改到 UI 状态)。
 * 注意: 传入 undefined 会抛异常 (JSON.parse 收到空串), 调用方需保证参数存在。
 *
 * @param {object} p 参数树
 * @returns {object} 完全独立的新对象
 */
export function cloneParams(p) {
  return JSON.parse(JSON.stringify(p))
}

/**
 * 深合并 (用于预设 / 导入): 把 patch 盖到 base 上, 返回新对象。
 *
 * 合并规则 (按 patch 的键遍历):
 *   对象 -> 递归合并, 目标缺失时补一个空对象;
 *   数组 -> 若目标也是数组则**按下标逐项**合并 (下标上是对象就递归, 否则直接替换),
 *           否则整体深拷贝; 注意 patch 数组更短时, base 里多出来的尾部元素会保留;
 *   标量 -> 直接覆盖 (包括 null / false / 0)。
 * 所以严格说它不是"只覆盖已有键": base 里没有的键也会被加上。
 * 正因为如此, 用 defaultParams() 当 base、物种 patch 当 patch 时,
 * patch 里写什么就改什么, 没写的保持默认 —— 这正是物种/预设系统想要的语义。
 *
 * 参数树因此不会被就地修改: 内部先 cloneParams(base) 再改副本。
 *
 * @param {object} base 基准参数树 (通常来自 defaultParams)
 * @param {object} patch 补丁 (可以是完整参数树, 也可以是局部片段)
 * @returns {object} 合并后的新对象; base 与 patch 都不被修改
 */
export function mergeParams(base, patch) {
  const out = cloneParams(base)
  const walk = (dst, src) => {
    for (const k of Object.keys(src || {})) {
      const sv = src[k]
      if (Array.isArray(sv)) {
        if (Array.isArray(dst[k])) {
          for (let i = 0; i < sv.length; i++) {
            if (sv[i] && typeof sv[i] === 'object' && dst[k][i]) walk(dst[k][i], sv[i])
            else dst[k][i] = sv[i]
          }
        } else dst[k] = JSON.parse(JSON.stringify(sv))
      } else if (sv && typeof sv === 'object') {
        if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {}
        walk(dst[k], sv)
      } else {
        dst[k] = sv
      }
    }
  }
  walk(out, patch)
  return out
}

/**
 * 保证结构完整 (导入旧版本 JSON 时用)。
 *
 * 做四件事:
 *   ① 用 defaultParams() 当骨架深合并, 补齐旧 JSON 里缺失的字段;
 *   ② 校验 seed 是有限数 (NaN/字符串会一路污染所有 Rng, 直接回退成 1);
 *   ③ branches.level 补齐到恰好 MAX_LEVELS 项 (缺的用 defaultLevel(i) 填, 多的截掉);
 *   ④ leaves.levels 同理 (但它补的是 true, 因为多长一层叶子比少长更保险)。
 *
 * 为什么必须保证长度恒为 MAX_LEVELS: 生成器与面板都直接按
 * branches.level[i] 下标访问, 不检查存在性; 长度不足会静默少一层枝,
 * 长度过多则会让 MAX_LEVELS 的上限失效 (枝量连乘爆炸)。
 *
 * @param {object|null} p 可能是旧版本/残缺的参数树 (null 也接受)
 * @returns {object} 结构完整的新参数树 (p 不被修改)
 */
export function normalizeParams(p) {
  const out = mergeParams(defaultParams(), p || {})
  out.seed = Number.isFinite(out.seed) ? out.seed : 1
  if (!Array.isArray(out.branches.level)) out.branches.level = []
  while (out.branches.level.length < MAX_LEVELS) out.branches.level.push(defaultLevel(out.branches.level.length))
  out.branches.level = out.branches.level.slice(0, MAX_LEVELS)
  if (!Array.isArray(out.leaves.levels)) out.leaves.levels = [false, false, true, true, true]
  while (out.leaves.levels.length < MAX_LEVELS) out.leaves.levels.push(true)
  out.leaves.levels = out.leaves.levels.slice(0, MAX_LEVELS)
  return out
}

/* ---------------- 变更分组: 决定"改一个参数要重建到哪一步" ----------------
 * 分组是**互斥且完备**的: 每个顶层键只出现在一组里, store 只需比较各自序列化后的
 * 字符串是否变化, 再决定调用哪条重建链路 (这是本文件里性能上最重要的约定):
 *   geometry -> 重新生长骨架 + 蒙皮 + 叶片/果实实例化 (最贵, 几十毫秒级)
 *   material -> 只重建材质与 uniform (几毫秒, 不碰几何)
 *   wind     -> 只更新 uniform (近乎免费)
 *   scene    -> 灯光/天空/雾/生长 (不动几何与材质)
 * 放错组的代价: 把纯 uniform 参数放进 geometry 会导致拖滑杆时反复重建几何 (卡顿);
 * 反之把几何参数放进 material 则会出现"改了没反应"的 bug。 */
// 影响几何拓扑/顶点数据的键 (seed 改变会整体换个体, 所以也在几何组)
const GEOMETRY_KEYS = ['seed', 'auto', 'trunk', 'roots', 'branches', 'leaves', 'flower', 'fruit', 'lod', 'ao', 'branchEdits']
// 只影响材质/着色器/合批实例的键 (落叶/粒子等是"另一个几何体", 重建代价低, 归到材质组)
const MATERIAL_KEYS = ['bark', 'leafMat', 'custom', 'particles', 'fall', 'litter', 'flowerFall', 'flowerLitter']
// 只进顶点着色器 uniform 的键
const WIND_KEYS = ['wind']
// 场景与动画: growth 只改 uniform, 但和场景一起归在"轻量刷新"链路里
const SCENE_KEYS = ['scene', 'growth']

/**
 * 把指定分组序列化成可比较的字符串。
 *
 * 用 [键, 值] 数组而不是直接拼 JSON: 保留"哪个键属于哪一组"的边界, 即使某个键名
 * 里出现分隔符也不会把两组序列化成一模一样, 而且键顺序固定 (由分组常量决定),
 * 对象内部属性顺序变化不会产生假变更。
 *
 * @param {object} params 参数树
 * @param {Array<string>} keys 分组键列表
 * @returns {string} 该分组的稳定序列化结果
 */
function pickStringify(params, keys) {
  return JSON.stringify(keys.map((k) => [k, params[k]]))
}

/**
 * 按分组序列化参数, 供 store 做"变更检测"。
 *
 * 典型用法: 每次生成后缓存 serialized[group]; 下次改动后重新序列化,
 * 字符串不同才触发对应链路的重建。未知分组退化成整个参数树的序列化 (全量比较)。
 *
 * @param {object} params 参数树
 * @param {'geometry'|'material'|'wind'|'scene'|string} group 分组名
 * @returns {string} 序列化结果 (同参数 + 同分组必定得到同一字符串)
 */
export function serializeGroup(params, group) {
  switch (group) {
    case 'geometry': return pickStringify(params, GEOMETRY_KEYS)
    case 'material': return pickStringify(params, MATERIAL_KEYS)
    case 'wind': return pickStringify(params, WIND_KEYS)
    case 'scene': return pickStringify(params, SCENE_KEYS)
    default: return JSON.stringify(params)
  }
}

/**
 * 分组键清单的对外出口 (供 store / 生成器遍历某一组)。
 *
 * 语义: 拿到 'geometry' 就等于拿到"所有会影响几何的顶层键", 可以据此做差异导出、
 * 重置某一组、或把参数拆成"几何部分 + 材质部分"分别缓存。
 * 注意: 这里导出的是与内部**同一个数组实例** (没有拷贝), 调用方只读, 不要 push/splice,
 * 否则会改掉分组定义本身。
 */
export const GROUP_KEYS = { geometry: GEOMETRY_KEYS, material: MATERIAL_KEYS, wind: WIND_KEYS, scene: SCENE_KEYS }


