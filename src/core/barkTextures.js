/**
 * 内置树皮贴图库 (路径约定式, 不枚举每张贴图)
 * ------------------------------------------------------------
 * 目录约定: public/bark/bark_batchN/barkN_r<行>_c<列>.png
 * URL 由路径拼装, **删除任意一张贴图不需要改代码** (缩略图 404 会自动隐藏)。
 * 树皮为可平铺材质, 不做 alpha 裁边; 平铺次数由 bark.uvScaleU / uvScaleV 控制。
 */
export const BARK_SETS = [
  { id: 'batch1', dir: 'bark_batch1', prefix: 'bark1', rows: 4, cols: 5, name: '灰褐裂隙' },
  { id: 'batch2', dir: 'bark_batch2', prefix: 'bark2', rows: 4, cols: 5, name: '红褐块状' },
  { id: 'batch3', dir: 'bark_batch3', prefix: 'bark3', rows: 4, cols: 5, name: '黑白桦皮' },
  { id: 'batch4', dir: 'bark_batch4', prefix: 'bark4', rows: 4, cols: 5, name: '白桦' },
]

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 路径拼装 (唯一真相来源) */
export function barkTextureUrl(set, row, col) {
  return `/bark/${set.dir}/${set.prefix}_r${pad2(row)}_c${pad2(col)}.png`
}

export const BARK_TEXTURES = BARK_SETS.flatMap((set) => {
  const out = []
  for (let r = 1; r <= set.rows; r++) {
    for (let c = 1; c <= set.cols; c++) {
      out.push({
        id: `${set.id}-r${pad2(r)}-c${pad2(c)}`,
        batch: set.id,
        row: r,
        col: c,
        name: `${set.name} #${r}-${c}`,
        url: barkTextureUrl(set, r, c),
      })
    }
  }
  return out
})

export const BARK_TEXTURE_BY_ID = new Map(BARK_TEXTURES.map((t) => [t.id, t]))

export const BARK_BATCHES = BARK_SETS.map((s) => ({ id: s.id, name: s.name }))

/** 某批次 / 某个"树皮款式"(row) 下的所有采样 */
export function barkTexturesFor(batch, row) {
  return BARK_TEXTURES.filter((t) => t.batch === batch && t.row === row)
}

export function barkTextureRows(batch) {
  const set = BARK_SETS.find((s) => s.id === batch)
  if (!set) return []
  return Array.from({ length: set.rows }, (_, i) => i + 1)
}
