/**
 * 内置叶片卡片库 (路径约定式, 不枚举每张贴图)
 * ------------------------------------------------------------
 * 只描述"哪个目录、什么命名、多少行/列", 卡的 URL 由路径拼出来:
 *   /leaves/<dir>/<prefix>_r<行>_c<列>.png
 * 这样**删除任意一张贴图都不需要改代码**:
 *   - 缩略图加载失败自动隐藏 (UI 里 @error)
 *   - 应用该卡片时贴图若 404, 材质回退到程序化叶形
 * 行/列取该批次的最大值, 缺失位置自然被跳过。
 */
export const LEAF_CARD_SETS = [
  { id: 'batch1', dir: 'batch1', prefix: 'v2_leaf1', rows: 7, cols: 10, name: '① 秋色系' },
  { id: 'batch2', dir: 'batch2', prefix: 'v2_leaf2', rows: 6, cols: 9, name: '② 绿色系' },
  { id: 'v4_batch1', dir: 'v4_batch1', prefix: 'v4_leaf1', rows: 6, cols: 12, name: '③ 桦树 A' },
  { id: 'v4_batch2', dir: 'v4_batch2', prefix: 'v4_leaf2', rows: 6, cols: 13, name: '④ 桦树 B' },
  // ---- 樱花 (作为"叶片卡片"使用: 花枝/花簇直接当叶形) ----
  { id: 'fl_batch1', dir: 'fl_batch1', prefix: 'flower1', rows: 6, cols: 9, name: '⑤ 樱花 A' },
  { id: 'fl_batch2', dir: 'fl_batch2', prefix: 'flower2', rows: 7, cols: 9, name: '⑥ 樱花 B' },
  { id: 'fl_v2_batch1', dir: 'fl_v2_batch1', prefix: 'leafyflower1', rows: 9, cols: 9, name: '⑦ 樱花 V2A' },
  { id: 'fl_v2_batch2', dir: 'fl_v2_batch2', prefix: 'leafyflower2', rows: 6, cols: 9, name: '⑧ 樱花 V2B' },
  { id: 'fl_v3_batch1', dir: 'fl_v3_batch1', prefix: 'bunch1', rows: 6, cols: 11, name: '⑨ 樱花 V3A' },
  { id: 'fl_v3_batch2', dir: 'fl_v3_batch2', prefix: 'bunch2', rows: 6, cols: 9, name: '⑩ 樱花 V3B' },
]

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 路径拼装 (唯一真相来源) */
export function leafCardUrl(set, row, col) {
  return `/leaves/${set.dir}/${set.prefix}_r${pad2(row)}_c${pad2(col)}.png`
}

export const LEAF_CARDS = LEAF_CARD_SETS.flatMap((set) => {
  const out = []
  for (let r = 1; r <= set.rows; r++) {
    for (let c = 1; c <= set.cols; c++) {
      out.push({
        id: `${set.id}-r${pad2(r)}-c${pad2(c)}`,
        batch: set.id,
        row: r,
        col: c,
        aspect: 0.72, // 通用叶形比例; 应用时以实际贴图宽高为准
        url: leafCardUrl(set, r, c),
      })
    }
  }
  return out
})

export const LEAF_CARD_BY_ID = new Map(LEAF_CARDS.map((c) => [c.id, c]))

/** 兼容旧接口: 批次 -> { 行: 列数 } */
export const LEAF_CARD_BATCHES = Object.fromEntries(
  LEAF_CARD_SETS.map((s) => {
    const rows = {}
    for (let r = 1; r <= s.rows; r++) rows[String(r)] = s.cols
    return [s.id, rows]
  }),
)

export const LEAF_CARD_BATCH_NAMES = Object.fromEntries(LEAF_CARD_SETS.map((s) => [s.id, s.name]))

export function leafCardsFor(batch, row) {
  return LEAF_CARDS.filter((c) => c.batch === batch && c.row === row)
}

export function leafCardRows(batch) {
  const set = LEAF_CARD_SETS.find((s) => s.id === batch)
  if (!set) return []
  return Array.from({ length: set.rows }, (_, i) => i + 1)
}

/** 花朵批次 (樱花等花朵素材) */
export const FLOWER_CARD_BATCHES = ['fl_batch1', 'fl_batch2', 'fl_v2_batch1', 'fl_v2_batch2', 'fl_v3_batch1', 'fl_v3_batch2']

/** 随机一张"叶子素材"卡片 */
export function randomLeafAsset(rng = Math.random) {
  const pool = LEAF_CARDS.filter((c) => !FLOWER_CARD_BATCHES.includes(c.batch))
  return pool[Math.floor(rng() * pool.length) % pool.length] || LEAF_CARDS[0]
}

/** 随机一张"花朵素材"卡片 */
export function randomFlowerAsset(rng = Math.random) {
  const pool = LEAF_CARDS.filter((c) => FLOWER_CARD_BATCHES.includes(c.batch))
  const list = pool.length ? pool : LEAF_CARDS
  return list[Math.floor(rng() * list.length) % list.length] || list[0]
}

/* ---------------- 存在性探测: 卡片库是"路径枚举", 有空位; 只能挑真实存在的 ---------------- */
const __probeCache = new Map()

/** HEAD 探测一张卡片是否真实存在 (Vite dev 对缺失文件会回 200 + index.html, 必须看 content-type) */
export async function probeCardExists(url) {
  if (__probeCache.has(url)) return __probeCache.get(url)
  let ok = false
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    const type = res.headers.get('content-type') || ''
    ok = res.ok && type.startsWith('image/')
  } catch (e) {
    ok = false
  }
  __probeCache.set(url, ok)
  return ok
}

/** 随机挑一张"真实存在"的叶子/花朵卡片 (最多尝试 tries 张) */
export async function pickExistingCard(kind = 'leaf', rng = Math.random, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const card = kind === 'flower' ? randomFlowerAsset(rng) : randomLeafAsset(rng)
    // 同一张卡在池里可能出现多次, 探测缓存会立刻返回, 不会重复请求
    if (await probeCardExists(card.url)) return card
  }
  // 全部失败: 按批次顺序线性找第一张真实存在的
  const pool = kind === 'flower'
    ? LEAF_CARDS.filter((c) => FLOWER_CARD_BATCHES.includes(c.batch))
    : LEAF_CARDS.filter((c) => !FLOWER_CARD_BATCHES.includes(c.batch))
  for (const card of pool) {
    if (await probeCardExists(card.url)) return card
  }
  return null
}
