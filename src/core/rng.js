/**
 * 确定性随机数系统 (seeded PRNG)
 * ------------------------------------------------------------
 * 作用: 提供"同 seed 同参数 => 同结果"的随机流, 并支持按阶段派生子流。
 * 输入 / 输出: 输入是种子 (数字或字符串) 与阶段标签; 输出是 [0,1) 均匀数及由其派生的
 *               区间/整数/概率/正态等分布。
 * 与其他模块的关系: treeBuilder / barkSkin / leaf / fruit / litter 等所有需要抖动的
 *               模块都从这里取随机; 任何直接调用 Math.random() 的地方都会破坏可复现性。
 * 关键概念 / 约定:
 *   - 同一个 seed + 同一份参数 => 完全一致的树 (逐字节可复现);
 *   - 每个生成阶段使用独立的子流 (fork): 树干用 'trunk'、树枝用层标签、树叶用 'leaves';
 *     这样调节"树叶参数"不会挪动树干, 反之亦然 —— SpeedTree 那种"参数互不干扰"的手感;
 *   - 随机流的"消耗顺序"也是契约的一部分: 在同一子流里插一次 next() 会平移后续所有取值,
 *     所以新功能应新开 fork, 而不是在旧流中间插取值。
 * 注意: 算法为 xmur3 播种 + mulberry32 生成, 不用于密码学场景。
 */

/**
 * xmur3: 字符串 -> 32bit 种子序列。
 *
 * 先按字符滚动混淆 (Math.imul 保持 32 位语义), 返回一个闭包; 每调用一次就再推进一轮
 * 雪崩混合并输出一个 uint32。同一个字符串必然得到同一条种子序列。
 *
 * @param {string} str 任意字符串 (代码里形如 `${seed}::${label}`)
 * @returns {function(): number} 每次调用返回一个 [0, 2^32) 的无符号整数种子
 */
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

/**
 * mulberry32: 32bit 种子 -> [0,1) 均匀分布。
 *
 * 经典的小型快速 PRNG: 32 位状态、每步一次加法 + 三次 imul 混淆, 周期足够覆盖
 * 一棵树的顶点级抖动, 且实现只有十来行、可复制到任意环境。状态 a 被闭包捕获,
 * 因此每次调用都推进流。
 *
 * @param {number} a 任意 32bit 种子 (内部会 |=0 截断为 int32)
 * @returns {function(): number} 每次调用返回 [0,1) 的浮点数
 */
export function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 把任意字符串/数字混成一个 32bit 无符号整数。
 *
 * 拼成 `${seed}::${label}` 后交给 xmur3; 连续取 4 个数做 xor/imul 混合,
 * 避免"低质量种子"(例如只用第一个数时相邻 label 只差一位) 导致不同阶段出现相关性。
 *
 * @param {number|string} seed 全局种子 (用户可见的"随机种子"参数)
 * @param {string} [label=''] 阶段标签, 如 'trunk' / 'leaves' / 'trunk/branch0'
 * @returns {number} 32bit 无符号整数种子
 */
export function mixSeed(seed, label = '') {
  const s = hashString(`${seed}::${label}`)
  // 连续取 4 个数混成 32bit，避免低质量种子
  return (s() ^ Math.imul(s(), 2654435761) ^ Math.imul(s(), 40503)) >>> 0
}

/**
 * Rng: 带常用分布的随机流。
 * fork(label) 返回独立子流，互不影响。
 *
 * 设计要点: 子流不是"从父流里取一个种子", 而是用 `${父label}/${子label}` 重新走一遍
 * mixSeed —— 于是子流的值只取决于 (全局 seed, 完整标签路径), 与父流当前消耗到第几个数
 * 完全无关。这正是"改树叶不挪树干"能成立的原因。
 */
export class Rng {
  /**
   * @param {number|string} seed 全局种子
   * @param {string} [label='root'] 该流在标签树中的路径 (子流形如 'root/leaves')
   */
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

  /** 等概率取数组中的一个元素 (数组为空时返回 undefined, 调用方需自行保证非空) */
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)]
  }

  /**
   * 近似正态 (Irwin–Hall, 均值0, 标准差≈0.4)。
   *
   * 取 3 个均匀数求平均 (均值 0.5, 方差 1/36), 再线性拉伸到 [-1,1];
   * 比"单次均匀分布"更集中, 用于枝条长度/角度的自然方差, 避免出现均匀分布的"死板感"。
   */
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

/**
 * 构造一个从 'tree' 起步的随机流。
 *
 * @param {number|string} seed 全局种子
 * @param {string} [label='tree'] 起始标签 (会拼进子流路径)
 * @returns {Rng} 新的随机流实例
 */
export function makeRng(seed, label = 'tree') {
  return new Rng(seed, label)
}
