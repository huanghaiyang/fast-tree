/**
 * 树皮骨架图 (Skeleton Graph)
 * ------------------------------------------------------------
 * 这一步**只生成骨架, 不生成任何蒙皮几何**:
 *   - nodes : 每个骨架节点 = 分支曲线上的一个采样点 (位置 / 方向 / 半径 / t)
 *   - edges : 相邻骨架节点之间的边 (沿分支曲线), 边继承半径函数与渲染参数
 *   - parent-child : 分支与分支之间的父子关系 (树干 -> 树枝 -> 末梢; 树干 -> 树根)
 *
 * 生长阶段 (treeBuilder) 只负责把骨架塞进来; 蒙皮 (barkSkin) 在骨架完成后一次性
 * 生成整张 2-manifold 表面。这样分叉处可以显式做环桥接, 不需要"每根枝条单独建
 * 管再布尔并集/按位置焊接"。
 */

/** 新建一张空骨架图 */
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
 * @param {object} skeleton createBarkSkeleton() 的返回值
 * @param {object} spec
 *   frames  : [{ pos, dir, radius, t, roll?, profileRoll? }] 生长阶段算好的骨架曲线
 *   parent  : 父分支 index (树干为 null)
 *   slot    : 模型节点 slot (barkGeometry.aNodeId 用的就是这个序号)
 *   type    : 'trunk' | 'branch' | 'root'
 *   level   : 层级 (树干/树根 = 0, 树枝 = 1..5)
 *   render  : 蒙皮渲染参数 (周向分段/截面/颜色/风场/半径调制...)
 *   origin  : 生长动画基点 (Vector3 或 {x,y,z})
 * @returns {number} 分支 index
 */
export function addBarkBranch(skeleton, spec) {
  const { frames, parent = null, slot = 0, type = 'branch', level = 0, render = {}, origin = null } = spec
  if (!frames || frames.length < 2) {
    throw new Error('[FastTree] 骨架分支至少需要 2 个节点 (frames < 2)')
  }
  const index = skeleton.branches.length
  const nodeIds = []
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
  if (parent !== null && parent !== undefined) {
    const p = skeleton.branches[parent]
    if (!p) throw new Error(`[FastTree] 骨架父分支不存在: ${parent}`)
    p.children.push(index)
  }
  return index
}

/** 点到线段最近点参数 (0..1) */
function projectOnSegment(p, a, b) {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const apx = p.x - a.x
  const apy = p.y - a.y
  const apz = p.z - a.z
  const len2 = abx * abx + aby * aby + abz * abz
  if (len2 < 1e-12) return 0
  const t = (apx * abx + apy * aby + apz * abz) / len2
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * 骨架完成后的收尾: 给每条子分支找到父分支上的贴合点 (段序号 + 段内参数),
 * 并把子分支根节点的 parentNode 接到父骨架节点上。全程不删任何分支。
 */
export function finalizeBarkSkeleton(skeleton) {
  for (const branch of skeleton.branches) {
    if (branch.parent === null || branch.parent === undefined) continue
    const p = skeleton.branches[branch.parent]
    const start = branch.frames[0].pos
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
 */
export function enforceChildBranchRadii(skeleton, maxRatio = 0.8) {
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
    if (baseR <= limit + 1e-9) continue
    const scale = limit / Math.max(1e-9, baseR)
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
    const key = branch.type === 'branch' ? `L${branch.level}` : branch.type
    stats.clampedByLevel[key] = (stats.clampedByLevel[key] || 0) + 1
  }
  skeleton.radiusClampStats = stats
  return stats
}

