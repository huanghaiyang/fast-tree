/**
 * 风场/叶片运动的分析模型 (纯数学, 无 three 依赖)
 * ------------------------------------------------------------
 * 用途: 验证风场行为是否真的"有效且物理合理", 并作为自检的回归依据:
 *   - 摆动幅度 (是否看得见 / 是否太大)
 *   - 轨迹形状 (直线往复 vs 绕圈)
 *   - 运动方向是否跟随 wind.direction
 *
 * ⚠️ 这里的公式是 src/core/materials.js 顶点着色器里 wind 段的 **JS 转录**。
 *    改着色器时必须同步改这里 —— 自检 [6b] 依赖它做判定。
 *
 * 物理约定:
 *  1) 顺风位移恒沿 windDir, 只有幅度随时间变化; bias 只抬高摆动低谷 (风只推不拉)
 *  2) 叶柄固定不动; 叶片只做
 *       a. 沿固定方向 (下风向为主 + 少量重力) 的弯曲, 幅度 ∝ 顶点到叶柄距离
 *       b. 绕固定水平轴 (垂直于风向) 的铰链式俯仰
 *     全程没有绕垂直轴的自转 —— 这是"不绕圈"的结构性保证
 *  3) 垂直于风向的位移只来自 turbulence
 */

function rotateAroundAxis(v, axis, angle) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2]
  const cross = [
    axis[1] * v[2] - axis[2] * v[1],
    axis[2] * v[0] - axis[0] * v[2],
    axis[0] * v[1] - axis[1] * v[0],
  ]
  return [
    v[0] * c + cross[0] * s + axis[0] * d * (1 - c),
    v[1] * c + cross[1] * s + axis[1] * d * (1 - c),
    v[2] * c + cross[2] * s + axis[2] * d * (1 - c),
  ]
}

const DEFAULTS = {
  strength: 0.15, speed: 0.8, frequency: 1, gust: 0.5, gustSpeed: 0.16,
  turbulence: 0.12, bias: 0.3, leafFlutter: 0.6, leafTwist: 0.5, direction: 45,
}

/**
 * 采样一个叶尖在 3D 空间的轨迹 (相对叶柄基点)
 * @param {'current'|'legacy'} kind current = 现行着色器公式; legacy = 早期"整片绕垂直轴自转"版本 (对照)
 */
export function leafTrajectory(wind, kind = 'current', opts = {}) {
  const w = { ...DEFAULTS, ...wind }
  const freq = Math.max(0.05, w.frequency)
  const rad = (w.direction * Math.PI) / 180
  const wd = [Math.cos(rad), Math.sin(rad)]
  const wp = [-wd[1], wd[0]]
  const aWind = opts.aWind === undefined ? 1 : opts.aWind
  const stemDist = opts.stemDist === undefined ? 0.35 : opts.stemDist
  const phase = opts.phase === undefined ? 1.234 : opts.phase
  const dt = opts.dt === undefined ? 1 / 60 : opts.dt
  const steps = opts.steps === undefined ? 1200 : opts.steps

  const pts = []
  for (let i = 0; i < steps; i++) {
    const tw = i * dt * w.speed
    let rel
    let x
    let z
    if (kind === 'legacy') {
      // --- 旧版: 沿风向的对称波 + 垂直风向的抖动 + 整片绕垂直轴自转 ---
      const g = (1 - w.gust) + w.gust * (Math.sin(tw * w.gustSpeed + phase * 0.21) * 0.5 + 0.5)
      const wave = Math.sin(tw + phase) * 0.6 + Math.sin(tw * 2.17 + phase * 1.7) * 0.25 +
        Math.sin(tw * 0.37 + phase * 0.5) * 0.15
      const turb = Math.sin(tw * 3.1 + phase * 4.3) * w.turbulence
      x = (wd[0] * wave * g + wp[0] * turb) * w.strength
      z = (wd[1] * wave * g + wp[1] * turb) * w.strength
      const f1 = Math.sin(tw * 3.7 + phase * 6.1)
      const f2 = Math.cos(tw * 2.3 + phase * 3.7)
      const flutter = f1 * w.leafFlutter * w.strength * 0.22 * (0.35 + aWind)
      x += wp[0] * flutter
      z += wp[1] * flutter
      const ang = f2 * w.leafTwist * w.strength
      const bx = wp[0] * stemDist
      const bz = wp[1] * stemDist
      rel = [bx * Math.cos(ang) - bz * Math.sin(ang), 0, bx * Math.sin(ang) + bz * Math.cos(ang)]
    } else {
      // --- 现行: 顺风单向位移 (动态摆动占绝大部分) ---
      const wave = Math.sin(tw + phase) * 0.72 + Math.sin(tw * 2.17 * freq + phase * 1.7) * 0.28
      const osc = wave * 0.5 + 0.5
      const gustFactor = 1 - w.gust * 0.6 * (1 - (Math.sin(tw * w.gustSpeed + phase * 0.21) * 0.5 + 0.5))
      const along = osc * gustFactor + w.bias * 0.35
      const turb = Math.sin(tw * 3.1 * freq + phase * 4.3)
      x = (wd[0] * along + wp[0] * turb * w.turbulence) * w.strength
      z = (wd[1] * along + wp[1] * turb * w.turbulence) * w.strength
      // --- 叶片: 固定方向弯曲 (水平分量主导) + 固定轴铰链俯仰 (叶柄不动) ---
      const flap = Math.sin(tw * 4.1 * freq + phase * 6.3)
      const surge = Math.sin(tw * 1.35 + phase * 2.1)
      const leafAmp = w.leafFlutter * w.strength * 1.8 * (0.35 + aWind)
      const bendLen = Math.hypot(wd[0], -0.3, wd[1])
      const bendAmt = stemDist * leafAmp * (0.5 + 0.35 * flap + 0.15 * surge)
      const bd = [wd[0] / bendLen, -0.3 / bendLen, wd[1] / bendLen]
      rel = [
        wp[0] * stemDist + bd[0] * bendAmt,
        bd[1] * bendAmt,
        wp[1] * stemDist + bd[2] * bendAmt,
      ]
      const pitch = flap * w.leafTwist * 0.5 * (0.35 + w.strength * 2.0)
      rel = rotateAroundAxis(rel, [wp[0], 0, wp[1]], pitch)
    }
    pts.push([x + rel[0], rel[1], z + rel[2]])
  }
  return { pts, windDir: wd, windPerp: wp }
}

/**
 * 轨迹指标 (3D)
 *  - rmsAlong / rmsPerp / rmsVert: 沿风向 / 水平垂直方向 / 垂直(高度)的 RMS 位移 (米)
 *  - thinness = rmsPerp / rmsAlong  (0 = 直线往复, 1 = 各向同性 -> 看着像绕圈)
 *  - azimuthDeg: 水平运动主轴的世界方位角 (应与 wind.direction 一致)
 *  - horizontalShare: 水平位移能量占比 (越高越"看得见方向")
 */
export function motionMetrics(wind, kind = 'current', opts = {}) {
  const { pts, windDir: wd, windPerp: wp } = leafTrajectory(wind, kind, opts)
  const n = pts.length
  let cx = 0
  let cy = 0
  let cz = 0
  for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2] }
  cx /= n
  cy /= n
  cz /= n
  let sa = 0
  let sp = 0
  let sv = 0
  let sxx = 0
  let szz = 0
  let sxz = 0
  let minA = Infinity
  let maxA = -Infinity
  let minP = Infinity
  let maxP = -Infinity
  for (const p of pts) {
    const dx = p[0] - cx
    const dy = p[1] - cy
    const dz = p[2] - cz
    const a = dx * wd[0] + dz * wd[1]
    const q = dx * wp[0] + dz * wp[1]
    sa += a * a
    sp += q * q
    sv += dy * dy
    sxx += dx * dx
    szz += dz * dz
    sxz += dx * dz
    if (a < minA) minA = a
    if (a > maxA) maxA = a
    if (q < minP) minP = q
    if (q > maxP) maxP = q
  }
  const rmsAlong = Math.sqrt(sa / n)
  const rmsPerp = Math.sqrt(sp / n)
  const rmsVert = Math.sqrt(sv / n)
  const horiz = sa + sp
  const theta = 0.5 * Math.atan2(2 * (sxz / n), sxx / n - szz / n)
  return {
    samples: n,
    rmsAlong: +rmsAlong.toFixed(4),
    rmsPerp: +rmsPerp.toFixed(4),
    rmsVert: +rmsVert.toFixed(4),
    thinness: +(rmsPerp / Math.max(1e-9, rmsAlong)).toFixed(3),
    horizontalShare: +(horiz / Math.max(1e-12, horiz + sv)).toFixed(3),
    azimuthDeg: +(((theta * 180) / Math.PI + 360) % 180).toFixed(1),
    spanAlong: +(maxA - minA).toFixed(4),
    spanPerp: +(maxP - minP).toFixed(4),
  }
}

/**
 * 摆动包络 (只看枝条位移, 不含叶片局部弯曲):
 *  - p2p: 沿风向"动态"位移的峰峰值 (米) —— 决定风向肉眼是否看得出来
 *  - meanAlong: 顺风静态偏移 (树在风里的侧倾)
 *  - perpP2P: 横向摆动的峰峰值
 */
export function swayEnvelope(wind, opts = {}) {
  const w = { ...DEFAULTS, ...wind }
  const freq = Math.max(0.05, w.frequency)
  const dt = opts.dt === undefined ? 1 / 60 : opts.dt
  const steps = opts.steps === undefined ? 2400 : opts.steps
  const phase = opts.phase === undefined ? 0.7 : opts.phase
  const flex = opts.flex === undefined ? 1 : opts.flex
  let minA = Infinity
  let maxA = -Infinity
  let minP = Infinity
  let maxP = -Infinity
  let sum = 0
  for (let i = 0; i < steps; i++) {
    const tw = i * dt * w.speed
    const wave = Math.sin(tw + phase) * 0.72 + Math.sin(tw * 2.17 * freq + phase * 1.7) * 0.28
    const osc = wave * 0.5 + 0.5
    const gustFactor = 1 - w.gust * 0.6 * (1 - (Math.sin(tw * w.gustSpeed + phase * 0.21) * 0.5 + 0.5))
    const along = (osc * gustFactor + w.bias * 0.35) * w.strength * flex
    const turb = Math.sin(tw * 3.1 * freq + phase * 4.3) * w.turbulence * w.strength * flex
    if (along < minA) minA = along
    if (along > maxA) maxA = along
    if (turb < minP) minP = turb
    if (turb > maxP) maxP = turb
    sum += along
  }
  return {
    p2p: +(maxA - minA).toFixed(4),
    meanAlong: +(sum / steps).toFixed(4),
    perpP2P: +(maxP - minP).toFixed(4),
  }
}
