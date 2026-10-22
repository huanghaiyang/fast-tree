/**
 * 内置叶片卡片库 (路径约定式, 不枚举每张贴图)
 * ------------------------------------------------------------
 * 作用: 描述「有哪些批次的叶片贴图、每批多少行多少列」, 并据此**枚举**出全部卡片条目,
 *       供 UI 的叶卡选择器、以及运行时的落物/落叶效果共用。
 * 输入 / 输出: 无输入; 导出
 *   - LEAF_CARD_SETS  批次元数据 (手写的唯一数据源)
 *   - LEAF_CARDS      由批次展开出的扁平卡片数组
 *   - LEAF_CARD_BY_ID  id -> 卡片 的索引 Map
 *   - 若干查询/随机挑选辅助函数
 * 与其他模块的关系:
 *   - 生产/构建脚本按同一套命名把 PNG 放进 public/leaves/<dir>/ 下;
 *   - leafTexture.js 用 LEAF_CARD_BY_ID 反查 url 与 aspect;
 *   - 运行时 effect 组件 (fallingLeaves / litter) 通过 pickExistingCard 拿「真实存在」的卡。
 * 关键概念 / 约定:
 *   只描述"哪个目录、什么命名、多少行/列", 卡的 URL 由路径拼出来:
 *     /leaves/<dir>/<prefix>_r<行>_c<列>.png
 *   这样**删除任意一张贴图都不需要改代码**:
 *     - 缩略图加载失败自动隐藏 (UI 里 @error)
 *     - 应用该卡片时贴图若 404, 材质回退到程序化叶形
 *   行/列取该批次的最大值, 缺失位置自然被跳过。
 * 注意: 本文件是**构建生成**的数据文件, 注释只写到「结构与用法」层面,
 *       不要给每条卡片逐行加注释 (几百条会淹没源码)。改批次请改生成脚本, 不要手改数据。
 *
 * 素材入库流程 (外部 PNG -> public/leaves):
 *   跑 `npm run leaf-cards` (scripts/prepare-leaf-cards.mjs): 它按 alpha 外接矩形**切掉空白背景**,
 *   量出裁边后的真实宽高比写进 leafCardAspects.generated.js, 并把下面要粘的批次条目打印出来。
 */
import { LEAF_CARD_ASPECTS } from './leafCardAspects.generated.js'

/* ---------------- ① 批次元数据 (唯一手写数据源) ---------------- */

/**
 * 批次定义表。每项字段:
 *   - id      批次唯一键, 同时用作卡片 id 前缀 (`<id>-r01-c01`) 与旧接口的 key
 *   - dir     public/leaves/ 下的子目录名
 *   - prefix  该批图片的文件名前缀
 *   - rows    行数 (1 起算, 行号 pad2 补零)
 *   - cols    列数 (同上)
 *   - name    UI 下拉框里显示的中文名 (带 ①②③ 序号保持顺序感)
 * 顺序即 UI 顺序; 行/列取该批次「真实存在的最大行列」, 空缺位置不会被探测到。
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
  // ---- 柳树 (v4 第四轮素材: 柳叶 / 柳絮 / 花穗; 入库时已按 alpha 外接矩形切掉空白背景) ----
  // 这三批的 aspect 走 leafCardAspects.generated.js 的实测值 (柳絮实测 1.6~4.2, 用 0.72 会压成竖条)
  { id: 'v4_batch4_leafB', dir: 'v4_batch4_leafB', prefix: 'leafB', rows: 7, cols: 13, name: '⑪ 柳叶 B' },
  { id: 'v4_batch2_catkin', dir: 'v4_batch2_catkin', prefix: 'catkin', rows: 7, cols: 6, name: '⑫ 柳絮' },
  { id: 'v4_batch1_plume', dir: 'v4_batch1_plume', prefix: 'plume', rows: 6, cols: 13, name: '⑬ 柳花穗' },
  // ---- 灌木 (v5 素材: 带叶小枝簇 / 单片阔叶; 同样按 alpha 外接矩形入库并取实测宽高比) ----
  { id: 'v5_batch1_plant1', dir: 'v5_batch1_plant1', prefix: 'plant1', rows: 6, cols: 12, name: '⑭ 灌木枝叶' },
  { id: 'v5_batch2_plant2', dir: 'v5_batch2_plant2', prefix: 'plant2', rows: 6, cols: 9, name: '⑮ 灌木叶' },
  // ---- 松针 (v7 素材: 成簇针叶小枝, 一卡就是一束松针; 同样入库时取 AABB 实测宽高比) ----
  { id: 'v7_batch3_pine1', dir: 'v7_batch3_pine1', prefix: 'pine1', rows: 6, cols: 8, name: '⑯ 松针 A' },
  { id: 'v7_batch4_pine2', dir: 'v7_batch4_pine2', prefix: 'pine2', rows: 6, cols: 10, name: '⑰ 松针 B' },
]

/**
 * 老批次的通用叶形宽高比估值。
 * 历史原因: 卡片库最初只有桦树两批 (实测均值 0.69), 于是全库写死 0.72。
 * 现在新批次一律用实测值 (见 LEAF_CARD_ASPECTS), 老批次保持 0.72 以**不改动既有外观**;
 * 要让老批次也用真值, 在 prepare-leaf-cards.mjs 的 BATCHES 里登记它们并重跑即可。
 */
const DEFAULT_CARD_ASPECT = 0.72

/* ---------------- ② URL 拼装 ---------------- */

/** 两位补零: 1 -> '01'。文件名里的行列统一两位, 方便文件管理器按名排序。 */
function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 路径拼装 (唯一真相来源) */
export function leafCardUrl(set, row, col) {
  return `/leaves/${set.dir}/${set.prefix}_r${pad2(row)}_c${pad2(col)}.png`
}

/* ---------------- ③ 展开成扁平卡片列表 ---------------- */

/**
 * 全部卡片条目 (由批次笛卡尔积展开, rows 行 × cols 列)。
 * 每项字段:
 *   - id     全局唯一, 形如 `batch1-r01-c01`
 *   - batch  所属批次 id (用于按批次分组过滤)
 *   - row / col  1 起算的行号/列号
 *   - aspect 裁边后 宽/高。优先用 leafCardAspects.generated.js 的实测值,
 *            该批次没进表时回退 DEFAULT_CARD_ASPECT (老批次沿用 0.72, 外观不变)
 *   - url    贴图地址 (见 leafCardUrl)
 * 展开顺序 = 批次顺序 → 行 → 列, 因此数组下标本身就是一种稳定排序。
 */
export const LEAF_CARDS = LEAF_CARD_SETS.flatMap((set) => {
  // 实测表按「行-1 / 列-1」二维索引; 空号位是 null, 一起被 || 兜到默认值
  const table = LEAF_CARD_ASPECTS[set.id]
  const out = []
  for (let r = 1; r <= set.rows; r++) {
    for (let c = 1; c <= set.cols; c++) {
      const measured = table && table[r - 1] ? table[r - 1][c - 1] : null
      out.push({
        id: `${set.id}-r${pad2(r)}-c${pad2(c)}`,
        batch: set.id,
        row: r,
        col: c,
        aspect: measured || DEFAULT_CARD_ASPECT, // 实测值优先; 空号/缺表 -> 通用估值
        url: leafCardUrl(set, r, c),
      })
    }
  }
  return out
})

/** 卡片 id -> 卡片对象 的索引。leafTexture.js 用它把 id 解析成 url/aspect, O(1)。 */
export const LEAF_CARD_BY_ID = new Map(LEAF_CARDS.map((c) => [c.id, c]))

/** 兼容旧接口: 批次 -> { 行: 列数 } */
export const LEAF_CARD_BATCHES = Object.fromEntries(
  LEAF_CARD_SETS.map((s) => {
    // 旧接口是「行号 -> 该行的列数」的二维表; 本库里每行都是满列, 所以直接填 cols。
    // 保留它是为了让还没迁移的老组件不必改调用方式。
    const rows = {}
    for (let r = 1; r <= s.rows; r++) rows[String(r)] = s.cols
    return [s.id, rows]
  }),
)

/** 批次 id -> 中文显示名。UI 下拉框直接用这张表做 label, 不必再遍历 LEAF_CARD_SETS。 */
export const LEAF_CARD_BATCH_NAMES = Object.fromEntries(LEAF_CARD_SETS.map((s) => [s.id, s.name]))

/** 取某批次某行的全部卡片 (按列顺序)。UI 里「批次 + 行」两栏联动时用它出缩略图。 */
export function leafCardsFor(batch, row) {
  return LEAF_CARDS.filter((c) => c.batch === batch && c.row === row)
}

/** 取某批次的全部行号 (1..rows)。返回普通数组而非迭代器, 便于直接渲染 v-for。 */
export function leafCardRows(batch) {
  const set = LEAF_CARD_SETS.find((s) => s.id === batch)
  if (!set) return []
  return Array.from({ length: set.rows }, (_, i) => i + 1)
}

/* ---------------- ④ 随机挑选 ---------------- */

/** 花朵批次 (樱花等花朵素材) */
export const FLOWER_CARD_BATCHES = ['fl_batch1', 'fl_batch2', 'fl_v2_batch1', 'fl_v2_batch2', 'fl_v3_batch1', 'fl_v3_batch2']

/** 随机一张"叶子素材"卡片 */
export function randomLeafAsset(rng = Math.random) {
  const pool = LEAF_CARDS.filter((c) => !FLOWER_CARD_BATCHES.includes(c.batch))
  // `% pool.length` 是防御: 外部传入的 rng 若返回 >=1 (自定义分布写错) 也不会越界;
  // pool 为空时退回 LEAF_CARDS[0], 保证调用方永远拿到一张卡。
  return pool[Math.floor(rng() * pool.length) % pool.length] || LEAF_CARDS[0]
}

/** 随机一张"花朵素材"卡片 */
export function randomFlowerAsset(rng = Math.random) {
  const pool = LEAF_CARDS.filter((c) => FLOWER_CARD_BATCHES.includes(c.batch))
  // 花朵池可能为空 (贴图没构建进来), 此时退回「全量卡片」而不是报错
  const list = pool.length ? pool : LEAF_CARDS
  return list[Math.floor(rng() * list.length) % list.length] || list[0]
}

/* ---------------- 存在性探测: 卡片库是"路径枚举", 有空位; 只能挑真实存在的 ---------------- */
// url -> boolean 的探测结果缓存。卡片库按行列枚举, 目录里必然有空位,
// 所以「随机挑一张」之后还要确认它真的在; 缓存避免同一张卡被反复 HEAD 请求。
const __probeCache = new Map()

/** HEAD 探测一张卡片是否真实存在 (Vite dev 对缺失文件会回 200 + index.html, 必须看 content-type) */
export async function probeCardExists(url) {
  if (__probeCache.has(url)) return __probeCache.get(url)
  let ok = false
  try {
    // cache:'no-store' —— 探测结果要反映磁盘真实状态, 不能被 HTTP 缓存糊弄
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    // 关键: Vite dev server 对不存在的路径会 SPA 回退成 index.html 且状态 200,
    // 所以只看 res.ok 会把缺失的卡判成存在; 必须额外要求 content-type 是 image/*。
    const type = res.headers.get('content-type') || ''
    ok = res.ok && type.startsWith('image/')
  } catch (e) {
    // 网络错误 / 跨域拦截等一律视为不存在 (探测是尽力而为, 不应抛出打断生成)
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
  // 走到这里说明随机抽查的 10 次都撞在空位上, 改成确定性扫描:
  // 代价是可能连续发很多 HEAD, 但只在「贴图库严重缺失」时才会发生, 可接受。
  const pool = kind === 'flower'
    ? LEAF_CARDS.filter((c) => FLOWER_CARD_BATCHES.includes(c.batch))
    : LEAF_CARDS.filter((c) => !FLOWER_CARD_BATCHES.includes(c.batch))
  for (const card of pool) {
    if (await probeCardExists(card.url)) return card
  }
  // 一张都不存在 -> 返回 null, 上层据此回退到程序化叶形/椭圆贴图
  return null
}
