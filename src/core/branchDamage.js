/**
 * 断枝破损 (Broken Branch / Fracture)
 * ------------------------------------------------------------
 * 作用: 把「古树特征 → 断枝概率」从"截短 + 变深色"升级成**真实断口**:
 *       骨架在断口处截断 → 残枝受自重下垂 → 截面上生成锯齿木芯面、碎裂树皮环与木刺。
 * 输入 / 输出:
 *   输入 = treeBuilder 长出来的枝条骨架帧 (frames) + 参数 P.oldTree + 断枝专属随机子流;
 *   输出 = ① 就地截断/下垂后的 frames + 一份断口形状"配方" (plan),
 *          ② 由配方生成的断口几何 (写进调用方给的 GeoAcc, 最终并进树皮几何)。
 * 与其他模块的关系:
 *   - treeBuilder.buildBranch / buildSpaceColonization 在本模块拿到 plan, 把 plan 挂在
 *     骨架分支的 branch.damage 上; 蒙皮 (barkSkin / speedtreeBark) 长完后, treeBuilder
 *     再调 buildFractureGeometry 把断口几何并进树皮 —— 这样两条蒙皮管线**都不需要改**,
 *     它们的"闭合流形/分量数"验收也不受影响 (断口是额外叠上去的独立壳)。
 *   - 颜色与风场属性沿用枝条 render 里的 wind/phase/origin/grow, 因此断口会跟着枝梢一起摆;
 *     aNodeId 写 branch.slot, 节点树选中/隔离/导出拆分都能正确归属。
 * 关键概念 / 约定:
 *   - 断口是**独立随机子流** ('damage'): 调木刺数量/锯齿强度不会挪动树干与其它枝条的位置
 *     (随机流纪律见 rng.js; 旧代码用生长流抽断枝概率, 这里保持不变以兼容既有种子);
 *   - 断裂位置 = deadLength (+ deadLengthVariance 抖动), 用精确插值帧落在该 t 上,
 *     不是"砍到最近的骨架帧" —— 否则改 0.45 → 0.5 会整格跳变, 滑杆不跟手;
 *   - 断口几何是**平面着色** (每个三角形独立顶点/法线): 木刺与碎裂环需要硬边才像劈裂,
 *     平滑法线会把它们糊成一团;
 *   - 单位: 位置/半径米, 角度弧度; 颜色是线性 0..1 (three 的 Color 已转工作空间)。
 * 注意:
 *   - 本模块不消费任何全局随机, 只消费传入的 rng; 同一 seed + 同一 params 必得同一断口;
 *   - 各 *强度型* 参数为 0 时**不消耗随机数**, 保证"关闭功能 = 旧树形逐字节不变"。
 */

import * as THREE from 'three'
import { clamp01, sampleFrame, anyPerp, rotateTowardUp } from './mathUtils.js'

const TAU = Math.PI * 2

/** 断口木芯默认色 (新劈开的木质部: 偏暖的浅木色) */
export const DEFAULT_HEART_COLOR = '#c9b085'

/**
 * 把参数里的 oldTree (可能来自旧存档/脏数据) 清洗成断枝可用的配置。
 *
 * 所有数值都夹到安全区间: 长度比例 × 方差不能把断口推到枝条基部之外, 木刺数量上限 12
 * (再多在视觉上只是重叠, 白烧三角面), 下垂上限 1.2 rad (≈69°, 再大就像折断了两次)。
 * deadLevels 缺省/长度不足时按"全部层级都可断"补齐。
 *
 * @param {object} [oldTree] 参数里的 oldTree 子对象 (可缺省)
 * @returns {object} 归一化后的断枝配置 (含 heart 线性颜色)
 */
export function resolveDamageConfig(oldTree) {
  const o = oldTree && typeof oldTree === 'object' ? oldTree : {}
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const levels = Array.isArray(o.deadLevels) ? o.deadLevels.slice(0, 5) : []
  while (levels.length < 5) levels.push(true)
  // 颜色: THREE.Color 会把 sRGB 十六进制转成线性工作空间, 与其它顶点色同源。
  // 输入容错: 允许省略 '#' (THREE.Color 只认带 # 的十六进制, 否则会静默退回白色)。
  const rawHeart = typeof o.heartColor === 'string' ? o.heartColor.trim() : ''
  const hex = /^#?[0-9a-f]{6}$/i.test(rawHeart) ? `#${rawHeart.replace(/^#/, '')}` : DEFAULT_HEART_COLOR
  const heart = new THREE.Color(hex)
  return {
    // 每根枝条成为断枝的概率 (0 = 关闭, 不消耗随机数、不生成断口几何)
    deadChance: clamp01(num(o.deadChance, 0)),
    // 断枝保留长度 ÷ 原长
    deadLength: Math.max(0.08, Math.min(0.96, num(o.deadLength, 0.45))),
    // 断口位置抖动 (相对枝长): 0 = 所有断枝在同一比例处断
    deadLengthVariance: Math.max(0, Math.min(0.4, num(o.deadLengthVariance, 0.12))),
    // 哪些层级允许断枝 (下标 = 枝级-1)
    deadLevels: levels.map((on) => on !== false),
    // 断口下垂 (弧度): 残枝按权重 u^1.4 逐渐朝地面弯, 模拟断口失去支撑后的自重
    deadDroop: Math.max(0, Math.min(1.2, num(o.deadDroop, 0.35))),
    // 断口锯齿强度 0..1 (0 = 平截面, 但木刺仍可单独开启)
    breakJagged: clamp01(num(o.breakJagged, 0.6)),
    // 每处断口的木刺数量 0..12
    breakSplinters: Math.max(0, Math.min(12, Math.round(num(o.breakSplinters, 5)))),
    // 木刺长度 ÷ 断口半径
    splinterLength: Math.max(0, Math.min(6, num(o.splinterLength, 1.6))),
    heartColor: hex,
    heart,
  }
}

/**
 * 该枝级是否允许断枝。
 * @param {object} cfg resolveDamageConfig 的结果
 * @param {number} level 枝级 (1..5)
 * @returns {boolean} true = 这一层可以被折断
 */
export function damageLevelAllowed(cfg, level) {
  if (!cfg || !Number.isFinite(level)) return false
  const i = Math.round(level) - 1
  return i >= 0 && i < 5 ? cfg.deadLevels[i] !== false : false
}

/**
 * 把一根枝条的骨架截断在断口处, 并让残枝下垂。
 *
 * 执行顺序 (不能换):
 *   ① 在**原始帧**上按 cutT 精确采样断口帧 (插值 pos/dir/radius/roll), 断口才不会整格跳变;
 *   ② splice 掉断口之后的帧, 再把断口帧补回去 (t 保持原始归一化位置, 蒙皮的风/配色仍连续);
 *   ③ 残枝下垂: 从基部到断口按 u^1.4 逐渐加大俯仰, 位置按"原段长"重新串起来,
 *      因此下垂只改变弯向, 不改变残枝长度。
 *
 * @param {Array<object>} frames 枝条骨架帧 (原地截断/弯曲)
 * @param {number} level 枝级 (1..5)
 * @param {object} cfg resolveDamageConfig 的结果
 * @param {import('./rng.js').Rng} rng 断枝专属随机子流
 * @returns {object|null} 断口配方 (plan); 不满足条件时返回 null (frames 不变)
 */
export function breakBranchFrames(frames, level, cfg, rng) {
  if (!cfg || cfg.deadChance <= 0) return null
  if (!Array.isArray(frames) || frames.length < 3) return null
  if (!damageLevelAllowed(cfg, level)) return null
  const n = frames.length
  // 断口位置: 基准 ± 抖动; 夹在 12%~96% 之间 (再靠基部就不是"断枝"而是"截干",
  // 再靠梢部则断口半径太小, 木刺与锯齿都看不见)
  const jitter = cfg.deadLengthVariance > 0 ? rng.signed() * cfg.deadLengthVariance : 0
  const cutT = Math.max(0.12, Math.min(0.96, cfg.deadLength + jitter))
  // ② 精确断口帧 (必须在截断前采样: 截断后就拿不到后面那段曲线了)
  const cut = sampleFrame(frames, cutT)
  // keep = 断口之前保留的骨架帧数; 至少 2 帧 (1 帧无法确定方向, 蒙皮会退化)
  const keep = Math.max(2, Math.min(n - 1, Math.round(cutT * (n - 1))))
  frames.splice(keep)
  // 断口帧与最后一帧重合时不必再补 (否则会出现两圈几乎重合的环, 法线抖动)
  if (cut && cutT - frames[frames.length - 1].t > 1e-6) {
    frames.push({
      pos: cut.pos,
      dir: cut.dir,
      radius: cut.radius,
      t: cutT,
      roll: cut.roll,
      profileRoll: cut.profileRoll,
    })
  }
  // ③ 断口下垂: 只改 dir 与后续 pos, 保持每段原长
  if (cfg.deadDroop > 0.001 && frames.length > 2) {
    const origin = frames.map((f) => f.pos.clone())
    const steps = []
    for (let i = 1; i < frames.length; i++) steps.push(origin[i].distanceTo(origin[i - 1]))
    const m = frames.length - 1
    for (let i = 1; i <= m; i++) {
      const u = i / m
      const dir = frames[i].dir.clone()
      rotateTowardUp(dir, -cfg.deadDroop * Math.pow(u, 1.4))
      dir.normalize()
      frames[i].dir.copy(dir)
      frames[i].pos.copy(frames[i - 1].pos).addScaledVector(dir, steps[i - 1])
    }
  }
  // 断口配方: 形状随机量在这里一次性抽完 (之后生成几何时不再碰随机流)。
  // 强度为 0 的形状项**不抽随机数** (与项目里"关闭即不消耗随机流"的约定一致);
  // shape=false 表示"只截短、不叠断口几何" (锯齿与木刺都关掉时的旧行为)。
  const jaggedOn = cfg.breakJagged > 0
  const jagPhase = jaggedOn
    ? [rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)]
    : [0, 0, 0]
  const plan = {
    level,
    cutT,
    shape: jaggedOn || cfg.breakSplinters > 0,
    // 锯齿/外翻的相位 (整数谐波, 两圈接缝处首尾天然连续)
    jagPhase,
    // 断口轴向起伏相位 (让断口不是一个平面切过去的)
    axialPhase: jaggedOn ? rng.range(0, TAU) : 0,
    splinters: [],
    /** 断口半径 (米): 取截断后的最后一帧半径; 供断口几何与自检共用 */
    radius: Math.max(0.0015, frames[frames.length - 1].radius),
  }
  const count = cfg.breakSplinters
  if (count > 0) {
    // 木纤维不是"一圈均匀撕开"的: 它们集中在一个主方向上参差断裂, 所以先抽一个撕裂主方向,
    // 再让木刺围绕它 ±68° 散开 —— 均匀分布会变成一朵"星形花", 完全不像断枝。
    const tearAngle = rng.range(0, TAU)
    for (let k = 0; k < count; k++) {
      plan.splinters.push({
        // 木刺在断口上的方位 (围绕撕裂主方向 + 抖动)
        angle: tearAngle + rng.range(-1.2, 1.2),
        // 长度倍率 (相对断口半径): 第一根通常最长, 其余更短 —— 真实断口的木刺长短差很大
        length: rng.range(0.45, 1.05) * (k === 0 ? 1.55 : 1),
        // 外张程度: 木刺基本顺着枝轴, 只轻微外翻 (太外张就成了放射状的花瓣)
        flare: rng.range(0.05, 0.35),
        // 重力下垂: 木刺太长会轻微耷拉
        sag: rng.range(0, 0.28),
        // 绕自身轴的滚转 (改变三棱木刺的朝向, 让它们不共面)
        roll: rng.range(0, TAU),
        // 粗细倍率 (细长条才像劈裂的木纤维)
        width: rng.range(0.55, 1.05),
      })
    }
  }
  return plan
}

/**
 * 把断口面上的一条边换算成 UV (米制: u = 周向周长, v = 轴向长度)。
 * 树皮贴图按米铺开, 因此断口上的纹理密度与管壁一致, 不会出现"断口贴图变小"。
 * @param {number} angleFrac 0..1 的周向比例
 * @param {number} radius 断口半径 (米)
 * @param {number} axial 轴向位置 (米)
 * @returns {[number, number]} uv
 */
function rimUv(angleFrac, radius, axial) {
  return [angleFrac * TAU * radius, axial]
}

/**
 * 混合两种线性颜色。
 * @param {{r:number,g:number,b:number}} a 基色
 * @param {{r:number,g:number,b:number}} b 目标色
 * @param {number} t 0 = 全 a, 1 = 全 b
 * @returns {{r:number,g:number,b:number}} 混合结果 (未 clamp, 调用方按需 clamp)
 */
function mixRgb(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

/**
 * 断口外沿相对骨架半径的保守放大系数。
 *
 * 管壁的真实半径还乘了蒙皮的 ringModifier: 星形截面只会**缩小**部分方位, 方形截面的
 * 角部却会放大到 1/0.62 ≈ 1.61 倍, 再加上横截面噪声与椭圆压扁。断口必须比管壁更大,
 * 否则方形管的角会从断口面里戳出来。这里按最坏情况取系数 (宁大勿小: 断口大一点像
 * 撕裂的树皮唇, 小一点就是穿模)。
 *
 * @param {object} render 骨架分支的蒙皮参数
 * @returns {number} 断口外沿半径 ÷ 骨架半径
 */
function rimBaseScale(render) {
  const r = render || {}
  // 圆截面 1.26: 断口比管壁大一圈, 看起来像"树皮被撕开、木质部露出来";
  // 方形截面 1.78: 要盖住 1/0.62≈1.61 倍半径的角部, 否则角会从断口面里戳出来。
  let s = 1.26
  if (r.crossSection === 'square') s = 1.78
  else if (r.crossSection === 'star') s = 1.2
  s *= 1 + Math.max(0, Number(r.crossNoise) || 0)
  s *= Math.max(1, Math.abs(Number(r.squashX) || 1), Math.abs(Number(r.squashZ) || 1))
  return s
}

/**
 * 往累加器里写一个**平面着色**三角形 (每个三角形独立三个顶点)。
 *
 * 断口必须硬边: 木刺与碎裂环如果共享平滑法线会糊成一团。用参考方向 ref 校正绕序 ——
 * 只要法线与 ref 反向就交换顶点, 因此每个面的正面永远朝外, 不需要逐面手推绕序。
 *
 * @param {object} ctx 上下文 {acc, wind, phase, origin, grow, slot, deadBase}
 * @param {{p: THREE.Vector3, uv: number[], c: object}} va 顶点 A
 * @param {object} vb 顶点 B
 * @param {object} vc 顶点 C
 * @param {THREE.Vector3} ref 该面"朝外"的参考方向
 */
function emitTri(ctx, va, vb, vc, ref) {
  const ab = new THREE.Vector3().subVectors(vb.p, va.p)
  const ac = new THREE.Vector3().subVectors(vc.p, va.p)
  const n = new THREE.Vector3().crossVectors(ab, ac)
  const len = n.length()
  if (len < 1e-12) return
  n.multiplyScalar(1 / len)
  let b = vb
  let c = vc
  if (n.dot(ref) < 0) {
    // 绕序反了: 交换后两个顶点, 法线同步翻向
    b = vc
    c = vb
    n.negate()
  }
  const emit = (v) => {
    const col = v.c || ctx.deadBase
    ctx.acc.vertex(
      v.p.x, v.p.y, v.p.z,
      n.x, n.y, n.z,
      v.uv ? v.uv[0] : 0, v.uv ? v.uv[1] : 0,
      clamp01(col.r), clamp01(col.g), clamp01(col.b),
      ctx.wind, ctx.phase, ctx.origin.x, ctx.origin.y, ctx.origin.z,
      ctx.grow[0], ctx.grow[1], ctx.slot,
    )
  }
  const i0 = ctx.acc.vertexCount
  emit(va)
  emit(b)
  emit(c)
  ctx.acc.tri(i0, i0 + 1, i0 + 2)
}

/**
 * 生成一根断枝的断口几何 (锯齿木芯面 + 碎裂树皮唇 + 若干木刺)。
 *
 * 构造 (以断口最后一帧为基准, side/up 为断口的正交基):
 *   - 木芯面: 中心微微前凸的三角扇, 外沿按低频谐波做"锯齿", 轴向也有起伏 → 不是平切;
 *   - 树皮唇: 外沿一圈退回管壁的碎裂环 (暗色), 让断口在轮廓上有厚度, 侧看不是一张纸;
 *   - 木刺: 每个木刺是一个**三棱锥** (底面 3 顶点 + 尖端), 朝枝轴方向伸出并按 flare 外翻,
 *     劈裂感来自"每根木刺朝向/长短/粗细都不同"。
 *
 * @param {import('./mathUtils.js').GeoAcc} acc 断口几何累加器 (最终并进树皮几何)
 * @param {object} branch 骨架分支 (用到 frames / render / slot / damage)
 * @param {object} cfg resolveDamageConfig 的结果
 * @returns {{triangles:number, vertices:number, splinters:number}|null} 本次写入的规模
 */
export function buildFractureGeometry(acc, branch, cfg) {
  const plan = branch && branch.damage
  if (!plan || !plan.shape || !acc || !Array.isArray(branch.frames) || branch.frames.length < 2) return null
  const render = branch.render || {}
  const last = branch.frames[branch.frames.length - 1]
  const R = Math.max(0.0015, Number(last.radius) || plan.radius)
  const dir = last.dir.clone().normalize()
  const side = anyPerp(dir)
  const up = new THREE.Vector3().crossVectors(dir, side).normalize()
  const rimScale = rimBaseScale(render)
  const jagged = clamp01(cfg.breakJagged)
  const sqX = Math.abs(Number(render.squashX) || 1)
  const sqZ = Math.abs(Number(render.squashZ) || 1)
  // 断口周向分辨率: 木刺/锯齿需要比管壁略多的列数才有形, 但上限 16 (再高只是白烧顶点)
  const M = Math.max(8, Math.min(16, Math.round(Number(render.radialSegments) || 8)))
  const heart = cfg.heart
  // 断口配色: 木芯偏亮 → 外沿偏暗 (年轮/树皮过渡); 树皮唇用断枝基色 (略提亮)
  const deadBase = { r: 0.32, g: 0.24, b: 0.17 }
  const coreColor = { r: heart.r * 1.06, g: heart.g * 1.02, b: heart.b * 0.94 }
  const heartColor = { r: heart.r, g: heart.g, b: heart.b }
  // 树皮唇取"断枝枯木色 + 45% 木芯色": 介于深褐树皮与浅木芯之间的过渡色,
  // 于是断口看起来是"树皮被撕裂后翻出来的一圈", 而不是木芯面直接贴在黑树皮上。
  const lipColor = mixRgb(deadBase, heart, 0.45)
  const ctx = {
    acc,
    wind: render.wind1 === undefined ? 1 : render.wind1,
    phase: render.phase || 0,
    origin: render.origin || branch.frames[0].pos,
    grow: render.grow || [0, 1],
    slot: branch.slot,
    deadBase,
  }
  const startTris = acc.triangleCount
  const startVerts = acc.vertexCount
  const radialAt = (angle, radius) => new THREE.Vector3()
    .addScaledVector(side, Math.cos(angle) * sqX * radius)
    .addScaledVector(up, Math.sin(angle) * sqZ * radius)

  // ---- ① 木芯面 + 碎裂树皮唇 ----
  // 外沿半径/轴向起伏: 三个整数谐波叠加 (2π 周期, 接缝处连续) + 一个轴向起伏。
  // 抽成函数是因为木刺的根部也要落在"同一个外沿"上 —— 否则木刺底面会从木芯面里穿出来。
  const [p1, p2, p3] = plan.jagPhase || [0, 0, 0]
  const axialPhase = plan.axialPhase || 0
  const rimRadiusAt = (a) => {
    const rivet = jagged * (0.15 * Math.sin(a * 3 + p1) + 0.09 * Math.sin(a * 5 + p2) + 0.05 * Math.sin(a * 7 + p3))
    return R * rimScale * (1 + rivet)
  }
  const rimAxialAt = (a) => R * (0.03 + jagged * (0.16 + 0.16 * Math.sin(a * 2 + axialPhase)))
  const outer = []
  const inner = []
  const angleFrac = []
  for (let j = 0; j < M; j++) {
    const f = j / M
    const a = f * TAU
    const rOut = rimRadiusAt(a)
    const axial = rimAxialAt(a)
    const radial = radialAt(a, rOut)
    outer.push({
      p: last.pos.clone().addScaledVector(dir, axial).add(radial),
      uv: rimUv(f, rOut, axial),
      c: heartColor,
    })
    // 内沿 (退回管壁一侧的碎裂树皮唇): 半径略小、位置贴住断口平面
    const rIn = rOut * 0.78
    inner.push({
      p: last.pos.clone().add(radialAt(a, rIn)).addScaledVector(dir, R * 0.01),
      uv: rimUv(f, rIn, 0),
      c: lipColor,
    })
    angleFrac.push(f)
  }
  // 木芯扇形面 (中心微凸): 每个扇形三角形都朝 +dir
  const coreCenter = {
    p: last.pos.clone().addScaledVector(dir, R * 0.06),
    uv: [0, R * 0.06],
    c: coreColor,
  }
  for (let j = 0; j < M; j++) {
    const a = outer[j]
    const b = outer[(j + 1) % M]
    emitTri(ctx, coreCenter, a, b, dir)
  }
  // 木芯上的放射状裂纹: 3 条细窄的深色三角形, 略微浮在木芯面之上 (避免 z-fighting)。
  // 目的不是"画一条裂缝", 而是打断木芯面过于光滑的一整块颜色, 让断口有木质纤维层次。
  {
    const crackColor = { r: heart.r * 0.32, g: heart.g * 0.26, b: heart.b * 0.2 }
    const cracks = 3
    for (let c = 0; c < cracks; c++) {
      const a0 = (plan.jagPhase ? plan.jagPhase[c % 3] : 0) + (c / cracks) * TAU
      const w = 0.055 + 0.02 * c
      const vStart = {
        p: last.pos.clone().addScaledVector(dir, R * 0.09),
        uv: [0, R * 0.09],
        c: crackColor,
      }
      const rEnd = R * rimScale * 0.86
      const vA = {
        p: last.pos.clone().addScaledVector(dir, R * 0.075).add(radialAt(a0 - w, rEnd)),
        uv: [rEnd * w, R * 0.075],
        c: crackColor,
      }
      const vB = {
        p: last.pos.clone().addScaledVector(dir, R * 0.075).add(radialAt(a0 + w, rEnd)),
        uv: [rEnd * w * 2, R * 0.075],
        c: crackColor,
      }
      emitTri(ctx, vStart, vA, vB, dir)
    }
  }
  // 碎裂树皮唇: 外沿 -> 内沿一圈, 朝外 (径向 + 少量 +dir)
  for (let j = 0; j < M; j++) {
    const j2 = (j + 1) % M
    const mid = (angleFrac[j] + angleFrac[j2]) * 0.5 * TAU
    const ref = new THREE.Vector3()
      .addScaledVector(side, Math.cos(mid) * sqX)
      .addScaledVector(up, Math.sin(mid) * sqZ)
      .addScaledVector(dir, 0.35)
      .normalize()
    emitTri(ctx, outer[j], outer[j2], inner[j2], ref)
    emitTri(ctx, outer[j], inner[j2], inner[j], ref)
  }

  // ---- ② 木刺 (三棱锥) ----
  const splinterCount = plan.splinters.length
  for (const sp of plan.splinters) {
    const a = sp.angle
    const radial = radialAt(a, 1)
    radial.normalize()
    const tangent = new THREE.Vector3().crossVectors(dir, radial).normalize()
    const baseR = rimRadiusAt(a) * 0.98
    // 木刺根部贴在断口外沿 (而不是从木芯面中间穿出来)
    const base = last.pos.clone()
      .addScaledVector(dir, rimAxialAt(a) - R * 0.02)
      .add(radialAt(a, baseR))
    // 木刺方向: 基本顺着枝轴, 只按 flare 轻微外翻; 再绕枝轴滚一点、按 sag 下垂一点。
    // (旧版 flare 给到 0.85 时木刺几乎垂直于枝轴, 从断口正面看就是一朵"星形花"。)
    const axis = dir.clone()
      .addScaledVector(radial, sp.flare * 0.55)
      .applyAxisAngle(dir, sp.roll * 0.28)
      .normalize()
    rotateTowardUp(axis, -(sp.sag || 0))
    const len = R * cfg.splinterLength * sp.length
    if (len < 1e-4) continue
    const apex = base.clone().addScaledVector(axis, len)
    // 木刺细长: 底面宽度只有半径的 ~16%, 拉开就是"一根木纤维"而不是一片"花瓣"
    const w = R * 0.16 * sp.width
    // 底面三角形 (三个顶点围绕木刺根部)
    const b0 = base.clone().addScaledVector(tangent, w)
    const b1 = base.clone().addScaledVector(tangent, -w * 0.5).addScaledVector(radial, w * 0.85)
    const b2 = base.clone().addScaledVector(tangent, -w * 0.5).addScaledVector(radial, -w * 0.85)
    const shade = 0.88 + 0.14 * sp.width
    const tipColor = { r: heart.r * shade, g: heart.g * shade, b: heart.b * shade }
    // 木刺的 UV 借用木芯面那一带的贴图 (u 按方位展开, v 落在木芯面的窄带里):
    // 木刺与木芯面采到同一块纹理, 明暗不会跳; 落在别处会采到深色树皮纹理, 木刺就发黑。
    const uBase = ((sp.angle % TAU) + TAU) % TAU / TAU
    const uvBase = [uBase * TAU * R, R * 0.12]
    const uvTip = [uBase * TAU * R + R * 0.02, R * 0.12]
    const apexV = { p: apex, uv: uvTip, c: tipColor }
    const v0 = { p: b0, uv: uvBase, c: heartColor }
    const v1 = { p: b1, uv: uvBase, c: heartColor }
    const v2 = { p: b2, uv: uvBase, c: heartColor }
    // 侧面: 参考方向取"面重心相对木刺根部的外侧分量"
    const sideRef = (tri) => {
      const centroid = new THREE.Vector3().add(tri[0]).add(tri[1]).add(tri[2]).multiplyScalar(1 / 3)
      const out = centroid.sub(base)
      out.addScaledVector(axis, -out.dot(axis))
      if (out.lengthSq() < 1e-10) out.copy(radial)
      return out.normalize()
    }
    for (const [u, v] of [[v0, v1], [v1, v2], [v2, v0]]) {
      emitTri(ctx, u, v, apexV, sideRef([u.p, v.p, apex]))
    }
    // 底面 (朝管内, 基本看不见; 但补上才能让木刺是闭合体, 不会从背面漏空)
    emitTri(ctx, v0, v1, v2, axis.clone().negate())
  }

  return {
    triangles: acc.triangleCount - startTris,
    vertices: acc.vertexCount - startVerts,
    splinters: splinterCount,
  }
}
