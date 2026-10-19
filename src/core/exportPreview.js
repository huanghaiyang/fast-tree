/**
 * 导出前预览数据构建:
 *  - GLB: 真实生成 blob (不下载), 解析出节点列表与内嵌贴图预览
 *  - OBJ: 生成文本 (不下载), 列出 mesh 节点
 *  - PNG: 视口截图 dataURL
 *  - JSON: 由调用方构建 (参数文本)
 */
import { exportGLB, exportOBJ } from './exporter.js'

export function formatFileSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
}

function triangleCount(geometry) {
  if (!geometry) return 0
  return geometry.index ? geometry.index.count / 3 : (geometry.attributes.position ? geometry.attributes.position.count / 3 : 0)
}

function vertexCount(geometry) {
  return geometry && geometry.attributes.position ? geometry.attributes.position.count : 0
}

/** 导出组里的 mesh 节点列表 */
export function exportNodeList(group) {
  const out = []
  if (!group || typeof group.traverse !== 'function') return out
  group.traverse((obj) => {
    if (!obj || !obj.isMesh) return
    out.push({
      name: obj.name || '(未命名)',
      triangles: Math.round(triangleCount(obj.geometry)),
      vertices: vertexCount(obj.geometry),
    })
  })
  return out
}

/** 读取 GLB 的 JSON chunk + BIN chunk */
export function parseGLB(buffer) {
  const dv = new DataView(buffer)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('不是 GLB')
  const total = dv.getUint32(8, true)
  let json = null
  let bin = null
  let off = 12
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    const data = new Uint8Array(buffer, off + 8, len)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data))
    else if (type === 0x004e4942) bin = data
    off += 8 + len
  }
  if (!json) throw new Error('GLB 缺少 JSON chunk')
  return { json, bin }
}

function imageNameLookup(json) {
  const bySource = new Map()
  for (const t of (json.textures || [])) {
    if (t && t.source !== undefined && t.name && !bySource.has(t.source)) bySource.set(t.source, t.name)
  }
  return bySource
}

function extForMime(mime) {
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/webp') return '.webp'
  return '.png'
}

/** 从真实 GLB 中提取内嵌图片 -> 可预览 artifact + objectURL */
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
    const baseName = img.name || names.get(i) || ('embedded_' + i)
    if (img.bufferView === undefined) {
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

export async function buildGLBPreview(root, filename) {
  const nodes = exportNodeList(root)
  const blob = await exportGLB(root, filename, { download: false })
  const buffer = await blob.arrayBuffer()
  const { json, bin } = parseGLB(buffer)
  const images = glbImageArtifacts(buffer, json, bin)
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
