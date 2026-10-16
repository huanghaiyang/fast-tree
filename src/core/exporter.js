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

export function exportOBJ(root, filename = 'fasttree.obj') {
  const text = new OBJExporter().parse(root)
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
