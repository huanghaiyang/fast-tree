/**
 * 扭曲 (Twist) 曲线
 * ------------------------------------------------------------
 * 树干 / 树枝各有一条 5 控制点的扭转曲线:
 *   横轴 t = 0..1 (沿树干高度 / 沿枝条长度)
 *   纵轴   = 累计额外扭转角 (度), 正负决定旋向
 *
 * 曲线只控制"额外扭转"; 原有 trunk.twist / 每层 twist 标量继续负责基础扭转。
 * 句柄叠层 (TwistGizmo) 直接改这两个数组。
 */

export const TWIST_POINTS = 5
export const TWIST_TIMES = [0, 0.25, 0.5, 0.75, 1]
export const TWIST_MAX_DEG = 720

export function defaultTwistProfile() {
  return new Array(TWIST_POINTS).fill(0)
}

/** 防御性读取: 旧 JSON / 导入参数可能没有该字段或长度不对 */
export function normalizeTwistProfile(arr) {
  const out = defaultTwistProfile()
  if (Array.isArray(arr)) {
    for (let i = 0; i < TWIST_POINTS; i++) {
      const v = Number(arr[i])
      if (Number.isFinite(v)) out[i] = Math.max(-TWIST_MAX_DEG, Math.min(TWIST_MAX_DEG, v))
    }
  }
  return out
}

/** 线性插值取 t 处的扭转角 (度) */
export function sampleTwistProfile(profile, t) {
  const p = normalizeTwistProfile(profile)
  const x = Math.max(0, Math.min(1, Number(t) || 0)) * (TWIST_POINTS - 1)
  const i = Math.min(TWIST_POINTS - 2, Math.floor(x))
  const f = x - i
  return p[i] * (1 - f) + p[i + 1] * f
}

/** 转成弧度, 供 growFrames / 方位角旋转使用 */
export function twistProfileRad(profile, t) {
  return sampleTwistProfile(profile, t) * Math.PI / 180
}
