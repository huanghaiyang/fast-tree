/**
 * 导出: GLB / OBJ / 参数 JSON / 截图
 */
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js'
import { applyExportTextureNames, patchGlbTextureNames, ensureExportMaterialMaps, ensureExportRoughnessGrayscale, ensureExportTextureAlignment } from './textureNaming.js'

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

/**
 * 导出 GLB（glTF 二进制，内嵌贴图）。
 *
 * 导出不是"直接 parse 一下"，而是先把材质临时补成一套完整资源再写文件，
 * 结束后**必须**恢复原材质（否则视口材质会被临时贴图污染，临时贴图也会泄漏显存）：
 *
 *   1. `ensureExportMaterialMaps`     补全缺失的 normalMap / roughnessMap
 *   2. `ensureExportTextureAlignment` 叶/花/果四张图对齐（同尺寸 + 同朝向 + 同 UV）
 *   3. `ensureExportRoughnessGrayscale` metalness=0 时让 `_rough` 保持灰白
 *   4. `applyExportTextureNames`      写入 `leaf_diff_1k` 这类资源名，收集 alpha 资源
 *   5. `GLTFExporter.parse`           真正写 GLB
 *   6. `patchGlbTextureNames`         字节层补 `images[].name` 与 `<kind>_alpha` 图
 *
 * 顺序约束（改动前先读这段）：
 *   - 对齐必须在"补槽"之后：补槽会新建 normal/rough，对齐要基于它们的最终尺寸；
 *   - 对齐必须在"命名"之前：命名按贴图尺寸决定 `_xk` 后缀，尺寸没对齐后缀就会错；
 *   - grayscale 必须在"对齐"之后：它复用 roughnessMap，若之后对齐再换图就会指向旧图；
 *   - 恢复必须**逆序**（3 → 2 → 1），否则 metalnessMap 可能指回一张已 dispose 的图。
 *
 * 失败路径（parse 报错 / 同步异常）同样执行 `restoreAll()`，保证异常时材质干净。
 *
 * @param {THREE.Object3D} root 导出组（只含 Bark / Leaves / Flowers）
 * @param {string} [filename]   下载文件名
 * @param {{download?: boolean}} [opts] `download: false` 时只返回 Blob（导出预览用）
 * @returns {Promise<Blob>} 生成的 GLB
 */
export function exportGLB(root, filename = 'fasttree.glb', opts = {}) {
  return new Promise((resolve, reject) => {
    // 各阶段返回自己的 restore()；这些临时贴图只在本次导出期间存在
    const restoreMaps = ensureExportMaterialMaps(root)
    const restoreAlign = ensureExportTextureAlignment(root)
    const restoreGrayscale = ensureExportRoughnessGrayscale(root)
    const naming = applyExportTextureNames(root)
    // 逆序恢复：先撤销 grayscale 借用的 metalnessMap，再撤销对齐的贴图替换，
    // 最后撤销补槽（此时补槽产生的临时贴图已经没有人引用）
    const restoreAll = () => {
      restoreGrayscale()
      restoreAlign()
      restoreMaps()
    }
    const exporter = new GLTFExporter()
    try {
      exporter.parse(
        root,
        (result) => {
          let data = result
          if (result instanceof ArrayBuffer) data = patchGlbTextureNames(result, naming.alphaAliases)
          const blob = data instanceof ArrayBuffer
            ? new Blob([data], { type: 'model/gltf-binary' })
            : new Blob([JSON.stringify(data)], { type: 'model/gltf+json' })
          restoreAll()
          if (opts.download !== false) downloadBlob(blob, filename)
          resolve(blob)
        },
        (err) => {
          restoreAll()
          reject(err)
        },
        { binary: true, onlyVisible: true, truncateDrawRange: false },
      )
    } catch (err) {
      restoreAll()
      reject(err)
    }
  })
}

/**
 * Wavefront OBJ 的浮点文法没有科学计数法; three 的 OBJExporter 直接输出 JS 数字,
 * 极小的坐标/法线分量会写成 "1e-7" 这种形式, 部分老 DCC/解析器不接受。
 * 这里把指数形式展开成纯小数 (只影响极小的数值, 几何精度损失可忽略)。
 */
export function expandExponentialNumbers(text) {
  if (!/[eE]/.test(text)) return text
  return text.replace(/(?<![\w.])-?\d+(?:\.\d+)?[eE][+-]?\d+(?![\w.])/g, (m) => {
    const v = Number(m)
    if (!Number.isFinite(v)) return m
    if (v === 0) return '0'
    const abs = Math.abs(v)
    const decimals = abs >= 1e-6 ? 9 : Math.min(24, Math.max(9, Math.ceil(-Math.log10(abs)) + 3))
    const s = v.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')
    return s === '-0' ? '0' : s
  })
}

export function exportOBJ(root, filename = 'fasttree.obj', opts = {}) {
  const text = expandExponentialNumbers(new OBJExporter().parse(root))
  if (opts.download !== false) downloadText(text, filename, 'text/plain')
  return text
}

export function buildParamsJSON(params) {
  const payload = {
    format: 'fast-tree/params',
    version: 1,
    seed: params.seed,
    params,
  }
  return { payload, text: JSON.stringify(payload, null, 2) }
}

export function exportParamsJSON(params, filename = 'fasttree-params.json') {
  const { payload, text } = buildParamsJSON(params)
  downloadText(text, filename, 'application/json')
  return payload
}

export function exportScreenshot(renderer, filename = 'fasttree.png') {
  return new Promise((resolve) => {
    renderer.domElement.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename)
      resolve(blob)
    }, 'image/png')
  })
}

/** 读取本地文件为文本 */
export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = reject
    fr.readAsText(file)
  })
}

/** 读取本地图片为 dataURL (供材质贴图使用) */
export function readImageAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = reject
    fr.readAsDataURL(file)
  })
}
