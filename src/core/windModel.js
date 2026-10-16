/**
 * 风场/叶片运动的分析模型 (纯数学, 无 three 依赖)
 * ------------------------------------------------------------
 * 用途: 验证"叶片不会绕圈"这类物理性质, 并作为自检的回归依据。
 *
 * ⚠️ 这里的公式是 src/core/materials.js 顶点着色器里 wind 段的 **JS 转录**。
 *    改着色器时请同步改这里 —— 自检 [9] 会用它判断轨迹形状。
 *
 * 物理约定:
 *  1) 顺风位移恒沿风向 (windDir), 只有幅度随时间变化, 且"只推不拉" (bias >= 0)
 *  2) 叶柄固定不动; 叶片只做
 *       a. 沿固定方向 (下风向 + 重力) 的弯曲, 幅度 ∝ 顶点到叶柄的距离
 *       b. 绕固定水平轴 (垂直于风向) 的铰链式俯仰
 *     全程没有绕垂直轴的自转 —— 这是"不绕圈"的结构性保证
 *  3) 垂直于风向的位移只来自 turbulence (横向阵风抖动), 因此薄度指标 = turbulence 相对量
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

/**
 * 采样一个叶尖在 XZ 平面上的轨迹 (相对叶柄基点)
 * @param {'current'|'legacy'} kind current = 现行着色器公式; legacy = 早期"整片绕垂直轴自转"的版本 (对照)
 */
export function leafTrajectory(wind, kind = 'current', opts = {}) {
  const {
    strength = 0.12, speed = 0.8, frequency = 1, gust = 0.35, gustSpeed = 0.16,
    turbulence = 0.12, bias = 0.3, leafFlutter = 0.6, leafTwist = 0.5, direction = 45,
  } = wind
  const freq = Math.max(0.05, frequency)
  const rad = (direction * Math.PI) / 180
  const wd = [Math.cos(rad), Math.sin(rad)]
  const wp = [-wd[1], wd[0]]
  const aWind = opts.aWind === undefined ? 1 : opts.aWind
  const stemDist = opts.stemDist === undefined ? 0.35 : opts.stemDist
  const phase = opts.phase === undefined ? 1.234 : opts.phase
  const dt = opts.dt === undefined ? 1 / 60 : opts.dt
  const steps = opts.steps === undefined ? 1200 : opts.steps

  const pts = []
  for (let i = 0; i < steps; i++) {
    const tw = i * dt * speed
    // three 的 mix(1.0, s, uGust) = 1*(1-gust) + s*gust
    const g = (1 - gust) + gust * (Math.sin(tw * gustSpeed + phase * 0.21) * 0.5 + 0.5)
    let x
    let z
    let rel
    if (kind === 'legacy') {
      // --- 旧版: 沿风向的对称波 + 垂直风向的抖动 + 整片绕垂直轴自转 ---
      const wave = Math.sin(tw + phase) * 0.6 + Math.sin(tw * 2.17 + phase * 1.7) * 0.25 +
        Math.sin(tw * 0.37 + phase * 0.5) * 0.15
      const turb = Math.sin(tw * 3.1 + phase * 4.3) * turbulence
      x = (wd[0] * wave * g + wp[0] * turb) * strength
      z = (wd[1] * wave * g + wp[1] * turb) * strength
      const f1 = Math.sin(tw * 3.7 + phase * 6.1)
      const f2 = Math.cos(tw * 2.3 + phase * 3.7)
      const flutter = f1 * leafFlutter * strength * 0.22 * (0.35 + aWind)
      x += wp[0] * flutter
      z += wp[1] * flutter
      const ang = f2 * leafTwist * strength
      const bx = wp[0] * stemDist
      const bz = wp[1] * stemDist
      rel = [bx * Math.cos(ang) - bz * Math.sin(ang), 0.12, bx * Math.sin(ang) + bz * Math.cos(ang)]
    } else {
      // --- 现行: 顺风单向位移 ---
      const wave = Math.sin(tw + phase) * 0.72 + Math.sin(tw * 2.17 * freq + phase * 1.7) * 0.28
      const along = (wave * 0.5 + 0.5) * g + bias
      const turb = Math.sin(tw * 3.1 * freq + phase * 4.3)
      x = (wd[0] * along + wp[0] * turb * turbulence) * strength
      z = (wd[1] * along + wp[1] * turb * turbulence) * strength
      // --- 叶片: 固定方向弯曲 + 固定轴铰链俯仰 (叶柄不动) ---
      const flap = Math.sin(tw * 4.1 * freq + phase * 6.3)
      const surge = Math.sin(tw * 1.35 + phase * 2.1)
      const leafAmp = leafFlutter * strength * 1.6 * (0.35 + aWind)
      const bendLen = Math.hypot(wd[0], -0.55, wd[1])
      const bendAmt = stemDist * leafAmp * (0.55 + 0.30 * flap + 0.15 * surge)
      const bd = [wd[0] / bendLen, -0.55 / bendLen, wd[1] / bendLen]
      rel = [
        wp[0] * stemDist + bd[0] * bendAmt,
        0.12 + bd[1] * bendAmt,
        wp[1] * stemDist + bd[2] * bendAmt,
      ]
      const pitch = flap * leafTwist * 0.45 * (0.35 + strength * 2.0)
      rel = rotateAroundAxis(rel, [wp[0], 0, wp[1]], pitch)
    }
    pts.push([x + rel[0], z + rel[2]])
  }
  return { pts, windDir: wd, windPerp: wp }
}

/**
 * 轨迹指标
 *  - rmsAlong / rmsPerp: 沿风向 / 垂直风向的位移均方根 (米)
 *  - thinness = rmsPerp / rmsAlong: 0 = 纯直线往复 (不绕圈), 1 = 各向同性 (会显得在打转)
 *  - spanAlong / spanPerp: 包络尺寸
 */
export function motionMetrics(wind, kind = 'current', opts = {}) {
  const { pts, windDir: wd, windPerp: wp } = leafTrajectory(wind, kind, opts)
  const n = pts.length
  let cx = 0
  let cz = 0
  for (const p of pts) { cx += p[0]; cz += p[1] }
  cx /= n
  cz /= n
  let sa = 0
  let sp = 0
  let minA = Infinity
  let maxA = -Infinity
  let minP = Infinity
  let maxP = -Infinity
  for (const p of pts) {
    const dx = p[0] - cx
    const dz = p[1] - cz
    const a = dx * wd[0] + dz * wd[1]
    const q = dx * wp[0] + dz * wp[1]
    sa += a * a
    sp += q * q
    if (a < minA) minA = a
    if (a > maxA) maxA = a
    if (q < minP) minP = q
    if (q > maxP) maxP = q
  }
  const rmsAlong = Math.sqrt(sa / n)
  const rmsPerp = Math.sqrt(sp / n)
  return {
    samples: n,
    rmsAlong: +rmsAlong.toFixed(4),
    rmsPerp: +rmsPerp.toFixed(4),
    thinness: +(rmsPerp / Math.max(1e-9, rmsAlong)).toFixed(3),
    spanAlong: +(maxA - minA).toFixed(4),
    spanPerp: +(maxP - minP).toFixed(4),
  }
}
