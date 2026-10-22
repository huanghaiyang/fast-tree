/**
 * 树皮骨架图 (Skeleton Graph)
 * ------------------------------------------------------------
 * 作用: 把 treeBuilder 生长出的每根枝条的骨架曲线 (frames) 收进一张可查询的图, 供
 *       barkSkin.js (整张 2-manifold 蒙皮) 或 speedtreeBark.js (逐枝独立闭合管) 消费。
 *
 * 这一步**只生成骨架, 不生成任何蒙皮几何**:
 *   - nodes : 每个骨架节点 = 分支曲线上的一个采样点 (位置 / 方向 / 半径 / t)
 *   - edges : 相邻骨架节点之间的边 (沿分支曲线), 边继承半径函数与渲染参数
 *   - parent-child : 分支与分支之间的父子关系 (树干 -> 树枝 -> 末梢; 树干 -> 树根)
 *
 * 输入 / 输出:
 *   输入 = createBarkSkeleton() 的空中 + 反复 addBarkBranch(spec) 塞进来的分支;
 *   输出 = finalizeBarkSkeleton() 补齐"子枝贴到父枝哪一段"之后返回同一张图 (+ stats),
 *          再由 enforceChildBranchRadii() 做一次半径约束 (+ radiusClampStats)。
 *
 * 与其他模块的关系: treeBuilder.js 生长阶段逐根调用 addBarkBranch; 生长结束后按顺序调用
 *   finalizeBarkSkeleton -> enforceChildBranchRadii -> buildBarkSkin / buildSpeedtreeBark。
 *   本文件不引用 THREE 的渲染能力, 是纯数据组织层 (只有向量按 x/y/z 手动读写)。
 *
 * 关键概念 / 约定:
 *   - id 就是"数组下标": branches[].id / nodes[].id / edges[].id 都等于各自在数组中的位置,
 *     下游 (barkSkin 的 attachOf / ringM / rings 等) 直接拿 id 当索引, 不要改成 uuid;
 *   - nodes[].index 是"分支内部第几个点" (0 = 基部), nodes[].t 是沿分支的归一化位置 0..1;
 *   - 父分支一定先于子分支入图 (addBarkBranch 校验父 index 必须已存在), 所以 branches
 *     数组天然是"自根向梢"的拓扑序 —— enforceChildBranchRadii 的逐级约束依赖这一点;
 *   - 单位: 位置/半径是米, 角度是弧度; radius 是骨架半径 (蒙皮时还会再乘截面/领口调制)。
 *
 * 生长阶段 (treeBuilder) 只负责把骨架塞进来; 蒙皮 (barkSkin) 在骨架完成后一次性
 * 生成整张 2-manifold 表面。这样分叉处可以显式做环桥接, 不需要"每根枝条单独建
 * 管再布尔并集/按位置焊接"。
 *
 * 注意: 本文件只"补信息", 从不删除/合并分支 —— finalize 只补 attach, 半径约束只缩放半径,
 *       以此保证"骨架里有的分支, 蒙皮一定有对应三角面" (meshTopology 的 missingBranches=0)。
 */

/**
 * 新建一张空骨架图。
 *
 * 三个数组是"同步增长"的关系: 每加一根分支, 就同时往 nodes / edges / branches 里 push,
 * 且新元素的 id 一律取"加入前的数组长度", 因此 id === 下标这条约定从一开始就成立。
 *
 * @returns {{branches: Array, nodes: Array, edges: Array}} 空骨架 (三者都是普通数组)
 */
export function createBarkSkeleton() {
  return {
    branches: [],
    nodes: [],
    edges: [],
  }
}

/**
 * 往骨架图里加一条分支 (树干/树枝/树根)。
 *
 * 做三件事 (顺序不能换, 因为 id 依赖数组长度):
 *   ① 把 frames 逐点转成 nodes, 并在分支内部用 parentNode 串成一条链;
 *   ② 相邻节点两两成 edges, 同时记下两端半径 (radius0/radius1, 供蒙皮做插值);
 *   ③ 建 branch 记录 + 把它登记进父分支的 children。
 *
 * @param {object} skeleton createBarkSkeleton() 的返回值 (会被就地修改)
 * @param {object} spec
 *   frames  : [{ pos, dir, radius, t, roll?, profileRoll? }] 生长阶段算好的骨架曲线;
 *             至少 2 个点 (1 个点无法确定方向, 也就无法扫掠出管体);
 *             pos/dir 是 THREE.Vector3 世界坐标 (米), radius 是米, t 是 0..1 归一化位置
 *   parent  : 父分支 index (树干为 null); 必须是**已经加入**的分支, 否则抛错
 *   slot    : 模型节点 slot (barkGeometry.aNodeId 用的就是这个序号)
 *   type    : 'trunk' | 'branch' | 'root'
 *   level   : 层级 (树干/树根 = 0, 树枝 = 1..5)
 *   render  : 蒙皮渲染参数 (周向分段/截面/颜色/风场/半径调制...)
 *   origin  : 生长动画基点 (Vector3 或 {x,y,z}); 省略则取 frames[0].pos
 * @returns {number} 分支 index (同时是 branch.id)
 * @throws {Error} frames 少于 2 个点, 或声明的父分支 index 不存在
 */
export function addBarkBranch(skeleton, spec) {
  const { frames, parent = null, slot = 0, type = 'branch', level = 0, render = {}, origin = null } = spec
  if (!frames || frames.length < 2) {
    throw new Error('[FastTree] 骨架分支至少需要 2 个节点 (frames < 2)')
  }
  const index = skeleton.branches.length
  const nodeIds = []
  // startNode 是本分支第一个节点在全局 nodes 数组里的位置; 分支内部第 i 个点的 id 恒为
  // startNode + i, 因此下面能直接用序号互相连线, 不需要额外查表。
  const startNode = skeleton.nodes.length
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const node = {
      id: skeleton.nodes.length,
      branch: index,
      index: i,
      pos: f.pos,
      dir: f.dir,
      radius: f.radius,
      t: f.t,
      roll: f.roll || 0,
      profileRoll: f.profileRoll || 0,
      /** 上一个骨架节点: 分支内部串成边; 分支根节点的父节点在 finalize 时接到父分支 */
      parentNode: i > 0 ? startNode + i - 1 : null,
    }
    skeleton.nodes.push(node)
    nodeIds.push(node.id)
  }
  const branch = {
    index,
    id: index,
    type,
    level,
    slot,
    parent,
    frames,
    render,
    origin: origin || frames[0].pos,
    nodeIds,
    firstNode: nodeIds[0],
    lastNode: nodeIds[nodeIds.length - 1],
    edgeIds: [],
    children: [],
    /** finalize 后填充: { parentBranch, segment, t } 子分支贴到父分支哪一段 */
    attach: null,
  }
  // 骨架边: 分支内部相邻节点之间连成一条链 (节点/边/半径/父子关系都在骨架图里)
  for (let i = 1; i < nodeIds.length; i++) {
    const e = {
      id: skeleton.edges.length,
      branch: index,
      index: i - 1,
      from: nodeIds[i - 1],
      to: nodeIds[i],
      radius0: frames[i - 1].radius,
      radius1: frames[i].radius,
    }
    skeleton.edges.push(e)
    branch.edgeIds.push(e.id)
  }
  skeleton.branches.push(branch)
  // 父分支的 children 只存 index, 不存对象引用: 骨架图要能被 JSON 序列化,
  // 而且后续 finalize/半径约束都是按数组原地修改, 引用会过期。
  if (parent !== null && parent !== undefined) {
    const p = skeleton.branches[parent]
    if (!p) throw new Error(`[FastTree] 骨架父分支不存在: ${parent}`)
    p.children.push(index)
  }
  return index
}

/**
 * 点到线段最近点参数 (0..1)。
 *
 * 即求使 |p - (a + t·(b-a))| 最小的 t: 先算 p 在 ab 方向上的投影长度 (点积 / |ab|²),
 * 再 clamp 到 [0,1] 保证落在**线段**而不是无限长直线上。
 *
 * @param {{x:number,y:number,z:number}} p 待投影的点 (世界坐标, 米)
 * @param {{x:number,y:number,z:number}} a 线段起点
 * @param {{x:number,y:number,z:number}} b 线段终点
 * @returns {number} 段内参数 0..1 (0 = 落在 a, 1 = 落在 b)
 */
function projectOnSegment(p, a, b) {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const apx = p.x - a.x
  const apy = p.y - a.y
  const apz = p.z - a.z
  const len2 = abx * abx + aby * aby + abz * abz
  // 退化段 (两端重合, 例如两个采样点位置相同): 没有方向可言, 返回 0 而不是除零产生 NaN。
  if (len2 < 1e-12) return 0
  const t = (apx * abx + apy * aby + apz * abz) / len2
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * 骨架完成后的收尾: 给每条子分支找到父分支上的贴合点 (段序号 + 段内参数),
 * 并把子分支根节点的 parentNode 接到父骨架节点上。全程不删任何分支。
 *
 * 贴合点的含义: 子枝 base 实际"长在"父枝的第 segment 条骨架边的 t 处。
 * 之所以按**离散骨架段逐条扫描**而不是解解析曲线: 骨架只有折线采样点, 没有曲线方程;
 * 复杂度 O(子枝数 × 父枝节点数), 在树规模下可忽略 (百级分支 × 十几节点)。
 *
 * attach 的消费方:
 *   - barkSkin.buildSkinFrames: 在 t 附近 ±1.15×子枝半径 处给父枝插入加密环 (窗口高度≈子枝直径);
 *   - barkSkin 的窗口规划: band = 贴合点所在环带, azimuth = 子枝相对父枝的方位角;
 *   - enforceChildBranchRadii: 按贴合处的父枝半径算 80% 上限。
 *
 * 最后写入的 stats 是给 UI/自检用的骨架规模摘要 (分支数/节点数/按层级分布)。
 *
 * @param {object} skeleton 已 addBarkBranch 过的骨架图 (就地修改)
 * @returns {object} 同一张 skeleton (方便链式调用), 额外带 stats 字段
 */
export function finalizeBarkSkeleton(skeleton) {
  for (const branch of skeleton.branches) {
    if (branch.parent === null || branch.parent === undefined) continue
    const p = skeleton.branches[branch.parent]
    const start = branch.frames[0].pos
    // 遍历父枝的每一条骨架段, 取"子枝根点到该段距离"最小的一段。
    // 注意比较的是距离平方 (省一次 sqrt), bestD 初值 Infinity 表示"还没找到"。
    let bestSeg = 0
    let bestT = 0
    let bestD = Infinity
    for (let i = 0; i < p.frames.length - 1; i++) {
      const a = p.frames[i].pos
      const b = p.frames[i + 1].pos
      const t = projectOnSegment(start, a, b)
      const px = a.x + (b.x - a.x) * t
      const py = a.y + (b.y - a.y) * t
      const pz = a.z + (b.z - a.z) * t
      const dx = start.x - px
      const dy = start.y - py
      const dz = start.z - pz
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestD) {
        bestD = d
        bestSeg = i
        bestT = t
      }
    }
    branch.attach = {
      parentBranch: branch.parent,
      /** 子分支接进父分支的哪条骨架边 (父分支的第 bestSeg 条边) */
      parentEdge: p.edgeIds[bestSeg],
      segment: bestSeg,
      t: bestT,
      /** 子分支根节点接到父分支该段的起点节点 */
      parentNode: p.nodeIds[bestSeg],
    }
    skeleton.nodes[branch.firstNode].parentNode = p.nodeIds[bestSeg]
    skeleton.nodes[branch.firstNode].attachSegment = bestSeg
    skeleton.nodes[branch.firstNode].attachT = bestT
  }
  skeleton.stats = {
    branches: skeleton.branches.length,
    nodes: skeleton.nodes.length,
    edges: skeleton.edges.length,
    trunk: skeleton.branches.filter((b) => b.type === 'trunk').length,
    roots: skeleton.branches.filter((b) => b.type === 'root').length,
    branchesByLevel: skeleton.branches.reduce((acc, b) => {
      if (b.type === 'branch') acc[b.level] = (acc[b.level] || 0) + 1
      return acc
    }, {}),
  }
  return skeleton
}

/**
 * 子枝半径约束: 生成蒙皮前, 每个子分支基部半径不得超过父分支在贴合点半径的 80%。
 * 逐级处理 (父分支先于子分支), 因此 L1 被收细后, L2/L3 会按收细后的父半径继续约束。
 * 只缩放半径, 不改骨架位置/贴合点/生长方向。
 *
 * 为什么必须有这条约束 (不只是审美):
 *   分叉窗口的角宽 = 2·asin(子枝半径 / 父枝半径) (见 barkSkin.planBranchWindows)。
 *   当比值接近 1 时角宽趋近 π, 父枝一圈再也切不下窗口, 窗口会被迫收窄成 1 格,
 *   桥接三角形被拉成大斜鳍, 甚至跨过接缝自交。压到 0.8 后角宽上限约 106°,
 *   一圈还剩足够列数给"桥墩"和相邻子枝。视觉上父子粗细有明确层级也更像真树。
 *
 * 逐级为何成立: addBarkBranch 要求父分支先入图, 所以 branches 数组就是拓扑序,
 *   单趟 for 循环即等价于 BFS 逐层处理, 不需要显式排队。
 *
 * @param {object} skeleton finalizeBarkSkeleton 之后的骨架 (就地修改 frames/nodes/edges 的 radius)
 * @param {number} [maxRatio=0.8] 子枝基部半径 / 父枝贴合处半径 的上限, 会被 clamp 到 [0.05, 1]
 * @returns {{maxRatio:number, clamped:number, clampedByLevel:Object}} 约束统计
 *          clamped = 被收细的分支数; clampedByLevel 形如 { L1: 3, root: 2 }
 */
export function enforceChildBranchRadii(skeleton, maxRatio = 0.8) {
  // 下限 0.05 防止外部传入 0/负数把整棵树的枝条掐成一点; 上限 1 表示"最松也就父子等粗"。
  const ratio = Math.max(0.05, Math.min(1, Number(maxRatio) || 0.8))
  const stats = { maxRatio: ratio, clamped: 0, clampedByLevel: {} }
  for (const branch of skeleton.branches) {
    if (branch.parent === null || branch.parent === undefined) continue
    const parent = skeleton.branches[branch.parent]
    if (!parent || !branch.frames || !parent.frames || parent.frames.length < 2) continue
    const seg = Math.max(0, Math.min(parent.frames.length - 2, branch.attach ? branch.attach.segment : 0))
    const t = branch.attach ? Math.max(0, Math.min(1, branch.attach.t)) : 0
    const a = parent.frames[seg]
    const b = parent.frames[seg + 1]
    // 先按贴合参数 t 在父枝相邻两帧之间线性插值出"贴合处的基准半径"。
    // 0.0001 下限: 父枝若在某处半径趋 0, limit 会变 0 把所有子枝抹平。
    const frameR = Math.max(0.0001, a.radius + (b.radius - a.radius) * t)
    // 父枝蒙皮半径可能被 radiusModifier 收细 (例如 forkShrink)。
    // 用"基准半径与该调制半径的较小值"作为限制, 保证不会因父枝在分叉处
    // 被收细而让子枝反而超过父枝实际半径的 80%。
    let parentR = frameR
    const render = parent.render || {}
    const rm = render.radiusModifier
    if (typeof rm === 'function') {
      const tGlobal = (seg + t) / Math.max(1, parent.frames.length - 1)
      const mod = Number(rm(tGlobal, 0, frameR))
      if (Number.isFinite(mod) && mod > 0) parentR = Math.min(parentR, frameR * mod)
    }
    // 父枝若被压扁 (squash), 取短轴作为限制, 保证在任一方向都不超过 80%。
    const sx = render.squashX === undefined ? 1 : Math.abs(Number(render.squashX) || 1)
    const sz = render.squashZ === undefined ? 1 : Math.abs(Number(render.squashZ) || 1)
    parentR = Math.min(parentR, frameR * Math.min(sx, sz))
    const baseR = branch.frames[0].radius
    const limit = parentR * ratio
    // 1e-9 容差: 已经在限值内的分支不动 (避免浮点抖动导致"每次都收细一点点")。
    if (baseR <= limit + 1e-9) continue
    // 整根子枝用同一个 scale 等比缩放, 这样原有的粗细渐变与收尖形状完全保留;
    // 若逐帧独立 clamp 会把枝干改成等粗, 视觉上是"竹子"。
    const scale = limit / Math.max(1e-9, baseR)
    // 0.0005 是最小半径: 环半径归零会让截面退化成一点, 法线算出 NaN。
    for (const f of branch.frames) f.radius = Math.max(0.0005, f.radius * scale)
    for (const nodeId of branch.nodeIds) {
      const n = skeleton.nodes[nodeId]
      if (n) n.radius = Math.max(0.0005, n.radius * scale)
    }
    for (const edgeId of branch.edgeIds) {
      const e = skeleton.edges[edgeId]
      if (e) {
        e.radius0 = Math.max(0.0005, e.radius0 * scale)
        e.radius1 = Math.max(0.0005, e.radius1 * scale)
      }
    }
    stats.clamped++
    // 分桶统计: 树枝按层级 (L1/L2...), 树干与树根按类型。若某一层大面积被收细,
    // 通常说明该层的半径生长参数给得比父枝还粗, 从 stats 上能直接看出来。
    const key = branch.type === 'branch' ? `L${branch.level}` : branch.type
    stats.clampedByLevel[key] = (stats.clampedByLevel[key] || 0) + 1
  }
  // 挂回骨架图, 由 treeBuilder 汇总进 skin.stats.radiusClamp 暴露给 UI/自检。
  skeleton.radiusClampStats = stats
  return stats
}

