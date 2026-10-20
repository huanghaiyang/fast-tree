/**
 * 网格拓扑校验
 * ------------------------------------------------------------
 * 骨架蒙皮的验收标准 (全部在最终 BufferGeometry 上实测, 不是"应该没问题"):
 *   - boundary = 0      : 没有边界边 (每条边恰好被 2 个三角面共享)
 *   - nonManifold = 0   : 没有非流形边 (每条边被 >2 个三角面共享)
 *   - components = 1    : 树体是单连通体 (树干/树枝/树根连成一张封闭蒙皮)
 *   - missingBranches=0 : 每条骨架分支都有对应蒙皮三角面
 *
 * 注意: 这里按**索引**统计拓扑 (不按位置焊接)。蒙皮生成器在分叉处复用同一批
 * 环顶点, 所以索引统计与几何拓扑一致; 如果以后有人又改成"每根树枝单独建管再
 * 按位置合并", 校验会立刻抓到边界边/重复顶点。
 */

/** 数值边 key: 用顶点数做基数, 避免字符串 key 的 GC 压力 */
function edgeKey(a, b, base) {
  return a < b ? a * base + b : b * base + a
}

/**
 * 在最终几何上统计边界边 / 非流形边 / 连通分量。
 * @param {import('three').BufferGeometry} geometry
 * @param {{excludeNodeIds?: Set<number>|number[], nodeIdAttribute?: string}} [opts]
 *   excludeNodeIds: 这些 aNodeId 的三角面不参与统计 (果实是独立闭合壳, 不参与树体单连通判定)
 */
export function analyzeTopology(geometry, opts = {}) {
  const posAttr = geometry && geometry.attributes && geometry.attributes.position
  const indexAttr = geometry && geometry.index
  if (!posAttr || !indexAttr) {
    return { boundary: 0, nonManifold: 0, nonManifoldVertices: 0, components: 0, triangles: 0, vertices: 0, edges: 0, degenerate: 0 }
  }
  const idx = indexAttr.array
  const vertexCount = posAttr.count
  const triCount = Math.floor(idx.length / 3)
  const idAttr = geometry.attributes[opts.nodeIdAttribute || 'aNodeId']
  const excluded = opts.excludeNodeIds
    ? (opts.excludeNodeIds instanceof Set ? opts.excludeNodeIds : new Set(opts.excludeNodeIds))
    : null

  // UV 接缝焊接: 蒙皮为了贴图不拉伸, 会在每圈复制 1 个接缝顶点 (位置/法线完全相同)。
  // 拓扑判定前先把这些顶点并回原顶点, 这样"渲染上有 UV 缝、几何上仍是封闭流形"。
  const weld = new Map()
  if (opts.weldPositions && posAttr) {
    // 按精确位置焊接 (用于导出的拆分几何: 拆节点/UV 缝会复制顶点, 但物理上仍闭合)
    const p = posAttr.array
    const seenPos = new Map()
    for (let i = 0; i < vertexCount; i++) {
      const key = p[i * 3].toFixed(6) + ',' + p[i * 3 + 1].toFixed(6) + ',' + p[i * 3 + 2].toFixed(6)
      const prev = seenPos.get(key)
      if (prev === undefined) seenPos.set(key, i)
      else weld.set(i, prev)
    }
  }
  if (opts.weldPairs) {
    for (const pair of opts.weldPairs) {
      if (!pair || pair.length < 2) continue
      let dst = pair[1]
      let guard = 0
      while (weld.has(dst) && guard++ < 16) dst = weld.get(dst)
      weld.set(pair[0], dst)
    }
  }
  const resolve = (i) => {
    let r = i
    let guard = 0
    while (weld.has(r) && guard++ < 16) r = weld.get(r)
    return r
  }

  const useTri = new Uint8Array(triCount)
  let used = 0
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3]
    if (excluded && idAttr && excluded.has(idAttr.array[a])) continue
    useTri[t] = 1
    used++
  }

  // 边统计
  const counts = new Map()
  let degenerate = 0
  for (let t = 0; t < triCount; t++) {
    if (!useTri[t]) continue
    const a = resolve(idx[t * 3])
    const b = resolve(idx[t * 3 + 1])
    const c = resolve(idx[t * 3 + 2])
    if (a === b || b === c || c === a) degenerate++
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(u, v, vertexCount)
      counts.set(k, (counts.get(k) || 0) + 1)
    }
  }
  let boundary = 0
  let nonManifold = 0
  for (const c of counts.values()) {
    if (c === 1) boundary++
    else if (c > 2) nonManifold++
  }

  // 连通分量 (只统计参与三角面的顶点, 迭代式路径压缩避免深链)
  const parent = new Int32Array(vertexCount)
  const find2 = (x) => {
    let r = x
    while (parent[r] !== r) r = parent[r]
    while (x !== r) {
      const n = parent[x]
      parent[x] = r
      x = n
    }
    return r
  }
  for (let i = 0; i < vertexCount; i++) parent[i] = i
  let components = 0
  for (let t = 0; t < triCount; t++) {
    if (!useTri[t]) continue
    const a = resolve(idx[t * 3])
    const b = resolve(idx[t * 3 + 1])
    const c = resolve(idx[t * 3 + 2])
    const ra = find2(a)
    for (const v of [b, c]) {
      const rv = find2(v)
      if (rv !== ra) parent[rv] = ra
    }
  }
  const seen = new Set()
  for (let t = 0; t < triCount; t++) {
    if (!useTri[t]) continue
    const r = find2(resolve(idx[t * 3]))
    if (!seen.has(r)) {
      seen.add(r)
      components++
    }
  }

  // 顶点流形性: 每个顶点的 link 必须是一个单一有向环。
  // 边流形 (每条边 2 个面) + 单连通仍可能是"两个锥体在一点相接"的非流形顶点,
  // 这里用 link 的入/出度与环数把它抓出来。
  let nonManifoldVertices = 0
  {
    const linkCount = used * 3
    const first = new Int32Array(vertexCount).fill(-1)
    const linkNext = new Int32Array(linkCount)
    const tails = new Int32Array(linkCount)
    const heads = new Int32Array(linkCount)
    let e = 0
    const addLink = (v, tail, head) => {
      tails[e] = tail
      heads[e] = head
      linkNext[e] = first[v]
      first[v] = e
      e++
    }
    for (let t = 0; t < triCount; t++) {
      if (!useTri[t]) continue
      const a = resolve(idx[t * 3])
      const b = resolve(idx[t * 3 + 1])
      const c = resolve(idx[t * 3 + 2])
      addLink(a, b, c)
      addLink(b, c, a)
      addLink(c, a, b)
    }
    const outMap = new Map()
    for (let v = 0; v < vertexCount; v++) {
      let cur = first[v]
      if (cur < 0) continue
      outMap.clear()
      let links = 0
      let ok = true
      while (cur >= 0) {
        const tail = tails[cur]
        const head = heads[cur]
        if (outMap.has(tail)) { ok = false; break } // link 入度/出度异常
        outMap.set(tail, head)
        links++
        cur = linkNext[cur]
      }
      if (!ok) { nonManifoldVertices++; continue }
      // link 边数必须与顶点度数一致 (每个入边恰好出现一次由 Map 的 key 唯一保证,
      // 这里再检查 head 唯一 => 每个 link 顶点出度=入度=1)
      if (outMap.size !== links) { nonManifoldVertices++; continue }
      const headSeen = new Set()
      for (const h of outMap.values()) {
        if (headSeen.has(h)) { ok = false; break }
        headSeen.add(h)
      }
      if (!ok) { nonManifoldVertices++; continue }
      // link 必须连成 1 个环 (多个环 = 多个扇形在一点相接)
      const start = outMap.keys().next().value
      let walk = start
      let steps = 0
      do {
        walk = outMap.get(walk)
        steps++
        if (walk === undefined) { ok = false; break }
      } while (walk !== start && steps <= links)
      if (!ok || steps !== links) nonManifoldVertices++
    }
  }

  return {
    boundary,
    nonManifold,
    nonManifoldVertices,
    components,
    triangles: used,
    vertices: vertexCount,
    edges: counts.size,
    degenerate,
  }
}

/**
 * 骨架分支蒙皮覆盖: 每条骨架分支的 slot 至少要出现在一个三角面的首顶点上
 * (finalizeNodes/exportSplit 都按三角面首顶点的 aNodeId 归属)。
 * @param {import('three').BufferGeometry} geometry 蒙皮几何 (aNodeId 仍是 slot 序号)
 * @param {Array<{index:number, slot:number, type:string}>} branches
 */
export function branchSkinCoverage(geometry, branches) {
  const idxAttr = geometry && geometry.index
  const idAttr = geometry && geometry.attributes && geometry.attributes.aNodeId
  const present = new Set()
  if (idxAttr && idAttr) {
    const idx = idxAttr.array
    const ids = idAttr.array
    for (let t = 0; t < idx.length; t += 3) present.add(ids[idx[t]])
  }
  const missing = []
  for (const b of branches || []) {
    if (!present.has(b.slot)) missing.push({ index: b.index, slot: b.slot, type: b.type, level: b.level })
  }
  return { skeletonBranches: (branches || []).length, skinnedBranches: (branches || []).length - missing.length, missing }
}

/**
 * 最终验收: 拓扑 + 分支覆盖 + 有向体积 (法线朝外时为正)。
 * @param {import('three').BufferGeometry} geometry
 * @param {Array} branches 骨架分支表 (branchSkinCoverage 用)
 * @param {{excludeNodeIds?: Set<number>|number[]}} [opts]
 */
export function validateSkin(geometry, branches, opts = {}) {
  const weldPairs = (geometry && geometry.userData && geometry.userData.seamPairs) || null
  const topo = analyzeTopology(geometry, weldPairs ? { ...opts, weldPairs } : opts)
  const coverage = branchSkinCoverage(geometry, branches)
  const pos = geometry && geometry.attributes && geometry.attributes.position
  const idxAttr = geometry && geometry.index
  let volume = 0
  if (pos && idxAttr) {
    const p = pos.array
    const idx = idxAttr.array
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3
      const b = idx[t + 1] * 3
      const c = idx[t + 2] * 3
      volume += (
        p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
      ) / 6
    }
  }
  return {
    ...topo,
    skeletonBranches: coverage.skeletonBranches,
    skinnedBranches: coverage.skinnedBranches,
    missingBranches: coverage.missing,
    volume,
    ok: topo.boundary === 0 &&
      topo.nonManifold === 0 &&
      topo.nonManifoldVertices === 0 &&
      topo.components === 1 &&
      coverage.missing.length === 0,
  }
}
