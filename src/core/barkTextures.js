/**
 * 内置树皮贴图库 (路径约定式, 不枚举每张贴图)
 * ------------------------------------------------------------
 * 作用: 把 public/bark/ 下"按目录 + 文件名约定"摆放的树皮 PNG, 一次性展开成扁平
 *       贴图表 (BARK_TEXTURES), 并提供 id / 批次 / 款式行 三种检索入口。
 * 输入 / 输出:
 *   输入 = BARK_SETS 登记的 4 个批次 (每批次 = 一个目录 + 一个文件名前缀 + 行数 + 列数);
 *   输出 = 每个 (批次, row, col) 三元组一条记录
 *          { id, batch, row, col, name, url }, 共 4 × 4 × 5 = 80 条。
 * 与其他模块的关系:
 *   - 消费者一: components/panels/MaterialPanel.vue (内置树皮选择面板: 批次 tab + 款式行 chip + 缩略图网格);
 *   - 消费者二: core/appApi.js 的 app.list_bark_textures / app.set_bark_texture 两条对外命令;
 *   - 本模块只产出 URL 字符串, 不加载纹理、不碰 Three.js; 真正 setMaterial / map 赋值与
 *     平铺次数 (bark.uvScaleU / uvScaleV) 在 sceneManager.js 里;
 *   - 选中的 URL 最终写入 params.bark.texture, 属于"参数"而不是"资源", 因此可被保存/导出。
 * 关键概念 / 约定:
 *   - 目录约定: public/bark/bark_batchN/barkN_r<行>_c<列>.png, 行/列都补零成 2 位 (r01_c03);
 *   - URL 由路径拼装, **删除任意一张贴图不需要改代码** (缩略图 404 会自动隐藏, UI 据此计数);
 *   - row = "款式" (同一风格的所有列构成一行), col = 同款式下的列变体;
 *     API 未指定 row/col 时默认 1 (见 appApi 的 app.set_bark_texture);
 *   - 树皮为可平铺材质, 不做 alpha 裁边, 也不做 UV 裁切: 只靠 uvScale 控制重复次数;
 *   - 纯数据 + 纯函数: 无 rng、无副作用, 同一份源码永远展开出同一张表 (确定性)。
 */

/**
 * 内置树皮批次表 (也是"目录 + 文件名"的约定声明)。
 *
 * 每个批次的字段:
 *   id     : 批次标识, 同时是 UI tab 的 value 与贴图 id 的前缀;
 *   dir    : public/bark/ 下的子目录名;
 *   prefix : 文件名前缀, 拼成 `<prefix>_r<行>_c<列>.png`;
 *   rows   : 款式行数 = 该批次提供几种"风格";
 *   cols   : 每行的列变体数 (同风格的不同采样, 用于轮换避免整片森林纹理重复);
 *   name   : 中文显示名 (面板上看到的就是它)。
 *
 * 新增一个批次 = 在这里加一行 + 把贴图按命名约定放进 public/bark/, 不需要改任何加载逻辑。
 * 消费方: BARK_TEXTURES / BARK_BATCHES / barkTextureUrl 都从这里派生, 它是唯一真相来源。
 */
export const BARK_SETS = [
  { id: 'batch1', dir: 'bark_batch1', prefix: 'bark1', rows: 4, cols: 5, name: '灰褐裂隙' },
  { id: 'batch2', dir: 'bark_batch2', prefix: 'bark2', rows: 4, cols: 5, name: '红褐块状' },
  { id: 'batch3', dir: 'bark_batch3', prefix: 'bark3', rows: 4, cols: 5, name: '黑白桦皮' },
  { id: 'batch4', dir: 'bark_batch4', prefix: 'bark4', rows: 4, cols: 5, name: '白桦' },
]

/**
 * 数字补零成 2 位 (1 -> '01', 12 -> '12')。
 * 磁盘上的文件名就是 r01 / c05 这种两位格式, 这里必须与之一致, 否则拼出的 URL 会 404;
 * 同时固定宽度让 id 的字典序 = 数值序 (排序/比对都稳定)。
 * @param {number} n 行号或列号 (从 1 开始)
 * @returns {string} 两位字符串
 */
function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/**
 * 路径拼装 (唯一真相来源)。
 *
 * 以 `/` 开头是站点根绝对路径: Vite 把 public/ 目录整体映射到站点根, 所以 URL 与
 * 当前页面路由无关, 刷新/深链接都不会拼错。不在这里做 base 前缀处理 —— 部署到子路径
 * 时由构建/部署侧负责改写。
 *
 * @param {{dir: string, prefix: string}} set BARK_SETS 里的一个批次
 * @param {number} row 款式行号 (1..rows)
 * @param {number} col 列变体号 (1..cols)
 * @returns {string} 形如 `/bark/bark_batch1/bark1_r01_c03.png`
 */
export function barkTextureUrl(set, row, col) {
  return `/bark/${set.dir}/${set.prefix}_r${pad2(row)}_c${pad2(col)}.png`
}

/**
 * 全部树皮贴图 (扁平数组)。
 * 展开顺序 = 批次 -> 行 -> 列, 因此同一批次、同一款式的项在数组里连续;
 * UI 的批次计数、行计数、缩略图网格都依赖这个顺序, 不要改成按列优先。
 * 每条记录的 id 形如 `batch1-r01-c03`, 是全局唯一的稳定标识 (可用于参数/预设引用)。
 */
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

/**
 * id -> 贴图记录 的 O(1) 索引 (80 条, 构建成本可忽略)。
 * 用途: 从保存下来的参数/预设里按 id 反查 URL; 当前源码内暂无直接调用点,
 * 保留给 app API 与外部调用方。
 */
export const BARK_TEXTURE_BY_ID = new Map(BARK_TEXTURES.map((t) => [t.id, t]))

/**
 * 给 UI 的批次摘要列表: 只暴露 { id, name }, 不带 rows/cols/dir 等实现细节。
 * 面板的批次 tab 直接 v-for 这个数组。
 */
export const BARK_BATCHES = BARK_SETS.map((s) => ({ id: s.id, name: s.name }))

/**
 * 某批次 / 某个"树皮款式"(row) 下的所有采样 (即该行的所有列变体)。
 * UI 交互链路: 先选批次 -> 再选款式行 -> 在返回的这一行里挑一张具体贴图。
 *
 * 返回值是新数组 (filter), 调用方可以随意增删排序而不影响 BARK_TEXTURES。
 * 批次或行不存在时返回空数组 (不抛错, 便于 UI 在数据未就绪时安全调用)。
 *
 * @param {string} batch 批次 id (BARK_SETS[].id)
 * @param {number} row 款式行号 (1..rows)
 * @returns {Array<{id:string, batch:string, row:number, col:number, name:string, url:string}>}
 */
export function barkTexturesFor(batch, row) {
  return BARK_TEXTURES.filter((t) => t.batch === batch && t.row === row)
}

/**
 * 某批次有哪些款式行号, 返回 [1, 2, ..., rows]。
 * 面板用它渲染款式行 chip, 批次不存在时返回空数组 (不抛错, 同 barkTexturesFor 的理由)。
 *
 * @param {string} batch 批次 id
 * @returns {Array<number>} 从 1 开始的行号数组
 */
export function barkTextureRows(batch) {
  const set = BARK_SETS.find((s) => s.id === batch)
  if (!set) return []
  return Array.from({ length: set.rows }, (_, i) => i + 1)
}
