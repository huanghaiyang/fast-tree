import * as THREE from 'three'

/**
 * 从 albedo（颜色贴图）自动生成切空间法线贴图
 * ============================================================================
 * 原理：把亮度当"高度场"，用 Sobel 算子求梯度，再编码成法线：
 *   n = normalize(vec3(-dH/du * strength, -dH/dv * strength, 1))
 *   rgb = n * 0.5 + 0.5
 * 对叶片卡片这种"照片级"贴图效果很好：叶脉、叶面起伏、边缘卷曲都会变成
 * 真实的光照细节（还能和反光/散光叠加）。
 *
 * 为什么运行时生成：不用为每张卡片额外存一份法线图（97 张会多出十几 MB），
 * 而且用户自己上传的贴图也能自动获得法线。
 *
 * ## 两条使用路径（朝向必须一致，这是本文件最容易踩的坑）
 *   - **视口**：`albedoNormalTexture()` —— 长边压到 256 省显存，flipY **跟随
 *     源贴图**（图片/CanvasTexture 默认 true）。早期版本固定 flipY=false，
 *     导致法线细节相对叶脉上下镜像。
 *   - **导出**：`textureNaming.makeNormalTextureFromTexture()` —— 全尺寸、
 *     flipY 继承源贴图，四张导出图同尺寸同朝向（见 textureNaming.js 头注释）。
 * 两边共用 `normalFromLuminance()` 的同一套梯度算法，只是分辨率/存储策略不同。
 */

/**
 * 纯计算部分（不依赖 canvas/DOM，Node 自检里可直接单测）。
 *
 * 输入像素约定：`data` 的行 0 = 图片/画布最上面一行（即"存储朝向"）。
 * uv 的行方向由 `flipY` 决定：
 *   - `flipY = true`（three 的图片贴图默认）：v=0 对应**最下面**一行，
 *     所以 dv 与"图像行方向 dy"反号 → 内部把 dy 取反；
 *   - `flipY = false`：v=0 对应最上面一行，dy 就是 dv。
 * 这个符号必须与目标贴图的 `flipY` 一致，否则法线绿通道方向相反（光照看着"凹
 * 进去"），从视口/导出都会错。所以**先确定贴图 flipY，再用同样的值调用本函数**。
 *
 * 细节：
 *   - Sobel 梯度除以 8 做归一化（8 邻域最大梯度约 4，两侧差分合计 8）；
 *   - 完全透明像素（a<8）亮度按 0 处理：避免叶卡透明区在边缘产生假法线；
 *   - 边界用钳制采样（clamp），不会因为越界出现黑边；
 *   - 输出是 **RGB 三通道**（不是 RGBA），由调用方负责写回 canvas/贴图。
 *
 * @param {Uint8ClampedArray|Uint8Array} data RGBA 像素（长度 w*h*4）
 * @param {number} w 宽
 * @param {number} h 高
 * @param {number} [strength] 起伏强度（0 = 全平 -> 纯 (128,128,255)）
 * @param {boolean} [flipY]  目标贴图的 flipY；决定 v 轴方向（默认 false）
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

/**
 * 自动法线缓存：key = `<贴图 URL|dataURL>|<强度>`。
 * 目的：材质频繁更新（滑杆/风场/选中）时不重复跑 Sobel。
 * 只缓存"视口版"（256 上限）；导出用的是全尺寸一次性生成，不进缓存。
 */
const cache = new Map()

/**
 * 【视口专用】把一张颜色贴图转成自动法线贴图（按 `key + 强度` 缓存）。
 *
 * 与导出路径的区别（很重要，别混用）：
 *   - **分辨率**：长边压到 256（法线只看梯度，太大只浪费显存）；导出用
 *     `textureNaming.makeNormalTextureFromTexture()` 的全尺寸版本；
 *   - **朝向**：flipY 跟随源贴图（图片贴图默认 true）。这样法线细节和叶脉
 *     在视口里是对齐的；早期版本固定 flipY=false，导致法线相对 diffuse 上下镜像；
 *   - **缓存**：同一张卡片/强度只生成一次，避免每次材质更新都重算 Sobel。
 *
 * 两个实现约束：
 *   1. 必须用 `CanvasTexture`，不能用 `DataTexture`：`GLTFExporter` 处理法线贴图
 *      的通道翻转时会对 `texture.image` 调 `canvas.drawImage()`，而 DataTexture 的
 *      `image` 是 `{data,width,height}` 普通对象，会抛
 *      "provided value is not of type ..." 让整个 GLB 导出失败。
 *   2. 采样参数沿用最初的 DataTexture 默认值（nearest / 不生成 mipmap）——
 *      只改朝向，不改变视口观感（除了修掉镜像本身）。
 *
 * 读不到像素（跨域 / 图片未解码）时返回 null；调用方
 * `applyAutoNormal()` 会挂到贴图的 `onUpdate` 上，等解码完成后再生成。
 *
 * @param {THREE.Texture} texture 颜色贴图（提供 image 像素）
 * @param {number} strength        起伏强度（= 参数 normalFromAlbedo）
 * @param {string} key             缓存键（通常是贴图 URL / dataURL）
 * @returns {THREE.CanvasTexture|null} flipY 与源贴图一致，colorSpace = NoColorSpace
 */
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
  // 关键: flipY 必须和 diffuse 一致。之前生成时固定 flipY=true、贴图却设成 flipY=false,
  // 结果法线细节相对叶脉上下镜像 (导出后同理, 与 diff/nor/rough/alpha 成套要求冲突)。
  const flipY = texture.flipY !== false
  const rgb = normalFromLuminance(pixels, nw, nh, strength, flipY)
  const cv = document.createElement('canvas')
  cv.width = nw
  cv.height = nh
  const cx = cv.getContext('2d')
  const idata = cx.createImageData(nw, nh)
  for (let i = 0; i < nw * nh; i++) {
    idata.data[i * 4] = rgb[i * 3]
    idata.data[i * 4 + 1] = rgb[i * 3 + 1]
    idata.data[i * 4 + 2] = rgb[i * 3 + 2]
    idata.data[i * 4 + 3] = 255
  }
  cx.putImageData(idata, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  // 采样参数沿用原来的 nearest / 无 mipmap, 朝向改成与 diffuse 相同
  tex.flipY = flipY
  tex.generateMipmaps = false
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  cache.set(cacheKey, tex)
  return tex
}
