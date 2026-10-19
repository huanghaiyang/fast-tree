/**
 * 导出专用的果实材质。
 * 视口里的果实与树皮共用材质 (靠顶点色区分坚果/壳斗帽); 导出时给 Bark_Fruit
 * 单独一个 fruit 材质, 这样 GLB 里会有完整的 fruit_diff / fruit_alpha /
 * fruit_nor_gl / fruit_rough 资源, 而不是复用 bark 贴图。
 *
 * 注意: 果实几何带 COLOR_0 (坚果色/帽色/实例色差), 所以 diffuse 只做
 * 中性果皮细节; 最终颜色仍由顶点色乘出来, 不会丢掉每颗果实的颜色变化。
 */
import * as THREE from 'three'
import { makeRng } from './rng.js'
import {
  makeNormalTextureFromPixels,
  makeRoughnessTextureFromTexture,
} from './textureNaming.js'

const SIZE = 1024

function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** 果实表面的高对比高度场: 供法线/alpha 使用, 保证不是纯色 */
function makeDetailPixels(fruit, seed) {
  const cv = makeCanvas(SIZE, SIZE)
  if (!cv) return null
  const ctx = cv.getContext('2d')
  const rng = makeRng(seed || 1, 'fruit-export-height')
  ctx.fillStyle = 'rgb(128, 128, 128)'
  ctx.fillRect(0, 0, SIZE, SIZE)

  const type = fruit.type || 'acorn'
  // 高频小凸起/凹坑: 法线贴图能看到明确的果皮细节
  const count = type === 'cone' ? 5200 : type === 'berry' ? 3200 : 3800
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, SIZE)
    const y = rng.range(0, SIZE)
    const r = rng.range(0.8, type === 'cone' ? 8 : 5)
    const v = rng.chance(0.5) ? rng.range(40, 100) : rng.range(170, 235)
    ctx.globalAlpha = rng.range(0.35, 0.9)
    ctx.fillStyle = `rgb(${v}, ${v}, ${v})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 松果鳞片 / 橡果帽的交叉纹理
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = '#3c3c3c'
  ctx.lineWidth = type === 'cone' ? 5 : 3
  const step = type === 'cone' ? 46 : 74
  for (let y = 20; y < SIZE; y += step) {
    ctx.beginPath()
    for (let x = 0; x <= SIZE; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.025) * 9)
    ctx.stroke()
  }
  if (type === 'acorn' || type === 'nut') {
    // 帽沿的纵向棱
    for (let x = 0; x < SIZE; x += 58) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + 16, SIZE)
      ctx.stroke()
    }
  }

  // 大面积深浅斑块
  for (let i = 0; i < 30; i++) {
    ctx.globalAlpha = rng.range(0.1, 0.25)
    ctx.fillStyle = rng.chance(0.5) ? '#5a5a5a' : '#d8d8d8'
    ctx.beginPath()
    ctx.arc(rng.range(0, SIZE), rng.range(0, SIZE), rng.range(20, 80), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  return ctx.getImageData(0, 0, SIZE, SIZE).data
}

function makeDiffuseTexture(fruit, seed) {
  const cv = makeCanvas(SIZE, SIZE)
  if (!cv) return null
  const ctx = cv.getContext('2d')
  const rng = makeRng(seed || 1, 'fruit-export-tex')
  const cap = new THREE.Color(fruit.capColor || '#8a6f45')
  const nut = new THREE.Color(fruit.color || '#c8a86a')
  // 中性果皮底色; 真实颜色由顶点色提供 (避免和 COLOR_0 双重染色)
  ctx.fillStyle = '#e8ddc8'
  ctx.fillRect(0, 0, SIZE, SIZE)
  const type = fruit.type || 'acorn'
  const dots = type === 'cone' ? 900 : type === 'berry' ? 520 : 380
  for (let i = 0; i < dots; i++) {
    const x = rng.range(0, SIZE)
    const y = rng.range(0, SIZE)
    const r = rng.range(1.2, type === 'cone' ? 12 : 7)
    const c = rng.chance(0.5) ? cap : nut
    ctx.globalAlpha = rng.range(0.12, 0.34)
    ctx.fillStyle = `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 0.14
  ctx.strokeStyle = '#8a6f45'
  ctx.lineWidth = 2
  for (let k = 0; k < 42; k++) {
    const x = rng.range(0, SIZE)
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.bezierCurveTo(x + rng.range(-18, 18), SIZE * 0.35, x + rng.range(-18, 18), SIZE * 0.7, x + rng.range(-10, 10), SIZE)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** 从高度场生成有细节的黑白 alpha 掩码 (白=不透明, 黑=沟槽) */
function makeAlphaMaskDataUrl(detailPixels) {
  const cv = makeCanvas(SIZE, SIZE)
  if (!cv) return null
  const ctx = cv.getContext('2d')
  const out = ctx.createImageData(SIZE, SIZE)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const lum = (detailPixels[i * 4] + detailPixels[i * 4 + 1] + detailPixels[i * 4 + 2]) / 3
    // alpha 资源也带细节: 白色主体 + 黑色沟槽/鳞片
    const a = lum < 105 ? 0 : 255
    out.data[i * 4] = a
    out.data[i * 4 + 1] = a
    out.data[i * 4 + 2] = a
    out.data[i * 4 + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  try {
    return cv.toDataURL('image/png')
  } catch {
    return null
  }
}

/**
 * @param {object} fruit state.params.fruit
 * @param {number} seed
 */
export function createFruitExportMaterial(fruit = {}, seed = 1) {
  const detail = makeDetailPixels(fruit, seed)
  const map = makeDiffuseTexture(fruit, seed)
  const normalMap = detail ? makeNormalTextureFromPixels(detail, SIZE, SIZE, 2.8) : null
  const roughnessMap = map ? makeRoughnessTextureFromTexture(map, SIZE, SIZE, 0.68) : null
  const alphaDataUrl = detail ? makeAlphaMaskDataUrl(detail) : null
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap,
    color: 0xffffff,
    roughness: 0.68,
    metalness: 0,
    vertexColors: true,
    side: THREE.FrontSide,
  })
  mat.name = 'Fruit'
  mat.userData.kind = 'fruit'
  mat.userData.exportAlphaDataUrl = alphaDataUrl
  mat.normalScale.set(1.4, 1.4)
  return mat
}

export function disposeFruitExportMaterial(mat) {
  if (!mat) return
  mat.map?.dispose()
  mat.normalMap?.dispose()
  mat.roughnessMap?.dispose()
  mat.dispose()
}
