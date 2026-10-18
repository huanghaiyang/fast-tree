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
  /** 橡树叶: 掌状 5 尖裂叶 (对齐用户提供的叶片卡片: 尖裂片 + 凹缺深 + 明显叶柄) */
  oak: (t) => {
    // 叶柄段 (前 12%) 只有细中脉
    if (t < 0.12) return 0.012
    const u = (t - 0.12) / 0.88
    // 整体轮廓: 中部最宽, 两端收窄 (掌状叶接近心形/卵形)
    const body = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.82)), 0.5)
    // 5 个尖裂片: 用"尖齿"函数叠加, 凹缺 (sinus) 很深
    const teeth = 5
    const phase = u * teeth
    const f = Math.abs(Math.sin(Math.PI * (phase + 0.5)))       // 0..1, 裂片中心=0
    const lobe = 1 - 0.42 * Math.pow(f, 1.6)                    // 凹缺最多收 42%
    // 基部两片裂片略小, 顶端裂片收尖
    const tipTaper = u < 0.72 ? 1 : 1 - (u - 0.72) * 1.6
    return Math.max(0.01, body * lobe * Math.max(0.05, tipTaper)) * 0.5
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
  /** 圆叶 (round): 近圆形叶片, 中部最宽, 上下端圆润收口 */
  round: (t) => {
    const base = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.55)
    const tip = t > 0.82 ? 1 - 0.32 * Math.pow((t - 0.82) / 0.18, 2) : 1
    const widen = 0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, t * 1.15))
    return base * tip * widen * 0.98
  },
}

export const LEAF_SHAPE_KEYS = Object.keys(LEAF_OUTLINES)

/**
 * 叶片"卡片"模板 (默认叶形)
 * ------------------------------------------------------------
 * 用户的叶片贴图已经按 alpha 裁掉透明边, 所以贴图矩形 = 叶片轮廓。
 * 用它做几何: 一个 (cols × rows) 的网格矩形, UV 直接铺满贴图,
 * 叶形完全由贴图 alpha 决定 (alphaTest 裁掉透明区) —— 这才是"照片级叶片"的正确做法。
 * @param {{aspect:number, segments:number, curl:number, fold:number, petiole:number}} o
 *        aspect = 裁剪后 宽/高; 长度归一为 1, 宽度 = aspect (再由 leaves.width 缩放)
 */
export function buildLeafCardTemplate(o = {}) {
  const aspect = Math.max(0.15, Math.min(3, o.aspect || 1))
  const cols = Math.max(1, Math.round(o.cols || 1))
  const rows = Math.max(2, Math.min(4, Math.round(o.rows || 3)))
  const curl = o.curl === undefined ? 0.1 : o.curl
  const fold = o.fold === undefined ? 0.12 : o.fold
  const halfW = 0.5 * aspect

  const positions = []
  const normals = []
  const uvs = []
  const index = []
  for (let i = 0; i <= rows; i++) {
    const t = i / rows
    for (let j = 0; j <= cols; j++) {
      const u = j / cols
      const x = (u - 0.5) * 2 * halfW
      const y = t
      // 轻微弓弯/折叠: 让卡片不是纯平面 (受光更自然)
      const z = curl * Math.sin(Math.PI * t) + fold * Math.abs(u - 0.5) * 2 * halfW
      positions.push(x, y, z)
      normals.push(0, 0, 1)
      uvs.push(u, t)
    }
  }
  const stride = cols + 1
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * stride + j
      const b = a + 1
      const c = a + stride
      const d = c + 1
      index.push(a, b, d)
      index.push(a, d, c)
    }
  }
  return { positions, normals, uvs, index, vertexCount: positions.length / 3 }
}

/**
 * 叶片几何工具
 * ------------------------------------------------------------
 * 用旋转体 (funnel) 网格代替平面卡片: 轴向 Y 从 0(花梗) 到 1(花口),
 * 半径由 LEAF_OUTLINES[shape] 给出, 口沿再叠加 5 瓣起伏。
 * 顶点数可控 (rings × radial), 默认 4×8 = 32 顶点 / 48 三角形。
 * @returns {{positions:number[], normals:number[], uvs:number[], index:number[], vertexCount:number, is3d:boolean}}
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
export function pushLeafInstance(acc, tmpl, basis, scale, pos, color0, color1, wind, phase, origin, grow0, grow1, nodeId = 0, stamenColor = null) {
  const { positions, normals, uvs, index, stamenRange } = tmpl
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
    // 花蕊顶点用独立颜色 (不受花瓣调色板影响)
    const inStamen = stamenColor && stamenRange && i >= stamenRange[0] && i < stamenRange[0] + stamenRange[1]
    const r = inStamen ? stamenColor.r : color0.r + (color1.r - color0.r) * k
    const g = inStamen ? stamenColor.g : color0.g + (color1.g - color0.g) * k
    const b = inStamen ? stamenColor.b : color0.b + (color1.b - color0.b) * k

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
