/**
 * 主生成器: 参数 -> 两个合并后的几何体 (树皮 + 树叶)
 * ------------------------------------------------------------
 * 递归生长模型:
 *   树干(level 0) -> 树枝(level 1..N) -> 树叶
 * 每个阶段使用独立随机子流, 因此"调树叶"不会挪动树干。
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeRng } from './rng.js'
import { buildTube } from './bark.js'
import { buildLeafTemplate, pushLeafInstance } from './leaf.js'
import {
  GeoAcc, growFrames, sampleFrame, anyPerp, azimuthPerp, rotateTowardUp,
  clamp01, lerp, boxInfo, UP,
} from './mathUtils.js'

const DEG = Math.PI / 180

/** 生长动画区间: [start, end], 按层级推进 */
const LEVEL_GROW = [
  [0.00, 0.30], // 树干
  [0.14, 0.46], // L1
  [0.32, 0.62], // L2
  [0.48, 0.76], // L3
  [0.62, 0.88], // L4
  [0.74, 0.96], // L5
]

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

/** 子枝方向: 叶序方位 + 俯仰 + 重力/趋光 */
function childDirection(rng, parentDir, cfg, k, params) {
  const axis = parentDir.clone().normalize()
  const perp = anyPerp(axis)
  const az = k * (cfg.phyllotaxis || 137.5) * DEG + rng.range(-cfg.spread, cfg.spread) * Math.PI
  const side = perp.clone().applyAxisAngle(axis, az)
  const pitch = (cfg.pitch + rng.signed() * cfg.pitchVariance) * DEG
  const dir = axis.clone().applyAxisAngle(side, pitch)
  const g = (cfg.gravity || 0) * (params.branches.gravityScale || 1) +
    (params.branches.phototropism || 0) + (cfg.upBias || 0)
  rotateTowardUp(dir, g)
  return dir.normalize()
}

export function buildTree(params) {
  const t0 = now()
  const P = params
  const branchParams = P.branches
  const L = P.leaves

  const barkParts = []
  const leafAcc = new GeoAcc()
  const leafTemplate = buildLeafTemplate({
    shape: L.shape, segments: L.segments, curl: L.curl, fold: L.fold, petiole: L.petiole,
  })
  const maxLeaves = Math.max(0, Math.round((P.lod && P.lod.maxLeaves) || 60000))
  const leafRng = makeRng(P.seed, 'leaves')
  const levelRng = {}
  for (let i = 1; i <= 5; i++) levelRng[i] = makeRng(P.seed, 'branch-level-' + i)

  let branchCount = 0
  let leafCount = 0

  const leafBase = new THREE.Color(L.color)
  const leafTip = new THREE.Color(L.colorTip)

  /* ------------------------------------------------------------------ */
  /* 叶片                                                                */
  /* ------------------------------------------------------------------ */
  const spawnLeaves = (frames, level, branchWind) => {
    if (!L.enabled || leafCount >= maxLeaves) return
    const rng = leafRng
    const perBranch = Math.max(1, Math.round(L.perBranch))
    const clusterCount = Math.max(1, Math.round(L.clusterCount))
    const tA = Math.min(L.startT, L.endT)
    const tB = Math.max(L.startT, L.endT)
    const phyllo = (L.phyllotaxis === undefined ? 137.5 : L.phyllotaxis) * DEG

    for (let i = 0; i < perBranch; i++) {
      if (leafCount >= maxLeaves) return
      const u = (i + 0.5) / perBranch
      let tt = lerp(tA, tB, u) + rng.signed() * 0.04
      tt = Math.min(0.999, Math.max(0.01, tt))
      const fr = sampleFrame(frames, tt)
      if (!fr) continue
      const dir = fr.dir
      const perp = anyPerp(dir)
      const azimuthBase = i * phyllo + rng.range(0, Math.PI * 2)

      for (let c = 0; c < clusterCount; c++) {
        if (leafCount >= maxLeaves) return
        if (P.lod.leafRatio < 1 && !rng.chance(P.lod.leafRatio)) continue

        const az = azimuthBase + rng.range(-1.3, 1.3)
        const sideAxis = perp.clone().applyAxisAngle(dir, az)
        const leafR = fr.radius + L.clusterRadius * L.clusterSpread * Math.sqrt(rng.next())
        const pos = fr.pos.clone()
          .addScaledVector(sideAxis, leafR)
          .addScaledVector(dir, rng.range(-0.03, 0.03))

        // --- 叶轴方向 ---
        const stem = dir.clone()
        const pitchAxis = perp.clone().applyAxisAngle(dir, az)
        stem.applyAxisAngle(pitchAxis, (L.pitch + rng.signed() * L.pitchVariance) * DEG)
        if (L.droop) rotateTowardUp(stem, -L.droop * rng.range(0.35, 1.0) * 0.9)
        if (L.twist) stem.applyAxisAngle(dir, rng.signed() * L.twist)
        stem.normalize()

        // --- 叶面法线 ---
        const nrm = anyPerp(stem)
        nrm.applyAxisAngle(stem, rng.range(0, Math.PI * 2) * (L.rollVariance / 180))
        if (nrm.dot(UP) < 0) nrm.negate()
        nrm.lerp(UP, clamp01(L.faceUp)).normalize()

        // --- 正交基 ---
        const yA = stem
        const zA = nrm.clone().addScaledVector(yA, -nrm.dot(yA))
        if (zA.lengthSq() < 1e-8) anyPerp(yA, zA)
        zA.normalize()
        const xA = new THREE.Vector3().crossVectors(yA, zA).normalize()

        const size = Math.max(0.005, L.size * rng.vary(L.sizeVariance))
        // z 轴是叶片的"横向/离面"方向, 必须和宽度同尺度缩放,
        // 否则细长叶 (针叶) 的折角会被拉陡, 法线侧立 -> 背光发黑
        const scale = new THREE.Vector3(size * L.width, size, size * L.width)

        const tintA = leafBase.clone().multiplyScalar(Math.max(0, 1 + rng.signed() * L.colorVariance))
        const tintB = leafTip.clone().multiplyScalar(Math.max(0, 1 + rng.signed() * L.colorVariance * 0.7))

        const wind = Math.min(1, branchWind + 0.12)
        const phase = rng.range(0, Math.PI * 2)
        const g0 = Math.min(0.98, 0.5 + rng.next() * 0.4)
        const g1 = Math.min(1.0, g0 + 0.14)

        pushLeafInstance(
          leafAcc, leafTemplate,
          { x: xA, y: yA, z: zA }, scale, pos,
          tintA, tintB, wind, phase,
          pos.clone(), g0, g1,
        )
        leafCount++
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 递归生长                                                            */
  /* ------------------------------------------------------------------ */
  const spawnChildren = (parentFrames, parentLevel, parentLength, parentRng, parentWind0, parentWind1) => {
    const level = parentLevel + 1
    if (level > branchParams.levels) return
    const cfg = branchParams.level[level - 1]
    if (!cfg || !cfg.enabled || cfg.count <= 0) return

    const rng = levelRng[level]
    const count = Math.max(0, Math.round(cfg.count))
    const startT = clamp01(Math.min(cfg.startT, cfg.endT) + (branchParams.startSpread || 0))
    const endT = clamp01(Math.max(cfg.startT, cfg.endT))

    for (let k = 0; k < count; k++) {
      const u = (k + 0.5) / count
      let tt = lerp(startT, endT, u) + rng.signed() * cfg.startJitter
      tt = Math.min(0.997, Math.max(0.008, tt))
      const fr = sampleFrame(parentFrames, tt)
      if (!fr) continue

      const apical = 1 - (branchParams.apicalDominance || 0) * Math.pow(tt, 1.6)
      const length = Math.max(0.01,
        parentLength * cfg.lengthRatio * rng.vary(cfg.lengthVariance) * apical * (branchParams.lengthScale || 1))
      const radius0 = Math.max(0.0008,
        fr.radius * cfg.radiusRatio * rng.vary(cfg.radiusVariance) * (branchParams.radiusScale || 1))
      const radius1 = Math.max(0.0005, radius0 * cfg.taper)
      const dir = childDirection(rng, fr.dir, cfg, k, P)
      const outDir = azimuthPerp(fr.dir, k * (cfg.phyllotaxis || 137.5) * DEG, new THREE.Vector3())
      const startPos = fr.pos.clone().addScaledVector(outDir, fr.radius * 0.3)

      const wind0 = lerp(parentWind0, parentWind1, tt)
      const wind1 = Math.min(1, wind0 + 0.3 * (cfg.windGain === undefined ? 1 : cfg.windGain))

      buildBranch({
        level, startPos, startDir: dir, length, radius0, radius1, cfg, rng, wind0, wind1,
      })
    }
  }

  const buildBranch = (o) => {
    const { level, startPos, startDir, length, radius0, radius1, cfg, rng, wind0, wind1 } = o
    const frames = growFrames(rng, {
      startPos,
      startDir,
      length,
      radius0,
      radius1,
      radiusCurve: cfg.radiusCurve || 1.2,
      segments: Math.max(2, Math.round(cfg.segments)),
      curve: cfg.curve || 0,
      curveVariance: cfg.curveVariance || 0,
      gravity: (cfg.gravity || 0) * (branchParams.gravityScale || 1) +
        (branchParams.phototropism || 0) + (cfg.upBias || 0),
      twist: cfg.twist || 0,
      gnarl: 0.18,
      taperRatio: cfg.taper,
    })

    const radialSegments = Math.max(3, Math.round(cfg.radialSegments * ((P.lod && P.lod.barkDetail) || 1)))
    const isYoung = level >= 3
    const colorBase = isYoung ? new THREE.Color(0.82, 0.94, 0.74) : new THREE.Color(0.88, 0.88, 0.86)
    const growSpan = LEVEL_GROW[Math.min(level, LEVEL_GROW.length - 1)]

    barkParts.push(buildTube(frames, {
      radialSegments,
      crossSection: cfg.crossSection || 'round',
      starDepth: cfg.starDepth || 0,
      color: colorBase,
      color2: new THREE.Color(1.0, 1.0, 1.0),
      colorVariance: 0.05,
      rng: rng.fork('bark'),
      wind0, wind1,
      windCurve: 1.5,
      grow: growSpan,
      origin: startPos.clone(),
      phase: rng.range(0, Math.PI * 2),
      capStart: false,
      capEnd: level >= 3,
      vertexNoise: 0.05,
    }))
    branchCount++

    if (level < branchParams.levels) spawnChildren(frames, level, length, rng, wind0, wind1)
    const leafIdx = level - 1
    if (L.enabled && L.levels[leafIdx]) spawnLeaves(frames, level, wind1)
  }

  /* ------------------------------------------------------------------ */
  /* 树干                                                                */
  /* ------------------------------------------------------------------ */
  const t = P.trunk
  const trunkRng = makeRng(P.seed, 'trunk')
  const trunkDir = new THREE.Vector3(0, 1, 0)
  if (t.lean) {
    const leanAxis = new THREE.Vector3(Math.cos(t.leanDirection * DEG), 0, Math.sin(t.leanDirection * DEG)).normalize()
    trunkDir.applyAxisAngle(leanAxis, t.lean)
  }

  // 节瘤: 固定位置的高斯凸起
  const knots = []
  for (let i = 0; i < (t.knots || 0); i++) {
    knots.push({
      t: trunkRng.range(0.05, 0.85),
      angle: trunkRng.range(0, Math.PI * 2),
      size: (t.knotSize || 0.3) * trunkRng.range(0.5, 1.5),
      spread: trunkRng.range(0.025, 0.09),
      aspread: trunkRng.range(0.5, 1.6),
    })
  }
  const trunkRadiusMod = (tt, angle) => {
    let m = 1
    if (t.flare > 0 && t.flareHeight > 0 && tt < t.flareHeight) {
      m *= 1 + t.flare * Math.pow(1 - tt / t.flareHeight, 2.0)
    }
    for (const k of knots) {
      const dt = (tt - k.t) / k.spread
      let da = Math.abs(angle - k.angle)
      if (da > Math.PI) da = Math.PI * 2 - da
      const daN = da / k.aspread
      m *= 1 + k.size * Math.exp(-(dt * dt + daN * daN))
    }
    return m
  }

  const trunkR0 = t.baseRadius
  const trunkR1 = Math.max(0.003, t.baseRadius * t.taper)
  const trunkFrames = growFrames(trunkRng, {
    startPos: new THREE.Vector3(0, 0, 0),
    startDir: trunkDir,
    length: t.height,
    radius0: trunkR0,
    radius1: trunkR1,
    radiusCurve: t.radiusCurve,
    segments: Math.max(3, Math.round(t.segments)),
    curve: t.curve,
    curveVariance: t.curveVariance,
    gravity: 0,
    twist: t.twist,
    gnarl: t.gnarl,
    taperRatio: t.taper,
  })

  const squash = Math.max(0.2, t.squash || 1)
  barkParts.push(buildTube(trunkFrames, {
    radialSegments: Math.max(4, Math.round(t.radialSegments * ((P.lod && P.lod.barkDetail) || 1))),
    crossSection: 'round',
    squashX: 1 / Math.sqrt(squash),
    squashZ: Math.sqrt(squash),
    color: new THREE.Color(0.84, 0.82, 0.8),
    color2: new THREE.Color(1.0, 1.0, 1.0),
    colorVariance: 0.06,
    rng: trunkRng.fork('bark-noise'),
    wind0: 0.012,
    wind1: 0.2,
    windCurve: 1.9,
    grow: LEVEL_GROW[0],
    origin: new THREE.Vector3(0, 0, 0),
    phase: trunkRng.range(0, Math.PI * 2),
    capStart: t.capBase,
    capEnd: false,
    radiusModifier: trunkRadiusMod,
    vertexNoise: 0.03,
  }))
  branchCount++

  /* ------------------------------------------------------------------ */
  /* 树根                                                                */
  /* ------------------------------------------------------------------ */
  const R = P.roots
  if (R && R.enabled && R.count > 0) {
    const rootRng = makeRng(P.seed, 'roots')
    const rc = Math.max(1, Math.round(R.count))
    for (let k = 0; k < rc; k++) {
      const u = (k + 0.5) / rc
      const az = u * Math.PI * 2 * (R.spread === undefined ? 1 : R.spread) + rootRng.range(-0.25, 0.25)
      const pitch = (R.pitch + rootRng.signed() * 12) * DEG
      const dir = new THREE.Vector3(
        Math.cos(az) * Math.sin(pitch),
        Math.cos(pitch),
        Math.sin(az) * Math.sin(pitch),
      ).normalize()
      const length = Math.max(0.02, t.height * R.length * rootRng.vary(R.lengthVariance))
      const radius0 = Math.max(0.002, t.baseRadius * R.radiusRatio * rootRng.vary(0.3))
      const frames = growFrames(rootRng, {
        startPos: new THREE.Vector3(dir.x * t.baseRadius * 0.4, t.baseRadius * 0.15, dir.z * t.baseRadius * 0.4),
        startDir: dir,
        length,
        radius0,
        radius1: radius0 * 0.16,
        radiusCurve: 1.2,
        segments: Math.max(2, Math.round(R.segments)),
        curve: R.curve,
        curveVariance: 0.4,
        gravity: -R.sink,
        twist: 0.15,
        gnarl: 0.5,
        taperRatio: 0.16,
      })
      barkParts.push(buildTube(frames, {
        radialSegments: Math.max(3, Math.round(R.radialSegments * ((P.lod && P.lod.barkDetail) || 1))),
        color: new THREE.Color(0.78, 0.75, 0.72),
        color2: new THREE.Color(0.92, 0.9, 0.88),
        colorVariance: 0.08,
        rng: rootRng.fork('bark'),
        wind0: 0.0,
        wind1: 0.04,
        windCurve: 1.2,
        grow: [0, 0.18],
        origin: new THREE.Vector3(dir.x * t.baseRadius * 0.4, 0.02, dir.z * t.baseRadius * 0.4),
        phase: rootRng.range(0, Math.PI * 2),
        capStart: false,
        capEnd: true,
        vertexNoise: 0.07,
      }))
      branchCount++
    }
  }

  /* ------------------------------------------------------------------ */
  /* 树枝                                                                */
  /* ------------------------------------------------------------------ */
  spawnChildren(trunkFrames, 0, t.height, trunkRng, 0.012, 0.2)

  /* ------------------------------------------------------------------ */
  /* 合并                                                                */
  /* ------------------------------------------------------------------ */
  const barkGeometry = barkParts.length ? mergeGeometries(barkParts, false) : new GeoAcc().build()
  const leafGeometry = leafAcc.vertexCount > 0 ? leafAcc.build() : null

  const bInfo = boxInfo(barkGeometry)
  const lInfo = leafGeometry ? boxInfo(leafGeometry) : null
  const maxY = lInfo ? Math.max(bInfo.max.y, lInfo.max.y) : bInfo.max.y
  const minY = Math.min(bInfo.min.y, lInfo ? lInfo.min.y : bInfo.min.y)
  const maxXZ = Math.max(bInfo.size.x, bInfo.size.z, lInfo ? Math.max(lInfo.size.x, lInfo.size.z) : 0)

  return {
    barkGeometry,
    leafGeometry,
    stats: {
      branches: branchCount,
      leaves: leafCount,
      barkTriangles: barkGeometry.index ? barkGeometry.index.count / 3 : 0,
      leafTriangles: leafGeometry && leafGeometry.index ? leafGeometry.index.count / 3 : 0,
      barkVertices: barkGeometry.attributes.position ? barkGeometry.attributes.position.count : 0,
      leafVertices: leafGeometry ? leafGeometry.attributes.position.count : 0,
      buildMs: now() - t0,
      height: maxY - minY,
      spread: maxXZ,
      trunkLength: t.height,
      levelCount: branchParams.levels,
    },
  }
}

/** 只计算统计信息 (不建几何), 供 UI 预估规模 */
export function estimateScale(params) {
  const total = (level) => {
    let n = 1
    for (let i = 1; i <= level; i++) {
      const cfg = params.branches.level[i - 1]
      n *= cfg && cfg.enabled ? Math.max(0, Math.round(cfg.count)) : 0
      if (n > 1e6) return n
    }
    return n
  }
  let branches = 1
  for (let i = 1; i <= params.branches.levels; i++) branches += total(i)
  let leaves = 0
  for (let i = 1; i <= params.branches.levels; i++) {
    if (!params.leaves.levels[i - 1]) continue
    leaves += total(i) * Math.max(1, Math.round(params.leaves.perBranch)) * Math.max(1, Math.round(params.leaves.clusterCount))
  }
  return { branches, leaves }
}
