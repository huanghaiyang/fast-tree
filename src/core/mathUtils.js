/**
 * 通用几何工具: 属性布局 + 顶点累加器 + 方向数学
 * ------------------------------------------------------------
 * 所有生成的几何体 (树皮/树叶) 都共享同一套顶点属性, 这样
 * mergeGeometries 可以直接合并, 且只需一套着色器注入:
 *
 *   position vec3 | normal vec3 | uv vec2 | color vec3
 *   aWind   float  柔度 0..1  (0 = 完全刚性, 1 = 随风自由摆动)
 *   aPhase  float  风场相位偏移 (让每根枝条不同步)
 *   aOrigin vec3   该枝条的基点 (生长动画的收缩目标)
 *   aGrow   vec2   生长区间 [start, end]
 *   aNodeId float  所属模型节点 id (用于节点树选中/高亮/隔离)
 */
import * as THREE from 'three'
import { sampleTwistProfile } from './twist.js'

export const UP = new THREE.Vector3(0, 1, 0)

export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

export function smoothstep(t) {
  t = clamp01(t)
  return t * t * (3 - 2 * t)
}

/** 取任意与 dir 垂直的单位向量 (确定性, 无随机) */
export function anyPerp(dir, out) {
  out = out || new THREE.Vector3()
  const ref = Math.abs(dir.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)
  out.crossVectors(ref, dir)
  if (out.lengthSq() < 1e-12) out.set(1, 0, 0)
  return out.normalize()
}

/** 让 dir 朝 +Y 转 angle 弧度 (负值 = 朝下, 用于重力/下垂) */
export function rotateTowardUp(dir, angle) {
  if (!angle) return dir
  const axis = new THREE.Vector3().crossVectors(dir, UP)
  if (axis.lengthSq() < 1e-10) return dir
  axis.normalize()
  return dir.applyAxisAngle(axis, angle)
}

/** 与 dir 垂直的单位向量, 绕 dir 旋转 azimuth */
export function azimuthPerp(dir, azimuth, out) {
  out = anyPerp(dir, out)
  if (azimuth) out.applyAxisAngle(dir, azimuth)
  return out
}

/** 插值取样枝条上的某一帧 */
export function sampleFrame(frames, t) {
  const n = frames.length
  if (n === 0) return null
  if (n === 1) {
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

/** 生成沿曲线生长的一串帧 (枝条骨架) */
export function growFrames(rng, o) {
  const segments = Math.max(1, Math.round(o.segments))
  const frames = []
  const pos = o.startPos.clone()
  const dir = o.startDir.clone().normalize()
  const length = Math.max(1e-4, o.length)
  const stepLen = length / segments
  const bendAxis = anyPerp(dir)
  const curve = o.curve || 0
  const curveVariance = o.curveVariance || 0
  const gravity = o.gravity || 0
  const gnarl = o.gnarl || 0
  const twist = o.twist || 0
  const twistProfile = o.twistProfile || null
  const twistProfileOn = Array.isArray(twistProfile) && twistProfile.some((v) => Number(v) !== 0)
  const taperRatio = o.taperRatio === undefined ? 0.2 : o.taperRatio
  const radiusCurve = o.radiusCurve || 1
  const r0 = o.radius0
  const r1 = o.radius1 !== undefined ? o.radius1 : r0 * taperRatio
  const roll0 = o.roll0 || 0

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const radius = Math.max(0.0006, r1 + (r0 - r1) * Math.pow(1 - t, radiusCurve))
    // 基础扭转 (标量) + 扭曲曲线 (句柄编辑的额外角度)
    const profileRoll = twistProfileOn ? sampleTwistProfile(twistProfile, t) * Math.PI / 180 : 0
    const roll = roll0 + twist * t + profileRoll
    frames.push({ pos: pos.clone(), dir: dir.clone(), radius, t, roll, profileRoll })
    if (i === segments) break

    // 1) 弯曲: 越靠梢部弯得越明显
    const bendStep = (curve * (0.35 + 1.3 * t)) / segments
    const bendJitter = 1 + (rng ? rng.signed() * curveVariance : 0)
    dir.applyAxisAngle(bendAxis, bendStep * bendJitter)
    // 2) 重力 / 趋光: 正 = 向上, 负 = 下垂
    rotateTowardUp(dir, gravity / segments)
    // 3) 不规则生长: 慢慢旋转弯曲平面
    if (gnarl && rng) bendAxis.applyAxisAngle(dir, (rng.signed() * gnarl * 2.2) / segments)
    // 4) 扭转由 roll 曲线控制 (上面按 t 直接计算), 这里只更新方向与弯曲轴
    dir.normalize()
    // 保持 bendAxis 垂直于 dir
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

  get vertexCount() {
    return this.position.length / 3
  }

  get triangleCount() {
    return this.index.length / 3
  }

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

  tri(a, b, c) {
    this.index.push(a, b, c)
  }

  /** 从已有的顶点/索引数组批量追加 (用于叶片实例化) */
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

/** 包围盒 -> {min, max, size, center} */
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
