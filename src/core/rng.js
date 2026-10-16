/**
 * 确定性随机数系统 (seeded PRNG)
 * ------------------------------------------------------------
 * 目标: 同一个 seed + 同一份参数 => 完全一致的树 (逐字节可复现)。
 *
 * 关键设计: 每个生成阶段使用独立的子流 (fork)。
 * 例如树干使用 hash(seed + 'trunk')，树叶使用 hash(seed + 'leaves')。
 * 这样调节"树叶参数"不会挪动树干，反之亦然 —— 也就是 SpeedTree 那种
 * "参数互不干扰" 的手感。
 */

/** xmur3: 字符串 -> 32bit 种子序列 */
export function hashString(str) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

/** mulberry32: 32bit 种子 -> [0,1) 均匀分布 */
export function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 把任意字符串/数字混成一个 32bit 无符号整数 */
export function mixSeed(seed, label = '') {
  const s = hashString(`${seed}::${label}`)
  // 连续取 4 个数混成 32bit，避免低质量种子
  return (s() ^ Math.imul(s(), 2654435761) ^ Math.imul(s(), 40503)) >>> 0
}

/**
 * Rng: 带常用分布的随机流。
 * fork(label) 返回独立子流，互不影响。
 */
export class Rng {
  constructor(seed, label = 'root') {
    this.seed = seed
    this.label = label
    this._n = mixSeed(seed, label)
    this._next = mulberry32(this._n)
  }

  /** [0,1) */
  next() {
    return this._next()
  }

  /** [min,max) */
  range(min, max) {
    return min + (max - min) * this._next()
  }

  /** 整数 [min,max] */
  int(min, max) {
    return Math.floor(min + (max - min + 1) * this._next()) | 0
  }

  /** 以 p 的概率返回 true */
  chance(p) {
    return this._next() < p
  }

  /** -1..1 */
  signed() {
    return this._next() * 2 - 1
  }

  /** 围绕 1 的 ±amount 抖动 (用于长度/半径方差) */
  vary(amount) {
    return 1 + this.signed() * amount
  }

  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)]
  }

  /** 近似正态 (Irwin–Hall, 均值0, 标准差≈0.4) */
  gauss() {
    let s = 0
    for (let i = 0; i < 3; i++) s += this._next()
    return (s / 3 - 0.5) * 2
  }

  /** 独立子流: 同一 label 永远得到同一序列 */
  fork(label) {
    return new Rng(this.seed, `${this.label}/${label}`)
  }
}

export function makeRng(seed, label = 'tree') {
  return new Rng(seed, label)
}
