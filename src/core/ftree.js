/**
 * .ftree 自定义树工程文件 (压缩格式)
 * ------------------------------------------------------------
 * .ftree = ZIP 压缩包, 内含:
 *   - tree.json   : 主数据文件 {format, version, seed, params, textureRefs}
 *   - textures/   : 用户上传的外部贴图 (PNG/JPG/WebP), 只在 params 里有 dataURL 时打包
 *
 * 与现有的"参数 JSON"导出的区别:
 *   - JSON 把贴图内联为 base64 dataURL, 体积大、不可读;
 *   - .ftree 把贴图抽成独立二进制文件放在 textures/ 目录, JSON 里只留引用路径,
 *     整个包再用 DEFLATE 压缩一遍 —— 体积通常只有 JSON 的 1/4 ~ 1/3, 且贴图可单独查看。
 *
 * 导入时: 解压 -> 读 tree.json -> 按 textureRefs 把贴图二进制转回 dataURL 填回 params
 *         -> 走 normalizeParams 补齐字段 -> 应用到 state。
 *
 * 本模块只依赖 fflate (ZIP) 和浏览器的 FileReader/btoa/atob, 不依赖 three / 场景。
 * 纯数据操作, 可被 ExportPanel 与脚本层复用。
 */
import { zipSync, unzipSync } from 'fflate'
import { normalizeParams } from './params.js'
import { downloadBlob } from './exporter.js'

/**
 * 所有"可能存放用户上传贴图 (dataURL)"的参数路径。
 * 导出时扫描这些路径, 非空且以 data: 开头就抽出去存成独立文件。
 * 导入时按同样的映射回填。
 */
export const TEXTURE_PATHS = [
  'bark.texture',
  'bark.normalTexture',
  'flower.texture',
  'leafMat.texture',
  'leafMat.normalTexture',
  'leafMat.backTexture',
]

/** 点路径读写工具: 'bark.texture' -> params.bark.texture */
function getAt(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}
function setAt(obj, path, value) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

/**
 * 把 dataURL 拆成 {mime, ext, base64}。
 * 支持 image/png | image/jpeg | image/webp 三种常见格式。
 * @param {string} dataUrl
 * @returns {{mime: string, ext: string, base64: string} | null}
 */
export function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null
  const m = dataUrl.match(/^data:([a-zA-Z0-9.+\/-]+);base64,(.*)$/)
  if (!m) return null
  const mime = m[1]
  const ext = mime === 'image/png' ? 'png'
    : mime === 'image/jpeg' ? 'jpg'
      : mime === 'image/webp' ? 'webp'
        : mime.split('/').pop() || 'bin'
  return { mime, ext, base64: m[2] }
}

/** base64 -> Uint8Array (用 atob + Uint8Array, 兼容所有现代浏览器) */
function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Uint8Array -> base64 字符串 */
function bytesToBase64(bytes) {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/**
 * 从 params 中抽取所有外部贴图, 生成 {files, textureRefs}。
 * params 里的 dataURL 会被替换为空串 (导出文件只保留引用)。
 *
 * @param {object} params 完整参数对象 (会被就地修改: 贴图字段置空)
 * @returns {{files: Object<string, Uint8Array>, textureRefs: Object<string, string>}}
 *   files: { 'textures/bark_texture.png': Uint8Array }
 *   textureRefs: { 'bark.texture': 'textures/bark_texture.png' }
 */
export function extractTextures(params) {
  const files = {}
  const textureRefs = {}
  for (const path of TEXTURE_PATHS) {
    const val = getAt(params, path)
    const parsed = parseDataUrl(val)
    if (!parsed) continue
    const safeName = path.replace(/\./g, '_') // bark.texture -> bark_texture
    const archivePath = `textures/${safeName}.${parsed.ext}`
    files[archivePath] = base64ToBytes(parsed.base64)
    textureRefs[path] = archivePath
    setAt(params, path, '')
  }
  return { files, textureRefs }
}

/**
 * 把归档中的贴图文件转回 dataURL, 回填到 params 对应路径。
 * @param {object} params  参数对象 (就地修改)
 * @param {Object<string, Uint8Array>} files 解压后的全部文件 (key = 归档内路径)
 * @param {Object<string, string>} textureRefs {paramPath: archivePath}
 */
export function injectTextures(params, files, textureRefs) {
  if (!textureRefs || !files) return
  for (const [paramPath, archivePath] of Object.entries(textureRefs)) {
    const bytes = files[archivePath] || files[archivePath.replace(/^textures\//, '')]
    if (!bytes) continue
    const ext = archivePath.split('.').pop().toLowerCase()
    const mime = ext === 'png' ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
          : 'application/octet-stream'
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`
    setAt(params, paramPath, dataUrl)
  }
}

/**
 * 把当前参数打包成 .ftree 二进制 (Uint8Array)。
 *
 * @param {object} params state.params 快照
 * @returns {{bytes: Uint8Array, textureCount: number}} bytes 可直接转 Blob 下载
 */
export function buildFtree(params) {
  // 深拷贝一份, 避免改到 state 里的真实参数
  const copy = JSON.parse(JSON.stringify(params))
  const { files, textureRefs } = extractTextures(copy)
  const payload = {
    format: 'fast-tree/ftree',
    version: 1,
    seed: copy.seed,
    params: copy,
    textureRefs,
  }
  const jsonText = JSON.stringify(payload, null, 2)
  const jsonBytes = new TextEncoder().encode(jsonText)
  const zipFiles = { 'tree.json': jsonBytes, ...files }
  const bytes = zipSync(zipFiles, { level: 6 })
  return { bytes, textureCount: Object.keys(textureRefs).length }
}

/**
 * 导出 .ftree 并触发浏览器下载。
 * @param {object} params state.params 快照
 * @param {string} [filename] 文件名 (默认 fasttree-<seed>.ftree)
 * @returns {{bytes: Uint8Array, textureCount: number, filename: string}}
 */
export function exportFtree(params, filename) {
  const { bytes, textureCount } = buildFtree(params)
  const name = filename || `fasttree-${params.seed}.ftree`
  downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), name)
  return { bytes, textureCount, filename: name }
}

/**
 * 解析 .ftree 二进制, 返回还原后的 params (已带贴图 dataURL) 与元信息。
 * 不直接写 state, 由调用方决定何时应用 (配合 importParamsFtree 的 normalize)。
 *
 * @param {ArrayBuffer|Uint8Array|Blob} file 压缩包内容
 * @returns {Promise<{params: object, seed: number, textureCount: number}>}
 */
export async function parseFtree(file) {
  // 三种输入: Blob/File(下载导入) / ArrayBuffer / Uint8Array(模板库从 IndexedDB 读出的字节)
  let bytes
  if (file instanceof Blob) bytes = new Uint8Array(await file.arrayBuffer())
  else if (file instanceof Uint8Array) bytes = file
  else if (file instanceof ArrayBuffer) bytes = new Uint8Array(file)
  else if (ArrayBuffer.isView(file)) bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength)
  else throw new Error('无效的 .ftree 输入类型')
  const unzipped = unzipSync(bytes)
  // 把 Uint8Array 转成可查找的 map, key 兼容带不带 textures/ 前缀
  const files = {}
  for (const [k, v] of Object.entries(unzipped)) files[k] = v
  const jsonBytes = files['tree.json']
  if (!jsonBytes) throw new Error('无效的 .ftree 文件: 缺少 tree.json')
  const text = new TextDecoder().decode(jsonBytes)
  const data = JSON.parse(text)
  if (data.format !== 'fast-tree/ftree') throw new Error('格式不匹配: 不是 fast-tree/ftree')
  const params = data.params || {}
  injectTextures(params, files, data.textureRefs)
  const seed = data.seed
  return { params, seed, textureCount: Object.keys(data.textureRefs || {}).length }
}

/**
 * 读取 File 对象并解析为 .ftree, 返回已 normalize 的 params。
 * @param {File} file
 * @returns {Promise<{params: object, seed: number, textureCount: number}>}
 */
export async function loadFtreeFile(file) {
  const { params, seed, textureCount } = await parseFtree(file)
  const normalized = normalizeParams(params)
  if (seed != null) normalized.seed = seed
  return { params: normalized, seed, textureCount }
}
