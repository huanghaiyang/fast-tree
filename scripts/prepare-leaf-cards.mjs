/**
 * 叶片卡片素材入库脚本 (AABB 切空白背景 + 实宽高比 + 排队上架)
 * ------------------------------------------------------------
 * 作用: 把一批「外部下载的 PNG 叶片素材」按仓库约定落进 public/leaves/<批次>/,
 *       同时做两件素材库必须的事:
 *         ① **AABB 切空白背景** —— 用 alpha 的外接矩形 (bounding box) 把四周的空白边切掉;
 *            若素材是「白底不透明」的旧式图, 会先自动识别并把白底抠成透明再切;
 *         ② **量出真实宽高比** —— 裁边后的 宽/高 才是叶片卡片该用的比例, 写进
 *            src/core/leafCardAspects.generated.js 供 leafCards.generated.js 反查。
 *
 * 输入 / 输出:
 *   - 输入: BATCHES 里登记的外部目录 (src) + 该批的入库 id/dir/prefix/中文名
 *   - 输出: public/leaves/<dir>/<prefix>_r<行>_c<列>.png  (两位补零, 与既有批次同名规则)
 *           src/core/leafCardAspects.generated.js         (只有本脚本产出的批次才在表里)
 *
 * 与其他模块的关系:
 *   - leafCards.generated.js 的 LEAF_CARD_SETS 是**手写**的批次表 (行/列/名字),
 *     本脚本会把「量出来的行数列数」打印成可直接粘贴的条目, 避免手数格子出错;
 *   - leafCardAspects.generated.js 是**本脚本生成**的数据文件, 运行时按批次 id 查表;
 *   - 未在表里的老批次仍走 leafCards.generated.js 里的 0.72 估值 —— 刻意不覆盖,
 *     免得改了老批次的外观 (新批次素材比例差异大, 必须用真值)。
 *
 * 关键约定 (与既有素材库保持一致):
 *   - 透明区域保留 RGB=0 (黑底透明)。全库都是这个约定, 混合会造成边缘/ mipmap 视觉不一致;
 *   - 行列号取「该批真实存在的最大行列」, 中间空号不补文件 —— 卡片库是路径枚举式,
 *     空号自动跳过 (UI 缩略图 @error 隐藏, 应用时 404 回退);
 *   - 已经紧贴边界的图 (内容触到四条边) 会被判定为「无需裁切」, 原字节直出, 不做无意义的重新编码。
 *
 * 用法:
 *   node scripts/prepare-leaf-cards.mjs              # 正式入库
 *   node scripts/prepare-leaf-cards.mjs --dry        # 只体检, 不写任何文件
 *   node scripts/prepare-leaf-cards.mjs --verbose    # 逐张打印裁切与宽高比
 *   node scripts/prepare-leaf-cards.mjs --only=v4_batch2_catkin
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const OUT_ROOT = path.join(ROOT, 'public', 'leaves')

/* ---------------- ① 批次登记表 (要上新素材只需在这里加一项) ---------------- */

/**
 * 每项字段:
 *   - id     批次键 (同时是卡片 id 前缀 `<id>-r01-c01`, 必须全局唯一, 且与 leafCards.generated.js 一致)
 *   - dir    public/leaves/ 下的子目录名 (本脚本会创建)
 *   - prefix 目标文件名前缀, 产物是 `<prefix>_r01_c01.png`
 *   - src    源目录 (外部素材位置, 只读)
 *   - name   UI 下拉里显示的中文名
 *   - expectRows/expectCols (可选) 断言: 与实测不一致时报警, 防止素材漏传/命名错
 */
const BATCHES = [
  {
    id: 'v4_batch4_leafB',
    dir: 'v4_batch4_leafB',
    prefix: 'leafB',
    src: 'C:/Users/huanh/Downloads/v4_batch4_leafB',
    name: '⑪ 柳叶 B',
  },
  {
    id: 'v4_batch2_catkin',
    dir: 'v4_batch2_catkin',
    prefix: 'catkin',
    src: 'C:/Users/huanh/Downloads/v4_batch2_catkin',
    name: '⑫ 柳絮',
  },
  {
    id: 'v4_batch1_plume',
    dir: 'v4_batch1_plume',
    prefix: 'plume',
    src: 'C:/Users/huanh/Downloads/v4_batch1_plume',
    name: '⑬ 柳花穗',
  },
  // ---- v5 灌木素材 (枝叶簇 / 单片阔叶) ----
  {
    id: 'v5_batch1_plant1',
    dir: 'v5_batch1_plant1',
    prefix: 'plant1',
    src: 'C:/Users/huanh/Downloads/v5_batch1_plant1',
    name: '⑭ 灌木枝叶',
  },
  {
    id: 'v5_batch2_plant2',
    dir: 'v5_batch2_plant2',
    prefix: 'plant2',
    src: 'C:/Users/huanh/Downloads/v5_batch2_plant2',
    name: '⑮ 灌木叶',
  },
  // ---- v7 松针素材 (成簇针叶小枝) ----
  {
    id: 'v7_batch3_pine1',
    dir: 'v7_batch3_pine1',
    prefix: 'pine1',
    src: 'C:/Users/huanh/Downloads/v7_batch3_pine1',
    name: '⑯ 松针 A',
  },
  {
    id: 'v7_batch4_pine2',
    dir: 'v7_batch4_pine2',
    prefix: 'pine2',
    src: 'C:/Users/huanh/Downloads/v7_batch4_pine2',
    name: '⑰ 松针 B',
  },
]

/* ---------------- ② CLI 参数 ---------------- */

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const VERBOSE = argv.includes('--verbose')
const onlyArg = argv.find((a) => a.startsWith('--only='))
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null

const pad2 = (n) => (n < 10 ? '0' + n : String(n))
const SRC_RE = /^([A-Za-z0-9]+)_r(\d+)_c(\d+)\.png$/i

/* ---------------- ③ 图像处理核心: AABB 切边 + 白底抠图 ---------------- */

/**
 * 从四条边向内收, 找到 alpha 非零的外接矩形。
 * 只裁「整行/整列全透明」的部分, 不做任何猜测 —— 这样即使叶片是斜放的长椭圆
 * (它的外接矩形本来就贴满四边) 也不会被误裁掉叶尖。
 * @returns {{left:number,top:number,width:number,height:number,trimmed:number}}
 */
function alphaAABB(data, w, h) {
  const A = (x, y) => data[(y * w + x) * 4 + 3]
  let top = 0, bottom = h - 1, left = 0, right = w - 1
  const rowClear = (y) => {
    for (let x = 0; x < w; x++) if (A(x, y) !== 0) return false
    return true
  }
  const colClear = (x) => {
    for (let y = 0; y < h; y++) if (A(x, y) !== 0) return false
    return true
  }
  while (top <= bottom && rowClear(top)) top++
  while (bottom >= top && rowClear(bottom)) bottom--
  while (left <= right && colClear(left)) left++
  while (right >= left && colClear(right)) right--
  // 整张图全透明: 不裁 (裁成 0x0 会让下游除零)
  if (top > bottom || left > right) return { left: 0, top: 0, width: w, height: h, trimmed: 0 }
  const trimmed = top + (h - 1 - bottom) + left + (w - 1 - right)
  return { left, top, width: right - left + 1, height: bottom - top + 1, trimmed }
}

/**
 * 白底抠图 (仅在「边框是同一片不透明浅色」时启用)。
 *
 * 为什么需要它: AABB 只能切「透明」的空白。若素材是白底不透明的 PNG,
 * 外接矩形就是整张图, 切了等于没切 —— 这种图要先按颜色把底抠成透明。
 *
 * 判据刻意保守 (宁可抠不动, 也不要吃掉浅色叶片):
 *   边框一圈 ≥95% 像素不透明, 且它们的 RGB 与出现最多的那个颜色逐通道差 ≤12。
 * 命中后用 4 邻域漫水填充从边框往里扩, 只把「与底色同色 + 仍不透明」的连通区域置透明,
 * 于是叶片内部的白色高光 (被非底色像素围住) 不会被一起抠掉。
 *
 * @returns {{hit:boolean, color?:number[], keyedPixels?:number}}
 */
function keyFlatBackground(data, w, h) {
  const px = (x, y) => {
    const i = (y * w + x) * 4
    return [data[i], data[i + 1], data[i + 2], data[i + 3]]
  }
  // 取边框一圈
  const ring = []
  for (let x = 0; x < w; x++) { ring.push([x, 0]); ring.push([x, h - 1]) }
  for (let y = 1; y < h - 1; y++) { ring.push([0, y]); ring.push([w - 1, y]) }
  let opaqueRing = 0
  const tally = new Map()
  for (const [x, y] of ring) {
    const [r, g, b, a] = px(x, y)
    if (a < 250) continue
    opaqueRing++
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3) // 5bit/通道量化, 用来数众数
    const cur = tally.get(k) || { n: 0, r: 0, g: 0, b: 0 }
    cur.n++; cur.r += r; cur.g += g; cur.b += b
    tally.set(k, cur)
  }
  if (!ring.length || opaqueRing / ring.length < 0.95) return { hit: false }
  let best = null
  for (const v of tally.values()) if (!best || v.n > best.n) best = v
  const bg = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)]
  // 只认浅色底 (白/近白/浅灰)。深色底可能是插画本身, 交给人工判断
  if (Math.min(...bg) < 200) return { hit: false }
  const tol = 12
  const isBg = (x, y) => {
    const [r, g, b, a] = px(x, y)
    return a >= 250 && Math.abs(r - bg[0]) <= tol && Math.abs(g - bg[1]) <= tol && Math.abs(b - bg[2]) <= tol
  }
  // 漫水填充 (显式栈, 避免递归爆栈)
  const stack = []
  for (const [x, y] of ring) if (isBg(x, y)) stack.push([x, y])
  let keyed = 0
  const seen = new Uint8Array(w * h)
  while (stack.length) {
    const [x, y] = stack.pop()
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const k = y * w + x
    if (seen[k]) continue
    seen[k] = 1
    if (!isBg(x, y)) continue
    data[k * 4 + 3] = 0
    data[k * 4] = 0; data[k * 4 + 1] = 0; data[k * 4 + 2] = 0 // 与全库约定一致: 透明处 RGB=0
    keyed++
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }
  return keyed > 0 ? { hit: true, color: bg, keyedPixels: keyed } : { hit: false }
}

/* ---------------- ④ 单批处理 ---------------- */

async function processBatch(batch) {
  const label = batch.id
  if (!fs.existsSync(batch.src)) {
    console.error(`[${label}] 源目录不存在: ${batch.src}`)
    return null
  }
  const files = fs.readdirSync(batch.src).filter((f) => f.toLowerCase().endsWith('.png')).sort()
  if (!files.length) {
    console.error(`[${label}] 源目录里没有 PNG`)
    return null
  }
  const outDir = path.join(OUT_ROOT, batch.dir)
  if (!DRY) fs.mkdirSync(outDir, { recursive: true })

  const seen = new Map() // "r-c" -> aspect
  const nameBad = []
  let maxRow = 0, maxCol = 0
  let trimmedFiles = 0, trimmedPx = 0, keyedFiles = 0, rewritten = 0, copiedAsIs = 0

  for (const f of files) {
    const m = f.match(SRC_RE)
    if (!m) { nameBad.push(f); continue }
    const r = +m[2]
    const c = +m[3]
    const srcPath = path.join(batch.src, f)
    const orig = fs.readFileSync(srcPath)

    // 解码成 RGBA 原始像素 (ensureAlpha: 万一源图是 RGB 白底图, 也能统一走 alpha 逻辑)
    const { data, info } = await sharp(orig).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const w = info.width
    const h = info.height
    let changed = false

    // ① 白底抠图 (只在边框是浅色不透明时触发)
    const keyed = keyFlatBackground(data, w, h)
    if (keyed.hit) {
      keyedFiles++
      changed = true
      if (VERBOSE) console.log(`    ${f}: 白底抠除 rgb(${keyed.color.join(',')}) ${keyed.keyedPixels}px`)
    }

    // ② alpha 外接矩形切边
    const box = alphaAABB(data, w, h)
    if (box.trimmed > 0) {
      trimmedFiles++
      trimmedPx += box.trimmed
      changed = true
    }

    // 产物: 无任何改动时原字节直出 (保留作者原始编码, 也避免 217 个文件无谓重新编码)
    let outBuf
    if (!changed) {
      outBuf = orig
      copiedAsIs++
    } else {
      let pipe = sharp(data, { raw: { width: w, height: h, channels: 4 } })
      if (box.width !== w || box.height !== h) {
        pipe = pipe.extract({ left: box.left, top: box.top, width: box.width, height: box.height })
      }
      // withMetadata: 保住原图 ICC/密度等元信息, 避免重编码后颜色被当成 sRGB 之外的东西解释
      outBuf = await pipe.withMetadata().png({ compressionLevel: 9 }).toBuffer()
      rewritten++
    }

    const outName = `${batch.prefix}_r${pad2(r)}_c${pad2(c)}.png`
    const outPath = path.join(outDir, outName)
    if (!DRY) {
      // 内容一致就不落盘, 保持 mtime 稳定 (git 也不会产生假改动)
      const same = fs.existsSync(outPath) && fs.readFileSync(outPath).equals(outBuf)
      if (!same) fs.writeFileSync(outPath, outBuf)
    }

    seen.set(`${r}-${c}`, { aspect: +(box.width / box.height).toFixed(3), w: box.width, h: box.height, name: outName })
    if (r > maxRow) maxRow = r
    if (c > maxCol) maxCol = c
    if (VERBOSE) console.log(`    ${f} ${w}x${h} -> ${outName} ${box.width}x${box.height} aspect=${(box.width / box.height).toFixed(3)}`)
  }

  if (nameBad.length) {
    console.warn(`[${label}] 跳过命名不符合 <prefix>_rXX_cYY.png 的文件 ${nameBad.length} 个: ${nameBad.slice(0, 5).join(', ')}`)
  }
  if (batch.expectRows && batch.expectRows !== maxRow) console.warn(`[${label}] 行数实测 ${maxRow} ≠ 声明 ${batch.expectRows}`)
  if (batch.expectCols && batch.expectCols !== maxCol) console.warn(`[${label}] 列数实测 ${maxCol} ≠ 声明 ${batch.expectCols}`)

  // 空号统计: 卡片库是路径枚举, 空号不影响功能, 但值得让维护者看见
  const slots = maxRow * maxCol
  const filled = seen.size

  console.log(
    `[${label}] ${filled}/${slots} 张 (${maxRow} 行 × ${maxCol} 列) | 切边 ${trimmedFiles} 张/${trimmedPx}px | 抠白底 ${keyedFiles} 张 | 原样 ${copiedAsIs} / 重编码 ${rewritten}${DRY ? ' | DRY-RUN 未写盘' : ''}`,
  )

  return { batch, maxRow, maxCol, seen, filled, slots, trimmedFiles, trimmedPx, keyedFiles }
}

/* ---------------- ⑤ 生成宽高比数据模块 ---------------- */

function emitAspectsModule(results) {
  const lines = []
  lines.push('/**')
  lines.push(' * 叶片卡片实测宽高比表 (本文件由 scripts/prepare-leaf-cards.mjs 生成, 请勿手改)')
  lines.push(' * ------------------------------------------------------------')
  lines.push(' * 作用: 记录每个批次里「每张卡片裁边后的 宽/高」, 供 leafCards.generated.js 展开卡片时反查。')
  lines.push(' * 输入 / 输出: 无输入; 导出 LEAF_CARD_ASPECTS: { [批次 id]: number[][] }')
  lines.push(' *   外层下标 = 行号-1, 内层下标 = 列号-1, 空号位为 null。')
  lines.push(' *')
  lines.push(' * 为什么要真值: 卡片库早期用 0.72 这一个通用估值 (那时只有桦树两批, 实测均值 ≈0.69),')
  lines.push(' *   但「宽高比」决定了卡片四边形在树上的长宽 —— 柳絮实测 1.6~4.2、柳叶 0.63~1.5,')
  lines.push(' *   继续用 0.72 会把柳絮压成竖条。老批次刻意**不**进本表, 以保持既有外观不变。')
  lines.push(' *')
  lines.push(' * 与生成脚本的关系: 表里的数值 = alpha 外接矩形裁边后的 宽/高 (保留 3 位小数);')
  lines.push(' *   素材重做/补图后重跑 `npm run leaf-cards` 即可刷新。')
  lines.push(' */')
  lines.push('export const LEAF_CARD_ASPECTS = {')
  for (const r of results) {
    const { batch, maxRow, maxCol, seen } = r
    lines.push(`  // ${batch.name} — ${maxRow} 行 × ${maxCol} 列, 有图 ${r.filled}/${r.slots}`)
    lines.push(`  ${JSON.stringify(batch.id)}: [`)
    for (let row = 1; row <= maxRow; row++) {
      const cells = []
      for (let col = 1; col <= maxCol; col++) {
        const hit = seen.get(`${row}-${col}`)
        cells.push(hit ? String(hit.aspect) : 'null')
      }
      lines.push(`    [${cells.join(', ')}], // r${pad2(row)}`)
    }
    lines.push('  ],')
  }
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

/* ---------------- ⑥ 主流程 ---------------- */

const list = ONLY ? BATCHES.filter((b) => ONLY.includes(b.id)) : BATCHES
if (!list.length) {
  console.error(`--only 没有匹配到任何批次; 可用: ${BATCHES.map((b) => b.id).join(', ')}`)
  process.exit(1)
}

const results = []
for (const b of list) {
  const r = await processBatch(b)
  if (r) results.push(r)
}
if (!results.length) {
  console.error('没有任何批次被处理')
  process.exit(1)
}

// 宽高比模块: 只在使用默认批次表 (不带 --only) 时整份重写, 避免 --only 把别的批次冲掉
const aspectsPath = path.join(ROOT, 'src', 'core', 'leafCardAspects.generated.js')
if (!ONLY) {
  const text = emitAspectsModule(results)
  if (!DRY) fs.writeFileSync(aspectsPath, text)
  console.log(`\n${DRY ? '[dry] 将写入' : '已写入'} ${path.relative(ROOT, aspectsPath)} (${results.length} 个批次)`)
} else {
  console.log('\n--only 模式: 不重写宽高比数据模块 (避免其它批次被清掉)')
}

// 打印可直接粘进 leafCards.generated.js 的批次条目
console.log('\n可直接粘贴进 src/core/leafCards.generated.js 的 LEAF_CARD_SETS 条目:')
for (const r of results) {
  const { batch, maxRow, maxCol } = r
  console.log(
    `  { id: '${batch.id}', dir: '${batch.dir}', prefix: '${batch.prefix}', rows: ${maxRow}, cols: ${maxCol}, name: '${batch.name}' },`,
  )
}

let totals = { files: 0, trimmed: 0, keyed: 0 }
for (const r of results) {
  totals.files += r.filled
  totals.trimmed += r.trimmedFiles
  totals.keyed += r.keyedFiles
}
console.log(`\n合计入库 ${totals.files} 张; AABB 切边生效 ${totals.trimmed} 张; 白底抠图生效 ${totals.keyed} 张`)
