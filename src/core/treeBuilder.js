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

/** 把骨架截断到相对位置 t (用于树干在分叉点结束) */
function truncateFrames(frames, t) {
  const out = []
  for (const f of frames) {
    if (f.t < t) out.push(f)
    else break
  }
  const end = sampleFrame(frames, t)
  if (end) out.push({ pos: end.pos, dir: end.dir, radius: end.radius, t, roll: end.roll })
  return out.length >= 2 ? out : frames
}
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

  /* ------------------------------------------------------------------ */
  /* 模型节点 (节点树的原始记录)                                          */
  /* ------------------------------------------------------------------ */
  // 生成阶段先给每个元素一个顺序 slot, 顶点里写的是 slot;
  // 全部生成完后按"组"重排成最终 node id (保证每组 id 连续, 便于用区间高亮)
  const slots = []
  const levelBranchCounter = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const levelLeafCounter = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const addSlot = (info) => {
    const s = slots.length
    slots.push(info)
    return s
  }

  const leafBase = new THREE.Color(L.color)
  const leafTip = new THREE.Color(L.colorTip)

  /* ------------------------------------------------------------------ */
  /* 叶片                                                                */
  /* ------------------------------------------------------------------ */
  const spawnLeaves = (frames, level, branchWind, parentSlot) => {
    if (!L.enabled || leafCount >= maxLeaves) return
    const rng = leafRng
    const perBranch = Math.max(1, Math.round(L.perBranch))
    const clusterCount = Math.max(1, Math.round(L.clusterCount))
    const tA = Math.min(L.startT, L.endT)
    const tB = Math.max(L.startT, L.endT)
    const phyllo = (L.phyllotaxis === undefined ? 137.5 : L.phyllotaxis) * DEG
    // 该枝条的叶节点 (惰性创建: 真的长出叶子才登记)
    let leafSlot = -1
    const leafStart = leafCount

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

        if (leafSlot < 0) {
          levelLeafCounter[level] = (levelLeafCounter[level] || 0) + 1
          leafSlot = addSlot({
            type: 'leaves',
            level,
            group: `leaves-L${level}`,
            name: `L${level} 叶簇 #${levelLeafCounter[level]}`,
            parent: parentSlot,
            meta: { leaves: 0 },
          })
        }

        pushLeafInstance(
          leafAcc, leafTemplate,
          { x: xA, y: yA, z: zA }, scale, pos,
          tintA, tintB, wind, phase,
          pos.clone(), g0, g1, leafSlot,
        )
        if (slots[leafSlot]) slots[leafSlot].meta.leaves++
        leafCount++
      }
    }
    if (leafSlot >= 0 && slots[leafSlot]) {
      slots[leafSlot].meta.clusters = Math.max(1, Math.round((leafCount - leafStart) / Math.max(1, clusterCount)))
    }
  }

  /* ------------------------------------------------------------------ */
  /* 递归生长                                                            */
  /* ------------------------------------------------------------------ */
  const spawnChildren = (parentFrames, parentLevel, parentLength, parentRng, parentWind0, parentWind1, parentSlot, clampEndT) => {
    const level = parentLevel + 1
    if (level > branchParams.levels) return
    const cfg = branchParams.level[level - 1]
    if (!cfg || !cfg.enabled || cfg.count <= 0) return

    const rng = levelRng[level]
    const count = Math.max(0, Math.round(cfg.count))
    const startT = clamp01(Math.min(cfg.startT, cfg.endT) + (branchParams.startSpread || 0))
    let endT = clamp01(Math.max(cfg.startT, cfg.endT))
    if (clampEndT !== undefined && clampEndT !== null) endT = Math.min(endT, clamp01(clampEndT))
    if (endT <= startT) return

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
        level, startPos, startDir: dir, length, radius0, radius1, cfg, rng, wind0, wind1, parentSlot,
      })
    }
  }

  const buildBranch = (o) => {
    const { level, startPos, startDir, length, radius0, radius1, cfg, rng, wind0, wind1, parentSlot } = o
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

    levelBranchCounter[level] = (levelBranchCounter[level] || 0) + 1
    const mySlot = addSlot({
      type: 'branch',
      level,
      group: `branch-L${level}`,
      name: `L${level} 枝 #${levelBranchCounter[level]}`,
      parent: parentSlot,
      meta: { length, radius: radius0, segments: Math.max(2, Math.round(cfg.segments)) },
    })

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
      nodeId: mySlot,
    }))
    branchCount++

    if (level < branchParams.levels) spawnChildren(frames, level, length, rng, wind0, wind1, mySlot)
    const leafIdx = level - 1
    if (L.enabled && L.levels[leafIdx]) spawnLeaves(frames, level, wind1, mySlot)
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
  const trunkFramesAll = growFrames(trunkRng, {
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

  // 分叉 (多主枝): 橡树这类乔木常在 1/3 高度处分成 2~4 条主枝
  const forkCfg = t.fork || {}
  const forkOn = !!forkCfg.enabled && Math.round(forkCfg.count || 0) > 0
  const forkT = forkOn ? clamp01(forkCfg.height === undefined ? 0.34 : forkCfg.height) : 1
  const trunkFrames = forkOn ? truncateFrames(trunkFramesAll, forkT) : trunkFramesAll

  const squash = Math.max(0.2, t.squash || 1)
  const trunkSlot = addSlot({
    type: 'trunk',
    level: 0,
    group: 'trunk',
    name: '树干',
    parent: null,
    meta: { length: t.height * forkT, radius: trunkR0, segments: Math.max(3, Math.round(t.segments)), fork: forkOn ? Math.round(forkCfg.count) : 0 },
  })
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
    capEnd: forkOn,
    radiusModifier: trunkRadiusMod,
    vertexNoise: 0.03,
    nodeId: trunkSlot,
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
      const rootSlot = addSlot({
        type: 'root',
        level: 0,
        group: 'roots',
        name: `树根 #${k + 1}`,
        parent: trunkSlot,
        meta: { length, radius: radius0 },
      })
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
        nodeId: rootSlot,
      }))
      branchCount++
    }
  }

  /* ------------------------------------------------------------------ */
  /* 树枝                                                                */
  /* ------------------------------------------------------------------ */
  // 主干上的第一级枝条: 有分叉时只在分叉点以下生长
  spawnChildren(trunkFrames, 0, t.height, trunkRng, 0.012, 0.2, trunkSlot,
    forkOn ? Math.max(0.06, forkT - 0.06) : null)

  // 分叉出的主枝 (领导者): 承接主干继续向上, 自身再长二级/三级枝
  if (forkOn) {
    const base1 = branchParams.level[0] || {}
    const fr = sampleFrame(trunkFramesAll, forkT)
    if (fr) {
      const rng = trunkRng.fork('fork-leaders')
      const n = Math.max(2, Math.min(6, Math.round(forkCfg.count)))
      const angle = (forkCfg.angle === undefined ? 26 : forkCfg.angle) * DEG
      const spread = forkCfg.spread === undefined ? 1 : forkCfg.spread
      const radiusScale = forkCfg.radiusScale === undefined ? 0.62 : forkCfg.radiusScale
      const lengthScale = forkCfg.lengthScale === undefined ? 1 : forkCfg.lengthScale
      const leaderCfg = {
        ...base1,
        taper: forkCfg.taper === undefined ? 0.3 : forkCfg.taper,
        curve: forkCfg.curve === undefined ? 0.4 : forkCfg.curve,
        curveVariance: 0.55,
        gravity: forkCfg.gravity === undefined ? 0.03 : forkCfg.gravity,
        upBias: 0.1,
        segments: Math.max(5, Math.round((base1.segments || 8) * 0.9)),
      }
      for (let k = 0; k < n; k++) {
        const az = (k / n) * Math.PI * 2 + rng.range(-0.55, 0.55) * spread
        const side = azimuthPerp(fr.dir, az, new THREE.Vector3())
        const dir = fr.dir.clone().applyAxisAngle(side, angle * rng.range(0.7, 1.3))
        rotateTowardUp(dir, 0.05)
        const r0 = Math.max(0.002, fr.radius * radiusScale * rng.vary(0.1))
        buildBranch({
          level: 1,
          startPos: fr.pos.clone(),
          startDir: dir,
          length: Math.max(0.05, t.height * (1 - forkT) * lengthScale * rng.vary(0.16)),
          radius0: r0,
          radius1: Math.max(0.0008, r0 * leaderCfg.taper),
          cfg: leaderCfg,
          rng,
          wind0: 0.2,
          wind1: Math.min(1, 0.2 + 0.3 * (base1.windGain === undefined ? 1 : base1.windGain)),
          parentSlot: trunkSlot,
        })
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 合并 + 节点表                                                        */
  /* ------------------------------------------------------------------ */
  const barkGeometry = barkParts.length ? mergeGeometries(barkParts, false) : new GeoAcc().build()
  const leafGeometry = leafAcc.vertexCount > 0 ? leafAcc.build() : null

  const { nodes, groups } = finalizeNodes(slots, barkGeometry, leafGeometry)

  const bInfo = boxInfo(barkGeometry)
  const lInfo = leafGeometry ? boxInfo(leafGeometry) : null
  const maxY = lInfo ? Math.max(bInfo.max.y, lInfo.max.y) : bInfo.max.y
  const minY = Math.min(bInfo.min.y, lInfo ? lInfo.min.y : bInfo.min.y)
  const maxXZ = Math.max(bInfo.size.x, bInfo.size.z, lInfo ? Math.max(lInfo.size.x, lInfo.size.z) : 0)

  return {
    barkGeometry,
    leafGeometry,
    nodes,
    groups,
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
      nodeCount: nodes.length,
    },
  }
}

/* ------------------------------------------------------------------ */
/* 节点表: slot -> 最终 node id, 并统计每个节点的面数/顶点数/包围盒        */
/* ------------------------------------------------------------------ */

/** 组顺序: 同一组的节点 id 连续 -> 选中一组只需一个 id 区间 */
const NODE_GROUPS = [
  { id: 'trunk', name: '树干', icon: '🪵', type: 'bark' },
  { id: 'roots', name: '树根', icon: '🪵', type: 'bark' },
  { id: 'branch-L1', name: '树枝 L1', icon: '🌿', type: 'bark', level: 1 },
  { id: 'branch-L2', name: '树枝 L2', icon: '🌿', type: 'bark', level: 2 },
  { id: 'branch-L3', name: '树枝 L3', icon: '🌿', type: 'bark', level: 3 },
  { id: 'branch-L4', name: '树枝 L4', icon: '🌿', type: 'bark', level: 4 },
  { id: 'branch-L5', name: '树枝 L5', icon: '🌿', type: 'bark', level: 5 },
  { id: 'leaves-L1', name: '树叶 L1', icon: '🍃', type: 'leaf', level: 1 },
  { id: 'leaves-L2', name: '树叶 L2', icon: '🍃', type: 'leaf', level: 2 },
  { id: 'leaves-L3', name: '树叶 L3', icon: '🍃', type: 'leaf', level: 3 },
  { id: 'leaves-L4', name: '树叶 L4', icon: '🍃', type: 'leaf', level: 4 },
  { id: 'leaves-L5', name: '树叶 L5', icon: '🍃', type: 'leaf', level: 5 },
  { id: 'material-bark', name: '材质 · 树皮', icon: '🎨', type: 'material', material: 'bark' },
  { id: 'material-leaf', name: '材质 · 树叶', icon: '🎨', type: 'material', material: 'leaf' },
]

function emptyBox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
}

function unionBox(a, b) {
  if (!a) return b
  if (!b) return a
  for (let i = 0; i < 3; i++) {
    if (b.min[i] < a.min[i]) a.min[i] = b.min[i]
    if (b.max[i] > a.max[i]) a.max[i] = b.max[i]
  }
  return a
}

/**
 * @param {Array} slots  生成阶段记录的元素 (顶点里存的是 slot 序号)
 * @param {THREE.BufferGeometry} barkGeometry
 * @param {THREE.BufferGeometry|null} leafGeometry
 */
export function finalizeNodes(slots, barkGeometry, leafGeometry) {
  // 1) 按组重排, 得到最终 node id
  const nodes = []
  const slotToId = new Int32Array(slots.length).fill(-1)
  for (const g of NODE_GROUPS) {
    if (g.type === 'material') continue
    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s]
      if (!slot || slot.group !== g.id) continue
      const id = nodes.length
      slotToId[s] = id
      nodes.push({
        id,
        slot: s,
        type: slot.type,
        group: g.id,
        groupName: g.name,
        level: slot.level || 0,
        name: slot.name,
        parent: slot.parent === null || slot.parent === undefined ? null : slot.parent,
        meta: slot.meta || {},
        stats: { triangles: 0, vertices: 0 },
        bbox: null,
      })
    }
  }

  // 2) 把顶点里的 slot 改写成 node id, 同时统计顶点数 / 包围盒
  const measure = (geometry, target) => {
    if (!geometry) return
    const attr = geometry.attributes.aNodeId
    if (!attr) return
    const ids = attr.array
    const pos = geometry.attributes.position.array
    const acc = new Map()
    for (let i = 0; i < ids.length; i++) {
      const id = slotToId[ids[i]] === undefined ? -1 : slotToId[ids[i]]
      ids[i] = id
      if (id < 0) continue
      let rec = acc.get(id)
      if (!rec) {
        rec = { v: 0, t: 0, box: emptyBox() }
        acc.set(id, rec)
      }
      rec.v++
      const i3 = i * 3
      for (let k = 0; k < 3; k++) {
        const val = pos[i3 + k]
        if (val < rec.box.min[k]) rec.box.min[k] = val
        if (val > rec.box.max[k]) rec.box.max[k] = val
      }
    }
    attr.needsUpdate = true
    // 面数: 每个三角形取第一个顶点所属节点
    const index = geometry.index ? geometry.index.array : null
    if (index) {
      for (let t = 0; t < index.length; t += 3) {
        const id = ids[index[t]]
        const rec = acc.get(id)
        if (rec) rec.t++
      }
    }
    for (const [id, rec] of acc) {
      const node = nodes[id]
      if (!node) continue
      node.stats.vertices += rec.v
      node.stats.triangles += rec.t
      node.bbox = unionBox(node.bbox, rec.box)
    }
    target.info = { vertices: ids.length, triangles: index ? index.length / 3 : 0 }
  }

  const barkInfo = {}
  const leafInfo = {}
  measure(barkGeometry, barkInfo)
  measure(leafGeometry, leafInfo)

  // 3) 材质节点 (覆盖整块几何, 选中时按材质高亮)
  const barkMatNode = {
    id: nodes.length,
    type: 'material',
    group: 'material-bark',
    groupName: '材质 · 树皮',
    level: -1,
    name: '材质 · 树皮',
    parent: null,
    material: 'bark',
    meta: {},
    stats: { triangles: barkInfo.triangles || 0, vertices: barkInfo.vertices || 0 },
    bbox: null,
  }
  nodes.push(barkMatNode)
  const leafMatNode = {
    id: nodes.length,
    type: 'material',
    group: 'material-leaf',
    groupName: '材质 · 树叶',
    level: -1,
    name: '材质 · 树叶',
    parent: null,
    material: 'leaf',
    meta: {},
    stats: { triangles: leafInfo.triangles || 0, vertices: leafInfo.vertices || 0 },
    bbox: null,
  }
  nodes.push(leafMatNode)

  // 4) 组元数据 (含 id 区间, 供着色器区间高亮)
  const groups = []
  for (const g of NODE_GROUPS) {
    const members = nodes.filter((n) => n.group === g.id)
    if (!members.length) continue
    const stats = { triangles: 0, vertices: 0 }
    let box = null
    for (const m of members) {
      stats.triangles += m.stats.triangles
      stats.vertices += m.stats.vertices
      if (m.bbox) box = unionBox(box, { min: [...m.bbox.min], max: [...m.bbox.max] })
    }
    groups.push({
      id: g.id,
      name: g.name,
      icon: g.icon,
      type: g.type,
      level: g.level === undefined ? -1 : g.level,
      material: g.material || null,
      count: members.length,
      idStart: members[0].id,
      idEnd: members[members.length - 1].id,
      nodeIds: members.map((m) => m.id),
      stats,
      bbox: box,
      children: members.map((m) => ({ id: m.id, name: m.name, stats: m.stats, level: m.level, meta: m.meta })),
    })
  }

  return { nodes, groups }
}

/** 把一组 node id 压缩成 <=8 个连续区间 (着色器用) */
export function selectionRanges(ids, maxRanges = 8) {
  const sorted = [...new Set(ids)].filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  const ranges = []
  for (const id of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && id === last[1] + 1) last[1] = id
    else ranges.push([id, id])
  }
  // 区间过多时合并最近的几段 (宁可多亮一点, 也不丢选中反馈)
  while (ranges.length > maxRanges) {
    let bestI = 0
    let bestGap = Infinity
    for (let i = 0; i < ranges.length - 1; i++) {
      const gap = ranges[i + 1][0] - ranges[i][1]
      if (gap < bestGap) {
        bestGap = gap
        bestI = i
      }
    }
    ranges[bestI] = [ranges[bestI][0], ranges[bestI + 1][1]]
    ranges.splice(bestI + 1, 1)
  }
  return ranges
}

/** 只计算统计信息 (不建几何), 供 UI 预估规模与预算控制
 *  注意: 会把"树干分叉出的主枝"也算进去 —— 它们等同于一级枝 */
export function estimateScale(params) {
  const lv = params.branches.levels
  const cnt = (level) => {
    const cfg = params.branches.level[level - 1]
    return cfg && cfg.enabled ? Math.max(0, Math.round(cfg.count)) : 0
  }
  const forkN = (params.trunk && params.trunk.fork && params.trunk.fork.enabled)
    ? Math.max(0, Math.round(params.trunk.fork.count)) : 0

  /** 一条 level 级枝条的整棵子树节点数 (含自己) */
  const subtree = (level) => {
    let acc = 1
    let prod = 1
    for (let i = level + 1; i <= lv; i++) {
      prod *= cnt(i)
      acc += prod
      if (acc > 2e6) return acc
    }
    return acc
  }
  /** level 级枝条的条数 (含分叉主枝带来的那部分) */
  const countAt = (level) => {
    let n = 1
    for (let i = 1; i <= level; i++) n *= cnt(i)
    if (forkN) {
      let f = forkN
      for (let i = 2; i <= level; i++) f *= cnt(i)
      n += f
    }
    return n
  }

  let branches = subtree(0) + forkN * subtree(1)
  let leaves = 0
  for (let i = 1; i <= lv; i++) {
    if (!params.leaves.levels[i - 1]) continue
    leaves += countAt(i) * Math.max(1, Math.round(params.leaves.perBranch)) *
      Math.max(1, Math.round(params.leaves.clusterCount))
  }
  return { branches, leaves }
}
