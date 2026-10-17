import * as THREE from 'three'
import { createSharedUniforms, createBarkMaterial, createLeafMaterial } from './materials.js'

/**
 * 材质球预览 (Material Preview)
 * ------------------------------------------------------------
 * 一个独立的小 WebGL 渲染器 + 球体, 用**当前参数**烘焙出一张材质球图片 (dataURL),
 * 由 <MaterialPreview> 组件以 <img> 显示。这样:
 *   - 不干扰主渲染器 (独立 canvas / 独立材质实例)
 *   - 不需要每帧渲染 (只在参数变化时重画一次)
 * 用途: 直观看到树皮/树叶材质在没有光照环境干扰时长什么样。
 */

const SIZE = 128
let ctx = null

function ensure() {
  if (ctx) return ctx
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(SIZE, SIZE, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20)
  camera.position.set(0, 0, 3.1)
  camera.lookAt(0, 0, 0)

  // 三点光: 主光 + 补光 + 轮廓光 (看清法线/高光细节)
  const key = new THREE.DirectionalLight(0xffffff, 2.6)
  key.position.set(2.2, 2.6, 3.0)
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.7)
  fill.position.set(-2.6, 0.6, 1.4)
  const rim = new THREE.DirectionalLight(0xffe6c0, 0.9)
  rim.position.set(-1.2, -1.6, -2.4)
  scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.28))

  // 球体 + 立方体 (立方体便于看平铺/扭曲)
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), null)
  scene.add(sphere)

  ctx = { canvas, renderer, scene, camera, sphere, uniforms: null }
  return ctx
}

/**
 * 渲染材质球
 * @param {object} params 全量参数 (用到 params.bark / params.leafMat / params.leaves)
 * @returns {{bark: string, leaf: string, back?: string}|null} dataURL
 */
export function renderMaterialPreview(params) {
  const c = ensure()
  if (!c) return null
  try {
    const uniforms = createSharedUniforms(params)
    c.uniforms = uniforms
    const bark = createBarkMaterial(params, uniforms)
    const leaf = createLeafMaterial(params, uniforms)
    // 预览球上不需要风场/生长动画
    const out = {}
    for (const [name, mat] of [['bark', bark], ['leaf', leaf]]) {
      c.sphere.material = mat
      c.renderer.setRenderTarget(null)
      c.renderer.setClearColor(0x000000, 0)
      c.renderer.clear(true, true, true)
      c.renderer.render(c.scene, c.camera)
      out[name] = c.canvas.toDataURL('image/png')
      // 释放预览用材质 (纹理是缓存的, 不在这里释放)
      mat.dispose()
    }
    return out
  } catch (e) {
    return null
  }
}
