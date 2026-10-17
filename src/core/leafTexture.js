import * as THREE from 'three'
import { LEAF_CARD_BY_ID } from './leafCards.generated.js'

/**
 * 叶片贴图解析 (落叶 / 落叶堆积可以各自选一张贴图)
 * ------------------------------------------------------------
 * - cardId 为空 -> 跟随树叶当前选中的卡片 (= 树叶材质里的贴图)
 * - cardId 有值 -> 用这张卡片自己的贴图与宽高比
 * - 没有贴图时 -> 返回程序生成的椭圆 alpha 贴图 (DataTexture, 不依赖 canvas)
 */

let ellipseTex = null
let ellipseMat = null

/** 程序生成的椭圆"叶形"贴图 (无 canvas 依赖, Node 里也能构建) */
export function ellipseLeafTexture(size = 64) {
  if (ellipseTex) return ellipseTex
  const w = size
  const h = size
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      const dx = (u - 0.5) * 2 * 1.55  // 椭圆 (叶子长宽比)
      const dy = (v - 0.5) * 2
      const r = Math.sqrt(dx * dx + dy * dy)
      const a = r > 1 ? 0 : (r > 0.82 ? Math.round(255 * (1 - (r - 0.82) / 0.18)) : 255)
      const i = (y * w + x) * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = a
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.colorSpace = THREE.SRGBColorSpace
  ellipseTex = tex
  return tex
}

const cache = new Map()

/** 卡片贴图 (带缓存; 浏览器里异步加载, 加载完自动 needsUpdate) */
export function cardTexture(cardId) {
  if (!cardId) return null
  if (cache.has(cardId)) return cache.get(cardId)
  const card = LEAF_CARD_BY_ID.get(cardId)
  if (!card) return null
  if (typeof document === 'undefined') {
    // Node 环境 (自检): 不发起网络请求
    cache.set(cardId, null)
    return null
  }
  const tex = new THREE.TextureLoader().load(card.url)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  cache.set(cardId, tex)
  return tex
}

/** 解析某个效果实际要用的贴图: 自己的卡片 -> 或跟随树叶 -> 或椭圆兜底 */
export function resolveEffectTexture(opts = {}) {
  const own = opts.cardId ? cardTexture(opts.cardId) : null
  if (own) return { map: own, hasMap: true, source: 'own' }
  if (opts.followMap) return { map: opts.followMap, hasMap: true, source: 'follow' }
  return { map: ellipseLeafTexture(), hasMap: true, source: 'ellipse' }
}

/** 解析宽高比: 自己的卡片 -> 树叶卡片 -> 1 */
export function resolveEffectAspect(cardId, followAspect) {
  if (cardId) {
    const card = LEAF_CARD_BY_ID.get(cardId)
    if (card) return card.aspect
  }
  return followAspect || 1
}
