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
  const nutProfile = {
    acorn: [[0.0, -0.52], [0.14, -0.5], [0.28, -0.42], [0.34, -0.26], [0.35, -0.08], [0.31, 0.12], [0.22, 0.31], [0.10, 0.44], [0.0, 0.5]],
    berry: [[0.0, -0.5], [0.16, -0.46], [0.30, -0.34], [0.36, -0.14], [0.35, 0.1], [0.27, 0.32], [0.13, 0.46], [0.0, 0.5]],
    cone: [[0.0, -0.5], [0.30, -0.44], [0.26, -0.30], [0.32, -0.24], [0.22, -0.08], [0.27, -0.02], [0.16, 0.14], [0.19, 0.2], [0.08, 0.36], [0.0, 0.5]],
    nut: [[0.0, -0.5], [0.20, -0.46], [0.32, -0.32], [0.36, -0.10], [0.33, 0.14], [0.24, 0.34], [0.11, 0.46], [0.0, 0.5]],
  }[type]

  const nut = lathe(nutProfile, radial)
  const parts = [nut]
  const colorOf = [nutColor]

  // 壳斗帽: 只给橡果/坚果 (顶部一小段包裹)
  if (type === 'acorn' || type === 'nut') {
    const capTop = type === 'acorn' ? 0.2 : 0.06
    const capR = type === 'acorn' ? 0.40 : 0.34
    // 帽沿做一点起伏, 像参考图那样粗糙
    const capProfile = []
    const capRings = 4
    for (let i = 0; i < capRings; i++) {
      const t = i / (capRings - 1)
      const y = capTop - t * (capTop + 0.34)
      const wobble = 1 + 0.06 * Math.cos(t * Math.PI * 3)
      const r = capR * (0.55 + 0.65 * Math.sin(Math.PI * (0.15 + 0.85 * t))) * wobble
      capProfile.push([Math.max(0.02, r), y])
    }
    capProfile.push([0.0, capTop - 0.34 - 0.02])
    parts.push(lathe(capProfile, radial, 2))
    colorOf.push(capColor)
    // 果柄
    const stem = lathe([[0.0, 0.18], [0.05, 0.22], [0.045, 0.5], [0.0, 0.56]], Math.max(4, radial >> 1))
    parts.push(stem)
    colorOf.push(capColor)
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
  return {
    positions,
    normals: Array.from(n),
    uvs,
    colors,
    index,
    vertexCount: positions.length / 3,
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
    acc.tri(tpl.offset + tpl.index[i], tpl.offset + tpl.index[i + 1], tpl.offset + tpl.index[i + 2])
  }
  tpl.offset += tpl.vertexCount
}
