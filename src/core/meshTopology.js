/**
 * 网格拓扑校验
 * ------------------------------------------------------------
 * 作用: 在**最终几何**上实测拓扑指标, 给出"树皮是否真的是一张封闭可用的曲面"的判定。
 *       所有指标都是量出来的, 不是"构造上应该没问题"的推断。
 *
 * 骨架蒙皮的验收标准 (全部在最终 BufferGeometry 上实测, 不是"应该没问题"):
 *   - boundary = 0      : 没有边界边 (每条边恰好被 2 个三角面共享)
 *   - nonManifold = 0   : 没有非流形边 (每条边被 >2 个三角面共享)
 *   - components = 1    : 树体是单连通体 (树干/树枝/树根连成一张封闭蒙皮)
 *   - missingBranches=0 : 每条骨架分支都有对应蒙皮三角面
 *   补充 (同样必须为 0): nonManifoldVertices = 0, 即没有"两个锥体只在一点相接"的
 *   点非流形 —— 边流形 + 单连通仍不足以排除这种情形, 所以单独按顶点 link 环检查。
 *   口径例外: speedtree 管线 (speedtreeBark.js) 是每根枝条一根独立闭合管,
 *   它的期望分量数是 branches.length 而不是 1, 由调用方按 mode 取不同的期望值。
 *
 * 输入 / 输出:
 *   输入 = 生成好的 BufferGeometry (必须有 index + position, 可选 aNodeId);
 *   输出 = 纯数字统计对象 { boundary, nonManifold, nonManifoldVertices, components,
 *          triangles, vertices, edges, degenerate } (validateSkin 会再加上体积与覆盖)。
 *
 * 与其他模块的关系: barkSkin.js 通过 validateSkin() 调用; speedtreeBark.js 直接调用
 *   analyzeTopology() + branchSkinCoverage() 并自己拼 ok 判据; 导出/调试面板读 stats.validation。
 *
 * 注意: 这里按**索引**统计拓扑 (不按位置焊接)。蒙皮生成器在分叉处复用同一批
 * 环顶点, 所以索引统计与几何拓扑一致; 如果以后有人又改成"每根树枝单独建管再
 * 按位置合并", 校验会立刻抓到边界边/重复顶点。
 * 只有在"拆分导出 / 显式 UV 缝"这类**已知会复制顶点**的场合, 才通过 opts 的
 * weldPairs / weldPositions 把复制顶点并回原顶点 —— 即"几何上封闭, 渲染上有缝"。
 */

/**
 * 数值边 key: 用顶点数做基数, 避免字符串 key 的 GC 压力。
 *
 * 无向边的规范编码: 取 min·base + max (base = 顶点数 > 任何下标), 于是 (a,b) 与 (b,a)
 * 得到同一个整数, 且不会撞车 (类似把二维坐标压成一维)。用 number 而不是 "a-b" 字符串,
 * 在十万级边时能省掉大量临时字符串。
 *
 * @param {number} a 顶点下标
 * @param {number} b 顶点下标
 * @param {number} base 基数, 必须是顶点总数
 * @returns {number} 无向边的唯一整数 key
 */
function edgeKey(a, b, base) {
  return a < b ? a * base + b : b * base + a
}

/**
 * 在最终几何上统计边界边 / 非流形边 / 连通分量。
 *
 * 流程: ① 建立焊接映射 -> ② 标出参与统计的三角面 -> ③ 边计数判流形 ->
 *       ④ 并查集数连通分量 -> ⑤ 逐顶点检查 link 是否成单一有向环。
 *
 * @param {import('three').BufferGeometry} geometry
 * @param {{excludeNodeIds?: Set<number>|number[], nodeIdAttribute?: string,
 *          weldPositions?: boolean, weldPairs?: Array<[number, number]>}} [opts]
 *   excludeNodeIds: 这些 aNodeId 的三角面不参与统计 (果实是独立闭合壳, 不参与树体单连通判定)
 *   nodeIdAttribute: aNodeId 的属性名, 默认 'aNodeId'
 *   weldPositions: true = 按精确位置焊接顶点。用于**导出后的拆分几何**: 拆节点或切 UV
 *     会复制顶点, 但物理上仍是闭合曲面, 这时按位置并回才反映真实拓扑。
 *     代价是要对每个顶点做一次 toFixed 字符串, 比 weldPairs 慢, 只在大几何上按需开启。
 *   weldPairs: 显式 [复制顶点, 原顶点] 配对, 由蒙皮生成器写进 geometry.userData.seamPairs。
 *     比 weldPositions 精确且便宜 (只处理已知的 UV 缝), 是运行时校验的首选。
 * @returns {{boundary:number, nonManifold:number, nonManifoldVertices:number,
 *            components:number, triangles:number, vertices:number, edges:number, degenerate:number}}
 *   boundary/nonManifold/nonManifoldVertices 见文件头; triangles = 参与统计的面数;
 *   edges = 去重后的边数; degenerate = 有重复顶点的退化面数。
 */
export function analyzeTopology(geometry, opts = {}) {
  const posAttr = geometry && geometry.attributes && geometry.attributes.position
  const indexAttr = geometry && geometry.index
  // 没有索引就没有"边被几个面共享"的概念 (非索引几何的每个三角互不相连),
  // 直接返回全 0 的空统计而不是抛错 —— 极端参数下生成器确实可能产出空几何。
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
    // toFixed(6) 即微米级 (1e-6 米): 足以区分真实不同的顶点, 又能容下浮点误差;
    // 字符串 key 较慢, 所以只在导出校验时按需开启。
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
      // 目标顶点本身可能也是"复制顶点"(被更早的配对指向原顶点), 所以先顺着链找到链尾,
      // 避免出现 a->b 而 b->c 的中间态 (会让同一条真实边被数成两条)。guard 防环。
      let dst = pair[1]
      let guard = 0
      while (weld.has(dst) && guard++ < 16) dst = weld.get(dst)
      weld.set(pair[0], dst)
    }
  }
  // 单次 resolve 不做全链压缩 (map 很小), 但同样带 guard: 配对数据异常时宁可少焊也不错焊。
  const resolve = (i) => {
    let r = i
    let guard = 0
    while (weld.has(r) && guard++ < 16) r = weld.get(r)
    return r
  }

  // 先标出"参与统计"的三角面: 果实等独立闭合壳按 aNodeId 排除, 否则它们会把
  // 分量数抬高, 让树体的单连通判定永远失败。
  // 用 Uint8Array 而不是 Set: 面数可达几十万, 且后面要遍历三遍 (边/分量/link)。
  // 归属口径与 branchSkinCoverage 一致 —— 只看三角面的**首顶点** aNodeId。
  const useTri = new Uint8Array(triCount)
  let used = 0
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3]
    if (excluded && idAttr && excluded.has(idAttr.array[a])) continue
    useTri[t] = 1
    used++
  }

  // 边统计: counts 的值就是"共享这条边的三角面数", 语义为
  //   1 = 边界边 (洞); 2 = 正常; ≥3 = 非流形边 (多个面挤在一条棱上)。
  const counts = new Map()
  let degenerate = 0
  for (let t = 0; t < triCount; t++) {
    if (!useTri[t]) continue
    const a = resolve(idx[t * 3])
    const b = resolve(idx[t * 3 + 1])
    const c = resolve(idx[t * 3 + 2])
    // 焊接后出现重复顶点的面 = 退化面 (零面积), 它不贡献几何但会污染边计数, 单独计数。
    if (a === b || b === c || c === a) degenerate++
    // 三次显式累加而不是 `for (const [u,v] of [[a,b],...])`:
    // 后者每个三角面都会新建 3 个小数组 (14 万面 = 42 万个临时数组), GC 压力很大。
    let k = edgeKey(a, b, vertexCount)
    counts.set(k, (counts.get(k) || 0) + 1)
    k = edgeKey(b, c, vertexCount)
    counts.set(k, (counts.get(k) || 0) + 1)
    k = edgeKey(c, a, vertexCount)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  let boundary = 0
  let nonManifold = 0
  for (const c of counts.values()) {
    if (c === 1) boundary++
    else if (c > 2) nonManifold++
  }

  // 连通分量 (只统计参与三角面的顶点, 迭代式路径压缩避免深链)
  // parent 用 Int32Array 而不是 Map: 下标即顶点号, 数组比哈希快一个量级。
  const parent = new Int32Array(vertexCount)
  // 迭代版 find (不用递归): 枝条链可能很长, 递归在深链上有爆栈风险。
  // 第二段 while 是路径压缩, 把访问过的节点直接挂到根上, 后续查询接近 O(1)。
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
    // link 的构造: 对三角面 (a,b,c), 在 a 的 link 里加一条有向边 b->c (另外两个顶点同理)。
    // 若曲面在 a 处是流形, 这些有向边恰好连成**一个**封闭有向环; 否则会出现分叉/多个环。
    // 存储用"邻接链表": first[v] 是 v 的第一条 link 边下标, linkNext 串起同顶点的其余边,
    // 这样只需一次线性分配 (Uint/Int32Array), 不产生每顶点的小数组。
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
    // head 唯一性检查原本每顶点 new 一个 Set (9 万顶点 = 9 万个临时 Set)。
    // 改成"时间戳数组": seenHead[顶点] === stamp 即表示本轮已出现, 全部分配一次。
    const seenHead = new Int32Array(vertexCount)
    let stamp = 0
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
      stamp++
      for (const h of outMap.values()) {
        if (seenHead[h] === stamp) { ok = false; break }
        seenHead[h] = stamp
      }
      if (!ok) { nonManifoldVertices++; continue }
      // link 必须连成 1 个环 (多个环 = 多个扇形在一点相接)。
      // 从任意一条边出发沿 head->tail 走, 必须正好走 links 步回到起点:
      //   - 走回 undefined 说明出度/入度不匹配 (断在中间);
      //   - steps !== links 说明环没覆盖全部 link 边 (存在第二个环);
      //   - 步数上限 steps <= links 兼作防死循环。
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
 *
 * 为什么需要这条检查: 拓扑上完全封闭的网格, 仍可能"少长了一根树枝" ——
 * 某根骨架分支没有生成任何三角面, 于是它在节点树选中/隔离/拆分导出里直接消失。
 * 这里用与归属逻辑完全相同的口径 (三角面首顶点) 反查, 保证"能选中"和"有几何"等价。
 *
 * 复杂度 O(面数), 与 analyzeTopology 同一量级, 可以每次校验都跑。
 *
 * @param {import('three').BufferGeometry} geometry 蒙皮几何 (aNodeId 仍是 slot 序号)
 * @param {Array<{index:number, slot:number, type:string, level?:number}>} branches
 * @returns {{skeletonBranches:number, skinnedBranches:number,
 *            missing:Array<{index:number, slot:number, type:string, level:number}>}}
 *   missing 里每项就是"骨架有、蒙皮没有"的分支 (含 index/slot/type/level 便于定位)。
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
 *
 * 体积的物理含义: 按散度定理 (V = 1/6 · Σ a·(b×c)), 对每个三角面累加有向体积。
 * 用法有两种:
 *   - 法线朝外的封闭网格, 结果应 ≈ 树的真实体积 (米³), 且必须 > 0;
 *   - 若某处绕序反了, 那一块体积贡献为负, 会把总数拉小甚至拉成负数 ——
 *     所以 volume <≈ 0 是"法线大面积反了"的可靠信号 (比逐面查法线便宜得多)。
 *
 * @param {import('three').BufferGeometry} geometry
 * @param {Array} branches 骨架分支表 (branchSkinCoverage 用)
 * @param {{excludeNodeIds?: Set<number>|number[]}} [opts] 透传给 analyzeTopology
 * @returns {object} topo 的全部字段 + { skeletonBranches, skinnedBranches, missingBranches, volume, ok }
 */
export function validateSkin(geometry, branches, opts = {}) {
  // 蒙皮生成器把 UV 缝配对写在 userData.seamPairs 上, 这里自动取用:
  // 于是调用方不需要记得传 weldPairs, 也不会漏焊缝而误报 boundary > 0。
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
      // 以原点为锥顶的四面体有向体积: V = a·(b×c) / 6 (这里把叉乘与点积展开成标量式,
      // 省掉 THREE.Vector3 的临时对象 —— 十万级三角面下这个差别很明显)。
      // 求和后内部重叠部分互相抵消, 只剩封闭曲面包住的净体积。
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
    // 五项全过才算通过 (口径见文件头): 封闭 + 边流形 + 点流形 + 单连通 + 无漏枝。
    // 注意 components === 1 是 **skin 管线**的期望; speedtree 管线自己另判 (期望 = 分支数)。
    ok: topo.boundary === 0 &&
      topo.nonManifold === 0 &&
      topo.nonManifoldVertices === 0 &&
      topo.components === 1 &&
      coverage.missing.length === 0,
  }
}
