/**
 * 扭曲 (Twist) 曲线
 * ------------------------------------------------------------
 * 作用: 定义并采样"沿枝条长度累积的额外扭转角"曲线。树干与每根枝条各有一条
 *       5 控制点的曲线, 与 trunk.twist / 每层 twist 标量共同决定最终的 roll。
 * 输入 / 输出: 输入是 5 个角度值 (度) 与归一化位置 t; 输出是 t 处的扭转角 (度或弧度)。
 * 与其他模块的关系:
 *   - mathUtils.growFrames 在推进骨架帧时调用 sampleTwistProfile, 把结果叠加进 roll;
 *   - barkSkin / speedtreeBark 生成管状网格时读取每帧 roll 决定 UV 与截面旋转;
 *   - UI 的 TwistGizmo 句柄层直接改写这两个数组 (trunk / branch 各一份)。
 * 关键概念 / 约定:
 *   - 横轴 t = 0..1 (沿树干高度 / 沿枝条长度), 纵轴 = 累计额外扭转角 (度), 正负决定旋向;
 *   - 曲线只控制"额外扭转"; 原有 trunk.twist / 每层 twist 标量继续负责基础扭转;
 *   - 存储单位是"度" (UI 友好), 消费前通常经 twistProfileRad 转弧度;
 *   - 控制点等距分布 (TWIST_TIMES), 因此采样就是等距分段线性插值, 无需求解节点向量;
 *     注意 sampleTwistProfile 直接假定等距、并不读取 TWIST_TIMES —— 若将来改成非等距,
 *     必须同时改采样公式, 否则曲线形状与 UI 上画的控制点位置对不上。
 */

export const TWIST_POINTS = 5
// 5 个控制点在 t 轴上的固定位置: 0 / 25% / 50% / 75% / 100%。
// 等距是刻意的选择 —— 采样退化成简单的分段线性插值, 不必处理非均匀 knot 的查找。
export const TWIST_TIMES = [0, 0.25, 0.5, 0.75, 1]
// 单个控制点的角度上限(度): ±720° = 两整圈。再大在视觉上只是"纹理疯狂拧"，
// 但会显著放大 UV 环绕误差, 因此作为硬夹取值。
export const TWIST_MAX_DEG = 720

/**
 * 创建一条全零的扭曲曲线 (5 个 0 度控制点)。
 *
 * @returns {Array<number>} 长度 TWIST_POINTS 的数组, 单位度, 全 0 = 无额外扭转
 */
export function defaultTwistProfile() {
  return new Array(TWIST_POINTS).fill(0)
}

/**
 * 防御性读取: 旧 JSON / 导入参数可能没有该字段或长度不对。
 *
 * 先铺一条全零曲线, 再逐个控制点做 Number() 转换 + 有限性检查 + ±TWIST_MAX_DEG 夹取;
 * 任何非法点都静默保留 0, 保证后端拿到的一定是"长度正确、可安全采样"的数组。
 *
 * @param {Array<number>|undefined} arr 外部传入的原始曲线 (长度/类型都可能不符合预期)
 * @returns {Array<number>} 长度恒为 TWIST_POINTS 的新数组, 单位度
 */
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

/**
 * 线性插值取 t 处的扭转角 (度)。
 *
 * 因为控制点等距, 先把 t 映射到 [0, TWIST_POINTS-1] 的连续下标 x, 取左段 i 与段内比例 f,
 * 再对 p[i]、p[i+1] 做一维 lerp。t 先夹到 0..1, 并容忍 NaN (Number(t)||0)。
 *
 * @param {Array<number>} profile 5 点扭曲曲线, 单位度 (内部会先 normalize)
 * @param {number} t 沿枝条的归一化位置, 0 = 基部, 1 = 梢部
 * @returns {number} 该处的累计额外扭转角, 单位度 (未取模, 可能为负)
 */
export function sampleTwistProfile(profile, t) {
  const p = normalizeTwistProfile(profile)
  const x = Math.max(0, Math.min(1, Number(t) || 0)) * (TWIST_POINTS - 1)
  const i = Math.min(TWIST_POINTS - 2, Math.floor(x))
  const f = x - i
  return p[i] * (1 - f) + p[i + 1] * f
}

/**
 * 转成弧度, 供 growFrames / 方位角旋转使用。
 *
 * Three.js 的 applyAxisAngle / 三角函数一律吃弧度, 而曲线存储与 UI 显示用度,
 * 所以所有"用于旋转"的消费点都必须走这个函数, 避免某处漏转。
 *
 * @param {Array<number>} profile 5 点扭曲曲线, 单位度
 * @param {number} t 沿枝条的归一化位置, 0..1
 * @returns {number} 该处的累计额外扭转角, 单位弧度
 */
export function twistProfileRad(profile, t) {
  return sampleTwistProfile(profile, t) * Math.PI / 180
}
