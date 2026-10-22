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
 *
 * 作用: 提供"不开浏览器也能算"的风场采样器 + 一组可断言的标量指标,
 *       供 Node 侧自检判断"风够不够明显 / 会不会转圈 / 方向对不对"。
 * 输入 / 输出:
 *   - 输入: `params.wind` 的子集 (缺字段回落到 `DEFAULTS`)、轨迹类型、采样选项;
 *   - 输出: 位置采样点数组 (`leafTrajectory`) 或标量指标对象 (`motionMetrics` / `swayEnvelope`)。
 * 与其他模块的关系:
 *   - 唯一"同构"来源: `src/core/materials.js` 的顶点着色器 wind 段 ——
 *     这里的所有公式都是它的 JS 转录, **改一边必须改另一边**;
 *   - 调用方: `scripts/` 下的自检脚本 (例如 [6b]) 与 `core/autowind.js` 的参数标定;
 *   - 本文件不 import three, 也不 import 任何渲染代码, 以便在 Node 里直接跑。
 * 关键约定 / 单位:
 *   - 坐标系: Three.js 世界坐标, +Y 向上; 水平面是 (x, z), 不是 (x, y);
 *   - `direction` 单位是**度**, 0° = +X 方向, 逆时针增大 (+Z 方向的投影为正弦分量);
 *   - 时间 `tw = i * dt * speed`, 即着色器里的 `uTime * speed` 的离散采样;
 *   - 所有长度量单位是**米** (与几何一致), 角度量除 `direction` 外都是弧度;
 *   - 采样是**确定性**的: 没有随机数, 只有正弦叠加 —— 同一输入必然同一输出, 自检才能比对阈值。
 * 注意: `DEFAULTS` 只是为了"缺字段也能算", 不代表产品默认值 (后者在 `core/params.js`);
 *       两边数值接近但不保证一致, 改动时别把它们当成同一个东西。
 */

/**
 * 绕任意单位轴旋转一个向量 (罗德里格斯(Rodrigues)旋转公式)。
 *
 *   v' = v·cosθ + (axis × v)·sinθ + axis·(axis·v)·(1 - cosθ)
 *
 * 之所以不用 three 的 Quaternion/Matrix4: 本模块要能在 Node 里零依赖跑,
 * 而且只转一个向量, 手写三个分量比构造四元数更快。
 *
 * @param {[number, number, number]} v 待旋转向量 (任意长度)
 * @param {[number, number, number]} axis 旋转轴 (**假定已归一化**; 未归一化会让结果缩放)
 * @param {number} angle 旋转角 (弧度, 右手定则)
 * @returns {[number, number, number]} 旋转后的新数组 (不修改入参)
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

/* ---------------- 兜底默认值 ----------------
 * 只在这些字段没传时才使用 (见各处 `{ ...DEFAULTS, ...wind }`)。
 * 含义与 `core/params.js` 的 wind 分支一致, 只是取了一组"中等风力"的典型值:
 * strength 0.15m 是"能看见但不夸张"的摆幅; bias 0.3 保证摆动的低谷仍在顺风侧(不下沉到逆风);
 * direction 45° 只是为了让单测有确定的水平朝向。
 */
const DEFAULTS = {
  strength: 0.15, speed: 0.8, frequency: 1, gust: 0.5, gustSpeed: 0.16,
  turbulence: 0.12, bias: 0.3, leafFlutter: 0.6, leafTwist: 0.5, direction: 45,
}

/**
 * 采样一个叶尖在 3D 空间的轨迹 (相对叶柄基点)
 *
 * "相对叶柄基点"的含义: 输出的每个点都以叶柄根部为原点, 分成两部分叠加 ——
 *   1) 叶片整体的顺风位移 `(x, 0, z)`: 只在水平面内动, 不含高度方向的分量;
 *   2) 叶片相对于叶柄的局部形变 `rel`: 弯曲 + 铰链俯仰, 由 `stemDist` 决定尺度。
 * 所以轨迹的"形状"(直线/绕圈)主要由 (x,z) 决定, `rel` 只贡献细节抖动。
 *
 * 水平基向量约定 (2D, 用 (x, z) 表示水平面):
 *   - `wd = [cos(dir), sin(dir)]` 是顺风方向 (方向向量的 x/z 分量);
 *   - `wp = [-wd_z, wd_x]` 是顺风方向逆时针 90° 的垂直方向 —— 湍流与铰链轴都沿它。
 *
 * @param {object} wind `params.wind` 的子集 (缺字段用 DEFAULTS 补齐)
 * @param {'current'|'legacy'} kind current = 现行着色器公式; legacy = 早期"整片绕垂直轴自转"版本 (对照)
 * @param {object} [opts] 采样选项
 * @param {number} [opts.aWind=1] 叶片"受风系数"(对应着色器里逐顶点的 aWind 属性), 影响扇动幅度
 * @param {number} [opts.stemDist=0.35] 叶柄到叶尖的距离 (米), 决定弯曲/俯仰的位移尺度
 * @param {number} [opts.phase=1.234] 相位偏移 (弧度), 让不同叶片的运动错开
 * @param {number} [opts.dt=1/60] 采样时间步长 (秒, 即模拟 60fps)
 * @param {number} [opts.steps=1200] 采样点数 (默认覆盖 20 秒; 自检需要足够长的窗口才看得出周期性)
 * @returns {{pts: Array<[number, number, number]>, windDir: [number, number], windPerp: [number, number]}}
 *   `pts` 是采样点 (单位米, 相对叶柄); `windDir` / `windPerp` 是水平基, 供指标计算复用
 */
export function leafTrajectory(wind, kind = 'current', opts = {}) {
  const w = { ...DEFAULTS, ...wind }
  // 频率下限 0.05: 防止传 0 时次波完全不动, 或负数把相位反转 (会让"风向"看起来反了)
  const freq = Math.max(0.05, w.frequency)
  // direction 是度 -> 弧度; wd 是单位向量, 所以后面乘 strength 得到的就是米
  const rad = (w.direction * Math.PI) / 180
  const wd = [Math.cos(rad), Math.sin(rad)]
  const wp = [-wd[1], wd[0]]
  const aWind = opts.aWind === undefined ? 1 : opts.aWind
  const stemDist = opts.stemDist === undefined ? 0.35 : opts.stemDist
  const phase = opts.phase === undefined ? 1.234 : opts.phase
  const dt = opts.dt === undefined ? 1 / 60 : opts.dt
  const steps = opts.steps === undefined ? 1200 : opts.steps

  const pts = []
  // tw = 累计"风场时间": 与着色器里的 uTime * speed 等价, 这里用固定步长离散化
  for (let i = 0; i < steps; i++) {
    const tw = i * dt * w.speed
    // rel 是相对叶柄的局部形变 (x,y,z); x/z 由分支决定
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
      // 两个不通约频率的正弦叠加: 主波(tw) 占 72% 决定"大节奏", 2.17 次谐波占 28% 让波形不对称;
      // 2.17 不是整数倍 -> 合成波不会精确重复, 看起来不像机械抖动
      const wave = Math.sin(tw + phase) * 0.72 + Math.sin(tw * 2.17 * freq + phase * 1.7) * 0.28
      // 映射到 0..1: 因为"风只推不拉", 顺风位移不该出现负值(逆风侧)
      const osc = wave * 0.5 + 0.5
      // 阵风包络: gust 越大, 低谷被压得越低 -> 一阵一阵的呼吸感; 系数 0.6 限制最多压到 40%
      const gustFactor = 1 - w.gust * 0.6 * (1 - (Math.sin(tw * w.gustSpeed + phase * 0.21) * 0.5 + 0.5))
      // 顺风分量 = 摆动 + 静态偏置 (bias 只抬低谷, 所以是加法而不是乘法)
      const along = osc * gustFactor + w.bias * 0.35
      // 横向湍流: 独立的高频正弦, 只沿 wp (垂直风向) 加一点点, 不影响主风向的可辨识度
      const turb = Math.sin(tw * 3.1 * freq + phase * 4.3)
      x = (wd[0] * along + wp[0] * turb * w.turbulence) * w.strength
      z = (wd[1] * along + wp[1] * turb * w.turbulence) * w.strength
      // --- 叶片: 固定方向弯曲 (水平分量主导) + 固定轴铰链俯仰 (叶柄不动) ---
      // flap 是高频扇动 (~4 次), surge 是低频涌动 (~1.35 次), 两者叠加避免"均匀摆动"的假感
      const flap = Math.sin(tw * 4.1 * freq + phase * 6.3)
      const surge = Math.sin(tw * 1.35 + phase * 2.1)
      // 叶片幅度: 1.8 是把 strength(树梢米级位移) 放大到"叶片尺度"的换算系数
      const leafAmp = w.leafFlutter * w.strength * 1.8 * (0.35 + aWind)
      // 弯曲方向 bd = 归一化的 (顺风, -0.3, 顺风): 主要是水平顺风, 掺一点向下(-Y)的"重力垂坠",
      // 长度用 hypot 现算而不是预先归一化, 因为它依赖 direction
      const bendLen = Math.hypot(wd[0], -0.3, wd[1])
      // 弯曲量随叶片尺寸(stemDist)与瞬时风力(0.5 基准 + flap/surge 调制)缩放
      const bendAmt = stemDist * leafAmp * (0.5 + 0.35 * flap + 0.15 * surge)
      const bd = [wd[0] / bendLen, -0.3 / bendLen, wd[1] / bendLen]
      // 局部位置 = 叶柄方向偏移 (wp * stemDist) + 沿弯曲方向的位移
      rel = [
        wp[0] * stemDist + bd[0] * bendAmt,
        bd[1] * bendAmt,
        wp[1] * stemDist + bd[2] * bendAmt,
      ]
      // 铰链俯仰: 绕**固定水平轴** (垂直于风向的 wp, y=0) 旋转 ——
      // 轴不随时间变, 所以叶片只会"上下拍", 不会绕垂直轴自转(这正是"不绕圈"的保证)
      const pitch = flap * w.leafTwist * 0.5 * (0.35 + w.strength * 2.0)
      rel = rotateAroundAxis(rel, [wp[0], 0, wp[1]], pitch)
    }
    // 最终位置 = 叶片整体顺风位移 + 相对叶柄的局部形变
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
 *
 * 实现要点:
 *   1) 所有二阶量都**先去质心**: 只关心"绕平均位置的振动", 静态顺风偏移不该算进幅度;
 *   2) (a, q) 是把 (dx, dz) 投影到顺风/垂直风向这对正交基上 ——
 *      于是 rmsAlong 只反映"沿风向摆动", rmsPerp 只反映"横向晃动", 与 direction 无关可比;
 *   3) 主轴方位角用协方差矩阵的解析解 `θ = 0.5·atan2(2·Sxz, Sxx - Szz)`:
 *      这是 2×2 对称矩阵的主特征向量方向, 不用迭代/特征分解;
 *      结果按 180° 取模, 因为"主轴"是无向的 (θ 与 θ+180° 是同一条线);
 *   4) 所有返回值都 `toFixed`: 自检脚本会把它们写进报告, 无意义的浮点尾巴只会制造噪声 diff。
 *
 * @param {object} wind `params.wind` 子集
 * @param {'current'|'legacy'} [kind='current'] 轨迹类型 (legacy 用于"新旧对比"回归)
 * @param {object} [opts] 透传给 `leafTrajectory` 的采样选项
 * @returns {{samples: number, rmsAlong: number, rmsPerp: number, rmsVert: number, thinness: number,
 *   horizontalShare: number, azimuthDeg: number, spanAlong: number, spanPerp: number}}
 *   单位均为米; `thinness` / `horizontalShare` 是 0..1 无量纲; `azimuthDeg` 是 0..180 度
 */
export function motionMetrics(wind, kind = 'current', opts = {}) {
  const { pts, windDir: wd, windPerp: wp } = leafTrajectory(wind, kind, opts)
  const n = pts.length
  // ① 质心: 后续所有统计都相对它, 用来剔除"静态顺风偏移"(那是树被吹弯, 不是摆动)
  let cx = 0
  let cy = 0
  let cz = 0
  for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2] }
  cx /= n
  cy /= n
  cz /= n
  // sa/sp/sv = 沿风向/垂直风向/竖直方向的平方和; sxx/szz/sxz = 用于求水平主轴的协方差项
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
    // 投影到水平正交基: a 沿风向, q 垂直风向 (都是米)
    const a = dx * wd[0] + dz * wd[1]
    const q = dx * wp[0] + dz * wp[1]
    sa += a * a
    sp += q * q
    sv += dy * dy
    sxx += dx * dx
    szz += dz * dz
    sxz += dx * dz
    // 同时记录极值: spanAlong/spanPerp 是"峰峰值", 比 RMS 更贴近肉眼看到的摆幅
    if (a < minA) minA = a
    if (a > maxA) maxA = a
    if (q < minP) minP = q
    if (q > maxP) maxP = q
  }
  const rmsAlong = Math.sqrt(sa / n)
  const rmsPerp = Math.sqrt(sp / n)
  const rmsVert = Math.sqrt(sv / n)
  const horiz = sa + sp
  // 水平协方差主轴: θ = 0.5·atan2(2·covXZ, varX - varZ), 即 2×2 对称矩阵的主特征向量角
  const theta = 0.5 * Math.atan2(2 * (sxz / n), sxx / n - szz / n)
  return {
    samples: n,
    rmsAlong: +rmsAlong.toFixed(4),
    rmsPerp: +rmsPerp.toFixed(4),
    rmsVert: +rmsVert.toFixed(4),
    // 分母夹 1e-9: 完全无风时 rmsAlong=0, 不能让它变成 Infinity
    thinness: +(rmsPerp / Math.max(1e-9, rmsAlong)).toFixed(3),
    horizontalShare: +(horiz / Math.max(1e-12, horiz + sv)).toFixed(3),
    // +360 再 %180: 把 atan2 的负角归一到 0..180, 保持"主轴无向"的语义
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
 *
 * 与 `motionMetrics` 的分工: 这里把 `leafTrajectory` 里"叶片局部形变"那部分**省略**了,
 * 只保留着色器里作用在整棵枝条上的那条公式 —— 因为判断"风看不看得出来"要看的是
 * 枝条整体位移量级, 叶片的小抖动会把 RMS 拉偏。
 * 采样点数默认 2400 (40 秒), 比 `leafTrajectory` 更长: 峰峰值需要覆盖到慢波(0.37 次)的完整周期,
 * 否则会低估"最大摆到哪"(出现假的小摆幅)。
 *
 * @param {object} wind `params.wind` 子集
 * @param {object} [opts]
 * @param {number} [opts.dt=1/60] 采样步长 (秒)
 * @param {number} [opts.steps=2400] 采样点数
 * @param {number} [opts.phase=0.7] 相位偏移 (弧度)
 * @param {number} [opts.flex=1] 柔度倍率: 模拟"这条枝条在树冠里的层级柔度", 直接乘在幅度上
 * @returns {{p2p: number, meanAlong: number, perpP2P: number}} 单位米
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
    // 与 leafTrajectory 的 current 分支逐字一致 (同一份着色器公式); 改那边必须同步改这里
    const wave = Math.sin(tw + phase) * 0.72 + Math.sin(tw * 2.17 * freq + phase * 1.7) * 0.28
    const osc = wave * 0.5 + 0.5
    const gustFactor = 1 - w.gust * 0.6 * (1 - (Math.sin(tw * w.gustSpeed + phase * 0.21) * 0.5 + 0.5))
    // 顺风位移与横向湍流都乘 flex: 柔度越高(数值越大)整枝摆得越多
    const along = (osc * gustFactor + w.bias * 0.35) * w.strength * flex
    const turb = Math.sin(tw * 3.1 * freq + phase * 4.3) * w.turbulence * w.strength * flex
    if (along < minA) minA = along
    if (along > maxA) maxA = along
    if (turb < minP) minP = turb
    if (turb > maxP) maxP = turb
    // 累加求均值: meanAlong 是"风把树整体压弯"的静态偏移, 不是摆动幅度
    sum += along
  }
  return {
    p2p: +(maxA - minA).toFixed(4),
    meanAlong: +(sum / steps).toFixed(4),
    perpP2P: +(maxP - minP).toFixed(4),
  }
}
