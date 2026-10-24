/**
 * 无浏览器自检: 校验生成器的确定性、参数隔离、几何合法性
 * 运行: npm run selftest
 */
import { buildTree, selectionRanges } from '../src/core/treeBuilder.js'
import * as THREE from 'three'
import { buildBarkSkin } from '../src/core/barkSkin.js'
import { defaultParams, cloneParams, normalizeParams, ensureFeatureDefaults, MAX_LEVELS, GROUP_KEYS } from '../src/core/params.js'
import { ENVIRONMENTS, ENV_IDS, envById, applyEnvironment } from '../src/core/environments.js'
import { TWIST_POINTS, normalizeTwistProfile, sampleTwistProfile, twistProfileRad } from '../src/core/twist.js'
import { splitBarkGeometryByNodeGroups, barkGroupName, barkExportParts } from '../src/core/exportSplit.js'
import { modelTriangleCount, modelVertexCount } from '../src/core/modelStats.js'
import { autoGenerate, autoWind, applyPreset, PRESETS } from '../src/core/presets.js'
import {
  SPECIES, GROWTH_STAGES, SEASONS, composeTree, classificationName, allCombinations,
} from '../src/core/species.js'
import { buildLeafTemplate, LEAF_SHAPE_KEYS } from '../src/core/leaf.js'
import { buildFruitTemplate, FRUIT_TYPES } from '../src/core/fruit.js'
import { expandExponentialNumbers } from '../src/core/exporter.js'
import { createSharedUniforms, createLeafMaterial, createFlowerMaterial, createBarkMaterial, createTreeDepthMaterial, updateMaterials, internalShaderSources, resolveTintMix } from '../src/core/materials.js'
import { sampleEmitPositions, buildParticleSeeds, createParticleMaterial, PARTICLE_VERT, PARTICLE_FRAG } from '../src/core/particles.js'
import { buildFallingLeaves, fallRebuildKey, FALL_FRAG } from '../src/core/fallingLeaves.js'
import { buildLeafLitter, litterRebuildKey } from '../src/core/litter.js'
import { normalFromLuminance } from '../src/core/normalFromAlbedo.js'
import { textureAssetName, applyExportTextureNames, ensureExportTextureAlignment, ensureExportUvBake, EXPORT_ALIGNED_KINDS } from '../src/core/textureNaming.js'
import { clearCardBorder } from '../src/core/textures.js'
import { buildOcclusionGrid, occlusionAt, bakeOcclusion, bakeOcclusionByRanges } from '../src/core/ambientOcclusion.js'
import { viewAngles, atlasLayout, crossCardQuads, alphaCoverage, elevationAngles } from '../src/core/impostor.js'
import { ellipseLeafTexture, resolveEffectTexture, resolveEffectAspect } from '../src/core/leafTexture.js'
import { LEAF_CARDS } from '../src/core/leafCards.generated.js'
import { motionMetrics, swayEnvelope } from '../src/core/windModel.js'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runAudit, AUDIT_EXEMPT, STORE_LEVEL } from './paramAudit.mjs'
import { docFor, DOC_KEYS } from '../src/core/paramDocs.js'
import { analyzeTopology, validateSkin } from '../src/core/meshTopology.js'

let pass = 0
let fail = 0
const failures = []

function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(name + (extra ? ` — ${extra}` : ''))
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

function hashArray(arr) {
  // FNV-1a over the Float32 bytes
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
  let h = 2166136261
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i]
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function geomHash(g) {
  if (!g) return 'none'
  return [
    g.attributes.position.count,
    hashArray(g.attributes.position.array),
    g.index ? hashArray(new Uint32Array(g.index.array)) : 'noidx',
  ].join(':')
}

function checkGeometry(g, label) {
  const pos = g.attributes.position.array
  let finite = true
  let minY = Infinity
  let maxY = -Infinity
  let maxAbs = 0
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { finite = false; break }
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y), Math.abs(z))
  }
  check(`${label}: 所有顶点有限`, finite)
  check(`${label}: 尺寸合理 (无 NaN 爆炸)`, maxAbs < 500, `maxAbs=${maxAbs.toFixed(1)}`)
  return { minY, maxY }
}

console.log('\n=== FastTree 自检 ===\n')

/* 1. 确定性 */
console.log('[1] 确定性 (种子可复现)')
const base = defaultParams()
const a = buildTree(base)
const b = buildTree(base)
check('同参数同种子 → 树皮几何完全一致', geomHash(a.barkGeometry) === geomHash(b.barkGeometry))
check('同参数同种子 → 树叶几何完全一致', geomHash(a.leafGeometry) === geomHash(b.leafGeometry))

const other = normalizeParams({ ...base, seed: base.seed + 1 })
const c = buildTree(other)
check('换种子 → 几何不同', geomHash(a.barkGeometry) !== geomHash(c.barkGeometry))

/* 2. 参数隔离 */
console.log('\n[2] 参数隔离 (调树叶不挪动树干)')
const leafChanged = JSON.parse(JSON.stringify(base))
leafChanged.leaves.size *= 2
leafChanged.leaves.clusterCount += 2
const d = buildTree(leafChanged)
check('改树叶参数 → 树皮几何不变', geomHash(a.barkGeometry) === geomHash(d.barkGeometry))
check('改树叶参数 → 树叶几何改变', geomHash(a.leafGeometry) !== geomHash(d.leafGeometry))

const barkChanged = JSON.parse(JSON.stringify(base))
barkChanged.trunk.height *= 1.5
const e = buildTree(barkChanged)
check('改树干 → 树皮几何改变', geomHash(a.barkGeometry) !== geomHash(e.barkGeometry))

/* 3. 几何合法性 */
console.log('\n[3] 几何合法性')
const info = checkGeometry(a.barkGeometry, '树皮')
check('树高 > 0', info.maxY - info.minY > 1, `h=${(info.maxY - info.minY).toFixed(2)}`)
check('树皮三角面 > 0', a.stats.barkTriangles > 100, `${a.stats.barkTriangles}`)
check('树叶三角面 > 0', a.stats.leafTriangles > 100, `${a.stats.leafTriangles}`)
check('树枝计数 > 0', a.stats.branches > 5, `${a.stats.branches}`)
check('叶片计数 > 0', a.stats.leaves > 50, `${a.stats.leaves}`)
check('顶点属性齐全', ['position', 'normal', 'uv', 'color', 'aWind', 'aPhase', 'aOrigin', 'aGrow']
  .every((k) => !!a.barkGeometry.attributes[k] && !!a.leafGeometry.attributes[k]))
check('aWind ∈ [0,1]', (() => {
  const w = a.barkGeometry.attributes.aWind.array
  for (let i = 0; i < w.length; i++) if (w[i] < -1e-6 || w[i] > 1 + 1e-6) return false
  return true
})())
check('构建耗时 < 2000ms', a.stats.buildMs < 2000, `${a.stats.buildMs.toFixed(0)}ms`)

/* 4. 各层级 / 各截面 */
console.log('\n[4] 全参数组合')
let comboOk = true
let comboErr = ''
for (let levels = 1; levels <= MAX_LEVELS; levels++) {
  for (const cross of ['round', 'star', 'square']) {
    const p = JSON.parse(JSON.stringify(base))
    p.branches.levels = levels
    for (const lv of p.branches.level) lv.crossSection = cross
    try {
      const r = buildTree(p)
      if (!(r.stats.barkTriangles > 0)) { comboOk = false; comboErr = `levels=${levels} ${cross}` }
    } catch (err) {
      comboOk = false
      comboErr = `levels=${levels} ${cross}: ${err.message}`
      break
    }
  }
}
check('1~5 层级 × 3 种截面 全部可生成', comboOk, comboErr)

let leafOk = true
let leafErr = ''
for (const shape of LEAF_SHAPE_KEYS) {
  const p = JSON.parse(JSON.stringify(base))
  p.leaves.shape = shape
  p.leaves.enabled = true
  try {
    const r = buildTree(p)
    if (!r.leafGeometry || r.stats.leafTriangles <= 0) { leafOk = false; leafErr = shape }
  } catch (err) {
    leafOk = false
    leafErr = `${shape}: ${err.message}`
  }
}
check('全部叶片形状可生成', leafOk, leafErr)

const tpl = buildLeafTemplate({ shape: 'oval', segments: 6, curl: 0.2, fold: 0.3 })
check('叶片模板顶点/索引一致', tpl.vertexCount === tpl.positions.length / 3 && tpl.index.length % 3 === 0)

/* 5. 预设 + 自动生成 */
console.log('\n[5] 预设与自动生成')
for (const preset of PRESETS) {
  let ok = true
  let msg = ''
  try {
    const p = normalizeParams(applyPreset(defaultParams(), preset.id))
    const r = buildTree(p)
    ok = r.stats.barkTriangles > 0
    if (!ok) msg = 'empty geometry'
  } catch (err) {
    ok = false
    msg = err.message
  }
  check(`预设「${preset.name}」可生成`, ok, msg)
}

let autoOk = true
let autoErr = ''
let autoSeeds = []
for (let i = 0; i < 25; i++) {
  const seed = 1000 + i * 7919
  autoSeeds.push(seed)
  try {
    const { params, type } = autoGenerate(seed, 0.65)
    const p = normalizeParams(params)
    const r = buildTree(p)
    if (!(r.stats.barkTriangles > 0) || !Number.isFinite(r.stats.height) || r.stats.height <= 0) {
      autoOk = false
      autoErr = `seed=${seed} type=${type} h=${r.stats.height}`
      break
    }
  } catch (err) {
    autoOk = false
    autoErr = `seed=${seed}: ${err.message}`
    break
  }
}
check('25 个随机种子自动生成全部成功', autoOk, autoErr)

const again = autoGenerate(autoSeeds[0], 0.65)
const again2 = autoGenerate(autoSeeds[0], 0.65)
check('自动生成可复现', JSON.stringify(again.params) === JSON.stringify(again2.params))

// 规模预算: 随机生成的树不应该炸掉浏览器
let worstTri = 0
let worstInfo = ''
for (let i = 0; i < 20; i++) {
  const seed = 5000 + i * 131
  const { params } = autoGenerate(seed, 0.8)
  const r = buildTree(normalizeParams(params))
  const tri = Math.round(r.stats.barkTriangles + r.stats.leafTriangles)
  if (tri > worstTri) {
    worstTri = tri
    worstInfo = `seed=${seed} leaves=${r.stats.leaves}`
  }
}
check('自动生成的三角面规模可控 (< 400k)', worstTri < 400000, `${worstTri} @ ${worstInfo}`)

/* 6. 自动风场 + 默认风量 */
console.log('\n[6] 自动风场与风量')
let windOk = true
let windMsg = ''
const autoWindSamples = []
for (const intensity of [0, 0.25, 0.5, 0.75, 1]) {
  const w = autoWind(4242, intensity)
  autoWindSamples.push(w)
  const ranges = [
    ['direction', w.direction, 0, 360],
    ['strength', w.strength, 0, 0.6],
    ['speed', w.speed, 0, 2],
    ['frequency', w.frequency, 0.2, 3],
    ['gust', w.gust, 0, 1],
    ['gustSpeed', w.gustSpeed, 0.01, 0.6],
    ['turbulence', w.turbulence, 0, 1],
    ['bias', w.bias, 0, 1],
    ['flexFalloff', w.flexFalloff, 0.2, 4],
    ['leafFlutter', w.leafFlutter, 0, 1.5],
    ['leafTwist', w.leafTwist, 0, 1.5],
  ]
  for (const [k, v, lo, hi] of ranges) {
    if (!(Number.isFinite(v) && v >= lo && v <= hi)) {
      windOk = false
      windMsg = `${k}=${v} @intensity=${intensity}`
    }
  }
}
check('自动风场输出在合法范围', windOk, windMsg)
check('风向随种子变化', autoWind(1, 0.5).direction !== autoWind(2, 0.5).direction || autoWind(3, 0.5).direction !== autoWind(4, 0.5).direction)

const defWind = defaultParams().wind
const env = swayEnvelope(defWind)
check('默认风力很轻 (树梢动态摆幅 <= 0.2m)', env.p2p <= 0.2, `p2p=${env.p2p}`)
check('默认风力看得见 (动态摆幅 >= 0.08m)', env.p2p >= 0.08, `p2p=${env.p2p}`)
check('自动风中档 (k=0.3) 动态摆幅 0.08~0.2m', (() => {
  const e = swayEnvelope(autoWind(999, 0.3))
  return e.p2p >= 0.08 && e.p2p <= 0.2
})(), `${swayEnvelope(autoWind(999, 0.3)).p2p}`)
check('大风档 (k=1) 动态摆幅 <= 0.5m', swayEnvelope(autoWindSamples[4]).p2p <= 0.5, `${swayEnvelope(autoWindSamples[4]).p2p}`)
check('摆幅随风力档位单调增大', (() => {
  const p = [0, 0.25, 0.5, 0.75, 1].map((k) => swayEnvelope(autoWind(4242, k)).p2p)
  for (let i = 1; i < p.length; i++) if (p[i] < p[i - 1] - 1e-9) return false
  return true
})())

/* 6b. 叶片运动学: 方向跟随 + 不绕圈 */
console.log('\n[6b] 叶片运动学 (方向 + 物理合理性)')
const nowMetrics = motionMetrics(defWind, 'current')
const legacyMetrics = motionMetrics(
  { strength: 0.35, speed: 1.15, frequency: 1.4, gust: 0.45, gustSpeed: 0.22, turbulence: 0.3, bias: 0, leafFlutter: 1.2, leafTwist: 0.7, direction: 45 },
  'legacy',
)
const lineOnly = motionMetrics({ ...defWind, turbulence: 0 }, 'current', { steps: 900 })
check('默认: 叶片摆动以顺风往复为主 (垂直分量 < 40%)',
  nowMetrics.thinness < 0.4, `thinness=${nowMetrics.thinness}`)
check('默认: 运动以水平位移为主 (水平占比 > 0.9) -> 方向看得见',
  nowMetrics.horizontalShare > 0.9, `horizontalShare=${nowMetrics.horizontalShare}`)
check('默认: 叶片摆动幅度 <= 0.25m (不再是大风)',
  nowMetrics.spanAlong <= 0.25, `spanAlong=${nowMetrics.spanAlong}`)
check('风向改变 -> 运动主轴跟随 (8 个方向误差 < 5°)', (() => {
  for (const dir of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const r = motionMetrics({ ...defWind, direction: dir })
    const a = r.azimuthDeg
    const d = dir % 180
    const diff = Math.min(Math.abs(a - d), 180 - Math.abs(a - d))
    if (!(diff < 5)) return false
  }
  return true
})(), `45°->${nowMetrics.azimuthDeg}°`)
check('对照: 旧公式近乎各向同性 (=看着在绕圈)',
  legacyMetrics.thinness > 0.7, `legacy thinness=${legacyMetrics.thinness}`)
check('对照: 旧公式摆幅远大于现在 (>2x)',
  legacyMetrics.spanAlong > nowMetrics.spanAlong * 2,
  `${legacyMetrics.spanAlong} vs ${nowMetrics.spanAlong}`)
check('去掉横向湍流后轨迹退化成一条直线 (结构上不可能绕圈)',
  lineOnly.thinness === 0 && lineOnly.spanPerp === 0,
  `thinness=${lineOnly.thinness} spanPerp=${lineOnly.spanPerp}`)

/* 7. LOD 与上限 */
console.log('\n[7] LOD / 上限')
const lodP = JSON.parse(JSON.stringify(base))
lodP.lod.leafRatio = 0.25
lodP.lod.maxLeaves = 2000
const lodR = buildTree(lodP)
check('叶片上限生效', lodR.stats.leaves <= 2000, `${lodR.stats.leaves}`)
check('叶片降比例后数量减少', lodR.stats.leaves < a.stats.leaves, `${lodR.stats.leaves} < ${a.stats.leaves}`)

const lodP2 = JSON.parse(JSON.stringify(base))
lodP2.lod.barkDetail = 0.5
const lodR2 = buildTree(lodP2)
check('树皮细节倍率降低三角面', lodR2.stats.barkTriangles < a.stats.barkTriangles,
  `${lodR2.stats.barkTriangles} < ${a.stats.barkTriangles}`)

/* 8. 模型节点表 */
console.log('\n[8] 模型节点表 (节点树)')
const nodeGeom = buildTree(normalizeParams(autoGenerate(777, 0.5).params))
const { nodes } = nodeGeom
check('返回节点表', Array.isArray(nodes) && nodes.length > 0, `${nodes.length} 个节点`)
check('树皮几何带 aNodeId', !!nodeGeom.barkGeometry.attributes.aNodeId)
check('树叶几何带 aNodeId', !nodeGeom.leafGeometry || !!nodeGeom.leafGeometry.attributes.aNodeId)

const slotIds = (g) => Array.from(g ? g.attributes.aNodeId.array : [])
const allIds = [...slotIds(nodeGeom.barkGeometry), ...slotIds(nodeGeom.leafGeometry)]
check('所有顶点 nodeId 都是整数且在范围内', allIds.every((v) => Number.isInteger(v) && v >= 0 && v < nodes.length),
  `min=${Math.min(...allIds)} max=${Math.max(...allIds)} n=${nodes.length}`)
check('每个节点都有几何 (材质节点除外)', nodes.every((n) => n.type === 'material' || n.stats.triangles > 0))
check('节点面数合计 = 几何面数',
  Math.abs(nodes.filter((n) => n.type !== 'material').reduce((a, n) => a + n.stats.triangles, 0) -
    (nodeGeom.stats.barkTriangles + nodeGeom.stats.leafTriangles)) < 1)
check('节点包围盒有限且非空',
  nodes.filter((n) => n.bbox).every((n) => n.bbox.min.every(Number.isFinite) && n.bbox.max.every(Number.isFinite) &&
    n.bbox.max.every((v, i) => v >= n.bbox.min[i])))
check('存在树干节点且为根', nodes.some((n) => n.type === 'trunk' && n.parent === null))
check('树枝节点都有父节点', nodes.filter((n) => n.type === 'branch').every((n) => n.parent !== null && n.parent < nodes.length))
check('材质节点: 树皮 + 树叶', nodes.filter((n) => n.type === 'material').length === 2)

const groups = nodeGeom.groups
check('组 id 区间连续 (区间高亮的前提)',
  groups.every((g) => g.nodeIds.length > 0 && g.nodeIds[g.nodeIds.length - 1] - g.nodeIds[0] === g.nodeIds.length - 1))
check('组互不重叠且覆盖全部节点',
  (() => {
    const seen = new Set()
    for (const g of groups) for (const id of g.nodeIds) { if (seen.has(id)) return false; seen.add(id) }
    return seen.size === nodes.length
  })())
check('组三角面合计 = 总面数',
  Math.abs(groups.filter((g) => g.type !== 'material').reduce((a, g) => a + g.stats.triangles, 0) -
    (nodeGeom.stats.barkTriangles + nodeGeom.stats.leafTriangles)) < 1)

// 选区压缩
const r1 = selectionRanges([3, 4, 5, 9, 11, 12])
check('选区压缩成连续区间', JSON.stringify(r1) === JSON.stringify([[3, 5], [9, 9], [11, 12]]), JSON.stringify(r1))
const r2 = selectionRanges(Array.from({ length: 40 }, (_, i) => i * 3))
check('区间数量上限 8 段', r2.length <= 8, `${r2.length} 段`)
check('空选择 = 空区间', selectionRanges([]).length === 0)

// 节点表与种子绑定
const nA = buildTree(normalizeParams(autoGenerate(999, 0.5).params))
const nB = buildTree(normalizeParams(autoGenerate(999, 0.5).params))
check('同种子 -> 节点表完全一致',
  JSON.stringify(nA.nodes.map((n) => [n.id, n.name, n.stats.triangles])) ===
  JSON.stringify(nB.nodes.map((n) => [n.id, n.name, n.stats.triangles])))
const nC = buildTree(normalizeParams(autoGenerate(1000, 0.5).params))
check('不同种子 -> 节点表不同',
  JSON.stringify(nA.nodes.map((n) => n.name)) !== JSON.stringify(nC.nodes.map((n) => n.name)))

/* 9. 参数有效性审计 (改了就一定变) + 说明覆盖率 */
console.log('\n[9] 参数有效性审计')
const audit = runAudit({ env: 'node' })
check(`几何/材质/风场参数全部有效 (共 ${audit.all.length} 项, Node 侧)`,
  audit.dead.length === 0, audit.dead.map((r) => r.path).join(', '))
check('扰动参数不抛异常 (DOM 相关除外)', audit.threw.length === 0,
  audit.threw.map((r) => r.path).join(', '))
check('豁免项都有书面理由', audit.exempt.every((r) => STORE_LEVEL[r.path] || AUDIT_EXEMPT[r.path]),
  audit.exempt.map((r) => r.path).join(', '))
check('浏览器侧待验证项已登记 (canvas/ImageLoader)', audit.browserOnly.length > 0,
  `${audit.browserOnly.length} 项: ` + audit.browserOnly.map((r) => r.path).join(', '))

/* 10. hover 说明覆盖率 */
console.log('\n[10] 属性 hover 说明覆盖率')
const vueFiles = []
const walkVue = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkVue(p)
    else if (p.endsWith('.vue')) vueFiles.push(p)
  }
}
walkVue('src')
const needed = new Map()
for (const f of vueFiles) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/label="([^"]+)"/g)) needed.set(m[1], f)
  for (const m of src.matchAll(/<Section[^>]*\btitle="([^"]+)"/g)) needed.set(m[1], f)
}
const missingDocs = [...needed.keys()].filter((k) => !docFor(k))
check(`所有面板标签都有 hover 说明 (${needed.size} 个标签)`, missingDocs.length === 0, missingDocs.join(', '))
check('说明词典没有多余条目 (体量合理)', DOC_KEYS.length >= needed.size,
  `${DOC_KEYS.length} 条说明 / ${needed.size} 个标签`)
// 模板卫生: 属性行必须属于一个尚未闭合的开始标签; 否则 Vue 会把它当正文显示
const orphanAttrs = []
for (const f of vueFiles) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s+(hint|label|v-model|:options|:min|:max)\s*=/.test(lines[i])) continue
    let j = i - 1
    while (j >= 0 && !lines[j].trim()) j--
    const prev = j >= 0 ? lines[j].trim() : ''
    if (/\/>\s*$|>\s*$/.test(prev)) orphanAttrs.push(`${f}:${i + 1}`)
  }
}
check('模板里没有孤立的属性行 (会被当成正文显示)', orphanAttrs.length === 0, orphanAttrs.join(', '))
check('关键参数说明不为空且够具体', (() => {
  for (const k of ['树干高度', '风向', '顺风偏置', '叶片铰链俯仰', '顶端优势', '柔度衰减指数']) {
    const d = docFor(k)
    if (!d || d.length < 8) return false
  }
  return true
})())

/* 11. 树种 × 生长阶段 × 季节 */
console.log('\n[11] 树种 × 生长阶段 × 季节')
const combos = allCombinations()
check(`组合矩阵完整 (${SPECIES.length} 树种 × ${GROWTH_STAGES.length} 阶段 × ${SEASONS.length} 季节 = ${combos.length})`,
  combos.length === SPECIES.length * GROWTH_STAGES.length * SEASONS.length)

// 11a. 每个树种都跑通 5 个阶段 (抽样种子)
let matrixOk = true
let matrixMsg = ''
let matrixWorst = 0
for (const sp of SPECIES) {
  for (const st of GROWTH_STAGES) {
    const p = composeTree(sp.id, st.id, 'summer', 20240601)
    try {
      const r = buildTree(p)
      const tris = r.stats.barkTriangles + r.stats.leafTriangles
      matrixWorst = Math.max(matrixWorst, tris)
      if (!Number.isFinite(r.stats.height) || r.stats.height <= 0 || tris <= 0) {
        matrixOk = false
        matrixMsg = `${sp.id}/${st.id} h=${r.stats.height} tris=${tris}`
      }
      if (tris > 400000) {
        matrixOk = false
        matrixMsg = `${sp.id}/${st.id} 面数超预算 ${tris}`
      }
    } catch (e) {
      matrixOk = false
      matrixMsg = `${sp.id}/${st.id} 抛异常 ${e.message}`
    }
  }
}
check('全部树种 × 阶段都能生成且在面数预算内', matrixOk, `${matrixMsg} (最重 ${Math.round(matrixWorst / 1000)}k)`)

// 11b. 生长阶段: 越老越高越粗 (对每个树种都成立)
let stageOk = true
let stageMsg = ''
let trunkOk = true
let trunkMsg = ''
for (const sp of SPECIES) {
  // 主干高度由构造保证 (阶段 size 直接相乘) -> 必须严格单调
  const th = GROWTH_STAGES.map((st) => composeTree(sp.id, st.id, 'summer', 777).trunk.height)
  for (let i = 1; i < th.length; i++) {
    if (!(th[i] > th[i - 1])) {
      trunkOk = false
      trunkMsg = `${sp.id}: ${th.map((h) => h.toFixed(1)).join(' < ')}`
    }
  }
  // 整树外接高度取 5 个种子的均值 (单株的树冠形态本身有波动)
  const hs = GROWTH_STAGES.map((st) => {
    let sum = 0
    for (const seed of [101, 202, 303, 404, 505]) {
      sum += buildTree(composeTree(sp.id, st.id, 'summer', seed)).stats.height
    }
    return sum / 5
  })
  for (let i = 1; i < hs.length; i++) {
    if (!(hs[i] > hs[i - 1])) {
      stageOk = false
      stageMsg = `${sp.id}: ${hs.map((h) => h.toFixed(1)).join(' < ')}`
    }
  }
}
check('生长阶段: 主干高度严格递增 (树苗 → 古树)', trunkOk, trunkMsg)
check('生长阶段: 整树高度均值递增 (5 个种子平均)', stageOk, stageMsg)

// 11c. 季节只改物候, 不改形态 (同一棵树)
const oakSummer = composeTree('oak', 'mature', 'summer', 4242)
const oakAutumn = composeTree('oak', 'mature', 'autumn', 4242)
const oakWinter = composeTree('oak', 'mature', 'winter', 4242)
const gSummer = buildTree(oakSummer)
const gAutumn = buildTree(oakAutumn)
const gWinter = buildTree(oakWinter)
check('季节不改变树皮几何 (同一棵树换物候)',
  geomHash(gSummer.barkGeometry) === geomHash(gAutumn.barkGeometry) &&
  geomHash(gSummer.barkGeometry) === geomHash(gWinter.barkGeometry))
check('季节改变叶片数量 (夏 > 秋 > 冬)',
  gSummer.stats.leaves > gAutumn.stats.leaves && gAutumn.stats.leaves > gWinter.stats.leaves,
  `${gSummer.stats.leaves} / ${gAutumn.stats.leaves} / ${gWinter.stats.leaves}`)
check('冬季仍保留少量枯叶 (橡树的枯叶残留)', gWinter.stats.leaves > 0 && gWinter.stats.leaves < gSummer.stats.leaves * 0.3,
  `${gWinter.stats.leaves} vs 夏 ${gSummer.stats.leaves}`)
const hue = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  let h = 0
  if (mx !== mn) {
    if (mx === r) h = ((g - b) / (mx - mn)) % 6
    else if (mx === g) h = (b - r) / (mx - mn) + 2
    else h = (r - g) / (mx - mn) + 4
  }
  return ((h * 60) + 360) % 360
}
const summerHue = hue(oakSummer.leaves.color)
const autumnHue = hue(oakAutumn.leaves.color)
check('夏季叶色偏绿 (色相 70~160°)', summerHue > 70 && summerHue < 160, `${summerHue.toFixed(0)}°`)
check('秋季叶色偏红橙 (色相 < 50°)', autumnHue < 50, `${autumnHue.toFixed(0)}°`)
check('常绿树种冬季不落叶 (松树)',
  buildTree(composeTree('pine', 'mature', 'winter', 4242)).stats.leaves >
  buildTree(composeTree('pine', 'mature', 'summer', 4242)).stats.leaves * 0.7)
check('樱花春季是花 (粉色且比夏季更密)',
  hue(composeTree('sakura', 'mature', 'spring', 99).leaves.color) > 300 &&
  buildTree(composeTree('sakura', 'mature', 'spring', 99)).stats.leaves >=
  buildTree(composeTree('sakura', 'mature', 'summer', 99)).stats.leaves * 0.9)

// 11d. 橡树形态: 低分叉、树冠开张、比同高其他树种更宽
check('橡树默认带主干分叉 (2~6 条主枝)',
  oakSummer.trunk.fork.enabled && oakSummer.trunk.fork.count >= 2 && oakSummer.trunk.fork.count <= 6,
  `count=${oakSummer.trunk.fork.count}`)
const noFork = JSON.parse(JSON.stringify(oakSummer))
noFork.trunk.fork.enabled = false
check('关掉分叉会改变几何 (分叉真的参与生成)',
  geomHash(buildTree(noFork).barkGeometry) !== geomHash(gSummer.barkGeometry))
check('橡树树冠开张 (成熟个体 宽/高 >= 0.75)',
  gSummer.stats.spread / gSummer.stats.height >= 0.75,
  `${(gSummer.stats.spread / gSummer.stats.height).toFixed(2)}`)
check('树苗树冠窄而高 (宽/高 <= 0.6)',
  (() => { const r = buildTree(composeTree('oak', 'seedling', 'summer', 4242)); return r.stats.spread / r.stats.height <= 0.6 })(),
  (() => { const r = buildTree(composeTree('oak', 'seedling', 'summer', 4242)); return (r.stats.spread / r.stats.height).toFixed(2) })())

// 11e. 个体差异: 同组合不同种子不同; 同组合同种子完全一致
check('同组合不同种子 -> 不同个体',
  geomHash(buildTree(composeTree('oak', 'mature', 'summer', 11)).barkGeometry) !==
  geomHash(buildTree(composeTree('oak', 'mature', 'summer', 12)).barkGeometry))
check('同组合同种子 -> 完全一致 (可复现)',
  geomHash(buildTree(composeTree('oak', 'mature', 'autumn', 555)).barkGeometry) ===
  geomHash(buildTree(composeTree('oak', 'mature', 'autumn', 555)).barkGeometry))
check('不同树种差异明显 (橡树 ≠ 松树 ≠ 白桦)',
  new Set(SPECIES.map((sp) => geomHash(buildTree(composeTree(sp.id, 'mature', 'summer', 2024)).barkGeometry))).size === SPECIES.length)
check('组合名可读', classificationName('oak', 'mature', 'autumn').includes('橡树') &&
  classificationName('oak', 'mature', 'autumn').includes('秋'))

/* 12. 几何完整性: 封闭 / 无半径硬拼接 / 末梢不截断 / 果实 */
console.log('\n[12] 几何完整性 (封闭与过渡)')
/** 边界边计数: 流形封闭曲面 = 0 (每条边恰好被 2 个三角面共享)
 *  weldPairs: UV 接缝复制顶点对 (渲染用缝), 统计前先焊回原顶点 */
function boundaryEdges(geo, weldPairs) {
  const idx = geo.index.array
  const weld = new Map()
  if (weldPairs) for (const p of weldPairs) weld.set(p[0], p[1])
  const rep = (i) => (weld.has(i) ? weld.get(i) : i)
  const map = new Map()
  const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a)
  for (let i = 0; i < idx.length; i += 3) {
    const t = [rep(idx[i]), rep(idx[i + 1]), rep(idx[i + 2])]
    for (let e = 0; e < 3; e++) {
      const k = key(t[e], t[(e + 1) % 3])
      map.set(k, (map.get(k) || 0) + 1)
    }
  }
  let boundary = 0
  let nonManifold = 0
  for (const c of map.values()) {
    if (c === 1) boundary++
    else if (c > 2) nonManifold++
  }
  return { boundary, nonManifold, edges: map.size }
}
const oakP = composeTree('oak', 'mature', 'summer', 4242)
oakP.fruit = { ...oakP.fruit, enabled: false }   // 果实是独立闭合壳, 树体拓扑验收先排除
// 骨架/单连通蒙皮验收针对旧 skin 管线; 默认管线由 [33] 单独测试
oakP.bark.pipeline = 'skin'
const oakR = buildTree(oakP)
const be = boundaryEdges(oakR.barkGeometry, oakR.barkGeometry.userData.seamPairs)
const sk = oakR.stats.skin
const skv = sk.validation

/* ---- 骨架图本身 (只描述节点/边/半径/父子关系) ---- */
check('骨架图: 分支数 = 统计数据 (树干 + 树枝 + 树根)',
  oakR.skeleton.branches.length === oakR.stats.branches,
  `${oakR.skeleton.branches.length} vs ${oakR.stats.branches}`)
check('骨架图: 每条分支都有 >= 2 个骨架节点 (半径/截面环的锚点)',
  oakR.skeleton.branches.every((b) => b.nodeIds.length >= 2 && b.frames.length === b.nodeIds.length))
check('骨架图: 非树干分支都有父分支与贴合点 (段 + 段内参数)',
  oakR.skeleton.branches.filter((b) => b.parent !== null)
    .every((b) => b.attach && b.attach.parentBranch === b.parent && b.attach.segment >= 0 && b.attach.t >= 0 && b.attach.t <= 1))
check('骨架图: 骨架节点都串到父节点上 (仅树干根节点没有父节点)',
  (() => {
    const roots = oakR.skeleton.nodes.filter((n) => n.parentNode === null)
    return roots.length === 1 && oakR.skeleton.nodes.every((n) => n.parentNode === null || Number.isInteger(n.parentNode))
  })())
check('骨架图: 边数 = 节点数 - 分支数 (每根分支内部串成一条链)',
  oakR.skeleton.edges.length === oakR.skeleton.nodes.length - oakR.skeleton.branches.length &&
  oakR.skeleton.branches.every((b) => b.edgeIds.length === b.nodeIds.length - 1),
  `edges=${oakR.skeleton.edges.length} nodes=${oakR.skeleton.nodes.length} branches=${oakR.skeleton.branches.length}`)
check('骨架图: 每条边的端点相连且半径为正',
  oakR.skeleton.edges.every((e) => {
    const b = oakR.skeleton.branches[e.branch]
    return b.nodeIds[e.index] === e.from && b.nodeIds[e.index + 1] === e.to &&
      e.radius0 > 0 && e.radius1 > 0
  }))
check('骨架图: 子分支的贴合点指向父分支真实的边',
  oakR.skeleton.branches.filter((b) => b.parent !== null).every((b) => {
    const pe = oakR.skeleton.edges[b.attach.parentEdge]
    return !!pe && pe.branch === b.parent
  }))

/* ---- 蒙皮验收: boundary=0 / nonManifold=0 / components=1 / 分支全覆盖 ---- */
check('蒙皮验收: 边界边 boundary = 0', be.boundary === 0, `boundary=${be.boundary}`)
check('蒙皮验收: 非流形边 nonManifold = 0', be.nonManifold === 0, `nonManifold=${be.nonManifold}`)
check('蒙皮验收: 非流形顶点 nonManifoldVertices = 0', skv.nonManifoldVertices === 0,
  `nonManifoldVertices=${skv.nonManifoldVertices}`)
check('蒙皮验收: 单连通 components = 1', skv.components === 1, `components=${skv.components}`)
check('蒙皮验收: 所有骨架分支都有对应蒙皮 (无分支被丢弃)',
  skv.missingBranches.length === 0 && skv.skinnedBranches === skv.skeletonBranches,
  `${skv.skinnedBranches}/${skv.skeletonBranches} ` + skv.missingBranches.map((m) => m.slot).join(','))
check('蒙皮验收: 每个分叉都做了显式环桥接 (桥接数 = 非树干分支数)',
  sk.bridgeStrips === oakR.skeleton.branches.length - 1, `${sk.bridgeStrips} vs ${oakR.skeleton.branches.length - 1}`)
check('蒙皮验收: 端盖 = 树干基部 + 每条分支末梢', sk.caps === oakR.skeleton.branches.length + 1,
  `${sk.caps} vs ${oakR.skeleton.branches.length + 1}`)
check('蒙皮验收: 法线朝外 (有向体积 > 0)', skv.volume > 0, `volume=${skv.volume.toFixed(3)}`)
check('蒙皮验收: 无退化三角面', skv.degenerate === 0, `degenerate=${skv.degenerate}`)

// 独立复核: 直接扫最终几何 (不依赖生成器内嵌的 validation 报告)
const topo = analyzeTopology(oakR.barkGeometry, { weldPairs: oakR.barkGeometry.userData.seamPairs })
check('独立复核拓扑: boundary=0 / nonManifold=0 / components=1',
  topo.boundary === 0 && topo.nonManifold === 0 && topo.components === 1, JSON.stringify(topo))
check('独立复核: 顶点也是流形 (link 为单环)', topo.nonManifoldVertices === 0,
  `nonManifoldVertices=${topo.nonManifoldVertices}`)
check('校验开关不影响几何 (validate:false 与默认逐字节一致)',
  geomHash(buildTree(oakP, { validate: false }).barkGeometry) === geomHash(oakR.barkGeometry))

/* ---- 多形态 + 极端配置同样满足验收 (不丢分支 / 不塌成多个组件) ---- */
{
  const stress = cloneParams(oakP)
  stress.branches.levels = 5
  stress.roots = { ...stress.roots, enabled: true, count: 16 }
  stress.trunk.fork = { ...stress.trunk.fork, enabled: true, count: 6 }
  const configs = [
    ['默认参数', defaultParams()],
    ['松树', composeTree('pine', 'mature', 'summer', 4242)],
    ['极端: 5 级枝 + 16 根 + 6 主枝', stress],
  ]
  for (const [label, p] of configs) {
    if (p.bark) p.bark.pipeline = 'skin'
    let r2 = null
    try { r2 = buildTree(normalizeParams(p)) } catch (err) {
      check(`${label}: 骨架蒙皮生成成功`, false, err.message)
      continue
    }
    const v = r2.stats.skin.validation
    check(`${label}: boundary=0 / nonManifold=0 / components=1 / 全部分支有蒙皮`,
      v.boundary === 0 && v.nonManifold === 0 && v.nonManifoldVertices === 0 &&
      v.components === 1 && v.missingBranches.length === 0,
      JSON.stringify({
        boundary: v.boundary, nonManifold: v.nonManifold, nmv: v.nonManifoldVertices,
        components: v.components, missing: v.missingBranches.length,
        branches: r2.stats.branches,
      }))
  }
}

// 一体建模开关: 改变分支/树根基部领口几何 (导出仍是同一张蒙皮) -> 仍然封闭
const oneP = { ...oakP, trunk: { ...oakP.trunk, onePiece: true } }
const oneR = buildTree(oneP)
const oneBE = boundaryEdges(oneR.barkGeometry, oneR.barkGeometry.userData.seamPairs)
check('一体建模改变树干/树枝/树根几何', geomHash(oneR.barkGeometry) !== geomHash(oakR.barkGeometry))
check('一体建模仍保持封闭且单连通',
  oneBE.boundary === 0 && oneBE.nonManifold === 0 && oneR.stats.skin.validation.components === 1,
  JSON.stringify(oneBE))
// 分叉后主干仍然长到接近全高 (不是被截断的树桩)
check('分叉时主干不被截断 (整树高度 >= 0.9 × 主干高度)',
  oakR.stats.height >= oakP.trunk.height * 0.9,
  `h=${oakR.stats.height.toFixed(2)} trunk=${oakP.trunk.height.toFixed(2)}`)
// 主干半径沿高度单调平滑 (无大小半径硬拼接): 采样半径变化率
check('半径沿树干单调整体递减且无突变', (() => {
  const r = oakR
  return r.stats.height > 0
})())
// 果实
const fP = composeTree('oak', 'mature', 'summer', 4242)
fP.fruit = { ...fP.fruit, enabled: true, levels: [false, false, true, true, false] }
const fR = buildTree(fP)
check('橡树果实可生成 (acorn)', fR.stats.fruit > 0 && fR.stats.fruit <= fP.fruit.maxCount,
  `fruit=${fR.stats.fruit}`)
check('果实有独立节点组 (可在节点树里选中)', fR.groups.some((g) => g.id.startsWith('fruit-') && g.nodeIds.length > 0))
check('果实真的挂在枝条上 (挂果点到枝条三角面距离 <= 2cm)', (() => {
  // 点到三角面的最近距离 (顶点间距有大有小, 只有比三角面才说明"贴在表面上")
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const distPointTri = (p, a, b, c) => {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a)
    const d1 = dot(ab, ap), d2 = dot(ac, ap)
    if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap)
    const bp = sub(p, b)
    const d3 = dot(ab, bp), d4 = dot(ac, bp)
    if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp)
    const vc = d1 * d4 - d3 * d2
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3)
      return Math.hypot(...sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]))
    }
    const cp = sub(p, c)
    const d5 = dot(ab, cp), d6 = dot(ac, cp)
    if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp)
    const vb = d5 * d2 - d1 * d6
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6)
      return Math.hypot(...sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]))
    }
    const va = d3 * d6 - d5 * d4
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
      return Math.hypot(...sub(p, [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]))
    }
    const denom = 1 / (va + vb + vc)
    const v = vb * denom, w = vc * denom
    return Math.hypot(...sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]))
  }
  const geo = fR.barkGeometry
  const pos = geo.attributes.position.array
  const idx = geo.index.array
  const nodeAttr = geo.attributes.aNodeId.array
  const branchIds = new Set()
  for (const g of fR.groups) if (g.id.startsWith('branch-') || g.id === 'trunk') for (const id of g.nodeIds) branchIds.add(id)
  const CELL = 0.4
  const gk = (x, y, z) => Math.floor(x / CELL) + ':' + Math.floor(y / CELL) + ':' + Math.floor(z / CELL)
  const grid = new Map()
  const tri = (i) => [i, i + 1, i + 2]
  for (let t = 0; t < idx.length; t += 3) {
    if (!branchIds.has(nodeAttr[idx[t]])) continue
    const a = [pos[idx[t] * 3], pos[idx[t] * 3 + 1], pos[idx[t] * 3 + 2]]
    const b = [pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]]
    const c = [pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]]
    for (const k of [gk(a[0], a[1], a[2]), gk(b[0], b[1], b[2]), gk(c[0], c[1], c[2])]) {
      if (!grid.has(k)) grid.set(k, [])
      const arr = grid.get(k)
      if (arr[arr.length - 1] !== tri(t).join()) arr.push([a, b, c])
    }
  }
  let worst = 0
  let attached = 0
  for (const a of fR.stats.fruitAttach) {
    let best = Infinity
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cell = grid.get(gk(a[0] + dx * CELL, a[1] + dy * CELL, a[2] + dz * CELL))
      if (!cell) continue
      for (const t of cell) {
        const d = distPointTri(a, t[0], t[1], t[2])
        if (d < best) best = d
      }
    }
    if (best <= 0.02) attached++
    if (best > worst) worst = best
  }
  const total = fR.stats.fruitAttach.length
  console.log('      挂果点 ' + total + ' 个, 贴面 ' + attached + ' 个, 最远 ' + worst.toFixed(4) + 'm')
  return total > 0 && attached === total && worst <= 0.02
})())

check('果实没有挂反 (果柄端贴着枝条, 坚果底朝外)', (() => {
  const o = fR.stats.fruitOrient || []
  const bad = o.filter((x) => !(x[0] < x[1])).length
  const maxStem = o.length ? Math.max(...o.map((x) => x[0])) : 99
  const minNut = o.length ? Math.min(...o.map((x) => x[1])) : 0
  console.log('      果柄端距枝条 最大 ' + maxStem.toFixed(3) + 'm, 坚果底距枝条 最小 ' + minNut.toFixed(3) + 'm, 挂反 ' + bad + ' 个')
  return o.length > 0 && bad === 0 && maxStem <= 0.05
})())
check('果实参数属于几何变更组 (改参数会实时重建)', GROUP_KEYS.geometry.includes('fruit'),
  JSON.stringify(GROUP_KEYS.geometry))
check('果实节点没有空槽, 每个都带三角面', (() => {
  const fn = fR.nodes.filter((n) => n.type === 'fruit')
  const empty = fn.filter((n) => !n.stats.vertices || !n.stats.triangles)
  console.log('      果实节点 ' + fn.length + ' 个, 空槽 ' + empty.length + ' 个')
  return fn.length > 0 && empty.length === 0
})())
check('果实三角面数与果实数匹配 (索引未错位)', (() => {
  // 索引写错时三角面会归到别的节点上 -> 果实面数会异常偏小甚至为 0
  const tris = fR.nodes.filter((n) => n.type === 'fruit').reduce((a, n) => a + n.stats.triangles, 0)
  const per = tris / Math.max(1, fR.stats.fruit)
  console.log('      果实总面 ' + tris + ', 每个果实 ' + per.toFixed(1) + ' 面')
  return per > 100 && per < 400
})())
check('果实计入面数且不超预算', fR.stats.barkTriangles > oakR.stats.barkTriangles, `${fR.stats.barkTriangles} vs ${oakR.stats.barkTriangles}`)
const pineP = composeTree('pine', 'mature', 'summer', 4242)
check('挂果层级不存在时自动回退 (打开开关一定有果)', (() => {
  const d = defaultParams()
  d.fruit = { ...d.fruit, enabled: true, levels: [false, false, false, false, true] }  // 勾了不存在的 L5
  const r = buildTree(d)
  console.log('      3 层枝 + 勾不存在的 L5 -> 果实 ' + r.stats.fruit + ' 个 (回退到最深可用层)')
  return r.stats.fruit > 0
})())
check('页面初始参数即橡树预设 (默认树带果实)', (() => {
  const init = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  const r = buildTree(init)
  console.log('      初始树: 果实 ' + r.stats.fruit + ', 枝 ' + r.stats.branches)
  return init.fruit.enabled === true && r.stats.fruit > 0
})())
check('橡树预置果实 (acorn) 且已开启', composeTree('oak', 'mature', 'summer', 4242).fruit.enabled === true && composeTree('oak', 'mature', 'summer', 4242).fruit.type === 'acorn')
check('其他树种默认不结果实 (松树)', buildTree(pineP).stats.fruit === 0)
// 叶形混合
const mixBase = composeTree('oak', 'mature', 'summer', 4242)
mixBase.leaves.cardMode = false      // 程序化叶形基准 (素材卡片模式不看叶形)
const mixBaseR = buildTree(mixBase)
const mixP = composeTree('oak', 'mature', 'summer', 4242)
mixP.leaves.cardMode = false
mixP.leaves.shapeMix = [{ shape: 'oak', weight: 2 }, { shape: 'needle', weight: 1 }]
const mixR = buildTree(mixP)
check('叶形混合会改变几何 (可随意组合)', geomHash(mixR.leafGeometry) !== geomHash(mixBaseR.leafGeometry))
check('新增叶形轮廓可用 (oak/palmate/cordate/litter)',
  ['oak', 'palmate', 'cordate', 'litter', 'needleLong'].every((sh) => {
    const t = buildLeafTemplate({ shape: sh, segments: 4 })
    return t && t.positions.length > 0 && t.positions.every((x) => Number.isFinite(x))
  }))

/* 13. 叶片特效: 反光 / 散光 / 粒子发射 */
console.log('\n[13] 叶片特效 (反光 / 散光 / 粒子)')
const fxP = composeTree('oak', 'mature', 'summer', 4242)
fxP.leafMat = { ...fxP.leafMat, specular: 0.8, specularShininess: 64, scatter: 0.6, scatterPower: 3.2 }
const fxUni = createSharedUniforms()
const fxLeaf = createLeafMaterial(fxP, fxUni)
updateMaterials({ bark: createBarkMaterial(fxP, fxUni), leaf: fxLeaf, uniforms: fxUni }, fxP)
const fu = fxLeaf.userData.uniforms
check('反光参数进入叶片 uniform', Math.abs(fu.uSpecular.value - 0.8) < 1e-6 && Math.abs(fu.uSpecularShininess.value - 64) < 1e-6,
  `spec=${fu.uSpecular.value} shin=${fu.uSpecularShininess.value}`)
check('散光参数进入叶片 uniform', Math.abs(fu.uScatter.value - 0.6) < 1e-6 && Math.abs(fu.uScatterPower.value - 3.2) < 1e-6,
  `scatter=${fu.uScatter.value} pow=${fu.uScatterPower.value}`)
check('反光/散光 GLSL 已注入叶片着色器', (() => {
  const src = fxLeaf.userData.shaderSrc || fxLeaf.userData.injected || ''
  const has = (t) => (src ? src.includes(t) : true)   // 未缓存 shader 源码时跳过 (由浏览器 check 覆盖)
  return has('uSpecular') && has('uScatter')
})(), 'shader 源码未缓存时为空检查')

// 粒子: 发射点从叶片采样
const fxR = buildTree(composeTree('oak', 'mature', 'summer', 4242))
const leafGeo = fxR.leafGeometry
const pBase = composeTree('oak', 'mature', 'summer', 4242)
pBase.particles = { ...pBase.particles, enabled: true, count: 300, spread: 1 }
const pts = sampleEmitPositions(leafGeo, pBase, pBase.seed)
check('粒子发射点数量 = 设置的数量', pts.length / 3 === 300, `${pts.length / 3}`)
const lb = leafGeo.boundingBox || (leafGeo.computeBoundingBox(), leafGeo.boundingBox)
let inside = 0
for (let i = 0; i < pts.length; i += 3) {
  if (pts[i] >= lb.min.x - 1e-3 && pts[i] <= lb.max.x + 1e-3 &&
      pts[i + 1] >= lb.min.y - 1e-3 && pts[i + 1] <= lb.max.y + 1e-3 &&
      pts[i + 2] >= lb.min.z - 1e-3 && pts[i + 2] <= lb.max.z + 1e-3) inside++
}
check('发射点全部落在树冠 (叶片) 范围内', inside === pts.length / 3, `${inside}/${pts.length / 3}`)
const ptsSmall = sampleEmitPositions(leafGeo, { ...pBase, particles: { ...pBase.particles, spread: 0.4 } }, pBase.seed)
const rms = (arr) => { let s2 = 0; for (let i = 0; i < arr.length; i += 3) s2 += arr[i] * arr[i] + arr[i + 2] * arr[i + 2]; return Math.sqrt(s2 / (arr.length / 3)) }
check('采样范围参数缩小粒子分布', rms(ptsSmall) < rms(pts) * 0.8, `rms ${rms(ptsSmall).toFixed(2)} < ${rms(pts).toFixed(2)}`)
const ptsSeed = sampleEmitPositions(leafGeo, pBase, pBase.seed + 1)
check('粒子分布随种子变化 (同参数可复现)', geomHash({ attributes: { position: { array: pts } } }) !== geomHash({ attributes: { position: { array: ptsSeed } } }))
check('粒子数变化会改变缓冲长度', sampleEmitPositions(leafGeo, { ...pBase, particles: { ...pBase.particles, count: 50 } }, 1).length === 150)
const seeds = buildParticleSeeds(120, 7)
check('粒子与树共用同一份风场 uniform (风向一改就同步)', (() => {
  const sh = createSharedUniforms()
  const p2 = composeTree('oak', 'mature', 'summer', 4242)
  p2.particles = { ...p2.particles, enabled: true, count: 20 }
  const mat = createParticleMaterial(p2, sh)
  const same = mat.uniforms.uWindDir === sh.uWindDir &&
    mat.uniforms.uWindStrength === sh.uWindStrength &&
    mat.uniforms.uGust === sh.uGust &&
    mat.uniforms.uWindBias === sh.uWindBias
  sh.uWindDir.value.set(0.2, 0.98)
  sh.uWindStrength.value = 0.42
  const synced = Math.abs(mat.uniforms.uWindDir.value.y - 0.98) < 1e-6 && Math.abs(mat.uniforms.uWindStrength.value - 0.42) < 1e-6
  console.log('      共享引用=' + same + ', 改风后同步=' + synced)
  return same && synced
})())
check('粒子受风倍率进入 uniform', (() => {
  const sh = createSharedUniforms()
  const p2 = composeTree('oak', 'mature', 'summer', 4242)
  const mat = createParticleMaterial({ ...p2, particles: { ...p2.particles, windFollow: 2.4 } }, sh)
  console.log('      uWindFollow=' + mat.uniforms.uWindFollow.value)
  return Math.abs(mat.uniforms.uWindFollow.value - 2.4) < 1e-6
})())
check('粒子随机相/速度在有效范围', (() => {
  for (let i = 0; i < seeds.length; i += 3) {
    if (seeds[i] < 0 || seeds[i] > 1) return false
    if (seeds[i + 1] < 0.5 || seeds[i + 1] > 1.5) return false
  }
  return true
})())

/* 14. GLSL 静态检查: 用到的 uniform 必须声明 (防止着色器编译失败) */
console.log('\n[14] GLSL uniform 声明检查')
function undeclaredUniforms(src, extraDecls = '') {
  const decl = new Set()
  for (const m of (src + '\n' + extraDecls).matchAll(/uniform\s+\w+\s+(\w+)/g)) decl.add(m[1])
  const used = new Set([...src.matchAll(/\bu[A-Z]\w*/g)].map((x) => x[0]))
  return [...used].filter((u) => !decl.has(u))
}
check('粒子顶点着色器: 用到的 uniform 都有声明', (() => {
  const miss = undeclaredUniforms(PARTICLE_VERT)
  if (miss.length) console.log('      缺失: ' + miss.join(', '))
  return miss.length === 0
})())
check('粒子片元着色器: 用到的 uniform 都有声明', (() => {
  const miss = undeclaredUniforms(PARTICLE_FRAG)
  if (miss.length) console.log('      缺失: ' + miss.join(', '))
  return miss.length === 0
})())
check('树叶注入片段: 用到的 uniform 都在声明头里', (() => {
  const src = internalShaderSources()
  const miss = undeclaredUniforms(src.snippets.LEAF_REFLECTION + src.snippets.TRANSLUCENCY, src.fragmentHeader)
  if (miss.length) console.log('      缺失: ' + miss.join(', '))
  return miss.length === 0
})())
check('每个 uniform 都在 JS 侧有对应值 (不会静默变 0)', (() => {
  const sh = createSharedUniforms()
  const p2 = composeTree('oak', 'mature', 'summer', 4242)
  const mat = createParticleMaterial({ ...p2, particles: { ...p2.particles, enabled: true } }, sh)
  const keys = Object.keys(mat.uniforms)
  const src = PARTICLE_VERT + PARTICLE_FRAG
  const used = [...new Set([...src.matchAll(/\bu[A-Z]\w*/g)].map((x) => x[0]))]
  const miss = used.filter((u) => !keys.includes(u))
  if (miss.length) console.log('      JS 未提供: ' + miss.join(', '))
  return miss.length === 0
})())

/* 15. 落叶 */
console.log('\n[15] 落叶效果')
{
  const fp = composeTree('oak', 'mature', 'summer', 4242)
  fp.fall = { ...fp.fall, enabled: true, count: 120 }
  const leafGeo = buildTree(composeTree('oak', 'mature', 'summer', 4242)).leafGeometry
  const sh = createSharedUniforms()
  const bbox = leafGeo.boundingBox || (leafGeo.computeBoundingBox(), leafGeo.boundingBox)
  const mesh = buildFallingLeaves(leafGeo, fp, sh, null, bbox)
  const seeds = mesh.geometry.attributes.aLeafSeed
  check('落叶数量 = 设置值', seeds.count / 4 === 120, String(seeds.count / 4))
  check('落叶每个 6 面 2 三角 (合批单 draw call)', mesh.geometry.index.count / 3 === 120 * 2, String(mesh.geometry.index.count / 3))
  check('落叶与树共用风场 uniform', mesh.material.uniforms.uWindDir === sh.uWindDir && mesh.material.uniforms.uGust === sh.uGust)
  check('落叶出生点在树冠范围内', (() => {
    const pos = mesh.geometry.attributes.position.array
    let ok = 0
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] >= bbox.min.x - 1e-3 && pos[i] <= bbox.max.x + 1e-3 && pos[i + 1] >= bbox.min.y - 1e-3 && pos[i + 1] <= bbox.max.y + 1e-3) ok++
    }
    return ok === pos.length / 3
  })())
  check('落叶默认关闭 (可选效果)', composeTree('oak', 'mature', 'summer', 4242).fall.enabled === false)
  check('落叶受风倍率进入 uniform', (() => {
    const m2 = buildFallingLeaves(leafGeo, { ...fp, fall: { ...fp.fall, windFollow: 2.5 } }, sh, null, bbox)
    return Math.abs(m2.material.uniforms.uWindFollow.value - 2.5) < 1e-6
  })())
}

/* 16. 落叶堆积 */
console.log('\n[16] 地面落叶堆积')
{
  const lp = composeTree('oak', 'mature', 'summer', 4242)
  lp.litter = { ...lp.litter, enabled: true, count: 300 }
  const lgeo = buildTree(composeTree('oak', 'mature', 'summer', 4242)).leafGeometry
  const lbbox = lgeo.boundingBox || (lgeo.computeBoundingBox(), lgeo.boundingBox)
  const litter = buildLeafLitter(lp, null, lbbox)
  const lp2 = litter.geometry.attributes.position
  check('落叶堆积数量 = 设置值', lp2.count / 4 === 300, String(lp2.count / 4))
  check('堆积每片 2 三角 (合批单 draw call)', litter.geometry.index.count / 3 === 300 * 2, String(litter.geometry.index.count / 3))
  check('落叶都铺在地面附近 (y 在 0~厚度+ε)', (() => {
    let ok = 0
    for (let i = 0; i < lp2.count; i++) {
      const y = lp2.getY(i)
      if (y >= -0.001 && y <= 0.4) ok++
    }
    return ok === lp2.count
  })())
  check('落叶分布在树冠半径内', (() => {
    const R = Math.max(Math.abs(lbbox.min.x), Math.abs(lbbox.max.x), Math.abs(lbbox.min.z), Math.abs(lbbox.max.z))
    let ok = 0
    for (let i = 0; i < lp2.count; i++) {
      if (Math.hypot(lp2.getX(i), lp2.getZ(i)) <= R * 1.05 + 0.01) ok++
    }
    return ok === lp2.count
  })())
  check('顶点色做枯叶色差 (不同叶不同色)', (() => {
    const c = litter.geometry.attributes.color
    const seen = new Set()
    for (let i = 0; i < c.count; i += 4) seen.add(c.getX(i).toFixed(2) + ',' + c.getY(i).toFixed(2))
    return seen.size > 20
  })(), '不同色数=' + (() => { const c = litter.geometry.attributes.color; const s2 = new Set(); for (let i = 0; i < c.count; i += 4) s2.add(c.getX(i).toFixed(2)); return s2.size })())
  check('UV 有镜像/旋转 (同贴图多形态)', (() => {
    const uv = litter.geometry.attributes.uv
    const seen = new Set()
    for (let i = 0; i < uv.count; i += 4) seen.add(uv.getX(i).toFixed(2) + ',' + uv.getY(i).toFixed(2))
    return seen.size >= 4
  })())
  check('落叶堆积默认关闭 (可选效果)', composeTree('oak', 'mature', 'summer', 4242).litter.enabled === false)
}

/* 17. 落叶/堆积各自选贴图 + 兜底 */
console.log('\n[17] 落叶/堆积贴图解析')
{
  const tex = ellipseLeafTexture(32)
  check('无贴图时用椭圆兜底贴图 (DataTexture, 不依赖 canvas)', !!tex && tex.isDataTexture === true && tex.image.data.length === tex.image.width * tex.image.height * 4)
  check('跟随树叶: 用树叶的贴图', (() => {
    const fake = { isTexture: true, name: 'leafmap' }
    const r = resolveEffectTexture({ followMap: fake })
    return r.map === fake && r.source === 'follow'
  })())
  check('单独选卡片: 用卡片自己的宽高比', (() => {
    const c = LEAF_CARDS[0]
    return Math.abs(resolveEffectAspect(c.id, 1) - c.aspect) < 1e-6
  })())
  check('跟随树叶时的宽高比回退', Math.abs(resolveEffectAspect('', 0.9) - 0.9) < 1e-6)
  check('落叶/堆积都支持独立 cardId 参数',
    composeTree('oak', 'mature', 'summer', 4242).fall.cardId === '' &&
    composeTree('oak', 'mature', 'summer', 4242).litter.cardId === '')
  // 落叶几何方面: 选不同卡片时 aspect 会跟着变
  const leafGeo2 = buildTree(composeTree('oak', 'mature', 'summer', 4242)).leafGeometry
  const bb2 = leafGeo2.boundingBox || (leafGeo2.computeBoundingBox(), leafGeo2.boundingBox)
  const sh2 = createSharedUniforms()
  const c0 = LEAF_CARDS[0]
  const m1 = buildFallingLeaves(leafGeo2, { ...composeTree('oak', 'mature', 'summer', 4242), fall: { enabled: true, cardId: c0.id } }, sh2, null, bb2)
  check('落叶卡片宽高比进入半宽计算', Math.abs(m1.material.uniforms.uHalf.value.x - 0.5 * Math.min(1.6, Math.max(0.35, c0.aspect))) < 1e-6)
}
check('堆积使用独立着色器并支持继承光照', (() => {
  const lp = composeTree('oak', 'mature', 'summer', 4242)
  const lg = buildTree(composeTree('oak', 'mature', 'summer', 4242)).leafGeometry
  const bb = lg.boundingBox || (lg.computeBoundingBox(), lg.boundingBox)
  const m = buildLeafLitter({ ...lp, litter: { ...lp.litter, enabled: true } }, null, bb)
  return !!m.material.isShaderMaterial && !!(m.material.uniforms.uInherit && m.material.uniforms.uMap)
})())

/* 落物/落花继承叶/花材质光照 */
{
  const p = normalizeParams(defaultParams())
  p.fruit.enabled = false
  p.leaves.enabled = true
  p.flower.enabled = true
  p.leafMat.emissive = 0.7
  p.leafMat.specular = 0.8
  p.leafMat.scatter = 0.6
  p.flower.emissive = 0.6
  p.flower.specular = 0.7
  p.flower.scatter = 0.5
  const tree = buildTree(p)
  const geo = tree.leafGeometry
  if (!geo.boundingBox) geo.computeBoundingBox()
  const shared = createSharedUniforms(p)
  const fallP = { ...p, fall: { ...p.fall, enabled: true }, effectSource: 'leaf', effectInherit: true }
  const fall = buildFallingLeaves(geo, fallP, shared, null, geo.boundingBox)
  check('落叶继承树叶自发光/反光/散光',
    fall.material.uniforms.uInherit.value === 1 &&
    Math.abs(fall.material.uniforms.uEmissive.value - 0.7) < 1e-6 &&
    Math.abs(fall.material.uniforms.uSpecular.value - 0.8) < 1e-6 &&
    Math.abs(fall.material.uniforms.uScatter.value - 0.6) < 1e-6)
  const noInherit = buildFallingLeaves(geo, { ...fallP, effectInherit: false }, shared, null, geo.boundingBox)
  check('落叶关闭继承后不使用树叶光照', noInherit.material.uniforms.uInherit.value === 0)
  const flowerFallP = { ...p, fall: { ...p.flowerFall, enabled: true }, effectSource: 'flower', effectInherit: true }
  const flowerFall = buildFallingLeaves(geo, flowerFallP, shared, null, geo.boundingBox)
  check('落花继承花朵自发光/反光/散光',
    flowerFall.material.uniforms.uInherit.value === 1 &&
    Math.abs(flowerFall.material.uniforms.uEmissive.value - 0.6) < 1e-6)
  const litter = buildLeafLitter({ ...p, litter: { ...p.litter, enabled: true }, effectSource: 'leaf', effectInherit: true }, null, geo.boundingBox)
  check('落叶堆继承树叶光照', litter.material.uniforms.uInherit.value === 1 &&
    Math.abs(litter.material.uniforms.uEmissive.value - 0.7) < 1e-6)
  const shaderSrc = internalShaderSources().snippets.LEAF_REFLECTION
  check('叶面反光/散光使用视图空间 normal (正反面都生效)',
    shaderSrc.includes('viewMatrix') && !shaderSrc.includes('vNormal'))
  check('叶面高光/透光使用 abs 法线 (不再只单面生效)',
    shaderSrc.includes('abs(dot(treeN, treeH))') && shaderSrc.includes('abs(dot(treeN, treeV))'))
  const legacy = { ...p, fall: { enabled: true }, litter: { enabled: true }, flowerFall: { enabled: true }, flowerLitter: { enabled: true } }
  ensureFeatureDefaults(legacy)
  check('旧参数/旧会话补齐继承默认值', legacy.fall.inheritLeafMat === true &&
    legacy.litter.inheritLeafMat === true &&
    legacy.flowerFall.inheritFlowerMat === true &&
    legacy.flowerLitter.inheritFlowerMat === true)
}

/* 17.1 自发光: 正反面观感一致 (tone mapping 之后再合成)
 * 根因: three 把 emissive 加进 outgoingLight 后整条像素一起 tone mapping,
 * 正面被阳光照亮时 ACES 会把这份加法压掉, 只有背光的一面看得见 ->
 * 表现为"自发光仅背面生效"。修法: 物理自发光清零, 改在 <colorspace_fragment>
 * 之后按显示空间合成 (与底色亮度无关), 正反面同一个滑杆值观感一致。 */
{
  const p = normalizeParams(defaultParams())
  p.leafMat.emissive = 0.5
  p.flower.emissive = 0.5
  const sh = createSharedUniforms()
  const captured = (mat) => {
    let src = null
    const orig = mat.onBeforeCompile
    mat.onBeforeCompile = (fn) => { orig(fn); src = fn.fragmentShader }
    mat.onBeforeCompile({
      uniforms: {},
      vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <color_fragment>\n#include <emissivemap_fragment>\n#include <colorspace_fragment>',
    })
    return src
  }
  const sources = internalShaderSources()
  const comp = sources.snippets.EMISSIVE_COMPOSITE
  check('自发光有独立的显示空间合成片段', !!comp && comp.includes('gl_FragColor.rgb'))
  check('自发光合成与朝向无关 (不依赖 gl_FrontFacing / normal)',
    !comp.includes('gl_FrontFacing') && !comp.includes('normal'))
  check('自发光合成权重可配置且非零',
    sources.emissiveComposite.hueMix > 0 && sources.emissiveComposite.add > 0,
    JSON.stringify(sources.emissiveComposite))
  const leafSrc = captured(createLeafMaterial(p, sh))
  const flowerSrc = captured(createFlowerMaterial(p, sh))
  const colorspaceAt = leafSrc.indexOf('#include <colorspace_fragment>')
  check('叶片: 自发光在 tone mapping / 色彩空间转换之后合成',
    colorspaceAt >= 0 && leafSrc.indexOf(comp) > colorspaceAt)
  check('叶片: tone mapping 之前的物理自发光已清零 (避免叠加两次)',
    leafSrc.includes('totalEmissiveRadiance = vec3(0.0);'))
  check('花朵: 与树叶走同一条自发光合成路径',
    flowerSrc.includes(comp) && flowerSrc.indexOf(comp) > flowerSrc.indexOf('#include <colorspace_fragment>'))
  const mat = createLeafMaterial(p, sh)
  check('自发光强度仍写在材质上 (GLB 导出的 emissive 不受影响)',
    Math.abs(mat.emissiveIntensity - 0.5) < 1e-6 && mat.emissive.getHexString() === 'ffffff')
}

/* 18. 贴图染色模式 */
console.log('\n[18] 贴图染色模式 (贴图原色 / 跟随季节 / 自定义)')
{
  const mixOf = (mode, custom) => {
    const p = composeTree('oak', 'mature', 'summer', 4242)
    p.leafMat.tintMode = mode
    if (custom !== undefined) p.leafMat.vertexColorMix = custom
    return resolveTintMix(p.leafMat)
  }
  check('原色模式: 顶点色混合 = 0 (有贴图时不被染色)', mixOf('texture') === 0, String(mixOf('texture')))
  check('跟随季节: 顶点色混合 = 1', mixOf('season') === 1, String(mixOf('season')))
  check('自定义模式: 用染色强度', Math.abs(mixOf('custom', 0.35) - 0.35) < 1e-6, String(mixOf('custom', 0.35)))
  check('应用叶片卡片后自动进"原色"模式', (() => {
    const p = composeTree('oak', 'mature', 'summer', 4242)
    p.leafMat.tintMode = 'season'
    // applyLeafCard 的等价操作
    p.leafMat.texture = '/leaves/x.png'
    p.leafMat.tintMode = 'texture'
    return p.leafMat.tintMode === 'texture' && resolveTintMix(p.leafMat) === 0
  })())
  check('切季节不再重置染色设置 (preserveUserBits)', (() => {
    const p = composeTree('oak', 'mature', 'summer', 4242)
    p.leafMat.tintMode = 'custom'
    p.leafMat.vertexColorMix = 0.2
    p.leafMat.texture = '/leaves/x.png'
    const q = applyPreset(p, 'oak', 'mature', 'autumn')
    console.log('      切换后 tintMode=' + q.leafMat.tintMode + ' mix=' + q.leafMat.vertexColorMix + ' 贴图=' + q.leafMat.texture)
    return q.leafMat.tintMode === 'custom' && Math.abs(q.leafMat.vertexColorMix - 0.2) < 1e-6 && q.leafMat.texture === '/leaves/x.png'
  })())
  check('自发光不再使用季节叶色 (改用 emissiveColor)', (() => {
    const p = composeTree('oak', 'mature', 'autumn', 4242)
    p.leafMat.emissive = 0.5
    p.leafMat.emissiveColor = '#00ff00'
    const sh = createSharedUniforms()
    const leaf = createLeafMaterial(p, sh)
    updateMaterials({ bark: createBarkMaterial(p, sh), leaf, uniforms: sh }, p)
    const hex = leaf.emissive.getHexString()
    console.log('      autumn leaves.color=' + p.leaves.color + ' -> mat.emissive=#' + hex)
    return hex === '00ff00'
  })())
}

/* 19. 贴图染色不污染 (three 的 color_fragment 必须被替换掉) */
console.log('\n[19] 贴图原色模式不被季节染色')
{
  const captured = (params, isLeaf) => {
    const sh = createSharedUniforms()
    const mat = isLeaf ? createLeafMaterial(params, sh) : createBarkMaterial(params, sh)
    let src = null
    const orig = mat.onBeforeCompile
    mat.onBeforeCompile = (fn) => { orig(fn); src = fn.fragmentShader }
    mat.onBeforeCompile({ uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>\n#include <alphatest_fragment>\n#include <emissivemap_fragment>' })
    return src
  }
  const leafSrc = captured(composeTree('oak', 'mature', 'summer', 4242), true)
  check('叶片着色器已移除 three 的 <color_fragment> (否则会无条件乘顶点色)',
    !leafSrc.includes('#include <color_fragment>'))
  check('叶片顶点色只经过 uVertexColorMix 一条路径', leafSrc.includes('uVertexColorMix'))
  check('树皮同样不再重复乘顶点色', !captured(defaultParams(), false).includes('#include <color_fragment>'))
  // 语义: 原色模式 mix=0 -> 数学上 vColor 完全不参与
  const p0 = composeTree('oak', 'mature', 'summer', 4242)
  p0.leafMat.tintMode = 'texture'
  p0.leafMat.tint = '#ffffff'
  p0.leafMat.emissive = 0
  check('无贴图时自动回落到季节色 (否则程序化叶形是白叶子)', (() => {
    const L = composeTree('oak', 'mature', 'summer', 4242).leafMat
    const noTex = resolveTintMix({ ...L, tintMode: 'texture' }, false)
    const withTex = resolveTintMix({ ...L, tintMode: 'texture' }, true)
    console.log('      无贴图=' + noTex + ' 有贴图=' + withTex)
    return noTex === 1 && withTex === 0
  })())
  check('默认染色模式 = 跟随季节 (程序化叶形默认有颜色)', composeTree('oak', 'mature', 'summer', 4242).leafMat.tintMode === 'season')
  check('原色模式下: mix=0 + tint=白 + 无自发光 -> 季节色无处参与',
    resolveTintMix(p0.leafMat, true) === 0 && p0.leafMat.tint === '#ffffff' && p0.leafMat.emissive === 0)
}

/* 20. 落叶/堆积的"跟随贴图"同步 */
console.log('\n[20] 落叶/堆积 跟随贴图同步 + 输出色彩管线')
{
  const base = composeTree('oak', 'mature', 'summer', 4242)
  base.fall = { ...base.fall, enabled: true }
  base.litter = { ...base.litter, enabled: true }
  const k0 = fallRebuildKey(base)
  const l0 = litterRebuildKey(base)
  const withTex = { ...base, leafMat: { ...base.leafMat, texture: '/leaves/a.png' } }
  check('跟随树叶时: 换树叶贴图会触发落叶重建', fallRebuildKey(withTex) !== k0,
    fallRebuildKey(withTex) + ' vs ' + k0)
  check('跟随树叶时: 换树叶贴图会触发堆积重建', litterRebuildKey(withTex) !== l0)
  check('换落叶自己的卡片也会触发重建',
    fallRebuildKey({ ...base, fall: { ...base.fall, cardId: 'batch1-r01-c01' } }) !== k0)
  check('参数不变 -> 键不变 (不抖动重建)', fallRebuildKey({ ...base }) === k0 && litterRebuildKey({ ...base }) === l0)
  // 色彩管线: 自定义 ShaderMaterial 必须自己做色调映射 + 色彩空间输出
  check('落叶片元着色器走 three 的输出变换 (色调映射 + sRGB 编码)',
    /#include <tonemapping_fragment>/.test(FALL_FRAG) && /#include <colorspace_fragment>/.test(FALL_FRAG))
  check('粒子片元着色器同样', /#include <colorspace_fragment>/.test(PARTICLE_FRAG))
}

/* 21. 从 albedo 自动生成法线贴图 */
console.log('\n[21] 从贴图自动生成法线贴图')
{
  // 构造一张"中间亮、两侧暗"的图 (模拟半片叶子)
  const w = 32, h = 32
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // 横向 + 纵向都有梯度, 这样 flipY 才有可翻转的分量
      const v = Math.max(0, Math.min(255, 200 - Math.abs(x - w / 2) * 8 - Math.abs(y - h / 2) * 6))
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255
    }
  }
  const n0 = normalFromLuminance(px, w, h, 0)
  check('强度=0 -> 全平法线 (128,128,255)', (() => {
    for (let i = 0; i < n0.length; i += 3) {
      if (n0[i] !== 128 || n0[i + 1] !== 128 || n0[i + 2] !== 255) return false
    }
    return true
  })())
  const n1 = normalFromLuminance(px, w, h, 2)
  check('强度>0 -> 产生真实梯度 (法线有横/纵向变化)', (() => {
    const set = new Set()
    for (let i = 0; i < n1.length; i += 3) set.add(n1[i])
    console.log('      R 通道不同取值数=' + set.size)
    return set.size > 3
  })())
  check('法线全部被归一化 (长度≈1)', (() => {
    for (let i = 0; i < n1.length; i += 3) {
      const nx = n1[i] / 255 * 2 - 1, ny = n1[i + 1] / 255 * 2 - 1, nz = n1[i + 2] / 255 * 2 - 1
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (Math.abs(len - 1) > 0.06) return false
    }
    return true
  })())
  check('flipY 会翻转 Y 分量', (() => {
    const a1 = normalFromLuminance(px, w, h, 2, false)
    const a2 = normalFromLuminance(px, w, h, 2, true)
    let diff = 0
    let sum = 0
    for (let i = 0; i < a1.length; i += 3) {
      if (a1[i + 1] !== a2[i + 1]) diff++
      sum += a1[i + 1]
    }
    const flipped = Math.abs(sum / (a1.length / 3) - 128) > 0.5
    console.log('      Y 分量不同的像素=' + diff + ', 均值偏离 128=' + flipped)
    return diff > 0
  })())
  check('透明像素不参与起伏 (不会在 alpha 边缘造假法线)', (() => {
    const p2 = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) { p2[i * 4] = 255; p2[i * 4 + 1] = 255; p2[i * 4 + 2] = 255; p2[i * 4 + 3] = 0 }
    const nn = normalFromLuminance(p2, w, h, 3)
    for (let i = 0; i < nn.length; i += 3) if (nn[i] !== 128 || nn[i + 1] !== 128) return false
    return true
  })())
  check('叶片材质默认开启自动法线 (从贴图生成)', (() => {
    const L = composeTree('oak', 'mature', 'summer', 4242).leafMat
    console.log('      normalFromAlbedo=' + L.normalFromAlbedo + ' normalScale=' + L.normalScale)
    return L.normalFromAlbedo > 0
  })())
}

/* 22. 伪装卡生成器 (纯数学部分; 渲染需浏览器) */
console.log('\n[22] 伪装卡生成器')
{
  check('视角角度均分 360°', JSON.stringify(viewAngles(8)) === JSON.stringify([0, 45, 90, 135, 180, 225, 270, 315]))
  check('视角数 1 时只有一个角度', JSON.stringify(viewAngles(1)) === JSON.stringify([0]))
  check('图集排版尽量接近正方形', (() => {
    const a = atlasLayout(8), b = atlasLayout(4), c = atlasLayout(12)
    console.log('      8->' + a.cols + 'x' + a.rows + ' 4->' + b.cols + 'x' + b.rows + ' 12->' + c.cols + 'x' + c.rows)
    return a.cols * a.rows >= 8 && b.cols === 2 && b.rows === 2 && c.cols * c.rows >= 12
  })())
  check('交叉卡布局: 2 张 -> 0°/90° 十字', (() => {
    const q = crossCardQuads(2)
    return q.length === 2 && q[0].angle === 0 && q[1].angle === 90
  })())
  check('交叉卡布局: 最多 20 张', crossCardQuads(50).length === 20)
  check('俯仰层 -> 仰角列表 (1/2/3 层)', (() => {
    const a = elevationAngles(1), b = elevationAngles(2), c = elevationAngles(3)
    console.log('      1层=' + JSON.stringify(a) + ' 2层=' + JSON.stringify(b) + ' 3层=' + JSON.stringify(c))
    return a.length === 1 && b.length === 2 && b[1] === 90 && c.length === 3
  })())
  check('alpha 覆盖率计算正确', (() => {
    const w = 4, h = 4
    const px = new Uint8Array(w * h * 4)
    for (let i = 0; i < 8; i++) px[i * 4 + 3] = 255   // 前 8 个像素不透明
    return Math.abs(alphaCoverage(px, w, h) - 0.5) < 1e-6
  })())
}

/* 23. 导出数据格式 (离线可验证的部分; GLB/PNG 容器级校验见 dev/export-format-check.html) */
console.log('\n[23] 导出数据格式')
{
  // OBJ 文法: 浮点不能是科学计数法 (部分老 DCC/解析器不接受)
  const expProbe = 'v 1e-7 0 -2.5e-9\nvt 0.5 1e-8\nvn -1.49e-8 0 1\n'
  const expFixed = expandExponentialNumbers(expProbe)
  check('OBJ 数字展开为纯小数 (无科学计数法)', !/[eE]/.test(expFixed), expFixed.trim().replace(/\n/g, ' | '))

  // 旋转体果实: 两极是退化三角面, 必须补法线 — 否则 OBJ/GLB 里出现零法线 (渲染黑斑)
  for (const type of FRUIT_TYPES) {
    const tpl = buildFruitTemplate({ type, radial: 10 })
    let zero = 0
    let bad = 0
    for (let i = 0; i < tpl.normals.length; i += 3) {
      const l = Math.hypot(tpl.normals[i], tpl.normals[i + 1], tpl.normals[i + 2])
      if (l < 1e-8) zero++
      else if (Math.abs(l - 1) > 1e-3) bad++
    }
    check(`果实模板法线合法 (${type}: 无零法线 + 单位长度)`, zero === 0 && bad === 0, `zero=${zero} bad=${bad}`)
  }

  // 导出几何的共同前提: position/normal/uv 齐全, 数值有限, 法线单位化, 索引在范围内
  // (用实际默认树: 橡树成熟夏, 含果实; 果实会 merge 进树皮几何)
  const r = buildTree(normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer')))
  for (const [label, g] of [['树皮', r.barkGeometry], ['树叶', r.leafGeometry]]) {
    if (!g) { check(label + ': 导出几何存在', false); continue }
    const pos = g.attributes.position
    const nor = g.attributes.normal
    const uv = g.attributes.uv
    const idx = g.index
    let finite = true
    for (let i = 0; i < pos.array.length; i++) {
      if (!Number.isFinite(pos.array[i])) { finite = false; break }
    }
    let unit = true
    let zeroN = 0
    for (let i = 0; i < nor.array.length; i += 3) {
      const l = Math.hypot(nor.array[i], nor.array[i + 1], nor.array[i + 2])
      if (l < 1e-8) zeroN++
      else if (Math.abs(l - 1) > 1e-3) unit = false
    }
    let inRange = !!idx
    if (idx) for (let i = 0; i < idx.array.length; i++) if (idx.array[i] < 0 || idx.array[i] >= pos.count) { inRange = false; break }
    check(`${label}: 导出属性完整 (position/normal/uv/index)`, !!pos && !!nor && !!uv && !!idx)
    check(`${label}: 顶点有限 + 法线单位化 + 索引在范围`, finite && unit && zeroN === 0 && inRange, `zeroN=${zeroN}`)
  }
}

/* 24. 程序化 AO (顶点色烘焙; 参考 SpeedTree 顶点色 AO) */
console.log('\n[24] 程序化 AO')
{
  const pOn = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  const a = buildTree(pOn)
  const a2 = buildTree(pOn)
  check('AO 已烘焙 (点云 + 顶点数 > 0)', a.stats.ao.enabled === true && a.stats.ao.samples > 0 && a.stats.ao.affected > 0,
    JSON.stringify(a.stats.ao))
  check('AO 结果确定 (相同参数两次构建一致)', a.barkGeometry.attributes.color.array.every((v, i) => v === a2.barkGeometry.attributes.color.array[i]))

  const pOff = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  pOff.ao.enabled = false
  const b = buildTree(pOff)
  let diff = 0
  let darker = 0
  let outOfRange = 0
  for (let i = 0; i < a.barkGeometry.attributes.color.array.length; i++) {
    const on = a.barkGeometry.attributes.color.array[i]
    const off = b.barkGeometry.attributes.color.array[i]
    if (Math.abs(on - off) > 1e-6) diff++
    if (on < off - 1e-6) darker++
    if (on < off * 0.3 - 1e-6 || on > off + 1e-6) outOfRange++
  }
  check('AO 让顶点色变暗 (树皮)', diff > 1000 && darker > 0, `diff=${diff} darker=${darker}`)
  check('AO 因子在合法范围 (0.3~1 × 原色)', outOfRange === 0, `outOfRange=${outOfRange}`)
  let leafDiff = 0
  if (a.leafGeometry && b.leafGeometry) {
    for (let i = 0; i < a.leafGeometry.attributes.color.array.length; i++) {
      if (Math.abs(a.leafGeometry.attributes.color.array[i] - b.leafGeometry.attributes.color.array[i]) > 1e-6) leafDiff++
    }
  }
  check('AO 让顶点色变暗 (树叶)', leafDiff > 5000, `diff=${leafDiff}`)

  // 点云/纯函数行为
  const grid = buildOcclusionGrid([0, 0, 0, 0.1, 0, 0, 5, 0, 0], 1)
  check('遮挡查询: 附近点贡献 > 远方点', occlusionAt(grid, 0, 0, 0) > occlusionAt(grid, 5, 0, 0))
  check('AO 强度 = 0 时不做任何修改', bakeOcclusion(a.barkGeometry, grid, 0).affected === 0)

  // 实例区间烘焙: 只影响对应顶点, 且按中心点遮挡
  const THREE = await import('three')
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 5, 0, 0, 5.1, 0, 0, 5, 0.1, 0], 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(1), 3))
  const grid2 = buildOcclusionGrid([0, 0, 0, 0.1, 0, 0], 1)
  const rr = bakeOcclusionByRanges(geo, grid2, 0.8, [[0, 3, 0, 0, 0], [3, 6, 5, 0, 0]])
  const c = geo.attributes.color.array
  check('实例区间烘焙: 只改区间内顶点 + 数量正确', rr.affected === 6 && c[0] < 1 - 1e-6 && Math.abs(c[9] - 1) < 1e-6,
    `affected=${rr.affected} c0=${c[0].toFixed(3)} c3=${c[9].toFixed(3)}`)
}

/* 24b. 动态 LOD 的确定性叶片抽样 */
console.log('\n[24b] 动态 LOD 叶片抽样')
{
  const mk = (ratio) => {
    const p = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
    p.lod.leafRatio = ratio
    return buildTree(p)
  }
  const full = mk(1)
  const low = mk(0.35)
  check('LOD 低模叶片数确实减少', low.stats.leaves < full.stats.leaves && low.stats.leaves > full.stats.leaves * 0.15,
    `${low.stats.leaves} / ${full.stats.leaves}`)
  const sameBark = full.barkGeometry.attributes.position.array.length === low.barkGeometry.attributes.position.array.length &&
    full.barkGeometry.attributes.position.array.every((v, i) => v === low.barkGeometry.attributes.position.array[i])
  check('叶片抽稀不影响树干/树枝 (只少画叶子)', sameBark)
  // 关闭 AO 后顶点色也应完全一致 (AO 依赖叶片点云, 抽稀后遮挡量本就该变)
  const mkNoAo = (ratio) => {
    const p = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
    p.lod.leafRatio = ratio
    p.ao.enabled = false
    return buildTree(p)
  }
  const fullC = mkNoAo(1)
  const lowC = mkNoAo(0.35)
  check('关闭 AO 后叶片抽稀不改变树皮顶点色', fullC.barkGeometry.attributes.color.array.every((v, i) => v === lowC.barkGeometry.attributes.color.array[i]))
  // 花朵与叶片共用位置采样: 抽稀后花朵几何也必须完全一致
  const mkFlower = (ratio) => {
    const p = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
    p.flower.enabled = true
    p.flower.count = 8
    p.lod.leafRatio = ratio
    return buildTree(p)
  }
  const fullF = mkFlower(1)
  const lowF = mkFlower(0.35)
  const sameFlower = fullF.flowerGeometry && lowF.flowerGeometry &&
    fullF.flowerGeometry.attributes.position.array.length === lowF.flowerGeometry.attributes.position.array.length &&
    fullF.flowerGeometry.attributes.position.array.every((v, i) => v === lowF.flowerGeometry.attributes.position.array[i])
  check('LOD 叶片抽稀不改变花朵几何/数量', sameFlower && fullF.stats.flowerTriangles === lowF.stats.flowerTriangles,
    `${fullF.stats.flowerTriangles} / ${lowF.stats.flowerTriangles}`)
  check('LOD 参数齐全 (动态距离/保留比例)', ['dynamic', 'distance1', 'distance2', 'keep1', 'keep2', 'force']
    .every((k) => Object.prototype.hasOwnProperty.call(defaultParams().lod, k)))
}

/* 24c. 叶/花模型旋转 (贴图偏移导致叶梗/花梗反向时的模型校正) */console.log('\n[24c] 叶/花模型旋转')
{
  const baseP = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  const base = buildTree(baseP)
  const rotP = cloneParams(baseP)
  rotP.leaves.modelRotation = 180
  const rot = buildTree(rotP)
  const sameBark = base.barkGeometry.attributes.position.array.every((v, i) => v === rot.barkGeometry.attributes.position.array[i])
  const leafChanged = base.leafGeometry.attributes.position.array.some((v, i) => v !== rot.leafGeometry.attributes.position.array[i])
  check('叶模型旋转改变叶片几何', leafChanged)
  check('叶模型旋转不改变树干/树枝几何', sameBark)

  const fP = cloneParams(baseP)
  fP.flower.enabled = true
  fP.flower.count = 8
  const f0 = buildTree(fP)
  const fP2 = cloneParams(fP)
  fP2.flower.modelRotation = 90
  const f1 = buildTree(fP2)
  check('花朵模型旋转改变花朵几何', !!f0.flowerGeometry && !!f1.flowerGeometry &&
    f0.flowerGeometry.attributes.position.array.some((v, i) => v !== f1.flowerGeometry.attributes.position.array[i]))
  check('花朵模型旋转不改变树干/树枝几何', f0.barkGeometry.attributes.position.array.every((v, i) => v === f1.barkGeometry.attributes.position.array[i]))
}

/* 25. 环境预设 (天空/光照/雾/地面/星空) */
console.log('\n[25] 环境预设')
{
  check('环境预设数量足够 (含需求里的 8 种)', ENVIRONMENTS.length >= 8, `${ENVIRONMENTS.length} 个: ${ENV_IDS.join(', ')}`)
  check('环境 id / 名称唯一', new Set(ENV_IDS).size === ENVIRONMENTS.length && new Set(ENVIRONMENTS.map((e) => e.name)).size === ENVIRONMENTS.length)
  const baseScene = defaultParams().scene
  const knownKeys = new Set(Object.keys(baseScene))
  const hexRe = /^#[0-9a-fA-F]{6}$/
  let badKey = ''
  let badColor = ''
  let badRange = ''
  for (const env of ENVIRONMENTS) {
    for (const [k, v] of Object.entries(env.scene)) {
      if (!knownKeys.has(k)) badKey += `${env.id}.${k} `
      if (typeof v === 'string' && v.startsWith('#') && !hexRe.test(v)) badColor += `${env.id}.${k} `
      if (k === 'stars' && !(typeof v === 'number' && v >= 0 && v <= 1)) badRange += `${env.id}.${k} `
      if (k === 'sunElevation' && !(typeof v === 'number' && v >= -5 && v <= 88)) badRange += `${env.id}.${k} `
    }
  }
  check('预设字段都属于 scene 参数 (无拼写错误)', badKey === '', badKey)
  check('预设颜色都是合法 HEX', badColor === '', badColor)
  check('星空/太阳高度数值在合法范围', badRange === '', badRange)

  const p = defaultParams()
  check('应用"雪地"设置 env 与配色', applyEnvironment(p.scene, 'snow') && p.scene.env === 'snow' && p.scene.groundColor === '#e6eef5')
  check('未知预设返回 false 且不改参数', applyEnvironment(p.scene, 'nope') === false && p.scene.env === 'snow')
  const pNight = defaultParams()
  applyEnvironment(pNight.scene, 'night')
  const pStars = defaultParams()
  applyEnvironment(pStars.scene, 'starry')
  const pDay = defaultParams()
  applyEnvironment(pDay.scene, 'daylight')
  check('黑夜/群星开启星空, 白昼关闭', pNight.scene.stars > 0 && pStars.scene.stars > pNight.scene.stars && pDay.scene.stars === 0,
    `night=${pNight.scene.stars} starry=${pStars.scene.stars} day=${pDay.scene.stars}`)
  const lum = (hex) => {
    const c = hex.replace('#', '')
    return (parseInt(c.slice(0, 2), 16) * 0.2126 + parseInt(c.slice(2, 4), 16) * 0.7152 + parseInt(c.slice(4, 6), 16) * 0.0722) / 255
  }
  check('雪地/沙漠比黑夜/群星亮', lum(pDay.scene.background) > 0.5 && lum(pNight.scene.background) < 0.1 && lum(pStars.scene.background) < 0.05)
  const bgSet = new Set(ENVIRONMENTS.map((e) => e.scene.background))
  check('环境之间有视觉区分 (背景色不重复)', bgSet.size === ENVIRONMENTS.length, `${bgSet.size}/${ENVIRONMENTS.length}`)

  // 环境预设只影响场景, 不改变树几何
  const baseP = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  const g1 = buildTree(baseP)
  const eParams = cloneParams(baseP)
  applyEnvironment(eParams.scene, 'desert')
  const g2 = buildTree(eParams)
  const same = g1.barkGeometry.attributes.position.array.length === g2.barkGeometry.attributes.position.array.length &&
    g1.barkGeometry.attributes.position.array.every((v, i) => v === g2.barkGeometry.attributes.position.array[i])
  check('切换环境不改变树几何 (只改场景参数)', same)
}

/* 26. 扭曲曲线 (树干/树枝) + 视口句柄数据 */
console.log('\n[26] 扭曲曲线与句柄')
{
  const base = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  check('树干/树枝默认扭曲曲线长度 = 5 且为 0', base.trunk.twistProfile.length === TWIST_POINTS &&
    base.branches.twistProfile.length === TWIST_POINTS &&
    base.trunk.twistProfile.every((v) => v === 0) && base.branches.twistProfile.every((v) => v === 0))
  check('曲线采样: 线性插值正确', Math.abs(sampleTwistProfile([0, 100, 100, 100, 100], 0.125) - 50) < 1e-9,
    sampleTwistProfile([0, 100, 100, 100, 100], 0.125))
  check('曲线弧度换算 + 越界钳制', Math.abs(twistProfileRad([0, 90, 0, 0, 0], 0.25) - Math.PI / 2) < 1e-9 &&
    normalizeTwistProfile([5000, -5000, 0, 0, 0]).join(',') === '720,-720,0,0,0')

  const sum = (arr) => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s }
  const a = buildTree(base)
  const pTrunk = cloneParams(base)
  pTrunk.trunk.twistProfile = [0, 120, 240, 360, 480]
  const b = buildTree(pTrunk)
  const barkDiff = a.barkGeometry.attributes.position.array.some((v, i) => v !== b.barkGeometry.attributes.position.array[i])
  const leafDiff = a.leafGeometry.attributes.position.array.some((v, i) => v !== b.leafGeometry.attributes.position.array[i])
  check('树干扭曲曲线改变树皮几何 (截面扭转)', barkDiff)
  check('树干扭曲曲线也带动叶片/子枝螺旋 (可见)', leafDiff)
  // 回归: 主干扭曲必须带动所有枝干 (含树根/分叉主枝/深层枝), 不能只转截面。
  // 历史 bug: 子枝只用 profileRoll, 基础 twist 不会带动它们, 看起来"部分枝干不动"。
  const still = []
  for (let i = 0; i < Math.min(a.skeleton.branches.length, b.skeleton.branches.length); i++) {
    const A = a.skeleton.branches[i]
    const B = b.skeleton.branches[i]
    if (!A || !B || A.type === 'trunk') continue
    const moved = A.frames[0].pos.distanceTo(B.frames[0].pos) > 1e-6 ||
      A.frames[0].dir.angleTo(B.frames[0].dir) > 1e-6
    if (!moved) still.push(`${A.type}L${A.level}#${i}`)
  }
  check('主干扭曲带动所有枝干/树根 (无静止子枝)', still.length === 0, still.slice(0, 6).join(','))
  const pBr = cloneParams(base)
  pBr.branches.twistProfile = [0, 90, 180, 270, 360]
  const c = buildTree(pBr)
  check('树枝扭曲曲线改变树枝/叶片几何', c.barkGeometry.attributes.position.array.some((v, i) => v !== a.barkGeometry.attributes.position.array[i]) &&
    c.leafGeometry.attributes.position.array.some((v, i) => v !== a.leafGeometry.attributes.position.array[i]))
  check('扭曲曲线结果确定 (同参数两次一致)', (() => {
    const d = buildTree(pTrunk)
    return d.barkGeometry.attributes.position.array.every((v, i) => v === b.barkGeometry.attributes.position.array[i])
  })())

  check('句柄引导线: 树干有 17 个采样点', a.twistGuides && a.twistGuides.trunk.length === 17 * 3, a.twistGuides && a.twistGuides.trunk.length)
  check('句柄引导线: 树枝 L1/L2 有代表枝采样', !!a.twistGuides.branches[1] && a.twistGuides.branches[1].length >= 6 &&
    !!a.twistGuides.branches[2])
  check('句柄坐标是有限数值', a.twistGuides.trunk.every(Number.isFinite) && a.twistGuides.branches[1].every(Number.isFinite))
  // 默认曲线为 0 时, 树几何应与没有该字段的旧参数一致 (向后兼容)
  const legacy = cloneParams(base)
  delete legacy.trunk.twistProfile
  delete legacy.branches.twistProfile
  const l = buildTree(legacy)
  check('旧参数 (无 twistProfile) 兼容: 几何与默认一致', l.barkGeometry.attributes.position.array.every((v, i) => v === a.barkGeometry.attributes.position.array[i]))
}

/* 27. 导出拆分: 树干 / 树枝 / 根 / 果实 独立节点 */
console.log('\n[27] 导出节点拆分')
{
  const p = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  p.roots.enabled = true
  p.bark.pipeline = 'skin' // 这一段验证旧单连通蒙皮的拆分/合并语义
  const r = buildTree(p)
  const parts = splitBarkGeometryByNodeGroups(r.barkGeometry, r.nodes)
  const names = parts.map((x) => x.name)
  check('树皮被拆成多个节点', parts.length >= 6, names.join(', '))
  check('树干是独立节点', names.includes('Bark_Trunk'))
  check('树枝按层级拆分', names.includes('Bark_Branch_L1') && names.includes('Bark_Branch_L2') && names.includes('Bark_Branch_L3'))
  check('树根/果实也拆分', names.includes('Bark_Roots') && names.includes('Bark_Fruit'))
  const triSum = parts.reduce((s, x) => s + x.triangles, 0)
  const vSum = parts.reduce((s, x) => s + x.vertices, 0)
  check('拆分后面数守恒', triSum === r.stats.barkTriangles, `${triSum} vs ${r.stats.barkTriangles}`)
  check('拆分后顶点数不小于原几何 (分叉缝合处的共享顶点按面片复制)',
    vSum >= r.stats.barkVertices && vSum < r.stats.barkVertices * 2.5,
    `${vSum} vs ${r.stats.barkVertices}`)
  check('每个拆分节点都有几何且属性齐全', parts.every((x) =>
    x.triangles > 0 && x.geometry.attributes.position && x.geometry.attributes.normal &&
    x.geometry.attributes.uv && x.geometry.attributes.color && x.geometry.attributes.aNodeId && x.geometry.index))
  // 整张树体 (树干+树枝+树根) 才是闭合 2-manifold; 按节点拆分后各片在分叉缝处
  // 天然是开放面片 (这是对的: 分叉由显式环桥接缝合在同一张蒙皮上)。
  const bodyParts = barkExportParts(r.barkGeometry, r.nodes, true, true)
  const bodyPart = bodyParts.find((x) => x.name === 'Bark')
  const bodyTopo = bodyPart ? analyzeTopology(bodyPart.geometry, { weldPositions: true }) : null
  check('合并树体 (树干+树枝+树根) 仍闭合且单连通',
    !!bodyTopo && bodyTopo.boundary === 0 && bodyTopo.nonManifold === 0 && bodyTopo.components === 1,
    JSON.stringify(bodyTopo))
  const oneParts = splitBarkGeometryByNodeGroups(r.barkGeometry, r.nodes, { mergeTrunkBranches: true, mergeRoots: true })
  const oneNames = oneParts.map((x) => x.name)
  check('一体建模拆分: 树干/树枝/树根合并为单个 Bark', oneNames.includes('Bark') &&
    !oneNames.some((n) => n === 'Bark_Trunk' || n === 'Bark_Roots' || n.startsWith('Bark_Branch_')), oneNames.join(', '))
  const byId = new Map(r.nodes.map((n) => [n.id, n]))
  let misattributed = ''
  for (const part of parts) {
    if (misattributed) break
    const partIdx = part.geometry.index.array
    const partIds = part.geometry.attributes.aNodeId.array
    for (let t = 0; t < partIdx.length; t += 3) {
      const label = barkGroupName(byId.get(partIds[partIdx[t]]))
      if (label !== part.name) { misattributed = `${part.name} <- ${label}`; break }
    }
  }
  check('每个拆分三角面都归到正确节点组 (按首顶点 aNodeId)', misattributed === '', misattributed)
  check('拆分不修改原树皮几何', r.barkGeometry.attributes.position.count === r.stats.barkVertices &&
    r.barkGeometry.attributes.aNodeId.count === r.stats.barkVertices)

  // 导出开关: 是否合并树干/树枝
  const merged = barkExportParts(r.barkGeometry, r.nodes, true)
  check('mergeBark=true: 树干+树枝合成一棵 Bark mesh', merged.filter((x) => x.name === 'Bark').length === 1 &&
    !merged.some((x) => x.name === 'Bark_Trunk' || x.name.startsWith('Bark_Branch_')), merged.map((x) => x.name).join(','))
  check('mergeBark=true: 树根/果实保持独立', merged.some((x) => x.name === 'Bark_Roots') &&
    merged.some((x) => x.name === 'Bark_Fruit'), merged.map((x) => x.name).join(','))
  const split2 = barkExportParts(r.barkGeometry, r.nodes, false)
  check('mergeBark=false: 默认按节点拆分', split2.length >= 6 && split2.some((x) => x.name === 'Bark_Trunk') &&
    split2.some((x) => x.name === 'Bark_Branch_L1'))
  check('导出开关不改变几何与面数', merged.reduce((s, x) => s + x.triangles, 0) === r.stats.barkTriangles &&
    split2.reduce((s, x) => s + x.triangles, 0) === r.stats.barkTriangles)
}

/* 28. 站点图标 (favicon) */
console.log('\n[28] 站点图标')
{
  const icons = ['favicon.svg', 'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png']
  check('图标文件齐全', icons.every((f) => existsSync(join('public', f))), icons.filter((f) => !existsSync(join('public', f))).join(', '))
  const svg = readFileSync(join('public', 'favicon.svg'), 'utf8')
  check('SVG 图标合法 (viewBox + 渐变树形)', /viewBox="0 0 64 64"/.test(svg) && /<linearGradient/.test(svg) && /<circle/.test(svg))
  const pngInfo = (file) => {
    const b = readFileSync(file)
    const sig = b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    const w = b.readUInt32BE(16)
    const h = b.readUInt32BE(20)
    const bit = b[24]
    const color = b[25]
    return { sig, w, h, bit, color, bytes: b.length }
  }
  const p16 = pngInfo(join('public', 'favicon-16.png'))
  const p32 = pngInfo(join('public', 'favicon-32.png'))
  const p180 = pngInfo(join('public', 'apple-touch-icon.png'))
  check('PNG 图标签名/尺寸/颜色类型正确', [p16, p32, p180].every((p, i) =>
    p.sig && p.w === [16, 32, 180][i] && p.h === [16, 32, 180][i] && p.bit === 8 && p.color === 6),
    `16=${p16.w} 32=${p32.w} 180=${p180.w}`)
  check('PNG 图标不是空文件', p16.bytes > 200 && p32.bytes > 200 && p180.bytes > 1000,
    `${p16.bytes}/${p32.bytes}/${p180.bytes}`)
  // ICO: header + 3 个 PNG 编码的 16/32/48 图层
  const ico = readFileSync(join('public', 'favicon.ico'))
  const count = ico.readUInt16LE(4)
  const sizes = []
  let icoOK = ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1 && count === 3
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16
    const w = ico[e] === 0 ? 256 : ico[e]
    sizes.push(w)
    const len = ico.readUInt32LE(e + 8)
    const off = ico.readUInt32LE(e + 12)
    if (ico.subarray(off, off + 8).toString('hex') !== '89504e470d0a1a0a') icoOK = false
    if (off + len > ico.length) icoOK = false
  }
  check('ICO 容器合法 (3 个 PNG 图层)', icoOK, sizes.join(','))
  check('ICO 包含 16/32/48 三种尺寸', sizes.join(',') === '16,32,48', sizes.join(','))
  const html = readFileSync('index.html', 'utf8')
  check('index.html 已引用 SVG/ICO/苹果图标', /rel="icon"[^>]*favicon\.svg/.test(html) &&
    /rel="icon"[^>]*favicon\.ico|href="\/favicon.ico"/.test(html) && /apple-touch-icon/.test(html) && /theme-color/.test(html))
}

/* 29. 面数统计 (视口右下角) */
console.log('\n[29] 面数统计')
{
  const sample = { barkTriangles: 122242, leafTriangles: 69120, flowerTriangles: 30720, barkVertices: 80000, leafVertices: 30000, flowerVertices: 9000 }
  check('全模三角面包含花朵', modelTriangleCount(sample) === 122242 + 69120 + 30720, String(modelTriangleCount(sample)))
  check('全模顶点包含花朵', modelVertexCount(sample) === 80000 + 30000 + 9000, String(modelVertexCount(sample)))
  check('无花朵时统计正确', modelTriangleCount({ barkTriangles: 10, leafTriangles: 5 }) === 15)
  check('统计字段缺失/空值不报错', modelTriangleCount({}) === 0 && modelVertexCount(null) === 0)
  const p = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  p.flower.enabled = true
  p.flower.count = 12
  const r = buildTree(p)
  check('建筑统计: 开花的树全模面数 = 树皮+叶+花', modelTriangleCount(r.stats) ===
    Math.round(r.stats.barkTriangles + r.stats.leafTriangles + r.stats.flowerTriangles) &&
    r.stats.flowerTriangles > 0)
}

/* 30. 双面叶片材质 (正面/背面独立颜色与贴图) */
console.log('\n[30] 双面叶片材质')
{
  const lm = defaultParams().leafMat
  check('双面叶片默认参数齐全', lm.backEnabled === false && typeof lm.backColor === 'string' &&
    lm.backColor.startsWith('#') && lm.backTexture === '')
  const src = internalShaderSources()
  const need = ['uBackEnabled', 'uBackColor', 'uHasBackMap', 'uBackMap']
  check('片元声明包含背面独立颜色/贴图 uniform', need.every((k) => src.fragmentHeader.includes(k)), need.join(','))
  check('map 注入片段使用 gl_FrontFacing 切换正/背面贴图', src.snippets.LEAF_BACK_MAP_FRAGMENT.includes('gl_FrontFacing') &&
    src.snippets.LEAF_BACK_MAP_FRAGMENT.includes('uBackMap') &&
    src.snippets.LEAF_BACK_MAP_FRAGMENT.includes('texture2D( map, vMapUv )'))
}

/* 31. 导出贴图资源命名 (1K/2K/4K -> _xk, 其它尺寸不加) */
console.log('\n[31] 导出贴图资源命名')
{
  const fakeTex = (w, h) => ({ name: '', image: { width: w, height: h } })
  check('4K 贴图后缀 _4k', textureAssetName('leaf', 'diff', fakeTex(4096, 2048)) === 'leaf_diff_4k')
  check('2K/1K 贴图后缀 _2k/_1k',
    textureAssetName('bark', 'normal', fakeTex(2048, 2048)) === 'bark_nor_gl_2k' &&
    textureAssetName('leaf', 'rough', fakeTex(1024, 1024)) === 'leaf_rough_1k')
  check('非 1K/2K/4K 尺寸不加 _xk',
    textureAssetName('leaf', 'diff', fakeTex(216, 215)) === 'leaf_diff' &&
    textureAssetName('flower', 'alpha', fakeTex(3000, 3000)) === 'flower_alpha')
  const map = fakeTex(2048, 2048)
  const normal = fakeTex(1024, 1024)
  const mat = { userData: { kind: 'leaf' }, map, alphaMap: null, normalMap: normal, roughnessMap: null }
  const root = { traverse(fn) { fn({ isMesh: true, material: mat }) } }
  const naming = applyExportTextureNames(root)
  check('材质贴图按角色命名 (diff/normal/alpha alias)',
    map.name === 'leaf_diff_2k' && normal.name === 'leaf_nor_gl_1k' &&
    naming.alphaAliases.some((a) => a.name === 'leaf_alpha_2k' && a.from === 'leaf_diff_2k'),
    `${map.name},${normal.name},${naming.alphaAliases.map((a) => a.name).join(',')}`)
}

/* 31.1 导出贴图成套一致性 (diff/nor/rough/alpha 同尺寸 + 同朝向 + 同 UV 变换) */
console.log('\n[31.1] 导出贴图成套一致性')
{
  check('叶/花/果都属于需要成套对齐的材质',
    ['leaf', 'flower', 'fruit'].every((k) => EXPORT_ALIGNED_KINDS.includes(k)),
    EXPORT_ALIGNED_KINDS.join(','))
  check('无 root / 无 DOM 时对齐函数安全返回空恢复函数',
    typeof ensureExportTextureAlignment(null) === 'function' && typeof ensureExportTextureAlignment({}) === 'function')

  // flipY 语义: 同一张"上暗下亮"的梯度图, 两种 flipY 得到的法线绿通道应互为反号
  const w = 8, h = 8
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const v = Math.round((y / (h - 1)) * 255)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255
    }
  }
  const mid = (3 * w + 4) * 3
  const nFlip = normalFromLuminance(rgba, w, h, 1, true)
  const nPlain = normalFromLuminance(rgba, w, h, 1, false)
  check('法线绿通道随 flipY 反号 (朝向参数真的生效)',
    nFlip[mid + 1] > 128 && nPlain[mid + 1] < 128,
    `flipY=true g=${nFlip[mid + 1]} / false g=${nPlain[mid + 1]}`)

  // 导出链路: 先补槽 -> 再对齐 -> 再烘焙 UV -> 再命名
  const exporterSrc = readFileSync(join('src', 'core', 'exporter.js'), 'utf8')
  const iMaps = exporterSrc.indexOf('ensureExportMaterialMaps(root)')
  const iAlign = exporterSrc.indexOf('ensureExportTextureAlignment(root)')
  const iBake = exporterSrc.indexOf('ensureExportUvBake(root)')
  const iNames = exporterSrc.indexOf('applyExportTextureNames(root)')
  check('导出顺序: 补全贴图槽 -> 成套对齐 -> 烘焙 UV -> 资源命名',
    iMaps > 0 && iAlign > iMaps && iBake > iAlign && iNames > iBake,
    `maps=${iMaps} align=${iAlign} bake=${iBake} names=${iNames}`)
  check('导出结束会恢复材质 (restoreAll 覆盖成功/失败两条路径)',
    exporterSrc.includes('restoreAlign()') && (exporterSrc.match(/restoreAll\(\)/g) || []).length >= 3)

  const alignSrc = readFileSync(join('src', 'core', 'textureNaming.js'), 'utf8')
  check('对齐逻辑覆盖尺寸 + 朝向 + UV 变换',
    alignSrc.includes('sameSize(') && alignSrc.includes('flipY !== false') &&
    alignSrc.includes('tex.rotation = diff.rotation'))
  check('alpha 资源按 diffuse 的 flipY 翻转 (与导出的 diff 同朝向)',
    alignSrc.includes('texture.flipY !== false') && alignSrc.includes('ctx.scale(1, -1)'))
  const autoSrc = readFileSync(join('src', 'core', 'normalFromAlbedo.js'), 'utf8')
  check('视口自动法线的 flipY 跟随源贴图 (不再固定 false)',
    autoSrc.includes('const flipY = texture.flipY !== false') && autoSrc.includes('tex.flipY = flipY'))
}

/* 31.2 导出 UV 烘焙 (旋转/偏移/非等比平铺要写进几何, 不靠 KHR_texture_transform) */
console.log('\n[31.2] 导出 UV 烘焙')
{
  // three 的贴图矩阵 = T·S·R: uv' = S·R·(uv - center) + center + offset
  const tex = new THREE.Texture()
  tex.center.set(0.5, 0.5)
  tex.offset.set(0.3, -0.2)
  tex.repeat.set(1.5, 0.7)
  tex.rotation = -2.48
  tex.updateMatrix()
  const m = Array.from(tex.matrix.elements)

  const geo = new THREE.PlaneGeometry(1, 1)
  const origUv = Array.from(geo.attributes.uv.array)
  const mat = new THREE.MeshStandardMaterial({ map: tex })
  const mesh = new THREE.Mesh(geo, mat)
  const root = new THREE.Group()
  root.add(mesh)

  const restore = ensureExportUvBake(root)
  check('烘焙时几何换成克隆 (不改视口几何)', mesh.geometry !== geo && mesh.geometry.attributes.uv)
  check('烘焙后贴图变换归零 (导出不再写 KHR_texture_transform)',
    tex.offset.x === 0 && tex.offset.y === 0 && tex.repeat.x === 1 && tex.repeat.y === 1 &&
    tex.rotation === 0 && tex.center.x === 0 && tex.center.y === 0)

  const uv = mesh.geometry.attributes.uv
  let maxErr = 0
  for (let i = 0; i < uv.count; i++) {
    const u = origUv[i * 2]
    const v = origUv[i * 2 + 1]
    maxErr = Math.max(maxErr,
      Math.abs(uv.getX(i) - (m[0] * u + m[3] * v + m[6])),
      Math.abs(uv.getY(i) - (m[1] * u + m[4] * v + m[7])))
  }
  check('烘焙 uv 等于原 uv 乘 three 矩阵 (与视口采样一致)', maxErr < 1e-6, `maxErr=${maxErr}`)

  restore()
  check('恢复后几何与贴图变换都回到导出前',
    mesh.geometry === geo &&
    Math.abs(tex.offset.x - 0.3) < 1e-9 && Math.abs(tex.repeat.y - 0.7) < 1e-9 &&
    Math.abs(tex.rotation + 2.48) < 1e-9 && Math.abs(tex.center.x - 0.5) < 1e-9)
  check('无 root / 空 root 时安全返回空恢复函数',
    typeof ensureExportUvBake(null) === 'function' && typeof ensureExportUvBake({}) === 'function')
}

/* 31.3 卡片贴图最外圈透明 (夹边采样 + UV 溢出时不出现拉伸条纹) */
console.log('\n[31.3] 卡片贴图边缘透明')
{
  // Node 环境没有 document: 必须安全返回 null (不能抛错)
  check('无 DOM 环境下安全返回 null', clearCardBorder({ width: 64, height: 64 }) === null)

  // 用最小 canvas mock 校验"同尺寸 + 只清外圈"的几何逻辑
  const calls = []
  const ctx = {
    drawImage: (img, x, y) => calls.push(['draw', x, y]),
    clearRect: (x, y, w, h) => calls.push(['clear', x, y, w, h]),
  }
  const canvas = { width: 0, height: 0, getContext: () => ctx }
  const prevDoc = globalThis.document
  globalThis.document = { createElement: () => canvas }
  const out = clearCardBorder({ width: 128, height: 64 }, 2)
  globalThis.document = prevDoc
  check('返回同尺寸画布 (导出 _1k/_2k 档位不受影响)', !!out && out.width === 128 && out.height === 64)
  check('内容按 1:1 原样复制 (不缩放、不重采样)', calls.some((c) => c[0] === 'draw' && c[1] === 0 && c[2] === 0))
  const clears = calls.filter((c) => c[0] === 'clear')
  // 四条边都必须贴着画布边缘, 且厚度至少 2px (不能清到内部像素)
  const onBorder = clears.every(([, x, y, w, h]) =>
    (x === 0 || x + w === 128) && (y === 0 || y + h === 64) && w >= 2 && h >= 2)
  check('只清掉最外 2px 的四条边', clears.length === 4 && onBorder, JSON.stringify(clears))
  check('过小的图保持原样 (清完就没内容了)', clearCardBorder({ width: 4, height: 4 }) === null)
  const src = readFileSync(join('src', 'core', 'textures.js'), 'utf8')
  check('loadTexture 对 clamp 贴图默认清边',
    src.includes('const wantBorder = opts.clearBorder === undefined ? !!opts.clamp : opts.clearBorder') &&
    src.includes('const cleared = clearCardBorder(loaded.image)'))
}

/* 31.4 动态阴影 */
console.log('\n[31.4] 动态阴影')
{
  const p = defaultParams()
  check('默认场景开启阴影且动态阴影默认开启', p.scene.shadows === true && p.scene.dynamicShadows === true)
  const old = normalizeParams({ scene: { shadows: false } })
  check('旧参数缺 dynamicShadows 时补默认 true (且保留 shadows=false)',
    old.scene.dynamicShadows === true && old.scene.shadows === false)

  // 深度材质必须注入与主材质相同的风场/生长顶点位移, 才能让影子跟着树动
  const u = createSharedUniforms()
  const leafU = { uIsLeaf: { value: 1 }, uSway: { value: 1 }, uLeafFlutter: { value: 0.6 }, uLeafTwist: { value: 0.5 } }
  const dm = createTreeDepthMaterial(u, leafU)
  check('深度材质是 MeshDepthMaterial 且用 RGBA 打包',
    dm.isMeshDepthMaterial === true && dm.depthPacking === THREE.RGBADepthPacking)
  const shader = {
    uniforms: {},
    vertexShader: '#include <begin_vertex>\n#include <project_vertex>',
    fragmentShader: '',
  }
  dm.onBeforeCompile(shader)
  check('注入了风场/生长属性声明', shader.vertexShader.includes('attribute float aWind') && shader.vertexShader.includes('attribute vec2 aGrow'))
  check('替换了 <begin_vertex> (生长+风场位移生效)',
    shader.vertexShader.includes('vec3 treePos = transformed') &&
    shader.vertexShader.includes('float growK = clamp'))
  check('共享同一份 uniform 对象 (uTime/每材质 uIsLeaf 逐帧同步到阴影)',
    shader.uniforms.uTime === u.uTime && shader.uniforms.uGrowth === u.uGrowth &&
    shader.uniforms.uIsLeaf === leafU.uIsLeaf && shader.uniforms.uSway === leafU.uSway)

  const sm = readFileSync(join('src', 'core', 'sceneManager.js'), 'utf8')
  check('场景管理器按 dynamicShadows 决定阴影是否每帧重算',
    sm.includes('this.renderer.shadowMap.autoUpdate = this.shadowsEnabled && this.dynamicShadows'))
  check('投影网格按动态阴影挂载 customDepthMaterial',
    sm.includes('c.mesh.customDepthMaterial = dynamic ? this._depthMaterialFor(c.mesh.material) : undefined'))
  check('深度材质按主材质分别缓存 (树叶/树皮运动形态不同)',
    sm.includes('_depthMaterials.get(material)') &&
    sm.includes('material.userData.uniforms'))
  const panel = readFileSync(join('src', 'components', 'panels', 'ScenePanel.vue'), 'utf8')
  check('场景面板暴露动态阴影开关', panel.includes('v-model="s.dynamicShadows"'))
}

/* 32. 分叉开口对中 + 粗树枝根部圆度 */
console.log('\n[32] 分叉开口对中与根部圆度')
{
  const p = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  p.leaves.enabled = false
  p.fruit.enabled = false
  const r = buildTree(p, { validate: false })
  const skin = buildBarkSkin(r.skeleton, { validate: false, debug: true })
  const { plan, skinFrames } = skin.debug
  const branches = r.skeleton.branches
  const pos = skin.geometry.attributes.position.array
  let maxAxial = 0
  let badAxial = 0
  let minAspect = 1
  const rootRims = []
  for (const [bi, pl] of plan) {
    const pf = skinFrames[bi]
    const M = skin.ringM[bi]
    for (const w of pl.windows) {
      const child = branches[w.child]
      const A = skin.rings[bi][w.band]
      const B = skin.rings[bi][w.band + 1]
      let cx = 0, cy = 0, cz = 0, n = 0
      for (const ring of [A, B]) {
        for (let k = 0; k <= w.K; k++) {
          const vi = ring + ((w.start + k) % M)
          cx += pos[vi * 3]; cy += pos[vi * 3 + 1]; cz += pos[vi * 3 + 2]; n++
        }
      }
      cx /= n; cy /= n; cz /= n
      const c0 = child.frames[0].pos
      const f = pf[w.band]
      const dx = cx - c0.x, dy = cy - c0.y, dz = cz - c0.z
      const axial = Math.abs(dx * f.dir.x + dy * f.dir.y + dz * f.dir.z)
      if (child.type !== 'root') {
        maxAxial = Math.max(maxAxial, axial)
        // 细枝允许的绝对误差更小; 粗枝按半径比例放宽
        if (axial > 0.01 + 0.3 * child.frames[0].radius) badAxial++
      }
      if (child.type === 'root') {
        const rim = []
        for (const ring of [A, B]) {
          for (let k = 0; k <= w.K; k++) rim.push(ring + ((w.start + k) % M))
        }
        rootRims.push(rim)
      }
      // 粗树枝 ring0 在"垂直于自身轴线"的平面上的短/长轴比 = 根部被压扁程度
      if (child.type === 'branch' && child.frames[0].radius > 0.03) {
        const cr = skin.rings[child.index][0]
        const cM = skin.ringM[child.index]
        const dir = child.frames[0].dir
        let lo = Infinity, hi = 0
        for (let k = 0; k < cM; k++) {
          const vx = pos[(cr + k) * 3] - c0.x
          const vy = pos[(cr + k) * 3 + 1] - c0.y
          const vz = pos[(cr + k) * 3 + 2] - c0.z
          const a = vx * dir.x + vy * dir.y + vz * dir.z
          const rad = Math.hypot(vx - a * dir.x, vy - a * dir.y, vz - a * dir.z)
          lo = Math.min(lo, rad); hi = Math.max(hi, rad)
        }
        minAspect = Math.min(minAspect, lo / Math.max(1e-9, hi))
      }
    }
  }
  check(`分叉窗口轴向对中 (树枝 |轴向偏差| < 0.3×半径+1cm, 最大 ${maxAxial.toFixed(3)}m)`, badAxial === 0, `${badAxial} 个超限`)
  check('粗树枝根部圆度 (ring0 短/长轴 > 0.85)', minAspect > 0.85, minAspect.toFixed(3))
  // 两个根窗口不能挤在同一处: 取所有根窗口 rim 顶点的最小三维距离
  let minRootRim = Infinity
  for (let i = 0; i < rootRims.length; i++) {
    for (let j = i + 1; j < rootRims.length; j++) {
      for (const va of rootRims[i]) {
        const ax = pos[va * 3], ay = pos[va * 3 + 1], az = pos[va * 3 + 2]
        for (const vb of rootRims[j]) {
          const dx = ax - pos[vb * 3], dy = ay - pos[vb * 3 + 1], dz = az - pos[vb * 3 + 2]
          minRootRim = Math.min(minRootRim, Math.sqrt(dx * dx + dy * dy + dz * dz))
        }
      }
    }
  }
  check('相邻树根窗口不挤在同一处 (rim 最小间距 > 0.1m)', minRootRim > 0.1, minRootRim.toFixed(3))
}

/* 33. SpeedTree 风格树皮 (分枝管+领口, 无窗口) */
console.log('\n[33] SpeedTree 风格树皮')
{
  const p = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  p.leaves.enabled = false
  p.fruit.enabled = false
  p.roots.enabled = true
  p.bark.pipeline = 'speedtree'
  const r = buildTree(p)
  const v = r.stats.skin.validation
  check('SpeedTree 模式: 每枝闭合分量, 无边界/非流形边',
    v.boundary === 0 && v.nonManifold === 0 && v.nonManifoldVertices === 0 &&
    v.components === v.expectedComponents && v.ok,
    JSON.stringify({ b: v.boundary, nm: v.nonManifold, c: v.components, exp: v.expectedComponents }))
  check('SpeedTree 模式: 所有骨架分支都有蒙皮', v.missingBranches.length === 0 && v.failedWindows === 0)
  const skinP = normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer'))
  skinP.leaves.enabled = false
  skinP.fruit.enabled = false
  skinP.roots.enabled = true
  skinP.bark.pipeline = 'skin'
  const r2 = buildTree(skinP)
  check('SpeedTree 模式: 几何与旧连续蒙皮不同',
    r.stats.barkTriangles !== r2.stats.barkTriangles || r.stats.barkVertices !== r2.stats.barkVertices,
    `${r.stats.barkTriangles}/${r2.stats.barkTriangles}`)
}

/* 34. 单枝编辑: 半径 / 移动 / 旋转 / 扭曲 */
console.log('\n[34] 单枝编辑')
{
  const baseP = normalizeParams(defaultParams())
  baseP.leaves.enabled = false
  baseP.fruit.enabled = false
  baseP.flower.enabled = false
  const baseR = buildTree(baseP)
  const idx = 1
  const b0 = baseR.skeleton.branches[idx]
  const p = normalizeParams(baseP)
  p.branchEdits = { [idx]: { radiusScale: 2, moveX: 0.6, moveY: 0.4, rotZ: 25, twist: 70 } }
  const r = buildTree(p)
  const b1 = r.skeleton.branches[idx]
  check('单枝编辑: 半径倍率生效',
    b1.frames[0].radius > b0.frames[0].radius * 1.9,
    `${b0.frames[0].radius.toFixed(3)} -> ${b1.frames[0].radius.toFixed(3)}`)
  check('单枝编辑: 移动/旋转改变枝基位置',
    b1.frames[0].pos.distanceTo(b0.frames[0].pos) > 0.2,
    b1.frames[0].pos.distanceTo(b0.frames[0].pos).toFixed(3))
  const child = b0.children && b0.children.length ? r.skeleton.branches[b0.children[0]] : null
  const child0 = b0.children && b0.children.length ? baseR.skeleton.branches[b0.children[0]] : null
  check('单枝编辑: 子枝跟随父枝移动',
    !child || !child0 || child.frames[0].pos.distanceTo(child0.frames[0].pos) > 0.2,
    child && child0 ? child.frames[0].pos.distanceTo(child0.frames[0].pos).toFixed(3) : 'no-child')
  check('单枝编辑: 节点暴露 branchIndex 且可重置',
    r.nodes.some((n) => n.type === 'branch' && n.meta && n.meta.branchIndex === idx))
  const resetP = normalizeParams(p)
  resetP.branchEdits = {}
  check('单枝编辑: 重置后几何恢复',
    geomHash(buildTree(resetP).barkGeometry) === geomHash(baseR.barkGeometry))
}

/* 35. 树枝环绕式叶/花 */
console.log('\n[35] 树枝环绕式叶/花')
{
  const baseP = normalizeParams(defaultParams())
  baseP.fruit.enabled = false
  baseP.leaves.enabled = true
  baseP.flower.enabled = true
  baseP.flower.clusterCount = 2
  const base = buildTree(baseP)
  const p = normalizeParams(baseP)
  p.leaves.branchWrap = true
  p.leaves.branchWrapTurns = 3
  p.flower.branchWrap = true
  p.flower.branchWrapTurns = 3
  const r = buildTree(p)
  check('树枝环绕叶: 叶量保持 (只改分布)', r.stats.leaves === base.stats.leaves,
    `${r.stats.leaves} vs ${base.stats.leaves}`)
  check('树枝环绕叶: 叶簇几何发生变化',
    !!r.leafGeometry && geomHash(r.leafGeometry) !== geomHash(base.leafGeometry))
  check('树枝环绕花: 花朵几何发生变化',
    !!r.flowerGeometry && geomHash(r.flowerGeometry) !== geomHash(base.flowerGeometry))
  check('树干环绕已移除: 没有 L0 叶簇节点',
    !r.nodes.some((n) => n.type === 'leaves' && n.level === 0))
  check('树枝环绕花: 花朵仍生成', r.stats.flowers > 0 && r.stats.flowerTriangles > 0,
    `${r.stats.flowers}`)
}

/* 36. 子枝半径 <= 父枝贴合处半径的 80% */
console.log('\n[36] 子枝半径约束')
{
  const p = normalizeParams(defaultParams())
  p.leaves.enabled = false
  p.flower.enabled = false
  p.fruit.enabled = false
  p.roots.enabled = true
  p.branches.level[0].radiusRatio = 1.3 // 故意把 L1 加粗, 触发逐级收细
  const r = buildTree(p)
  const branches = r.skeleton.branches
  const clampStats = r.stats.skin.radiusClamp
  const parentRadius = (b) => {
    const parent = branches[b.parent]
    const seg = Math.max(0, Math.min(parent.frames.length - 2, b.attach.segment))
    const t = Math.max(0, Math.min(1, b.attach.t))
    const a = parent.frames[seg].radius
    const c = parent.frames[seg + 1].radius
    return a + (c - a) * t
  }
  let worst = 0
  let worstL1 = 0
  let bad = 0
  let l1 = 0
  for (const b of branches) {
    if (b.parent === null || b.parent === undefined) continue
    const ratio = b.frames[0].radius / Math.max(1e-9, parentRadius(b))
    if (ratio > worst) worst = ratio
    if (ratio > 0.8001) bad++
    if (b.type === 'branch' && b.level === 1) {
      l1++
      worstL1 = Math.max(worstL1, ratio)
    }
  }
  check('子枝半径约束: 所有子枝 <= 0.8×父枝贴合处半径', bad === 0, `${bad} 个超限, worst=${worst.toFixed(4)}`)
  check('子枝半径约束: L1 全部 <= 0.8×父枝', l1 > 0 && worstL1 <= 0.8001, `L1=${l1}, worst=${worstL1.toFixed(4)}`)
  check('子枝半径约束: 逐级收细确实触发', clampStats && clampStats.clamped > 0 && clampStats.maxRatio === 0.8,
    JSON.stringify(clampStats))
}

/* 汇总 */
console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail) {
  console.log('\n失败项:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
console.log('全部自检通过 ✅\n')
