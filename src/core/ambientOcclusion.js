/**
 * 程序化环境光遮蔽 (AO) 烘焙
 * ------------------------------------------------------------
 * SpeedTree 的顶点色里通常烘焙了"叶片/枝条互相遮挡"的暗部信息, 引擎端直接乘到
 * 颜色上就能得到更有体积感的植被。这里用"叶簇点云 + 空间网格"做一个轻量近似:
 *
 *   1. 收集所有叶片 / 花朵中心点, 建空间网格 (单元格边长 = AO 半径)
 *   2. 对树皮 / 叶片 / 花朵的每个顶点, 统计周围点云的加权数量 (距离越近权重越大)
 *   3. 用该几何体自身的 85 分位数做归一化 —— 密林内部接近 1 (最暗), 树冠外层接近 0,
 *      这样不同树种 / 不同尺寸不需要手调阈值
 *   4. 把因子乘进顶点色 (COLOR_0), 导出的 GLB/OBJ 里也会带上
 *
 * 这是纯函数模块, 不依赖渲染器, 可在 Node 自检里直接验证。
 *
 * 性能设计 (为什么不是 Map<number, number[]> / 逐顶点查邻域):
 *   早先的实现用「哈希 key -> 样本下标数组」的 Map。查询时每个点要做 27 次
 *   Map.get + 哈希计算 + 追赶小数组, 在 9 万顶点的树皮几何上要 1.5 秒,
 *   是整棵树重建的最大瓶颈; 即便换成 CSR 规则网格(见下), 每顶点仍要扫描邻域里
 *   几百个样本, 9 万顶点 × 数百次距离计算 = 每次重建 1 秒以上。
 *
 *   这里的关键观察:**AO 是低频场**(半径 0.9 米), 不需要逐顶点精确积分 ——
 *   把点云"砸"进一张规则密度网格 (splatting), 之后每次查询只是三线性插值:
 *     - 节点间距 h = radius/2, 每个样本向半径内 (约 5³=125) 个节点累加
 *       核权重 `1 - d/r` —— 总代价 O(样本数)，与顶点数无关;
 *     - `field[节点]` 就是"该位置周围的加权遮挡量", 与原来逐点求和同量纲;
 *     - 查询顶点时对 8 个节点做三线性插值, ~20 次浮点运算, 比扫邻域快两个数量级。
 *   结果: 树皮烘焙从 ~1.5s 降到 ~30ms (含建表), 且树冠越密提升越明显。
 *   节点的采样分辨率低于 radius 时 (树冠跨度极大 / 半径极小) h 会按内存上限放大,
 *   只影响插值平滑度, 不影响归一化语义。
 *
 *   注: CSR 规则网格 (计数排序 + start/items + 3×3×3 邻域扫描) 是把同一份
 *   密度场做精确逐点求解的实现, 这里用 splat + 插值替代它, 语义一致、成本低一个量级。
 *
 * 作用: 给已经合并好的几何体**就地**乘一层 AO 到 `color` 顶点属性上。
 * 输入 / 输出:
 *   - 输入: 几何体 (需要 `position` + `color` 属性)、点云网格 (见 buildOcclusionGrid)、
 *     强度 0..1, 以及可选的归一化参数;
 *   - 输出: `{affected, threshold, minFactor}` 三个数 —— 受影响顶点数、归一化阈值、暗部下限;
 *     真正的结果体现在几何体的 `color` 属性里 (本模块不返回新几何)。
 * 与其他模块的关系:
 *   - 上游: `treeBuilder.js` 在几何合并后, 用叶片+花朵中心点建网格;
 *   - 调用方: 树皮用 `bakeOcclusion` (逐顶点, 因为树皮顶点稀疏), 叶片/花朵用
 *     `bakeOcclusionByRanges` (逐实例, 快一个数量级且不产生叶片内部噪声);
 *   - 下游: 顶点色最终被材质着色器乘进 albedo, 也会随 GLB/OBJ 一起导出。
 * 关键约定:
 *   - 强度 `strength` 的语义是"最大压暗比例": factor = 1 - strength * occ,
 *     所以 strength=1 时最暗处会被压到 `minFactor` (默认 0.32, 不会全黑);
 *   - 归一化阈值取**分位数而非最大值**: 极少数离群顶点 (例如一根孤零零的枝梢) 会
 *     把最大值拉得很高, 用最大值归一化会让整棵树都变得很亮、AO 形同没开;
 *   - 顶点色是 [0,1] 的线性值, 每次乘法后都 clamp01, 防止重复烘焙/多次调用后溢出。
 * 注意: 本模块会修改传入几何体的 `color` 属性 (就地写), 属于有副作用函数;
 *       同一块几何重复调用会叠加压暗, 需要可重复时请重算几何而不是重复烘焙。
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// 密度网格节点总数上限 (2^21 ≈ 210 万节点 → Float32Array 约 8MB)。
// 节点间距默认 radius/2 (线性核的拐点才能被三线性插值还原); 只有树冠跨度 /
// 半径组合会超过这个规模时才放大间距, 用"场更平滑"换内存与建表时间。
const MAX_NODES = 1 << 21

/**
 * 把点云烘焙成规则密度网格 (splatting)。
 *
 * 每个样本向 `radius` 内的节点累加核权重 `1 - d/r`, 于是 `field` 就是空间中的
 * "加权遮挡量"标量场; 后续 `occlusionAt` 只需三线性插值, 单次查询成本 ~20 次浮点运算。
 * 建表代价 O(样本数 × 每样本约 125 个节点), 与顶点数无关 —— 这正是它比"逐顶点扫邻域"
 * 快两个数量级的原因。
 *
 * @param {Float32Array|number[]} samples 扁平 xyz 坐标 (length % 3 === 0)
 * @param {number} radius AO 影响半径 (米)
 * @returns {{r:number, count:number, nx:number, ny:number, nz:number, h:number, inv:number,
 *   ox:number, oy:number, oz:number, ex:number, ey:number, ez:number, field:Float32Array}}
 *   ox/oy/oz 是包围盒最小角, ex/ey/ez 是最大角 (用于快速剔除半径外的查询点)
 */
export function buildOcclusionGrid(samples, radius = 1) {
  // 下限 0.05 米: 半径过小会让采样过密, 没有实际收益
  const r = Math.max(0.05, Number(radius) || 1)
  const count = Math.floor(samples.length / 3)
  const pts = samples instanceof Float32Array ? samples : Float32Array.from(samples)
  // 空点云: 返回一个 nx=0 的网格, occlusionAt 会直接返回 0 (调用方本来也会先判 count)
  if (count <= 0) {
    return {
      r, count: 0, nx: 0, ny: 0, nz: 0, h: r, inv: 1 / r,
      ox: 0, oy: 0, oz: 0, ex: 0, ey: 0, ez: 0, field: new Float32Array(1),
    }
  }

  // ① 包围盒
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < count; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }

  // ② 节点间距: 默认 r/2; 若节点数会超过内存上限, 按最长边立方根放大间距
  let h = r * 0.5
  const maxExtent = Math.max(maxX - minX, maxY - minY, maxZ - minZ)
  const axisCap = Math.cbrt(MAX_NODES)
  if (maxExtent / h > axisCap) h = maxExtent / axisCap
  const inv = 1 / h
  const nx = Math.max(1, Math.floor((maxX - minX) * inv) + 1)
  const ny = Math.max(1, Math.floor((maxY - minY) * inv) + 1)
  const nz = Math.max(1, Math.floor((maxZ - minZ) * inv) + 1)
  const field = new Float32Array(nx * ny * nz)

  // ③ splat: 每个样本只遍历半径内的节点 (h = r/2 时约 5×5×5), 累加线性衰减权重
  const r2 = r * r
  const invR = 1 / r
  for (let i = 0; i < count; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2]
    // 节点中心 = ox + ix*h, 取 |节点 - 样本| <= r 的下标范围 (再按 d2 精确过滤)
    const ix0 = Math.max(0, Math.ceil((x - r - minX) * inv))
    const ix1 = Math.min(nx - 1, Math.floor((x + r - minX) * inv))
    const iy0 = Math.max(0, Math.ceil((y - r - minY) * inv))
    const iy1 = Math.min(ny - 1, Math.floor((y + r - minY) * inv))
    const iz0 = Math.max(0, Math.ceil((z - r - minZ) * inv))
    const iz1 = Math.min(nz - 1, Math.floor((z + r - minZ) * inv))
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = minZ + iz * h - z
      const pz2 = pz * pz
      for (let iy = iy0; iy <= iy1; iy++) {
        const py = minY + iy * h - y
        const pyz2 = pz2 + py * py
        if (pyz2 >= r2) continue
        const rowBase = (iz * ny + iy) * nx
        for (let ix = ix0; ix <= ix1; ix++) {
          const px = minX + ix * h - x
          const d2 = pyz2 + px * px
          if (d2 < r2) field[rowBase + ix] += 1 - Math.sqrt(d2) * invR
        }
      }
    }
  }

  return {
    r, count, nx, ny, nz, h, inv,
    ox: minX, oy: minY, oz: minZ, ex: maxX, ey: maxY, ez: maxZ, field,
  }
}

/**
 * 单个位置周围的加权遮挡量 (未归一化), 对密度网格做三线性插值。
 *
 * 权重函数: `1 - d/r` (线性衰减)。选择线性而不是 1/d² 的原因: 1/d² 在 d→0 时发散,
 * 叶子中心附近的顶点会被压成纯黑; 线性衰减在"贴脸的叶子"处也有界, 视觉上更像枝叶的柔和遮蔽。
 *
 * 两种快速剔除: 空网格, 与"超出包围盒 radius 之外"的点 —— 后者距离所有样本都 > r,
 * 遮挡量必然为 0, 直接返回 0 而不用做插值 (顺带保证远离树冠的树根不会被边缘节点"蹭"暗)。
 *
 * @param {ReturnType<typeof buildOcclusionGrid>} grid 密度网格
 * @param {number} x 查询点 X (米, 世界坐标)
 * @param {number} y 查询点 Y (米)
 * @param {number} z 查询点 Z (米)
 * @returns {number} 遮挡量和 (>= 0, 无量纲; 数量级取决于半径内点数, 需归一化后使用)
 */
export function occlusionAt(grid, x, y, z) {
  const { nx, ny, nz, h, inv, ox, oy, oz, ex, ey, ez, r, field } = grid
  if (!nx) return 0
  // 包围盒外扩一个半径: 再远就完全不受点云影响
  if (x < ox - r || x > ex + r || y < oy - r || y > ey + r || z < oz - r || z > ez + r) return 0

  let fx = (x - ox) * inv
  let fy = (y - oy) * inv
  let fz = (z - oz) * inv
  // 夹到 [0, n-1]: 略微在包围盒内侧但超出最后一个节点的点用边缘节点值
  if (fx < 0) fx = 0; else if (fx > nx - 1) fx = nx - 1
  if (fy < 0) fy = 0; else if (fy > ny - 1) fy = ny - 1
  if (fz < 0) fz = 0; else if (fz > nz - 1) fz = nz - 1

  const ix = nx > 1 ? Math.min(nx - 2, fx | 0) : 0
  const iy = ny > 1 ? Math.min(ny - 2, fy | 0) : 0
  const iz = nz > 1 ? Math.min(nz - 2, fz | 0) : 0
  const tx = nx > 1 ? fx - ix : 0
  const ty = ny > 1 ? fy - iy : 0
  const tz = nz > 1 ? fz - iz : 0
  // 单节点轴没有"+1"邻居, 索引退化为自身 (tx=ty=tz=0 时结果与双线性等价)
  const jx = nx > 1 ? ix + 1 : ix
  const jy = ny > 1 ? iy + 1 : iy
  const jz = nz > 1 ? iz + 1 : iz
  const rowA = (iz * ny + iy) * nx
  const rowB = (iz * ny + jy) * nx
  const rowC = (jz * ny + iy) * nx
  const rowD = (jz * ny + jy) * nx
  const c00 = field[rowA + ix] + (field[rowA + jx] - field[rowA + ix]) * tx
  const c01 = field[rowB + ix] + (field[rowB + jx] - field[rowB + ix]) * tx
  const c10 = field[rowC + ix] + (field[rowC + jx] - field[rowC + ix]) * tx
  const c11 = field[rowD + ix] + (field[rowD + jx] - field[rowD + ix]) * tx
  const c0 = c00 + (c01 - c00) * ty
  const c1 = c10 + (c11 - c10) * ty
  return c0 + (c1 - c0) * tz
}

/** 取分位数 (输入已排序) */
function percentile(sorted, p) {
  if (!sorted.length) return 0
  // 取 floor(n*p) 而不是插值: AO 只需要一个"足够高"的基准值, 插值反而多算一次
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[i]
}

/**
 * 把 AO 乘进一个几何体的顶点色。
 *
 * 与 `bakeOcclusionByRanges` 的区别: 这里**逐顶点**查询 (树皮几何顶点少且分布均匀,
 * 而且树皮需要真实的"越靠下/越靠内越暗"的连续梯度, 用实例级近似会失去立体感)。
 *
 * 实现要点: 直接读写 `position.array` / `color.array`, 不走 `getX/setXYZ` 这类
 * 逐分量方法调用 —— 9 万顶点下这部分开销本身就有几十毫秒。
 *
 * @param {import('three').BufferGeometry} geometry
 * @param {ReturnType<typeof buildOcclusionGrid>} grid
 * @param {number} strength 0..1, 0 = 不烘焙
 * @param {{percentile?:number, minFactor?:number, sampleStride?:number}} [opts]
 *   sampleStride > 1 时只采样部分顶点估计归一化阈值 (用于超大树提速)
 *   注意: 抽样**只影响阈值的估计**, 每个顶点的 factor 仍然逐个精确计算。
 * @returns {{affected:number, threshold:number, minFactor:number}}
 */
export function bakeOcclusion(geometry, grid, strength, opts = {}) {
  const s = clamp01(Number(strength) || 0)
  const pos = geometry && geometry.attributes && geometry.attributes.position
  const col = geometry && geometry.attributes && geometry.attributes.color
  if (!pos || !col || !grid || !grid.count || s <= 0) return { affected: 0, threshold: 0, minFactor: 1 }
  const n = pos.count
  const stride = Math.max(1, Math.floor(opts.sampleStride || 1))
  // 快路径: 普通 Float32 属性 (本项目的几何都是这种) 直接用底层数组;
  // 交错/其它类型属性回落成分量访问, 保证兼容。
  const pa = pos.itemSize === 3 && pos.array instanceof Float32Array ? pos.array : null
  const ca = col.itemSize === 3 && col.array ? col.array : null
  const getX = pa ? null : (i) => pos.getX(i)
  const getY = pa ? null : (i) => pos.getY(i)
  const getZ = pa ? null : (i) => pos.getZ(i)

  // ① 逐顶点算未归一化遮挡量, 暂存在 sums 里 (后面归一化还要用一次, 不能就地改颜色)
  const sums = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    sums[i] = pa
      ? occlusionAt(grid, pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2])
      : occlusionAt(grid, getX(i), getY(i), getZ(i))
  }
  // 用于归一化的分位数: 抽样后排序 (Float32Array.sort 是数值排序, 比 JS 比较器快)
  const sampleCount = Math.ceil(n / stride)
  const sample = new Float32Array(sampleCount)
  for (let i = 0, k = 0; i < n; i += stride, k++) sample[k] = sums[i]
  sample.sort()
  const threshold = Math.max(1e-6, percentile(sample, opts.percentile === undefined ? 0.85 : opts.percentile))
  const minFactor = opts.minFactor === undefined ? 0.32 : opts.minFactor
  // ② 归一化 + 乘进顶点色; factor 下限 minFactor 保证最暗处仍能看清纹理细节
  if (ca) {
    for (let i = 0; i < n; i++) {
      const occ = clamp01(sums[i] / threshold)
      const factor = Math.max(minFactor, 1 - s * occ)
      const k = i * 3
      ca[k] = clamp01(ca[k] * factor)
      ca[k + 1] = clamp01(ca[k + 1] * factor)
      ca[k + 2] = clamp01(ca[k + 2] * factor)
    }
  } else {
    for (let i = 0; i < n; i++) {
      const occ = clamp01(sums[i] / threshold)
      const factor = Math.max(minFactor, 1 - s * occ)
      col.setXYZ(i, clamp01(col.getX(i) * factor), clamp01(col.getY(i) * factor), clamp01(col.getZ(i) * factor))
    }
  }
  col.needsUpdate = true
  // 只改了颜色不该影响包围球, 但调用方可能刚重建过属性; 用可选调用兼容纯 data 对象
  geometry.computeBoundingSphere?.()
  return { affected: n, threshold, minFactor }
}

/**
 * 按"实例顶点区间"烘焙 AO (叶片/花朵): 每个实例只查一次中心点, 再乘到区间内所有顶点。
 * 比逐顶点查询快一个数量级, 也避免同一张叶片内部出现细碎噪声。
 * @param {import('three').BufferGeometry} geometry
 * @param {ReturnType<typeof buildOcclusionGrid>} grid
 * @param {number} strength
 * @param {Array<[number,number,number,number,number]>} ranges [startVertex, endVertex, cx, cy, cz]
 * @param {{percentile?:number, minFactor?:number}} [opts]
 *   `percentile` 归一化分位 (默认 0.85); `minFactor` 压暗下限 (默认 0.32)
 * @returns {{affected:number, threshold:number, minFactor:number}}
 *   `affected` 是累计写入的顶点数 (区间为空时可能小于顶点总数)
 */
export function bakeOcclusionByRanges(geometry, grid, strength, ranges, opts = {}) {
  const s = clamp01(Number(strength) || 0)
  // color 属性是烘焙的载体: 没有它就直接跳过 (几何未准备好/材质不使用顶点色)
  const col = geometry && geometry.attributes && geometry.attributes.color
  if (!col || !grid || !grid.count || s <= 0 || !ranges || !ranges.length) {
    return { affected: 0, threshold: 0, minFactor: 1 }
  }
  // ① 每个实例查一次遮挡量 (ranges 的第 3~5 项是实例中心的世界坐标)
  const sums = new Float32Array(ranges.length)
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    sums[i] = occlusionAt(grid, r[2], r[3], r[4])
  }
  // ② 用实例之间的 85 分位数当"树冠最密处"的参照 -> occ 归一到 0..1
  const sorted = Float32Array.from(sums).sort()
  // threshold 下限 1e-6: 空场景/全零时避免除法得到 Infinity
  const threshold = Math.max(1e-6, percentile(sorted, opts.percentile === undefined ? 0.85 : opts.percentile))
  const minFactor = opts.minFactor === undefined ? 0.32 : opts.minFactor
  const count = col.count
  let affected = 0
  // ③ 同一实例的所有顶点共享一个 factor -> 叶片内部不会出现斑驳噪声
  // 快路径: 直接写底层数组, 避免每个顶点两次方法调用
  const ca = col.itemSize === 3 && col.array ? col.array : null
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    const occ = clamp01(sums[i] / threshold)
    const factor = Math.max(minFactor, 1 - s * occ)
    // 区间可能越界 (上游统计与实际顶点数不一致时), 这里夹到 [0, count) 防写越界
    const start = Math.max(0, r[0] | 0)
    const end = Math.min(count, r[1] | 0)
    if (ca) {
      for (let k = start * 3, kEnd = end * 3; k < kEnd; k++) {
        ca[k] = clamp01(ca[k] * factor)
      }
    } else {
      for (let v = start; v < end; v++) {
        col.setXYZ(v, clamp01(col.getX(v) * factor), clamp01(col.getY(v) * factor), clamp01(col.getZ(v) * factor))
      }
    }
    affected += Math.max(0, end - start)
  }
  col.needsUpdate = true
  // 只改了颜色不该影响包围球, 但调用方可能刚重建过属性; 用可选调用兼容纯 data 对象
  geometry.computeBoundingSphere?.()
  return { affected, threshold, minFactor }
}
