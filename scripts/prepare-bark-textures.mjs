/**
 * 树皮贴图入库脚本 (切圆角 + 去留白 + 面板上架)
 * ------------------------------------------------------------
 * 作用: 把一批「外部下载的树皮 PNG」按仓库约定落进 public/bark/<批次>/。
 *       树皮质感图里有两种"不是树皮"的像素, 入库时必须切掉:
 *         ① 四周的透明留白 (源图通常统一留 17px 边);
 *         ② **圆角** —— 图块本身是圆角矩形, 四个角是透明的。树皮要沿树干平铺,
 *            留着圆角就会在拼缝处出现透明缺口/黑角, 所以必须裁成"整块不透明"的矩形。
 *
 * 裁切策略 (为什么不是"四角各切掉半径 R"):
 *   源图的边并不是标准圆弧, 而是带毛边的裂纹板 —— 固定半径公式会在某些图上留残边,
 *   在某些图上又切太多。这里改成**验证式最小内缩**:
 *     从内容外接矩形出发, 四边同时内缩 1px 试一次, 直到「裁切框最外 3px 一圈全部不透明」
 *     为止。这样得到的矩形一定没有透明边(圆角被完全切掉), 且尽量少丢面积
 *     (实测平均只丢 3~6%, 而按半径公式内缩会丢一半以上)。
 *
 * 输入 / 输出:
 *   - 输入: BATCHES 登记的外部目录 (src) + 入库 id/dir/prefix/中文名
 *   - 输出: public/bark/<dir>/<prefix>_r<行>_c<列>.png
 *
 * 与其他模块的关系:
 *   - barkTextures.js 的 BARK_SETS 是唯一手写的批次表; 本脚本把实测出的行/列打印成
 *     可直接粘贴的条目, 省去手数格子;
 *   - 树皮是**可平铺材质**, 不做 UV 裁切也不做 alpha 裁边以外的处理; 平铺次数由
 *     params.bark.uvScaleU/V 控制, 与这里无关。
 *
 * 关键约定 (与既有 bark_batch1..4 保持一致):
 *   - 命名 `<前缀>_r<行>_c<列>.png`, 行列两位补零;
 *   - 行列取「该批真实存在的最大行列」, 中间空号不补文件 (卡片库是路径枚举式);
 *   - 产物仍是 RGBA PNG (裁完 alpha 全 255), 与老批次一致, 不做重采样/不缩放。
 *
 * 用法:
 *   node scripts/prepare-bark-textures.mjs              # 正式入库
 *   node scripts/prepare-bark-textures.mjs --dry        # 只体检
 *   node scripts/prepare-bark-textures.mjs --verbose    # 逐张打印内缩量与尺寸
 *   node scripts/prepare-bark-textures.mjs --only=batch5
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const OUT_ROOT = path.join(ROOT, 'public', 'bark')
/** 裁切框最外几像素必须完全不透明 (3px 足够吸收抗锯齿/毛边) */
const RING = 3

/* ---------------- ① 批次登记表 ---------------- */

/**
 * 每项字段:
 *   - id     批次键 (= BARK_SETS[].id, 同时是贴图 id 前缀 `<id>-r01-c01`)
 *   - dir    public/bark/ 下的子目录名
 *   - prefix 目标文件名前缀, 产物 `<prefix>_r01_c01.png`
 *   - src    源目录 (外部素材, 只读)
 *   - name   UI 批次 tab 上显示的中文名
 *   - srcNote 溯源备注 (写进注释, 方便以后对回下载目录)
 */
const BATCHES = [
  { id: 'batch5', dir: 'bark_batch5', prefix: 'bark5', src: 'C:/Users/huanh/Downloads/v6_batch1_bark1', name: '灌木 褐裂', srcNote: 'v6_batch1_bark1' },
  { id: 'batch6', dir: 'bark_batch6', prefix: 'bark6', src: 'C:/Users/huanh/Downloads/v6_batch2_bark2', name: '灌木 霜裂', srcNote: 'v6_batch2_bark2' },
  { id: 'batch7', dir: 'bark_batch7', prefix: 'bark7', src: 'C:/Users/huanh/Downloads/v7_batch1_bark1', name: '松树 赤裂', srcNote: 'v7_batch1_bark1' },
  { id: 'batch8', dir: 'bark_batch8', prefix: 'bark8', src: 'C:/Users/huanh/Downloads/v7_batch2_bark2', name: '松树 鳞片', srcNote: 'v7_batch2_bark2' },
]

/* ---------------- ② CLI 参数 ---------------- */

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const VERBOSE = argv.includes('--verbose')
const onlyArg = argv.find((a) => a.startsWith('--only='))
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null

const pad2 = (n) => (n < 10 ? '0' + n : String(n))
const SRC_RE = /^([A-Za-z0-9]+)_r(\d+)_c(\d+)\.png$/i

/* ---------------- ③ 裁切核心 ---------------- */

/** 返回内容外接矩形 {x0,y0,x1,y1}; 全透明时返回 null */
function alphaBBox(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/** 裁切框最外 RING 像素的一圈是否全部不透明 (圆角/毛边是否已经被切干净) */
function ringOpaque(data, w, x, y, rw, rh) {
  const A = (px, py) => data[(py * w + px) * 4 + 3]
  for (let k = 0; k < Math.min(RING, rw, rh); k++) {
    const top = y + k
    const bottom = y + rh - 1 - k
    for (let i = 0; i < rw; i++) if (A(x + i, top) === 0 || A(x + i, bottom) === 0) return false
    const left = x + k
    const right = x + rw - 1 - k
    for (let j = 0; j < rh; j++) if (A(left, y + j) === 0 || A(right, y + j) === 0) return false
  }
  return true
}

/**
 * 求「四边等量内缩」的最小值 a, 使 [bbox 内缩 a] 的裁切框边框环完全不透明。
 * 单调性: a 越大越可能满足, 所以线性递增即可 (a 实测个位数, 代价可忽略)。
 * @returns {{a:number, width:number, height:number, holes:number}}
 */
function findCrop(data, w, h) {
  const box = alphaBBox(data, w, h)
  if (!box) return null
  const bw = box.x1 - box.x0 + 1
  const bh = box.y1 - box.y0 + 1
  const limit = Math.floor(Math.min(bw, bh) / 4)
  let a = 0
  while (a <= limit) {
    if (ringOpaque(data, w, box.x0 + a, box.y0 + a, bw - 2 * a, bh - 2 * a)) break
    a++
  }
  const cw = bw - 2 * a
  const ch = bh - 2 * a
  // 统计裁切框内部残留的透明像素 (正常情况下应为 0; 不为 0 说明形状里有洞)
  let holes = 0
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) if (data[((box.y0 + a + y) * w + (box.x0 + a + x)) * 4 + 3] === 0) holes++
  }
  return { a, x: box.x0 + a, y: box.y0 + a, width: cw, height: ch, holes, trimmedMargin: a }
}

/* ---------------- ④ 单批处理 ---------------- */

async function processBatch(batch) {
  if (!fs.existsSync(batch.src)) {
    console.error(`[${batch.id}] 源目录不存在: ${batch.src}`)
    return null
  }
  const files = fs.readdirSync(batch.src).filter((f) => f.toLowerCase().endsWith('.png')).sort()
  if (!files.length) {
    console.error(`[${batch.id}] 源目录里没有 PNG`)
    return null
  }
  const outDir = path.join(OUT_ROOT, batch.dir)
  if (!DRY) fs.mkdirSync(outDir, { recursive: true })

  let maxRow = 0, maxCol = 0, filled = 0, rewritten = 0
  const insets = []
  const nameBad = []
  let holesTotal = 0

  for (const f of files) {
    const m = f.match(SRC_RE)
    if (!m) { nameBad.push(f); continue }
    const r = +m[2]
    const c = +m[3]
    const srcPath = path.join(batch.src, f)
    const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const w = info.width
    const h = info.height
    const crop = findCrop(data, w, h)
    if (!crop) { console.warn(`  ${f}: 整图透明, 跳过`); continue }
    insets.push(crop.a)
    holesTotal += crop.holes

    const outBuf = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .withMetadata()
      .png({ compressionLevel: 9 })
      .toBuffer()

    const outName = `${batch.prefix}_r${pad2(r)}_c${pad2(c)}.png`
    const outPath = path.join(outDir, outName)
    if (!DRY) {
      const same = fs.existsSync(outPath) && fs.readFileSync(outPath).equals(outBuf)
      if (!same) { fs.writeFileSync(outPath, outBuf); rewritten++ }
    }
    if (r > maxRow) maxRow = r
    if (c > maxCol) maxCol = c
    filled++
    if (VERBOSE) console.log(`  ${f} ${w}x${h} -> ${outName} ${crop.width}x${crop.height} (内缩 ${crop.a}px)`)
  }

  if (nameBad.length) console.warn(`[${batch.id}] 命名不符合 <前缀>_rXX_cYY.png, 跳过 ${nameBad.length} 个`)
  insets.sort((x, y) => x - y)
  const detail = insets.length
    ? `内缩量 min=${insets[0]} p50=${insets[insets.length >> 1]} max=${insets[insets.length - 1]}`
    : '无有效图'
  console.log(
    `[${batch.id}] ${filled}/${maxRow * maxCol} 张 (${maxRow} 行 × ${maxCol} 列) | ${detail} | 残留透明px=${holesTotal}${DRY ? ' | DRY-RUN 未写盘' : ` | 写入 ${rewritten}`}`,
  )
  if (holesTotal > 0) console.warn(`[${batch.id}] 有 ${holesTotal} 个透明像素落在裁切框内部 (形态有洞, 拼缝不受影响)`)
  return { batch, maxRow, maxCol, filled }
}

/* ---------------- ⑤ 主流程 ---------------- */

const list = ONLY ? BATCHES.filter((b) => ONLY.includes(b.id)) : BATCHES
if (!list.length) {
  console.error(`--only 没有匹配到批次; 可用: ${BATCHES.map((b) => b.id).join(', ')}`)
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

console.log('\n可直接粘贴进 src/core/barkTextures.js 的 BARK_SETS 条目:')
for (const r of results) {
  const { batch, maxRow, maxCol } = r
  console.log(`  { id: '${batch.id}', dir: '${batch.dir}', prefix: '${batch.prefix}', rows: ${maxRow}, cols: ${maxCol}, name: '${batch.name}' }, // 源: ${batch.srcNote}`)
}
const total = results.reduce((a, r) => a + r.filled, 0)
console.log(`\n合计入库 ${total} 张, 批次 ${results.length} 个`)
