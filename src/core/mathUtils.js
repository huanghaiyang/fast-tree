/**
 * 通用几何工具: 属性布局 + 顶点累加器 + 方向数学
 * ------------------------------------------------------------
 * 作用: 提供全项目共用的几何基础设施 —— 统一顶点属性布局、顶点累加器 GeoAcc、
 *       方向/环坐标系数学, 以及枝条骨架帧的生成与插值。
 * 输入 / 输出: 输入是方向向量、骨架帧、各属性数组; 输出是 THREE.Vector3、
 *               帧数组或 index 化的 THREE.BufferGeometry。
 * 与其他模块的关系: treeBuilder(骨架)、barkSkin / speedtreeBark(蒙皮)、leaf / fruit
 *       (实例化) 都通过本模块构建几何, 因此所有生成的几何体共享同一套顶点属性,
 *       mergeGeometries 可以直接合并, 且只需一套着色器注入。
 * 关键概念 / 约定:
 *   属性布局 (全部为 Float32, 单位米 / 弧度 / 0..1):
 *     position vec3 | normal vec3 | uv vec2 | color vec3
 *     aWind   float  柔度 0..1  (0 = 完全刚性, 1 = 随风自由摆动)
 *     aPhase  float  风场相位偏移 (让每根枝条不同步)
 *     aOrigin vec3   该枝条的基点 (生长动画的收缩目标)
 *     aGrow   vec2   生长区间 [start, end]
 *     aNodeId float  所属模型节点 id (用于节点树选中/高亮/隔离)
 *   坐标系: 右手系, +Y 为世界"上", 长度单位为米;
 *   环坐标系 (side/up) 沿枝条采用平行移动(parallel transport)推进, 避免 UV 突转。
 * 注意: 本模块的函数会原地修改传入的 Vector3 (applyAxisAngle / addScaledVector),
 *       需要保留原值的调用方请自行 clone()。
 */
import * as THREE from 'three'
import { sampleTwistProfile } from './twist.js'

// 世界"上"方向, 只读复用, 避免每帧 new Vector3 造成 GC 压力。
export const UP = new THREE.Vector3(0, 1, 0)

/**
 * 把数值夹到 [0,1]。
 * @param {number} x 任意数值
 * @returns {number} 0..1
 */
export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * 一维线性插值。
 * @param {number} a t=0 时的值
 * @param {number} b t=1 时的值
 * @param {number} t 插值参数 (不夹取, 允许外插)
 * @returns {number} a 与 b 之间的线性插值
 */
export function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * 平滑阶跃 smoothstep(t) = t²(3-2t)。
 *
 * 在 0 与 1 处一阶导为 0, 因此常用于"参数渐入渐出"——例如叶簇密度随高度过渡、
 * 枝条粗细端点收细——避免线性插值在端点产生的折角。
 * @param {number} t 输入, 内部先夹到 0..1
 * @returns {number} 0..1 的平滑值
 */
export function smoothstep(t) {
  t = clamp01(t)
  return t * t * (3 - 2 * t)
}

/**
 * 取任意与 dir 垂直的单位向量 (确定性, 无随机)。
 *
 * 做法: 选一个与 dir 夹角足够大的参考轴 (dir 接近竖直时用 +Y 会退化, 改装 +X),
 * 与 dir 叉乘得到垂直方向; 若叉乘退化 (长度平方 < 1e-12, 即两者共线) 则兜底为 +X。
 * 结果被归一化。这是"环坐标系"的起点 —— 后续帧靠平行移动延续, 不再重新叉乘。
 *
 * @param {THREE.Vector3} dir 参考方向 (假定已归一化)
 * @param {THREE.Vector3} [out] 可选的输出对象, 传入则原地写入 (省一次分配)
 * @returns {THREE.Vector3} 与 dir 垂直的单位向量
 */
export function anyPerp(dir, out) {
  out = out || new THREE.Vector3()
  const ref = Math.abs(dir.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)
  out.crossVectors(ref, dir)
  if (out.lengthSq() < 1e-12) out.set(1, 0, 0)
  return out.normalize()
}

/**
 * 让 dir 朝 +Y 转 angle 弧度 (负值 = 朝下, 用于重力/下垂)。
 *
 * 旋转轴取 dir × UP 并归一化: 该轴同时垂直于 dir 与世界向上, 因此绕它旋转就是
 * 在"dir 与竖直方向张成的平面"内俯仰。angle 为正 => 抬向 +Y (趋光), 为负 => 下垂。
 * 当 dir 已与 UP 共线时轴退化为零向量, 此时直接返回原方向 (无需也无法旋转)。
 *
 * @param {THREE.Vector3} dir 当前方向 (会被原地修改)
 * @param {number} angle 俯仰角, 单位弧度
 * @returns {THREE.Vector3} 旋转后的 dir (同一个对象)
 */
export function rotateTowardUp(dir, angle) {
  if (!angle) return dir
  const axis = new THREE.Vector3().crossVectors(dir, UP)
  if (axis.lengthSq() < 1e-10) return dir
  axis.normalize()
  return dir.applyAxisAngle(axis, angle)
}

/**
 * 与 dir 垂直的单位向量, 绕 dir 旋转 azimuth。
 *
 * 先 anyPerp 得到一个确定的基准垂直向量, 再绕 dir 转 azimuth —— 用于"绕枝条一圈
 * 摆放分支/叶片"。因为基准是确定性的, 同一 dir 每次得到同一套方位, 保证可复现。
 *
 * @param {THREE.Vector3} dir 轴向 (假定已归一化)
 * @param {number} azimuth 绕 dir 的方位角, 单位弧度
 * @param {THREE.Vector3} [out] 可选的输出对象
 * @returns {THREE.Vector3} 单位向量, 位于 dir 的法平面内
 */
export function azimuthPerp(dir, azimuth, out) {
  out = anyPerp(dir, out)
  if (azimuth) out.applyAxisAngle(dir, azimuth)
  return out
}

/**
 * 插值取样枝条上的某一帧。
 *
 * 帧数组是沿枝条等距推进得到的 (见 growFrames), 因此"按 t 取样"等价于按弧长取样:
 * 先映射到连续下标 x = t*(n-1), 取左帧 i 与段内比例 f, 对 pos/dir/radius/roll 做 lerp,
 * 并把 dir 重新归一化 (两帧方向线性插值后会变短)。
 *
 * @param {Array<Object>} frames 骨架帧数组 [{pos, dir, radius, t, roll, profileRoll}]
 * @param {number} t 沿枝条的归一化位置, 0 = 基部, 1 = 梢部
 * @returns {{pos: THREE.Vector3, dir: THREE.Vector3, radius: number, roll: number, profileRoll: number, t: number}|null}
 *          返回新建对象 (可安全修改); frames 为空时返回 null
 */
export function sampleFrame(frames, t) {
  const n = frames.length
  if (n === 0) return null
  if (n === 1) {
    // 单帧退化情况: 直接拷贝, 避免下面 n-2 = -1 越界。
    return {
      pos: frames[0].pos.clone(), dir: frames[0].dir.clone(), radius: frames[0].radius,
      roll: frames[0].roll || 0, profileRoll: frames[0].profileRoll || 0, t,
    }
  }
  const x = clamp01(t) * (n - 1)
  const i = Math.min(n - 2, Math.floor(x))
  const f = x - i
  const a = frames[i]
  const b = frames[i + 1]
  return {
    pos: new THREE.Vector3().lerpVectors(a.pos, b.pos, f),
    dir: new THREE.Vector3().lerpVectors(a.dir, b.dir, f).normalize(),
    radius: lerp(a.radius, b.radius, f),
    roll: lerp(a.roll || 0, b.roll || 0, f),
    profileRoll: lerp(a.profileRoll || 0, b.profileRoll || 0, f),
    t,
  }
}

/**
 * 生成沿曲线生长的一串帧 (枝条骨架)。
 *
 * 模型: 从 startPos 出发、沿 startDir 每步前进 stepLen = length/segments;
 * 每步依次施加 ① 弯曲 (曲率随 t 增大)、② 重力/趋光俯仰、③ 不规则生长 (旋转弯曲平面)、
 * ④ 扭转 (只累积 roll, 不直接改方向), 然后归一化并推进位置。
 * 输出帧数 = segments + 1 (含首尾), 首帧 t=0, 末帧 t=1, radius 由 r0 按
 * 幂函数 (1-t)^radiusCurve 收细到 r1。所有随机抖动来自传入的 rng 子流,
 * 因此同一 seed + 同一标签必得同一条骨架。
 *
 * @param {Rng|null} rng 该枝条专属的随机子流; 传 null 则抖动全部按 0 处理 (确定性直枝)
 * @param {Object} o 生长参数:
 * @param {THREE.Vector3} o.startPos 起点 (世界坐标, 米)
 * @param {THREE.Vector3} o.startDir 初始方向 (内部会归一化)
 * @param {number} o.length 枝条长度 (米), 最小 1e-4 防除零
 * @param {number} o.segments 分段数 (会四舍五入到 >=1)
 * @param {number} o.radius0 基部半径 (米)
 * @param {number} [o.radius1] 梢部半径 (米); 省略时 = radius0 * taperRatio
 * @param {number} [o.taperRatio=0.2] 收细比 (相对基部的比例)
 * @param {number} [o.radiusCurve=1] 收细曲线指数, >1 更"根部粗、梢部细", <1 更均匀
 * @param {number} [o.curve=0] 总弯曲量 (弧度), 沿长度按 t 加权分配
 * @param {number} [o.curveVariance=0] 每步弯曲的随机方差 (相对 1 的抖动幅度)
 * @param {number} [o.gravity=0] 总俯仰量 (弧度), 正 = 向上、负 = 下垂
 * @param {number} [o.gnarl=0] 不规则生长强度, 每步缓慢旋转弯曲平面
 * @param {Object} [o.forceField] 空间引导力 (见 core/forceField.js):
 *        每前进一段前调用 apply(pos, dir, stepLen) 就地叠加方向偏移;
 *        传 null/省略 = 无力场, 走原来的生长路径。
 * @param {number} [o.twist=0] 基础扭转总量 (弧度), 沿 t 线性累加到 roll
 * @param {Array<number>} [o.twistProfile] 5 点扭曲曲线 (度), 叠加在基础扭转之上
 * @param {number} [o.roll0=0] 起始 roll (弧度), 让同一父枝上的子枝截面错开
 * @returns {Array<{pos: THREE.Vector3, dir: THREE.Vector3, radius: number, t: number, roll: number, profileRoll: number}>}
 *          骨架帧数组, 长度 segments+1
 */
export function growFrames(rng, o) {
  const segments = Math.max(1, Math.round(o.segments))
  const frames = []
  const pos = o.startPos.clone()
  const dir = o.startDir.clone().normalize()
  const length = Math.max(1e-4, o.length)
  const stepLen = length / segments
  // 弯曲方向基准: 与初始方向垂直的任意向量; 之后每步都把它投影回 dir 的法平面
  // (平行移动), 保证弯曲平面连续演化、不因重新叉乘而突然翻转。
  const bendAxis = anyPerp(dir)
  const curve = o.curve || 0
  const curveVariance = o.curveVariance || 0
  const gravity = o.gravity || 0
  const gnarl = o.gnarl || 0
  const twist = o.twist || 0
  const twistProfile = o.twistProfile || null
  // 曲线全 0 时视为"未启用", 跳过每帧的 normalize+采样, 省掉一条热路径上的开销。
  const twistProfileOn = Array.isArray(twistProfile) && twistProfile.some((v) => Number(v) !== 0)
  const taperRatio = o.taperRatio === undefined ? 0.2 : o.taperRatio
  const radiusCurve = o.radiusCurve || 1
  const r0 = o.radius0
  const r1 = o.radius1 !== undefined ? o.radius1 : r0 * taperRatio
  const roll0 = o.roll0 || 0

  // i = 0..segments 共 segments+1 帧; 末帧只记录不推进, 因此循环内 i===segments 时 break。
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    // 半径收细: r(t) = r1 + (r0-r1)·(1-t)^radiusCurve。
    // 下限 0.0006 米 (~0.6mm) 是防退化阈值 —— 半径趋 0 会让蒙皮的环坐标系与法线除零。
    const radius = Math.max(0.0006, r1 + (r0 - r1) * Math.pow(1 - t, radiusCurve))
    // 基础扭转 (标量) + 扭曲曲线 (句柄编辑的额外角度)
    const profileRoll = twistProfileOn ? sampleTwistProfile(twistProfile, t) * Math.PI / 180 : 0
    const roll = roll0 + twist * t + profileRoll
    frames.push({ pos: pos.clone(), dir: dir.clone(), radius, t, roll, profileRoll })
    if (i === segments) break

    // 1) 弯曲: 越靠梢部弯得越明显
    // 权重 (0.35 + 1.3t): 基部只给 35% 的曲率、梢部给 165%, 这样树干笔直而枝梢自然下垂;
    // 除以 segments 是为让"总弯曲量 curve"与分段数无关 (分辨率无关性)。
    const bendStep = (curve * (0.35 + 1.3 * t)) / segments
    const bendJitter = 1 + (rng ? rng.signed() * curveVariance : 0)
    dir.applyAxisAngle(bendAxis, bendStep * bendJitter)
    // 2) 重力 / 趋光: 正 = 向上, 负 = 下垂
    rotateTowardUp(dir, gravity / segments)
    // 3) 不规则生长: 慢慢旋转弯曲平面
    // gnarl 每步把弯曲轴绕当前方向扭一点, 于是整条枝不是平面曲线, 而是缓慢缠绕的空间曲线;
    // 2.2 是经验系数, 换算成"每段最多约 2.2·gnarl/segments 弧度"的手感。
    if (gnarl && rng) bendAxis.applyAxisAngle(dir, (rng.signed() * gnarl * 2.2) / segments)
    // 3.5) 空间引导力: 吸引子/排斥子在该点产生的转向。
    // 放在 normalize 之前、位置推进之前 —— 这样本段就按新方向前进,
    // 曲线是逐段累积出来的, 而不是整枝刚性旋转。forceField 内部按 stepLen 缩放,
    // 因此改变分段数不会改变大方向, 只会让同一条曲线更平滑。
    if (o.forceField) o.forceField.apply(pos, dir, stepLen)
    // 4) 扭转由 roll 曲线控制 (上面按 t 直接计算), 这里只更新方向与弯曲轴
    dir.normalize()
    // 保持 bendAxis 垂直于 dir
    // 平行移动: 把旧弯曲轴投影到新切平面 —— bendAxis -= (bendAxis·dir)·dir。
    // 这比重新 anyPerp 连续得多, 否则每步的基准方向都会跳。
    bendAxis.addScaledVector(dir, -bendAxis.dot(dir))
    if (bendAxis.lengthSq() < 1e-10) anyPerp(dir, bendAxis)
    bendAxis.normalize()
    pos.addScaledVector(dir, stepLen)
  }
  return frames
}

/**
 * 顶点累加器: 收集属性 -> BufferGeometry (indexed)
 * 使用 indexed 顶点可以在 merge 时保持内存友好。
 *
 * 内部用普通 JS 数组累积 (push 快、无需预估容量), build() 时才一次性转成
 * Float32BufferAttribute; 三角形通过索引复用顶点, 因此同一个环形截面只需一份顶点数据。
 */
export class GeoAcc {
  constructor() {
    this.position = []
    this.normal = []
    this.uv = []
    this.color = []
    this.aWind = []
    this.aPhase = []
    this.aOrigin = []
    this.aGrow = []
    this.aNodeId = []
    this.index = []
  }

  /** 已写入的顶点数 (position 是 vec3, 故除以 3) */
  get vertexCount() {
    return this.position.length / 3
  }

  /** 已写入的三角形数 (index 每 3 个一组) */
  get triangleCount() {
    return this.index.length / 3
  }

  /**
   * 追加一个顶点, 返回其索引。
   *
   * 参数顺序与属性布局严格对应 (一次写满 9 个属性), 调用方不要漏项;
   * 索引由当前顶点数自动推出, 因此可以边 push 边用返回值组装三角形。
   *
   * @param {number} px,py,pz 位置 (米, 世界坐标)
   * @param {number} nx,ny,nz 法线 (单位向量)
   * @param {number} u,v UV (0..1, 树皮按米/圈数缩放)
   * @param {number} r,g,b 顶点色 (线性空间 0..1, 供树皮明暗/树叶色调调制)
   * @param {number} wind 风柔度 0..1 (0 = 刚性根部, 1 = 梢部自由摆)
   * @param {number} phase 风场相位偏移 (弧度, 让相邻枝条不同步)
   * @param {number} ox,oy,oz 枝条基点 (生长动画的缩放中心)
   * @param {number} g0,g1 生长区间 [start,end] (0..1, 顶点色/可见性随其渐变)
   * @param {number} [nodeId=0] 所属模型节点 id (生成阶段填 slot 序号, 由 finalizeNodes 统一改写)
   * @returns {number} 新顶点的索引
   */
  vertex(px, py, pz, nx, ny, nz, u, v, r, g, b, wind, phase, ox, oy, oz, g0, g1, nodeId = 0) {
    const i = this.position.length / 3
    this.position.push(px, py, pz)
    this.normal.push(nx, ny, nz)
    this.uv.push(u, v)
    this.color.push(r, g, b)
    this.aWind.push(wind)
    this.aPhase.push(phase)
    this.aOrigin.push(ox, oy, oz)
    this.aGrow.push(g0, g1)
    this.aNodeId.push(nodeId)
    return i
  }

  /**
   * 追加一个三角形 (三个顶点索引)。
   * 索引顺序决定正面朝向 (逆时针为正面), 蒙皮时须与法线方向一致。
   */
  tri(a, b, c) {
    this.index.push(a, b, c)
  }

  /**
   * 从已有的顶点/索引数组批量追加 (用于叶片实例化) —— 即把累积的属性数组
   * 封装成 index 化的 BufferGeometry 并计算包围体。
   *
   * 副作用: 会生成 9 个 Float32BufferAttribute 与一次 setIndex;
   * 包围盒/包围球在这里一次算好, 供视锥剔除与相机 fit 直接使用。
   *
   * @returns {THREE.BufferGeometry} 新建几何体 (属性名与着色器约定一致)
   */
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3))
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.aWind, 1))
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.aPhase, 1))
    g.setAttribute('aOrigin', new THREE.Float32BufferAttribute(this.aOrigin, 3))
    g.setAttribute('aGrow', new THREE.Float32BufferAttribute(this.aGrow, 2))
    g.setAttribute('aNodeId', new THREE.Float32BufferAttribute(this.aNodeId, 1))
    g.setIndex(this.index)
    g.computeBoundingBox()
    g.computeBoundingSphere()
    return g
  }
}

/**
 * 包围盒 -> {min, max, size, center}。
 *
 * @param {THREE.BufferGeometry} geometry 任意几何体; 为空或 0 顶点时返回全零包围盒
 * @returns {{min: THREE.Vector3, max: THREE.Vector3, size: THREE.Vector3, center: THREE.Vector3, height: number}}
 *          height = size.y (米), 供 UI 显示树高
 */
export function boxInfo(geometry) {
  if (!geometry || geometry.attributes.position.count === 0) {
    return { min: new THREE.Vector3(), max: new THREE.Vector3(), size: new THREE.Vector3(), center: new THREE.Vector3(), height: 0 }
  }
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const min = geometry.boundingBox.min
  const max = geometry.boundingBox.max
  const size = new THREE.Vector3().subVectors(max, min)
  return { min, max, size, center: new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5), height: size.y }
}
