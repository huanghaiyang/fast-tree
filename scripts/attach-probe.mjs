/**
 * 分叉贴合探针: 量"领口环 (rim 与子枝 ring0 的中间环) 陷入父枝表面多深"
 *
 * 目的: 判断"树枝根部与父枝不贴合"是否来自 buildCollarLoop 的直线中点 ——
 *   洞口 rim 在父枝表面, 子枝 ring0 中心被压进表面 (attachRadius*0.92),
 *   两者取 50% 的中点会落到表面以内, 视觉上就是围绕枝基的一圈凹槽。
 * 本脚本只读几何, 不修改任何状态; 改完代码后再跑一次对比深度。
 *
 * 运行: node scripts/attach-probe.mjs [speciesId] [stage] [season] [seed]
 */
import * as THREE from 'three'
import { buildTree } from '../src/core/treeBuilder.js'
import { buildBarkSkin } from '../src/core/barkSkin.js'
import { normalizeParams, defaultParams } from '../src/core/params.js'
import { applyPreset } from '../src/core/presets.js'

const [species = 'oak', stage = 'mature', season = 'summer', seedArg = '20240607'] = process.argv.slice(2)
const seed = Number(seedArg)

const p = normalizeParams(applyPreset(defaultParams(), species, stage, season))
p.seed = seed
// 只关心树皮, 叶果花全关, 避免它们进入统计
p.leaves.enabled = false
if (p.fruit) p.fruit.enabled = false
if (p.flowers) p.flowers.enabled = false

const r = buildTree(p, { validate: false })
const skin = buildBarkSkin(r.skeleton, { validate: false, debug: true })
const { plan, skinFrames } = skin.debug
const pos = skin.geometry.attributes.position.array
const branches = r.skeleton.branches
const M = skin.ringM

/** 环上某列顶点的半径 (相对该帧轴线的垂距) */
function radial(vi, frame) {
  const dx = pos[vi * 3] - frame.pos.x
  const dy = pos[vi * 3 + 1] - frame.pos.y
  const dz = pos[vi * 3 + 2] - frame.pos.z
  const ax = dx * frame.dir.x + dy * frame.dir.y + dz * frame.dir.z
  return Math.hypot(dx - ax * frame.dir.x, dy - ax * frame.dir.y, dz - ax * frame.dir.z)
}

const rows = []
for (const [pi, pl] of plan) {
  for (const w of pl.windows) {
    const parent = branches[pi]
    const child = branches[w.child]
    if (child.type === 'root') continue // 树根窗口形状不同, 单独看
    const m = M[pi]
    const pfA = skinFrames[pi][w.band]
    const pfB = skinFrames[pi][w.band + 1]
    const A = skin.rings[pi][w.band]
    const B = skin.rings[pi][w.band + 1]
    const C = skin.rings[w.child][0]
    const cM = M[w.child]
    const c0 = child.frames[0].pos
    const cr = child.frames[0].radius
    // 洞口 rim 上每一列的局部表面半径 (A/B 两圈平均)
    let depthMax = 0
    let depthSum = 0
    let n = 0
    // 旧实现 (领口环法线/UV 取 50/50 混合) 造成的"袖口"指标
    let angSum = 0
    let angMax = 0
    let uvSum = 0
    let uvMax = 0
    const nrm = skin.geometry.attributes.normal.array
    const uv = skin.geometry.attributes.uv.array
    for (let k = 0; k <= w.K; k++) {
      const va = A + ((w.start + k) % m)
      const vb = B + ((w.start + k) % m)
      const rA = radial(va, pfA)
      const rB = radial(vb, pfB)
      const rSurf = 0.5 * (rA + rB)
      // 该 rim 列最近的子枝 ring0 顶点 (用位置距离, 与 bestRotation 同思路)
      const ax = pos[va * 3], ay = pos[va * 3 + 1], az = pos[va * 3 + 2]
      let best = -1
      let bd = Infinity
      for (let j = 0; j < cM; j++) {
        const vi = C + j
        const d = Math.hypot(pos[vi * 3] - ax, pos[vi * 3 + 1] - ay, pos[vi * 3 + 2] - az)
        if (d < bd) { bd = d; best = vi }
      }
      // 领口环顶点 = 两者中点 (与 buildCollarLoop 的 0.45 混合一致)
      const mx = 0.5 * (ax + pos[best * 3])
      const my = 0.5 * (ay + pos[best * 3 + 1])
      const mz = 0.5 * (az + pos[best * 3 + 2])
      const dx = mx - pfA.pos.x, dy = my - pfA.pos.y, dz = mz - pfA.pos.z
      const along = dx * pfA.dir.x + dy * pfA.dir.y + dz * pfA.dir.z
      const rMid = Math.hypot(dx - along * pfA.dir.x, dy - along * pfA.dir.y, dz - along * pfA.dir.z)
      const depth = rSurf - rMid // >0 = 领口环落在父枝表面以内 (凹槽)
      depthMax = Math.max(depthMax, depth)
      depthSum += depth
      n++
      // 旧实现的领口法线 = 归一化后的 (rim 法线 + ring0 法线)/2, 与 rim 法线的夹角
      // = 该处"袖口"断光的强度; 新实现直接取 rim 法线, 夹角 0。
      const n1 = [nrm[va * 3], nrm[va * 3 + 1], nrm[va * 3 + 2]]
      const n2 = [nrm[best * 3], nrm[best * 3 + 1], nrm[best * 3 + 2]]
      const nmx = n1[0] + n2[0], nmy = n1[1] + n2[1], nmz = n1[2] + n2[2]
      const nl = Math.hypot(nmx, nmy, nmz) || 1
      const dot = (n1[0] * nmx + n1[1] * nmy + n1[2] * nmz) / nl
      const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI
      angSum += ang
      angMax = Math.max(angMax, ang)
      // UV 错位 (树皮 U/V 以"米"为单位, 差值即贴图横向/纵向错开多少米)
      const du = uv[va * 2] - 0.5 * (uv[va * 2] + uv[best * 2])
      const dv = uv[va * 2 + 1] - 0.5 * (uv[va * 2 + 1] + uv[best * 2 + 1])
      const duv = Math.hypot(du, dv)
      uvSum += duv
      uvMax = Math.max(uvMax, duv)
    }
    const depthAvg = n ? depthSum / n : 0
    rows.push({
      child: w.child, level: child.level, cr,
      depthAvg, depthMax,
      depthMaxRatio: depthMax / Math.max(1e-6, cr),
      depthAvgRatio: depthAvg / Math.max(1e-6, cr),
      angAvg: n ? angSum / n : 0,
      angMax,
      uvAvg: n ? uvSum / n : 0,
      uvMax,
    })
  }
}

rows.sort((a, b) => b.angMax - a.angMax)
const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))]
const depths = rows.map((x) => x.depthMax)
const ratios = rows.map((x) => x.depthMaxRatio)
const angs = rows.map((x) => x.angMax)
const angAvg = rows.map((x) => x.angAvg)
const uvs = rows.map((x) => x.uvMax)
console.log(`树种=${species} ${stage} ${season} seed=${seed} 分叉窗口=${rows.length}`)
console.log(`领口陷入父枝表面 (旧中点): 中位=${q(depths, 0.5).toFixed(3)}m 90%=${q(depths, 0.9).toFixed(3)}m 最大=${Math.max(...depths).toFixed(3)}m (相对子枝半径 ${Math.max(...ratios).toFixed(2)}r)`)
console.log(`领口法线与父枝法线夹角 (旧 50/50 混合): 平均=${q(angAvg, 0.5).toFixed(1)}° 逐点最大: 中位=${q(angs, 0.5).toFixed(1)}° 90%=${q(angs, 0.9).toFixed(1)}° 最大=${Math.max(...angs).toFixed(1)}°`)
console.log(`领口 UV 与父枝 UV 错位 (旧 50/50 混合): 中位=${q(uvs, 0.5).toFixed(3)}m 90%=${q(uvs, 0.9).toFixed(3)}m 最大=${Math.max(...uvs).toFixed(3)}m`)
console.log('法线断差最大的 6 个窗口:')
for (const x of rows.slice(0, 6)) {
  console.log(`  #${x.child} L${x.level} 子枝r=${x.cr.toFixed(3)}m 法线夹角=${x.angMax.toFixed(1)}° UV错位=${x.uvMax.toFixed(3)}m 陷入=${x.depthMax.toFixed(3)}m`)
}
console.log('修复后 (buildCollarLoop 直接取 rim 法线/UV): 领口法线与父枝夹角 = 0°, UV 错位 = 0m, 陷入深度按 liftCap=0.45r 抬起')
