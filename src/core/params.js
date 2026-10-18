/**
 * 参数中心 (single source of truth)
 * ------------------------------------------------------------
 * 所有面板都读写这个结构; 生成器只读它。
 * serializeGroup() 用来做"变更分组"判断:
 *   geometry 变更 -> 重建几何体
 *   material 变更 -> 只更新材质 / uniform (无需重建)
 *   wind     变更 -> 只更新风场 uniform
 */

export const MAX_LEVELS = 5

/** 枝条层级默认值 (按层级递增: 越细碎、越柔) */
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

export function defaultParams() {
  return {
    seed: 20240607,
    auto: { chaos: 0.6 },

    // ---------------- 分类 (树种 / 生长阶段 / 季节) ----------------
    // 这三个只作为"预设元数据"记录在参数里 (方便 JSON 复现), 由 store 组合出实际参数
    classify: { species: 'oak', stage: 'mature', season: 'summer' },

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
      gnarl: 0.35,          // 不规则/节瘤感
      flare: 0.9,           // 根部外扩
      flareHeight: 0.18,    // 外扩影响的高度比例
      knots: 2,             // 节瘤数量
      knotSize: 0.35,       // 节瘤凸起强度
      squash: 1.0,          // 椭圆化 (1 = 圆)
      capBase: true,
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

    // ---------------- 树根 ----------------
    roots: {
      enabled: true,
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
    },

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
    },

    // ---------------- 树叶 ----------------
    leaves: {
      enabled: true,
      levels: [false, false, true, true, true], // 每层枝条是否长叶
      perBranch: 9,        // 每条枝条上的叶簇位置数量
      clusterCount: 3,     // 每个位置的叶片数量
      clusterRadius: 0.16, // 叶簇半径(米)
      clusterSpread: 0.8,
      size: 0.42,          // 叶片长度(米)
      sizeVariance: 0.28,
      width: 0.78,         // 宽/长
      shape: 'oval',       // oval | birch | maple | needle | lance | trumpet | bell
      flower3d: true,      // 喇叭/钟形花: true = 真三维漏斗网格 (双壳有厚度); false = 平面卡片
      flowerLobes: 5,      // 花瓣数 (3~8)
      flowerThickness: 0.05, // 花冠壁厚 (0 = 单层面)
      flowerStamen: true,   // 花冠中心的花蕊
      flowerTilt: 45,       // 花冠上仰角 (度): 花口朝上而不是顺枝朝外
      flowerQuality: 'high', // 花冠质量档 (近似 LOD): high 双壳+花蕊+花瓣层 / medium 单壳+花蕊 / low 单壳无细节
      flowerPetals: true,   // 花瓣分层 (花口向外翻出的独立花瓣)
      flowerCluster: 1,     // 一簇几朵花 (1~5)
      flowerStamenColor: '#f4e6a6', // 花蕊颜色 (独立于花瓣色)
      segments: 5,
      curl: 0.18,          // 纵向弯曲
      fold: 0.28,          // 横向 V 形折叠
      startT: 0.25,
      endT: 1.0,
      pitch: -30,          // 相对枝条方向的俯仰(度, 负=下垂)
      pitchVariance: 28,
      droop: 0.35,         // 自重下垂
      rollVariance: 180,
      faceUp: 0.5,         // 叶面朝上程度 0..1
      twist: 0.25,         // 叶柄扭转
      color: '#5da03a',
      colorTip: '#a6d45e',
      colorVariance: 0.22,
      petiole: 0.12,       // 叶柄长度(相对叶长)
      // 叶形混合: 同一棵树可混用多种叶形 (不同树种叶形差别很大)
      // 每项 { shape, weight }, weight 为相对比例; 留空 = 只用 shape
      shapeMix: [],
      // 叶片卡片模式: 叶形轮廓直接用贴图 alpha (照片级), 而不是程序化轮廓
      cardMode: false,
      cardAspect: 1,       // 选中卡片的 宽/高 (由 UI 从卡片库写入)
      cardCurl: 0.1,       // 卡片的轻微弓弯
      cardFold: 0.12,      // 卡片沿中脉的折叠
    },

    // ---------------- 落叶 (从树冠落下的叶片) ----------------
    fall: {
      enabled: false,
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

    // ---------------- 地面落叶堆积 ----------------
    litter: {
      enabled: false,
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

    // ---------------- 树皮材质 ----------------
    bark: {
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

    // ---------------- 花朵 (独立于树叶, 但基础功能继承树叶) ----------------
    flower: {
      enabled: false,        // 与树叶可同时开启
      levels: [false, true, true, true, true],
      perBranch: 4,          // 每个枝端的花簇数
      density: 1,            // 开花密度 (按比例从树叶位置采样)
      clusterCount: 2,       // 每个点位几朵花
      size: 0.42,            // 花朵尺寸 (通常比叶大)
      sizeVariance: 0.2,     // 花朵尺寸随机
      clusterRadius: 0.16,   // 每簇花朵散布半径
      clusterSpread: 0.6,    // 花朵离散度
      pitch: 55,             // 花朵朝向俯仰角
      pitchVariance: 20,
      droop: 0,              // 花朵下垂
      rollVariance: 0.6,     // 朝向随机
      faceUp: true,          // 花朵尽量朝上
      twist: 0,
      segments: 3,           // 程序化花形分段
      curl: 0.1,
      fold: 0.05,
      petiole: 0,
      cardCurl: 0.1,
      cardFold: 0.12,
      width: 1.0,
      shape: 'trumpet',
      shapeMix: [{ shape: 'trumpet', weight: 3 }, { shape: 'bell', weight: 1 }],
      color: '#f2a7c3',
      colorTip: '#fbe3ec',
      colorVariance: 0.16,
      translucency: 0.7,
      cardMode: false,       // 花朵默认用程序化三维花冠
      texture: '',           // 花朵贴图 (与树叶独立; 三维花冠会把它作为表面花纹包裹)
      tintMode: 'texture',   // 花朵贴图染色模式 (同树叶)
      alphaTest: 0,          // 花朵贴图 alpha 裁切 (平面花卡模式才需要)
      normalFromAlbedo: 0,   // 花朵贴图自动法线 (可选)
      cardId: '',
      cardAspect: 1,
      flower3d: true,
      flowerQuality: 'high',
      flowerPetals: true,
      flowerLobes: 5,
      flowerThickness: 0.05,
      flowerStamen: true,
      flowerStamenColor: '#f4e6a6',
      flowerTilt: 45,
      flowerCluster: 1,
    },

    // ---------------- 落花 / 落花堆积 (参照落叶实现) ----------------
    flowerFall: {
      enabled: false,
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
      normalTexture: '',
    },

    // ---------------- 自定义 GLSL ----------------
    custom: {
      enabled: true,
      vertex: '// 可用: position / transformed / normal / uv / uTime / uSeed / aWind\n// transformed.xz += sin(uTime + position.y) * 0.05;',
      fragment: '// 可用: diffuseColor / vTreeUv / vColor(需用 .rgb) / uTime / uSeed\n// diffuseColor.rgb *= 0.9 + 0.1 * sin(uTime + vTreeUv.y * 10.0);',
    },

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

    // ---------------- 生长动画 ----------------
    growth: { enabled: true, value: 1.0, auto: true, speed: 0.35 },

    // ---------------- 场景 ----------------
    scene: {
      background: '#111820',
      skyTop: '#2a3c52',
      skyBottom: '#111820',
      gradient: true,
      ground: true,
      groundColor: '#262b34',
      grid: true,
      wireframe: 'off',   // off | overlay (实体+线框) | only (仅线框看三角面)
      fog: true,
      shadows: true,
      sunAzimuth: 35,
      sunElevation: 40,
      sunIntensity: 3.3,
      ambient: 1.05,
      exposure: 1.25,
      autoRotate: false,
    },

    // ---------------- 细节 / LOD ----------------
    lod: {
      barkDetail: 1.0,   // 周向分段倍率
      leafRatio: 1.0,    // 保留叶片比例
      maxLeaves: 60000,
    },
  }
}

export function cloneParams(p) {
  return JSON.parse(JSON.stringify(p))
}

/** 深合并 (用于预设 / 导入): 只覆盖目标对象里已存在的键 */
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

/** 保证结构完整 (导入旧版本 JSON 时用) */
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

const GEOMETRY_KEYS = ['seed', 'auto', 'trunk', 'roots', 'branches', 'leaves', 'flower', 'fruit', 'lod']
const MATERIAL_KEYS = ['bark', 'leafMat', 'custom', 'particles', 'fall', 'litter', 'flowerFall', 'flowerLitter']
const WIND_KEYS = ['wind']
const SCENE_KEYS = ['scene', 'growth']

function pickStringify(params, keys) {
  return JSON.stringify(keys.map((k) => [k, params[k]]))
}

export function serializeGroup(params, group) {
  switch (group) {
    case 'geometry': return pickStringify(params, GEOMETRY_KEYS)
    case 'material': return pickStringify(params, MATERIAL_KEYS)
    case 'wind': return pickStringify(params, WIND_KEYS)
    case 'scene': return pickStringify(params, SCENE_KEYS)
    default: return JSON.stringify(params)
  }
}

/** 仅重建几何时需要的子集 (材质代码不参与) */
export const GROUP_KEYS = { geometry: GEOMETRY_KEYS, material: MATERIAL_KEYS, wind: WIND_KEYS, scene: SCENE_KEYS }


