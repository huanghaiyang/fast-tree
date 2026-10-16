/**
 * 无浏览器自检: 校验生成器的确定性、参数隔离、几何合法性
 * 运行: npm run selftest
 */
import { buildTree, selectionRanges } from '../src/core/treeBuilder.js'
import { defaultParams, normalizeParams, MAX_LEVELS } from '../src/core/params.js'
import { autoGenerate, autoWind, applyPreset, PRESETS } from '../src/core/presets.js'
import { buildLeafTemplate, LEAF_SHAPE_KEYS } from '../src/core/leaf.js'
import { motionMetrics } from '../src/core/windModel.js'

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
check('默认风力很轻 (树梢位移 <= 0.15m)', defWind.strength <= 0.15, `strength=${defWind.strength}`)
check('自动风中档 (k=0.3) 也 <= 0.15m', autoWind(999, 0.3).strength <= 0.15, `${autoWind(999, 0.3).strength}`)
check('大风档 (k=1) 仍 <= 0.4m', autoWindSamples[4].strength <= 0.4, `${autoWindSamples[4].strength}`)

/* 6b. 叶片运动学: 不许绕圈 */
console.log('\n[6b] 叶片运动学 (物理合理性)')
const nowMetrics = motionMetrics(defWind, 'current')
const legacyMetrics = motionMetrics(
  { strength: 0.35, speed: 1.15, frequency: 1.4, gust: 0.45, gustSpeed: 0.22, turbulence: 0.3, bias: 0, leafFlutter: 1.2, leafTwist: 0.7, direction: 45 },
  'legacy',
)
const lineOnly = motionMetrics({ ...defWind, turbulence: 0 }, 'current', { steps: 900 })
check('默认: 叶片摆动以顺风往复为主 (垂直分量 < 40%)',
  nowMetrics.thinness < 0.4, `thinness=${nowMetrics.thinness}`)
check('默认: 叶片摆动幅度 <= 0.15m (不再是大风)',
  nowMetrics.spanAlong <= 0.15, `spanAlong=${nowMetrics.spanAlong}`)
check('对照: 旧公式近乎各向同性 (=看着在绕圈)',
  legacyMetrics.thinness > 0.7, `legacy thinness=${legacyMetrics.thinness}`)
check('对照: 旧公式摆幅远大于现在 (>4x)',
  legacyMetrics.spanAlong > nowMetrics.spanAlong * 4,
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

/* 汇总 */
console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail) {
  console.log('\n失败项:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
console.log('全部自检通过 ✅\n')
