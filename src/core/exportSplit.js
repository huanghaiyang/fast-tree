/**
 * 导出拆分: 把合并后的树皮几何按模型节点组拆成多个 mesh
 * ------------------------------------------------------------
 * 内部渲染为了只要 2 个 draw call, 会把所有树皮枝条合并成一个 BufferGeometry;
 * 但导出的模型应该保留结构: 树干 / 树枝(按层级) / 根 / 果实 分别是独立节点,
 * 方便在 Blender / Unity / Unreal 里单独选中、赋材质或做 LOD。
 *
 * 拆分依据是每个顶点上的 `aNodeId` 属性 + finalizeNodes 生成的节点表
 * (节点带 type / group / level 信息)。纯函数, 可在 Node 里直接测试。
 *
 * 作用: 合并几何 -> `[{name, geometry, triangles, vertices}]`, 一个分组一个几何。
 * 输入 / 输出:
 *   - 输入: 合并树皮几何 (必须带 `aNodeId` 顶点属性) + 节点表 + 合并策略开关;
 *   - 输出: 按 `BARK_EXPORT_ORDER` 排好序的分组数组, 每项含**独立**的 BufferGeometry。
 * 与其他模块的关系:
 *   - 上游: `sceneManager.js` 的导出组构建流程 (拿 treeBuilder 的合并几何与节点表);
 *   - 下游: `exporter.js` 用这些分组拼成导出组, 再交给 GLTFExporter / OBJExporter;
 *   - 节点表格式由 `treeBuilder.js` 的 finalizeNodes 决定 (本模块只读, 不校验字段)。
 * 关键约定:
 *   - 单位与坐标系与源几何完全一致 (世界坐标/米), 本模块只做"重排索引 + 复制属性";
 *   - 顶点是**按分组复制**的: 同一个源顶点若被两组共用, 会在两个输出几何里各存一份
 *     (即顶点分裂, 顶点总数会变多); 这是导出结构化的必然代价, 不是 bug;
 *   - 纯函数: 不改入参 geometry/nodes, 输出几何里的属性数组都是新建的。
 */

import * as THREE from 'three'

/* ---------------- 导出节点名 / 顺序 ----------------
 * 这个数组决定导出文件里的节点顺序, 也就是 Blender outliner / Unity 层级里的排列。
 * 顺序约定: 总体 Bark -> 主干 -> 树根 -> 树枝逐层加深 (L1..L5) -> 果实 -> 其它。
 * 不在此表中的分组名会被排到最后 (order 返回 999) 并按字典序排序。
 */
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

/**
 * 根据节点类型/组给顶点分组名。
 *
 * 判定顺序 (前者优先):
 *   1. `type === 'fruit'`  -> `Bark_Fruit`  (果实虽然挂在枝上, 但要能单独赋材质)
 *   2. `type === 'trunk'`  -> `Bark_Trunk`
 *   3. `type === 'root'`   -> `Bark_Roots`
 *   4. `type === 'branch'` -> 先尝试从 `group` 里解析 `branch-L<数字>` (生成器给的显式层级),
 *      解析不到再用 `node.level`; 两者都夹到 1..5 并对齐到 `Bark_Branch_L<n>`
 *   5. 其它 / 空节点 -> `Bark_Other`
 *
 * 为什么层级要夹到 1..5: `BARK_EXPORT_ORDER` 只列了 L1..L5, 更深的细枝在导出时
 * 合并进 L5 更合理 (深枝数量巨大, 逐个层级会让节点表爆炸且没人会单独编辑它们)。
 *
 * @param {object|null|undefined} node 节点表里的一项 (`{type, group, level, ...}`); 允许为空
 * @returns {string} 分组名, 一定是 `BARK_EXPORT_ORDER` 里的某个值 (不会返回新名字)
 */
export function barkGroupName(node) {
  if (!node) return 'Bark_Other'
  if (node.type === 'fruit') return 'Bark_Fruit'
  if (node.type === 'trunk') return 'Bark_Trunk'
  if (node.type === 'root') return 'Bark_Roots'
  if (node.type === 'branch') {
    // 优先用 group 里的显式层级 (形如 "branch-L2"), 它比 node.level 更贴合真实分枝代数
    const m = /^branch-L(\d+)$/.exec(String(node.group || ''))
    if (m) return 'Bark_Branch_L' + Math.min(5, Math.max(1, Number(m[1]) || 1))
    return 'Bark_Branch_L' + Math.min(5, Math.max(1, Number(node.level) || 1))
  }
  return 'Bark_Other'
}

/**
 * 按导出设置返回树皮部分:
 *   merge=true  -> 树干 + 树枝各层合并为一个 Bark mesh; 树根/果实仍独立
 *   merge=true + mergeRoots=true -> 树干 + 树枝 + 树根一起合并为 Bark (一体建模)
 *   merge=false -> 按树干/树枝各层/根/果实拆分
 * @param {import('three').BufferGeometry} geometry
 * @param {Array<object>} nodes
 * @param {boolean} merge
 * @param {boolean} mergeRoots
 */
export function barkExportParts(geometry, nodes, merge = false, mergeRoots = false) {
  // 只有几何有效才拆; 否则返回空数组, 由调用方决定"没有树皮"的处理
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return []
  return splitBarkGeometryByNodeGroups(geometry, nodes, { mergeTrunkBranches: !!merge, mergeRoots: !!mergeRoots })
}

/**
 * 按节点分组拆分合并树皮几何 (核心实现)。
 *
 * 流程:
 *   ① 建 `nodeId -> 节点` 索引, 并把每个节点映射到一个**导出分组名** (考虑合并开关);
 *   ② 逐三角形: 看它第一个角顶点的 `aNodeId`, 得到分组名 -> 把三个角顶点**重映射**到
 *      该分组自己的顶点序列里 (同一源顶点只在该组内复制一次);
 *   ③ 为每个分组新建 BufferGeometry, 属性数组按源类型 (`Float32Array` / `Uint16Array` …) 重建。
 *
 * `aNodeId` 是逐顶点的节点归属 (由生成器在合并时写入), 因此同一三角形的三个顶点
 * 理论上一定属于同一节点 —— 这里**只读第一个角** `a` 来定分组, 是建立在这个前提上的;
 * 若某天出现跨节点共享顶点的三角形, 它会被整体归到 `a` 所在的分组 (另外两角仍会复制正确属性)。
 *
 * @param {import('three').BufferGeometry} geometry 合并后的树皮几何
 * @param {Array<object>} nodes finalizeNodes 节点表
 * @param {{mergeTrunkBranches?:boolean, mergeRoots?:boolean}} [opts] mergeTrunkBranches = 把树干与树枝合成一个 Bark 节点; mergeRoots = 连树根也并进 Bark
 * @returns {Array<{name:string, geometry:import('three').BufferGeometry, triangles:number, vertices:number}>}
 */
export function splitBarkGeometryByNodeGroups(geometry, nodes, opts = {}) {
  const mergeTrunkBranches = !!opts.mergeTrunkBranches
  const mergeRoots = !!opts.mergeRoots
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return []
  const idAttr = geometry.attributes.aNodeId
  const nodeList = Array.isArray(nodes) ? nodes : []
  const nodeById = new Map(nodeList.map((n) => [n.id, n]))
  // 节点 -> 分组名; 合并规则在这里统一收口, 后面主循环只需要问 labelOf
  const labelOf = (nodeId) => {
    const label = barkGroupName(nodeById.get(nodeId))
    if (mergeTrunkBranches && (label === 'Bark_Trunk' || label.startsWith('Bark_Branch_'))) return 'Bark'
    if (mergeRoots && label === 'Bark_Roots') return 'Bark'
    return label
  }

  const indexAttr = geometry.index
  const srcIndex = indexAttr ? indexAttr.array : null
  // 非索引几何: 顶点按"每 3 个一组"当三角形处理 (与 three 的约定一致)
  const triCount = srcIndex ? Math.floor(srcIndex.length / 3) : Math.floor((geometry.attributes.position.count || 0) / 3)
  const attrNames = Object.keys(geometry.attributes)
  const idValues = idAttr ? idAttr.array : null
  // 没有 aNodeId 就无法判定归属 -> 放弃拆分 (调用方会退回整体导出)
  if (!triCount || !idValues) return []

  // 每个分组: 新顶点重映射 + 属性数据
  const groups = new Map()
  /**
   * 取(或新建)某分组的工作区。
   * `remap`: 源顶点索引 -> 该分组内新顶点索引, 用 `remap.size` 天然充当"下一个空位";
   * `attrs`: 分组名 -> 扁平属性值数组 (按 attrNames 顺序逐分量 push)。
   */
  const ensureGroup = (label) => {
    let g = groups.get(label)
    if (!g) {
      g = { label, indices: [], remap: new Map(), attrs: Object.fromEntries(attrNames.map((n) => [n, []])) }
      groups.set(label, g)
    }
    return g
  }

  /* ---------------- ① 逐三角形归属 + 顶点复制 ---------------- */
  for (let t = 0; t < triCount; t++) {
    // 索引几何取索引; 非索引几何直接用顺序顶点号
    const a = srcIndex ? srcIndex[t * 3] : t * 3
    const b = srcIndex ? srcIndex[t * 3 + 1] : t * 3 + 1
    const c = srcIndex ? srcIndex[t * 3 + 2] : t * 3 + 2
    // 整片三角形跟随第一个角顶点所属节点
    const label = labelOf(idValues[a])
    const g = ensureGroup(label)
    const corners = [a, b, c]
    for (const vi of corners) {
      let ni = g.remap.get(vi)
      // undefined 判断而不是 `if (!ni)`: 新索引 0 是合法值, 用假值判断会重复复制顶点
      if (ni === undefined) {
        ni = g.remap.size
        g.remap.set(vi, ni)
        // 逐分量复制该顶点的所有属性 (uv / color / normal / aNodeId …),
        // 用 attr.itemSize 而不是写死 3, 以兼容 2 分量(uv)与 4 分量(color)
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

  /* ---------------- ② 按导出顺序组装几何 ---------------- */
  const order = (label) => {
    const i = BARK_EXPORT_ORDER.indexOf(label)
    return i < 0 ? 999 : i
  }
  // 先按 BARK_EXPORT_ORDER 排序; 同序(或都不在表里)时用字典序, 保证输出顺序稳定可复现
  return [...groups.values()]
    .sort((x, y) => order(x.label) - order(y.label) || x.label.localeCompare(y.label))
    .map((g) => {
      const out = new THREE.BufferGeometry()
      for (const name of attrNames) {
        const srcAttr = geometry.attributes[name]
        const values = g.attrs[name]
        // 用源数组的构造函数重建, 保持 Float32Array / Uint8Array 等原始精度与类型
        const Ctor = srcAttr.array.constructor
        const attr = new THREE.BufferAttribute(Ctor.from(values), srcAttr.itemSize, srcAttr.normalized)
        out.setAttribute(name, attr)
      }
      if (indexAttr) {
        // 索引类型同样跟随源数组 (Uint16 源仍是 Uint16)。
        // 注意边界: 单个分组顶点数若超过源索引类型的上限 (Uint16 = 65535), 需要上游
        // 保证合并时已按更大位宽分配; 本函数不做提升, 以保持与源几何一致。
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
