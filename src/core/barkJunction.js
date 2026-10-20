/**
 * 树干/树枝/树根的接缝处理:
 *   - csg      : 真实布尔并集 (three-bvh-csg)，消除枝干内部重叠面
 *   - implicit : 布尔并集 + 顶点/法线平滑重建 (实验性隐式表面近似)
 *
 * 输入是 buildTree 合并后的树皮几何 (含 aNodeId 等自定义属性)。
 * CSG 只处理非果实部分，果实保持原样拼回；结果会从原始表面最近点
 * 补回 UV / 顶点色 / aWind 等属性，保证视口材质和风场仍可用。
 */
import * as THREE from 'three'
import { Brush, Evaluator, ADDITION } from 'three-bvh-csg'
import { MeshBVH } from 'three-mesh-bvh'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { splitBarkGeometryByNodeGroups } from './exportSplit.js'

const ATTR_ITEM_SIZE = {
  position: 3,
  normal: 3,
  uv: 2,
  color: 3,
  aWind: 1,
  aPhase: 1,
  aOrigin: 3,
  aGrow: 2,
  aNodeId: 1,
}

function makeTransferSource(parts) {
  return parts.length === 1 ? parts[0].geometry : mergeGeometries(parts.map((p) => p.geometry), false)
}

function closestSourceData(bvh, source, point) {
  const hit = {
    point: new THREE.Vector3(),
    distance: 0,
    faceIndex: -1,
  }
  bvh.closestPointToPoint(point, hit)
  if (hit.faceIndex === undefined || hit.faceIndex < 0) return null
  const idx = source.index
  if (!idx) return null
  const ia = idx.getX(hit.faceIndex * 3)
  const ib = idx.getX(hit.faceIndex * 3 + 1)
  const ic = idx.getX(hit.faceIndex * 3 + 2)
  const a = new THREE.Vector3().fromBufferAttribute(source.attributes.position, ia)
  const b = new THREE.Vector3().fromBufferAttribute(source.attributes.position, ib)
  const c = new THREE.Vector3().fromBufferAttribute(source.attributes.position, ic)
  const tri = new THREE.Triangle(a, b, c)
  const bary = new THREE.Vector3()
  tri.getBarycoord(hit.point, bary)
  if (!Number.isFinite(bary.x) || !Number.isFinite(bary.y) || !Number.isFinite(bary.z)) {
    return { indices: [ia, ib, ic], bary: new THREE.Vector3(1, 0, 0) }
  }
  return { indices: [ia, ib, ic], bary }
}

/**
 * 把自定义顶点属性从原始树皮表面转移到 CSG 结果上。
 * CSG 结果只保留 position/uv/normal，颜色、风场、节点 id 需要重新采样。
 */
export function transferGeometryAttributes(target, source) {
  const count = target.attributes.position.count
  const originalPosition = target.attributes.position.array.slice()
  const targetArrays = {}
  for (const [name, itemSize] of Object.entries(ATTR_ITEM_SIZE)) {
    targetArrays[name] = new Float32Array(count * itemSize)
  }
  // position 仍使用 CSG 结果 (必须在替换属性前保存)
  targetArrays.position.set(originalPosition)
  for (const [name, itemSize] of Object.entries(ATTR_ITEM_SIZE)) {
    target.setAttribute(name, new THREE.BufferAttribute(targetArrays[name], itemSize))
  }
  const bvh = new MeshBVH(source)
  const p = new THREE.Vector3()
  const normal = new THREE.Vector3()

  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(target.attributes.position, i)
    const hit = closestSourceData(bvh, source, p)
    const bary = hit ? hit.bary : new THREE.Vector3(1, 0, 0)
    const indices = hit ? hit.indices : [0, 0, 0]
    const weights = [bary.x, bary.y, bary.z]

    const sample = (name, comp) => {
      const attr = source.attributes[name]
      if (!attr) return 0
      let v = 0
      for (let k = 0; k < 3; k++) v += weights[k] * attr.getComponent(indices[k], comp)
      return v
    }

    for (const [name, itemSize] of Object.entries(ATTR_ITEM_SIZE)) {
      if (name === 'position') continue
      if (name === 'aNodeId') {
        let dom = 0
        if (weights[1] > weights[dom]) dom = 1
        if (weights[2] > weights[dom]) dom = 2
        targetArrays[name][i] = source.attributes.aNodeId.getComponent(indices[dom], 0)
        continue
      }
      for (let c = 0; c < itemSize; c++) targetArrays[name][i * itemSize + c] = sample(name, c)
    }

    normal.set(
      targetArrays.normal[i * 3],
      targetArrays.normal[i * 3 + 1],
      targetArrays.normal[i * 3 + 2],
    )
    if (normal.lengthSq() > 1e-12) normal.normalize()
    targetArrays.normal[i * 3] = normal.x
    targetArrays.normal[i * 3 + 1] = normal.y
    targetArrays.normal[i * 3 + 2] = normal.z
  }
  target.attributes.position.needsUpdate = true
  target.attributes.normal.needsUpdate = true
}

/**
 * CSG 结果会把切割点拆成重复顶点 (位置相同、UV/法线不同), 拓扑上看起来有大量
 * “边界边”。按位置焊接顶点，保留自定义属性，得到闭合的并集表面。
 */
function weldByPosition(geometry, tolerance = 1e-4) {
  const pos = geometry.attributes.position
  if (!pos) return geometry
  const index = geometry.index
  const count = pos.count
  const map = new Map()
  const remap = new Uint32Array(count)
  const newIndices = []
  const attrNames = Object.keys(geometry.attributes)
  const arrays = {}
  for (const name of attrNames) {
    const attr = geometry.attributes[name]
    arrays[name] = new Float32Array(count * attr.itemSize)
  }
  let outCount = 0
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const key = `${Math.round(x / tolerance)}:${Math.round(y / tolerance)}:${Math.round(z / tolerance)}`
    let to = map.get(key)
    if (to === undefined) {
      to = outCount++
      map.set(key, to)
      for (const name of attrNames) {
        const attr = geometry.attributes[name]
        const n = attr.itemSize
        for (let c = 0; c < n; c++) arrays[name][to * n + c] = attr.getComponent(i, c)
      }
    }
    remap[i] = to
  }
  if (outCount === count) return geometry
  const out = new THREE.BufferGeometry()
  for (const name of attrNames) {
    out.setAttribute(name, new THREE.BufferAttribute(arrays[name].subarray(0, outCount * geometry.attributes[name].itemSize), geometry.attributes[name].itemSize))
  }
  if (index) {
    for (let i = 0; i < index.count; i++) newIndices.push(remap[index.getX(i)])
    out.setIndex(newIndices)
  }
  // 重新计算法线，避免重复顶点焊接后的硬边
  out.deleteAttribute('normal')
  out.computeVertexNormals()
  return out
}

/** 实验性隐式平滑: 焊接重复点 + 短程拉普拉斯平滑 + 重算法线 */
function smoothUnionGeometry(geometry) {
  let geo = weldByPosition(geometry)
  try {
    geo = mergeVertices(geo, 1e-4)
  } catch {
    // 保留原几何
  }
  if (!geo.attributes.position) return geo
  const pos = geo.attributes.position
  const idx = geo.index
  const count = pos.count
  if (!idx || count < 4) return geo
  const adj = Array.from({ length: count }, () => [])
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i)
    const b = idx.getX(i + 1)
    const c = idx.getX(i + 2)
    adj[a].push(b, c)
    adj[b].push(a, c)
    adj[c].push(a, b)
  }
  const old = new Float32Array(pos.array)
  const out = new Float32Array(pos.array)
  const factor = 0.22
  for (let i = 0; i < count; i++) {
    const n = adj[i]
    if (!n.length) continue
    let x = 0, y = 0, z = 0
    for (const j of n) {
      x += old[j * 3]
      y += old[j * 3 + 1]
      z += old[j * 3 + 2]
    }
    x /= n.length
    y /= n.length
    z /= n.length
    out[i * 3] = old[i * 3] * (1 - factor) + x * factor
    out[i * 3 + 1] = old[i * 3 + 1] * (1 - factor) + y * factor
    out[i * 3 + 2] = old[i * 3 + 2] * (1 - factor) + z * factor
  }
  pos.array.set(out)
  pos.needsUpdate = true
  geo.deleteAttribute('normal')
  geo.computeVertexNormals()
  return geo
}

/**
 * @param {THREE.BufferGeometry} barkGeometry 原始合并树皮几何
 * @param {Array<object>} nodes 节点表 (id/type/group/level)
 * @param {'csg'|'implicit'} mode
 * @returns {THREE.BufferGeometry|null} 处理后的几何；失败返回 null
 */
export function applyBarkJunction(barkGeometry, nodes, mode) {
  if (!barkGeometry || !barkGeometry.attributes || !barkGeometry.attributes.position) return null
  if (mode !== 'csg' && mode !== 'implicit') return null

  let parts
  try {
    parts = splitBarkGeometryByNodeGroups(barkGeometry, nodes)
  } catch {
    return null
  }
  const body = parts.filter((p) => p.name !== 'Bark_Fruit')
  const fruit = parts.filter((p) => p.name === 'Bark_Fruit')
  if (body.length < 2) return null

  let unionGeometry
  try {
    const material = new THREE.MeshStandardMaterial()
    const evaluator = new Evaluator()
    evaluator.useGroups = false
    let brush = new Brush(body[0].geometry, material)
    brush.updateMatrixWorld()
    for (let i = 1; i < body.length; i++) {
      const next = new Brush(body[i].geometry, material)
      next.updateMatrixWorld()
      brush = evaluator.evaluate(brush, next, ADDITION)
    }
    unionGeometry = brush.geometry
    material.dispose()
  } catch (err) {
    console.warn('[FastTree] 布尔并集失败，回退原始几何:', err)
    return null
  }

  // 从原始表面补回自定义属性
  try {
    const source = makeTransferSource(body)
    transferGeometryAttributes(unionGeometry, source)
    source.dispose()
  } catch (err) {
    console.warn('[FastTree] 并集属性转移失败，回退原始几何:', err)
    return null
  }

  if (mode === 'implicit') unionGeometry = smoothUnionGeometry(unionGeometry)
  else unionGeometry = weldByPosition(unionGeometry)

  if (fruit.length) {
    const fruitGeo = mergeGeometries(fruit.map((p) => p.geometry), false)
    if (fruitGeo) {
      unionGeometry = mergeGeometries([unionGeometry, fruitGeo], false)
    }
  }
  unionGeometry.computeBoundingBox()
  unionGeometry.computeBoundingSphere()
  return unionGeometry
}





