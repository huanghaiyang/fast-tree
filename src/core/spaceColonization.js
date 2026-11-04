/**
 * 空间殖民算法 (Space Colonization Algorithm, SCA) 宽冠生成器
 * ------------------------------------------------------------
 * 作用: 在树干上半段生成"超宽横展、扭曲穿插成网状"的冠枝骨架, 供 treeBuilder
 *       登记进现有 barkSkeleton, 复用蒙皮/叶片/节点/风场管线。
 * 输入 / 输出: 输入是完整参数树 + 随机子流 + 树干骨架帧; 输出是一组"折线链":
 *       { points, radii, parentChain, level, tip }
 *       每条链是一根从树干(或父链)长出的枝条, parentChain=-1 表示挂在树干上。
 * 与其他模块的关系: treeBuilder 调用本模块 -> 用 points/radii 生成 frames ->
 *       addBarkBranch / spawnLeaves。本模块不接触 THREE 之外的项目内部状态。
 * 关键概念 / 约定:
 *   - 吸引点: 在压扁的椭球树冠里撒点, 枝条朝最近的吸引点生长, 到达后消耗该点。
 *   - 分叉: 每步按 branchiness 概率复制一条子链, 子链与父链共享起点。
 *   - 碰撞避让: 已占用线段做空间哈希, 新步若太靠近已有枝条就尝试左右偏转;
 *     全部失败则停止该梢 (避免枝条粗暴穿插)。
 *   - 确定性: 所有随机量都走传入的 rng 子流, 同一 seed 必得同一冠形。
 */

import * as THREE from 'three'
import { clamp01, lerp, sampleFrame } from './mathUtils.js'

/**
 * 把吸引点撒进一个压扁的椭球树冠。
 *
 * 用 cbrt 做体积均匀采样: 直接在 r 上均匀会往球心扎堆, 枝条会挤向中央;
 * 立方根把半径分布拉向壳层, 冠形更接近真实阔叶树"外密内疏"的观感。
 *
 * @param {object} rng 随机子流
 * @param {number} count 吸引点数量
 * @param {THREE.Vector3} center 冠中心
 * @param {number} rx 水平半轴 (X)
 * @param {number} ry 垂直半轴 (Y)
 * @param {number} rz 水平半轴 (Z)
 * @param {number} minY 最低高度 (防止吸引点钻到地面以下)
 * @returns {Array<{pos: THREE.Vector3, alive: boolean}>} 吸引点数组
 */
function scatterAttractors(rng, count, center, rx, ry, rz, minY) {
  const list = []
  for (let i = 0; i < count; i++) {
    // 球面方向: 经典 u/v 采样, 保证方向均匀 (不依赖高斯, 便于复现)
    const u = rng.range(-1, 1)
    const phi = rng.range(0, Math.PI * 2)
    const s = Math.sqrt(Math.max(0, 1 - u * u))
    // 半径偏向壳层: 0.55 + 0.45·cbrt(rand) —— 保留少量内部点做"内腔枝条"
    const r = 0.55 + 0.45 * Math.cbrt(rng.next())
    const x = center.x + s * Math.cos(phi) * rx * r
    const y = center.y + u * ry * r
    const z = center.z + s * Math.sin(phi) * rz * r
    list.push({
      pos: new THREE.Vector3(x, Math.max(minY, y), z),
      alive: true,
    })
  }
  return list
}

/**
 * 线段空间哈希: 把已生成的枝条线段按格子登记, 用于"新枝条不要穿过旧枝条"的避让。
 *
 * 格子边长取避让距离本身, 查询时只扫 3×3×3 邻域, 复杂度接近 O(1)。
 * 只有真正被接受的线段才写入 (被拒绝的试探步不污染哈希)。
 */
function createCollisionGrid(cell) {
  const map = new Map()
  const key = (x, y, z) => `${x},${y},${z}`
  const cellOf = (v) => Math.floor(v / cell)

  const insert = (a, b, owner) => {
    // 只登记线段中点: 步长远小于格子, 中点足够代表整段
    const mx = (a.x + b.x) * 0.5
    const my = (a.y + b.y) * 0.5
    const mz = (a.z + b.z) * 0.5
    const k = key(cellOf(mx), cellOf(my), cellOf(mz))
    let arr = map.get(k)
    if (!arr) { arr = []; map.set(k, arr) }
    arr.push({ x: mx, y: my, z: mz, a, b, owner })
  }

  /**
   * 查询点附近 minDist 内是否已有线段。
   * ownerChain/ownerParent 用于跳过"自己"与"父链": 生长中的梢天然会紧贴自己上一段,
   * 不跳过会把整条枝判成碰撞而原地停死。
   */
  const nearby = (p, minDist, ownerChain, ownerParent) => {
    const cx = cellOf(p.x), cy = cellOf(p.y), cz = cellOf(p.z)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = map.get(key(cx + dx, cy + dy, cz + dz))
          if (!arr) continue
          for (const seg of arr) {
            if (seg.owner === ownerChain || seg.owner === ownerParent) continue
            const ddx = p.x - seg.x, ddy = p.y - seg.y, ddz = p.z - seg.z
            if (ddx * ddx + ddy * ddy + ddz * ddz < minDist * minDist) return true
          }
        }
      }
    }
    return false
  }

  return { insert, nearby }
}

/**
 * 生成空间殖民冠枝。
 *
 * @param {object} P 完整参数树 (读 P.branches.sca / P.trunk / P.leaves)
 * @param {object} rng 本模块专属随机子流 (由 treeBuilder 用 makeRng(seed,'sca') 创建)
 * @param {Array<Object>} trunkFrames 树干骨架帧 (归一化 t, 用于取发枝点)
 * @returns {{chains: Array<Object>, stats: Object}} 折线链与统计
 */
export function growSpaceColonization(P, rng, trunkFrames) {
  const A = (P.branches && P.branches.sca) || {}
  const H = Math.max(0.2, (P.trunk && P.trunk.height) || 9)
  const width = H * (A.crownWidth === undefined ? 1.35 : A.crownWidth)
  const crownH = H * (A.crownHeight === undefined ? 0.5 : A.crownHeight)
  const startT = clamp01(A.startT === undefined ? 0.52 : A.startT)
  const stepLen = H * Math.max(0.008, A.step === undefined ? 0.045 : A.step)
  const killR = H * Math.max(0.01, A.killRadius === undefined ? 0.16 : A.killRadius)
  const branchiness = clamp01(A.branchiness === undefined ? 0.35 : A.branchiness)
  const maxBranches = Math.max(4, Math.round(A.maxBranches === undefined ? 90 : A.maxBranches))
  const droop = clamp01(A.droop === undefined ? 0.22 : A.droop)
  const wander = clamp01(A.wander === undefined ? 0.28 : A.wander)
  const collisionDist = H * Math.max(0, A.collision === undefined ? 0.16 : A.collision)
  const taper = Math.max(0.05, A.taper === undefined ? 0.18 : A.taper)
  const radiusScale = Math.max(0.05, A.radiusScale === undefined ? 0.42 : A.radiusScale)
  const attractorCount = Math.max(12, Math.round(A.attractors === undefined ? 140 : A.attractors))

  const baseFrame = sampleFrame(trunkFrames, startT) || sampleFrame(trunkFrames, 1)
  if (!baseFrame) return { chains: [], stats: { branches: 0, attractors: 0 } }

  const trunkRadius = Math.max(0.002, baseFrame.radius)
  // 冠中心 = 发枝点上方 0.35 × 冠高, 并略微下压 —— 榕树是"横展低冠"而不是尖塔。
  const center = baseFrame.pos.clone().add(new THREE.Vector3(0, crownH * 0.38 - H * (A.crownDrop || 0), 0))
  const minY = Math.max(0.2, H * 0.18)
  const attractors = scatterAttractors(rng, attractorCount, center, width * 0.5, crownH * 0.5, width * 0.5, minY)
  const grid = createCollisionGrid(Math.max(0.05, collisionDist || stepLen * 2))

  // ---- 发枝种子: 沿树干上半段分布 5~7 条主冠枝, 方位均分 + 抖动 ----
  // 种子数不直接暴露为参数 (由 crownWidth 驱动): 冠越宽, 起始主枝越多。
  const seedCount = Math.max(4, Math.min(8, Math.round(4 + width / Math.max(1, H) * 1.6)))
  const chains = []
  const tips = []
  for (let i = 0; i < seedCount; i++) {
    const t = Math.min(0.96, startT + 0.06 + (i / Math.max(1, seedCount - 1)) * 0.18)
    const fr = sampleFrame(trunkFrames, t) || baseFrame
    const az = (i / seedCount) * Math.PI * 2 + rng.range(-0.25, 0.25)
    // 侧枝方向 = 树干轴向绕"水平轴"压开 55°~75°, 形成横展骨架
    const radial = new THREE.Vector3(Math.cos(az), 0, Math.sin(az))
    const axis = new THREE.Vector3().crossVectors(radial, fr.dir)
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0)
    axis.normalize()
    const dir = fr.dir.clone().applyAxisAngle(axis, rng.range(0.85, 1.25))
    // 压开方向: 用水平径向分量兜底, 避免和树干平行
    if (Math.abs(dir.dot(fr.dir)) > 0.92) dir.copy(radial).addScaledVector(fr.dir, 0.35).normalize()
    dir.addScaledVector(radial, 0.35).normalize()

    const startPos = fr.pos.clone().addScaledVector(radial, Math.max(0.002, fr.radius) * 0.9)
    const baseR = Math.max(0.0015, fr.radius * radiusScale * rng.vary(0.18))
    const chain = {
      points: [startPos.clone()],
      radii: [baseR],
      baseR,
      parentChain: -1,
      level: 1,
      tip: false,
      startT: t,
      dead: false,
    }
    chains.push(chain)
    tips.push({ chain: chains.length - 1, pos: startPos.clone(), dir, lastSeg: null })
  }
  // 种子发枝点不写入碰撞网格: 它们都在树干表面, 若登记会让每个梢的第一步
  // 就和自己刚登记的桩段"撞上", 整棵冠直接死在起跑线。树干本身由蒙皮负责避让。

  // ---- 迭代生长 ----
  // 步数上限 = 吸引点数量的 2.5 倍: 既够消耗完冠体积, 又不会在异常参数下无限跑。
  const maxSteps = Math.min(600, Math.round(attractorCount * 2.5))
  let steps = 0
  let alive = tips.length
  const tmpDir = new THREE.Vector3()
  const tmpPos = new THREE.Vector3()

  for (let step = 0; step < maxSteps && alive > 0 && chains.length < maxBranches; step++) {
    alive = 0
    // 每步遍历当前所有梢; 新增梢在下一轮才生长 (顺序稳定, 结果可复现)
    const nTips = tips.length
    for (let ti = 0; ti < nTips; ti++) {
      const tip = tips[ti]
      if (!tip || tip.dead) continue
      const chain = chains[tip.chain]
      if (!chain) continue

      // 最近存活吸引点
      let best = null
      let bestD = Infinity
      for (const a of attractors) {
        if (!a.alive) continue
        const d = tip.pos.distanceToSquared(a.pos)
        // 影响半径: 冠半宽 × 1.1; 超出影响范围的吸引点不参与, 让枝条先向外铺
        if (d < bestD && d < width * width * 1.3) {
          bestD = d
          best = a
        }
      }
      if (!best) { tip.dead = true; chain.tip = true; continue }

      // 目标方向 = 指向吸引点 + 下垂 + 连续噪声扰动 (wander)
      const toAttr = best.pos.clone().sub(tip.pos)
      const dist = toAttr.length()
      if (dist < 1e-4) { best.alive = false; alive++; continue }
      toAttr.normalize()
      tmpDir.copy(toAttr)
      tmpDir.y -= droop * 0.55
      // 噪声: 用枝条链序号做相位, 保证同一枝条的摆动连续
      const wob = Math.sin((step + ti) * 0.7 + chain.baseR * 97) * wander
      tmpDir.x += wob * 0.35
      tmpDir.z += Math.cos((step + ti) * 0.55 + chain.baseR * 51) * wander * 0.35
      tmpDir.normalize()

      // 碰撞避让: 直线走不通就左右各试 45°/90°; 全失败则该梢停止 (变成叶梢)
      let moved = false
      let chosen = null
      if (!collisionDist || !grid.nearby(tip.pos, collisionDist, tip.chain, chain.parentChain)) {
        chosen = tmpDir.clone()
        moved = true
      } else {
        // 绕 Y 轴左右偏转, 仍带一点原方向, 避免完全横着走
        for (const ang of [0.8, -0.8, 1.5, -1.5]) {
          const cand = tmpDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang)
          cand.y += 0.15 * Math.sign(ang)
          cand.normalize()
          tmpPos.copy(tip.pos).addScaledVector(cand, stepLen)
          if (!grid.nearby(tmpPos, collisionDist, tip.chain, chain.parentChain)) {
            chosen = cand
            moved = true
            break
          }
        }
      }
      if (!moved) { tip.dead = true; chain.tip = true; continue }

      tmpPos.copy(tip.pos).addScaledVector(chosen, stepLen)
      // 不允许冠枝钻到地面以下
      if (tmpPos.y < minY * 0.6) { tip.dead = true; chain.tip = true; continue }

      // 接受该步: 写链、登记碰撞、消耗附近吸引点
      const seg = { a: tip.pos.clone(), b: tmpPos.clone() }
      chain.points.push(tmpPos.clone())
      chain.radii.push(chain.baseR)
      grid.insert(seg.a, seg.b, tip.chain)
      tip.lastSeg = seg
      tip.pos.copy(tmpPos)
      tip.dir.copy(chosen)
      alive++

      for (const a of attractors) {
        if (a.alive && a.pos.distanceToSquared(tmpPos) < killR * killR) a.alive = false
      }

      // 分叉: 只有还有预算时才分, 子链继承当前位置与较细的基部半径
      if (rng.chance(branchiness) && chains.length < maxBranches && chain.points.length > 3) {
        steps++
        const lateral = new THREE.Vector3(0, 1, 0)
        const axis = chosen.clone().cross(lateral)
        if (axis.lengthSq() < 1e-6) axis.set(0, 0, 1)
        axis.normalize()
        const cd = chosen.clone().applyAxisAngle(axis, rng.range(0.45, 1.0) * (rng.chance(0.5) ? 1 : -1))
        cd.y += droop * 0.15
        cd.normalize()
        const childR = Math.max(0.0008, (chain.radii[chain.radii.length - 1] || chain.baseR) * 0.62)
        const child = {
          points: [tmpPos.clone()],
          radii: [childR],
          baseR: childR,
          parentChain: tip.chain,
          level: Math.min(5, chain.level + 1),
          tip: false,
          startT: startT,
          dead: false,
        }
        chains.push(child)
        tips.push({ chain: chains.length - 1, pos: tmpPos.clone(), dir: cd, lastSeg: null })
      }
    }
  }
  // 结束时仍存活的梢也是"叶梢"; 每条链只保留一条 tip 标记
  for (const tip of tips) if (!tip.dead) chains[tip.chain].tip = true

  // ---- 半径收细: 每条链从 baseR 到 baseR×taper ----
  for (const c of chains) {
    const n = c.points.length
    if (n < 2) continue
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1)
      c.radii[i] = Math.max(0.0006, c.baseR * lerp(1, taper, k))
    }
  }

  // 丢弃点数过少的链 (只剩一个点的分叉没有几何意义)
  const kept = []
  const remap = new Map()
  for (const c of chains) {
    if (c.points.length < 2) continue
    const my = kept.length
    remap.set(c, my)
    kept.push(c)
  }
  for (const c of kept) {
    const pc = c.parentChain >= 0 ? chains[c.parentChain] : -1
    c.parentChain = pc >= 0 && remap.has(pc) ? remap.get(pc) : -1
  }

  return {
    chains: kept,
    stats: {
      branches: kept.length,
      attractors: attractorCount,
      steps,
      tips: kept.filter((c) => c.tip).length,
    },
  }
}
