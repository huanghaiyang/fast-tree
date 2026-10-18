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
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
// 数字哈希替代字符串 key: 每次查询要算 27 个格子, 字符串拼接是主要瓶颈
const cellHash = (ix, iy, iz) => ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) >>> 0

/**
 * 建立点云空间哈希。
 * @param {Float32Array|number[]} samples 扁平 xyz 坐标 (length % 3 === 0)
 * @param {number} radius AO 影响半径 (米)
 */
export function buildOcclusionGrid(samples, radius = 1) {
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

/** 单个位置周围的加权遮挡量 (未归一化) */
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
 */
export function bakeOcclusionByRanges(geometry, grid, strength, ranges, opts = {}) {
  const s = clamp01(Number(strength) || 0)
  const col = geometry && geometry.attributes && geometry.attributes.color
  if (!col || !grid || !grid.count || s <= 0 || !ranges || !ranges.length) {
    return { affected: 0, threshold: 0, minFactor: 1 }
  }
  const sums = new Float32Array(ranges.length)
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    sums[i] = occlusionAt(grid, r[2], r[3], r[4])
  }
  const sorted = Float32Array.from(sums).sort()
  const threshold = Math.max(1e-6, percentile(sorted, opts.percentile === undefined ? 0.85 : opts.percentile))
  const minFactor = opts.minFactor === undefined ? 0.32 : opts.minFactor
  const count = col.count
  let affected = 0
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    const occ = clamp01(sums[i] / threshold)
    const factor = Math.max(minFactor, 1 - s * occ)
    const start = Math.max(0, r[0] | 0)
    const end = Math.min(count, r[1] | 0)
    for (let v = start; v < end; v++) {
      col.setXYZ(v, clamp01(col.getX(v) * factor), clamp01(col.getY(v) * factor), clamp01(col.getZ(v) * factor))
    }
    affected += Math.max(0, end - start)
  }
  col.needsUpdate = true
  geometry.computeBoundingSphere?.()
  return { affected, threshold, minFactor }
}

/** 取分位数 (就地会用副本排序, 不修改输入) */
function percentile(sorted, p) {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[i]
}

/**
 * 把 AO 乘进一个几何体的顶点色。
 * @param {import('three').BufferGeometry} geometry
 * @param {ReturnType<typeof buildOcclusionGrid>} grid
 * @param {number} strength 0..1, 0 = 不烘焙
 * @param {{percentile?:number, minFactor?:number, sampleStride?:number}} [opts]
 *   sampleStride > 1 时只采样部分顶点估计归一化阈值 (用于超大树提速)
 * @returns {{affected:number, threshold:number, minFactor:number}}
 */
export function bakeOcclusion(geometry, grid, strength, opts = {}) {
  const s = clamp01(Number(strength) || 0)
  const pos = geometry && geometry.attributes && geometry.attributes.position
  const col = geometry && geometry.attributes && geometry.attributes.color
  if (!pos || !col || !grid || !grid.count || s <= 0) return { affected: 0, threshold: 0, minFactor: 1 }
  const n = pos.count
  const stride = Math.max(1, Math.floor(opts.sampleStride || 1))
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
  for (let i = 0; i < n; i++) {
    const occ = clamp01(sums[i] / threshold)
    const factor = Math.max(minFactor, 1 - s * occ)
    col.setXYZ(i, clamp01(col.getX(i) * factor), clamp01(col.getY(i) * factor), clamp01(col.getZ(i) * factor))
  }
  col.needsUpdate = true
  geometry.computeBoundingSphere?.()
  return { affected: n, threshold, minFactor }
}
