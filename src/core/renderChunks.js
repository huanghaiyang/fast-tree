import * as THREE from 'three'

/** 源网格放到相机默认层之外: 只用于导出/统计, 不再直接渲染 */
export const SOURCE_ONLY_LAYER = 31

/**
 * 把合并几何按空间网格切成若干块 (只做渲染用; 源几何完全不动)。
 * 每一块有自己的包围球, Three.js 会按视锥逐块剔除 ——
 * 窗口外的树叶/花朵/果实(含在树皮几何里)所在的块不会提交渲染。
 *
 * 块几何共享源几何的顶点属性, 只复制三角形索引子集, 所以内存开销很小。
 */
export function buildFrustumChunks(geometry, material, opts = {}) {
  const {
    name = 'Chunk',
    grid = [2, 2, 2],
    minTriangles = 120,
    castShadow = true,
    receiveShadow = false,
  } = opts
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return []
  const index = geometry.index
  if (!index || index.count < minTriangles * 3) return []

  geometry.computeBoundingBox()
  const rootBox = geometry.boundingBox
  if (!rootBox || rootBox.isEmpty()) return []
  const pos = geometry.attributes.position
  const idx = index.array
  const nx = Math.max(1, grid[0] | 0)
  const ny = Math.max(1, grid[1] | 0)
  const nz = Math.max(1, grid[2] | 0)
  const size = new THREE.Vector3(
    Math.max(1e-6, rootBox.max.x - rootBox.min.x),
    Math.max(1e-6, rootBox.max.y - rootBox.min.y),
    Math.max(1e-6, rootBox.max.z - rootBox.min.z),
  )
  const cells = new Map()

  const cellKey = (x, y, z) => `${x},${y},${z}`
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3
    const b = idx[i + 1] * 3
    const c = idx[i + 2] * 3
    const cx = (pos.array[a] + pos.array[b] + pos.array[c]) / 3
    const cy = (pos.array[a + 1] + pos.array[b + 1] + pos.array[c + 1]) / 3
    const cz = (pos.array[a + 2] + pos.array[b + 2] + pos.array[c + 2]) / 3
    const ix = Math.min(nx - 1, Math.max(0, Math.floor(((cx - rootBox.min.x) / size.x) * nx)))
    const iy = Math.min(ny - 1, Math.max(0, Math.floor(((cy - rootBox.min.y) / size.y) * ny)))
    const iz = Math.min(nz - 1, Math.max(0, Math.floor(((cz - rootBox.min.z) / size.z) * nz)))
    const key = cellKey(ix, iy, iz)
    let cell = cells.get(key)
    if (!cell) {
      cell = []
      cells.set(key, cell)
    }
    cell.push(idx[i], idx[i + 1], idx[i + 2])
  }

  const out = []
  let serial = 0
  for (const tris of cells.values()) {
    if (tris.length < 3) continue
    const chunk = new THREE.BufferGeometry()
    for (const attrName of Object.keys(geometry.attributes)) {
      chunk.setAttribute(attrName, geometry.attributes[attrName])
    }
    chunk.setIndex(tris)
    // 包围盒/包围球必须按该块的三角形算, 不能用共享 position 的整体包围球,
    // 否则所有块的 boundingSphere 都是整棵树, 视锥剔除会失效。
    const box = new THREE.Box3()
    const p = new THREE.Vector3()
    for (let i = 0; i < tris.length; i++) {
      p.fromBufferAttribute(pos, tris[i])
      box.expandByPoint(p)
    }
    chunk.boundingBox = box
    // 用块内真实顶点到中心的距离算半径; 直接用包围盒角点会偏大, 视锥剔除会不够积极
    const center = box.getCenter(new THREE.Vector3())
    let radius2 = 0
    for (let i = 0; i < tris.length; i++) {
      const vx = pos.array[tris[i] * 3] - center.x
      const vy = pos.array[tris[i] * 3 + 1] - center.y
      const vz = pos.array[tris[i] * 3 + 2] - center.z
      const d2 = vx * vx + vy * vy + vz * vz
      if (d2 > radius2) radius2 = d2
    }
    chunk.boundingSphere = new THREE.Sphere(center, Math.sqrt(radius2))
    const mesh = new THREE.Mesh(chunk, material)
    mesh.name = `${name}-Cull${serial++}`
    mesh.castShadow = castShadow
    mesh.receiveShadow = receiveShadow
    mesh.frustumCulled = true
    out.push(mesh)
  }
  return out
}

/** 源网格不参与渲染 (但保留几何给导出/统计/粒子采样) */
export function hideSourceMesh(mesh) {
  if (!mesh) return
  mesh.layers.set(SOURCE_ONLY_LAYER)
  mesh.frustumCulled = false
}
