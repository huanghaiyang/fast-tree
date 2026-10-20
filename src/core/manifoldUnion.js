/**
 * 严格一体流形: 用 manifold-3d 对树干/树枝/树根做布尔并集。
 *
 * 与 three-bvh-csg 不同, manifold-3d 的输出保证是 2-manifold:
 * 每条边恰好两个三角面、无边界边、朝外。果实不参与并集, 仍单独导出。
 * 并集结果没有 UV/颜色等属性, 从原始树皮表面最近点采样补回。
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { splitBarkGeometryByNodeGroups } from './exportSplit.js'
import { transferGeometryAttributes } from './barkJunction.js'
import { getManifoldApi } from './manifoldRuntime.js'

function toManifoldMesh(api, geometry) {
  const pos = geometry.attributes.position
  const idx = geometry.index
  if (!pos || !idx) return null
  const vertProperties = new Float32Array(pos.array.length)
  vertProperties.set(pos.array)
  const triVerts = new Uint32Array(idx.array.length)
  triVerts.set(idx.array)
  return new api.Mesh({ numProp: 3, vertProperties, triVerts })
}

function makeBodySource(parts) {
  return parts.length === 1
    ? parts[0].geometry
    : mergeGeometries(parts.map((p) => p.geometry), false)
}

/**
 * @param {THREE.BufferGeometry} barkGeometry
 * @param {Array<object>} nodes
 * @returns {THREE.BufferGeometry|null} 严格流形几何; WASM 未就绪或失败返回 null
 */
export function applyManifoldJunction(barkGeometry, nodes) {
  const api = getManifoldApi()
  if (!api) return null
  let parts
  try {
    parts = splitBarkGeometryByNodeGroups(barkGeometry, nodes)
  } catch {
    return null
  }
  const body = parts.filter((p) => p.name !== 'Bark_Fruit')
  const fruit = parts.filter((p) => p.name === 'Bark_Fruit')
  if (body.length < 2) return null

  let union
  try {
    const manifolds = []
    for (const p of body) {
      const mesh = toManifoldMesh(api, p.geometry)
      if (!mesh) return null
      manifolds.push(api.Manifold.ofMesh(mesh))
    }
    union = manifolds.length === 1 ? manifolds[0] : api.Manifold.union(manifolds)
    if (!union || union.isEmpty()) return null
    const mesh = union.getMesh()
    const out = new THREE.BufferGeometry()
    out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), 3))
    out.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1))
    out.computeBoundingBox()
    out.computeBoundingSphere()

    const source = makeBodySource(body)
    transferGeometryAttributes(out, source)
    if (source !== body[0].geometry) source.dispose()

    if (fruit.length) {
      const fruitGeo = mergeGeometries(fruit.map((p) => p.geometry), false)
      if (fruitGeo) {
        const combined = mergeGeometries([out, fruitGeo], false)
        if (combined) return combined
      }
    }
    return out
  } catch (err) {
    console.warn('[FastTree] manifold 并集失败，保留原始几何:', err)
    return null
  } finally {
    try { union && union.delete && union.delete() } catch { /* ignore */ }
  }
}
