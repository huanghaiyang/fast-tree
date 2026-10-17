import * as THREE from 'three'

/**
 * 从 albedo(颜色贴图) 自动生成切空间法线贴图
 * ------------------------------------------------------------
 * 原理: 把亮度当"高度场", 用 Sobel 算子求梯度, 再编码成法线:
 *   n = normalize(vec3(-dH/du * strength, -dH/dv * strength, 1))
 *   rgb = n * 0.5 + 0.5
 * 对叶片卡片这种"照片级"贴图效果很好: 叶脉、叶面起伏、边缘卷曲都会有明暗起伏,
 * 法线贴图能把它们变成真实的光照细节 (还能和反光/散光叠加)。
 *
 * 之所以运行时生成: 不用为每张卡片额外存一份法线图 (97 张会多出十几 MB),
 * 而且用户自己上传的贴图也能自动获得法线。
 */

/**
 * 纯计算部分 (不依赖 canvas/DOM, Node 里也能单测)
 * @param {Uint8ClampedArray|Uint8Array} data RGBA 像素
 * @param {number} w 宽
 * @param {number} h 高
 * @param {number} strength 起伏强度 (0 = 全平 -> 纯 (128,128,255))
 * @param {boolean} flipY 纹理坐标 v 方向是否需要翻转 (three 的 uv 原点在左下)
 * @returns {Uint8Array} RGB 法线数据 (w*h*3)
 */
export function normalFromLuminance(data, w, h, strength = 1, flipY = false) {
  const out = new Uint8Array(w * h * 3)
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]
    // 透明区域不参与起伏 (避免 alpha 边缘产生假法线)
    lum[i] = a < 8 ? 0 : (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }
  const at = (x, y) => {
    // 边界钳制
    const xx = x < 0 ? 0 : x >= w ? w - 1 : x
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y
    return lum[yy * w + xx]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1)
      const l = at(x - 1, y), r = at(x + 1, y)
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1)
      let dx = (tr + 2 * r + br) - (tl + 2 * l + bl)
      let dy = (bl + 2 * b + br) - (tl + 2 * t + tr)
      if (flipY) dy = -dy
      // 归一化 (8 邻域最大梯度约 4)
      dx = (dx / 8) * strength
      dy = (dy / 8) * strength
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1)
      const nx = -dx * inv
      const ny = -dy * inv
      const nz = inv
      const o = (y * w + x) * 3
      out[o] = Math.round((nx * 0.5 + 0.5) * 255)
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255)
    }
  }
  return out
}

const cache = new Map()

/** 浏览器环境: 把 THREE.Texture 的像素读出来 -> 生成 DataTexture 法线图 (按 key 缓存) */
export function albedoNormalTexture(texture, strength, key) {
  if (typeof document === 'undefined') return null
  if (!texture || !texture.image) return null
  const cacheKey = key + '|' + strength.toFixed(2)
  if (cache.has(cacheKey)) return cache.get(cacheKey)
  const img = texture.image
  const w = img.width || img.videoWidth
  const h = img.height || img.videoHeight
  if (!w || !h) return null
  // 生成时不需要原尺寸, 长边限制到 256 (法线只看梯度, 太大只是浪费显存)
  const scale = Math.min(1, 256 / Math.max(w, h))
  const nw = Math.max(8, Math.round(w * scale))
  const nh = Math.max(8, Math.round(h * scale))
  let pixels
  try {
    const cv = document.createElement('canvas')
    cv.width = nw
    cv.height = nh
    const cx = cv.getContext('2d')
    cx.drawImage(img, 0, 0, nw, nh)
    pixels = cx.getImageData(0, 0, nw, nh).data
  } catch (e) {
    return null // 跨域/未加载完成
  }
  const rgb = normalFromLuminance(pixels, nw, nh, strength, true)
  const data = new Uint8Array(nw * nh * 4)
  for (let i = 0; i < nw * nh; i++) {
    data[i * 4] = rgb[i * 3]
    data[i * 4 + 1] = rgb[i * 3 + 1]
    data[i * 4 + 2] = rgb[i * 3 + 2]
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, nw, nh, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  cache.set(cacheKey, tex)
  return tex
}
