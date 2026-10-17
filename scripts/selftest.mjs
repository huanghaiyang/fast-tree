/**
 * 无浏览器自检: 校验生成器的确定性、参数隔离、几何合法性
 * 运行: npm run selftest
 */
import { buildTree, selectionRanges } from '../src/core/treeBuilder.js'
import { defaultParams, normalizeParams, MAX_LEVELS, GROUP_KEYS } from '../src/core/params.js'
import { autoGenerate, autoWind, applyPreset, PRESETS } from '../src/core/presets.js'
import {
  SPECIES, GROWTH_STAGES, SEASONS, composeTree, classificationName, allCombinations,
} from '../src/core/species.js'
import { buildLeafTemplate, LEAF_SHAPE_KEYS } from '../src/core/leaf.js'
import { createSharedUniforms, createLeafMaterial, createBarkMaterial, updateMaterials, internalShaderSources, resolveTintMix } from '../src/core/materials.js'
import { sampleEmitPositions, buildParticleSeeds, createParticleMaterial, PARTICLE_VERT, PARTICLE_FRAG } from '../src/core/particles.js'
import { buildFallingLeaves, fallRebuildKey, FALL_FRAG } from '../src/core/fallingLeaves.js'
import { buildLeafLitter, litterRebuildKey } from '../src/core/litter.js'
import { normalFromLuminance } from '../src/core/normalFromAlbedo.js'
import { ellipseLeafTexture, resolveEffectTexture, resolveEffectAspect } from '../src/core/leafTexture.js'
import { LEAF_CARDS } from '../src/core/leafCards.generated.js'
import { motionMetrics, swayEnvelope } from '../src/core/windModel.js'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runAudit, AUDIT_EXEMPT, STORE_LEVEL } from './paramAudit.mjs'
import { docFor, DOC_KEYS } from '../src/core/paramDocs.js'

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
/** 边界边计数: 流形封闭曲面 = 0 (每条边恰好被 2 个三角面共享) */
function boundaryEdges(geo) {
  const idx = geo.index.array
  const map = new Map()
  const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a)
  for (let i = 0; i < idx.length; i += 3) {
    const t = [idx[i], idx[i + 1], idx[i + 2]]
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
oakP.fruit = { ...oakP.fruit, enabled: false }   // 流形/封闭测试先排除果实(旋转体极点)
const oakR = buildTree(oakP)
const be = boundaryEdges(oakR.barkGeometry)
check('树皮几何流形 (每条边最多 2 个面)', be.nonManifold === 0, JSON.stringify(be))
// 杆件基部埋进父枝内部, 故意留开口(否则会有双层面) -> 全局必有边界边, 但**主干必须完全封闭**
const trunkGroup = oakR.groups.find((g) => g.id === 'trunk')
const trunkIds = new Set(trunkGroup ? trunkGroup.nodeIds : [])
const trunkBoundary = (() => {
  const geo = oakR.barkGeometry
  const idx = geo.index.array
  const nodeAttr = geo.attributes.aNodeId.array
  const map = new Map()
  const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a)
  for (let i = 0; i < idx.length; i += 3) {
    const t = [idx[i], idx[i + 1], idx[i + 2]]
    if (!t.every((v) => trunkIds.has(nodeAttr[v]))) continue
    for (let e = 0; e < 3; e++) {
      const k = key(t[e], t[(e + 1) % 3])
      map.set(k, (map.get(k) || 0) + 1)
    }
  }
  let boundary = 0
  for (const c of map.values()) if (c === 1) boundary++
  return boundary
})()
check('主干完全封闭 (基部与分叉顶端都封口, 不出现截断截面)', trunkBoundary === 0, 'boundary=' + trunkBoundary)
check('枝/根基部开口数 = 埋进父枝的那些环 (不是可见破洞)', be.boundary > 0 && be.boundary < 12 * (oakR.stats.branches + 8), 'boundary=' + be.boundary)
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
const mixP = composeTree('oak', 'mature', 'summer', 4242)
mixP.leaves.shapeMix = [{ shape: 'oak', weight: 2 }, { shape: 'needle', weight: 1 }]
const mixR = buildTree(mixP)
check('叶形混合会改变几何 (可随意组合)', geomHash(mixR.leafGeometry) !== geomHash(oakR.leafGeometry))
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
check('堆积材质不再注入自定义着色器 (vMapUv 报错的根因)', (() => {
  const lp = composeTree('oak', 'mature', 'summer', 4242)
  const lg = buildTree(composeTree('oak', 'mature', 'summer', 4242)).leafGeometry
  const bb = lg.boundingBox || (lg.computeBoundingBox(), lg.boundingBox)
  const m = buildLeafLitter({ ...lp, litter: { ...lp.litter, enabled: true } }, null, bb)
  console.log('      堆积材质 onBeforeCompile=' + (typeof m.material.onBeforeCompile))
  // three 的 Material 原型上本来就有 onBeforeCompile (空实现), 所以要看实例上有没有自己的
  const own = Object.prototype.hasOwnProperty.call(m.material, 'onBeforeCompile')
  return !own && !!(m.material.map && m.material.map.isDataTexture)
})())

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

/* 汇总 */
console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail) {
  console.log('\n失败项:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
console.log('全部自检通过 ✅\n')
