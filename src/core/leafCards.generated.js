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
