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
 *
 * 输入 / 输出:
 *   输入 = finalizeBarkSkeleton + enforceChildBranchRadii 之后的骨架图 (核心是 branch.frames);
 *   输出 = { geometry, stats, validation, rings: null, ringM, debug }
 *          —— 与 buildBarkSkin 的返回结构同形, treeBuilder 因此可以在两条管线之间直接切换。
 *
 * 为什么可以接受 components = branches.length:
 *   重叠式管体的接缝藏在父枝内部, 画面里看不见; 代价是内部多了隐藏面 (多画一点),
 *   换来的是生成逻辑极简 (不用窗口规划/占位/桥接), 且单根管体永远完美闭合 ——
 *   极端分叉 (子枝比父枝还粗、一圈挂几十根子枝) 也不会开孔。
 *   注意: 所以本文件的拓扑期望值是 components === branches.length, 而 barkSkin 是 === 1
 *   (见 buildSpeedtreeBark 末尾的 validation.ok 判据)。
 *
 * 关键概念 / 约定:
 *   - 几何单位: 米; 环坐标系用平行移动 (parallel transport) 推进, 见 buildRingBases;
 *   - 每圈渲染 M 个面, 但存 M+1 个顶点: 第 M 个是与第 0 列位置/法线相同的"UV 接缝复制顶点";
 *     它让 uv.x 从 0 连续走到 uRepeat 而不回卷, 否则最后一格贴图会被拉伸回 0;
 *   - aNodeId 写 branch.slot, 供节点树选中/高亮/拆分导出归属;
 *   - 所有随机/噪声都不在这里产生 (顶点噪声只在 barkSkin 里), 因此本文件是纯确定性的。
 */

import * as THREE from 'three'
import { GeoAcc, anyPerp, clamp01 } from './mathUtils.js'
import { analyzeTopology, branchSkinCoverage } from './meshTopology.js'

const TAU = Math.PI * 2

/**
 * 把 render.color (可能是 THREE.Color、[r,g,b] 数组或缺失) 统一成 {r,g,b} 普通对象。
 * 缺省时用调用方给的 fallback (树皮默认灰褐色 0.75/0.68/0.6), 避免下游拿到 undefined
 * 再去乘除产生 NaN。
 * @param {THREE.Color|Array<number>|null|undefined} c 颜色输入
 * @param {{r:number,g:number,b:number}} fallback 缺省颜色 (线性 0..1)
 * @returns {{r:number,g:number,b:number}} 线性 RGB, 0..1
 */
function rgb(c, fallback) {
  if (c && c.isColor) return { r: c.r, g: c.g, b: c.b }
  if (Array.isArray(c)) return { r: c[0] || 0, g: c[1] || 0, b: c[2] || 0 }
  return fallback
}

/**
 * 平滑阶跃 3t²-2t³ (把 0..1 映射到 0..1, 两端导数为 0)。
 * 用于颜色渐变/领口过渡, 保证过渡区两端没有折线感 (线性插值会在两端留下明显的棱)。
 * @param {number} x 输入, 会被 clamp 到 0..1
 * @returns {number} 平滑后的 0..1
 */
function smooth01(x) {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

/**
 * 生成每帧的环坐标系 { side, up }。
 *
 * 用**平行移动 (parallel transport)** 推进: 每步把上一帧的 side 投影到当前帧的切平面上
 * (side -= (side·dir)·dir) 再归一化, 而不是每帧重新对固定参考轴叉乘 —— 后者在枝条方向
 * 接近参考轴时会发生 180° 跳变, 表现为贴图沿枝条突然扭一下。
 *
 * roll (弧度) 是骨架给截面朝向的额外旋转 (星形角位/方形截面朝向), 按帧间**增量**施加;
 * 第 0 帧则直接施加绝对 roll。旋转后再投影一次, 兼作数值纠偏。
 *
 * @param {Array<{dir: THREE.Vector3, roll?: number}>} frames 骨架帧 (dir 已归一化)
 * @returns {Array<{side: THREE.Vector3, up: THREE.Vector3}>} 每帧正交基 (up = dir × side)
 */
function buildRingBases(frames) {
  const bases = []
  // 起始帧的 side 用 anyPerp 现取 (与方向垂直且完全确定, 不含随机)。
  const side = anyPerp(frames[0].dir.clone()).normalize()
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (i > 0) {
      // ① 投影: 去掉 side 在当前切平面法向 (dir) 上的分量, 剩下的就是"上一帧 side 在
      //    新切平面上的最佳延续", 这样相邻两环的 0 列始终对齐。
      side.addScaledVector(f.dir, -side.dot(f.dir))
      // ② 退化兜底: 若 side 恰好与 dir 共线 (方向反转 180°), 投影后长度为 0, 重新取任意垂线。
      if (side.lengthSq() < 1e-10) anyPerp(f.dir, side)
      side.normalize()
      // ③ 帧间 roll 增量绕 dir 旋转; 只有增量非零时才付旋转矩阵的代价。
      const rollDelta = (f.roll || 0) - (frames[i - 1].roll || 0)
      if (rollDelta) side.applyAxisAngle(f.dir, rollDelta)
      // ④ 旋转后可能因浮点累积微小离面分量, 再投影 + 归一化一次。
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
 *
 * 构造方式 (以子枝基部半径 r0 为基准, 沿 -dir 方向往父枝里退):
 *   - 退 embed = 1.25·r0 处是第 0 圈, 半径 1.38·r0: 整圈埋进父枝内部, 于是从外面
 *     只看得到管壁, 看不到"管口边缘"那条硬边 (也避免与父枝表面 z-fighting);
 *   - 退 0.45·embed 处是第 1 圈, 半径 1.14·r0: 领口外扩的过渡环, 让半径沿
 *     1.38 -> 1.14 -> 1.0 回落, 看起来像树皮在分叉处的隆起, 而不是突然一张伞边。
 *
 * 为什么是这几个数: 1.38 要同时盖住 (a) 管壁与父枝表面的交线、(b) 父枝自身的截面起伏;
 * 38% 是"遮得住缝"与"领口别像套了个塑料环"之间的折中。1.25 的埋深保证即使父枝在
 * 该处被 radiusModifier 收细, 封口也不会露出来 (子枝半径已被限制在父枝的 80% 内)。
 *
 * 领口帧的 t 一律写 0: 它们属于基部, 风场柔度/颜色都应取基部值, 否则领口会跟着梢部摆动。
 *
 * @param {object} branch 骨架分支 (用到 frames 与 parent)
 * @returns {{frames: Array, virtualCount: number}} 拼接后的帧序列 (虚拟领口帧在前) 与虚拟帧数
 */
function tubeFrames(branch) {
  const frames = branch.frames
  const f0 = frames[0]
  // 没有父枝的分支 (树干/主根) 不需要领口: 它的基部由封盖收口, 也没有"要遮的缝"。
  if (branch.parent === null || branch.parent === undefined) {
    return { frames, virtualCount: 0 }
  }
  // 0.001 下限防零半径: 半径为 0 时领口尺寸也为 0, 退化成一堆重合顶点。
  const r0 = Math.max(0.001, f0.radius)
  const embed = r0 * 1.25
  const back = f0.pos.clone().addScaledVector(f0.dir, -embed)
  const mid = f0.pos.clone().addScaledVector(f0.dir, -embed * 0.45)
  // 用 {...f0} 继承 dir / roll / profileRoll 等字段, 只覆盖 pos/radius/t ——
  // 这样领口的环坐标系与基部截面朝向完全一致, 不会出现"领口比管体多了个扭转"。
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

/**
 * 单个环顶点处的半径调制: 截面形状 / 半径回调 / 基部 flare / 末梢圆头。
 *
 * 与 barkSkin.ringModifier 同构, 区别是这里 f.t 可能来自骨架帧 (t>0) 也可能来自
 * tubeFrames 的虚拟领口帧 (t=0); 虚拟帧的调用方会跳过本函数直接用显式半径。
 *
 * 魔法数来历:
 *   - square 的 0.62 下限: 1/max(|cos|,|sin|) 在 45° 处等于 √2 ≈ 1.414, 不加下限时
 *     方形截面的四个角会尖到 1.41 倍半径, 看着像四角星; 截到 0.62 后角部最多比
 *     边长方向短 ~38%, 像一个圆角方管。
 *   - star 的 (0.5 + 0.5·cos(angle·points)): 在 [0,1] 之间起伏, 乘以 starDepth 后
 *     只把凹陷处压下去 (凸起仍是 1.0 倍半径), 因此不会整体缩小截面。
 *   - baseFlareLen 默认 0.14: 树干基部外扩段的归一化长度, 走到 14% 枝高才完全消失。
 *   - tipRound 用 sqrt(1-u²): 圆剖面收口, 末梢是半球形而不是锥尖。
 *
 * @param {object} branch 骨架分支 (用到 render 与 frames)
 * @param {{t:number, radius:number}} f 该环的骨架帧 (t 为 0..1 归一化位置)
 * @param {number} angle 环上的角度 (弧度, 0..2π)
 * @returns {number} 半径倍率 (1 = 不调制), 已含所有调制项
 */
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

/**
 * 生成 SpeedTree 风格的树皮几何: 每根骨架分支一根独立闭合管 (重叠式, 无跨枝桥接)。
 *
 * 单根管体的构造顺序 (见下面 ①~④ 分节):
 *   ① 逐帧生成截面环 (含领口帧), 每圈存 M+1 个顶点 (第 M 个是 UV 接缝复制顶点);
 *   ② 相邻两圈之间铺侧壁三角带 (跳过接缝格里"回到 0 列"的那条边);
 *   ③ 两端各加一个三角扇封口 (基部朝 -dir, 梢部朝 +dir, 绕序相反);
 *   ④ 全部枝条装完后一次性 build(), 再跑拓扑自检。
 *
 * @param {object} skeleton finalizeBarkSkeleton + enforceChildBranchRadii 之后的骨架
 * @param {{barkDetail?:number, validate?:boolean}} [opts]
 *   barkDetail: 周向分段倍率 (LOD 用), 乘出来的 M 仍会被 clamp 到 [3,48]
 *   validate  : 默认 true, 构建后立刻跑 analyzeTopology + branchSkinCoverage
 * @returns {{geometry: THREE.BufferGeometry, stats: object, validation: object|null,
 *            rings: null, ringM: Array<number>, debug: {mode: string}}}
 *   rings 恒为 null: 本管线没有跨分支共享的环表 (barkSkin 才有), 保持返回结构同形只为上层统一处理。
 */
export function buildSpeedtreeBark(skeleton, opts = {}) {
  const barkDetail = opts.barkDetail === undefined ? 1 : opts.barkDetail
  const branches = skeleton.branches
  const acc = new GeoAcc()
  // 每个接缝复制顶点与原顶点的配对 [复制顶点, 原顶点]; 后期焊回用于拓扑判定。
  const seamPairs = []
  // 每根分支实际使用的周向面数, 回传给 stats 便于排查"参数没生效"。
  const radialByBranch = []
  let caps = 0

  /* ---------------- ① 逐根分支独立建管 ---------------- */
  for (const branch of branches) {
    const r = branch.render || {}
    const tf = tubeFrames(branch)
    const frames = tf.frames
    const virtualCount = tf.virtualCount
    const bases = buildRingBases(frames)
    // 周向面数: 用户分段 × barkDetail, clamp 到 [3,48]。
    // 3 = 三角管的下限 (再少就不是管了); 48 = 单根枝条画到这个数已远超屏幕像素,
    // 再多只是白烧顶点 (树可能有上千根枝条)。
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
    // U 方向重复次数按"这一圈的周长"折算: 粗细不同的枝条纹理密度因此接近,
    // 不会出现"树干上贴图被拉宽、细枝上被挤碎"。clamp 到 [1,24] 兜住极端半径。
    const uRepeat = Math.max(1, Math.min(24, Math.round(TAU * avgR * uvScaleU)))

    const ringStarts = []
    // arc = 从基部累计到当前帧的**弧长** (米), 直接当 v 坐标用:
    // 这样 U (周向) 与 V (纵向) 都以米为尺度, 贴图在两个方向上的密度一致, 不会斜着拉伸。
    let arc = 0
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      if (i > 0) arc += f.pos.distanceTo(frames[i - 1].pos)
      const basis = bases[i]
      // 记录本圈第一个顶点的全局下标; 后面的侧壁/封口都用 "ringStarts[i] + 列号" 寻址。
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
        // j 走 0..M 共 M+1 个顶点; jm = j % M 让第 M 个顶点复用第 0 列的角度与半径
        // (位置/法线完全相同), 唯一不同的是 uv.x = (M/M)*uRepeat —— 这就是 UV 缝。
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
      // 记下一对 "接缝复制顶点 -> 原顶点": 第 M 号与第 0 号位置/法线完全相同。
      // 渲染时它们的 uv.x 不同 (0 vs uRepeat), 拓扑校验时按这对焊回 —— 于是
      // "渲染上有 UV 缝、几何上仍是封闭流形", 两个需求不打架。
      seamPairs.push([baseIndex + M, baseIndex])
    }

    // 侧壁: 每格用接缝复制顶点 (最后一格 j=M-1 -> M)
    // 每格拆两个三角形, 绕序统一为"从管外看逆时针" -> 法线朝外 (与下面的封口绕序配套)。
    // 支撑点全部取"环起点 + 列号", 所以 M 变化不影响索引换算。
    for (let i = 0; i < frames.length - 1; i++) {
      const a = ringStarts[i]
      const b = ringStarts[i + 1]
      for (let j = 0; j < M; j++) {
        // j2 末尾取到 M (= 接缝复制顶点), 而不是回到 0: 保证 UV 连续、贴图不在末格回卷。
        const j2 = j + 1
        acc.tri(a + j, a + j2, b + j2)
        acc.tri(a + j, b + j2, b + j)
      }
    }

    // 两端封口 (基部封口藏在父枝内部; 树梢封口)
    // 封口 = 一个中心顶点 + 一圈三角扇。中心顶点法线取 ±dir (与管壁方向一致),
    // 所以封口与管壁在光栅化后没有硬阴影边界。
    {
      const f = frames[0]
      const ci = acc.vertex(
        f.pos.x, f.pos.y, f.pos.z,
        -f.dir.x, -f.dir.y, -f.dir.z,
        0, 0, color.r, color.g, color.b,
        wind0, phase, origin.x, origin.y, origin.z, grow[0], grow[1], slot,
      )
      const a0 = ringStarts[0]
      // 绕序 (j+1, j, 中心) 与梢部相反: 基座朝 -dir, 从外侧看同样要逆时针 -> 法线朝外。
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
      // 梢部绕序 (j, j+1, 中心) 与基部相反: 中心点朝 +dir, 从外侧看仍是逆时针 -> 法线朝外。
      for (let j = 0; j < M; j++) acc.tri(b0 + j, b0 + ((j + 1) % M), ci)
      caps++
    }
  }

  /* ---------------- ② 装配几何 + 拓扑自检 ---------------- */
  const geometry = acc.build()
  // 把接缝配对挂到 userData: meshTopology / 导出校验 / mergeGeometries 之后都要用它焊回。
  if (seamPairs.length) geometry.userData.seamPairs = seamPairs

  // stats 与 barkSkin 的字段保持同名同义, 只多了 mode 并让窗口相关字段恒为 0
  // (本管线不切窗口)。componentsExpected 记的是"期望的连通分量数 = 分支数",
  // 与 barkSkin 的 1 不同, UI/自检按 mode 分别解读。
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
    // 校验口径: 先用 seamPairs 把 UV 缝顶点焊回, 再统计边界边/非流形边/顶点/分量。
    // ok 的五个条件 (缺一不可):
    //   boundary=0        每根管体都真的闭合 (没有漏面的洞);
    //   nonManifold=0     没有一条边被 >2 个面共享;
    //   nonManifoldVertices=0  没有"两个锥体在一点相接"这种点非流形;
    //   components=branches.length  分量数恰好等于分支数 —— 多一个说明某根管断开,
    //                     少一个说明两根管意外共享了面 (那就不再是"独立管"了);
    //   missing=0         每根骨架分支都至少有一个面 (aNodeId 覆盖)。
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
