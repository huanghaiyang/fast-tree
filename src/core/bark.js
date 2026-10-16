/**
 * 树皮 (树干/树枝/树根) 的管状几何生成
 * ------------------------------------------------------------
 * - 平行移动坐标系 (parallel transport): 弯曲枝条不会出现拧麻花
 * - 交叉截面: round / star (菱形凹凸) / square
 * - 椭圆化 squash
 * - 根部外扩 flare + 节瘤 knots: 通过 radiusModifier 回调对半径做调制
 * - UV: 周向重复次数由平均半径决定 (整条枝条统一, 无接缝); 纵向按弧长
 */
import * as THREE from 'three'
import { GeoAcc, anyPerp, clamp01 } from './mathUtils.js'

export function buildTube(frames, o = {}) {
  const acc = new GeoAcc()
  if (!frames || frames.length < 2) return acc.build()

  const radialSegments = Math.max(3, Math.round(o.radialSegments || 8))
  const crossSection = o.crossSection || 'round'
  const starDepth = o.starDepth || 0
  const starPoints = o.starPoints || 6
  const squashX = o.squashX === undefined ? 1 : o.squashX
  const squashZ = o.squashZ === undefined ? 1 : o.squashZ
  const color = o.color || new THREE.Color(1, 1, 1)
  const color2 = o.color2 || null
  const colorVariance = o.colorVariance || 0
  const rng = o.rng || null
  const wind0 = o.wind0 || 0
  const wind1 = o.wind1 === undefined ? 1 : o.wind1
  const windCurve = o.windCurve || 1.4
  const grow = o.grow || [0, 1]
  const origin = o.origin || new THREE.Vector3()
  const phase = o.phase || 0
  const uvScaleV = o.uvScaleV === undefined ? 1 : o.uvScaleV
  const uvScaleU = o.uvScaleU === undefined ? 1 : o.uvScaleU
  const radiusModifier = o.radiusModifier || null
  const capStart = !!o.capStart
  const capEnd = !!o.capEnd
  const nodeId = o.nodeId === undefined ? 0 : o.nodeId
  // 枝条基部"圆角/领口": 让枝条与父枝融合而不是硬插进去 (消除大半径/小半径硬拼接)
  const baseFlare = o.baseFlare === undefined ? 0 : o.baseFlare
  const baseFlareLen = o.baseFlareLen === undefined ? 0.14 : o.baseFlareLen
  // 末梢收尖: 让枝条以圆钝的尖端闭合, 而不是留下一个平截面
  const tipRound = o.tipRound === undefined ? 0 : o.tipRound

  // 周向贴图重复次数: 由平均半径决定, 整条枝条保持一致 -> 无接缝
  let sumR = 0
  for (const f of frames) sumR += f.radius
  const avgR = sumR / frames.length
  const uRepeat = Math.max(1, Math.min(24, Math.round(2 * Math.PI * avgR * uvScaleU)))

  const rings = []
  const side = anyPerp(frames[0].dir)
  const up = new THREE.Vector3()
  const nrm = new THREE.Vector3()
  const radial = new THREE.Vector3()
  let arc = 0
  // 低频/高频顶点噪声, 让树皮轮廓不是完美光滑
  const noiseAmp = o.vertexNoise === undefined ? 0.035 : o.vertexNoise
  let noiseSeedA = rng ? rng.range(0, 100) : 0
  let noiseSeedB = rng ? rng.range(0, 100) : 0

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (i > 0) arc += f.pos.distanceTo(frames[i - 1].pos)

    // --- 平行移动 + 显式扭转 ---
    side.addScaledVector(f.dir, -side.dot(f.dir))
    if (side.lengthSq() < 1e-10) anyPerp(f.dir, side)
    side.normalize()
    const rollDelta = i === 0 ? f.roll || 0 : (f.roll || 0) - (frames[i - 1].roll || 0)
    if (rollDelta) side.applyAxisAngle(f.dir, rollDelta)
    // 再正交化一次, 避免数值漂移
    side.addScaledVector(f.dir, -side.dot(f.dir)).normalize()
    up.crossVectors(f.dir, side).normalize()

    const baseIndex = acc.vertexCount
    rings.push(baseIndex)

    for (let j = 0; j < radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      let mod = 1
      if (crossSection === 'star') mod *= 1 - starDepth * (0.5 + 0.5 * Math.cos(a * starPoints))
      else if (crossSection === 'square') mod *= 1 / Math.max(0.62, Math.max(Math.abs(ca), Math.abs(sa)))
      if (radiusModifier) mod *= radiusModifier(f.t, a, f.radius)
      // 基部领口: 平滑衰减的加粗 (C1 连续, 不会有台阶)
      if (baseFlare > 0) {
        const u = Math.min(1, Math.max(0, f.t / Math.max(1e-4, baseFlareLen)))
        const s = 1 - u * u * (3 - 2 * u)   // smoothstep
        mod *= 1 + baseFlare * s
      }
      // 末梢圆钝收尖: 最后一段按 1 - u^2 收缩
      if (tipRound > 0) {
        const u = Math.min(1, Math.max(0, (f.t - (1 - tipRound)) / Math.max(1e-4, tipRound)))
        if (u > 0) mod *= Math.sqrt(Math.max(0.0001, 1 - u * u))
      }

      // 顶点噪声: 沿周向/纵向的低频扰动
      if (noiseAmp > 0) {
        const w = Math.sin(a * 3 + noiseSeedA) * 0.5 + Math.sin(f.t * 9 * Math.PI + noiseSeedB) * 0.5
        mod *= 1 + w * noiseAmp
      }

      const rr = Math.max(0.0008, f.radius * mod)
      radial.set(side.x * ca * squashX + up.x * sa * squashZ,
        side.y * ca * squashX + up.y * sa * squashZ,
        side.z * ca * squashX + up.z * sa * squashZ)
      nrm.copy(radial).normalize()
      const px = f.pos.x + side.x * ca * rr * squashX + up.x * sa * rr * squashZ
      const py = f.pos.y + side.y * ca * rr * squashX + up.y * sa * rr * squashZ
      const pz = f.pos.z + side.z * ca * rr * squashX + up.z * sa * rr * squashZ

      // --- 顶点颜色 (调制量, 与材质颜色相乘) ---
      let cr = color.r
      let cg = color.g
      let cb = color.b
      if (color2) {
        cr = color.r + (color2.r - color.r) * f.t
        cg = color.g + (color2.g - color.g) * f.t
        cb = color.b + (color2.b - color.b) * f.t
      }
      if (colorVariance) {
        const v = 1 + (rng ? rng.signed() * colorVariance : Math.sin(a * 5 + f.t * 20) * colorVariance)
        cr *= v
        cg *= v
        cb *= v
      }

      const t = f.t
      const wind = wind0 + (wind1 - wind0) * Math.pow(t, windCurve)
      acc.vertex(
        px, py, pz,
        nrm.x, nrm.y, nrm.z,
        (j / radialSegments) * uRepeat, arc * uvScaleV,
        clamp01(cr), clamp01(cg), clamp01(cb),
        wind, phase,
        origin.x, origin.y, origin.z,
        grow[0], grow[1],
        nodeId,
      )
    }
  }

  // --- 连接相邻环 ---
  for (let i = 1; i < frames.length; i++) {
    const a0 = rings[i - 1]
    const b0 = rings[i]
    for (let j = 0; j < radialSegments; j++) {
      const j2 = (j + 1) % radialSegments
      acc.tri(a0 + j, a0 + j2, b0 + j2)
      acc.tri(a0 + j, b0 + j2, b0 + j)
    }
  }

  const last = frames[frames.length - 1]
  // --- 端盖 ---
  if (capStart) {
    const f = frames[0]
    const c = acc.vertex(
      f.pos.x, f.pos.y, f.pos.z,
      -f.dir.x, -f.dir.y, -f.dir.z,
      0, 0,
      clamp01(color.r), clamp01(color.g), clamp01(color.b),
      wind0, phase, origin.x, origin.y, origin.z, grow[0], grow[1],
    )
    const b0 = rings[0]
    for (let j = 0; j < radialSegments; j++) {
      const j2 = (j + 1) % radialSegments
      acc.tri(c, b0 + j2, b0 + j)
    }
  }
  if (capEnd) {
    const c = acc.vertex(
      last.pos.x, last.pos.y, last.pos.z,
      last.dir.x, last.dir.y, last.dir.z,
      0, arc * uvScaleV,
      clamp01(color2 ? color2.r : color.r), clamp01(color2 ? color2.g : color.g), clamp01(color2 ? color2.b : color.b),
      wind1, phase, origin.x, origin.y, origin.z, grow[0], grow[1], nodeId,
    )
    const b0 = rings[frames.length - 1]
    for (let j = 0; j < radialSegments; j++) {
      const j2 = (j + 1) % radialSegments
      acc.tri(c, b0 + j, b0 + j2)
    }
  }

  return acc.build()
}
