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
import { createBarkSkeleton, addBarkBranch, finalizeBarkSkeleton } from './barkSkeleton.js'
import { buildBarkSkin } from './barkSkin.js'
import { buildSpeedtreeBark } from './speedtreeBark.js'
import { buildLeafTemplate, buildLeafCardTemplate, pushLeafInstance } from './leaf.js'
import { buildFruitTemplate, pushFruitInstance } from './fruit.js'
import { buildOcclusionGrid, bakeOcclusion, bakeOcclusionByRanges } from './ambientOcclusion.js'
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

/**
 * 取父枝骨架在 t 处的环坐标系 (与 barkSkin 的平行移动一致)。
 * 用于把子枝基部放到"父枝实际表面"上 —— 树干有 flare/knots 时,
 * 未调制的 skeleton 半径会明显小于真实表面, 子枝就会埋进外扩里,
 * 桥接时看起来像从洞口反着长回去 (约 180° 反向)。
 */
function frameBasisAt(frames, t) {
  const n = frames.length
  const idx = Math.max(0, Math.min(n - 1, Math.round(clamp01(t) * (n - 1))))
  const side = anyPerp(frames[0].dir.clone()).normalize()
  for (let i = 0; i <= idx; i++) {
    const f = frames[i]
    if (i > 0) {
      side.addScaledVector(f.dir, -side.dot(f.dir))
      if (side.lengthSq() < 1e-10) anyPerp(f.dir, side)
      side.normalize()
      const rollDelta = (f.roll || 0) - (frames[i - 1].roll || 0)
      if (rollDelta) side.applyAxisAngle(f.dir, rollDelta)
      side.addScaledVector(f.dir, -side.dot(f.dir)).normalize()
    } else if (f.roll) {
      side.applyAxisAngle(f.dir, f.roll)
      side.addScaledVector(f.dir, -side.dot(f.dir)).normalize()
    }
  }
  const f = frames[idx]
  const up = new THREE.Vector3().crossVectors(f.dir, side).normalize()
  return { side, up, frame: f }
}

export function buildTree(params, options = {}) {
  const t0 = now()
  const P = params
  const branchParams = P.branches
  const onePiece = !!(P.trunk && P.trunk.onePiece)
  const L = P.leaves
  const F = P.fruit || { enabled: false, levels: [] }
  // 挂果层级回退: 如果设置里勾选的层级在这棵树上一级都没有 (比如默认树只有 3 层枝,
  // 而果实勾的是 L4), 就退到最深的可用层级 —— 否则"打开果实开关"会毫无反应。
  const effFruitLevels = (() => {
    const lv = Array.isArray(F.levels) ? F.levels : []
    const maxLv = Math.max(1, Math.round(P.branches.levels || 1))
    if (lv.some((on, i) => on && i < maxLv)) return lv
    const out = lv.slice(0, 5)
    while (out.length < maxLv) out.push(false)
    out[maxLv - 1] = true
    return out
  })()

  // 骨架先行: 这里只收集骨架 (节点/边/半径/父子关系), 不生成任何树皮几何。
  // 全部生长结束后由 barkSkin 一次性蒙皮 (分叉切孔桥接 / 端盖), 保证单张 2-manifold。
  const barkSkeleton = createBarkSkeleton()
  const leafAcc = new GeoAcc()
  // 花朵: 独立累加器 + 复用树叶的"记录附件点 -> 后置生成"策略
  const FL = P.flower || {}
  const flowerAcc = FL.enabled ? new GeoAcc() : null
  const flowerBranches = []
  // 花朵模板: 平面花卡 (照片级素材) 或 程序化叶形轮廓; 可选十字交叉
  const flowerCardTemplate = () => (FL.useShape
    ? buildLeafTemplate({
        shape: FL.shape || 'oval',
        segments: FL.segments, curl: FL.curl, fold: FL.fold, petiole: FL.petiole,
      })
    : buildLeafCardTemplate({
        aspect: FL.cardAspect || 1, cols: 1, rows: 3,
        curl: FL.cardCurl === undefined ? 0.1 : FL.cardCurl,
        fold: FL.cardFold === undefined ? 0.12 : FL.cardFold,
      }))

  /** 把多个模板按给定欧拉角合并成一个几何 (十字交叉用) */
  const mergeFlowerTemplates = (tpls, rotations) => {
    const positions = []
    const normals = []
    const uvs = []
    const index = []
    const stamenRange = null
    tpls.forEach((tpl, i) => {
      const [rx, ry] = rotations[i] || [0, 0]
      const cx = Math.cos(rx), sx = Math.sin(rx)
      const cy = Math.cos(ry), sy = Math.sin(ry)
      const base = positions.length / 3
      for (let k = 0; k < tpl.positions.length; k += 3) {
        let x = tpl.positions[k]
        let y = tpl.positions[k + 1]
        let z = tpl.positions[k + 2]
        // 绕 Y
        let x1 = x * cy + z * sy
        let z1 = -x * sy + z * cy
        // 绕 X
        let y1 = y * cx - z1 * sx
        let z2 = y * sx + z1 * cx
        positions.push(x1, y1, z2)
        const nx = tpl.normals[k], ny = tpl.normals[k + 1], nz = tpl.normals[k + 2]
        const nx1 = nx * cy + nz * sy
        const nz1 = -nx * sy + nz * cy
        const ny1 = ny * cx - nz1 * sx
        const nz2 = ny * sx + nz1 * cx
        normals.push(nx1, ny1, nz2)
      }
      for (let k = 0; k < tpl.uvs.length; k++) uvs.push(tpl.uvs[k])
      for (const idx of tpl.index) index.push(base + idx)
    })
    return { positions, normals, uvs, index, vertexCount: positions.length / 3, stamenRange }
  }

  const makeFlowerTemplate = () => {
    const tpl = flowerCardTemplate()
    const mode = FL.cross || 'none'
    if (mode === 'none') return tpl
    const HALF_PI = Math.PI / 2
    if (mode === 'v') return mergeFlowerTemplates([tpl, tpl], [[0, 0], [0, HALF_PI]])          // 竖向交叉 (两片竖直面)
    if (mode === 'h') return mergeFlowerTemplates([tpl, tpl], [[0, 0], [HALF_PI, 0]])          // 横向交叉 (一竖一横)
    return mergeFlowerTemplates([tpl, tpl, tpl], [[0, 0], [0, HALF_PI], [HALF_PI, 0]])          // 双向交叉 (3 片)
  }
  const makeTemplate = (shape) => (L.cardMode
    ? buildLeafCardTemplate({
        aspect: L.cardAspect || 1,
        cols: 1,
        rows: 3,
        curl: L.cardCurl === undefined ? 0.1 : L.cardCurl,
        fold: L.cardFold === undefined ? 0.12 : L.cardFold,
      })
    : buildLeafTemplate({
        shape, segments: L.segments, curl: L.curl, fold: L.fold, petiole: L.petiole,
      }))
  const leafTemplate = makeTemplate(L.shape)
  // 叶形混合: shapeMix 里每一项都生成一个模板, 实例化时按权重随机挑
  const mixList = Array.isArray(L.shapeMix)
    ? L.shapeMix.filter((m) => m && m.shape && (m.weight === undefined || m.weight > 0))
    : []
  const leafTemplates = mixList.length
    ? mixList.flatMap((m) => {
        const tpl = makeTemplate(m.shape)
        const n = Math.max(1, Math.round((m.weight === undefined ? 1 : m.weight) * 8))
        return new Array(n).fill(tpl)
      })
    : [leafTemplate]
  const maxLeaves = Math.max(0, Math.round((P.lod && P.lod.maxLeaves) || 60000))
  const leafRng = makeRng(P.seed, 'leaves')
  const fruitRng = makeRng(P.seed, 'fruit')
  // 叶片保留比例用"确定性抽样"而不是 rng.chance: 不同 LOD 只少画叶子,
  // 叶片位置/其余随机流完全不变 -> 远景/近景切换时树形不跳变
  const leafKeepEvery = P.lod && P.lod.leafRatio < 1
    ? Math.max(1, Math.round(1 / Math.max(0.001, P.lod.leafRatio)))
    : 1
  let leafDrawIndex = 0
  let fruitCount = 0
  const fruitAttach = []   // 挂果点 (自检用)
  const fruitOrient = []   // [果柄端到挂果点距离, 坚果底到挂果点距离] (自检用)
  const fruitAcc = new GeoAcc()
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
  const levelFruitCounter = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const addSlot = (info) => {
    const s = slots.length
    slots.push(info)
    return s
  }

  const leafBase = new THREE.Color(L.color)
  const leafTip = new THREE.Color(L.colorTip)
  // AO 遮挡点云: 记录叶片/花朵中心 (世界坐标), 生成完后统一烘焙
  const aoSamples = []
  // 叶片/花朵的顶点区间: AO 按"每个实例一次查询"烘焙, 比逐顶点快一个量级
  const leafAoRanges = []
  const flowerAoRanges = []

  /* ------------------------------------------------------------------ */
  /* 叶片                                                                */
  /* ------------------------------------------------------------------ */
  const spawnLeaves = (frames, level, branchWind, parentSlot) => {
    // 花朵独立: 即使树叶关闭, 也要跑位置采集 (否则花朵没有附着点)
    if ((!L.enabled && !FL.enabled) || leafCount >= maxLeaves) return
    // 记录这条可开花的枝条: 花朵用自己的 perBranch/clusterCount/startT/endT 采样
    if (flowerAcc) flowerBranches.push({ frames, level, wind1: branchWind })
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
      const azimuthBase = i * phyllo + rng.range(0, Math.PI * 2) + (fr.profileRoll || 0)

      for (let c = 0; c < clusterCount; c++) {
        if (leafCount >= maxLeaves) return
        if (leafKeepEvery > 1 && leafDrawIndex++ % leafKeepEvery !== 0) continue

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
        // 模型旋转: 绕叶面法线转整张叶片 (贴图偏移/叶柄方向反了时 ±180 校正)
        const modelRot = (L.modelRotation || 0) * DEG
        if (modelRot) {
          xA.applyAxisAngle(zA, modelRot)
          yA.applyAxisAngle(zA, modelRot)
        }

        const size = Math.max(0.005, L.size * rng.vary(L.sizeVariance))
        // z 轴是叶片的"横向/离面"方向, 必须和宽度同尺度缩放,
        // 否则细长叶 (针叶) 的折角会被拉陡, 法线侧立 -> 背光发黑
        const widthMul = L.cardMode ? (L.cardAspect || 1) * (L.width === undefined ? 1 : L.width) : L.width
        const scale = new THREE.Vector3(size * widthMul, size, size * widthMul)

        const tintA = leafBase.clone().multiplyScalar(Math.max(0, 1 + rng.signed() * L.colorVariance))
        const tintB = leafTip.clone().multiplyScalar(Math.max(0, 1 + rng.signed() * L.colorVariance * 0.7))

        const wind = Math.min(1, branchWind + 0.12)
        const phase = rng.range(0, Math.PI * 2)
        const g0 = Math.min(0.98, 0.5 + rng.next() * 0.4)
        const g1 = Math.min(1.0, g0 + 0.14)

        if (L.enabled && leafSlot < 0) {
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

        // 叶形混合: 同一棵树可以混用多种叶形 (不同树种叶形差别很大)
        const tpl = leafTemplates.length > 1 ? rng.pick(leafTemplates) : leafTemplate
        if (L.enabled) {
          const v0 = leafAcc.vertexCount
          pushLeafInstance(
            leafAcc, tpl,
            { x: xA, y: yA, z: zA }, scale, pos,
            tintA, tintB, wind, phase,
            pos.clone(), g0, g1, leafSlot,
            tpl.stamenRange ? stamenColor : null,
          )
          leafAoRanges.push([v0, leafAcc.vertexCount, pos.x, pos.y, pos.z])
        }
        if (L.enabled && slots[leafSlot]) slots[leafSlot].meta.leaves++
        if (L.enabled) aoSamples.push(pos.x, pos.y, pos.z)
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
  const spawnChildren = (parentFrames, parentLevel, parentLength, parentRng, parentWind0, parentWind1, parentSlot, parentBranch, clampEndT, parentSurface) => {
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
      // 扭转跟随: 用完整 roll (基础 twist + 扭曲曲线句柄), 不只是 profileRoll。
      // 这样主干一起扭时, 子枝的贴附点/生长方向会跟着转; 树枝的 twist 也会带动它的子枝。
      const roll = fr.roll || 0
      if (roll) dir.applyAxisAngle(fr.dir, roll)
      // 贴附方位必须跟随枝条真实的生长方位: 取 dir 垂直于父枝轴的分量。
      // 否则"贴在父枝一侧、却朝另一侧/父枝内部生长", 蒙皮时子枝基部环与父枝洞口平面
      // 会相差 ~90°, 肩部桥接被迫在很短距离内扭转 90°, 看起来就像树枝基部被翻转。
      // 只有枝条几乎平行于父枝 (径向分量≈0) 时, 才退回叶序角。
      const radialDir = dir.clone().addScaledVector(fr.dir, -dir.dot(fr.dir))
      const outDir = radialDir.lengthSq() > 1e-8
        ? radialDir.normalize()
        : azimuthPerp(fr.dir, k * (cfg.phyllotaxis || 137.5) * DEG + profileRoll, new THREE.Vector3())
      // 分支基部贴到父枝"实际表面"上 (骨架先定位置, 蒙皮阶段再在父枝上切孔桥接)。
      // 父枝有 flare/knots 时必须用调制后的半径, 否则子枝基部会埋在外扩内部,
      // 桥接后视觉上像树枝从洞口反着长回去。
      let attachRadius = fr.radius * 0.95
      if (parentSurface) {
        const basis = frameBasisAt(parentSurface.frames, tt)
        const az = Math.atan2(outDir.dot(basis.up), outDir.dot(basis.side))
        const mod = parentSurface.modifier ? parentSurface.modifier(basis.frame.t, az, basis.frame.radius) : 1
        const sx = parentSurface.squashX === undefined ? 1 : parentSurface.squashX
        const sz = parentSurface.squashZ === undefined ? 1 : parentSurface.squashZ
        const proj = Math.hypot(Math.cos(az) * sx, Math.sin(az) * sz)
        attachRadius = Math.max(fr.radius, basis.frame.radius * mod * proj) * 0.92
      }
      const startPos = fr.pos.clone().addScaledVector(outDir, attachRadius)

      const wind0 = lerp(parentWind0, parentWind1, tt)
      const wind1 = Math.min(1, wind0 + 0.3 * (cfg.windGain === undefined ? 1 : cfg.windGain))

      buildBranch({
        level, startPos, startDir: dir, length, radius0, radius1, cfg, rng, wind0, wind1,
        parentSlot, parentBranch,
      })
    }
  }

  const buildBranch = (o) => {
    const { level, startPos, startDir, length, radius0, radius1, cfg, rng, wind0, wind1, parentSlot, parentBranch } = o
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
      twistProfile: cfg.twistProfile || (P.branches && P.branches.twistProfile),
      gnarl: 0.18,
      taperRatio: cfg.taper,
    })
    // 每层取第一根枝条作为该层扭曲句柄的可视化引导线
    if (level >= 1 && !twistGuides.branches[level]) twistGuides.branches[level] = sampleGuidePoints(frames)

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

    // 骨架先行: 这里只登记骨架分支 (节点/边/半径/父子关系)。
    // 树皮几何在全部生长结束后由 barkSkin 一次性生成 (分叉切孔桥接 + 端盖)。
    // 一体建模: 加大基部领口, 让枝条与树干/父枝更像连续长出来的一棵树
    const myBranch = addBarkBranch(barkSkeleton, {
      frames,
      parent: parentBranch === undefined ? null : parentBranch,
      slot: mySlot,
      type: 'branch',
      level,
      render: {
        radialSegments,
        crossSection: cfg.crossSection || 'round',
        starDepth: cfg.starDepth || 0,
        color: colorBase,
        color2: new THREE.Color(1.0, 1.0, 1.0),
        colorVariance: 0.05,
        rng: rng.fork('bark'),
        wind0,
        wind1,
        windCurve: 1.5,
        grow: growSpan,
        origin: startPos.clone(),
        phase: rng.range(0, Math.PI * 2),
        // 末梢圆钝收尖 (不是平截面)。
        // 基部领口不再靠"把子枝基部吹粗"来遮缝: 现在分叉是真实切孔 + 环桥接,
        // 过大的 baseFlare 会让子枝基部接近父枝粗度, 窗口过大、桥接变成大片斜鳍,
        // 视觉上就像树枝在基部被拉偏。保留 0 基准 (+ onePiece 极轻微领口)。
        tipRound: o.tipRound === undefined ? 0.06 : o.tipRound,
        baseFlare: (o.baseFlare === undefined ? 0 : o.baseFlare) + (onePiece ? 0.06 : 0),
        baseFlareLen: (o.baseFlareLen === undefined ? (level === 1 ? 0.16 : 0.13) : o.baseFlareLen),
        vertexNoise: 0.05,
      },
    })
    branchCount++

    if (level < branchParams.levels) spawnChildren(frames, level, length, rng, wind0, wind1, mySlot, myBranch)
    const leafIdx = level - 1
    // 花朵独立: 树叶关闭时仍要跑 spawnLeaves 采集开花位置 (只是不写入叶片几何)
    if ((L.enabled || FL.enabled) && L.levels[leafIdx]) spawnLeaves(frames, level, wind1, mySlot)
    if (F.enabled && effFruitLevels[leafIdx]) spawnFruit(frames, level, wind1, mySlot)
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
  // 节瘤形态参数: 强度/纵向跨度/角向跨度。默认比以前更收束, 避免节瘤在树干上
  // 形成一圈“箍” (原来的角向半宽 0.5~1.6 rad 太宽, 看起来像环而不是局部凸起)。
  const knotStrength = t.knotStrength === undefined ? 0.75 : Math.max(0, Number(t.knotStrength) || 0)
  const knotSpread = t.knotSpread === undefined ? 0.05 : Math.max(0.002, Number(t.knotSpread) || 0.05)
  const knotAngle = t.knotAngle === undefined ? 0.7 : Math.max(0.05, Number(t.knotAngle) || 0.7)
  for (let i = 0; i < (t.knots || 0); i++) {
    knots.push({
      t: trunkRng.range(0.05, 0.85),
      angle: trunkRng.range(0, Math.PI * 2),
      size: (t.knotSize || 0.3) * knotStrength * trunkRng.range(0.5, 1.5),
      spread: knotSpread * trunkRng.range(0.6, 1.4),
      aspread: knotAngle * trunkRng.range(0.6, 1.4),
    })
  }
  // 根部"板根/表层根"的方位分布: 真实树木基部不是圆锥, 而是 4~6 条放射状凸起
  // (每条的方位固定, 这样同一棵树每次生成都一样)
  const rootLobeCount = 5
  const rootLobePhase = trunkRng.range(0, Math.PI * 2)
  const trunkRadiusMod = (tt, angle) => {
    let m = 1
    if (t.flare > 0 && t.flareHeight > 0 && tt < t.flareHeight) {
      const u = tt / t.flareHeight            // 0 = 地面, 1 = 扩展区顶部
      // 1) 整体扩张: 幂次 >2 让底部更"鼓"、往上是弧形收进去 (圆锥形太假)
      const baseFlare = 1 + t.flare * Math.pow(1 - u, 2.6)
      // 2) 放射状板根: 沿方位周期性加粗, 越靠近地面越明显
      const lobe = Math.pow(Math.max(0, Math.cos(rootLobeCount * (angle - rootLobePhase))), 2.5)
      const lobeAmp = t.flare * 0.55 * Math.pow(1 - u, 2.2)
      m *= baseFlare * (1 + lobeAmp * lobe)
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
    twistProfile: t.twistProfile,
    gnarl: t.gnarl,
    taperRatio: t.taper,
  })
  // 扭曲句柄用的引导线 (树干 + 每层代表枝的骨架采样)
  const twistGuides = { trunk: sampleGuidePoints(trunkFramesAll), branches: {} }

  // 分叉 (多主枝): 橡树这类乔木常在 1/3 高度处分成 2~4 条主枝
  // 关键: 主干**不截断** (截断会留一个可见的平截面), 而是继续向上当"主导枝";
  //       分叉点以上用 smoothstep 平滑变细 (载荷分给主枝), 主枝带"领口"从这里长出去。
  const forkCfg = t.fork || {}
  const forkOn = !!forkCfg.enabled && Math.round(forkCfg.count || 0) > 0
  const forkT = forkOn ? clamp01(forkCfg.height === undefined ? 0.34 : forkCfg.height) : 1
  const forkShrink = forkOn ? Math.max(0.2, Math.min(1, forkCfg.trunkShrink === undefined ? 0.62 : forkCfg.trunkShrink)) : 1
  const trunkFrames = trunkFramesAll
  const baseTrunkMod = trunkRadiusMod
  const trunkModifier = forkOn
    ? (tt, a, r) => {
        const u = Math.min(1, Math.max(0, (tt - (forkT - 0.07)) / 0.2))
        const s = u * u * (3 - 2 * u)
        return baseTrunkMod(tt, a, r) * (1 - (1 - forkShrink) * s)
      }
    : baseTrunkMod

  const squash = Math.max(0.2, t.squash || 1)
  // 树干实际截面 (含 flare/knots 与 squash): 子枝/树根的基部要贴在这个表面上
  const trunkSquashX = 1 / Math.sqrt(squash)
  const trunkSquashZ = Math.sqrt(squash)
  const trunkSlot = addSlot({
    type: 'trunk',
    level: 0,
    group: 'trunk',
    name: '树干',
    parent: null,
    meta: { length: t.height * forkT, radius: trunkR0, segments: Math.max(3, Math.round(t.segments)), fork: forkOn ? Math.round(forkCfg.count) : 0 },
  })
  // 树干: 登记为骨架根分支 (parent = null)。基部端盖在蒙皮阶段生成。
  const trunkBranch = addBarkBranch(barkSkeleton, {
    frames: trunkFrames,
    parent: null,
    slot: trunkSlot,
    type: 'trunk',
    level: 0,
    render: {
      radialSegments: Math.max(4, Math.round(t.radialSegments * ((P.lod && P.lod.barkDetail) || 1))),
      crossSection: 'round',
      squashX: trunkSquashX,
      squashZ: trunkSquashZ,
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
      radiusModifier: trunkModifier,
      vertexNoise: 0.03,
      tipRound: 0.05,
    },
  })
  branchCount++



  /* ------------------------------------------------------------------ */
  /* 树根                                                                */
  /* ------------------------------------------------------------------ */
  const R = P.roots
  if (R && R.enabled && R.count > 0) {
    const rootRng = makeRng(P.seed, 'roots')
    const rc = Math.max(1, Math.round(R.count))
    // 根系窗口错位: 两个粗根如果方位很接近, 又在同一高度开窗, 两个洞会挤在一起。
    // 按方位做贪心分层, 同一层里只放"角向不重叠"的根, 重叠的根分到更高的层。
    const rootTiers = [[], [], [], []]
    const rootStaggerGap = 0.075
    const rootHeightOffset = R.heightOffset === undefined ? 0 : Number(R.heightOffset) || 0
    const rootAutoStagger = R.autoStagger !== false
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
      // 树根基部落在"外扩后的真实树干表面"上, 且放在一个能完整容纳薄环带的
      // 高度 (太靠近 t=0 时环带会被 0 截断, 洞口很高而根环在底缘, 桥接拉成空腔)。
      const rootDirH = new THREE.Vector3(dir.x, 0, dir.z)
      if (rootDirH.lengthSq() < 1e-8) rootDirH.set(1, 0, 0)
      rootDirH.normalize()
      const rootEpsT = Math.min(0.12, Math.max(0.01, (radius0 * 1.15) / Math.max(1, t.height)))
      const rootBaseT = Math.min(0.2, Math.max(0.05, rootEpsT * 2.4))
      // 自动错位: 至少让相邻序号的根分到不同高度 (k%2), 再按角向冲突继续加层。
      let rootTier = rootAutoStagger && rc > 1 ? (k % 2) : 0
      if (rootAutoStagger) {
        // 根窗口的角向宽度 (粗根接近半圆, 用 asin 估算)
        const rootWidth = 2 * Math.asin(Math.min(0.95, radius0 / Math.max(0.05, t.baseRadius)))
        for (; rootTier < 3; rootTier++) {
          const conflict = rootTiers[rootTier].some((q) => {
            let da = Math.abs(q.az - az)
            da = Math.min(da, Math.PI * 2 - da)
            return da < (q.width + rootWidth) * 0.55 + 0.06
          })
          if (!conflict) break
        }
        rootTier = Math.min(rootTier, 3)
        rootTiers[rootTier].push({ az, width: rootWidth })
      }
      const rootT = Math.min(0.35, Math.max(0.02,
        rootBaseT + rootTier * rootStaggerGap + rootHeightOffset + rootRng.range(-0.008, 0.008)))
      const rootFrame = sampleFrame(trunkFrames, rootT)
      // 树根也跟随主干的扭转
      rootDirH.applyAxisAngle(rootFrame.dir, rootFrame.roll || 0)
      const rootBasis = frameBasisAt(trunkFrames, rootT)
      const rootAz = Math.atan2(rootDirH.dot(rootBasis.up), rootDirH.dot(rootBasis.side))
      const rootMod = trunkModifier(rootT, rootAz, rootFrame.radius)
      const rootProj = Math.hypot(Math.cos(rootAz) * trunkSquashX, Math.sin(rootAz) * trunkSquashZ)
      const rootSurfaceR = Math.max(rootFrame.radius, rootFrame.radius * rootMod * rootProj) * 0.99
      const frames = growFrames(rootRng, {
        startPos: rootFrame.pos.clone().addScaledVector(rootDirH, rootSurfaceR),
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
      // 树根也是骨架分支 (父分支 = 树干), 基部由蒙皮阶段切孔桥接, 梢部端盖
      addBarkBranch(barkSkeleton, {
        frames,
        parent: trunkBranch,
        slot: rootSlot,
        type: 'root',
        level: 0,
        render: {
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
          baseFlare: onePiece ? 0.06 : 0,
          baseFlareLen: 0.1,
          vertexNoise: 0.07,
          tipRound: 0.06,
        },
      })
      branchCount++
    }
  }

  /* ------------------------------------------------------------------ */
  /* 果实 (橡果等): 并进树皮几何 -> 共用树皮材质, 顶点色区分坚果/壳斗帽     */
  /* ------------------------------------------------------------------ */
  const spawnFruit = (frames, level, branchWind, parentSlot) => {
    const rng = fruitRng
    const count = Math.max(1, Math.round(F.perBranch))
    const per = Math.max(1, Math.round(F.clusterCount))
    const fruitTpl = buildFruitTemplate({
      type: F.type,
      color: F.color,
      capColor: F.capColor,
      radial: F.radial,
    })
    // 模板的 +Y 上端就是果柄末端 -> 让它正好落在枝条表面
    const stemHalf = fruitTpl.top
    // 枝条总长: 用来把"簇内偏移"换算成曲线参数, 免得偏移到枝条外面去
    const branchLen = Math.max(0.01, frames[frames.length - 1].pos.distanceTo(frames[0].pos))
    let fruitSlot = -1
    for (let k = 0; k < count; k++) {
      const tt = 0.35 + 0.65 * ((k + 0.5) / count) + rng.signed() * 0.06
      const fr0 = sampleFrame(frames, Math.min(0.98, Math.max(0.05, tt)))
      if (!fr0) continue
      for (let j = 0; j < per; j++) {
        // 同簇果实沿**枝长参数**散开 (不是在世界坐标里平移) -> 永远贴在枝条表面上
        // 簇内偏移: 换算成枝长参数后**上限 6%** —— 短枝上也不会把同簇果实甩到枝条两端
        const dT = Math.max(-0.06, Math.min(0.06, (rng.range(-F.clusterRadius, F.clusterRadius) * 1.2) / branchLen))
        const t = Math.min(0.995, Math.max(0.02, tt + dT))
        const fr = sampleFrame(frames, t)
        if (!fr) continue
        // 挂果方位: 绕枝轴随机, 以"枝条下表面"为主; 跟随扭曲曲线旋转
        const az = Math.PI + rng.range(-0.9, 0.9) + (fr.profileRoll || 0)
        const radial = azimuthPerp(fr.dir, az, new THREE.Vector3())
        if (radial.dot(UP) > 0) radial.negate()      // 指向下方 = 枝条下表面
        const surface = fr.pos.clone().addScaledVector(radial, Math.max(0.004, fr.radius) * 0.9)
        const scale = Math.max(0.01, F.size * rng.vary(F.sizeVariance))
        const scaleY = scale * 1.25
        // 果柄方向: 从果实指向枝条 (主要朝上, 略沿枝轴) -> 果实自然垂在枝下
        const stemDir = UP.clone().lerp(fr.dir, F.droop * 0.35 * rng.range(0.5, 1.3)).normalize()
        // 果柄末端贴着枝条表面 -> 果实中心 = 表面点 - 果柄方向 × 果柄长度
        const pos = surface.clone().addScaledVector(stemDir, -stemHalf * scaleY * 0.92)
        if (fruitCount >= Math.max(0, Math.round(F.maxCount === undefined ? 420 : F.maxCount))) continue
        if (fruitCount > 0 && !rng.chance(F.chance === undefined ? 0.5 : F.chance)) continue
        if (fruitSlot < 0) {
          levelFruitCounter[level] = (levelFruitCounter[level] || 0) + 1
          fruitSlot = addSlot({
            type: 'fruit',
            level,
            group: `fruit-L${level}`,
            name: `L${level} 果实簇 #${levelFruitCounter[level]}`,
            parent: parentSlot,
            meta: { fruit: 0, type: F.type },
          })
        }
        const tint = new THREE.Color(1, 1, 1).multiplyScalar(Math.max(0.2, 1 + rng.signed() * F.colorVariance))
        pushFruitInstance(fruitAcc, fruitTpl, {
          pos,
          dir: stemDir,
          roll: rng.range(0, Math.PI * 2),
          scale: new THREE.Vector3(scale, scaleY, scale),
          colorTint: tint,
          wind: Math.min(1, branchWind + 0.05),
          phase: rng.range(0, Math.PI * 2),
          grow: Math.min(1, LEVEL_GROW[Math.min(level, LEVEL_GROW.length - 1)][1] + 0.06),
          origin: surface.clone(),
          nodeId: fruitSlot,
        })
        // 记录挂果点 + 朝向证据 (自检用来验证"真的挂在枝条上"且"没有挂反")
        fruitAttach.push([surface.x, surface.y, surface.z])
        fruitOrient.push([
          Math.abs(fruitTpl.top * scaleY * 0.08) + pos.clone().addScaledVector(stemDir, fruitTpl.top * scaleY).distanceTo(surface),
          pos.clone().addScaledVector(stemDir, fruitTpl.bottom * scaleY).distanceTo(surface),
        ])
        fruitCount++
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 树枝                                                                */
  /* ------------------------------------------------------------------ */
  // 主干上的第一级枝条: 一直长到梢部 (主干不再截断)
  // 传入"真实树干表面"(含 flare/knots), 让贴主干生长的枝条基部不会埋在外扩内部。
  spawnChildren(trunkFrames, 0, t.height, trunkRng, 0.012, 0.2, trunkSlot, trunkBranch, null, {
    frames: trunkFrames,
    modifier: trunkModifier,
    squashX: trunkSquashX,
    squashZ: trunkSquashZ,
  })

  // 分叉主枝: 从主干内部伸出, 带领口融合; 主干自身继续向上作为主导枝
  if (forkOn) {
    const base1 = branchParams.level[0] || {}
    const fr = sampleFrame(trunkFramesAll, forkT)
    if (fr) {
      const rng = trunkRng.fork('fork-leaders')
      const n = Math.max(1, Math.min(6, Math.round(forkCfg.count) - 1))
      const angle = (forkCfg.angle === undefined ? 27 : forkCfg.angle) * DEG
      const spread = forkCfg.spread === undefined ? 0.85 : forkCfg.spread
      const radiusScale = forkCfg.radiusScale === undefined ? 0.66 : forkCfg.radiusScale
      const lengthScale = forkCfg.lengthScale === undefined ? 1.0 : forkCfg.lengthScale
      const leaderCfg = {
        ...base1,
        taper: forkCfg.taper === undefined ? 0.3 : forkCfg.taper,
        curve: forkCfg.curve === undefined ? 0.45 : forkCfg.curve,
        curveVariance: 0.55,
        gravity: forkCfg.gravity === undefined ? 0.03 : forkCfg.gravity,
        upBias: 0.1,
        segments: Math.max(5, Math.round((base1.segments || 8) * 0.9)),
      }
      // 记录已有 L1 枝在主干上的高度, 分叉主枝尽量避开它们的窗口高度。
      const projectTOnTrunk = (p) => {
        let best = 0, bestD = Infinity
        for (let i = 0; i < trunkFramesAll.length - 1; i++) {
          const a = trunkFramesAll[i].pos
          const b = trunkFramesAll[i + 1].pos
          const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
          const den = abx * abx + aby * aby + abz * abz || 1
          let u = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / den
          u = Math.max(0, Math.min(1, u))
          const qx = a.x + abx * u, qy = a.y + aby * u, qz = a.z + abz * u
          const d = (p.x - qx) ** 2 + (p.y - qy) ** 2 + (p.z - qz) ** 2
          if (d < bestD) { bestD = d; best = (i + u) / (trunkFramesAll.length - 1) }
        }
        return best
      }
      const occupiedT = barkSkeleton.branches
        .filter((b) => b.type === 'branch' && b.parent === 0)
        .map((b) => ({ t: projectTOnTrunk(b.frames[0].pos), r: b.frames[0].radius }))
      let trunkLen = 0
      for (let i = 1; i < trunkFramesAll.length; i++) trunkLen += trunkFramesAll[i].pos.distanceTo(trunkFramesAll[i - 1].pos)
      trunkLen = Math.max(1e-3, trunkLen)
      for (let k = 0; k < n; k++) {
        // 分叉主枝错开一点高度: 多条主枝如果都从 forkT 同一圈长出来,
        // 粗主枝的两个窗口会挤在主干同一处。这里给它们 ± 少量 t 偏移,
        // 并避开已有 L1 枝的高度; 窗口随各自基部走, 仍然对中。
        const nominalT = forkT + (k - (n - 1) / 2) * 0.05 + rng.range(-0.004, 0.004)
        let leaderT = Math.min(0.98, Math.max(0.02, nominalT))
        let bestClear = -Infinity
        const leaderR = Math.max(0.002, fr.radius * radiusScale)
        for (const off of [0, 0.03, -0.03, 0.06, -0.06, 0.09, -0.09, 0.12, -0.12, 0.15, -0.15, 0.18, -0.18, 0.21, -0.21]) {
          const cand = Math.min(0.98, Math.max(0.02, nominalT + off))
          let clear = Infinity
          for (const q of occupiedT) {
            const need = ((leaderR + q.r) * 1.15) / trunkLen + 0.012
            clear = Math.min(clear, Math.abs(cand - q.t) - need)
          }
          if (clear > bestClear) { bestClear = clear; leaderT = cand }
        }
        occupiedT.push({ t: leaderT, r: leaderR })
        const lf = sampleFrame(trunkFramesAll, leaderT) || fr
        const az = ((k + 0.5) / n) * Math.PI * 2 + rng.range(-0.5, 0.5) * spread
        const side = azimuthPerp(lf.dir, az, new THREE.Vector3())
        const dir = lf.dir.clone().applyAxisAngle(side, angle * rng.range(0.8, 1.25))
        rotateTowardUp(dir, 0.06)
        // 分叉主枝也要跟随主干的扭转 (基础 twist + 扭曲曲线)
        if (lf.roll) dir.applyAxisAngle(lf.dir, lf.roll)
        const r0 = Math.max(0.002, lf.radius * radiusScale * rng.vary(0.1))
        // 分叉主枝: 基部也要落在主干"真实表面"上 (含 forkShrink/squash/flare)。
        // 旧实现沿 dir 偏移 0.45R, 主枝环会深埋在主干内部, 桥接后洞口露出空腔,
        // 且与生长方向不对齐 (看起来像主枝插进树干再从里面穿出来)。
        const radialDir = dir.clone().addScaledVector(lf.dir, -dir.dot(lf.dir))
        if (radialDir.lengthSq() < 1e-10) radialDir.copy(side)
        radialDir.normalize()
        const lb = frameBasisAt(trunkFramesAll, leaderT)
        const la = Math.atan2(radialDir.dot(lb.up), radialDir.dot(lb.side))
        const lmod = trunkModifier(leaderT, la, lb.frame.radius)
        const lproj = Math.hypot(Math.cos(la) * trunkSquashX, Math.sin(la) * trunkSquashZ)
        const lr = Math.max(lf.radius, lb.frame.radius * lmod * lproj) * 0.95
        const startPos = lf.pos.clone().addScaledVector(radialDir, lr)
        buildBranch({
          level: 1,
          startPos,
          startDir: dir,
          length: Math.max(0.05, t.height * (1 - forkT) * lengthScale * rng.vary(0.16)),
          radius0: r0,
          radius1: Math.max(0.0008, r0 * leaderCfg.taper),
          cfg: leaderCfg,
          rng,
          wind0: 0.2,
          wind1: Math.min(1, 0.2 + 0.3 * (base1.windGain === undefined ? 1 : base1.windGain)),
          parentSlot: trunkSlot,
          parentBranch: trunkBranch,
          baseFlare: 0,
          baseFlareLen: 0.2,
        })
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 蒙皮 + 节点表                                                        */
  /* ------------------------------------------------------------------ */
  // 骨架图已完成 (含父子关系/贴合点) -> 一次性生成整张 2-manifold 树皮蒙皮。
  // 分叉在父环带上真实切孔并桥接, 树干基部与所有枝梢端盖封闭;
  // 不丢弃任何骨架分支, 不做最大连通过滤, 不用 SDF, 不逐枝建管再合并。
  finalizeBarkSkeleton(barkSkeleton)
  const skinMode = P.bark && P.bark.pipeline === 'speedtree' ? 'speedtree' : 'skin'
  const skin = skinMode === 'speedtree'
    ? buildSpeedtreeBark(barkSkeleton, {
      barkDetail: (P.lod && P.lod.barkDetail) || 1,
      validate: options.validate !== false,
    })
    : buildBarkSkin(barkSkeleton, {
      barkDetail: (P.lod && P.lod.barkDetail) || 1,
      validate: options.validate !== false,
    })
  let barkGeometry = skin.geometry
  if (fruitAcc.vertexCount > 0) {
    const fruitGeo = fruitAcc.build()
    const combined = mergeGeometries([barkGeometry, fruitGeo], false)
    if (combined) {
      // 保留 UV 接缝顶点对 (拓扑校验/导出检查要用), mergeGeometries 不会自动带过来
      combined.userData = { ...barkGeometry.userData }
      combined.computeBoundingBox()
      combined.computeBoundingSphere()
      barkGeometry.dispose()
      fruitGeo.dispose()
      barkGeometry = combined
    } else {
      fruitGeo.dispose()
    }
  }
  const leafGeometry = leafAcc.vertexCount > 0 ? leafAcc.build() : null

  /* ---- 花朵: 用花朵自己的设置独立采样 (层级/每枝数量/每簇数/分布起止/朝向) ---- */
  let flowerGeometry = null
  let flowerCount = 0
  if (flowerAcc && flowerBranches.length && FL.enabled) {
    const fTpls = [makeFlowerTemplate()]
    const flowerSlot = addSlot({
      type: 'flowers', level: FL.level || 3, group: 'flowers', name: '花朵',
      parent: trunkSlot, meta: { leaves: 0, clusters: 0 },
    })
    const fSize = FL.size === undefined ? 0.42 : FL.size
    const fWidth = FL.width === undefined ? 1 : FL.width
    const sizeVar = FL.sizeVariance === undefined ? 0.2 : FL.sizeVariance
    const c0 = new THREE.Color(FL.color || '#f2a7c3')
    const c1 = new THREE.Color(FL.colorTip || '#fbe3ec')
    const levelsOn = Array.isArray(FL.levels) ? FL.levels : null
    const perBranch = Math.max(1, Math.round(FL.perBranch === undefined ? 4 : FL.perBranch))
    const perCluster = Math.max(1, Math.min(12, Math.round(FL.clusterCount === undefined ? 2 : FL.clusterCount)))
    const tA = Math.min(FL.startT === undefined ? 0.2 : FL.startT, FL.endT === undefined ? 1 : FL.endT)
    const tB = Math.max(FL.startT === undefined ? 0.2 : FL.startT, FL.endT === undefined ? 1 : FL.endT)
    const density = Math.max(0.02, Math.min(1, FL.density === undefined ? 1 : FL.density))
    const clusterR = (FL.clusterRadius === undefined ? 0.16 : FL.clusterRadius) * (FL.clusterSpread === undefined ? 1 : FL.clusterSpread)
    const pitchRad = ((FL.pitch === undefined ? 55 : FL.pitch) * Math.PI) / 180
    const pitchVar = ((FL.pitchVariance === undefined ? 20 : FL.pitchVariance) * Math.PI) / 180
    const rollVar = FL.rollVariance === undefined ? 0.6 : FL.rollVariance
    const droopAmt = FL.droop === undefined ? 0 : FL.droop
    const upVec = new THREE.Vector3(0, 1, 0)
    const fRng = makeRng(P.seed, 'flowers')
    for (const br of flowerBranches) {
      const lvIdx = Math.max(0, Math.min((levelsOn ? levelsOn.length : 5) - 1, (br.level || 1) - 1))
      if (levelsOn && levelsOn[lvIdx] === false) continue
      for (let i = 0; i < perBranch; i++) {
        if (!fRng.chance(density)) continue
        const u = (i + 0.5) / perBranch
        let tt = tA + (tB - tA) * u + fRng.signed() * 0.04
        tt = Math.min(0.999, Math.max(0.01, tt))
        const fr = sampleFrame(br.frames, tt)
        if (!fr) continue
        const dir = fr.dir.clone()
        const perp = anyPerp(dir)
        const azimuthBase = i * 137.5 * DEG + fRng.range(0, Math.PI * 2) + (fr.profileRoll || 0)
        for (let c = 0; c < perCluster; c++) {
          const tpl = fTpls[Math.floor(fRng.next() * fTpls.length) % fTpls.length]
          const jitter = 1 + fRng.signed() * (FL.colorVariance === undefined ? 0.16 : FL.colorVariance) * 0.3
          const sv = fSize * (1 + fRng.signed() * sizeVar)
          const scale = new THREE.Vector3(sv * fWidth, sv, sv * fWidth)
          // 位置: 枝条表面 + 簇内散布
          const az = azimuthBase + (c / perCluster) * Math.PI * 2
          const radial = perp.clone().multiplyScalar(Math.cos(az)).add(new THREE.Vector3().crossVectors(dir, perp).multiplyScalar(Math.sin(az)))
          const pos = fr.pos.clone().add(radial.multiplyScalar(clusterR * fRng.range(0.2, 1)))
          // 朝向: 花轴 = 枝条方向 -> faceUp 朝上 -> 加俯仰 -> 下垂 -> 自转
          const by = dir.clone()
          if (FL.faceUp !== false) by.lerp(upVec, 0.45).normalize()
          const pitch = pitchRad + fRng.signed() * pitchVar
          const bx = perp.clone()
          const bz = new THREE.Vector3().crossVectors(bx, by).normalize()
          const byRot = by.clone().multiplyScalar(Math.sin(pitch)).add(bz.clone().multiplyScalar(Math.cos(pitch))).normalize()
          if (droopAmt) byRot.add(upVec.clone().multiplyScalar(-droopAmt * 0.4)).normalize()
          const spin = (FL.twist || 0) + fRng.signed() * rollVar
          const bxRot = bx.clone().applyAxisAngle(byRot, spin)
          const bzRot = new THREE.Vector3().crossVectors(bxRot, byRot).normalize()
          // 花朵模型旋转: 绕花面法线转整张花卡
          const flowerModelRot = (FL.modelRotation || 0) * DEG
          if (flowerModelRot) {
            bxRot.applyAxisAngle(bzRot, flowerModelRot)
            byRot.applyAxisAngle(bzRot, flowerModelRot)
          }
          const v0 = flowerAcc.vertexCount
          pushLeafInstance(
            flowerAcc, tpl,
            { x: bxRot, y: byRot, z: bzRot }, scale, pos,
            c0.clone().multiplyScalar(jitter), c1.clone().multiplyScalar(jitter),
            br.wind1 || 0, fRng.range(0, Math.PI * 2), pos.clone(), 0.5, 1, flowerSlot,
            tpl.stamenRange ? stamenCol : null,
          )
          flowerAoRanges.push([v0, flowerAcc.vertexCount, pos.x, pos.y, pos.z])
          flowerCount++
          aoSamples.push(pos.x, pos.y, pos.z)
        }
      }
    }
    if (flowerSlot >= 0 && slots[flowerSlot]) {
      slots[flowerSlot].meta.leaves = flowerCount
      slots[flowerSlot].meta.clusters = flowerBranches.length
    }
    if (flowerAcc.vertexCount > 0) flowerGeometry = flowerAcc.build()
  }

  /* ------------------------------------------------------------------ */
  /* 程序化 AO: 用叶片/花朵点云估算遮挡, 乘进顶点色 (可导出到 GLB)          */
  /* ------------------------------------------------------------------ */
  const aoStats = { enabled: false, samples: aoSamples.length / 3, threshold: 0 }
  const AO = P.ao || {}
  if (AO.enabled !== false && (AO.strength || 0) > 0 && aoSamples.length >= 9) {
    const grid = buildOcclusionGrid(aoSamples, AO.radius === undefined ? 0.9 : AO.radius)
    const strength = Math.max(0, Math.min(1, AO.strength))
    // 树皮: 逐顶点 (枝条本身就是大面积表面); 叶片/花朵: 每个实例只查一次中心
    const b = bakeOcclusion(barkGeometry, grid, strength)
    const l = leafGeometry ? bakeOcclusionByRanges(leafGeometry, grid, strength, leafAoRanges) : null
    const f = flowerGeometry ? bakeOcclusionByRanges(flowerGeometry, grid, strength * 0.7, flowerAoRanges) : null
    aoStats.enabled = true
    aoStats.threshold = b.threshold
    aoStats.affected = (b.affected || 0) + (l ? l.affected : 0) + (f ? f.affected : 0)
  }

  const { nodes, groups } = finalizeNodes(slots, barkGeometry, leafGeometry)

  const bInfo = boxInfo(barkGeometry)
  const lInfo = leafGeometry ? boxInfo(leafGeometry) : null
  const maxY = lInfo ? Math.max(bInfo.max.y, lInfo.max.y) : bInfo.max.y
  const minY = Math.min(bInfo.min.y, lInfo ? lInfo.min.y : bInfo.min.y)
  const maxXZ = Math.max(bInfo.size.x, bInfo.size.z, lInfo ? Math.max(lInfo.size.x, lInfo.size.z) : 0)

  return {
    barkGeometry,
    leafGeometry,
    flowerGeometry,
    nodes,
    groups,
    twistGuides,
    // 骨架图与蒙皮统计 (自检 / dev 检查页 / 调试用):
    // stats.skin.validation = { boundary, nonManifold, components, skinnedBranches, ... }
    skeleton: barkSkeleton,
    skinStats: skin.stats,
    stats: {
      branches: branchCount,
      leaves: L.enabled ? leafCount : 0,
    fruit: fruitCount,
    fruitAttach,
    fruitOrient,
      barkTriangles: barkGeometry.index ? barkGeometry.index.count / 3 : 0,
      leafTriangles: leafGeometry && leafGeometry.index ? leafGeometry.index.count / 3 : 0,
      barkVertices: barkGeometry.attributes.position ? barkGeometry.attributes.position.count : 0,
      leafVertices: leafGeometry ? leafGeometry.attributes.position.count : 0,
    flowers: flowerCount,
    flowerTriangles: flowerGeometry && flowerGeometry.index ? flowerGeometry.index.count / 3 : 0,
    flowerVertices: flowerGeometry ? flowerGeometry.attributes.position.count : 0,
      skin: skin.stats,
      buildMs: now() - t0,
      height: maxY - minY,
      spread: maxXZ,
      trunkLength: t.height,
      levelCount: branchParams.levels,
      nodeCount: nodes.length,
      ao: aoStats,
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
  { id: 'fruit-L1', name: '果实 L1', icon: '🌰', type: 'fruit', level: 1 },
  { id: 'fruit-L2', name: '果实 L2', icon: '🌰', type: 'fruit', level: 2 },
  { id: 'fruit-L3', name: '果实 L3', icon: '🌰', type: 'fruit', level: 3 },
  { id: 'fruit-L4', name: '果实 L4', icon: '🌰', type: 'fruit', level: 4 },
  { id: 'fruit-L5', name: '果实 L5', icon: '🌰', type: 'fruit', level: 5 },
  { id: 'material-bark', name: '材质 · 树皮', icon: '🎨', type: 'material', material: 'bark' },
  { id: 'material-leaf', name: '材质 · 树叶', icon: '🎨', type: 'material', material: 'leaf' },
]

/** 把一根枝条的骨架按 t 均匀采样成扭曲句柄的引导线 (扁平 xyz 数组) */
function sampleGuidePoints(frames, n = 17) {
  const out = []
  if (!frames || !frames.length) return out
  const count = Math.max(2, n)
  for (let i = 0; i < count; i++) {
    const fr = sampleFrame(frames, i / (count - 1))
    if (!fr) continue
    out.push(fr.pos.x, fr.pos.y, fr.pos.z)
  }
  return out
}

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

