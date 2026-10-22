/**
 * 导出前预览数据构建:
 *  - GLB: 真实生成 blob (不下载), 解析出节点列表与内嵌贴图预览
 *  - OBJ: 生成文本 (不下载), 列出 mesh 节点
 *  - PNG: 视口截图 dataURL
 *  - JSON: 由调用方构建 (参数文本)
 *
 * 作用: 给"导出面板"提供一份**统一的预览描述结构** —— 面板据此显示文件名/体积/节点数/
 *       贴图缩略图, 并在用户点"确认"时直接把 `payload` 交给下载逻辑, 不再重复序列化一遍。
 * 输入 / 输出:
 *   - 输入: 导出组 (Bark/Leaves/Flowers) + 文件名 (+ 截图时的 dataURL 与分辨率);
 *   - 输出: `{kind, title, filename, artifacts, nodes, payload, objectUrls}`。
 * 与其他模块的关系:
 *   - 上游: `core/exporter.js` (真正生成 GLB/OBJ 的序列化都在那里);
 *   - 下游: ExportPanel.vue 的预览列表; `payload` 决定"确认导出"时写文件的方式。
 * 关键约定:
 *   - `artifacts[0]` 永远是**主文件**本身, 后面才是内嵌/附带的贴图, UI 依赖这个顺序;
 *   - `payload.type` 三态: `'blob'`(GLB) / `'text'`(OBJ) / `'dataUrl'`(PNG),
 *     下载侧按这个字段分流, 不要靠 `kind` 猜;
 *   - **`objectUrls` 的所有权在调用方**: 这里为每张内嵌贴图创建了 objectURL,
 *     预览面板销毁/重建时必须逐个 `URL.revokeObjectURL()`, 否则每预览一次就漏一批内存;
 *   - `size` 一律是字节数 (number), 格式化交给 `formatFileSize`。
 * 注意: `buildGLBPreview` 会真的跑一遍 GLB 导出 (含材质临时改写与恢复), 属于**重操作** ——
 *       UI 侧应放在用户主动点击预览时触发, 不要放进响应式 watch。
 */
import { exportGLB, exportOBJ } from './exporter.js'

/**
 * 把字节数格式化成人类可读的字符串。
 * 进制用 1024 (与文件管理器的 KB/MB 一致, 而不是 SI 的 1000)。
 * @param {number} bytes 字节数; 非数值/undefined 按 0 处理
 * @returns {string} 形如 `512 B` / `12.3 KB` / `4.56 MB`
 */
export function formatFileSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return n + ' B'
  // KB 保留 1 位小数, MB 保留 2 位: 体积越大越不需要精细位数, 但需要更多量级精度
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
}

/**
 * 数几何体的三角面数。
 * 索引几何用 `index.count / 3`; 非索引几何退化为 `position.count / 3`。
 * @param {import('three').BufferGeometry|null|undefined} geometry
 * @returns {number} 三角形个数 (可能是小数: 非索引几何顶点数不是 3 的倍数时的残留)
 */
function triangleCount(geometry) {
  if (!geometry) return 0
  return geometry.index ? geometry.index.count / 3 : (geometry.attributes.position ? geometry.attributes.position.count / 3 : 0)
}

/**
 * 数几何体的顶点数 (POSITION 属性长度)。
 * @param {import('three').BufferGeometry|null|undefined} geometry
 * @returns {number} 顶点个数; 几何缺失时 0
 */
function vertexCount(geometry) {
  return geometry && geometry.attributes.position ? geometry.attributes.position.count : 0
}

/**
 * 导出组里的 mesh 节点列表 (预览面板的"文件里有哪些节点"那一栏)。
 * 用 `traverse` 而不是只看直接子级: 导出组可能是嵌套结构 (例如按材质分组的 Group)。
 * @param {import('three').Object3D} group 导出组
 * @returns {Array<{name: string, triangles: number, vertices: number}>}
 *   按遍历顺序 (父在前, 子按添加顺序) 排列; 无名节点显示为 `(未命名)`
 */
export function exportNodeList(group) {
  const out = []
  // 只做结构检查而不 import three: 让本模块可在无 three 的环境里被引用/测试
  if (!group || typeof group.traverse !== 'function') return out
  group.traverse((obj) => {
    if (!obj || !obj.isMesh) return
    out.push({
      name: obj.name || '(未命名)',
      // 面板显示整数面数; 非索引几何的小数残留在这里四舍五入掉
      triangles: Math.round(triangleCount(obj.geometry)),
      vertices: vertexCount(obj.geometry),
    })
  })
  return out
}

/**
 * 读取 GLB 的 JSON chunk + BIN chunk。
 *
 * GLB 容器格式 (小端):
 *   - 12 字节头: magic `'glTF'` (0x46546C67) / version / totalLength;
 *   - 之后是若干 chunk: `[uint32 length][uint32 type][payload]`, payload 按 4 字节对齐。
 *   - type `0x4E4F534A` = `'JSON'`, `0x004E4942` = `'BIN\0'`。
 *
 * 这里只关心 JSON 与 BIN 这两种 chunk, 其它类型直接跳过 (前向兼容),
 * 循环条件 `off + 8 <= total` 保证不会读到 chunk 头之外。
 *
 * @param {ArrayBuffer} buffer 完整 GLB 字节
 * @returns {{json: object, bin: (Uint8Array|null)}} 解析出的 glTF JSON 与二进制块 (可能为 null)
 * @throws {Error} magic 不匹配 / 缺少 JSON chunk 时抛出 (对外是"不是 GLB"这类可读信息)
 */
export function parseGLB(buffer) {
  const dv = new DataView(buffer)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('不是 GLB')
  // 用文件头里的总长度而不是 buffer.byteLength: 允许传入带尾部冗余字节的 buffer
  const total = dv.getUint32(8, true)
  let json = null
  let bin = null
  let off = 12
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    // 零拷贝视图: 直接指向原 buffer 的对应区间
    const data = new Uint8Array(buffer, off + 8, len)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data))
    else if (type === 0x004e4942) bin = data
    off += 8 + len
  }
  if (!json) throw new Error('GLB 缺少 JSON chunk')
  return { json, bin }
}

/**
 * 建立 `图片下标 -> 贴图名` 的查找表。
 *
 * 为什么需要: GLTFExporter 把名字写在 `textures[].name` 上, 而 `images[]` 往往没有 name,
 * 但预览想按语义名 (`leaf_diff_1k.png`) 展示缩略图, 所以从 textures 反查。
 * 只在首次出现时写入 (`!bySource.has`): 多张贴图可能引用同一张图片, 保留第一个名字即可。
 * 注意这里假定 `texture.source` 与 `images[]` 的下标一致 (three 的 GLB 输出满足)。
 *
 * @param {object} json glTF JSON
 * @returns {Map<number, string>} imageSource 下标 -> 贴图名
 */
function imageNameLookup(json) {
  const bySource = new Map()
  for (const t of (json.textures || [])) {
    if (t && t.source !== undefined && t.name && !bySource.has(t.source)) bySource.set(t.source, t.name)
  }
  return bySource
}

/**
 * 按 MIME 给图片挑扩展名 (默认 png)。
 * @param {string} mime 形如 `image/png` / `image/jpeg` / `image/webp`
 * @returns {string} 带点的扩展名
 */
function extForMime(mime) {
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/webp') return '.webp'
  return '.png'
}

/**
 * 从真实 GLB 中提取内嵌图片 -> 可预览 artifact + objectURL
 *
 * 两条路径:
 *   - 图片有 `bufferView` (GLB 内嵌): 从 BIN chunk 里切出字节 -> Blob -> objectURL;
 *   - 只有 `uri` (外部文件或 dataURL): 直接用 uri 当图片地址,
 *     体积按 base64 长度反推 (`(字符数 * 3) / 4`, 已扣掉 `data:...;base64,` 前缀)。
 * 越界保护: `bufferView` 指向的范围必须落在 BIN 内, 否则跳过 (损坏文件不应让预览崩掉)。
 *
 * @param {ArrayBuffer} buffer 原始 GLB (保留给可能的后续扩展; 目前实际只用 json/bin)
 * @param {object} json glTF JSON
 * @param {Uint8Array|null} bin BIN chunk
 * @returns {{artifacts: Array<object>, objectUrls: string[]}}
 *   `artifacts` 每项 `{name, kind:'image', size, detail, imageUrl}`;
 *   `objectUrls` 需要调用方负责 revoke
 */
export function glbImageArtifacts(buffer, json, bin) {
  const artifacts = []
  const objectUrls = []
  if (!bin || !json) return { artifacts, objectUrls }
  const names = imageNameLookup(json)
  const images = json.images || []
  const bufferViews = json.bufferViews || []
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    if (!img) continue
    const mime = img.mimeType || 'image/png'
    // 名字三级兜底: images[].name -> 从 textures 反查 -> `embedded_<i>`
    const baseName = img.name || names.get(i) || ('embedded_' + i)
    if (img.bufferView === undefined) {
      // 外部引用 (uri): 可能是 http 路径, 也可能是 dataURL; 有值才展示
      if (typeof img.uri === 'string' && img.uri) {
        artifacts.push({
          name: baseName + extForMime(mime),
          kind: 'image',
          size: Math.round(Math.max(0, img.uri.length - img.uri.indexOf(',') - 1) * 3 / 4),
          detail: mime,
          imageUrl: img.uri,
        })
      }
      continue
    }
    const bv = bufferViews[img.bufferView]
    if (!bv) continue
    const start = bv.byteOffset || 0
    const end = start + bv.byteLength
    if (end > bin.byteLength) continue
    const bytes = bin.subarray(start, end)
    const blob = new Blob([bytes], { type: mime })
    const url = URL.createObjectURL(blob)
    artifacts.push({
      name: baseName + extForMime(mime),
      kind: 'image',
      size: bytes.byteLength,
      detail: mime,
      imageUrl: url,
    })
    objectUrls.push(url)
  }
  return { artifacts, objectUrls }
}

/**
 * 构建 GLB 预览: 真跑一次导出 (不下载) -> 解析容器 -> 拆出内嵌贴图。
 *
 * 代价说明: 这一步会完整执行 `exportGLB` (含材质临时改写、GLB 序列化、贴图重采样),
 * 在复杂模型上可能耗时数百毫秒, 所以它被刻意设计成 `async` 且在用户主动点预览时调用。
 *
 * @param {import('three').Object3D} root 导出组
 * @param {string} filename 预览里显示/最终下载的文件名
 * @returns {Promise<object>} 预览结构, `payload = {type:'blob', blob, mime}`
 */
export async function buildGLBPreview(root, filename) {
  // 节点列表先算: 它读的是导出组本身, 与 GLB 内容无关, 早算早显示
  const nodes = exportNodeList(root)
  const blob = await exportGLB(root, filename, { download: false })
  const buffer = await blob.arrayBuffer()
  const { json, bin } = parseGLB(buffer)
  const images = glbImageArtifacts(buffer, json, bin)
  // 主文件永远放第一个: 面板用 artifacts[0] 显示"导出文件"那张卡片
  const artifacts = [
    {
      name: filename,
      kind: 'file',
      size: blob.size,
      detail: `glTF 2.0 二进制 · ${nodes.length} 个节点 · ${images.artifacts.length} 张贴图`,
    },
    ...images.artifacts,
  ]
  return {
    kind: 'glb',
    title: 'GLB 导出预览',
    filename,
    artifacts,
    nodes,
    payload: { type: 'blob', blob, mime: 'model/gltf-binary' },
    objectUrls: images.objectUrls,
  }
}

/**
 * 构建 OBJ 预览 (同步: OBJ 序列化不涉及异步贴图处理)。
 * 体积用 `new Blob([text]).size` 真实测量, 而不是 `text.length` ——
 * 后者是 UTF-16 码元数, 与落盘字节数不等 (含非 ASCII 注释/名字时会差)。
 * @param {import('three').Object3D} root 导出组
 * @param {string} filename 文件名
 * @returns {object} 预览结构, `payload = {type:'text', text, mime}`
 */
export function buildOBJPreview(root, filename) {
  const nodes = exportNodeList(root)
  const text = exportOBJ(root, filename, { download: false })
  const size = new Blob([text]).size
  return {
    kind: 'obj',
    title: 'OBJ 导出预览',
    filename,
    artifacts: [{ name: filename, kind: 'file', size, detail: `Wavefront OBJ · ${nodes.length} 个节点 · 纯几何` }],
    nodes,
    payload: { type: 'text', text, mime: 'text/plain' },
    objectUrls: [],
  }
}

/**
 * 构建 PNG 截图预览。
 * dataURL 形如 `data:image/png;base64,<数据>`, 体积按 base64 长度反推字节数;
 * 找不到逗号时给 0 (画布为空/编码失败的情况) 而不是算出一个负数。
 * @param {string} dataUrl 截图的 dataURL (同时用作缩略图地址)
 * @param {string} filename 文件名
 * @param {number} [width] 画布宽度 (像素), 仅用于展示
 * @param {number} [height] 画布高度 (像素), 仅用于展示
 * @returns {object} 预览结构, `payload = {type:'dataUrl', dataUrl}`
 */
export function buildPNGPreview(dataUrl, filename, width, height) {
  const comma = dataUrl.indexOf(',')
  const bytes = comma >= 0 ? Math.round((dataUrl.length - comma - 1) * 3 / 4) : 0
  return {
    kind: 'png',
    title: 'PNG 截图预览',
    filename,
    artifacts: [{
      name: filename,
      kind: 'image',
      size: bytes,
      detail: `PNG · ${width || '?'}×${height || '?'}`,
      imageUrl: dataUrl,
    }],
    nodes: [],
    payload: { type: 'dataUrl', dataUrl },
    objectUrls: [],
  }
}
