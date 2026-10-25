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
const SHAPES = ['sphere', 'ellipsoid', 'cube']

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
    sizeZ: type === 'repulsor' ? 0.8 : 0.6,
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
  // 球体只认一个半径: 三个半轴强制相等, 避免旧存档里残留的 sizeY 让它变成"看不见的椭圆"。
  const uniform = shape === 'sphere'
  const sizeY = uniform ? size : clamp(num(o.sizeY, size), 0.02, 50)
  const sizeZ = uniform ? size : clamp(num(o.sizeZ, size), 0.02, 50)
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
    sizeY,
    sizeZ,
    // 旋转 (角度): 椭球/立方体的 SDF 与法线会用到, 球体忽略。
    rotX: clamp(num(o.rotX, 0), -180, 180),
    rotY: clamp(num(o.rotY, 0), -180, 180),
    rotZ: clamp(num(o.rotZ, 0), -180, 180),
  }
}

/**
 * 清洗整个 forces 分组: 保证 { enabled, showHelpers, items[] } 结构完整。
 * items 上限 32 个 —— 再多会明显拖慢每次 growFrames 的逐段遍历, 也没有使用价值。
 * @param {Object} raw params.forces (可能缺失/残缺)
 * @returns {{enabled: boolean, showHelpers: boolean, items: Array<Object>}} 新对象
 */
export function normalizeForces(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const list = Array.isArray(o.items) ? o.items : []
  return {
    enabled: !!o.enabled,
    // 视口示意图总开关: 默认显示, 只有显式 false 才隐藏 (旧存档按显示处理)。
    showHelpers: o.showHelpers !== false,
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
 * 力场实体的有符号距离 + 外法线 (支持球 / 椭球 / 立方体, 并支持绕 X/Y/Z 旋转)。
 *
 * 统一约定:
 *   d > 0 = 在实体外 (到表面的近似距离); d < 0 = 在实体内 (到最近表面的负距离);
 *   法线 (nx,ny,nz) 始终指向"从实体朝外"的方向。
 * 实现: 先把世界点用旋转矩阵的转置转到实体局部坐标, 在局部做 SDF, 再把法线转回世界。
 * 椭球用归一化半径 k = |(x/a, y/b, z/c)| 近似, 距离取 (k-1)×最小半轴 —— 对细长椭球
 * 略偏保守, 但分支绕行的手感稳定, 且不引入迭代求解。
 *
 * @param {{x:number,y:number,z:number}} pos 当前点
 * @param {Object} it 力场对象 (含 x/y/z/size/sizeY/sizeZ, 以及预计算的 rot 矩阵)
 * @returns {{d:number, nx:number, ny:number, nz:number}} 距离与世界空间法线
 */
function shapeField(pos, it) {
  const dx = pos.x - it.x
  const dy = pos.y - it.y
  const dz = pos.z - it.z
  const m = it.rot
  // 世界 -> 局部: 用旋转矩阵的转置。
  const lx = m ? m[0] * dx + m[3] * dy + m[6] * dz : dx
  const ly = m ? m[1] * dx + m[4] * dy + m[7] * dz : dy
  const lz = m ? m[2] * dx + m[5] * dy + m[8] * dz : dz
  const toWorld = (nx, ny, nz) => (m
    ? {
        nx: m[0] * nx + m[1] * ny + m[2] * nz,
        ny: m[3] * nx + m[4] * ny + m[5] * nz,
        nz: m[6] * nx + m[7] * ny + m[8] * nz,
      }
    : { nx, ny, nz })

  if (it.shape === 'cube') {
    const hx = it.size
    const hy = it.sizeY
    const hz = it.sizeZ
    const qx = Math.abs(lx) - hx
    const qy = Math.abs(ly) - hy
    const qz = Math.abs(lz) - hz
    const ox = Math.max(qx, 0)
    const oy = Math.max(qy, 0)
    const oz = Math.max(qz, 0)
    const outside = Math.sqrt(ox * ox + oy * oy + oz * oz)
    let d
    let nlx = 0
    let nly = 1
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
    const n = toWorld(nlx, nly, nlz)
    return { d, nx: n.nx, ny: n.ny, nz: n.nz }
  }

  // 球 / 椭球 (球是 a=b=c 的退化椭球)
  const ax = Math.max(1e-4, it.size)
  const ay = Math.max(1e-4, it.sizeY)
  const az = Math.max(1e-4, it.sizeZ)
  const ux = lx / ax
  const uy = ly / ay
  const uz = lz / az
  const k = Math.sqrt(ux * ux + uy * uy + uz * uz)
  const minA = Math.min(ax, ay, az)
  if (k < 1e-9) {
    // 正好在中心: 任取 +Y, 距离按最小半轴算"内部"。
    const n = toWorld(0, 1, 0)
    return { d: -minA, nx: n.nx, ny: n.ny, nz: n.nz }
  }
  let nlx = lx / (ax * ax)
  let nly = ly / (ay * ay)
  let nlz = lz / (az * az)
  const nl = Math.sqrt(nlx * nlx + nly * nly + nlz * nlz) || 1
  nlx /= nl
  nly /= nl
  nlz /= nl
  const n = toWorld(nlx, nly, nlz)
  return { d: (k - 1) * minA, nx: n.nx, ny: n.ny, nz: n.nz }
}

/**
 * 从 forces 参数创建一个"逐段转向器"。
 * 返回 null 表示当前没有可用力场 (未启用 / 没有对象), 调用方可以跳过整段热路径。
 *
 * apply(pos, dir, stepLen) 会就地修改单位方向 dir:
 *   - 吸引子沿"指向实体中心"的方向拉, 排斥子沿实体外法线推 (两者都以实体表面测距);
 *   - 再用 MAX_TURN 限制单步转角;
 *   - 最后由 growFrames 统一 normalize。
 *
 * @param {Object} forces params.forces
 * @returns {{items: Array<Object>, apply: (pos: Object, dir: Object, stepLen: number) => void}|null}
 */
export function createForceField(forces) {
  const f = normalizeForces(forces)
  if (!f.enabled || !f.items.length) return null
  // 预计算椭球/立方体的旋转矩阵 (每段生长都会用到, 不能反复算 sin/cos)。
  const D2R = Math.PI / 180
  const items = f.items.map((it) => ({
    ...it,
    rot: it.shape === 'sphere'
      ? null
      : rotationMatrix(it.rotX * D2R, it.rotY * D2R, it.rotZ * D2R),
  }))

  const apply = (pos, dir, stepLen) => {
    if (!(stepLen > 0)) return
    let ax = 0
    let ay = 0
    let az = 0
    for (const it of items) {
      // 实体表面距离 + 外法线: 吸引子和排斥子共用同一套几何, 只是转向相反。
      const s = shapeField(pos, it)
      if (s.d >= it.radius) continue
      // 影响半径从实体表面算起; 已在实体内部时额外加强逃逸/汇聚力度。
      let w = 1 - Math.max(0, s.d) / it.radius
      const minA = Math.min(it.size, it.sizeY, it.sizeZ)
      if (s.d < 0) w = 1 + Math.min(2, -s.d / Math.max(0.05, minA)) * 0.8
      w = Math.pow(w, it.falloff) * it.strength
      if (w <= 0) continue
      const g = w * stepLen * FORCE_GAIN
      if (it.type === 'attractor') {
        // 向内: 外法线取反, 指向实体中心一侧。
        ax -= s.nx * g
        ay -= s.ny * g
        az -= s.nz * g
      } else {
        // 向外: 沿外法线把枝条推离障碍物 (之前方向写反了, 会把枝条吸进实体)。
        ax += s.nx * g
        ay += s.ny * g
        az += s.nz * g
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
