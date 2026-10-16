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
      startT: 0.22, endT: 0.96, startJitter: 0.05, tipShorten: 0.30,
      taper: 0.50, radiusCurve: 1.25, curve: 0.30, curveVariance: 0.35,
      gravity: 0.06, twist: 0.25, phyllotaxis: 137.5, spread: 0.14,
      upBias: 0.06, segments: 9, radialSegments: 7,
      crossSection: 'round', starDepth: 0.2, windGain: 0.55,
    },
    // L2
    {
      enabled: true, count: 5, pitch: 52, pitchVariance: 16,
      lengthRatio: 0.55, lengthVariance: 0.25, radiusRatio: 0.46, radiusVariance: 0.2,
      startT: 0.10, endT: 0.99, startJitter: 0.06, tipShorten: 0.38,
      taper: 0.50, radiusCurve: 1.2, curve: 0.34, curveVariance: 0.4,
      gravity: 0.0, twist: 0.3, phyllotaxis: 137.5, spread: 0.25,
      upBias: 0.04, segments: 7, radialSegments: 5,
      crossSection: 'round', starDepth: 0.2, windGain: 0.75,
    },
    // L3
    {
      enabled: true, count: 4, pitch: 46, pitchVariance: 18,
      lengthRatio: 0.62, lengthVariance: 0.28, radiusRatio: 0.5, radiusVariance: 0.22,
      startT: 0.08, endT: 1.0, startJitter: 0.07, tipShorten: 0.42,
      taper: 0.45, radiusCurve: 1.15, curve: 0.38, curveVariance: 0.45,
      gravity: -0.04, twist: 0.35, phyllotaxis: 137.5, spread: 0.35,
      upBias: 0.02, segments: 5, radialSegments: 4,
      crossSection: 'round', starDepth: 0.2, windGain: 0.9,
    },
    // L4
    {
      enabled: true, count: 3, pitch: 42, pitchVariance: 20,
      lengthRatio: 0.68, lengthVariance: 0.3, radiusRatio: 0.55, radiusVariance: 0.25,
      startT: 0.05, endT: 1.0, startJitter: 0.08, tipShorten: 0.45,
      taper: 0.4, radiusCurve: 1.1, curve: 0.42, curveVariance: 0.5,
      gravity: -0.08, twist: 0.4, phyllotaxis: 137.5, spread: 0.45,
      upBias: 0.0, segments: 4, radialSegments: 4,
      crossSection: 'round', starDepth: 0.2, windGain: 1.0,
    },
    // L5
    {
      enabled: true, count: 2, pitch: 40, pitchVariance: 22,
      lengthRatio: 0.7, lengthVariance: 0.32, radiusRatio: 0.6, radiusVariance: 0.28,
      startT: 0.05, endT: 1.0, startJitter: 0.08, tipShorten: 0.5,
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
      startT: 0.0,
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
      shape: 'oval',       // oval | birch | maple | needle | lance
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
      orientToBranch: 0.6, // 叶轴对齐枝条的程度
      twist: 0.25,         // 叶柄扭转
      color: '#5da03a',
      colorTip: '#a6d45e',
      colorVariance: 0.22,
      petiole: 0.12,       // 叶柄长度(相对叶长)
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
      uvScaleU: 1.0,
      uvScaleV: 1.0,
      bump: 1.0,
      texture: '',         // 用户上传的贴图(dataURL)
      normalTexture: '',
      roughnessTexture: '',
      procedural: { enabled: true, style: 'rough', scale: 1.0, contrast: 0.5 },
    },

    // ---------------- 树叶材质 ----------------
    leafMat: {
      tint: '#ffffff',
      vertexColorMix: 1.0,
      roughness: 0.62,
      metalness: 0.0,
      alphaTest: 0.4,
      doubleSided: true,
      translucency: 0.45,
      emissive: 0.0,
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
      strength: 0.12,      // 基础位移(米): 树梢的顺风偏移量级
      speed: 0.8,          // 摆动速度
      frequency: 1.0,      // 高频分量密度 (次波/抖动的频率倍率)
      gust: 0.35,          // 阵风强度
      gustSpeed: 0.16,
      turbulence: 0.12,    // 湍流(横向小摆动)
      spatialScale: 0.22,  // 相位空间尺度
      bias: 0.3,           // 顺风偏置: 风只推不拉 (0 = 完全对称往复)
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

const GEOMETRY_KEYS = ['seed', 'auto', 'trunk', 'roots', 'branches', 'leaves', 'lod']
const MATERIAL_KEYS = ['bark', 'leafMat', 'custom']
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
