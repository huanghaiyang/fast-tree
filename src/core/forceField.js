/**
 * 空间引导力 (Space Forces / Attractors)
 * ------------------------------------------------------------
 * 作用: 把一组"吸引子 / 排斥子"变成树枝生长时的方向偏转力。
 *   - 吸引子 (attractor): 让枝条主动向球心 / 立方体中心靠拢;
 *   - 排斥子 (repulsor): 让枝条绕开障碍物 (球体或立方体), 可以改变实体尺寸,
 *     用于模拟"树枝绕过岩石/墙壁生长"。
 * 与其他模块的关系:
 *   treeBuilder 在 buildTree 里 createForceField(params.forces), 再把返回值传给
 *   mathUtils.growFrames 的 o.forceField 选项 —— 每前进一段就在该点施加一次转向,
 *   因此弯曲是逐段累积的, 而不是把整根枝条刚性旋转。
 * 关键约定:
 *   - 纯函数: 只读位置/方向/参数, 不使用随机数, 同一份参数必得同一棵树;
 *   - 偏转量按 stepLen 缩放, 因此结果与分段数无关 (细分更平滑, 但曲线走向一致);
 *   - 单步转角有上限 (MAX_TURN), 避免强吸引子把枝条当场拧反方向;
 *   - items 的结构与默认值也由本文件统一维护, params.normalizeParams 会调用
 *     normalizeForces 清洗旧存档里的脏数据。
 */

/** 每米前进距离对应的最大转向增益 (弧度); 1.4 是"明显弯曲但不失控"的手感值 */
const FORCE_GAIN = 1.4
/** 单步最大转角 (弧度): 0.5 ≈ 29°, 防止强场让枝条一步掉头 */
const MAX_TURN = 0.5
const TYPES = ['attractor', 'repulsor']
const SHAPES = ['sphere', 'cube']

/**
 * 把一个力场对象的字段夹到合法范围。
 * @param {number} v 原值
 * @param {number} min 下限
 * @param {number} max 上限
 * @returns {number} 夹取后的值
 */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

/**
 * 新建一个力场对象的默认值 (面板"添加吸引子/排斥子"用)。
 * @param {'attractor'|'repulsor'} type 力场类型
 * @param {number} [index] 序号 (仅用于生成默认 id)
 * @returns {Object} 完整的力场对象
 */
export function defaultForceItem(type = 'attractor', index = 0) {
  return {
    id: `force-${Date.now().toString(36)}-${index}`,
    type: TYPES.includes(type) ? type : 'attractor',
    shape: type === 'repulsor' ? 'cube' : 'sphere',
    x: type === 'attractor' ? 1.5 : 0,
    y: type === 'attractor' ? 2.5 : 1.2,
    z: type === 'attractor' ? 0 : 1.5,
    radius: 3,
    strength: 0.6,
    falloff: 1,
    size: type === 'repulsor' ? 0.8 : 0.6,
    sizeY: type === 'repulsor' ? 1.6 : 0.6,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
  }
}

/**
 * 清洗单个力场对象 (导入旧 JSON / 手改参数 / 审计扰动都可能传入脏值)。
 * 缺失字段用默认值补齐, 未知 type/shape 退回合法值, 所有数值都夹到安全范围。
 * @param {Object} raw 原始对象
 * @param {number} index 在 items 里的下标 (用于稳定 id)
 * @returns {Object} 新的干净对象
 */
export function normalizeForceItem(raw, index = 0) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const type = TYPES.includes(o.type) ? o.type : 'attractor'
  const shape = SHAPES.includes(o.shape) ? o.shape : 'sphere'
  const size = clamp(num(o.size, 0.6), 0.02, 50)
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `force-${index + 1}`,
    type,
    shape,
    x: clamp(num(o.x, 0), -200, 200),
    y: clamp(num(o.y, 2), -20, 200),
    z: clamp(num(o.z, 0), -200, 200),
    radius: clamp(num(o.radius, 3), 0.05, 100),
    strength: clamp(num(o.strength, 0.6), 0, 2),
    falloff: clamp(num(o.falloff, 1), 0.2, 4),
    size,
    sizeY: clamp(num(o.sizeY, size), 0.02, 50),
    // 旋转 (角度): 只对立方体障碍的 SDF 有意义, 球体/吸引子旋转不改变力场。
    rotX: clamp(num(o.rotX, 0), -180, 180),
    rotY: clamp(num(o.rotY, 0), -180, 180),
    rotZ: clamp(num(o.rotZ, 0), -180, 180),
  }
}

/**
 * 清洗整个 forces 分组: 保证 { enabled, items[] } 结构完整。
 * items 上限 32 个 —— 再多会明显拖慢每次 growFrames 的逐段遍历, 也没有使用价值。
 * @param {Object} raw params.forces (可能缺失/残缺)
 * @returns {{enabled: boolean, items: Array<Object>}} 新对象
 */
export function normalizeForces(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const list = Array.isArray(o.items) ? o.items : []
  return {
    enabled: !!o.enabled,
    items: list.filter((it) => it && typeof it === 'object').slice(0, 32).map(normalizeForceItem),
  }
}

/**
 * 欧拉角 (度, 顺序 XYZ) 转 3x3 旋转矩阵。与 three.js 的 Object3D.rotation 默认
 * 顺序一致, 因此视口轴旋转与力场计算对同一个立方体是同一套朝向。
 * @param {number} rx 绕 X (弧度)
 * @param {number} ry 绕 Y (弧度)
 * @param {number} rz 绕 Z (弧度)
 * @returns {number[]} 行优先矩阵 [r00,r01,r02, r10,r11,r12, r20,r21,r22]
 */
function rotationMatrix(rx, ry, rz) {
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  return [
    cy * cz, -cy * sz, sy,
    cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy,
    sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy,
  ]
}

/**
 * 立方体的有符号距离 + 外法线 (支持绕 X/Y/Z 旋转)。
 * 先在物体局部坐标里做轴对齐盒 SDF, 再把法线转回世界坐标。
 * d > 0 = 在盒子外 (到表面的距离); d < 0 = 在盒子内 (到最近面的负距离)。
 * 法线始终指向"从实体指向外部"的方向, 排斥力沿它推。
 * @param {{x:number,y:number,z:number}} pos 当前点
 * @param {Object} it 力场对象 (含 x/y/z/size/sizeY, 以及预计算的 rot 矩阵)
 * @returns {{d:number, nx:number, ny:number, nz:number}} 距离与世界空间法线
 */
function cubeField(pos, it) {
  const hx = it.size
  const hy = it.sizeY
  const hz = it.size
  const dx = pos.x - it.x
  const dy = pos.y - it.y
  const dz = pos.z - it.z
  const m = it.rot
  // 世界 -> 局部: 用旋转矩阵的转置。
  const lx = m[0] * dx + m[3] * dy + m[6] * dz
  const ly = m[1] * dx + m[4] * dy + m[7] * dz
  const lz = m[2] * dx + m[5] * dy + m[8] * dz
  const qx = Math.abs(lx) - hx
  const qy = Math.abs(ly) - hy
  const qz = Math.abs(lz) - hz
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  const oz = Math.max(qz, 0)
  const outside = Math.sqrt(ox * ox + oy * oy + oz * oz)
  let d
  let nlx = 0
  let nly = 0
  let nlz = 0
  if (outside > 1e-9) {
    d = outside
    nlx = (lx < 0 ? -ox : ox) / outside
    nly = (ly < 0 ? -oy : oy) / outside
    nlz = (lz < 0 ? -oz : oz) / outside
  } else {
    // 在盒子内部: 取穿透最浅的那个面作为出口方向。
    const px = hx - Math.abs(lx)
    const py = hy - Math.abs(ly)
    const pz = hz - Math.abs(lz)
    if (px <= py && px <= pz) {
      d = -px
      nlx = lx < 0 ? -1 : 1
    } else if (py <= pz) {
      d = -py
      nly = ly < 0 ? -1 : 1
    } else {
      d = -pz
      nlz = lz < 0 ? -1 : 1
    }
  }
  // 局部法线 -> 世界法线。
  return {
    d,
    nx: m[0] * nlx + m[1] * nly + m[2] * nlz,
    ny: m[3] * nlx + m[4] * nly + m[5] * nlz,
    nz: m[6] * nlx + m[7] * nly + m[8] * nlz,
  }
}

/**
 * 从 forces 参数创建一个"逐段转向器"。
 * 返回 null 表示当前没有可用力场 (未启用 / 没有对象), 调用方可以跳过整段热路径。
 *
 * apply(pos, dir, stepLen) 会就地修改单位方向 dir:
 *   - 先累加所有力场对象在该点产生的方向偏移 (attractor 指向中心, repulsor 沿法线向外);
 *   - 再用 MAX_TURN 限制单步转角;
 *   - 最后由 growFrames 统一 normalize。
 *
 * @param {Object} forces params.forces
 * @returns {{items: Array<Object>, apply: (pos: Object, dir: Object, stepLen: number) => void}|null}
 */
export function createForceField(forces) {
  const f = normalizeForces(forces)
  if (!f.enabled || !f.items.length) return null
  // 预计算立方体障碍的旋转矩阵 (每段生长都会用到, 不能反复算 sin/cos)。
  const D2R = Math.PI / 180
  const items = f.items.map((it) => ({
    ...it,
    rot: it.type === 'repulsor' && it.shape === 'cube'
      ? rotationMatrix(it.rotX * D2R, it.rotY * D2R, it.rotZ * D2R)
      : null,
  }))

  const apply = (pos, dir, stepLen) => {
    if (!(stepLen > 0)) return
    let ax = 0
    let ay = 0
    let az = 0
    for (const it of items) {
      if (it.type === 'attractor') {
        // 吸引: 只受"影响半径"限制, 方向指向中心, 距离越近权重越大。
        const dx = it.x - pos.x
        const dy = it.y - pos.y
        const dz = it.z - pos.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d < 1e-6 || d > it.radius) continue
        const w = Math.pow(1 - d / it.radius, it.falloff) * it.strength
        if (w <= 0) continue
        const g = (w * stepLen * FORCE_GAIN) / d
        ax += dx * g
        ay += dy * g
        az += dz * g
      } else {
        // 排斥: 使用"实体表面"而不是中心来测距 —— 球是到球面, 立方体是到盒面,
        // 因此改实体尺寸 (size / sizeY) 会真的改变枝条绕行的通道宽度。
        let d
        let nx
        let ny
        let nz
        if (it.shape === 'cube') {
          const c = cubeField(pos, it)
          d = c.d
          nx = c.nx
          ny = c.ny
          nz = c.nz
        } else {
          const dx = pos.x - it.x
          const dy = pos.y - it.y
          const dz = pos.z - it.z
          const dc = Math.sqrt(dx * dx + dy * dy + dz * dz)
          if (dc < 1e-6) continue
          d = dc - it.size
          nx = dx / dc
          ny = dy / dc
          nz = dz / dc
        }
        // 影响半径从实体表面算起; 已在实体内部时额外加强逃逸力度。
        if (d >= it.radius) continue
        let w = 1 - Math.max(0, d) / it.radius
        if (d < 0) w = 1 + Math.min(2, -d / Math.max(0.05, it.size)) * 0.8
        w = Math.pow(w, it.falloff) * it.strength
        if (w <= 0) continue
        const g = w * stepLen * FORCE_GAIN
        ax -= nx * g
        ay -= ny * g
        az -= nz * g
      }
    }
    const len = Math.sqrt(ax * ax + ay * ay + az * az)
    if (len < 1e-9) return
    const scale = len > MAX_TURN ? MAX_TURN / len : 1
    dir.x += ax * scale
    dir.y += ay * scale
    dir.z += az * scale
  }

  return { items, apply }
}
