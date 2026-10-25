/**
 * 参数有效性审计 (empirical)
 * ------------------------------------------------------------
 * 思路: 不是"grep 有没有出现过", 而是**真的改一遍参数, 看产物是否变化**。
 *   - 几何组参数: 用同一颗小树重建两次, 比较几何哈希 / 统计
 *   - 材质组参数: 在 Node 里真的建材质 -> updateMaterials -> 比较材质快照
 *   - 风场组参数: 比较共享 uniform 快照
 *   - 场景/自定义/生长: 需要 WebGL 或渲染器, 用"引用 + 语义"检查 (见 REFERENCES)
 *
 * 输出: 每个参数的 {path, changed:boolean, how}
 * 用法: node scripts/audit-params.mjs      (npm run audit)
 */
import * as THREE from 'three'
import { buildTree } from '../src/core/treeBuilder.js'
import { defaultParams, cloneParams, GROUP_KEYS } from '../src/core/params.js'
import { createSharedUniforms, createBarkMaterial, createLeafMaterial, createFlowerMaterial, updateMaterials, updateWindUniforms } from '../src/core/materials.js'
import { resolveLeafEffects } from '../src/core/leafEffects.js'

/* ------------------------------------------------------------------ */
/* 参数路径收集                                                        */
/* ------------------------------------------------------------------ */

export function collectPaths(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object' && v[0] !== null) {
        // 数组对象: 只审计第 0 项 (所有层级共用同一段代码)
        collectPaths(v[0], `${path}[0]`, out)
      } else {
        out.push({ path, kind: 'array', value: v })
      }
    } else if (v && typeof v === 'object') {
      collectPaths(v, path, out)
    } else {
      out.push({ path, kind: typeof v, value: v })
    }
  }
  return out
}

function getAt(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cur = obj
  for (const p of parts) cur = cur[p]
  return cur
}

function setAt(obj, path, value) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]]
  cur[parts[parts.length - 1]] = value
}

/** 给一个参数造"应该产生可见差异"的扰动值 (返回多个候选, 任一有效即算有效) */
function perturbations(path, value) {
  const key = path.split('.').pop()
  if (SPECIAL_PERTURB[path]) return SPECIAL_PERTURB[path].filter((v) => v !== value)
  if (typeof value === 'boolean') return [!value]
  if (typeof value === 'number') {
    if (key === 'seed') return [value + 1]
    if (Number.isInteger(value) && !FRACTION_KEYS.test(key)) {
      return value <= 1 ? [value + 3] : [Math.max(1, Math.round(value * 2))]
    }
    const cands = []
    if (value !== 0) cands.push(+(value * 2.5).toFixed(4))
    cands.push(+(value * 0.35).toFixed(4))
    if (value === 0) cands.push(0.6)
    return [...new Set(cands)].filter((v) => v !== value)
  }
  if (typeof value === 'string') {
    if (value.startsWith('#')) return ['#123456', '#abcdef'].filter((v) => v !== value)
    const map = {
      round: ['star', 'square'], star: ['round'], square: ['round'],
      oval: ['needle', 'maple'], needle: ['oval'], maple: ['lance'], lance: ['oval'], birch: ['oval'],
      rough: ['birch', 'pine'], birch: ['rough'], pine: ['smooth'], smooth: ['rough'],
    }
    if (map[value]) return map[value]
    return [value + ' /* audit */']
  }
  return [value]
}

/** 只在特定条件下生效的参数: 审计前先满足条件 */
export const CONDITIONS = {
  'leaves.shape': { 'leaves.cardMode': false },
  'leaves.segments': { 'leaves.cardMode': false },
  'leaves.curl': { 'leaves.cardMode': false },
  'leaves.fold': { 'leaves.cardMode': false },
  'leaves.petiole': { 'leaves.cardMode': false },
  'leaves.twist': { 'leaves.cardMode': false },
  'leaves.droop': { 'leaves.cardMode': false },
  'leaves.pitch': { 'leaves.cardMode': false },
  'leaves.pitchVariance': { 'leaves.cardMode': false },
  'leaves.rollVariance': { 'leaves.cardMode': false },
  'leaves.faceUp': { 'leaves.cardMode': false },
  'leaves.width': { 'leaves.cardMode': false },
  // 树枝环绕: 圈数只在对应开关开启时生效
  'leaves.branchWrapTurns': { 'leaves.branchWrap': true },
  'flower.branchWrap': { 'flower.enabled': true },
  'flower.branchWrapTurns': { 'flower.enabled': true, 'flower.branchWrap': true },
  'branches.level[0].starDepth': { 'branches.level[0].crossSection': 'star' },
  // 分叉子参数只有在"启用分叉"时才有意义 (默认树种没有分叉)
  'trunk.fork.count': { 'trunk.fork.enabled': true },
  'trunk.fork.height': { 'trunk.fork.enabled': true },
  'trunk.fork.angle': { 'trunk.fork.enabled': true },
  'trunk.fork.spread': { 'trunk.fork.enabled': true },
  'trunk.fork.radiusScale': { 'trunk.fork.enabled': true },
  'trunk.fork.lengthScale': { 'trunk.fork.enabled': true },
  'trunk.fork.taper': { 'trunk.fork.enabled': true },
  'trunk.fork.curve': { 'trunk.fork.enabled': true },
  'trunk.fork.gravity': { 'trunk.fork.enabled': true },
  'trunk.fork.trunkShrink': { 'trunk.fork.enabled': true },
  'lod.leafRatio': null, // 由双向扰动覆盖 (1 -> 0.35)
  // 染色强度只在"自定义"模式下生效
  'leafMat.vertexColorMix': { 'leafMat.tintMode': 'custom' },
  // 无贴图时 texture/season 都会回落到 1, 靠 custom 模式 + 自定义强度体现差异
  'leafMat.tintMode': { 'leafMat.vertexColorMix': 0.3 },
  // 花朵默认关闭: 审计花朵参数时先启用
  'flower.enabled': { 'leaves.enabled': true },
  'flower.levels': { 'flower.enabled': true },
  'flower.perBranch': { 'flower.enabled': true },
  'flower.clusterCount': { 'flower.enabled': true },
  'flower.size': { 'flower.enabled': true },
  'flower.width': { 'flower.enabled': true },
  'flower.color': { 'flower.enabled': true },
  'flower.colorTip': { 'flower.enabled': true },
  'flower.colorVariance': { 'flower.enabled': true },
  'flower.translucency': { 'flower.enabled': true },
  'flower.cardMode': { 'flower.enabled': true },
  'flower.cardId': { 'flower.enabled': true },
  'flower.cardAspect': { 'flower.enabled': true },
  'flower.density': { 'flower.enabled': true },
  'flower.startT': { 'flower.enabled': true },
  'flower.endT': { 'flower.enabled': true },
  'flower.texture': { 'flower.enabled': true },
  'flower.cross': { 'flower.enabled': true },
  'flower.useShape': { 'flower.enabled': true },
  'flower.shape': { 'flower.enabled': true, 'flower.useShape': true },
  'flower.textureU': { 'flower.enabled': true },
  'flower.textureV': { 'flower.enabled': true },
  'flower.modelRotation': { 'flower.enabled': true },
  'flower.textureRepeat': { 'flower.enabled': true },
  'flower.textureRotation': { 'flower.enabled': true },
  'flower.sizeVariance': { 'flower.enabled': true },
  'flower.clusterRadius': { 'flower.enabled': true },
  'flower.clusterSpread': { 'flower.enabled': true },
  'flower.pitch': { 'flower.enabled': true },
  'flower.pitchVariance': { 'flower.enabled': true },
  'flower.droop': { 'flower.enabled': true },
  'flower.rollVariance': { 'flower.enabled': true },
  'flower.faceUp': { 'flower.enabled': true },
  'flower.twist': { 'flower.enabled': true },
  'flower.segments': { 'flower.enabled': true },
  'flower.curl': { 'flower.enabled': true },
  'flower.fold': { 'flower.enabled': true },
  'flower.petiole': { 'flower.enabled': true },
  'flower.cardCurl': { 'flower.enabled': true },
  'flower.cardFold': { 'flower.enabled': true },
  'flower.tintMode': { 'flower.enabled': true },
  'flower.vertexColorMix': { 'flower.enabled': true },
  'flower.alphaTest': { 'flower.enabled': true },
  'flower.normalFromAlbedo': { 'flower.enabled': true },
  // 卡片几何子参数只在"卡片模式"下生效
  'leaves.cardAspect': { 'leaves.cardMode': true },
  'leaves.cardCurl': { 'leaves.cardMode': true },
  'leaves.cardFold': { 'leaves.cardMode': true },
  // 开关本身要能看出效果: 先把挂果层级放到探针树有效的层级上
  'fruit.enabled': { 'fruit.levels': [false, true, true, false, false] },
}
// 果实子参数只有在"启用果实 + 指定挂果层级"时才有效果
// 注意: fruit.enabled 不加条件 (它本身就是要被扰动的开关);
// 探针小树只有 L1/L2, 挂果层级必须落在有效层级上, 否则怎么改都看不到效果
for (const k of ['type', 'levels', 'perBranch', 'clusterCount', 'clusterRadius', 'size', 'sizeVariance',
  'droop', 'color', 'capColor', 'colorVariance', 'radial', 'maxCount', 'chance']) {
  const path = 'fruit.' + k
  if (!Object.prototype.hasOwnProperty.call(CONDITIONS, path)) {
    CONDITIONS[path] = {
      'fruit.enabled': true,
      'fruit.levels': [false, true, true, false, false],
      'fruit.maxCount': 200,
      'fruit.chance': 1,
    }
  }
}

// 空间引导力默认是空的: 审计"启用开关"或"对象列表"时, 先放一个真正能影响
// 探针树的吸引子 (位置落在树冠范围内), 否则永远比较不出几何差异。
const FORCE_PROBE = [{
  type: 'attractor', shape: 'sphere', x: 1.5, y: 2.5, z: 0,
  radius: 5, strength: 1.4, falloff: 1, size: 0.6, sizeY: 0.6,
}]
CONDITIONS['forces.enabled'] = { 'forces.items': FORCE_PROBE }
CONDITIONS['forces.items'] = { 'forces.enabled': true }

/** 需要 canvas/ImageLoader, Node 下无法判定 -> 在浏览器审计页里验证 */
export const DOM_DEPENDENT = new Set([
  'bark.color', 'bark.color2', 'bark.bump', 'bark.uvScaleU', 'bark.uvScaleV',
  'bark.procedural.enabled', 'bark.procedural.style', 'bark.procedural.scale', 'bark.procedural.contrast',
  'bark.texture', 'bark.normalTexture', 'bark.normalFromAlbedo', 'bark.uvWarp', 'bark.uvWarpScale',
  'leafMat.texture', 'leafMat.normalTexture', 'leafMat.normalFromAlbedo',
  'leafMat.textureU', 'leafMat.textureV',
  'leafMat.textureRepeatU', 'leafMat.textureRepeatV', 'leafMat.textureRotation',
  'leafMat.backTexture',
  'flower.texture', 'flower.normalFromAlbedo', 'flower.alphaTest',
  'flower.textureRepeatU', 'flower.textureRepeatV',
  // 粒子是场景级效果 (Points + 顶点着色器动画, 需要渲染器), Node 侧无法比较
  'particles.enabled', 'particles.count', 'particles.size', 'particles.speed', 'particles.fall',
  'particles.sway', 'particles.swirl', 'particles.color', 'particles.opacity', 'particles.glow',
  'particles.spread', 'particles.windFollow',
  // 落叶是场景级效果 (合批几何 + 顶点着色器动画), Node 侧无法比较
  'flowerFall.enabled', 'flowerFall.cardId', 'flowerFall.count', 'flowerFall.speed', 'flowerFall.size', 'flowerFall.swirl', 'flowerFall.spinSpeed', 'flowerFall.stagger', 'flowerFall.spread', 'flowerFall.windFollow', 'flowerFall.color', 'flowerFall.opacity', 'flowerFall.alphaTest', 'flowerLitter.enabled', 'flowerLitter.cardId', 'flowerLitter.count', 'flowerLitter.radius', 'flowerLitter.size', 'flowerLitter.thickness', 'flowerLitter.color', 'flowerLitter.colorVariance', 'flowerLitter.alphaTest', 'flowerLitter.shade',
  'fall.enabled', 'fall.count', 'fall.speed', 'fall.size', 'fall.swirl', 'fall.spinSpeed',
  'fall.cardId', 'fall.stagger', 'fall.spread', 'fall.windFollow', 'fall.color', 'fall.opacity', 'fall.alphaTest',
  // 落叶堆积同样是场景级 (合批几何 + 地面贴图)
  'litter.enabled', 'litter.cardId', 'litter.count', 'litter.radius', 'litter.size', 'litter.thickness',
  'litter.color', 'litter.colorVariance', 'litter.alphaTest', 'litter.shade',
])

/** 由 store / 场景循环消费, 不直接进 uniform */
export const STORE_LEVEL = {
  'wind.auto': 'store.setWindAuto 决定是否用 autoWind() 重算整套风场',
  'wind.intensity': 'store.setWindIntensity 把它当作 autoWind() 的输入档位',
  'wind.timeScale': 'sceneManager.windTimeScale 控制 uTime 推进速度',
  'auto.chaos': 'store.doAutoGenerate 用它决定随机扰动幅度',
  // 动态 LOD 是场景/相机级行为: 只影响运行时用哪套几何, 不改变 LOD0 本体
  'lod.dynamic': 'sceneManager 运行时决定是否启用 LOD 切换',
  'lod.distance1': 'sceneManager.updateLod 的 LOD0->LOD1 切换距离 (×树高)',
  'lod.distance2': 'sceneManager.updateLod 的 LOD1->LOD2 切换距离 (×树高)',
  'lod.keep1': '仅用于按需生成 LOD1 几何 (叶片保留比例)',
  'lod.keep2': '仅用于按需生成 LOD2 几何 (叶片保留比例)',
  'lod.force': '调试/截图时强制指定 LOD 档位, 由 sceneManager 消费',
}

/* ------------------------------------------------------------------ */
/* 几何审计                                                            */
/* ------------------------------------------------------------------ */

function hashArray(arr) {
  // 不依赖 Buffer, 浏览器/Node 通用; 量化到 1/4096 足够捕捉参数扰动
  let h = 2166136261
  for (let i = 0; i < arr.length; i++) {
    h ^= (arr[i] * 4096) | 0
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function geometrySignature(params) {
  const r = buildTree(params)
  const g = r.barkGeometry
  const l = r.leafGeometry
  // 注意: 风场相关属性 (aWind/aPhase…) 也算几何输出 —— 只影响它们的参数同样必须能被审计发现
  const attrs = (geo) => geo
    ? ['position', 'uv', 'normal', 'color', 'aWind', 'aOrigin', 'aGrow', 'aNodeId']
      .map((k) => (geo.attributes[k] ? hashArray(geo.attributes[k].array) : '-'))
      .join(',')
    : 'none'
  const fl = r.flowerGeometry
  return [
    g.attributes.position.count,
    attrs(g),
    l ? l.attributes.position.count + '|' + attrs(l) : 'noleaf',
    fl ? fl.attributes.position.count + '|' + attrs(fl) : 'noflower',
    r.stats.branches,
    r.stats.leaves,
    r.stats.flowers,
    r.stats.height.toFixed(3),
    r.stats.spread.toFixed(3),
    r.nodes.length,
  ].join('|')
}

/** 这些"整数但语义是比例"的参数必须按小数扰动, 否则 1 -> 4 永远不会生效 */
const FRACTION_KEYS = /(ratio|variance|spread|mix|scale|strength|intensity|gust|turbulence|bias|fold|curl|flare|faceUp|droop|twist|contrast|bump|alphaTest|sink|depth|share|gain|falloff|squash|curve|taper)$/i

/** 少数参数需要"定向"的扰动值才能生效 */
const SPECIAL_PERTURB = {
  'lod.maxLeaves': [5, 30],        // 只有上限真的卡住时才看得出来
  'leafMat.tintMode': ['custom', 'texture'],
  'leaves.shapeMix': [[{ shape: 'oak', weight: 2 }, { shape: 'needle', weight: 1 }]],
  'trunk.knots': [9],              // 0/1 附近不明显
  'roots.count': [11],
  'bark.pipeline': ['skin'],
  'forces.items': [FORCE_PROBE],   // 空数组扰动无效, 直接塞一个探针力场
}

/** 小树探针: 让每次审计重建都很快, 但必须包含带叶片的层级 */
export function probeParams() {
  const p = defaultParams()
  p.branches.levels = 2
  for (const [i, lv] of p.branches.level.entries()) {
    lv.count = i === 0 ? 3 : i === 1 ? 2 : 1
    lv.segments = Math.min(lv.segments, 4)
    lv.radialSegments = Math.min(lv.radialSegments, 5)
  }
  // L1/L2 长叶, 否则所有 leaves.* 参数都测不出效果
  p.leaves.levels = [true, true, false, false, false]
  p.leaves.perBranch = 3
  p.leaves.clusterCount = 2
  p.leaves.segments = 3
  p.lod.maxLeaves = 20000
  // 根系参数只有在启用树根时才有效
  p.roots.enabled = true
  return p
}

export function auditGeometry(baseParams = probeParams()) {
  const base = geometrySignature(baseParams)
  const results = []
  // bark.pipeline 切换的是几何管线（虽然字段放在 material 组的 bark 下）
  const paths = collectPaths(baseParams).filter(({ path }) => !FLOWER_MATERIAL_PATHS.has(path) &&
    (path === 'bark.pipeline' ||
      GROUP_KEYS.geometry.some((k) => path === k || path.startsWith(k + '.'))))
  for (const { path, value } of paths) {
    const candidates = perturbations(path, value)
    let changed = false
    let how = ''
    for (const cand of candidates) {
      const p = cloneParams(baseParams)
      // 条件参数: 先满足前置条件
      const cond = CONDITIONS[path]
      if (cond) for (const [k, v] of Object.entries(cond)) setAt(p, k, v)
      if (Array.isArray(getAt(baseParams, path)) && !SPECIAL_PERTURB[path]) {
        setAt(p, path, getAt(baseParams, path).map((v) => (typeof v === 'boolean' ? !v : perturbValue(v))))
      } else {
        setAt(p, path, cand)
      }
      try {
        if (geometrySignature(p) !== base) {
          changed = true
          how = `几何/统计变化 (值 ${JSON.stringify(value)} -> ${JSON.stringify(cand)})`
          break
        }
      } catch (e) {
        changed = true
        how = '抛出异常: ' + e.message
        break
      }
    }
    if (!changed) how = '无变化'
    results.push({ path, kind: 'geometry', changed, how, value })
  }
  return results
}

function perturbValue(v) {
  return typeof v === 'number' ? (v === 0 ? 0.5 : +(v * 1.8).toFixed(4)) : v
}

/* ------------------------------------------------------------------ */
/* 材质审计                                                            */
/* ------------------------------------------------------------------ */

const FLOWER_MATERIAL_PATHS = new Set([
  'flower.emissive', 'flower.emissiveColor',
  'flower.specular', 'flower.specularShininess', 'flower.specularColor',
  'flower.scatter', 'flower.scatterPower', 'flower.translucency',
])

/** 贴图签名: 区分"有没有贴图"以及"程序化贴图内容是否变了" (浏览器环境才有 canvas) */
function texSig(tex) {
  if (!tex) return 'none'
  const tf = `${tex.offset.x.toFixed(3)},${tex.offset.y.toFixed(3)}:${tex.repeat.x.toFixed(3)},${tex.repeat.y.toFixed(3)}:${(tex.rotation || 0).toFixed(3)}`
  const img = tex.image
  if (!img) return 'tex:' + tf
  if (img.tagName === 'CANVAS' && typeof img.getContext === 'function') {
    try {
      const d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data
      let h = 2166136261
      for (let i = 0; i < d.length; i += 137 * 4) {
        h ^= d[i] + d[i + 1] * 3 + d[i + 2] * 7
        h = Math.imul(h, 16777619)
      }
      return 'canvas:' + (h >>> 0).toString(16) + ':' + tf
    } catch (e) {
      return 'canvas-unreadable:' + tf
    }
  }
  return 'img:' + String(img.src || '').slice(-48) + ':' + tf
}

function materialSignature(params) {
  const shared = createSharedUniforms()
  const bark = createBarkMaterial(params, shared)
  const leaf = createLeafMaterial(params, shared)
  const flower = createFlowerMaterial(params, shared)
  updateMaterials({ bark, leaf, flower, uniforms: shared }, params)
  const un = (m, k) => {
    const u = m.userData.uniforms[k]
    if (!u) return 'undefined'
    const v = u.value
    if (v && v.isColor) return v.getHexString()
    if (v && v.isVector3) return v.toArray().map((x) => x.toFixed(3)).join(',')
    return String(v)
  }
  const sig = (m, tag) => [
    tag,
    m.color.getHexString(),
    m.roughness.toFixed(3),
    m.metalness.toFixed(3),
    texSig(m.map),
    texSig(m.normalMap),
    texSig(m.roughnessMap),
    m.normalScale.x.toFixed(2),
    m.side,
    (m.alphaTest || 0).toFixed(2),
    (m.emissiveIntensity || 0).toFixed(3),
    m.emissive ? m.emissive.getHexString() : '',
    un(m, 'uVertexColorMix'),
    un(m, 'uTint'),
    un(m, 'uTranslucency'),
    un(m, 'uSpecular'),
    un(m, 'uSpecularShininess'),
    un(m, 'uSpecularColor'),
    un(m, 'uScatter'),
    un(m, 'uScatterPower'),
    un(m, 'uSway'),
    un(m, 'uLeafFlutter'),
    un(m, 'uLeafTwist'),
    un(m, 'uBackEnabled'),
    un(m, 'uBackColor'),
    un(m, 'uHasBackMap'),
    texSig(m.userData.backMap),
    typeof m.onBeforeCompile === 'function' ? 'obc' : 'none',
    typeof m.customProgramCacheKey === 'function' ? m.customProgramCacheKey() : '',
  ].join(':')
  return [sig(bark, 'bark'), sig(leaf, 'leaf'), sig(flower, 'flower'),
    JSON.stringify(resolveLeafEffects(params, 'leaf', params.fall.inheritLeafMat !== false)),
    JSON.stringify(resolveLeafEffects(params, 'leaf', params.litter.inheritLeafMat !== false)),
    JSON.stringify(resolveLeafEffects(params, 'flower', params.flowerFall.inheritFlowerMat !== false)),
    JSON.stringify(resolveLeafEffects(params, 'flower', params.flowerLitter.inheritFlowerMat !== false)),
  ].join('||')
}

export function auditMaterial(baseParams = defaultParams()) {
  const base = materialSignature(baseParams)
  const results = []
  // bark.pipeline 是几何管线开关, 由 auditGeometry 负责 (材质签名看不到它)
  const paths = collectPaths(baseParams).filter(({ path }) => path !== 'bark.pipeline' &&
    GROUP_KEYS.material.some((k) => path === k || path.startsWith(k + '.')))
  // 花朵材质字段和花朵几何共用一个 flower 对象；几何审计跳过它们，材质审计补上。
  for (const path of FLOWER_MATERIAL_PATHS) {
    if (!paths.some((p) => p.path === path)) paths.push({ path, value: getAt(baseParams, path) })
  }
  for (const { path, value } of paths) {
    let changed = false
    let how = ''
    for (const cand of perturbations(path, value)) {
      const p = cloneParams(baseParams)
      // 前置条件: 某些参数只在特定模式下生效 (例如染色强度只在 tintMode=custom 时)
      const condM = CONDITIONS[path]
      if (condM) for (const [k, v] of Object.entries(condM)) setAt(p, k, v)
      setAt(p, path, cand)
      try {
        if (materialSignature(p) !== base) {
          changed = true
          how = `材质状态变化 (${JSON.stringify(value)} -> ${JSON.stringify(cand)})`
          break
        }
      } catch (e) {
        changed = true
        how = '抛出异常: ' + e.message
        break
      }
    }
    if (!changed) how = '无变化'
    results.push({ path, kind: 'material', changed, how, value })
  }
  return results
}

/* ------------------------------------------------------------------ */
/* 风场审计 (共享 uniform + 每个材质自己的风场 uniform)                  */
/* ------------------------------------------------------------------ */

function windSignature(params) {
  const wind = params.wind
  const u = createSharedUniforms()
  updateWindUniforms(u, wind)
  const parts = Object.keys(u)
    .filter((k) => k.startsWith('uWind') || k === 'uGust' || k === 'uGustSpeed' || k === 'uTurbulence' ||
      k === 'uSpatialScale' || k === 'uFlexFalloff')
    .map((k) => {
      const v = u[k].value
      if (v && v.isVector2) return `${k}=${v.x.toFixed(4)},${v.y.toFixed(4)}`
      return `${k}=${typeof v === 'number' ? v.toFixed(4) : String(v)}`
    })
  // 这些风场参数进的是"每个材质"的 uniform (perMaterialUniforms)
  const mats = updateMaterials(
    { bark: createBarkMaterial(params, u), leaf: createLeafMaterial(params, u), uniforms: u },
    params,
  )
  for (const [tag, m] of [['bark', mats.bark], ['leaf', mats.leaf]]) {
    const mu = m.userData.uniforms
    parts.push(`${tag}.uSway=${mu.uSway.value.toFixed(4)}`)
    parts.push(`${tag}.uLeafFlutter=${mu.uLeafFlutter.value.toFixed(4)}`)
    parts.push(`${tag}.uLeafTwist=${mu.uLeafTwist.value.toFixed(4)}`)
  }
  return parts.join('|')
}

export function auditWind(baseParams = defaultParams()) {
  const base = windSignature(baseParams)
  const results = []
  for (const { path, value } of collectPaths(baseParams.wind)) {
    let changed = false
    let how = ''
    for (const cand of perturbations(path, value)) {
      const p = cloneParams(baseParams)
      setAt(p, `wind.${path}`, cand)
      try {
        if (windSignature(p) !== base) {
          changed = true
          how = `uniform 变化 (${JSON.stringify(value)} -> ${JSON.stringify(cand)})`
          break
        }
      } catch (e) {
        changed = true
        how = '抛出异常: ' + e.message
        break
      }
    }
    if (!changed) how = '无变化 (未接到着色器)'
    results.push({ path: `wind.${path}`, kind: 'wind', changed, how, value })
  }
  return results
}

/* ------------------------------------------------------------------ */
/* 汇总                                                                */
/* ------------------------------------------------------------------ */

/** 已知需要特殊判定/豁免的参数 (含原因), 其余必须"改了就变" */
export const AUDIT_EXEMPT = {
  'custom.vertex': '自定义 GLSL 片段 (改变 onBeforeCompile 源码与 cacheKey, 签名里已包含)',
  'custom.fragment': '自定义 GLSL 片段 (同上)',
  'custom.enabled': '自定义 GLSL 开关 (同上)',
  'seed': '改变整棵树的随机子流 (几何签名已覆盖)',
  // 这两个参数在几何里是**相乘**使用的 (叶簇半径 × 离散度)。
  // 默认值被产品要求设为 0/0, 所以单独扰动任一个仍是 0 -> 默认状态下无可见效果;
  // 只要把另一个也调 >0, 两者都会立刻生效 (不是死参数)。
  'leaves.clusterRadius': '默认 0: 与 clusterSpread 相乘, 两者都为 0 时无可见效果',
  'leaves.clusterSpread': '默认 0: 与 clusterRadius 相乘, 两者都为 0 时无可见效果',
}

export function runAudit(opts = {}) {
  const env = opts.env || (typeof document === 'undefined' ? 'node' : 'browser')
  const params = opts.params || (env === 'browser' ? defaultParams() : probeParams())
  const materialParams = opts.materialParams || defaultParams()
  const geometry = auditGeometry(params)
  const material = auditMaterial(materialParams)
  const wind = auditWind(materialParams)
  const all = [...geometry, ...material, ...wind]
  const domDependent = (r) => env === 'node' && DOM_DEPENDENT.has(r.path)
  const deadRaw = all.filter((r) => !r.changed && !domDependent(r) && !STORE_LEVEL[r.path] && !AUDIT_EXEMPT[r.path])
  const exempt = all.filter((r) => !r.changed && !domDependent(r) && (STORE_LEVEL[r.path] || AUDIT_EXEMPT[r.path]))
  const browserOnly = all.filter(domDependent)
  const threw = all.filter((r) => r.how.startsWith('抛出异常') && !domDependent(r))
  // 抛异常说明参数确实被读到了, 但要单独暴露出来看稳健性
  const dead = deadRaw.filter((r) => !r.how.startsWith('抛出异常'))
  return { env, geometry, material, wind, all, dead, exempt, browserOnly, threw }
}

export function formatAudit(report) {
  const lines = []
  const section = (name, rows) => {
    lines.push(`\n=== ${name} (${rows.length}) ===`)
    for (const r of rows) {
      lines.push(`  ${r.changed ? '✓' : '·'} ${r.path.padEnd(34)} ${r.how}`)
    }
  }
  section('几何参数', report.geometry)
  section('材质参数', report.material)
  section('风场参数', report.wind)
  lines.push(`\n环境=${report.env}  通过 ${report.all.length - report.dead.length - report.exempt.length - report.browserOnly.length}` +
    ` / 豁免 ${report.exempt.length} / 需浏览器 ${report.browserOnly.length} / 失效 ${report.dead.length} / 异常 ${report.threw.length}`)
  if (report.browserOnly.length) {
    lines.push('\n需浏览器验证 (canvas/ImageLoader):')
    for (const r of report.browserOnly) lines.push(`  ~ ${r.path}`)
  }
  if (report.exempt.length) {
    lines.push('\n豁免 (由 store/场景循环消费):')
    for (const r of report.exempt) lines.push(`  - ${r.path}  ${STORE_LEVEL[r.path] || AUDIT_EXEMPT[r.path] || ''}`)
  }
  if (report.dead.length) {
    lines.push('\n失效参数 (改了没有任何影响):')
    for (const r of report.dead) lines.push(`  ✗ ${r.path}  (值=${JSON.stringify(r.value)})`)
  }
  if (report.threw.length) {
    lines.push('\n扰动后抛异常 (稳健性问题):')
    for (const r of report.threw) lines.push(`  ! ${r.path}: ${r.how}`)
  }
  return lines.join('\n')
}
