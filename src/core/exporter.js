/**
 * 导出: GLB / OBJ / 参数 JSON / 截图
 */
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js'

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

export function exportGLB(root, filename = 'fasttree.glb') {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter()
    exporter.parse(
      root,
      (result) => {
        const blob = result instanceof ArrayBuffer
          ? new Blob([result], { type: 'model/gltf-binary' })
          : new Blob([JSON.stringify(result)], { type: 'model/gltf+json' })
        downloadBlob(blob, filename)
        resolve(blob)
      },
      (err) => reject(err),
      { binary: true, onlyVisible: true, truncateDrawRange: false },
    )
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

export function exportOBJ(root, filename = 'fasttree.obj') {
  const text = expandExponentialNumbers(new OBJExporter().parse(root))
  downloadText(text, filename, 'text/plain')
  return text
}

export function exportParamsJSON(params, filename = 'fasttree-params.json') {
  const payload = {
    format: 'fast-tree/params',
    version: 1,
    seed: params.seed,
    params,
  }
  downloadText(JSON.stringify(payload, null, 2), filename, 'application/json')
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
