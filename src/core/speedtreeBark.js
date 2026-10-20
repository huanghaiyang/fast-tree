/**
 * SpeedTree 风格树皮: 分枝管 + 基部领口 + 重叠 (不做父枝开窗)
 * ------------------------------------------------------------
 * 与 barkSkin.js 的区别:
 *   - 每根枝条是一根独立的闭合管, 基部向父枝内部延伸一小段并加一圈外扩领口;
 *   - 不在父枝上切窗口, 也不做 rim->child 的 zipper 桥接;
 *   - 父枝/子枝靠几何重叠 + 领口遮缝 (大量实时树资产的常见做法);
 *   - 因此没有"窗口中心 vs 子枝中心"的量化偏移, 但整张树皮不再是单连通体,
 *     而是每根骨架分支一个闭合分量 (components = branches)。
 *
 * 旧 barkSkin 管线原样保留, 由 params.bark.pipeline 选择:
 *   'skin'      = 原来的单张 2-manifold 蒙皮
 *   'speedtree' = 本文件
 */

import * as THREE from 'three'
import { GeoAcc, anyPerp, clamp01 } from './mathUtils.js'
import { analyzeTopology, branchSkinCoverage } from './meshTopology.js'

const TAU = Math.PI * 2

function rgb(c, fallback) {
  if (c && c.isColor) return { r: c.r, g: c.g, b: c.b }
  if (Array.isArray(c)) return { r: c[0] || 0, g: c[1] || 0, b: c[2] || 0 }
  return fallback
}

function smooth01(x) {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

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
      side.addScaledVector(f.dir, -side.dot(f.dir))
      if (side.lengthSq() < 1e-10) anyPerp(f.dir, side)
      side.normalize()
    }
    const up = new THREE.Vector3().crossVectors(f.dir, side).normalize()
    bases.push({ side: side.clone(), up })
  }
  return bases
}

/** 非领口环的半径 (含截面/领口/收尖/半径回调) */

/**
 * 生成一根枝条的管体帧: 子枝/树根在基部向父枝内部多插 2 圈领口。
 * 第 0 圈是藏在父枝内部的封口, 第 1 圈是外扩领口, 然后接骨架原帧。
 */
function tubeFrames(branch) {
  const frames = branch.frames
  const f0 = frames[0]
  if (branch.parent === null || branch.parent === undefined) {
    return { frames, virtualCount: 0 }
  }
  const r0 = Math.max(0.001, f0.radius)
  const embed = r0 * 1.25
  const back = f0.pos.clone().addScaledVector(f0.dir, -embed)
  const mid = f0.pos.clone().addScaledVector(f0.dir, -embed * 0.45)
  const collar = {
    ...f0,
    pos: back,
    radius: r0 * 1.38,
    t: 0,
  }
  const collar2 = {
    ...f0,
    pos: mid,
    radius: r0 * 1.14,
    t: 0,
  }
  return { frames: [collar, collar2, ...frames], virtualCount: 2 }
}

function ringModifier(branch, f, angle) {
  const r = branch.render
  let mod = 1
  const cs = r.crossSection || 'round'
  if (cs === 'star') {
    mod *= 1 - (r.starDepth || 0) * (0.5 + 0.5 * Math.cos(angle * (r.starPoints || 6)))
  } else if (cs === 'square') {
    mod *= 1 / Math.max(0.62, Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))))
  }
  if (r.radiusModifier) mod *= r.radiusModifier(f.t, angle, f.radius)
  const bf = r.baseFlare || 0
  if (bf > 0) {
    const u = clamp01(f.t / Math.max(1e-4, r.baseFlareLen === undefined ? 0.14 : r.baseFlareLen))
    mod *= 1 + bf * (1 - smooth01(u))
  }
  const tr = r.tipRound || 0
  if (tr > 0) {
    const u = clamp01((f.t - (1 - tr)) / Math.max(1e-4, tr))
    if (u > 0) mod *= Math.sqrt(Math.max(1e-4, 1 - u * u))
  }
  return mod
}

export function buildSpeedtreeBark(skeleton, opts = {}) {
  const barkDetail = opts.barkDetail === undefined ? 1 : opts.barkDetail
  const branches = skeleton.branches
  const acc = new GeoAcc()
  const seamPairs = []
  const radialByBranch = []
  let caps = 0

  for (const branch of branches) {
    const r = branch.render || {}
    const tf = tubeFrames(branch)
    const frames = tf.frames
    const virtualCount = tf.virtualCount
    const bases = buildRingBases(frames)
    const M = Math.max(3, Math.min(48, Math.round((r.radialSegments === undefined ? 8 : r.radialSegments) * barkDetail)))
    radialByBranch.push(M)
    const color = rgb(r.color, { r: 0.75, g: 0.68, b: 0.6 })
    const color2 = rgb(r.color2, color)
    const squashX = r.squashX === undefined ? 1 : r.squashX
    const squashZ = r.squashZ === undefined ? 1 : r.squashZ
    const uvScaleV = r.uvScaleV === undefined ? 1 : r.uvScaleV
    const uvScaleU = r.uvScaleU === undefined ? 1 : r.uvScaleU
    const wind0 = r.wind0 || 0
    const wind1 = r.wind1 === undefined ? 1 : r.wind1
    const windCurve = r.windCurve || 1.4
    const grow = r.grow || [0, 1]
    const origin = r.origin || branch.frames[0].pos
    const phase = r.phase || 0
    const slot = branch.slot

    let sumR = 0
    for (const f of frames) sumR += f.radius
    const avgR = sumR / frames.length
    const uRepeat = Math.max(1, Math.min(24, Math.round(TAU * avgR * uvScaleU)))

    const ringStarts = []
    let arc = 0
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      if (i > 0) arc += f.pos.distanceTo(frames[i - 1].pos)
      const basis = bases[i]
      const baseIndex = acc.vertexCount
      ringStarts.push(baseIndex)
      // 领口环: 用显式半径; 原帧: 正常半径调制
      const isVirtual = i < virtualCount
      const rr = isVirtual ? f.radius : Math.max(0.0005, f.radius * ringModifier(branch, f, 0))
      const wind = wind0 + (wind1 - wind0) * Math.pow(clamp01(f.t), windCurve)
      const tt = clamp01(f.t)
      const cr = color.r + (color2.r - color.r) * smooth01(tt)
      const cg = color.g + (color2.g - color.g) * smooth01(tt)
      const cb = color.b + (color2.b - color.b) * smooth01(tt)
      for (let j = 0; j <= M; j++) {
        const jm = j % M
        const angle = (jm / M) * TAU
        const ca = Math.cos(angle)
        const sa = Math.sin(angle)
        const rad = isVirtual
          ? rr
          : Math.max(0.0005, f.radius * ringModifier(branch, f, angle))
        const px = f.pos.x + basis.side.x * ca * rad * squashX + basis.up.x * sa * rad * squashZ
        const py = f.pos.y + basis.side.y * ca * rad * squashX + basis.up.y * sa * rad * squashZ
        const pz = f.pos.z + basis.side.z * ca * rad * squashX + basis.up.z * sa * rad * squashZ
        let nx = basis.side.x * ca / Math.max(1e-4, squashX) + basis.up.x * sa / Math.max(1e-4, squashZ)
        let ny = basis.side.y * ca / Math.max(1e-4, squashX) + basis.up.y * sa / Math.max(1e-4, squashZ)
        let nz = basis.side.z * ca / Math.max(1e-4, squashX) + basis.up.z * sa / Math.max(1e-4, squashZ)
        const nl = Math.hypot(nx, ny, nz) || 1
        nx /= nl; ny /= nl; nz /= nl
        acc.vertex(
          px, py, pz, nx, ny, nz,
          (j / M) * uRepeat, arc * uvScaleV,
          cr, cg, cb, wind, phase,
          origin.x, origin.y, origin.z, grow[0], grow[1], slot,
        )
      }
      seamPairs.push([baseIndex + M, baseIndex])
    }

    // 侧壁: 每格用接缝复制顶点 (最后一格 j=M-1 -> M)
    for (let i = 0; i < frames.length - 1; i++) {
      const a = ringStarts[i]
      const b = ringStarts[i + 1]
      for (let j = 0; j < M; j++) {
        const j2 = j + 1
        acc.tri(a + j, a + j2, b + j2)
        acc.tri(a + j, b + j2, b + j)
      }
    }

    // 两端封口 (基部封口藏在父枝内部; 树梢封口)
    {
      const f = frames[0]
      const ci = acc.vertex(
        f.pos.x, f.pos.y, f.pos.z,
        -f.dir.x, -f.dir.y, -f.dir.z,
        0, 0, color.r, color.g, color.b,
        wind0, phase, origin.x, origin.y, origin.z, grow[0], grow[1], slot,
      )
      const a0 = ringStarts[0]
      for (let j = 0; j < M; j++) acc.tri(a0 + ((j + 1) % M), a0 + j, ci)
      caps++
    }
    {
      const last = frames.length - 1
      const f = frames[last]
      const ci = acc.vertex(
        f.pos.x, f.pos.y, f.pos.z,
        f.dir.x, f.dir.y, f.dir.z,
        0, 0, color2.r, color2.g, color2.b,
        r.wind1 === undefined ? 1 : r.wind1, phase, origin.x, origin.y, origin.z, grow[0], grow[1], slot,
      )
      const b0 = ringStarts[last]
      for (let j = 0; j < M; j++) acc.tri(b0 + j, b0 + ((j + 1) % M), ci)
      caps++
    }
  }

  const geometry = acc.build()
  if (seamPairs.length) geometry.userData.seamPairs = seamPairs

  const stats = {
    mode: 'speedtree',
    skeletonBranches: branches.length,
    skeletonNodes: skeleton.nodes.length,
    skeletonEdges: skeleton.edges.length,
    bridgeStrips: 0,
    bridgeTriangles: 0,
    caps,
    expectedWindows: 0,
    plannedWindows: 0,
    failedWindows: 0,
    radialByBranch,
    triangles: acc.triangleCount,
    vertices: acc.vertexCount,
    componentsExpected: branches.length,
  }

  let validation = null
  if (opts.validate !== false) {
    const weldPairs = geometry.userData.seamPairs
    const topo = analyzeTopology(geometry, { weldPairs })
    const coverage = branchSkinCoverage(geometry, branches)
    const ok = topo.boundary === 0 && topo.nonManifold === 0 && topo.nonManifoldVertices === 0 &&
      topo.components === branches.length && coverage.missing.length === 0
    validation = {
      ...topo,
      ...coverage,
      missingBranches: coverage.missing,
      expectedComponents: branches.length,
      failedWindows: 0,
      mode: 'speedtree',
      ok,
    }
    stats.validation = validation
  }

  return {
    geometry,
    stats,
    validation,
    rings: null,
    ringM: radialByBranch,
    debug: { mode: 'speedtree' },
  }
}
