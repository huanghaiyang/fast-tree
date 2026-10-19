/**
 * 贴图导出资源命名:
 *   <材质>_diff[_xk] / <材质>_alpha[_xk] / <材质>_nor_gl[_xk] / <材质>_rough[_xk]
 *
 * 只有贴图尺寸恰好是 1K/2K/4K 时才追加 _1k/_2k/_4k;
 * 其它尺寸 (例如 512、216、非标准 3000) 保持无 _xk 后缀。
 */

import * as THREE from 'three'

const ROLE_SUFFIX = {
  diff: '_diff',
  alpha: '_alpha',
  normal: '_nor_gl',
  rough: '_rough',
}

const SIZE_TO_K = new Map([
  [1024, 1],
  [2048, 2],
  [4096, 4],
])

function imageSize(texture) {
  const img = texture && (texture.image || (texture.source && texture.source.data))
  if (!img) return { width: 0, height: 0 }
  return {
    width: Math.max(0, Number(img.width || img.naturalWidth || img.videoWidth || 0)),
    height: Math.max(0, Number(img.height || img.naturalHeight || img.videoHeight || 0)),
  }
}

/** 贴图的分辨率档位: 1/2/4, 非 1K/2K/4K 返回 0 */
export function textureResolutionK(texture) {
  const { width, height } = imageSize(texture)
  const max = Math.max(width, height)
  return SIZE_TO_K.get(max) || 0
}

function safeBase(base) {
  return String(base || 'texture').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'texture'
}

/** 例: textureAssetName('leaf', 'diff', 4kTexture) -> leaf_diff_4k */
export function textureAssetName(base, role, texture) {
  const suffix = ROLE_SUFFIX[role] || `_${role}`
  const k = textureResolutionK(texture)
  return `${safeBase(base)}${suffix}${k ? `_${k}k` : ''}`
}

/**
 * 给导出组里的标准材质贴图写 name。
 * 返回:
 *   manifest: 所有命名的贴图资源
 *   alphaAliases: 带 alpha 的叶片/花朵贴图 -> 导出的独立 _alpha 资源描述
 *
 * 当前材质把叶形/花形 alpha 放在漫反射图的 RGBA 里, 所以 GLB 里会额外
 * 引用同一图像生成一个 name 为 <kind>_alpha[_xk] 的贴图资源, 便于资源管线按后缀识别。
 */
export function applyExportTextureNames(root) {
  const manifest = []
  const alphaAliases = []
  const seen = new Set()
  if (!root || typeof root.traverse !== 'function') return { manifest, alphaAliases }

  const add = (kind, role, tex) => {
    if (!tex) return null
    const name = textureAssetName(kind, role, tex)
    tex.name = name
    if (!seen.has(name)) {
      seen.add(name)
      const { width, height } = imageSize(tex)
      manifest.push({ name, kind, role, width, height, k: textureResolutionK(tex) })
    }
    return name
  }

  root.traverse((obj) => {
    if (!obj || !obj.isMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      const kind = (m.userData && m.userData.kind) || m.name || 'texture'
      const diffuseName = add(kind, 'diff', m.map)
      add(kind, 'alpha', m.alphaMap)
      add(kind, 'normal', m.normalMap)
      add(kind, 'rough', m.roughnessMap)
      // 叶片/花朵卡片的 alpha 在漫反射图的 alpha 通道里
      if (diffuseName && (kind === 'leaf' || kind === 'flower')) {
        const alphaName = textureAssetName(kind, 'alpha', m.map)
        if (!alphaAliases.some((a) => a.name === alphaName)) {
          alphaAliases.push({ name: alphaName, from: diffuseName })
        }
      }
    }
  })
  return { manifest, alphaAliases }
}

/* ------------------------------------------------------------------ */
/* GLB 内部 image 名称修补                                              */
/* ------------------------------------------------------------------ */

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a

function readGlb(buffer) {
  const dv = new DataView(buffer)
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not GLB')
  const total = dv.getUint32(8, true)
  const chunks = []
  let off = 12
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    const data = new Uint8Array(buffer, off + 8, len)
    chunks.push({ type, data })
    off += 8 + len
  }
  return chunks
}

function writeGlb(chunks) {
  const total = 12 + chunks.reduce((n, c) => n + 8 + c.data.length, 0)
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, GLB_MAGIC, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  let off = 12
  for (const c of chunks) {
    dv.setUint32(off, c.data.length, true)
    dv.setUint32(off + 4, c.type, true)
    out.set(c.data, off + 8)
    off += 8 + c.data.length
  }
  return out.buffer
}

function padJson(bytes) {
  const pad = (4 - (bytes.length % 4)) % 4
  if (!pad) return bytes
  const out = new Uint8Array(bytes.length + pad)
  out.set(bytes)
  out.fill(0x20, bytes.length)
  return out
}

/**
 * GLTFExporter 只把 map.name 写进 textures[].name, images[] 默认没有名字。
 * 这里把 images[].name 补成同一资源名, 并给带 alpha 的叶片/花朵贴图补一个
 * <kind>_alpha[_xk] 的图片/贴图条目 (复用同一 image bufferView, 不复制二进制)。
 */
export function patchGlbTextureNames(buffer, alphaAliases = []) {
  if (!buffer || typeof buffer.byteLength !== 'number') return buffer
  let chunks
  try {
    chunks = readGlb(buffer)
  } catch {
    return buffer
  }
  const jsonIdx = chunks.findIndex((c) => c.type === CHUNK_JSON)
  if (jsonIdx < 0) return buffer
  let json
  try {
    json = JSON.parse(new TextDecoder().decode(chunks[jsonIdx].data))
  } catch {
    return buffer
  }
  if (!Array.isArray(json.textures)) return buffer

  // 1) 已有 textures[].name -> 补 images[].name
  if (Array.isArray(json.images)) {
    for (const t of json.textures) {
      if (!t || !t.name || t.source === undefined) continue
      const img = json.images[t.source]
      if (img && !img.name) img.name = t.name
    }
  }

  // 2) 叶片/花朵的 alpha 资源: 复用 diffuse 的 image / bufferView
  for (const alias of alphaAliases) {
    if (!alias || !alias.name || !alias.from) continue
    if (json.textures.some((t) => t && t.name === alias.name)) continue
    const base = json.textures.find((t) => t && t.name === alias.from)
    if (!base || base.source === undefined) continue
    const src = json.images && json.images[base.source]
    if (!src) continue
    const alphaImg = { ...src, name: alias.name }
    const alphaIdx = json.images.push(alphaImg) - 1
    const alphaTex = { name: alias.name, source: alphaIdx }
    if (base.sampler !== undefined) alphaTex.sampler = base.sampler
    json.textures.push(alphaTex)
  }

  chunks[jsonIdx] = { type: CHUNK_JSON, data: padJson(new TextEncoder().encode(JSON.stringify(json))) }
  return writeGlb(chunks)
}

export const TEXTURE_ROLE_SUFFIX = ROLE_SUFFIX

/* ------------------------------------------------------------------ */
/* 导出材质补全: 没有 normal/rough 贴图时生成中性贴图资源               */
/* ------------------------------------------------------------------ */

function makeCanvasTexture(width, height, paint) {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')
  paint(ctx, width, height)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

/** 平坦法线 (128,128,255,255): 不改变光照, 只补全导出材质槽 */
function makeFlatNormalTexture() {
  return makeCanvasTexture(4, 4, (ctx, w, h) => {
    const img = ctx.createImageData(w, h)
    for (let i = 0; i < w * h; i++) {
      img.data[i * 4] = 128
      img.data[i * 4 + 1] = 128
      img.data[i * 4 + 2] = 255
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  })
}

/** 均匀粗糙度贴图: 与材质标量 roughness 一致 */
function makeRoughnessTexture(value) {
  const v = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255)
  return makeCanvasTexture(4, 4, (ctx, w, h) => {
    const img = ctx.createImageData(w, h)
    for (let i = 0; i < w * h; i++) {
      img.data[i * 4] = v
      img.data[i * 4 + 1] = v
      img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  })
}

/**
 * 导出前临时补全材质槽:
 *  - normalMap 缺失 -> 平坦法线贴图
 *  - roughnessMap 缺失 -> 与材质 roughness 一致的均匀贴图
 * 这样 GLB 中每个材质都会实际引用 nor_gl / rough 资源;
 * 返回 restore(), 导出结束必须调用以恢复源材质并释放临时贴图。
 */
export function ensureExportMaterialMaps(root) {
  const restore = []
  const seen = new Set()
  if (!root || typeof root.traverse !== 'function') return () => {}
  root.traverse((obj) => {
    if (!obj || !obj.isMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m || seen.has(m)) continue
      seen.add(m)
      if (!m.normalMap) {
        const tex = makeFlatNormalTexture()
        if (tex) {
          m.normalMap = tex
          restore.push({ material: m, key: 'normalMap', previous: null, texture: tex })
        }
      }
      if (!m.roughnessMap) {
        const tex = makeRoughnessTexture(m.roughness)
        if (tex) {
          m.roughnessMap = tex
          restore.push({ material: m, key: 'roughnessMap', previous: null, texture: tex })
        }
      }
    }
  })
  return () => {
    for (const r of restore) {
      if (r.material[r.key] === r.texture) r.material[r.key] = r.previous
      else if (r.material[r.key] === null) r.material[r.key] = r.previous
      r.texture.dispose()
    }
  }
}
