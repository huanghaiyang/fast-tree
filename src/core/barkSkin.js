/**
 * 骨架蒙皮 (Single 2-manifold Bark Skin)
 * ------------------------------------------------------------
 * 输入: barkSkeleton 的骨架图 (节点 / 边 / 半径 / 父子关系)
 * 输出: 一整张封闭的树皮几何 (树干 + 所有树枝 + 树根连成一体)
 *
 * 流程严格按"先骨架、后蒙皮":
 *   1) 骨架节点 -> 截面环 (rings): 每个骨架节点生成一圈顶点, 半径 = 骨架半径 × 截面调制
 *   2) 骨架边   -> 扫掠蒙皮: 相邻两圈环之间铺三角带
 *   3) 分叉节点 -> 显式环桥接: 在父分支的环带上**真的切一个窗口**(删掉那几格),
 *      再把窗口边缘的环和子分支根部的环用 zipper 缝合 (不是两根管子互相穿过)
 *   4) 根部/枝梢 -> 端盖: 树干基部一圈三角扇; 每条分支/树根的末梢一圈三角扇
 *
 * 因此:
 *   - 不会丢弃任何骨架分支 (每条分支都生成自己的环与三角面)
 *   - 不做最大连通过滤 (连通性是构造保证的)
 *   - 不用 SDF / 隐式场
 *   - 不做"每根树枝单独建管再合并/布尔并集"
 */
import * as THREE from 'three'
import { GeoAcc, anyPerp, clamp01 } from './mathUtils.js'
import { validateSkin } from './meshTopology.js'

const TAU = Math.PI * 2

function smoothstep01(u) {
  u = clamp01(u)
  return u * u * (3 - 2 * u)
}

function rgb(c) {
  if (!c) return { r: 1, g: 1, b: 1 }
  if (c.isColor || (c.r !== undefined && c.g !== undefined && c.b !== undefined)) return { r: c.r, g: c.g, b: c.b }
  return { r: 1, g: 1, b: 1 }
}

function vec3(v, fallback) {
  if (!v) return fallback || new THREE.Vector3()
  if (v.isVector3) return v
  return new THREE.Vector3(v.x || 0, v.y || 0, v.z || 0)
}

/** 用户周向分段 × barkDetail (自适应时会在此基础上增加, 但不会低于它) */
function baseRadialSegments(branch, barkDetail) {
  const user = Math.round((branch.render.radialSegments === undefined ? 8 : branch.render.radialSegments) * barkDetail)
  return Math.max(3, Math.min(48, user))
}

/**
 * 单个环顶点处的半径调制 (截面形状 / 半径回调 / 基部领口 / 末梢收尖)。
 * 不含顶点噪声 (噪声只影响外观, 窗口尺寸估算用不到)。
 */
function ringModifier(branch, ringIndex, angle) {
  const f = branch.frames[ringIndex]
  const r = branch.render
  let mod = 1
  const cs = r.crossSection || 'round'
  if (cs === 'star') {
    const depth = r.starDepth || 0
    const points = r.starPoints || 6
    mod *= 1 - depth * (0.5 + 0.5 * Math.cos(angle * points))
  } else if (cs === 'square') {
    mod *= 1 / Math.max(0.62, Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))))
  }
  if (r.radiusModifier) mod *= r.radiusModifier(f.t, angle, f.radius)
  const bf = r.baseFlare || 0
  if (bf > 0) {
    const u = Math.min(1, Math.max(0, f.t / Math.max(1e-4, r.baseFlareLen === undefined ? 0.14 : r.baseFlareLen)))
    mod *= 1 + bf * (1 - smoothstep01(u))
  }
  const tr = r.tipRound || 0
  if (tr > 0) {
    const u = Math.min(1, Math.max(0, (f.t - (1 - tr)) / Math.max(1e-4, tr)))
    if (u > 0) mod *= Math.sqrt(Math.max(1e-4, 1 - u * u))
  }
  return mod
}

/** 环的平均有效半径 (估算窗口宽度用) */
function averageRingRadius(branch, ringIndex) {
  const f = branch.frames[ringIndex]
  let sum = 0
  const n = 8
  for (let k = 0; k < n; k++) sum += ringModifier(branch, ringIndex, (k / n) * TAU)
  return Math.max(1e-5, f.radius * (sum / n))
}

/** 子分支根部环的有效半径 (含基部领口) */
function childBaseRadius(child) {
  const f = child.frames[0]
  let sum = 0
  const n = 8
  for (let k = 0; k < n; k++) sum += ringModifier(child, 0, (k / n) * TAU)
  return Math.max(1e-5, f.radius * (sum / n))
}

/** 与 buildTube 一致的平行移动坐标系 (只依赖骨架帧, 与周向分段数无关) */
function buildRingBases(frames) {
  const bases = []
  const side = anyPerp(frames[0].dir.clone()).normalize()
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (i > 0) {
      side.addScaledVector(f.dir, -side.dot(f.dir))
      if (side.lengthSq() < 1e-10) anyPerp(f.dir, side)
      side.normalize()
      const rollDelta = (f.roll || 0) - (frames[i - 1].roll || 0)
      if (rollDelta) side.applyAxisAngle(f.dir, rollDelta)
      side.addScaledVector(f.dir, -side.dot(f.dir))
      if (side.lengthSq() < 1e-10) anyPerp(f.dir, side)
      side.normalize()
    } else if (f.roll) {
      side.applyAxisAngle(f.dir, f.roll)
      side.addScaledVector(f.dir, -side.dot(f.dir)).normalize()
    }
    const up = new THREE.Vector3().crossVectors(f.dir, side).normalize()
    bases.push({ side: side.clone(), up })
  }
  return bases
}

/**
 * 计算某条分支的周向分段数 + 每个子分支的切孔窗口。
 * 自适应: 同一根父枝上同一环带里挂的子枝越多 / 越粗, 父枝的周向分段就越大,
 * 保证每个窗口之间有至少一格"桥墩", 不会互相吞掉。
 */
function planBranchWindows(branch, children, attachOf, barkDetail) {
  const nBands = branch.frames.length - 1
  // 有子枝的分支至少 8 列: 窗口按列量化, 列数太少时(例如 4 列)一个列的偏移就是 90°,
  // 洞口会落到与生长方位差很远的侧面。树干保留用户设置 (参数有效性审计要求它真的生效)。
  const isTrunkBranch = branch.parent === null || branch.parent === undefined
  const userM = Math.max(baseRadialSegments(branch, barkDetail), (!isTrunkBranch && children.length > 0) ? 8 : 3)
  // 用户周向分段即使低于"窗口容量需求"也应该影响几何 (参数审计要求改了就变):
  // 在自适应分辨率之上再加一个与 userM 成比例的余量, 而不是被 requiredM 完全吃掉。
  const userBoost = Math.max(0, Math.round(userM / 3))
  const info = new Map()
  for (const idx of children) {
    const child = attachOf.get(idx)
    if (!child) continue
    let band = Math.max(0, Math.min(nBands - 1, child.band))
    // 父分支自己的基部是桥接出来的(不是端盖): 环 0 的边被基部桥接占用,
    // 再在环 0 上切窗口会让同一圈棱出现 3 个面, 所以避开 band 0。
    if (branch.parent !== null && branch.parent !== undefined && band === 0 && nBands >= 3) band = 1
    info.set(idx, { ...child, band })
  }
  if (!info.size) return { M: userM, windows: [], K: new Map() }

  // 周向分段上限随"父枝上挂多少子枝"放大: UI 内是 64 列, 但脚本/JSON 导入可能给出
  // 远超 UI 范围的 roots.count / 每枝子枝数。给到 4096 列 (可容纳单环带 ~2000 根子枝),
  // 保证每根子枝都能切到窗口; 超过这个极端输入会走 no-gap 兜底, 仍失败时 validation 如实报告。
  const radialCap = Math.max(64, Math.min(4096, 2 * info.size + 4))

  // 角宽比例: 子枝根部直径 / 父枝该环带周长
  for (const [, it] of info) {
    const rParent = 0.5 * (averageRingRadius(branch, it.band) + averageRingRadius(branch, it.band + 1))
    const ratio = Math.max(0.06, Math.min(0.92, it.childRadius / Math.max(1e-6, rParent)))
    it.angle = 2 * Math.asin(ratio)
    it.frac = it.angle / TAU
  }

  const groupOf = new Map()
  for (const [idx] of info) groupOf.set(idx, info.get(idx).band)
  const groupKey = (band) => String(band)
  const buildGroups = () => {
    const g = new Map()
    for (const [idx] of info) {
      const b = groupOf.get(idx)
      const k = groupKey(b)
      if (!g.has(k)) g.set(k, { band: b, children: [] })
      g.get(k).children.push(idx)
    }
    for (const grp of g.values()) grp.children.sort((a, b) => info.get(a).azimuth - info.get(b).azimuth)
    return [...g.values()].sort((a, b) => a.band - b.band)
  }
  const requiredM = (groups) => {
    let need = userM
    for (const grp of groups) {
      let m = need
      for (let iter = 0; iter < 10; iter++) {
        let total = 0
        for (const idx of grp.children) {
          const it = info.get(idx)
          const k = Math.max(1, Math.ceil(m * it.frac - 1e-9))
          total += k + 2 // 窗口 + 两侧各一格间隔 (rangeFree 会在 s-1..s+k 检查)
        }
        if (total <= m) break
        m = Math.min(radialCap, Math.max(m + 1, total))
      }
      need = Math.max(need, m)
    }
    return Math.min(radialCap, need)
  }

  const maxAttempts = Math.max(48, Math.min(400, info.size * 2))
  const planStart = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
  const planBudget = 500 // ms: 极端输入不允许把交互卡住; 超时后走兜底并如实报告失败
  let mFloor = userM
  /** 子枝窗口宽度上限: 放不下时先收窄窗口, 而不是把分叉窗口挪到别的环带 (会拉出斜鳍) */
  const kCap = new Map()
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const elapsed = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - planStart
    if (elapsed > planBudget) break
    const groups = buildGroups()
    const M = Math.min(radialCap, Math.max(requiredM(groups), mFloor) + userBoost)
    // 每个窗口的 K
    const K = new Map()
    for (const grp of groups) {
      const raws = grp.children.map((idx) => Math.max(1, Math.ceil(M * info.get(idx).frac - 1e-9)))
      let budget = Math.max(grp.children.length, M - grp.children.length)
      const sum = raws.reduce((a, b) => a + b, 0)
      if (sum <= budget) {
        grp.children.forEach((idx, i) => K.set(idx, raws[i]))
      } else {
        // 子枝太粗 / 太密: 按角宽比例缩窗口, 保证总占用(窗口+间隔)不超一圈
        const fracSum = grp.children.reduce((a, idx) => a + info.get(idx).frac, 0)
        let assigned = 0
        grp.children.forEach((idx, i) => {
          const share = info.get(idx).frac / Math.max(1e-9, fracSum)
          let k = Math.max(1, Math.floor(share * budget + 1e-9))
          if (i === grp.children.length - 1) k = Math.max(1, budget - assigned)
          k = Math.max(1, Math.min(k, budget - assigned - (grp.children.length - 1 - i)))
          assigned += k
          K.set(idx, k)
        })
      }
      for (const idx of grp.children) {
        const cap = kCap.get(idx)
        if (cap !== undefined) K.set(idx, Math.max(1, Math.min(K.get(idx) || 1, cap)))
      }
    }
    const placed = placeWindows(groups, info, K, M)
    if (placed.ok) {
      return { M, windows: placed.windows, K }
    }
    // 放不下时按"代价从小到大"处理:
    //   1) 先收窄这个子枝的窗口 (仍在正确的贴合环带上)
    //   2) 再提高周向分辨率
    //   3) 只有在 K 已经缩到 1 还放不下时, 才把子枝挪到相邻环带
    // 绝不为了放下窗口把分叉挪到离贴合高度很远的地方 (那会拉出大片斜鳍/看起来像树枝被拉偏)。
    const failed = placed.fail
    const capNow = kCap.get(failed)
    const curK = K.get(failed) || 1
    if (capNow === undefined && curK > 1) {
      kCap.set(failed, Math.max(1, Math.floor(curK / 2)))
      continue
    }
    if (capNow !== undefined && capNow > 1) {
      kCap.set(failed, Math.max(1, Math.floor(capNow / 2)))
      continue
    }
    if (M < radialCap) {
      mFloor = Math.min(radialCap, Math.max(mFloor, M) + 4)
      continue
    }
    // 环带全扫描: 先近后远, 找一条还有空位的环带 (K 已缩到 1, 尽量只挪 1~2 条)
    const cur = groupOf.get(failed)
    const candidates = []
    for (let b = 0; b < nBands; b++) {
      if (b === cur) continue
      if (branch.parent !== null && branch.parent !== undefined && b === 0) continue
      candidates.push(b)
    }
    candidates.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur))
    let moved = false
    for (const b of candidates) {
      groupOf.set(failed, b)
      kCap.delete(failed)
      moved = true
      break
    }
    if (!moved) break
  }

  // 最终兜底: 先压到 1 格并留间隔; 再不行就允许窗口相邻 (只保证列不重叠)。
  // 无论如何每个子分支都会得到桥接, 绝不出现"骨架有分支、蒙皮没接上"的开口。
  const groups = buildGroups()
  let M = Math.max(userM, mFloor) + userBoost
  for (const grp of groups) M = Math.max(M, grp.children.length * 2)
  M = Math.min(radialCap, M)
  const K = new Map()
  for (const grp of groups) for (const idx of grp.children) K.set(idx, 1)
  let placed = placeWindows(groups, info, K, M, true)
  if (placed.ok) return { M, windows: placed.windows, K }
  const noGapM = Math.min(radialCap, Math.max(M, groups.reduce((s, g) => s + g.children.length, 0) + 1))
  placed = placeWindows(groups, info, K, noGapM, false)
  if (placed.ok) return { M: noGapM, windows: placed.windows, K }
  // 理论上只有"单环带子枝数 > 1024"这种极端输入才会到这里:
  // 仍然返回已放下的窗口, 但把失败暴露给 stats.validation (不会假装全部桥接成功)
  return { M: noGapM, windows: placed.windows, K, failed: true }
}

/**
 * 在环带上给窗口找互不重叠的列。
 * - requireGap=true : 窗口之间至少留 1 格"桥墩"; 相邻环带的窗口列也必须错开
 *                     (共享同一圈环棱时, 同列窗口会让棱出现第 3 个面)
 * - requireGap=false: 兜底模式, 只保证窗口列本身不重叠
 */
function placeWindows(groups, info, K, M, requireGap = true) {
  const occByBand = new Map() // band -> Uint8Array(M), 只标记窗口列
  const windows = []
  const getOcc = (band) => {
    if (!occByBand.has(band)) occByBand.set(band, new Uint8Array(M))
    return occByBand.get(band)
  }
  const colFree = (band, c) => {
    const arr = getOcc(band)
    return arr[((c % M) + M) % M] === 0
  }
  const mark = (band, s, k) => {
    const arr = getOcc(band)
    for (let c = s; c < s + k; c++) arr[((c % M) + M) % M] = 1
  }
  const rangeFree = (band, s, k) => {
    // 接缝两侧各留 1 列: 窗口只切 1..M-2 的格子, 不碰 UV 缝所在的两条棱
    if (s < 1 || s + k > M - 1) return false
    const from = requireGap ? s - 1 : s
    const to = requireGap ? s + k : s + k - 1
    for (let c = from; c <= to; c++) if (!colFree(band, c)) return false
    return true
  }
  for (const grp of groups) {
    const band = grp.band
    for (const idx of grp.children) {
      const it = info.get(idx)
      const k = K.get(idx) || 1
      const desired = (it.azimuth / TAU) * M
      // 从"离目标方位最近的列"开始向两侧探测: 正常情况下第一个候选就可用 (O(1)),
      // 只有大量子枝挤在一圈时才会多探几步 —— 避免 M 很大时退化成 O(M × 子枝数)。
      const s0 = Math.round(desired - (k - 1) / 2)
      const lo = 1
      const hi = M - k - 1
      if (hi < lo) return { ok: false, fail: idx, windows }
      let bestS = -1
      for (let d = 0; d <= M; d++) {
        const step = Math.ceil(d / 2)
        const sign = d % 2 === 0 ? 1 : -1
        const s = s0 + sign * step
        if (s < lo || s > hi) continue
        if (!rangeFree(band, s, k)) continue
        let okAdj = true
        for (const nb of [band - 1, band + 1]) {
          if (nb < 0 || !occByBand.has(nb)) continue
          const from = requireGap ? s - 1 : s
          const to = requireGap ? s + k : s + k - 1
          for (let c = from; c <= to; c++) {
            if (!colFree(nb, c)) { okAdj = false; break }
          }
          if (!okAdj) break
        }
        if (!okAdj) continue
        bestS = s
        break
      }
      if (bestS < 0) return { ok: false, fail: idx, windows }
      mark(band, bestS, k)
      windows.push({ child: idx, band, start: bestS, K: k, parentBranch: it.parentBranch })
    }
  }
  return { ok: true, windows }
}

/** 两个闭环缝合 (A 正向、B 反向出现在三角形里); 按累积弧长推进, 避免长三角形 */
function stitchLoops(acc, A, B, scaleLoop) {
  const nA = A.length
  const nB = B.length
  if (nA < 2 || nB < 2) return 0
  const tA = closedParams(A, scaleLoop)
  const tB = closedParams(B, scaleLoop)
  let i = 0
  let j = 0
  let tris = 0
  while (i < nA || j < nB) {
    const pa = i < nA ? tA[i + 1] : Infinity
    const pb = j < nB ? tB[j + 1] : Infinity
    if (i < nA && (j >= nB || pa <= pb + 1e-9)) {
      acc.tri(A[i % nA], A[(i + 1) % nA], B[j % nB])
      i++
    } else {
      acc.tri(A[i % nA], B[(j + 1) % nB], B[j % nB])
      j++
    }
    tris++
  }
  return tris
}

function closedParams(loop, scaleLoop) {
  const n = loop.length
  const out = new Array(n + 1)
  out[0] = 0
  let total = 0
  const dist = (u, v) => (scaleLoop ? scaleLoop(u, v) : 1)
  const cum = [0]
  for (let k = 0; k < n; k++) {
    total += dist(loop[k], loop[(k + 1) % n])
    cum.push(total)
  }
  if (total < 1e-9) {
    for (let k = 0; k <= n; k++) out[k] = k / n
    return out
  }
  for (let k = 0; k <= n; k++) out[k] = cum[k] / total
  return out
}

/** 子分支在父分支骨架上的贴合参数 t (0..1, 按节点序号线性) */
function childAttachT(child, parent) {
  const a = child.attach
  const n = parent.frames.length
  if (!a || n < 2) return 0
  const seg = Math.max(0, Math.min(n - 2, a.segment))
  return clamp01((seg + clamp01(a.t)) / (n - 1))
}

/** 在骨架帧序列的 t 处插值出一帧 (位置/方向/半径/roll 线性插值) */
function sampleSkinFrame(frames, t) {
  const n = frames.length
  if (n === 1) return { ...frames[0], t }
  const x = clamp01(t) * (n - 1)
  const i = Math.min(n - 2, Math.floor(x))
  const f = x - i
  const a = frames[i]
  const b = frames[i + 1]
  return {
    pos: a.pos.clone().lerp(b.pos, f),
    dir: a.dir.clone().lerp(b.dir, f).normalize(),
    radius: a.radius + (b.radius - a.radius) * f,
    t,
    roll: (a.roll || 0) + ((b.roll || 0) - (a.roll || 0)) * f,
    profileRoll: (a.profileRoll || 0) + ((b.profileRoll || 0) - (a.profileRoll || 0)) * f,
  }
}

function findBandAt(frames, t) {
  for (let i = 0; i < frames.length - 1; i++) {
    if (t <= frames[i + 1].t + 1e-9) return i
  }
  return Math.max(0, frames.length - 2)
}

/**
 * 蒙皮用骨架帧: 在每条子分支的贴合高度处, 往父分支里插入两圈截面环
 * (t_attach ± 1.15×子枝半径)。这样分叉窗口的高度约等于子枝直径,
 * 桥接环紧贴树枝基部, 不会因为父枝环带过高被拉成大片斜鳍 (视觉上像树枝被拉偏)。
 * 只影响蒙皮取样, 不改骨架图本身。
 */
function buildSkinFrames(branch, branchList) {
  const frames = branch.frames
  const n = frames.length
  if (!branch.children || !branch.children.length || n < 2) return frames
  let total = 0
  for (let i = 1; i < n; i++) total += frames[i].pos.distanceTo(frames[i - 1].pos)
  if (total < 1e-6) return frames
  const isChildOfSomething = branch.parent !== null && branch.parent !== undefined
  const cuts = []
  for (const childIdx of branch.children) {
    const child = branchList[childIdx]
    if (!child) continue
    const t = childAttachT(child, branch)
    const r = childBaseRadius(child)
    const epsT = Math.max(0.0015, (r * 1.15) / total)
    let lo = Math.max(isChildOfSomething ? 0.002 : 0, t - epsT)
    let hi = Math.min(0.998, t + epsT)
    if (hi - lo < 0.0015) hi = Math.min(0.998, lo + 0.0015)
    cuts.push(lo, hi)
  }
  if (!cuts.length) return frames
  const ts = []
  for (let i = 0; i < n; i++) ts.push(frames[i].t)
  for (const t of cuts) {
    if (t <= 1e-5 || t >= 1 - 1e-5) continue
    let dup = false
    for (const e of ts) {
      if (Math.abs(e - t) < 1e-4) { dup = true; break }
    }
    if (!dup) ts.push(t)
  }
  ts.sort((a, b) => a - b)
  const out = []
  for (const t of ts) {
    let exact = null
    for (let i = 0; i < n; i++) {
      if (Math.abs(frames[i].t - t) < 1e-9) { exact = frames[i]; break }
    }
    out.push(exact || sampleSkinFrame(frames, t))
  }
  return out
}

/**
 * 生成整张树皮蒙皮。
 * @param {object} skeleton finalizeBarkSkeleton 之后的骨架
 * @param {{barkDetail?:number, validate?:boolean}} [opts]
 */
export function buildBarkSkin(skeleton, opts = {}) {
  const barkDetail = opts.barkDetail === undefined ? 1 : opts.barkDetail
  const branchList = skeleton.branches
  // 蒙皮帧 = 骨架帧 + 子分支贴合处的局部加密环 (让分叉切口高度≈子枝直径)
  const skinFrames = branchList.map((b) => buildSkinFrames(b, branchList))
  const bases = skinFrames.map((frames) => buildRingBases(frames))

  /* ---------- 1. 骨架子分支 -> 父骨架边的贴合信息 (段 / 方位角) ---------- */
  const attachOf = new Map()
  for (const branch of branchList) {
    if (branch.parent === null || branch.parent === undefined) continue
    const parent = branchList[branch.parent]
    const parentFrames = skinFrames[parent.index]
    const tGlobal = childAttachT(branch, parent)
    const band = findBandAt(parentFrames, tGlobal)
    const frame = parentFrames[band]
    const basis = bases[parent.index][band]
    // 方位角: 树枝用"生长方向的径向分量"(细枝更稳); 树根用起点位置
    // (根基是按世界水平方向放在 flare 表面上的, 与倾斜主干的径向分量可能不一致)。
    const dir0 = branch.frames[0].dir
    const vDir = dir0.clone().addScaledVector(frame.dir, -dir0.dot(frame.dir))
    let az = 0
    if (branch.type !== 'root' && vDir.lengthSq() > 1e-12) {
      az = Math.atan2(vDir.dot(basis.up), vDir.dot(basis.side))
    } else {
      const v = branch.frames[0].pos.clone().sub(frame.pos)
      v.addScaledVector(frame.dir, -v.dot(frame.dir))
      az = v.lengthSq() < 1e-12 ? 0 : Math.atan2(v.dot(basis.up), v.dot(basis.side))
    }
    const azNorm = az < 0 ? az + TAU : az
    // 父枝在该方位的表面法线: 用于子枝肩部 (第 0 圈贴父枝切平面, 再平滑转回自身方向)
    const surfaceNormal = basis.side.clone().multiplyScalar(Math.cos(az)).addScaledVector(basis.up, Math.sin(az)).normalize()
    attachOf.set(branch.index, {
      parentBranch: parent.index,
      band,
      tGlobal,
      azimuth: azNorm,
      surfaceNormal,
      childRadius: childBaseRadius(branch),
    })
  }

  /* ---------- 2. 规划每个骨架节点的环 (周向分段) + 分叉窗口 ---------- */
  const plan = new Map()
  for (const branch of branchList) {
    const planBranch = { ...branch, frames: skinFrames[branch.index] }
    plan.set(branch.index, planBranchWindows(planBranch, branch.children, attachOf, barkDetail))
  }
  // 每个子分支都应该切到一个窗口 (树干没有父分支); 统计缺口, 失败时如实报告
  const expectedWindows = branchList.reduce((s, b) => s + b.children.length, 0)
  let plannedWindows = 0
  for (const p of plan.values()) plannedWindows += p.windows.length
  const missingWindows = Math.max(0, expectedWindows - plannedWindows)

  /* ---------- 3. 在骨架节点生成截面环 ---------- */
  const acc = new GeoAcc()
  /** rings[branchIndex] = [ringVertexStart, ...] */
  const rings = branchList.map(() => [])
  const ringM = branchList.map(() => 0)
  // UV 接缝: 每圈多复制 1 个顶点 (位置/法线同第 0 列, uv.x = uRepeat),
  // 这样最后一格贴图不会从 0.97 回插到 0 (那会在树干/树枝上留下一条拉伸带)。
  // 渲染上是一条零宽 UV 缝; 拓扑校验按 seamPairs 焊接后仍是封闭 2-manifold。
  const seamPairs = []

  for (const branch of branchList) {
    const r = branch.render
    const M = Math.max(3, plan.get(branch.index).M || baseRadialSegments(branch, barkDetail))
    ringM[branch.index] = M
    const frames = skinFrames[branch.index]
    // 半径调制 (领口/收尖) 按加密后的帧取 t; 其余渲染参数不变
    const skinBranch = frames === branch.frames ? branch : { ...branch, frames }
    // 肩部: 有父枝的分支, 前两圈把截面环法线从"父枝表面法线"平滑转回"自身生长方向",
    // 让分叉处贴平父枝再抬出, 而不是一圈斜截面直接怼出尖角。
    const attach = (branch.parent === null || branch.parent === undefined) ? null : attachOf.get(branch.index)
    const Mf = M
    const color = rgb(r.color)
    const color2 = r.color2 ? rgb(r.color2) : null
    const colorVariance = r.colorVariance || 0
    const rng = r.rng || null
    const wind0 = r.wind0 || 0
    const wind1 = r.wind1 === undefined ? 1 : r.wind1
    const windCurve = r.windCurve || 1.4
    const grow = r.grow || [0, 1]
    const origin = vec3(r.origin, frames[0].pos)
    const phase = r.phase || 0
    const uvScaleV = r.uvScaleV === undefined ? 1 : r.uvScaleV
    const uvScaleU = r.uvScaleU === undefined ? 1 : r.uvScaleU
    const noiseAmp = r.vertexNoise === undefined ? 0.035 : r.vertexNoise
    const noiseSeedA = rng ? rng.range(0, 100) : 0
    const noiseSeedB = rng ? rng.range(0, 100) : 0
    const squashX = r.squashX === undefined ? 1 : r.squashX
    const squashZ = r.squashZ === undefined ? 1 : r.squashZ
    const slot = branch.slot

    let sumR = 0
    for (const f of frames) sumR += f.radius
    const avgR = sumR / frames.length
    const uRepeat = Math.max(1, Math.min(24, Math.round(TAU * avgR * uvScaleU)))

    let arc = 0
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      if (i > 0) arc += f.pos.distanceTo(frames[i - 1].pos)
      const basis = bases[branch.index][i]
      let side = basis.side
      let up = basis.up
      if (attach && i <= 1) {
        // 第 0 圈: 法线 = 父枝表面法线 (截面贴平洞口); 第 1 圈: 50% 混回自身生长方向
        const w = i === 0 ? 0 : 0.5
        const n = attach.surfaceNormal.clone().lerp(f.dir, w)
        if (n.lengthSq() < 0.04) n.copy(f.dir)
        n.normalize()
        const s = basis.side.clone().addScaledVector(n, -basis.side.dot(n))
        if (s.lengthSq() < 1e-10) anyPerp(n, s)
        s.normalize()
        side = s
        up = new THREE.Vector3().crossVectors(n, s).normalize()
      }
      const baseIndex = acc.vertexCount
      rings[branch.index].push(baseIndex)
      const wind = wind0 + (wind1 - wind0) * Math.pow(clamp01(f.t), windCurve)
      for (let j = 0; j <= Mf; j++) {
        const jm = j % Mf
        const angle = (jm / Mf) * TAU
        const ca = Math.cos(angle)
        const sa = Math.sin(angle)
        let mod = ringModifier(skinBranch, i, angle)
        if (noiseAmp > 0) {
          const w = Math.sin(angle * 3 + noiseSeedA) * 0.5 + Math.sin(f.t * 9 * Math.PI + noiseSeedB) * 0.5
          mod *= 1 + w * noiseAmp
        }
        const rr = Math.max(0.0008, f.radius * mod)
        const nx = side.x * ca * squashX + up.x * sa * squashZ
        const ny = side.y * ca * squashX + up.y * sa * squashZ
        const nz = side.z * ca * squashX + up.z * sa * squashZ
        const nl = Math.hypot(nx, ny, nz) || 1
        const px = f.pos.x + side.x * ca * rr * squashX + up.x * sa * rr * squashZ
        const py = f.pos.y + side.y * ca * rr * squashX + up.y * sa * rr * squashZ
        const pz = f.pos.z + side.z * ca * rr * squashX + up.z * sa * rr * squashZ
        let cr = color.r
        let cg = color.g
        let cb = color.b
        if (color2) {
          cr = color.r + (color2.r - color.r) * f.t
          cg = color.g + (color2.g - color.g) * f.t
          cb = color.b + (color2.b - color.b) * f.t
        }
        if (colorVariance) {
          const v = 1 + (rng ? rng.signed() * colorVariance : Math.sin(angle * 5 + f.t * 20) * colorVariance)
          cr *= v
          cg *= v
          cb *= v
        }
        acc.vertex(
          px, py, pz,
          nx / nl, ny / nl, nz / nl,
          (j / Mf) * uRepeat, arc * uvScaleV,
          clamp01(cr), clamp01(cg), clamp01(cb),
          wind, phase,
          origin.x, origin.y, origin.z,
          grow[0], grow[1],
          slot,
        )
      }
      if (Mf > 2) seamPairs.push([baseIndex + Mf, baseIndex])
    }
  }

  /* ---------- 4. 沿骨架边扫掠蒙皮 (环带), 分叉处跳过窗口 ---------- */
  const windowAt = new Map() // branchIndex -> Map(band -> [window])
  for (const [branchIndex, p] of plan) {
    for (const w of p.windows) {
      if (!windowAt.has(w.parentBranch)) windowAt.set(w.parentBranch, new Map())
      const m = windowAt.get(w.parentBranch)
      if (!m.has(w.band)) m.set(w.band, [])
      m.get(w.band).push(w)
    }
  }

  for (const branch of branchList) {
    const M = ringM[branch.index]
    const ringStart = rings[branch.index]
    const wins = windowAt.get(branch.index)
    for (let b = 0; b < ringStart.length - 1; b++) {
      const a0 = ringStart[b]
      const b0 = ringStart[b + 1]
      const bandWins = wins ? wins.get(b) : null
      for (let j = 0; j < M; j++) {
        if (bandWins) {
          let skipped = false
          for (const w of bandWins) {
            const s = w.start
            if (j >= s && j < s + w.K) { skipped = true; break }
          }
          if (skipped) continue
        }
        // 最后一格用接缝复制顶点 (j2 = M), 不回到 0: 贴图 UV 连续, 不再拉伸
        const j2 = j + 1
        acc.tri(a0 + j, a0 + j2, b0 + j2)
        acc.tri(a0 + j, b0 + j2, b0 + j)
      }
    }
  }

  /* ---------- 5. 分叉节点: 显式环桥接 (窗口边缘环 <-> 子分支根部环) ---------- */
  let bridgeStrips = 0
  let bridgeTriangles = 0
  const bridgeFailed = []
  for (const branch of branchList) {
    const p = plan.get(branch.index)
    for (const w of p.windows) {
      const parentBranch = branchList[w.parentBranch]
      const M = ringM[parentBranch.index]
      const childM = ringM[w.child]
      const ringA = rings[parentBranch.index][w.band]
      const ringB = rings[parentBranch.index][w.band + 1]
      const childRing = rings[w.child][0]
      if (ringA === undefined || ringB === undefined || childRing === undefined) { bridgeFailed.push(w.child); continue }
      const s = w.start
      const K = w.K
      // 删除窗口后, 剩下网格在洞口的边界棱方向 (从被删三角面推出来):
      //   B_s -> A_s -> A_{s+1} -> ... -> A_{s+K} -> B_{s+K} -> B_{s+K-1} -> ... -> B_{s+1}
      // 桥接三角形要沿这些棱同向走, 所以 A 环用这个顺序; 子环按自身自然顺序 (在桥接里反向出现)。
      const rim = []
      rim.push(ringB + s)
      for (let k = 0; k <= K; k++) rim.push(ringA + (s + k))
      rim.push(ringB + (s + K))
      for (let k = K - 1; k >= 1; k--) rim.push(ringB + (s + k))
      const B = []
      for (let j = 0; j < childM; j++) B.push(childRing + j)
      // 旋转子环, 让接缝落在最近的位置 (避免桥接面绕一圈)
      const offset = bestRotation(acc, rim, B, childM)
      const B2 = B.slice(offset).concat(B.slice(0, offset))
      bridgeTriangles += stitchLoops(acc, rim, B2, (u, v) => distanceBetween(acc, u, v))
      bridgeStrips++
    }
  }

  /* ---------- 6. 端盖: 树干基部 + 所有枝梢/根梢 ---------- */
  let caps = 0
  for (const branch of branchList) {
    const M = ringM[branch.index]
    const ringStart = rings[branch.index]
    const r = branch.render
    const frames = skinFrames[branch.index]
    const color = rgb(r.color)
    const color2 = r.color2 ? rgb(r.color2) : null
    const origin = vec3(r.origin, frames[0].pos)
    const phase = r.phase || 0
    const grow = r.grow || [0, 1]
    const slot = branch.slot
    const last = frames.length - 1
    // 基部: 只有整棵树的根(=树干)需要封底; 其他分支基部都桥接到父枝
    if (branch.parent === null || branch.parent === undefined) {
      const f = frames[0]
      const ci = acc.vertex(
        f.pos.x, f.pos.y, f.pos.z,
        -f.dir.x, -f.dir.y, -f.dir.z,
        0, 0,
        clamp01(color.r), clamp01(color.g), clamp01(color.b),
        r.wind0 || 0, phase, origin.x, origin.y, origin.z, grow[0], grow[1], slot,
      )
      const a0 = ringStart[0]
      for (let j = 0; j < M; j++) {
        const j2 = (j + 1) % M
        acc.tri(a0 + j2, a0 + j, ci)
      }
      caps++
    }
    // 末梢: 所有分支/树根都以三角扇收口
    {
      const f = frames[last]
      const cc = color2 || color
      const ci = acc.vertex(
        f.pos.x, f.pos.y, f.pos.z,
        f.dir.x, f.dir.y, f.dir.z,
        0, 0,
        clamp01(cc.r), clamp01(cc.g), clamp01(cc.b),
        r.wind1 === undefined ? 1 : r.wind1, phase, origin.x, origin.y, origin.z, grow[0], grow[1], slot,
      )
      const b0 = ringStart[last]
      for (let j = 0; j < M; j++) {
        const j2 = (j + 1) % M
        acc.tri(b0 + j, b0 + j2, ci)
      }
      caps++
    }
  }

  const geometry = acc.build()
  // 接缝顶点对 (复制顶点 -> 原顶点): 渲染用 UV 缝, 拓扑校验时焊回
  if (seamPairs.length) geometry.userData.seamPairs = seamPairs
  const stats = {
    skeletonBranches: branchList.length,
    skeletonNodes: skeleton.nodes.length,
    skeletonEdges: skeleton.edges.length,
    bridgeStrips,
    bridgeTriangles,
    caps,
    expectedWindows,
    plannedWindows,
    failedWindows: missingWindows + bridgeFailed.length,
    radialByBranch: ringM,
    triangles: acc.triangleCount,
    vertices: acc.vertexCount,
  }
  let validation = null
  if (opts.validate !== false) {
    validation = validateSkin(geometry, branchList)
    validation.failedWindows = stats.failedWindows
    if (stats.failedWindows > 0) validation.ok = false
    stats.validation = validation
  }
  if (stats.failedWindows > 0) {
    console.warn('[FastTree] 骨架蒙皮有子分支未完成窗口桥接:', stats.failedWindows,
      `(expected ${expectedWindows}, planned ${plannedWindows}, bridgeErrors ${bridgeFailed.length})`)
  }
  const debug = opts.debug ? {
    plan,
    attachOf,
    skinFrameCount: skinFrames.map((f) => f.length),
    skinFrames,
  } : null
  return { geometry, stats, validation, rings, ringM, debug }
}

function bestRotation(acc, rim, childRing, childM) {
  if (childM <= 1) return 0
  const pos = acc.position
  const ax = pos[rim[0] * 3]
  const ay = pos[rim[0] * 3 + 1]
  const az = pos[rim[0] * 3 + 2]
  let best = 0
  let bestD = Infinity
  for (let k = 0; k < childM; k++) {
    const idx = childRing[k]
    const dx = pos[idx * 3] - ax
    const dy = pos[idx * 3 + 1] - ay
    const dz = pos[idx * 3 + 2] - az
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestD) { bestD = d; best = k }
  }
  return best
}

function distanceBetween(acc, ia, ib) {
  const p = acc.position
  const dx = p[ia * 3] - p[ib * 3]
  const dy = p[ia * 3 + 1] - p[ib * 3 + 1]
  const dz = p[ia * 3 + 2] - p[ib * 3 + 2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
}
