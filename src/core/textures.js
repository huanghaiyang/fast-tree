/**
 * 程序化贴图 (无需任何外部资源, 打开即有树皮质感)
 * ------------------------------------------------------------
 * - makeBarkTextures(): 颜色图 + 法线图 + 粗糙度图 (由同一高度场派生)
 * - makeLeafTexture(): 叶脉细节 + 轮廓 alpha (配合 alphaTest 镂空)
 * 用户也可以在材质面板上传自己的贴图替换它们。
 */
import * as THREE from 'three'
import { mulberry32, mixSeed } from './rng.js'
import { LEAF_OUTLINES } from './leaf.js'

function createCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** 平滑插值的 value noise */
function valueNoise2D(seed) {
  const G = 64
  const grid = new Float32Array(G * G)
  const rnd = mulberry32(mixSeed(seed, 'vnoise'))
  for (let i = 0; i < grid.length; i++) grid[i] = rnd()
  const at = (x, y) => grid[(((y % G) + G) % G) * G + (((x % G) + G) % G)]
  return (x, y) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    const a = at(xi, yi)
    const b = at(xi + 1, yi)
    const c = at(xi, yi + 1)
    const d = at(xi + 1, yi + 1)
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
  }
}

function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * 树皮: 返回 { map, normalMap, roughnessMap } 或 null (无 DOM)
 */
export function makeBarkTextures(o = {}) {
  if (typeof document === 'undefined') return null
  const size = o.size || 512
  const style = o.style || 'rough'
  const scale = o.scale === undefined ? 1 : o.scale
  const contrast = o.contrast === undefined ? 0.5 : o.contrast
  const seed = o.seed || 1
  const base = new THREE.Color(o.color || '#6d5138')
  const tip = new THREE.Color(o.color2 || '#8d7053')
  const nA = valueNoise2D(seed)
  const nB = valueNoise2D(seed + 977)

  const colorCanvas = createCanvas(size, size)
  const cctx = colorCanvas.getContext('2d')
  const cimg = cctx.createImageData(size, size)
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)

  const sx = scale * (style === 'birch' ? 0.8 : 1)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / size
      const fy = y / size
      // 纵向条纹 (沿树干方向拉长)
      const ridges = fbm(nA, fx * 26 * sx, fy * 3.2 * sx, 4)
      // 横向裂纹
      const cracks = fbm(nB, fx * 5 * sx, fy * 34 * sx, 3)
      // 细颗粒
      const grain = fbm(nB, fx * 90 * sx, fy * 90 * sx, 2)
      let h
      if (style === 'birch') {
        h = 0.72 + (ridges - 0.5) * 0.35 + (grain - 0.5) * 0.12
        // 白桦的横向皮孔
        const lent = Math.sin(fy * 34 * Math.PI + ridges * 6) * 0.5 + 0.5
        h -= Math.pow(lent, 8) * 0.45
      } else if (style === 'pine') {
        const plates = fbm(nA, fx * 12 * sx, fy * 7 * sx, 3)
        h = 0.35 + Math.pow(plates, 1.6) * 0.75
        h += (cracks - 0.5) * 0.5
      } else if (style === 'smooth') {
        h = 0.5 + (ridges - 0.5) * 0.22 + (grain - 0.5) * 0.06
      } else {
        // rough
        h = 0.42 + (ridges - 0.5) * 0.85 + (cracks - 0.5) * 0.35 + (grain - 0.5) * 0.14
      }
      h = 0.5 + (h - 0.5) * (0.6 + contrast * 1.6)
      h = clamp01(h)
      const idx = y * size + x
      height[idx] = h
      rough[idx] = clamp01(0.55 + (1 - h) * 0.45)

      const ci = idx * 4
      cimg.data[ci] = Math.round(clamp01(base.r + (tip.r - base.r) * h) * 255)
      cimg.data[ci + 1] = Math.round(clamp01(base.g + (tip.g - base.g) * h) * 255)
      cimg.data[ci + 2] = Math.round(clamp01(base.b + (tip.b - base.b) * h) * 255)
      cimg.data[ci + 3] = 255
    }
  }
  cctx.putImageData(cimg, 0, 0)

  // --- 由高度场派生法线图 ---
  const normalCanvas = createCanvas(size, size)
  const nctx = normalCanvas.getContext('2d')
  const nimg = nctx.createImageData(size, size)
  const strength = o.bump === undefined ? 2.4 : o.bump * 3.0
  const H = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength
      let nx = -dx
      let ny = -dy
      let nz = 1
      const l = Math.hypot(nx, ny, nz)
      nx /= l; ny /= l; nz /= l
      const i = (y * size + x) * 4
      nimg.data[i] = Math.round((nx * 0.5 + 0.5) * 255)
      nimg.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      nimg.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      nimg.data[i + 3] = 255
    }
  }
  nctx.putImageData(nimg, 0, 0)

  // --- 粗糙度图 ---
  const roughCanvas = createCanvas(size, size)
  const rctx = roughCanvas.getContext('2d')
  const rimg = rctx.createImageData(size, size)
  for (let i = 0; i < rough.length; i++) {
    const v = Math.round(clamp01(rough[i]) * 255)
    rimg.data[i * 4] = v
    rimg.data[i * 4 + 1] = v
    rimg.data[i * 4 + 2] = v
    rimg.data[i * 4 + 3] = 255
  }
  rctx.putImageData(rimg, 0, 0)

  const map = new THREE.CanvasTexture(colorCanvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  const normalMap = new THREE.CanvasTexture(normalCanvas)
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
  const roughnessMap = new THREE.CanvasTexture(roughCanvas)
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping
  return { map, normalMap, roughnessMap }
}

/**
 * 树叶贴图: 浅色细节 (叶脉/斑点) + 轮廓 alpha
 */
export function makeLeafTexture(o = {}) {
  if (typeof document === 'undefined') return null
  const size = o.size || 256
  const shape = LEAF_OUTLINES[o.shape] || LEAF_OUTLINES.oval
  const seed = o.seed || 7
  const widthScale = o.widthScale === undefined ? 0.88 : o.widthScale
  const nA = valueNoise2D(seed + 31)
  const veinColor = o.veinColor || '#b9c6a4'
  const vein = new THREE.Color(veinColor)

  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(size, size)
  const grid = new Float32Array(size * size)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / (size - 1)
      const tv = 1 - py / (size - 1) // v=0 (叶柄) 在画布底部
      const hw = shape(tv) * widthScale
      const dx = u - 0.5
      const inside = Math.abs(dx) <= hw + 1e-4
      const idx = py * size + px
      if (!inside) {
        img.data[idx * 4 + 3] = 0
        continue
      }
      // 边缘羽化
      const edge = clamp01((hw - Math.abs(dx)) / Math.max(0.004, hw * 0.25))
      const speck = fbm(nA, u * 18, tv * 18, 3)
      let shade = 0.86 + (speck - 0.5) * 0.28
      grid[idx] = shade
      // 中脉
      const mid = Math.exp(-Math.pow(dx / 0.012, 2))
      // 侧脉
      const veinT = Math.abs(((tv * 9) % 1) - 0.5) * 2
      const sideVein = Math.exp(-Math.pow((veinT - Math.abs(dx) / Math.max(0.02, hw)) * 6, 2)) * (1 - mid)
      const veinMix = clamp01(mid * 0.85 + sideVein * 0.25)
      const r = shade + (vein.r - shade) * veinMix
      const g = shade + (vein.g - shade) * veinMix
      const b = shade + (vein.b - shade) * veinMix
      img.data[idx * 4] = Math.round(clamp01(r) * 255)
      img.data[idx * 4 + 1] = Math.round(clamp01(g) * 255)
      img.data[idx * 4 + 2] = Math.round(clamp01(b) * 255)
      img.data[idx * 4 + 3] = Math.round(255 * edge)
    }
  }
  ctx.putImageData(img, 0, 0)
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping
  map.anisotropy = 4
  return { map }
}

/** 从 image URL / dataURL 载入贴图 */
export function loadTexture(url, opts = {}) {
  const tex = new THREE.TextureLoader().load(url)
  tex.wrapS = tex.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace
  tex.colorSpace = opts.normal ? THREE.NoColorSpace : tex.colorSpace
  tex.anisotropy = 8
  return tex
}

export function disposeTexture(t) {
  if (t && t.dispose) t.dispose()
}

export function setTextureRepeat(tex, u, v) {
  if (!tex) return
  tex.repeat.set(u || 1, v || 1)
  tex.needsUpdate = true
}
