/**
 * 导出贴图管线：命名 / 补槽 / 成套对齐 / GLB 资源名修补
 * ============================================================================
 * 视口里的材质可以"缺贴图"（没有法线就靠标量参数、没有粗糙度就用材质标量），
 * 但交付给美术的 GLB 必须是一套**完整且成套**的资源，所以导出前会临时把材质
 * 补成 4 张图，导出结束后再原样恢复（每个 ensure* 都返回 `restore()`）。
 *
 * ## 资源命名
 *   <材质>_diff[_xk]   baseColor（sRGB）
 *   <材质>_alpha[_xk]  由 diffuse 的 alpha 通道烘出的黑白蒙版（白=不透明）
 *   <材质>_nor_gl[_xk] 切空间法线（OpenGL / glTF 约定）
 *   <材质>_rough[_xk]  灰度粗糙度（不是 glTF 默认的 G=rough / B=metal 合并图）
 * 只有长边恰好是 1024/2048/4096 时才追加 `_1k/_2k/_4k`；其它尺寸（512、216、
 * 非标准 3000…）不加后缀 —— 所以"四张图同尺寸"也等价于"四张图同后缀"。
 *
 * ## 管线阶段（顺序不可交换）
 *   1. `ensureExportMaterialMaps()`     补全缺失的 normalMap / roughnessMap
 *   2. `ensureExportTextureAlignment()` 以 diffuse 为基准，把四张图对齐成
 *      同尺寸 + 同 flipY + 同 UV 变换（叶/花/果，详见该函数注释）
 *   3. `ensureExportRoughnessGrayscale()` metalness=0 时复用同一张灰度
 *      roughnessMap，避免 glTF 把 roughness/metalness 合并成绿蓝图
 *   4. `applyExportTextureNames()`      写入 `<材质>_<role>[_xk]` 资源名，并挑出
 *      需要单独补 alpha 资源的材质（alphaAliases）
 *   5. `patchGlbTextureNames()`         GLB 落盘前补 `images[].name`，并把
 *      黑白 alpha PNG 作为独立 image 挂进 textures[]
 *
 * 调用方：`src/core/exporter.js` 的 `exportGLB()`（导出预览 `prepareExport`
 * 也走同一条链路）。撤销必须逆序（3 → 2 → 1）。
 *
 * ## 不变量（`dev/export-map-consistency-check.html` 在 GLB 内部图上逐条验）
 *   - 同一材质：diff / nor / rough / alpha 的 width×height 完全相等；
 *   - 同一材质：四张图的导出朝向一致（flipY 相同，引擎里叠在一起不上下镜像）；
 *   - 同一材质：nor / rough 的 offset/repeat/rotation 与 diff 相同
 *     （GLTFExporter 会写成 KHR_texture_transform，缺了图案就会错位）；
 *   - 资源名后缀与该材质 diffuse 的尺寸档位一致。
 *
 * 纯函数（`textureAssetName` / `textureResolutionK`）可在 Node 里直接单测；
 * 依赖 canvas/DOM 的部分在没有 `document` 的环境会安全返回空结果。
 */

import * as THREE from 'three'
import { normalFromLuminance } from './normalFromAlbedo.js'

/**
 * 角色 -> 文件名后缀。
 *
 * 命名约定（资源管线按这个顺序识别一整套贴图）：
 *   diff  -> `_diff`     baseColor / albedo，**sRGB** 颜色贴图
 *   alpha -> `_alpha`    由漫反射图的 A 通道烘出的黑白蒙版（白 = 不透明）
 *   normal-> `_nor_gl`   切空间法线，OpenGL 约定（+Y 朝上），**线性**数据
 *   rough -> `_rough`    灰度粗糙度（不是 glTF 默认的 G/B 合并图）
 * 用 `_nor_gl` 而不是 `_nor`：DCC 里 DirectX 与 OpenGL 的法线绿通道相反，
 * 后缀写全可以避免美术把图拖进引擎后"光照反了"。
 */
const ROLE_SUFFIX = {
  diff: '_diff',
  alpha: '_alpha',
  normal: '_nor_gl',
  rough: '_rough',
}

/**
 * 长边像素 -> 分辨率档位（写进文件名后缀）。
 *
 * 只有 1024 / 2048 / 4096 三个"标准档"才配后缀，其它尺寸一律 0（不写后缀）——
 * 因为 `_1k/_2k/_4k` 在资源管线里是"质量等级"的含义，给 512 或 3000 硬标一个
 * 档位会让下游按错误的尺寸做预算/降采样。用 Map 而不是 if 链，便于将来加档位。
 */
const SIZE_TO_K = new Map([
  [1024, 1],
  [2048, 2],
  [4096, 4],
])

/**
 * 读取贴图的像素尺寸，兼容三类 `image`：
 *   - HTMLImageElement / canvas（width/height）
 *   - `<img>` 未解码完成时（naturalWidth/naturalHeight）
 *   - HTMLVideoElement（videoWidth/videoHeight）
 *   - `DataTexture`（image = { data, width, height }）
 * 取不到时返回 0×0（调用方据此跳过该贴图，而不是抛错）。
 * 注意：这是"存储尺寸"，与纹理的 flipY / 显示缩放无关。
 */
function imageSize(texture) {
  const img = texture && (texture.image || (texture.source && texture.source.data))
  if (!img) return { width: 0, height: 0 }
  return {
    width: Math.max(0, Number(img.width || img.naturalWidth || img.videoWidth || 0)),
    height: Math.max(0, Number(img.height || img.naturalHeight || img.videoHeight || 0)),
  }
}

/**
 * 贴图的分辨率档位：长边恰为 1024/2048/4096 -> 1/2/4；其它尺寸返回 0。
 * 只看长边是刻意的：叶片卡片常是 216×215 这类"接近正方但非标准"的尺寸，
 * 命名里就不该出现 `_1k` 这种会误导资源管线的后缀。
 */
export function textureResolutionK(texture) {
  const { width, height } = imageSize(texture)
  const max = Math.max(width, height)
  return SIZE_TO_K.get(max) || 0
}

/**
 * 把材质名/kind 规整成"安全的资源名基名"。
 *
 * 文件名要能跨平台（Windows 不允许 `<>:"/\|?*`）、能在 URL 里直接使用、
 * 又不能以 `_` 或 `.` 开头（隐藏文件 / 被误认为扩展名）。
 * 规则：非法字符统一换成 `_` → 去掉首尾的 `_` → 空串回落到 'texture'。
 * 注意 `-` 与 `.` 是保留的：`leaf-01.preview` 这类名字本来就是允许的。
 *
 * @param {string} base 原始基名（通常是材质的 userData.kind）
 * @returns {string} 可安全写入文件名/URL 的基名，永不为空
 */
function safeBase(base) {
  return String(base || 'texture').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'texture'
}

/**
 * 把纹理的像素"按存储朝向"重绘到离屏 canvas，同时完成重采样。
 *
 * - 传入 width/height 时按目标尺寸缩放（缺省用原图尺寸）；
 * - **不应用 `texture.flipY`**：画布行 0 始终等于图片文件/画布的第 0 行。
 *   朝向由调用方决定 —— 需要"导出朝向"时另做一次翻转（见 `makeAlphaDataUrl`），
 *   需要"three 采样朝向"时把结果包成 flipY 相同的 CanvasTexture。
 * - 通过 `getImageData(0,0,1,1)` 主动触发一次读取：跨域图片 / 图片尚未解码
 *   完成时 drawImage 不会报错，但后续读取会抛 SecurityError，这里把它变成
 *   "返回 null"，让调用方走平坦兜底而不是让整个导出失败。
 *
 * @returns {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width: number, height: number}|null}
 */
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

/**
 * 从颜色贴图生成本地法线贴图（Sobel，和视口自动法线同一套算法，但**全尺寸**）。
 *
 * 和视口 `albedoNormalTexture()` 的区别（导出专用的原因）：
 *   - 视口版为省显存把长边压到 256，导出必须和 diffuse 同尺寸；
 *   - 这里的 `flipY` 继承源贴图（`texture.flipY`），保证导出的 nor 与 diff
 *     朝向一致；视口版历史上固定 flipY=false，会造成法线细节上下镜像。
 *
 * 读不到像素时返回 null，由调用方退回"平坦法线"（128,128,255）。
 *
 * @param {THREE.Texture} texture         源颜色贴图（提供尺寸 + 亮度场）
 * @param {number} width                  目标宽度（通常取 diffuse 尺寸）
 * @param {number} height                 目标高度
 * @param {number} [strength]             起伏强度（Sobel 梯度缩放，1 = 标准）
 * @returns {THREE.CanvasTexture|null}    flipY 与源贴图一致，colorSpace = NoColorSpace
 */
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
 * 从颜色贴图的亮度场推导粗糙度（**不是随机噪声**）：
 *
 *   粗糙度 = base + (0.5 - 亮度) * 0.42 + min(0.12, |∇亮度| * 0.8)
 *
 *   - 暗部/纹理沟槽 -> 更粗糙；亮部/光滑区域 -> 更光滑（叶面反光就是这个来源）；
 *   - 再叠加一个很弱的局部梯度项，让叶脉/花瓣边缘在掠射角下有细节，
 *     但不会把整张图变成噪声。
 *
 * 输出是**数据贴图**：RGB 三通道相同（灰白），`colorSpace = NoColorSpace`
 * （粗糙度是线性数据，不能按 sRGB 解码），`flipY` 用 CanvasTexture 默认的
 * true —— 与下面 `makeNormalTextureFromPixels` 的默认导出朝向一致，所以
 * rough 与 diff 在导出后天然同朝向。
 *
 * 尺寸由调用方传入（导出对齐时 = diffuse 尺寸）；读不到像素返回 null。
 *
 * @param {THREE.Texture} texture      源颜色贴图
 * @param {number} width               目标宽度
 * @param {number} height              目标高度
 * @param {number} [baseRoughness]     材质标量 roughness，作为亮度偏移基准
 * @returns {THREE.CanvasTexture|null}
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

/**
 * 由 diffuse 的 alpha 通道生成独立的黑白 alpha 资源（白 = 不透明，黑 = 透明）。
 *
 * GLB 里叶片/花朵仍用 `baseColor alpha 通道 + alphaMode: MASK` 表达裁切，这张
 * 图是给资源管线/引擎额外用的 `<kind>_alpha` 资产。
 *
 * **朝向**：GLTFExporter 写图片时会按 `texture.flipY` 决定是否上下翻转
 * （three 的 uv 原点在左下，glTF 在左上），而这张 alpha 是独立 data URI，
 * **不经过导出器**。所以这里必须自己做一次同样的翻转，否则引擎里
 * `leaf_alpha` 与 `leaf_diff` 上下镜像（曾实测 flower alpha 的"翻转版"IoU=1.0）。
 *
 * 输出为不透明 PNG（A=255，灰度写在 RGB），尺寸与传入的 width/height 一致；
 * 调用方通常传 diffuse 的尺寸（对齐阶段保证它等于四张图的公共尺寸）。
 * 读不到像素（跨域/未解码）时返回 null，调用方会退回"复用 diffuse image"。
 *
 * @param {THREE.Texture} texture  源颜色贴图（读其 alpha 通道）
 * @param {number} [width]         目标宽度（缺省 = 源图宽）
 * @param {number} [height]        目标高度（缺省 = 源图高）
 * @returns {string|null}          PNG data URL
 */
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
 * 给导出组里的标准材质贴图写资源名，并收集"需要额外补 alpha 资源"的材质。
 *
 * 每个材质按 `userData.kind`（bark / leaf / flower / fruit）作为资源前缀，
 * 依次给 `map / alphaMap / normalMap / roughnessMap` 命名：
 *   `leaf_diff` / `leaf_alpha` / `leaf_nor_gl` / `leaf_rough`（1K/2K/4K 加后缀）。
 *
 * 叶片/花朵/果实的 alpha 存在 baseColor 图的 alpha 通道里，GLB 的 alphaMode
 * 已经能正确裁切；但资源管线通常按 `_alpha` 后缀找单独的蒙版图，所以这里额外
 * 生成一个 `alphaAliases` 条目（同一分辨率的黑白 PNG data URL），稍后由
 * `patchGlbTextureNames()` 挂进 GLB。
 *
 * 注意：`alphaAliases[].dataUrl` 若材质自带 `userData.exportAlphaDataUrl`
 * （如果实材质由果皮高度场生成）就优先用它 —— 那种 alpha 是"沟槽蒙版"，
 * 不是简单的 silhouette。
 *
 * @param {THREE.Object3D} root 导出组（会遍历所有 mesh 的材质）
 * @returns {{
 *   manifest: Array<{name:string, kind:string, role:string, width:number, height:number, k:number}>,
 *   alphaAliases: Array<{name:string, from:string, width:number, height:number, dataUrl:(string|null)}>
 * }} manifest 供预览面板/自检展示，alphaAliases 供 patchGlbTextureNames 使用
 */
export function applyExportTextureNames(root) {
  const manifest = []
  const alphaAliases = []
  const seen = new Set()
  if (!root || typeof root.traverse !== 'function') return { manifest, alphaAliases }

  /**
   * 给一张贴图写资源名，并把它的尺寸信息记进 manifest（同名只记一次）。
   *
   * 写的是 `tex.name`：GLTFExporter 只把这个字段写进 `textures[].name`，
   * `images[].name` 的补全在后面 `patchGlbTextureNames()` 里按 source 反查。
   * 去重是必要的：树皮/叶片材质被多个 mesh 共享时，同一张贴图会被访问多次，
   * 不去重 manifest 里会出现大量重复条目。
   *
   * @param {string} kind 材质类型（bark / leaf / flower / fruit），作为资源名前缀
   * @param {string} role 资源角色（diff / alpha / normal / rough）
   * @param {THREE.Texture|null} tex 目标贴图；为空直接跳过
   * @returns {string|null} 写好的资源名（供 alpha 关联时引用）
   */
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

/**
 * GLB 容器常量（均为**小端** uint32 的字节序列解读）。
 *
 *   GLB_MAGIC  = 0x46546C67  文件魔数，实际字节是 ASCII "glTF"
 *   CHUNK_JSON = 0x4E4F534A  JSON 块类型，实际字节是 ASCII "JSON"
 * （BIN 块类型是 0x004E4942 = "BIN"，本文件不需要单独比对，只原样搬运。）
 */
const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a

/**
 * 解析 GLB 二进制头与所有 chunk，返回 `[{type, data}]`。
 *
 * GLB 二进制布局（规范 2.0，全部小端）：
 *   [0..3]   magic  = "glTF"
 *   [4..7]   version（本项目恒为 2，这里不校验）
 *   [8..11]  totalLength = 整个文件字节数
 *   [12..]   若干 chunk，每个 = 4 字节长度 + 4 字节类型 + 数据（数据长度已 4 字节对齐）
 * `total` 用文件头声明的总长而不是 `buffer.byteLength`：GLTFExporter 偶尔会在
 * 末尾留未对齐的填充，按声明长度截断可以避免把填充误当成一个 chunk。
 *
 * `data` 是 `Uint8Array` **视图**而不是拷贝（`new Uint8Array(buffer, off+8, len)`），
 * 这样解析 4K 贴图的 BIN 块时不会额外复制几十 MB；代价是调用方不能持有视图后
 * 再改写原 buffer —— 本文件的用法都是"读完立即重新拼装"，满足这个前提。
 *
 * @param {ArrayBuffer} buffer GLB 文件内容
 * @returns {Array<{type:number, data:Uint8Array}>} chunk 列表（含 JSON 与 BIN）
 * @throws {Error} 魔数不匹配（不是 GLB）
 */
function readGlb(buffer) {
  const dv = new DataView(buffer)
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not GLB')
  const total = dv.getUint32(8, true)
  const chunks = []
  let off = 12
  // `off + 8 <= total`：至少要有"长度 + 类型"8 字节才算一个 chunk 头，
  // 用 <= 而不是 < 是为了容忍最后一个 chunk 数据为空（长度 0）的合法情况。
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    const data = new Uint8Array(buffer, off + 8, len)
    chunks.push({ type, data })
    off += 8 + len
  }
  return chunks
}

/**
 * 按 chunk 列表重新拼装 GLB：写魔数、版本 2、总长，再逐个写"长度 + 类型 + 数据"。
 *
 * 调用方（`patchGlbTextureNames`）已保证 JSON chunk 被补齐到 4 字节对齐，
 * 所以这里**不再做二次对齐** —— 若传入未对齐的数据，产出的文件会被严格读取器拒绝。
 *
 * @param {Array<{type:number, data:Uint8Array}>} chunks chunk 列表
 * @returns {ArrayBuffer} 新的 GLB 二进制
 */
function writeGlb(chunks) {
  // 总长 = 12 字节头 + 每个 chunk 的 (8 字节头 + 数据)
  const total = 12 + chunks.reduce((n, c) => n + 8 + c.data.length, 0)
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, GLB_MAGIC, true)
  dv.setUint32(4, 2, true)          // version 恒为 2
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

/**
 * 把 JSON 块的字节补齐到 4 字节对齐。
 *
 * glTF 规范要求每个 chunk 的数据长度是 4 的倍数：
 *   - **JSON 块用空格 0x20 填充**（这样某些解析器可以直接当 JSON 文本读尾随空白）；
 *   - BIN 块才用 0x00 填充。
 * 已经对齐时**原样返回同一个引用**（省掉一次按 MB 计的拷贝）。
 *
 * @param {Uint8Array} bytes JSON 的 UTF-8 字节
 * @returns {Uint8Array} 对齐后的字节（可能是原引用）
 */
function padJson(bytes) {
  const pad = (4 - (bytes.length % 4)) % 4
  if (!pad) return bytes
  const out = new Uint8Array(bytes.length + pad)
  out.set(bytes)
  out.fill(0x20, bytes.length)      // 0x20 = 空格，不是 0
  return out
}

/**
 * 直接改 GLB 的 JSON 块，补两件事：
 *   1. `images[].name`：GLTFExporter 只把 `map.name` 写进 `textures[].name`，
 *      `images[]` 默认没有名字，DCC 里会看到一堆 `Image_0`。这里按 source 反查，
 *      把图片名补成和贴图同名，方便按名字替换资源。
 *   2. `<kind>_alpha` 资源：把 `applyExportTextureNames()` 收集的黑白 alpha PNG
 *      作为**独立 image**（data URI）追加，并新增一条 `textures[]`（沿用原贴图的
 *      sampler）。读像素失败时退回"复用 diffuse 的 image bufferView"，至少保证
 *      资源名存在（此时 alpha 图其实是彩图，属于降级方案）。
 *
 * 实现是对 GLB 二进制的纯字节操作：
 *   - 解析 12 字节头 + 若干 chunk（JSON / BIN），只替换 JSON chunk；
 *   - JSON 重新编码后按 glTF 规范补空格到 4 字节对齐（`padJson`）；
 *   - 重新写头里的 totalLength。BIN chunk 原样保留（不复制贴图二进制）。
 *
 * 任何一步失败（不是 GLB / JSON 解析失败 / 没有 textures）都原样返回输入，
 * 保证"命名修补"永远不会让一次成功导出的 GLB 变成坏文件。
 *
 * @param {ArrayBuffer} buffer               GLTFExporter.parse 产出的二进制
 * @param {Array<{name:string, from:string, dataUrl:(string|null)}>} alphaAliases
 * @returns {ArrayBuffer} 修补后的 GLB（失败时是原 buffer）
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

/**
 * 对外暴露的角色后缀表（供 UI/自检显示"这次导出会产出哪些后缀"）。
 * 与内部 ROLE_SUFFIX 是**同一个对象引用**，只读使用，不要修改。
 */
export const TEXTURE_ROLE_SUFFIX = ROLE_SUFFIX

/* ------------------------------------------------------------------ */
/* 导出材质补全: 没有 normal/rough 贴图时生成中性贴图资源               */
/* ------------------------------------------------------------------ */

/**
 * 用绘制回调造一张离屏 CanvasTexture（导出期的临时贴图工厂）。
 *
 * `colorSpace = NoColorSpace` 是刻意的：这个工厂只用于**法线/粗糙度**这类线性数据，
 * 若标成 sRGB，导出器会按颜色做一次编码，图里的 128/255 就会被改成别的值。
 * 没有 `document`（Node 自检）时返回 null，调用方会跳过补槽。
 *
 * @param {number} width 宽（px）
 * @param {number} height 高（px）
 * @param {(ctx: CanvasRenderingContext2D, w: number, h: number) => void} paint 绘制回调
 * @returns {THREE.CanvasTexture|null}
 */
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

/** 回退贴图取材质已有的贴图尺寸；一张都没有（或太小）时用 256×256。
 *  注意：这里只影响"补槽"的初始尺寸，真正的四图对齐在
 *  `ensureExportTextureAlignment()` 里以 diffuse 为准再做一次。 */
function fallbackSize(material) {
  const tex = material.map || material.normalMap || material.roughnessMap
  const { width, height } = imageSize(tex)
  if (width >= 32 && height >= 32) return { width, height }
  return { width: 256, height: 256 }
}

/**
 * 导出前临时补全材质槽，让 GLB 里每个材质都**真的引用** normal / roughness 资源：
 *
 *  - `normalMap` 缺失 → 从 diffuse 亮度场按 Sobel 生成（和视口自动法线同算法）；
 *    读不到像素（跨域/未解码）时退回**平坦法线**（128,128,255）——
 *    平坦法线不改变光照，但能保证资源名/槽位存在，美术可以按名替换。
 *  - `roughnessMap` 缺失 → 从 diffuse 亮度/梯度推导（暗=粗、亮=滑 + 边缘细节）；
 *    读不到时退回材质标量 roughness 的纯色图（同样是"占位但语义正确"）。
 *
 * 两点设计约束：
 *   - 只在**导出期间**生效：临时贴图会替换材质槽，导出结束必须调用返回的
 *     `restore()` 还原原槽位并 `dispose()` 临时贴图，否则会污染视口/泄漏显存。
 *   - 同一材质可能被多个 mesh 共享（Bark 拆出的多个节点），用 `seen` 去重，
 *     避免同一材质被替换两次导致 restore 只能还原成中间态。
 *
 * 这个阶段之后还会跑 `ensureExportTextureAlignment()` 做"四图同尺寸/同朝向"，
 * 所以这里不纠结尺寸是否等于 diffuse —— 对齐阶段会统一。
 *
 * @param {THREE.Object3D} root 导出组
 * @returns {() => void} restore：恢复材质槽 + 释放临时贴图
 */
export function ensureExportMaterialMaps(root) {
  const restore = []
  const seen = new Set()   // 材质去重：同一材质被多个 mesh 共享时只处理一次
  if (!root || typeof root.traverse !== 'function') return () => {}
  root.traverse((obj) => {
    if (!obj || !obj.isMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m || seen.has(m)) continue
      seen.add(m)
      const { width, height } = fallbackSize(m)
      if (!m.normalMap) {
        // 花朵的法线强度取 1.5：花瓣起伏比叶脉细密，1.0 在远处会看不出形。
        const strength = (m.userData && m.userData.kind) === 'flower' ? 1.5 : 1
        let tex = m.map ? makeNormalTextureFromTexture(m.map, width, height, strength) : null
        if (!tex) tex = makeFlatNormalTexture(width, height)
        if (tex) {
          m.normalMap = tex
          // previous 记 null（因为进入分支的前提就是没有 normalMap），
          // restore 里据此把槽位还原成"空"。
          restore.push({ material: m, key: 'normalMap', previous: null, texture: tex })
        }
      }
      if (!m.roughnessMap) {
        // 用材质标量 roughness 当亮度偏移基准，导出图的平均粗糙度才和视口一致。
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
      // 两个条件都要判断：
      //   - 槽位仍是"我们挂的那张" -> 还原（正常情况）；
      //   - 槽位被后续阶段置成 null（例如 ensureExportTextureAlignment 换图失败）-> 也还原，
      //     否则材质会永久处于"没有法线"的状态。
      // 若槽位已被别的代码换成第三张图，则**不动**它（避免覆盖别人的结果）；
      // 但无论走哪条分支，临时贴图都必须 dispose，否则每次导出都泄漏。
      if (r.material[r.key] === r.texture) r.material[r.key] = r.previous
      else if (r.material[r.key] === null) r.material[r.key] = r.previous
      r.texture.dispose()
    }
  }
}

/**
 * 让导出的 `_rough` 资源保持灰白，而不是 glTF 默认的 metal-rough 合并彩图。
 *
 * 原理：glTF 规定 `metallicRoughnessTexture` 的 **G = roughness、B = metalness**。
 * three 的 GLTFExporter 在只有 roughnessMap、没有 metalnessMap 时会自己合成一张
 * G/B 打包图（视觉上是绿/蓝图），美术拿去当灰度 roughness 用会全错。
 *
 * 做法：对 `metalness ≈ 0` 的材质，临时把 `metalnessMap` 指向同一张
 * `roughnessMap`。导出器于是原样使用这张灰度图（G=粗糙度、B=也等于粗糙度），
 * 但 glTF 材质里 `metallicFactor = 0`，着色器会忽略 B/G 的金属度通道，
 * 最终 `_rough` 资源保持灰白，并且直接可当独立粗糙度贴图使用。
 *
 * 条件里排除已显式设置 `metalnessMap` 的材质（树皮金属贴图等），不覆盖作者的意图。
 * 同样只在导出期间生效，必须调用返回的 `restore()`。
 *
 * @param {THREE.Object3D} root 导出组
 * @returns {() => void} restore
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
      // 三个条件：有粗糙度图、没有显式金属度图、金属度确实为 0。
      // 阈值用 1e-6 而不是 === 0：metalness 来自滑杆/存档，可能是 0.0000001 这种
      // 浮点残差，直接比 0 会漏掉"实际上就是非金属"的材质。
      if (m.roughnessMap && !m.metalnessMap && Math.abs(Number(m.metalness) || 0) < 1e-6) {
        m.metalnessMap = m.roughnessMap
        // previous 记 null：进入分支的前提就是没有 metalnessMap。
        restore.push({ material: m, previous: null })
      }
    }
  })
  return () => {
    for (const r of restore) {
      // 仍然指向同一张 roughnessMap 才还原 —— 若导出期间有别的阶段换了图，
      // 说明 metalnessMap 已不属于我们，盲目置空会破坏别人的设置。
      if (r.material.metalnessMap && r.material.metalnessMap === r.material.roughnessMap) {
        r.material.metalnessMap = r.previous
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 导出贴图成套对齐：同尺寸 + 同朝向 + 同 UV 变换                       */
/* ------------------------------------------------------------------ */

/**
 * 需要"四图成套对齐"的材质类型。
 *
 * 只对叶/花/果这些**卡片类**材质生效：它们的 diff/nor/rough/alpha 描述的是
 * 同一张表面（叶脉、花瓣、果皮），四张图错一张就会明显穿帮。
 * 树皮/树干不走这条路径 —— 树皮贴图是程序化/照片平铺，且允许 normal/rough
 * 与 diffuse 使用各自的平铺参数（KHR_texture_transform 由材质自身控制）。
 */
export const EXPORT_ALIGNED_KINDS = ['leaf', 'flower', 'fruit']
const ALIGNED_KINDS = new Set(EXPORT_ALIGNED_KINDS)

/**
 * 把一张贴图重采样到目标尺寸（内容朝向保持不变），返回新的 CanvasTexture。
 *
 * 用途：用户自带的法线/粗糙度贴图分辨率与卡片不一致时，把它缩放到 diffuse 尺寸，
 * 否则 GLB 里四张图尺寸不同（`_xk` 后缀也会不同），引擎里同一套 UV 的采样密度
 * 不一致。
 *
 * - 内容按**存储朝向**绘制（行 0 = 图顶），因此这里**不做任何翻转**；
 * - `flipY` 直接决定导出朝向：GLTFExporter 写图片时按它翻转，所以这里必须
 *   传目标朝向（= diffuse 的 flipY），才能让重采样后的图与 diff 同朝向；
 * - `colorSpace = NoColorSpace`：法线/粗糙度都是线性数据，不是颜色；
 * - 读不到像素（跨域/未解码/压缩纹理）返回 null，调用方会保留原贴图（宁可
 *   尺寸不一致，也不要凭空造一张错的）。
 *
 * @param {THREE.Texture} texture 源贴图
 * @param {number} width          目标宽
 * @param {number} height         目标高
 * @param {boolean} flipY         目标朝向（与 diffuse 一致）
 * @returns {THREE.CanvasTexture|null}
 */
function resampleExportMap(texture, width, height, flipY) {
  const src = drawTextureToCanvas(texture, width, height)
  if (!src) return null
  const tex = new THREE.CanvasTexture(src.canvas)
  tex.flipY = flipY !== false
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

/**
 * 把叶/花/果的四张导出贴图对齐成"成套资源"：同尺寸 + 同朝向 + 同 UV 变换。
 *
 * 背景：美术把 `leaf_diff / leaf_nor_gl / leaf_rough / leaf_alpha` 拖进引擎时，
 * 四张图通常是**同一套 UV**、按文件名成对识别的。只要其中一张分辨率、朝向
 * 或平铺参数不同，就会出现"叶脉和法线对不上 / 接缝错位 / 上下镜像"。
 * 视口里这些图可以由不同来源拼出来（自动法线、自带法线、程序化粗糙度），
 * 所以必须在导出前统一一次。
 *
 * 基准：该材质的 `map`（diff）。
 *   - 目标尺寸 = diffuse 的像素尺寸（不重采样 diffuse，避免掉画质）；
 *   - 目标朝向 = `diff.flipY`（GLTFExporter 会按这个值决定写入 GLB 时是否翻转，
 *     所以四张图必须相同）；
 *   - 目标 UV 变换 = diffuse 的 center/offset/repeat/rotation（导出器会写成
 *     `KHR_texture_transform`；不复制就会出现"贴图平铺了、法线没平铺"）。
 *
 * 逐项处理：
 *   1. **法线**
 *      - `userData.autoNormal` 为真（视口自动法线）：它是"长边 256 上限 +
 *        flipY=false"的省显存版本，尺寸和朝向都不合格 —— 直接按当前 diffuse
 *        **全尺寸重新生成**，强度用 `userData.autoNormalStrength`（由
 *        `applyAutoNormal()` 记录，和视口完全一致）。
 *      - 没有法线：从 diffuse 生成（强度 1），保证资源存在。
 *      - 用户自带法线：尺寸或朝向不符时重采样（不改变图案本身）。
 *   2. **粗糙度**：缺失时从 diffuse 生成（和视口同一套"暗=粗、亮=滑"推导）；
 *      尺寸或朝向不符时重采样。
 *   3. **UV 变换**：`normalMap / roughnessMap / alphaMap` 统一复制 diffuse 的
 *      center/offset/repeat/rotation（alphaMap 若存在；叶/花的 alpha 在 map 里）。
 *
 * 两个实现约束：
 *   - **只在导出期间生效**：所有替换都记录在 `swap`/`transforms` 里，返回的
 *     `restore()` 会把原贴图槽位/UV 参数放回去，并 `dispose()` 新建的临时贴图；
 *   - 同一材质可能被多个 mesh 共享，用 `seen` 去重，避免"替换两次、只能还原成
 *     中间态"。
 *
 * 限制（都是"宁可保留原样也不造假"）：
 *   - 没有 `document`（Node 环境）直接返回空 restore；
 *   - 材质没有 diffuse / diffuse 读不到尺寸时跳过该材质；
 *   - 压缩纹理（KTX2 等）无法用 canvas 重采样 —— 保持原贴图，需要调用方保证
 *     尺寸本来就一致（本项目目前不使用压缩纹理）。
 *
 * @param {THREE.Object3D} root 导出组（遍历所有 mesh 的材质）
 * @returns {() => void} restore：恢复贴图槽位 + UV 变换 + 释放临时贴图
 */
export function ensureExportTextureAlignment(root) {
  if (typeof document === 'undefined' || !root || typeof root.traverse !== 'function') return () => {}
  const swap = []        // 贴图槽位替换记录 { material, key, previous, texture }
  const transforms = []  // UV 变换备份 { texture, key, center, offset, repeat, rotation }
  const seen = new Set() // 材质去重（同一材质可能被多个节点共用）

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
      // 目标朝向：以 diffuse 为准。GLTFExporter 写 GLB 时按 texture.flipY 翻转，
      // 所以"四张图 flipY 相同" == "四张图在引擎里同朝向"。
      const flipY = diff.flipY !== false
      const target = { width: size.width, height: size.height }
      const sameSize = (tex) => {
        const s = imageSize(tex)
        return s.width === target.width && s.height === target.height
      }
      /** 把生成的贴图挂到材质槽上并记录回滚信息（wrap 也跟随 diffuse） */
      const put = (key, texture) => {
        if (!texture) return
        texture.flipY = flipY
        texture.wrapS = diff.wrapS
        texture.wrapT = diff.wrapT
        swap.push({ material: m, key, previous: m[key], texture })
        m[key] = texture
        m.needsUpdate = true
      }

      // ---- 法线：自动法线（视口的 256 上限 + flipY=false 版本）按当前 diffuse
      //      全尺寸重做；自带法线只在尺寸/朝向不符时重采样 ----
      const autoStrength = Number((m.userData && m.userData.autoNormalStrength) || 0)
      const isAuto = !!(m.userData && m.userData.autoNormal) && autoStrength > 0
      if (isAuto || !m.normalMap) {
        put('normalMap', makeNormalTextureFromTexture(diff, target.width, target.height, isAuto ? autoStrength : 1))
      } else if (!sameSize(m.normalMap) || m.normalMap.flipY !== flipY) {
        put('normalMap', resampleExportMap(m.normalMap, target.width, target.height, flipY))
      }

      // ---- 粗糙度：缺失则从 diffuse 推导（暗=粗、亮=滑 + 边缘细节），
      //      已有但尺寸/朝向不符则重采样 ----
      if (!m.roughnessMap) {
        put('roughnessMap', makeRoughnessTextureFromTexture(diff, target.width, target.height, m.roughness))
      } else if (!sameSize(m.roughnessMap) || m.roughnessMap.flipY !== flipY) {
        put('roughnessMap', resampleExportMap(m.roughnessMap, target.width, target.height, flipY))
      }

      // ---- UV 变换：以 diffuse 为基准。少了这一步，GLB 里 diff 带平铺/旋转、
      //      nor/rough 不带，引擎里就会出现"贴图转了、法线没转" ----
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
    // 先还原 UV（临时贴图还原后要跟着一起丢弃，顺序无所谓，但保持与创建相反）
    for (const t of transforms) {
      const tex = t.texture
      tex.center.copy(t.center)
      tex.offset.copy(t.offset)
      tex.repeat.copy(t.repeat)
      tex.rotation = t.rotation
    }
    // 再还原贴图槽位。只有"当前槽位仍是我们挂上去的那张"才回滚，避免覆盖
    // 导出期间其它代码对材质的修改（例如 ensureExportRoughnessGrayscale 的 metalnessMap）。
    for (const s of swap.reverse()) {
      if (s.material[s.key] === s.texture) s.material[s.key] = s.previous
      s.texture.dispose()
    }
  }
}

