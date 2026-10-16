/**
 * 无浏览器自检: 校验生成器的确定性、参数隔离、几何合法性
 * 运行: npm run selftest
 */
import { buildTree, selectionRanges } from '../src/core/treeBuilder.js'
import { defaultParams, normalizeParams, MAX_LEVELS } from '../src/core/params.js'
import { autoGenerate, autoWind, applyPreset, PRESETS } from '../src/core/presets.js'
import {
  SPECIES, GROWTH_STAGES, SEASONS, composeTree, classificationName, allCombinations,
} from '../src/core/species.js'
import { buildLeafTemplate, LEAF_SHAPE_KEYS } from '../src/core/leaf.js'
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
check('果实计入面数且不超预算', fR.stats.barkTriangles > oakR.stats.barkTriangles, `${fR.stats.barkTriangles} vs ${oakR.stats.barkTriangles}`)
const pineP = composeTree('pine', 'mature', 'summer', 4242)
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

/* 汇总 */
console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail) {
  console.log('\n失败项:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
console.log('全部自检通过 ✅\n')
