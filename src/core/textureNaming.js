/**
 * 贴图导出资源命名:
 *   <材质>_diff[_xk] / <材质>_alpha[_xk] / <材质>_nor_gl[_xk] / <材质>_rough[_xk]
 *
 * 只有贴图尺寸恰好是 1K/2K/4K 时才追加 _1k/_2k/_4k;
 * 其它尺寸 (例如 512、216、非标准 3000) 保持无 _xk 后缀。
 */

import * as THREE from 'three'
import { normalFromLuminance } from './normalFromAlbedo.js'

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

function drawTextureToCanvas(texture, width, height) {
  if (typeof document === 'undefined' || !texture || !texture.image) return null
  const img = texture.image
  const w = Math.max(1, Math.round(width || img.width || img.naturalWidth || 0))
  const h = Math.max(1, Math.round(height || img.height || img.naturalHeight || 0))
  if (!w || !h) return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  try {
    ctx.drawImage(img, 0, 0, w, h)
    // 触发一次读取, 跨域/未解码时直接进入 catch
    ctx.getImageData(0, 0, 1, 1)
  } catch {
    return null
  }
  return { canvas: c, ctx, width: w, height: h }
}

/**
 * 从 RGBA 像素生成全尺寸法线纹理 (Sobel)
 * @param {boolean} [textureFlipY] 生成结果的 flipY: 必须和配套的 diffuse 一致,
 *        否则法线图与颜色图会上下镜像 (导出后也是镜像的)
 */
export function makeNormalTextureFromPixels(pixels, width, height, strength = 1, textureFlipY = true) {
  if (typeof document === 'undefined' || !pixels) return null
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const flipY = textureFlipY !== false
  const rgb = normalFromLuminance(pixels, w, h, strength, flipY)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  const out = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    out.data[i * 4] = rgb[i * 3]
    out.data[i * 4 + 1] = rgb[i * 3 + 1]
    out.data[i * 4 + 2] = rgb[i * 3 + 2]
    out.data[i * 4 + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.flipY = flipY
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

/** 从颜色贴图生成本地法线贴图 (Sobel, 和视口自动法线同一套算法, 全尺寸) */
export function makeNormalTextureFromTexture(texture, width, height, strength = 1) {
  const src = drawTextureToCanvas(texture, width, height)
  if (!src) return null
  let pixels
  try {
    pixels = src.ctx.getImageData(0, 0, src.width, src.height).data
  } catch {
    return null
  }
  return makeNormalTextureFromPixels(pixels, src.width, src.height, strength, texture.flipY !== false)
}

/**
 * 从颜色贴图的亮度场推导粗糙度 (不是随机噪声):
 *  - 暗部/纹理沟槽 -> 更粗糙
 *  - 亮部/光滑区域 -> 更光滑
 * 再叠加一个很弱的局部梯度项, 让叶脉/花瓣边缘有细节。
 */
export function makeRoughnessTextureFromTexture(texture, width, height, baseRoughness = 0.8) {
  const src = drawTextureToCanvas(texture, width, height)
  if (!src) return null
  const { ctx, width: w, height: h } = src
  let pixels
  try {
    pixels = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null
  }
  const base = Math.max(0, Math.min(1, Number(baseRoughness) || 0))
  const out = ctx.createImageData(w, h)
  const lumAt = (x, y) => {
    const xx = x < 0 ? 0 : x >= w ? w - 1 : x
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y
    const i = (yy * w + xx) * 4
    return (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) / 255
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lum = lumAt(x, y)
      // 颜色越暗 -> 粗糙度越高; 越亮 -> 越光滑
      let v = base + (0.5 - lum) * 0.42
      // 局部梯度: 沟槽/边缘略粗, 平坦区域更均匀
      const gx = lumAt(x + 1, y) - lumAt(x - 1, y)
      const gy = lumAt(x, y + 1) - lumAt(x, y - 1)
      v += Math.min(0.12, Math.sqrt(gx * gx + gy * gy) * 0.8)
      const c = Math.round(Math.max(0, Math.min(1, v)) * 255)
      const o = (y * w + x) * 4
      out.data[o] = c
      out.data[o + 1] = c
      out.data[o + 2] = c
      out.data[o + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  const tex = new THREE.CanvasTexture(src.canvas)
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

/** 由 diffuse 的 alpha 通道生成黑白 alpha 资源 (白=不透明, 黑=透明) */
export function makeAlphaDataUrl(texture, width, height) {
  const src = drawTextureToCanvas(texture, width, height)
  if (!src) return null
  const { ctx, width: w, height: h } = src
  let pixels
  try {
    pixels = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null
  }
  const out = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const a = pixels[i * 4 + 3]
    out.data[i * 4] = a
    out.data[i * 4 + 1] = a
    out.data[i * 4 + 2] = a
    out.data[i * 4 + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  try {
    // 方向必须和导出的 diffuse 一致: GLTFExporter 对 flipY=true 的贴图会上下翻转后再写入,
    // 而 alpha 资源是独立 data URI (不走导出器), 所以这里要自己做同样的翻转。
    // 否则引擎里 leaf_alpha 与 leaf_diff 上下镜像。
    if (texture.flipY !== false) {
      const flipped = document.createElement('canvas')
      flipped.width = w
      flipped.height = h
      const fctx = flipped.getContext('2d')
      fctx.translate(0, h)
      fctx.scale(1, -1)
      fctx.drawImage(src.canvas, 0, 0)
      return flipped.toDataURL('image/png')
    }
    return src.canvas.toDataURL('image/png')
  } catch {
    return null
  }
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
      // 叶片/花朵/果实的 alpha 在漫反射图里; 生成真正的黑白 alpha 资源 (不是复用 RGBA 彩图)
      if (diffuseName && (kind === 'leaf' || kind === 'flower' || kind === 'fruit')) {
        const alphaName = textureAssetName(kind, 'alpha', m.map)
        if (!alphaAliases.some((a) => a.name === alphaName)) {
          const { width, height } = imageSize(m.map)
          alphaAliases.push({
            name: alphaName,
            from: diffuseName,
            width,
            height,
            dataUrl: (m.userData && m.userData.exportAlphaDataUrl) || makeAlphaDataUrl(m.map, width, height),
          })
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

  // 2) 叶片/花朵/果实的 alpha 资源: 优先使用真正的黑白 alpha PNG (data URI)
  for (const alias of alphaAliases) {
    if (!alias || !alias.name || !alias.from) continue
    if (json.textures.some((t) => t && t.name === alias.name)) continue
    const base = json.textures.find((t) => t && t.name === alias.from)
    if (!base) continue
    let alphaImg = null
    if (alias.dataUrl) {
      alphaImg = { name: alias.name, uri: alias.dataUrl, mimeType: 'image/png' }
    } else {
      // 兜底: 无法读取像素时复用 diffuse image, 至少保留资源名
      if (base.source === undefined || !json.images || !json.images[base.source]) continue
      alphaImg = { ...json.images[base.source], name: alias.name }
    }
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
function makeFlatNormalTexture(width = 256, height = 256) {
  return makeCanvasTexture(width, height, (ctx, w, h) => {
    // 用 fillRect 而不是 createImageData: 4K 贴图也不必分配整块 64MB ImageData
    ctx.fillStyle = 'rgb(128, 128, 255)'
    ctx.fillRect(0, 0, w, h)
  })
}

/** 无法从颜色贴图推导时的平坦粗糙度兜底 (仍按 diffuse 尺寸, 不是 4×4 单点) */
function makeFlatRoughnessTexture(value, width = 256, height = 256) {
  const v = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255)
  return makeCanvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = `rgb(${v}, ${v}, ${v})`
    ctx.fillRect(0, 0, w, h)
  })
}

/** 回退贴图取材质 diffuse 的尺寸; 没有贴图时用 256 */
function fallbackSize(material) {
  const tex = material.map || material.normalMap || material.roughnessMap
  const { width, height } = imageSize(tex)
  if (width >= 32 && height >= 32) return { width, height }
  return { width: 256, height: 256 }
}

/**
 * 导出前临时补全材质槽:
 *  - normalMap 缺失 -> 从颜色贴图亮度场生成法线 (Sobel, 和视口自动法线同算法), 读不到时用平坦法线
 *  - roughnessMap 缺失 -> 从颜色贴图亮度/梯度推导粗糙度 (不是随机噪声), 读不到时用材质 roughness 纯色
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
      const { width, height } = fallbackSize(m)
      if (!m.normalMap) {
        const strength = (m.userData && m.userData.kind) === 'flower' ? 1.5 : 1
        let tex = m.map ? makeNormalTextureFromTexture(m.map, width, height, strength) : null
        if (!tex) tex = makeFlatNormalTexture(width, height)
        if (tex) {
          m.normalMap = tex
          restore.push({ material: m, key: 'normalMap', previous: null, texture: tex })
        }
      }
      if (!m.roughnessMap) {
        let tex = m.map ? makeRoughnessTextureFromTexture(m.map, width, height, m.roughness) : null
        if (!tex) tex = makeFlatRoughnessTexture(m.roughness, width, height)
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

/**
 * glTF 的 metallicRoughnessTexture 把 roughness 放 G、metalness 放 B, 直接导出会变成
 * 绿/蓝彩色图。对 metalness=0 的材质, 临时把 metalnessMap 指向同一张 roughnessMap:
 * GLTFExporter 会原样使用这张灰度图 (metalnessFactor=0, 蓝通道被忽略), 于是导出的
 * `_rough` 资源保持灰白, 不再是金属粗糙度合并彩图。
 */
export function ensureExportRoughnessGrayscale(root) {
  const restore = []
  const seen = new Set()
  if (!root || typeof root.traverse !== 'function') return () => {}
  root.traverse((obj) => {
    if (!obj || !obj.isMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m || seen.has(m)) continue
      seen.add(m)
      if (m.roughnessMap && !m.metalnessMap && Math.abs(Number(m.metalness) || 0) < 1e-6) {
        m.metalnessMap = m.roughnessMap
        restore.push({ material: m, previous: null })
      }
    }
  })
  return () => {
    for (const r of restore) {
      if (r.material.metalnessMap && r.material.metalnessMap === r.material.roughnessMap) {
        r.material.metalnessMap = r.previous
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 导出贴图成套对齐: 同尺寸 + 同朝向 + 同 UV 变换                       */
/* ------------------------------------------------------------------ */

/**
 * 叶片 / 花朵 / 果实这些"卡片类"材质, 导出的 diff / nor / rough / alpha
 * 必须成套一致 (美术拿去进引擎时四张图要能直接叠在一起):
 *   - 尺寸: 四张图必须同分辨率 (否则 _xk 后缀不同、引擎里采样比例也不同)
 *   - 朝向: 四张图必须同 flipY (否则上下镜像, 法线细节和叶脉错位)
 *   - UV:   offset / repeat / rotation 必须和 diffuse 一致 (否则图案缩放/旋转错位)
 *
 * 典型问题来源:
 *   1. 视口自动法线是按"长边 256 上限 + flipY=false"生成的 -> 导出既小又镜像;
 *   2. 用户自带法线贴图的分辨率和卡片不一致;
 *   3. alpha 资源是独立 data URI, 不经过 GLTFExporter 的 flipY 翻转 -> 和 diffuse 镜像;
 *   4. 生成的法线/粗糙度没有复制 diffuse 的 UV 变换。
 *
 * 只在导出期间生效, 返回 restore() 恢复原材质并释放临时贴图。
 */
export const EXPORT_ALIGNED_KINDS = ['leaf', 'flower', 'fruit']
const ALIGNED_KINDS = new Set(EXPORT_ALIGNED_KINDS)

/** 把一张贴图重采样到目标尺寸 (内容朝向保持不变), 返回新的 CanvasTexture */
function resampleExportMap(texture, width, height, flipY) {
  const src = drawTextureToCanvas(texture, width, height)
  if (!src) return null
  const tex = new THREE.CanvasTexture(src.canvas)
  tex.flipY = flipY !== false
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

export function ensureExportTextureAlignment(root) {
  if (typeof document === 'undefined' || !root || typeof root.traverse !== 'function') return () => {}
  const swap = []        // { material, key, previous, texture }
  const transforms = []  // { texture, key, center, offset, repeat, rotation, flipY }
  const seen = new Set()

  root.traverse((obj) => {
    if (!obj || !obj.isMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m || seen.has(m)) continue
      seen.add(m)
      const kind = (m.userData && m.userData.kind) || ''
      if (!ALIGNED_KINDS.has(kind)) continue
      const diff = m.map
      const size = imageSize(diff)
      if (!diff || size.width < 2 || size.height < 2) continue
      const flipY = diff.flipY !== false
      const target = { width: size.width, height: size.height }
      const sameSize = (tex) => {
        const s = imageSize(tex)
        return s.width === target.width && s.height === target.height
      }
      const put = (key, texture) => {
        if (!texture) return
        texture.flipY = flipY
        texture.wrapS = diff.wrapS
        texture.wrapT = diff.wrapT
        swap.push({ material: m, key, previous: m[key], texture })
        m[key] = texture
        m.needsUpdate = true
      }

      // ---- 法线: 自动法线(小尺寸/镜像)直接按当前 diffuse 全尺寸重做 ----
      const autoStrength = Number((m.userData && m.userData.autoNormalStrength) || 0)
      const isAuto = !!(m.userData && m.userData.autoNormal) && autoStrength > 0
      if (isAuto || !m.normalMap) {
        put('normalMap', makeNormalTextureFromTexture(diff, target.width, target.height, isAuto ? autoStrength : 1))
      } else if (!sameSize(m.normalMap) || m.normalMap.flipY !== flipY) {
        put('normalMap', resampleExportMap(m.normalMap, target.width, target.height, flipY))
      }

      // ---- 粗糙度: 尺寸/朝向不一致的重采样 ----
      if (!m.roughnessMap) {
        put('roughnessMap', makeRoughnessTextureFromTexture(diff, target.width, target.height, m.roughness))
      } else if (!sameSize(m.roughnessMap) || m.roughnessMap.flipY !== flipY) {
        put('roughnessMap', resampleExportMap(m.roughnessMap, target.width, target.height, flipY))
      }

      // ---- UV 变换: 以 diffuse 为基准 (导出器会写成 KHR_texture_transform) ----
      for (const key of ['normalMap', 'roughnessMap', 'alphaMap']) {
        const tex = m[key]
        if (!tex || tex === diff) continue
        transforms.push({
          texture: tex,
          key,
          center: tex.center.clone(),
          offset: tex.offset.clone(),
          repeat: tex.repeat.clone(),
          rotation: tex.rotation,
        })
        tex.center.copy(diff.center)
        tex.offset.copy(diff.offset)
        tex.repeat.copy(diff.repeat)
        tex.rotation = diff.rotation
      }
    }
  })

  return () => {
    for (const t of transforms) {
      const tex = t.texture
      tex.center.copy(t.center)
      tex.offset.copy(t.offset)
      tex.repeat.copy(t.repeat)
      tex.rotation = t.rotation
    }
    for (const s of swap.reverse()) {
      if (s.material[s.key] === s.texture) s.material[s.key] = s.previous
      s.texture.dispose()
    }
  }
}

