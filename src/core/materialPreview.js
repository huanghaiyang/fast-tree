import * as THREE from 'three'
import { createSharedUniforms, createBarkMaterial, createLeafMaterial, createFlowerMaterial } from './materials.js'

/**
 * 材质球预览 (实时 + 可拖动旋转)
 * ------------------------------------------------------------
 * 每个实例一个独立 WebGLRenderer + 球体, 画到传入的 <canvas> 上。
 * - setParams(params): 用当前参数重建材质并重绘 (贴图异步加载完会自动补画)
 * - 鼠标拖动: 相机绕球体旋转 (光照固定 -> 从各角度看高光/法线/贴图)
 * - 只在需要时渲染, 没有常驻 rAF 循环
 */

const RETRY_MS = [120, 350, 800, 1600]

export function createMaterialPreview(canvas, kind = 'bark') {
  if (!canvas || typeof document === 'undefined') return null
  const size = 96
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(size, size, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20)
  const light = new THREE.Group()
  const key = new THREE.DirectionalLight(0xffffff, 2.8)
  key.position.set(2.4, 2.8, 3.2)
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.75)
  fill.position.set(-2.8, 0.5, 1.6)
  const rim = new THREE.DirectionalLight(0xffe2b8, 1.0)
  rim.position.set(-1.0, -1.8, -2.6)
  light.add(key, fill, rim)
  scene.add(light, new THREE.AmbientLight(0xffffff, 0.3))

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), null)
  scene.add(mesh)

  let mat = null
  let yaw = 0.55
  let pitch = 0.28
  let drag = null
  let retryTimers = []

  function placeCamera() {
    const r = 3.05
    camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * r,
      Math.sin(pitch) * r,
      Math.cos(yaw) * Math.cos(pitch) * r,
    )
    camera.lookAt(0, 0, 0)
  }

  function render() {
    if (!mat) return
    placeCamera()
    renderer.setRenderTarget(null)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, true)
    renderer.render(scene, camera)
  }

  /** 贴图可能还没解码完 -> 过一会儿补画几次, 保证纹理真的出现在球上 */
  function scheduleRetries() {
    retryTimers.forEach(clearTimeout)
    retryTimers = RETRY_MS.map((ms) => setTimeout(render, ms))
  }

  function setParams(params) {
    const uniforms = createSharedUniforms(params)
    if (mat) mat.dispose()
    mat = kind === 'leaf'
      ? createLeafMaterial(params, uniforms)
      : kind === 'flower'
        ? createFlowerMaterial(params, uniforms)
        : createBarkMaterial(params, uniforms)
    mesh.material = mat
    // 贴图 onUpdate -> 立刻补画 (比定时重试更快)
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) {
      if (t) t.userData.__mpHook = true
    }
    render()
    scheduleRetries()
  }

  function onDown(e) {
    drag = { x: e.clientX, y: e.clientY }
    canvas.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }
  function onMove(e) {
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    drag = { x: e.clientX, y: e.clientY }
    yaw -= dx * 0.012                  // 左右拖 -> 绕 Y 轴
    pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.012))  // 上下拖 -> 俯仰
    render()
  }
  function onUp(e) {
    drag = null
    canvas.releasePointerCapture?.(e.pointerId)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.style.cursor = 'grab'

  return {
    setParams,
    render,
    dispose() {
      retryTimers.forEach(clearTimeout)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      if (mat) mat.dispose()
      mesh.geometry.dispose()
      renderer.dispose()
    },
    // 便于测试/外部控制
    getCamera: () => camera,
    rotateBy(dx, dy) {
      yaw -= dx * 0.012
      pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.012))
      render()
    },
  }
}
