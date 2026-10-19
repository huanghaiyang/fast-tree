/**
 * 导出拆分: 把合并后的树皮几何按模型节点组拆成多个 mesh
 * ------------------------------------------------------------
 * 内部渲染为了只要 2 个 draw call, 会把所有树皮枝条合并成一个 BufferGeometry;
 * 但导出的模型应该保留结构: 树干 / 树枝(按层级) / 根 / 果实 分别是独立节点,
 * 方便在 Blender / Unity / Unreal 里单独选中、赋材质或做 LOD。
 *
 * 拆分依据是每个顶点上的 `aNodeId` 属性 + finalizeNodes 生成的节点表
 * (节点带 type / group / level 信息)。纯函数, 可在 Node 里直接测试。
 */
import * as THREE from 'three'

export const BARK_EXPORT_ORDER = [
  'Bark',
  'Bark_Trunk',
  'Bark_Roots',
  'Bark_Branch_L1',
  'Bark_Branch_L2',
  'Bark_Branch_L3',
  'Bark_Branch_L4',
  'Bark_Branch_L5',
  'Bark_Fruit',
  'Bark_Other',
]

/** 根据节点类型/组给顶点分组名 */
export function barkGroupName(node) {
  if (!node) return 'Bark_Other'
  if (node.type === 'fruit') return 'Bark_Fruit'
  if (node.type === 'trunk') return 'Bark_Trunk'
  if (node.type === 'root') return 'Bark_Roots'
  if (node.type === 'branch') {
    const m = /^branch-L(\d+)$/.exec(String(node.group || ''))
    if (m) return 'Bark_Branch_L' + Math.min(5, Math.max(1, Number(m[1]) || 1))
    return 'Bark_Branch_L' + Math.min(5, Math.max(1, Number(node.level) || 1))
  }
  return 'Bark_Other'
}

/**
 * 按导出设置返回树皮部分:
 *   merge=true  -> 树干 + 树枝各层合并为一个 Bark mesh; 树根/果实仍独立
 *   merge=false -> 按树干/树枝各层/根/果实拆分
 * @param {import('three').BufferGeometry} geometry
 * @param {Array<object>} nodes
 * @param {boolean} merge
 */
export function barkExportParts(geometry, nodes, merge = false) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return []
  return splitBarkGeometryByNodeGroups(geometry, nodes, { mergeTrunkBranches: !!merge })
}

/**
 * @param {import('three').BufferGeometry} geometry 合并后的树皮几何
 * @param {Array<object>} nodes finalizeNodes 节点表
 * @param {{mergeTrunkBranches?:boolean}} [opts] mergeTrunkBranches = 把树干与树枝合成一个 Bark 节点 (根/果实仍独立)
 * @returns {Array<{name:string, geometry:import('three').BufferGeometry, triangles:number, vertices:number}>}
 */
export function splitBarkGeometryByNodeGroups(geometry, nodes, opts = {}) {
  const mergeTrunkBranches = !!opts.mergeTrunkBranches
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return []
  const idAttr = geometry.attributes.aNodeId
  const nodeList = Array.isArray(nodes) ? nodes : []
  const nodeById = new Map(nodeList.map((n) => [n.id, n]))
  const labelOf = (nodeId) => {
    const label = barkGroupName(nodeById.get(nodeId))
    if (mergeTrunkBranches && (label === 'Bark_Trunk' || label.startsWith('Bark_Branch_'))) return 'Bark'
    return label
  }

  const indexAttr = geometry.index
  const srcIndex = indexAttr ? indexAttr.array : null
  const triCount = srcIndex ? Math.floor(srcIndex.length / 3) : Math.floor((geometry.attributes.position.count || 0) / 3)
  const attrNames = Object.keys(geometry.attributes)
  const idValues = idAttr ? idAttr.array : null
  if (!triCount || !idValues) return []

  // 每个分组: 新顶点重映射 + 属性数据
  const groups = new Map()
  const ensureGroup = (label) => {
    let g = groups.get(label)
    if (!g) {
      g = { label, indices: [], remap: new Map(), attrs: Object.fromEntries(attrNames.map((n) => [n, []])) }
      groups.set(label, g)
    }
    return g
  }

  for (let t = 0; t < triCount; t++) {
    const a = srcIndex ? srcIndex[t * 3] : t * 3
    const b = srcIndex ? srcIndex[t * 3 + 1] : t * 3 + 1
    const c = srcIndex ? srcIndex[t * 3 + 2] : t * 3 + 2
    const label = labelOf(idValues[a])
    const g = ensureGroup(label)
    const corners = [a, b, c]
    for (const vi of corners) {
      let ni = g.remap.get(vi)
      if (ni === undefined) {
        ni = g.remap.size
        g.remap.set(vi, ni)
        for (const name of attrNames) {
          const attr = geometry.attributes[name]
          const size = attr.itemSize
          const arr = attr.array
          for (let k = 0; k < size; k++) g.attrs[name].push(arr[vi * size + k])
        }
      }
      g.indices.push(ni)
    }
  }

  const order = (label) => {
    const i = BARK_EXPORT_ORDER.indexOf(label)
    return i < 0 ? 999 : i
  }
  return [...groups.values()]
    .sort((x, y) => order(x.label) - order(y.label) || x.label.localeCompare(y.label))
    .map((g) => {
      const out = new THREE.BufferGeometry()
      for (const name of attrNames) {
        const srcAttr = geometry.attributes[name]
        const values = g.attrs[name]
        const Ctor = srcAttr.array.constructor
        const attr = new THREE.BufferAttribute(Ctor.from(values), srcAttr.itemSize, srcAttr.normalized)
        out.setAttribute(name, attr)
      }
      if (indexAttr) {
        const Ctor = srcIndex.constructor
        out.setIndex(new THREE.BufferAttribute(Ctor.from(g.indices), 1))
      }
      out.computeBoundingSphere()
      out.computeBoundingBox()
      return {
        name: g.label,
        geometry: out,
        triangles: g.indices.length / 3,
        vertices: g.remap.size,
      }
    })
}
