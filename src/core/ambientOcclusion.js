/**
 * 程序化环境光遮蔽 (AO) 烘焙
 * ------------------------------------------------------------
 * SpeedTree 的顶点色里通常烘焙了"叶片/枝条互相遮挡"的暗部信息, 引擎端直接乘到
 * 颜色上就能得到更有体积感的植被。这里用"叶簇点云 + 空间哈希"做一个轻量近似:
 *
 *   1. 收集所有叶片 / 花朵中心点, 建空间哈希 (cell = AO 半径)
 *   2. 对树皮 / 叶片 / 花朵的每个顶点, 统计周围点云的加权数量 (距离越近权重越大)
 *   3. 用该几何体自身的 85 分位数做归一化 —— 密林内部接近 1 (最暗), 树冠外层接近 0,
 *      这样不同树种 / 不同尺寸不需要手调阈值
 *   4. 把因子乘进顶点色 (COLOR_0), 导出的 GLB/OBJ 里也会带上
 *
 * 这是纯函数模块, 不依赖渲染器, 可在 Node 自检里直接验证。
 *
 * 作用: 给已经合并好的几何体**就地**乘一层 AO 到 `color` 顶点属性上。
 * 输入 / 输出:
 *   - 输入: 几何体 (需要 `position` + `color` 属性)、点云哈希 (见 buildOcclusionGrid)、
 *     强度 0..1, 以及可选的归一化参数;
 *   - 输出: `{affected, threshold, minFactor}` 三个数 —— 受影响顶点数、归一化阈值、暗部下限;
 *     真正的结果体现在几何体的 `color` 属性里 (本模块不返回新几何)。
 * 与其他模块的关系:
 *   - 上游: `sceneManager.js` / `treeBuilder.js` 在几何合并后, 用叶片+花朵中心点建网格;
 *   - 调用方: 树皮用 `bakeOcclusion` (逐顶点, 因为树皮顶点稀疏), 叶片/花朵用
 *     `bakeOcclusionByRanges` (逐实例, 快一个数量级且不产生叶片内部噪声);
 *   - 下游: 顶点色最终被材质着色器乘进 albedo, 也会随 GLB/OBJ 一起导出。
 * 关键约定:
 *   - 强度 `strength` 的语义是"最大压暗比例": factor = 1 - strength * occ,
 *     所以 strength=1 时最暗处会被压到 `minFactor` (默认 0.32, 不会全黑);
 *   - 归一化阈值取**分位数而非最大值**: 极少数离群顶点(例如一根孤零零的枝梢)会
 *     把最大值拉得很高, 用最大值归一化会让整棵树都变得很亮、AO 形同没开;
 *   - 顶点色是 [0,1] 的线性值, 每次乘法后都 clamp01, 防止重复烘焙/多次调用后溢出。
 * 注意: 本模块会修改传入几何体的 `color` 属性 (就地写), 属于有副作用函数;
 *       同一块几何重复调用会叠加压暗, 需要可重复时请重算几何而不是重复烘焙。
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
// 数字哈希替代字符串 key: 每次查询要算 27 个格子, 字符串拼接是主要瓶颈
const cellHash = (ix, iy, iz) => ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) >>> 0

/**
 * 建立点云空间哈希。
 *
 * 网格单元边长 = `radius`, 于是"半径内的点"必然落在 3×3×3 邻域中 (见 `occlusionAt`)。
 * 每个单元里存的是**样本下标**, 不复制坐标 —— 坐标仍留在传入的 `samples` 里。
 *
 * 关于哈希冲突: `cellHash` 把三维整数压成 32 位, 必然存在不同格子映射到同一 key 的情况。
 * 这里**故意不做冲突处理**: 冲突只会让数组里混进"别的格子"的样本下标,
 * 而 `occlusionAt` 后续还会按真实距离 `d2 < r2` 过滤, 错样本会被距离判定自然剔除,
 * 代价仅仅是多几次浮点比较 —— 比维护链表/开放寻址快得多。
 *
 * @param {Float32Array|number[]} samples 扁平 xyz 坐标 (length % 3 === 0)
 * @param {number} radius AO 影响半径 (米)
 * @returns {{map: Map<number, number[]>, r: number, samples: Float32Array|number[], count: number}}
 *   `map`: 哈希 key -> 样本下标数组; `r`: 实际生效半径; `count`: 样本点数
 */
export function buildOcclusionGrid(samples, radius = 1) {
  // 下限 0.05 米: 半径过小会让格子细到"每个点独占一格", 3×3×3 邻域反而漏掉邻居
  const r = Math.max(0.05, Number(radius) || 1)
  const map = new Map()
  const n = Math.floor(samples.length / 3)
  for (let i = 0; i < n; i++) {
    const x = samples[i * 3]
    const y = samples[i * 3 + 1]
    const z = samples[i * 3 + 2]
    const key = cellHash(Math.floor(x / r), Math.floor(y / r), Math.floor(z / r))
    let arr = map.get(key)
    if (!arr) { arr = []; map.set(key, arr) }
    arr.push(i)
  }
  return { map, r, samples, count: n }
}

/**
 * 单个位置周围的加权遮挡量 (未归一化)
 *
 * 权重函数: `1 - d/r` (线性衰减, d 为实际距离)。
 * 选择线性而不是 1/d² 的原因: 1/d² 在 d→0 时发散, 叶子中心附近的顶点会被压成纯黑;
 * 线性衰减在"贴脸的叶子"处也有界, 视觉上更像枝叶的柔和遮蔽。
 *
 * 扫描范围 3×3×3 = 27 个格子: 因为格子边长恰为 r, 半径 r 的球一定被
 * 以当前点所在格子为中心的这 27 格完全覆盖 (不需要更大范围)。
 *
 * @param {ReturnType<typeof buildOcclusionGrid>} grid 点云哈希
 * @param {number} x 查询点 X (米, 世界坐标)
 * @param {number} y 查询点 Y (米)
 * @param {number} z 查询点 Z (米)
 * @returns {number} 遮挡量和 (>= 0, 无量纲; 数量级取决于半径内点数, 需归一化后使用)
 */
export function occlusionAt(grid, x, y, z) {
  const { map, r, samples } = grid
  const r2 = r * r
  const ix = Math.floor(x / r)
  const iy = Math.floor(y / r)
  const iz = Math.floor(z / r)
  let sum = 0
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = map.get(cellHash(ix + dx, iy + dy, iz + dz))
        if (!arr) continue
        for (let k = 0; k < arr.length; k++) {
          const i = arr[k]
          const px = samples[i * 3] - x
          const py = samples[i * 3 + 1] - y
          const pz = samples[i * 3 + 2] - z
          const d2 = px * px + py * py + pz * pz
          // 只统计半径内的点; 开方是这里最贵的运算, 所以先用 d2 比较再开方算权重
          if (d2 < r2) sum += 1 - Math.sqrt(d2) / r
        }
      }
    }
  }
  return sum
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
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    const occ = clamp01(sums[i] / threshold)
    const factor = Math.max(minFactor, 1 - s * occ)
    // 区间可能越界 (上游统计与实际顶点数不一致时), 这里夹到 [0, count) 防写越界
    const start = Math.max(0, r[0] | 0)
    const end = Math.min(count, r[1] | 0)
    for (let v = start; v < end; v++) {
      col.setXYZ(v, clamp01(col.getX(v) * factor), clamp01(col.getY(v) * factor), clamp01(col.getZ(v) * factor))
    }
    affected += Math.max(0, end - start)
  }
  col.needsUpdate = true
  // 只改了颜色不该影响包围球, 但调用方可能刚重建过属性; 用可选调用兼容纯 data 对象
  geometry.computeBoundingSphere?.()
  return { affected, threshold, minFactor }
}

/** 取分位数 (就地会用副本排序, 不修改输入) */
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
  // ① 逐顶点算未归一化遮挡量, 暂存在 sums 里 (后面归一化还要用一次, 不能就地改颜色)
  const sums = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    sums[i] = occlusionAt(grid, pos.getX(i), pos.getY(i), pos.getZ(i))
  }
  // 用于归一化的分位数: 直接取全量排序太慢, 大几何抽样后排序
  const sample = []
  for (let i = 0; i < n; i += stride) sample.push(sums[i])
  sample.sort((a, b) => a - b)
  const threshold = Math.max(1e-6, percentile(sample, opts.percentile === undefined ? 0.85 : opts.percentile))
  const minFactor = opts.minFactor === undefined ? 0.32 : opts.minFactor
  // ② 归一化 + 乘进顶点色; factor 下限 minFactor 保证最暗处仍能看清纹理细节
  for (let i = 0; i < n; i++) {
    const occ = clamp01(sums[i] / threshold)
    const factor = Math.max(minFactor, 1 - s * occ)
    col.setXYZ(i, clamp01(col.getX(i) * factor), clamp01(col.getY(i) * factor), clamp01(col.getZ(i) * factor))
  }
  col.needsUpdate = true
  geometry.computeBoundingSphere?.()
  return { affected: n, threshold, minFactor }
}
