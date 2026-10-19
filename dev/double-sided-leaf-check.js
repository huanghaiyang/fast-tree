/* 双面叶片材质自检:
 * 用真实 createLeafMaterial 建一个平面, 正面/背面使用不同贴图和颜色,
 * 直接采样渲染像素, 证明正面/背面确实不同。 */
import * as THREE from 'three'
import { createLeafMaterial, createSharedUniforms, updateLeafMaterial, updateWindUniforms } from '../src/core/materials.js'
import { defaultParams, normalizeParams } from '../src/core/params.js'

const R = []
let fail = 0
const line = (s) => { R.push(s); document.getElementById('out').textContent = R.join('\n') }
const check = (name, cond, detail = '') => {
  if (!cond) fail++
  line((cond ? '✔ ' : '✘ ') + name + (detail ? ' — ' + detail : ''))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, timeout = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (fn()) return true } catch { /* ignore */ }
    await sleep(50)
  }
  return false
}
function solidDataURL(color) {
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const ctx = c.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 8, 8)
  return c.toDataURL('image/png')
}
const hex = (arr) => '#' + arr.map((v) => v.toString(16).padStart(2, '0')).join('')

const canvas = document.getElementById('c')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setPixelRatio(1)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b1118)
const camera = new THREE.OrthographicCamera(-1.15, 1.15, 0.85, -0.85, 0.1, 10)
camera.position.set(0, 0, 2)
const light = new THREE.AmbientLight(0xffffff, 1.4)
scene.add(light)

const params = normalizeParams(defaultParams())
params.leafMat.doubleSided = true
params.leafMat.backEnabled = true
params.leafMat.backColor = '#ffffff'
params.leafMat.tint = '#ffffff'
params.leafMat.tintMode = 'custom'
params.leafMat.vertexColorMix = 0
params.leafMat.translucency = 0
params.leafMat.specular = 0
params.leafMat.scatter = 0
params.leafMat.emissive = 0
params.leafMat.normalFromAlbedo = 0
params.leafMat.alphaTest = 0
params.leafMat.texture = solidDataURL('#ffffff')
params.leafMat.backTexture = solidDataURL('#3366ff')

const shared = createSharedUniforms()
updateWindUniforms(shared, { ...params.wind, enabled: false })
const mat = createLeafMaterial(params, shared)
const sharedState = { uniforms: shared }
const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), mat)
scene.add(plane)

function renderAndSample() {
  renderer.render(scene, camera)
  const src = renderer.domElement
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0)
  const px = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data
  return [px[0], px[1], px[2], px[3]]
}

setTimeout(async () => {
  try {
    await waitFor(() => mat.map && mat.map.image && mat.map.image.width > 0 &&
      mat.userData.backMap && mat.userData.backMap.image && mat.userData.backMap.image.width > 0, 10000)
    await sleep(200)
    check('材质使用双面渲染', mat.side === THREE.DoubleSide, 'side=' + mat.side)
    check('背面开关 uniform = 1', mat.userData.uniforms.uBackEnabled.value === 1)
    check('背面独立贴图已绑定', mat.userData.uniforms.uHasBackMap.value === 1 &&
      !!mat.userData.backMap, 'hasBack=' + mat.userData.uniforms.uHasBackMap.value)

    plane.rotation.y = 0
    // 预热一帧: 确保贴图在 GPU 上完成上传
    renderer.render(scene, camera)
    await sleep(150)
    const front = renderAndSample()
    plane.rotation.y = Math.PI
    const back = renderAndSample()
    check('正/背面像素确实不同', Math.abs(back[2] - front[2]) > 25 || Math.abs(back[0] - front[0]) > 25,
      `front=${hex(front)} back=${hex(back)}`)
    check('正面为白底贴图 (R≈G≈B 且非黑)', front[0] > 40 && front[1] > 40 && front[2] > 40 &&
      Math.abs(front[0] - front[1]) < 15 && Math.abs(front[1] - front[2]) < 15, hex(front))
    check('背面显示蓝色贴图 (B 明显更高)', back[2] > back[0] + 25 && back[2] > back[1] + 25, hex(back))

    // 切到"只换背面颜色" (无背面贴图)
    params.leafMat.backTexture = ''
    params.leafMat.backColor = '#ff5533'
    updateLeafMaterial(mat, params, shared)
    await waitFor(() => mat.userData.uniforms.uHasBackMap.value === 0, 3000)
    plane.rotation.y = Math.PI
    const backColorOnly = renderAndSample()
    check('无背面贴图时应用背面颜色 (偏红)', backColorOnly[0] > backColorOnly[1] + 25 && backColorOnly[0] > backColorOnly[2] + 25,
      hex(backColorOnly))
    check('关闭背面贴图后 hasBackMap=0', mat.userData.uniforms.uHasBackMap.value === 0)

    // 关闭双面独立材质 -> 背面恢复普通背面光照/正面贴图
    params.leafMat.backEnabled = false
    updateLeafMaterial(mat, params, shared)
    await sleep(200)
    plane.rotation.y = Math.PI
    const backNormal = renderAndSample()
    check('关闭后背面不再应用独立颜色', !(backNormal[0] > backNormal[1] + 25 && backNormal[0] > backNormal[2] + 25), hex(backNormal))
    check('关闭后 uBackEnabled=0', mat.userData.uniforms.uBackEnabled.value === 0)

    // 仅打开背面独立材质也应自动双面
    params.leafMat.doubleSided = false
    params.leafMat.backEnabled = true
    updateLeafMaterial(mat, params, shared)
    check('关闭双面渲染但开启背面材质 -> 自动 DoubleSide', mat.side === THREE.DoubleSide, 'side=' + mat.side)

    const shader = mat.userData.shader && mat.userData.shader.fragmentShader
    check('片元着色器已注入 gl_FrontFacing', !!shader && shader.includes('gl_FrontFacing') && shader.includes('uBackMap'))

    line('\n结果: ' + (fail ? 'DSLEAF-FAIL ' + fail : 'DSLEAF-OK'))
    document.title = (fail ? 'DSLEAF-FAIL(' + fail + ')' : 'DSLEAF-OK') + ' :: ' +
      R.filter((s) => s.startsWith('✘')).slice(0, 5).join(' | ')
  } catch (e) {
    document.title = 'DSLEAF-EX :: ' + (e && e.stack ? e.stack : e).toString().slice(0, 900)
    line('EX: ' + (e && e.stack ? e.stack : e))
  }
}, 800)
