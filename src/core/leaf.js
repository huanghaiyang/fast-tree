/**
 * 叶片: 形状模板 + 实例化写入
 * ------------------------------------------------------------
 * 模板在单位空间生成 (长度 1, 沿 +Y, 法线朝 +Z), 每片叶子通过
 * 正交基 + 非等比缩放变换到世界空间, 顶点颜色烘焙"叶基->叶尖"渐变。
 *
 * 叶片几何直接写入主 acc, 所以整棵树最终只有 2 个 draw call:
 * 树皮 1 个 + 树叶 1 个。
 */
import * as THREE from 'three'

/** 形状轮廓: 返回 t (0=叶柄, 1=叶尖) 处的半宽
 *  约定: 所有形状归一到 0..0.5, 叶片粗细由 leaves.width 控制
 *  注: 不同树种的叶形差别很大 (参考图), 这里为每个树种群准备独立轮廓 */
export const LEAF_OUTLINES = {
  oval: (t) => Math.pow(Math.sin(Math.PI * t), 0.62) * 0.5,
  birch: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.92)), 0.72) * 0.5,
  lance: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 1.05)), 0.5) * 0.48,
  needle: (t) => Math.pow(Math.sin(Math.PI * t), 0.34) * 0.42,
  maple: (t) => {
    const base = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.15)), 0.55)
    const lobes = 0.82 + 0.18 * Math.cos(t * Math.PI * 6)
    return base * lobes * 0.5
  },
  /** 橡树叶: 羽状深裂, 5~7 对圆裂片 (参考图 5) —— 裂片深、叶基楔形、叶尖圆钝 */
  oak: (t) => {
    // 叶基楔形 -> 叶尖收窄的整体轮廓
    const base = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.12)), 0.42)
    // 裂片: 沿叶轴周期性收缩 (sinus 越深裂片越明显)
    const lobeCount = 6
    const sinus = 0.62 + 0.38 * Math.abs(Math.cos(t * Math.PI * lobeCount))
    // 叶基附近裂片较浅, 叶尖附近也收敛
    const depth = 0.55 + 0.45 * Math.sin(Math.PI * Math.pow(t, 0.85))
    return base * (1 - (1 - sinus) * depth) * 0.5
  },
  /** 枫叶: 掌状 5 裂 */
  palmate: (t) => {
    const base = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.2)), 0.5)
    const lobes = 0.7 + 0.3 * Math.cos(t * Math.PI * 10)
    return base * lobes * 0.5
  },
  /** 针叶束: 细长且几乎等宽 */
  needleLong: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.22) * 0.4,
  /** 心形叶 (椴/杨) */
  cordate: (t) => {
    const s = Math.sin(Math.PI * Math.pow(t, 0.8))
    return (Math.pow(s, 0.5) * (0.82 + 0.18 * Math.cos(Math.PI * 2 * t))) * 0.5
  },
  /** 落叶: 干燥卷曲的残叶 (边缘不规则) */
  litter: (t) => {
    const base = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.05)), 0.6)
    const dry = 0.86 + 0.14 * Math.cos(t * Math.PI * 7 + 1.3)
    return base * dry * 0.5
  },
}

export const LEAF_SHAPE_KEYS = Object.keys(LEAF_OUTLINES)

/**
 * 单位叶片模板 (无索引 -> 由 pushLeafInstance 直接写入三角面)
 * @returns {{positions:number[], normals:number[], uvs:number[], index:number[], vertexCount:number}}
 */
export function buildLeafTemplate(o = {}) {
  const shape = LEAF_OUTLINES[o.shape] || LEAF_OUTLINES.oval
  const rows = Math.max(2, Math.round(o.segments || 5))
  const curl = o.curl === undefined ? 0.18 : o.curl // 纵向弯曲 (单位空间, 会被 size 缩放)
  const fold = o.fold === undefined ? 0.28 : o.fold // 横向 V 形折叠
  const petiole = o.petiole === undefined ? 0.0 : o.petiole // 叶柄长度比例

  const geo = new THREE.BufferGeometry()
  const positions = []
  const uvs = []
  const index = []

  for (let i = 0; i <= rows; i++) {
    const t = i / rows
    // 叶柄段: 前 petiole 比例内只保留中脉
    const inBlade = petiole > 0 ? Math.max(0, (t - petiole) / (1 - petiole)) : t
    const hw = shape(inBlade) * (petiole > 0 && t < petiole ? 0.012 : 1)
    const y = t
    // curl = 纵向弓弯, fold = 横向 V 形折叠。
    // 关键: 折叠抬升量按半宽等比缩放 -> 无论叶片宽窄, 折角恒定,
    // 细长针叶不会被"折"成侧立的刀片 (那样法线会背向太阳而发黑)。
    const midZ = curl * Math.sin(Math.PI * inBlade)
    const edgeZ = midZ + fold * hw
    // left
    positions.push(-hw, y, edgeZ)
    uvs.push(0, t)
    // right
    positions.push(hw, y, edgeZ)
    uvs.push(1, t)
  }
  for (let i = 0; i < rows; i++) {
    const l0 = i * 2
    const r0 = i * 2 + 1
    const l1 = (i + 1) * 2
    const r1 = (i + 1) * 2 + 1
    index.push(l0, r0, r1)
    index.push(l0, r1, l1)
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  const normals = Array.from(geo.attributes.normal.array)
  geo.dispose()

  return { positions, normals, uvs, index, vertexCount: positions.length / 3 }
}

/**
 * 把一片叶子写入累加器
 * @param {import('./mathUtils.js').GeoAcc} acc
 * @param {*} tmpl   buildLeafTemplate 结果
 * @param {{x:THREE.Vector3,y:THREE.Vector3,z:THREE.Vector3}} basis 正交基 (y = 叶轴, z = 叶面法线)
 * @param {THREE.Vector3} scale 非等比缩放 (宽, 长, 厚)
 * @param {THREE.Vector3} pos   叶柄基点 (世界坐标)
 * @param {THREE.Color} color0  叶基颜色
 * @param {THREE.Color} color1  叶尖颜色
 */
export function pushLeafInstance(acc, tmpl, basis, scale, pos, color0, color1, wind, phase, origin, grow0, grow1, nodeId = 0) {
  const { positions, normals, uvs, index } = tmpl
  const base = acc.vertexCount
  const n = tmpl.vertexCount
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    const lx = positions[i3] * scale.x
    const ly = positions[i3 + 1] * scale.y
    const lz = positions[i3 + 2] * scale.z
    const wx = pos.x + basis.x.x * lx + basis.y.x * ly + basis.z.x * lz
    const wy = pos.y + basis.x.y * lx + basis.y.y * ly + basis.z.y * lz
    const wz = pos.z + basis.x.z * lx + basis.y.z * ly + basis.z.z * lz

    // 法线的逆转置: 先按缩放反向除, 再旋转
    const nx0 = normals[i3] / scale.x
    const ny0 = normals[i3 + 1] / scale.y
    const nz0 = normals[i3 + 2] / scale.z
    let nx = basis.x.x * nx0 + basis.y.x * ny0 + basis.z.x * nz0
    let ny = basis.x.y * nx0 + basis.y.y * ny0 + basis.z.y * nz0
    let nz = basis.x.z * nx0 + basis.y.z * ny0 + basis.z.z * nz0
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl; ny /= nl; nz /= nl

    const v = uvs[i * 2 + 1]
    const k = Math.pow(v, 0.75)
    const r = color0.r + (color1.r - color0.r) * k
    const g = color0.g + (color1.g - color0.g) * k
    const b = color0.b + (color1.b - color0.b) * k

    acc.vertex(
      wx, wy, wz, nx, ny, nz,
      uvs[i * 2], uvs[i * 2 + 1],
      Math.min(1, r), Math.min(1, g), Math.min(1, b),
      wind, phase,
      origin.x, origin.y, origin.z,
      grow0, grow1, nodeId,
    )
  }
  for (let i = 0; i < index.length; i += 3) {
    acc.tri(base + index[i], base + index[i + 1], base + index[i + 2])
  }
}
