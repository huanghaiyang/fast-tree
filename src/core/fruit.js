/**
 * 果实 / 种子: 模板 + 实例化写入
 * ------------------------------------------------------------
 * 参考图 (橡果): 椭圆形坚果 + 粗糙的壳斗帽 (cap) + 短果柄。
 * 全部用旋转体 (lathe) 生成, 顶点色烘焙"坚果色 / 壳斗色",
 * 与叶片共用同一套顶点属性, 因此风场/生长/选中高亮都能直接作用。
 */
import * as THREE from 'three'

/** 旋转体: 给定母线 (r, y) 列表, 绕 Y 轴旋成封闭体 */
function lathe(profile, radial, uScale = 1) {
  const positions = []
  const normals = []
  const uvs = []
  const index = []
  const rings = profile.length
  for (let i = 0; i < rings; i++) {
    const [r, y] = profile[i]
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      positions.push(Math.cos(a) * r, y, Math.sin(a) * r)
      normals.push(Math.cos(a), 0, Math.sin(a))
      uvs.push((j / radial) * uScale, i / (rings - 1))
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j
      const b = a + radial + 1
      index.push(a, b, a + 1)
      index.push(a + 1, b, b + 1)
    }
  }
  return { positions, normals, uvs, index }
}

export const FRUIT_TYPES = ['acorn', 'berry', 'cone', 'nut']

/**
 * 单位果实模板: 总高 1 (沿 +Y), 中心在原点附近
 * @returns {{positions:number[],normals:number[],uvs:number[],index:number[],colors:number[],vertexCount:number,centerY:number}}
 */
export function buildFruitTemplate(o = {}) {
  const type = FRUIT_TYPES.includes(o.type) ? o.type : 'acorn'
  const radial = Math.max(5, Math.round(o.radial || 10))
  const nutColor = new THREE.Color(o.color || '#c8a86a')
  const capColor = new THREE.Color(o.capColor || '#8a6f45')

  // 每种果实的母线 (r, y): 高度约 0..1, 果柄可忽略
  // 坚果: 底部圆钝(带小尖), 上部收窄插进壳斗帽; 顶部 y=+0.15 被帽子盖住
  const nutProfile = {
    acorn: [[0.0, -0.55], [0.10, -0.53], [0.22, -0.47], [0.30, -0.36], [0.34, -0.18], [0.33, 0.0], [0.28, 0.14], [0.20, 0.22], [0.0, 0.26]],
    berry: [[0.0, -0.5], [0.16, -0.46], [0.30, -0.34], [0.36, -0.14], [0.35, 0.1], [0.27, 0.32], [0.13, 0.46], [0.0, 0.5]],
    cone: [[0.0, -0.5], [0.30, -0.44], [0.26, -0.30], [0.32, -0.24], [0.22, -0.08], [0.27, -0.02], [0.16, 0.14], [0.19, 0.2], [0.08, 0.36], [0.0, 0.5]],
    nut: [[0.0, -0.5], [0.20, -0.46], [0.32, -0.32], [0.36, -0.10], [0.33, 0.14], [0.24, 0.30], [0.0, 0.34]],
  }[type]

  const nut = lathe(nutProfile, radial)
  const parts = [nut]
  const colorOf = [nutColor]

  // 壳斗帽: 只给橡果/坚果 (顶部一小段包裹)
  if (type === 'acorn' || type === 'nut') {
    // 壳斗帽: 只包住**顶部约 1/3**, 下沿略宽于坚果 -> 一眼能看出"帽子在顶上"
    const capTop = type === 'acorn' ? 0.34 : 0.2
    const capBottom = type === 'acorn' ? 0.0 : -0.02
    const capRim = type === 'acorn' ? 0.395 : 0.35
    const capProfile = [
      [0.0, capTop + 0.02],
      [0.14, capTop],
      [0.26, capTop - 0.06],
      [capRim, capTop - 0.14],
      [capRim * 0.96, capBottom],        // 帽沿 (最宽处略鼓, 有粗糙感)
      [capRim * 0.88, capBottom - 0.05],
      [capRim * 0.6, capBottom - 0.07],
    ]
    parts.push(lathe(capProfile, radial, 2))
    colorOf.push(capColor)
    // 果柄: 从帽顶向上伸出 (果实就是靠它挂在枝上)
    const stem = lathe([[0.0, capTop], [0.055, capTop + 0.04], [0.05, capTop + 0.16], [0.0, capTop + 0.2]], Math.max(4, radial >> 1))
    parts.push(stem)
    colorOf.push(capColor)
  }

  let partTop = -Infinity
  let partBottom = Infinity
  for (const part of parts) {
    for (let i = 1; i < part.positions.length; i += 3) {
      if (part.positions[i] > partTop) partTop = part.positions[i]
      if (part.positions[i] < partBottom) partBottom = part.positions[i]
    }
  }
  const positions = []
  const normals = []
  const uvs = []
  const colors = []
  const index = []
  let base = 0
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]
    const c = colorOf[p]
    for (let i = 0; i < part.positions.length; i += 3) {
      positions.push(part.positions[i], part.positions[i + 1], part.positions[i + 2])
      normals.push(part.normals[i], part.normals[i + 1], part.normals[i + 2])
      colors.push(c.r, c.g, c.b)
    }
    uvs.push(...part.uvs)
    for (const idx of part.index) index.push(idx + base)
    base += part.positions.length / 3
  }
  // 法线重算 (旋转体母线不是球面, 用几何法线更自然)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  const n = geo.attributes.normal.array
  geo.dispose()
  // 旋转体两极是 r=0 的重复顶点, 连接极点的三角形面积为 0, computeVertexNormals 会给这些
  // 顶点留下**零法线** (导出 OBJ/GLB 时是非法数据: 法线长度 0, 很多 DCC/引擎会出黑斑)。
  // 极点法线解析上就是 ±Y: 按每个 part 的 y 上下界补成 (0,±1,0)。
  let vOffset = 0
  for (const part of parts) {
    const count = part.positions.length / 3
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 1; i < part.positions.length; i += 3) {
      const y = part.positions[i]
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    for (let k = 0; k < count; k++) {
      const o = (vOffset + k) * 3
      if (Math.abs(n[o]) + Math.abs(n[o + 1]) + Math.abs(n[o + 2]) > 1e-12) continue
      const y = positions[(vOffset + k) * 3 + 1]
      n[o] = 0
      n[o + 1] = y <= minY + 1e-6 ? -1 : 1
      n[o + 2] = 0
    }
    vOffset += count
  }
  return {
    positions,
    normals: Array.from(n),
    uvs,
    colors,
    index,
    vertexCount: positions.length / 3,
    // 模板的上下端 (沿 +Y): 果柄末端 / 坚果底 -> 供挂果定位使用
    top: partTop,
    bottom: partBottom,
    centerY: 0,
  }
}

/**
 * 把一个果实模板实例写进 acc
 * @param {object} acc GeoAcc
 * @param {object} tpl buildFruitTemplate 的结果
 * @param {{pos:THREE.Vector3, dir:THREE.Vector3, roll:number, scale:THREE.Vector3|number,
 *          colorTint:THREE.Color, wind:number, phase:number, grow:number, origin:THREE.Vector3, nodeId:number}} o
 */
export function pushFruitInstance(acc, tpl, o) {
  // 关键: 三角面索引必须基于"写入前的累加器顶点数"。
  // 模板会被多处复用 (tpl.offset 会失效), 用 acc.vertexCount 才永远正确。
  const base = acc.vertexCount
  const scale = o.scale === undefined ? 1 : o.scale
  const sx = typeof scale === 'number' ? scale : scale.x
  const sy = typeof scale === 'number' ? scale : scale.y
  const sz = typeof scale === 'number' ? scale : scale.z
  // 正交基: 果实沿 dir 生长, roll 绕自身轴
  const axis = o.dir.clone().normalize()
  const ref = Math.abs(axis.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const tx = new THREE.Vector3().crossVectors(ref, axis).normalize()
  const tz = new THREE.Vector3().crossVectors(axis, tx).normalize()
  const cosR = Math.cos(o.roll || 0)
  const sinR = Math.sin(o.roll || 0)
  const ex = tx.clone().multiplyScalar(cosR).addScaledVector(tz, sinR) // 右
  const ez = new THREE.Vector3().crossVectors(axis, ex).normalize() // 前
  const tint = o.colorTint || new THREE.Color(1, 1, 1)

  const v = new THREE.Vector3()
  for (let i = 0; i < tpl.vertexCount; i++) {
    const px = tpl.positions[i * 3] * sx
    const py = tpl.positions[i * 3 + 1] * sy
    const pz = tpl.positions[i * 3 + 2] * sz
    v.copy(o.pos)
      .addScaledVector(ex, px)
      .addScaledVector(axis, py)
      .addScaledVector(ez, pz)
    acc.vertex(
      v.x, v.y, v.z,
      tpl.normals[i * 3], tpl.normals[i * 3 + 1], tpl.normals[i * 3 + 2],
      tpl.uvs[i * 2], tpl.uvs[i * 2 + 1],
      tpl.colors[i * 3] * tint.r, tpl.colors[i * 3 + 1] * tint.g, tpl.colors[i * 3 + 2] * tint.b,
      o.wind, o.phase, o.origin.x, o.origin.y, o.origin.z, o.grow, o.grow,
      o.nodeId || 0,
    )
  }
  for (let i = 0; i < tpl.index.length; i += 3) {
    acc.tri(base + tpl.index[i], base + tpl.index[i + 1], base + tpl.index[i + 2])
  }
}
