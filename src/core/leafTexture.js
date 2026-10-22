/**
 * 叶片贴图解析 (leaf / falling leaf / 地面落叶 三类效果共用的一张贴图口径)
 * ------------------------------------------------------------
 * 作用: 决定「某个效果实际该用哪张贴图、宽高比是多少」, 并负责贴图的缓存与降级。
 * 输入 / 输出:
 *   - ellipseLeafTexture(size) -> THREE.DataTexture (程序生成的椭圆叶形, 永久缓存)
 *   - cardTexture(cardId)      -> THREE.Texture | null (卡片库里的真实贴图)
 *   - resolveEffectTexture(opts) -> { map, hasMap, source: 'own'|'follow'|'ellipse' }
 *   - resolveEffectAspect(cardId, followAspect) -> number (裁剪后 宽/高)
 * 与其他模块的关系:
 *   上游数据来自 leafCards.generated.js (卡片的 URL 与 aspect);
 *   下游被 fallingLeaves.js / litter.js 调用, 结果直接塞进它们的 ShaderMaterial uniform;
 *   树冠本体用的贴图由 sceneManager 管, 本模块只负责「跟随」时借用它的 map 引用。
 * 关键概念 / 约定:
 *   - 若卡片 id 为空 = 「跟随树叶当前选中的卡片」; 有值 = 「用这张卡片自己的贴图」;
 *     两者都拿不到 -> 用程序化的椭圆贴图兜底, 保证任何情况下 hasMap 都为 true。
 *   - 所有贴图都按 sRGB 解释 (colorSpace = SRGBColorSpace), 与树冠主材质同一条色彩管线。
 * 注意: 浏览器里是异步加载, 本模块返回的 Texture 对象可能此刻还没有像素;
 *       因为 ShaderMaterial 是按引用持有 uniform, 加载完成后 three.js 会自动上传,
 *       所以调用方**不需要**等待 onLoad 再重建材质。
 */
import * as THREE from 'three'
import { LEAF_CARD_BY_ID } from './leafCards.generated.js'

/**
 * 叶片贴图解析 (落叶 / 落叶堆积可以各自选一张贴图)
 * ------------------------------------------------------------
 * - cardId 为空 -> 跟随树叶当前选中的卡片 (= 树叶材质里的贴图)
 * - cardId 有值 -> 用这张卡片自己的贴图与宽高比
 * - 没有贴图时 -> 返回程序生成的椭圆 alpha 贴图 (DataTexture, 不依赖 canvas)
 */

// 椭圆兜底贴图的单例缓存: 该贴图对所有效果都相同, 只生成一次 (避免每棵树重复占显存)
let ellipseTex = null
// 预留给椭圆兜底材质的单例槽位 (当前恒为 null, 仅为兼容旧的模块级状态而保留)
let ellipseMat = null

/** 程序生成的椭圆"叶形"贴图 (无 canvas 依赖, Node 里也能构建) */
export function ellipseLeafTexture(size = 64) {
  if (ellipseTex) return ellipseTex
  const w = size
  const h = size
  // RGBA8 原始像素, 直接喂给 DataTexture —— 不经过 canvas, 所以 Node 自检也能跑
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 像素中心归一化到 0..1 (用 +0.5 取中心, 避免半个像素的偏移)
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      const dx = (u - 0.5) * 2 * 1.55  // 椭圆 (叶子长宽比): x 方向压扁 1/1.55, 使叶形高瘦
      const dy = (v - 0.5) * 2
      // r = 到中心的归一化距离: r<=1 在椭圆内
      const r = Math.sqrt(dx * dx + dy * dy)
      // 硬区 r<=0.82 全不透明; 0.82..1 线性羽化到 0 (抗锯齿 + alphaTest 边缘更柔和)
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

// cardId -> Texture|null 的解析缓存。
// 用 Map 而不是给 card 对象挂字段, 是为了不污染 leafCards.generated.js 导出的共享数据。
const cache = new Map()

/** 卡片贴图 (带缓存; 浏览器里异步加载, 加载完自动 needsUpdate) */
export function cardTexture(cardId) {
  if (!cardId) return null
  if (cache.has(cardId)) return cache.get(cardId)
  const card = LEAF_CARD_BY_ID.get(cardId)
  if (!card) return null
  if (typeof document === 'undefined') {
    // Node 环境 (自检): 不发起网络请求
    // 缓存 null 是刻意的: 让同一个 id 在自检里也只判断一次, 后续直接短路
    cache.set(cardId, null)
    return null
  }
  // ClampToEdge: 卡片贴图的 UV 恰好铺满整张图 (0..1), 不应重复采样
  const tex = new THREE.TextureLoader().load(card.url)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  cache.set(cardId, tex)
  return tex
}

/** 解析某个效果实际要用的贴图: 自己的卡片 -> 或跟随树叶 -> 或椭圆兜底 */
export function resolveEffectTexture(opts = {}) {
  // 三级降级: 自己的卡片最优先, 其次是「跟随树冠」的 map 引用, 最后是程序化椭圆。
  // 三条路径都返回 hasMap: true —— 调用方据此只需判断「有没有贴图」而不用关心来源,
  // 真正需要区分来源时看 source。
  const own = opts.cardId ? cardTexture(opts.cardId) : null
  if (own) return { map: own, hasMap: true, source: 'own' }
  if (opts.followMap) return { map: opts.followMap, hasMap: true, source: 'follow' }
  return { map: ellipseLeafTexture(), hasMap: true, source: 'ellipse' }
}

/** 解析宽高比: 自己的卡片 -> 树叶卡片 -> 1 */
export function resolveEffectAspect(cardId, followAspect) {
  // 宽高比 = 裁剪后「宽/高」。卡片库里的 aspect 是通用估值 (0.72);
  // 跟随树冠时用 params.leaves.cardAspect, 它是按真实贴图量出来的, 更准;
  // 都没有就返回 1 (正方形), 宁可略宽也不要因为极端比例把叶片拉成细条。
  if (cardId) {
    const card = LEAF_CARD_BY_ID.get(cardId)
    if (card) return card.aspect
  }
  return followAspect || 1
}
