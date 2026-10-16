/**
 * 场景管理: 渲染器 / 相机 / 灯光 / 天空 / 地面 / 导出 / 动画循环
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildTree } from './treeBuilder.js'
import {
  createSharedUniforms, createBarkMaterial, createLeafMaterial,
  updateMaterials, updateWindUniforms, updateGrowthUniforms, rebindCustomShader,
} from './materials.js'
import { exportGLB, exportOBJ, exportScreenshot } from './exporter.js'
import { boxInfo } from './mathUtils.js'

const SKY_VERT = /* glsl */`
varying vec3 vSkyPos;
void main() {
  vSkyPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const SKY_FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uOffset;
varying vec3 vSkyPos;
void main() {
  float h = normalize(vSkyPos + vec3(0.0, uOffset, 0.0)).y * 0.5 + 0.5;
  vec3 col = mix(uBottom, uTop, pow(clamp(h, 0.0, 1.0), 0.85));
  gl_FragColor = vec4(col, 1.0);
}`

export class TreeScene {
  constructor(container, callbacks = {}) {
    this.container = container
    this.callbacks = callbacks
    this.disposed = false
    this.stats = null
    this.growthValue = 1

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.debug.checkShaderErrors = true
    renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const vLog = gl.getShaderInfoLog(vs) || ''
      const fLog = gl.getShaderInfoLog(fs) || ''
      const pLog = gl.getProgramInfoLog(program) || ''
      if (this.callbacks.onShaderError) {
        this.callbacks.onShaderError([vLog, fLog, pLog].filter(Boolean).join('\n').trim() || 'unknown shader error')
      }
    }
    this.renderer = renderer
    container.appendChild(renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0d1117)
    this.scene.fog = new THREE.Fog(0x0d1117, 30, 140)

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000)
    this.camera.position.set(9, 7, 13)

    this.controls = new OrbitControls(this.camera, renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 4, 0)
    this.controls.maxPolarAngle = Math.PI * 0.495
    this.controls.minDistance = 0.5
    this.controls.maxDistance = 400

    // --- 天空穹顶 (跟随相机的渐变球; 半径远小于远裁剪面, 避免被裁出硬边) ---
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTop: { value: new THREE.Color(0x2a3c52) },
        uBottom: { value: new THREE.Color(0x111820) },
        uOffset: { value: 0.1 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), this.skyMat)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -1
    this.scene.add(this.sky)

    // --- 灯光 ---
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2118, 0.55)
    this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xfff2e0, 2.4)
    this.sun.position.set(12, 18, 8)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0008
    this.sun.shadow.normalBias = 0.03
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)
    this.fill = new THREE.DirectionalLight(0x9fc0ff, 0.35)
    this.fill.position.set(-10, 6, -9)
    this.scene.add(this.fill)

    // --- 地面 ---
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.96, metalness: 0.0 })
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), this.groundMat)
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    this.grid = new THREE.GridHelper(40, 40, 0x3a4150, 0x252a33)
    this.grid.position.y = 0.002
    this.grid.material.transparent = true
    this.grid.material.opacity = 0.55
    this.scene.add(this.grid)

    // --- 树 ---
    this.uniforms = createSharedUniforms()
    this.treeGroup = new THREE.Group()
    this.treeGroup.name = 'FastTree'
    this.scene.add(this.treeGroup)

    this.materials = null
    this.barkMesh = null
    this.leafMesh = null
    // three r186 起 THREE.Clock 已废弃, 这里自己计时
    this.lastTime = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000
    this.playing = true
    this.lastSample = 0
    this.windTimeScale = 1
    this.growthAuto = false
    this.growthSpeed = 0.35

    this._onResize = () => this.resize()
    this._ro = new ResizeObserver(this._onResize)
    this._ro.observe(container)
    this.resize()

    this._loop = () => this.tick()
    this._raf = requestAnimationFrame(this._loop)
  }

  resize() {
    const el = this.container
    const w = Math.max(1, el.clientWidth)
    const h = Math.max(1, el.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /* ------------------------------------------------------------------ */
  /* 材质                                                                */
  /* ------------------------------------------------------------------ */
  ensureMaterials(params) {
    if (!this.materials) {
      this.materials = {
        bark: createBarkMaterial(params, this.uniforms),
        leaf: createLeafMaterial(params, this.uniforms),
        uniforms: this.uniforms,
      }
    }
    return this.materials
  }

  updateMaterialParams(params) {
    const mats = this.ensureMaterials(params)
    updateMaterials(mats, params)
    if (this.barkMesh) this.barkMesh.material = mats.bark
    if (this.leafMesh) this.leafMesh.material = mats.leaf
  }

  rebindCustomShader(params) {
    const mats = this.ensureMaterials(params)
    rebindCustomShader(mats.bark, params, this.uniforms)
    rebindCustomShader(mats.leaf, params, this.uniforms)
  }

  updateWind(params) {
    updateWindUniforms(this.uniforms, params.wind)
    const bu = this.materials?.bark?.userData?.uniforms
    const lu = this.materials?.leaf?.userData?.uniforms
    if (bu) bu.uSway.value = params.wind.barkSway
    if (lu) {
      lu.uLeafFlutter.value = params.wind.leafFlutter
      lu.uLeafTwist.value = params.wind.leafTwist
    }
  }

  /* ------------------------------------------------------------------ */
  /* 几何                                                                */
  /* ------------------------------------------------------------------ */
  build(params, opts = {}) {
    const t = performance.now()
    const result = buildTree(params)
    this.ensureMaterials(params)
    updateMaterials(this.materials, params)

    if (this.barkMesh) {
      this.treeGroup.remove(this.barkMesh)
      this.barkMesh.geometry.dispose()
    }
    if (this.leafMesh) {
      this.treeGroup.remove(this.leafMesh)
      this.leafMesh.geometry.dispose()
      this.leafMesh = null
    }

    this.barkMesh = new THREE.Mesh(result.barkGeometry, this.materials.bark)
    this.barkMesh.castShadow = true
    this.barkMesh.receiveShadow = true
    this.barkMesh.name = 'Bark'
    this.treeGroup.add(this.barkMesh)

    if (result.leafGeometry) {
      this.leafMesh = new THREE.Mesh(result.leafGeometry, this.materials.leaf)
      this.leafMesh.castShadow = true
      this.leafMesh.receiveShadow = false
      this.leafMesh.name = 'Leaves'
      this.treeGroup.add(this.leafMesh)
    }

    this.stats = { ...result.stats, totalMs: performance.now() - t }
    const info = boxInfo(result.barkGeometry)
    this.treeHeight = Math.max(0.5, this.stats.height)
    this.treeSpread = Math.max(0.5, this.stats.spread || 1)
    this.treeCenter = info.center.clone()

    if (opts.frameCamera !== false) this.frameCamera()
    if (this.callbacks.onStats) this.callbacks.onStats(this.stats)
    return this.stats
  }

  frameCamera(padding = 1.35) {
    const h = this.treeHeight || 8
    const spread = this.treeSpread || h * 0.6
    const d = Math.max(h * padding, spread * 1.75)
    this.controls.target.set(0, h * 0.45, 0)
    this.camera.position.set(d * 0.62, h * 0.66, d * 0.78)
    this.camera.near = Math.max(0.03, h * 0.004)
    this.camera.far = Math.max(400, h * 60)
    this.camera.updateProjectionMatrix()
    this.controls.update()
    // 阴影相机贴合树木
    const size = h * 1.25
    this.sun.shadow.camera.left = -size
    this.sun.shadow.camera.right = size
    this.sun.shadow.camera.top = size
    this.sun.shadow.camera.bottom = -size
    this.sun.shadow.camera.near = 0.5
    this.sun.shadow.camera.far = size * 6
    this.sun.shadow.camera.updateProjectionMatrix()
  }

  /* ------------------------------------------------------------------ */
  /* 场景参数                                                            */
  /* ------------------------------------------------------------------ */
  updateScene(s) {
    this.scene.background = new THREE.Color(s.background)
    if (s.gradient) {
      this.sky.visible = true
      this.skyMat.uniforms.uTop.value.set(s.skyTop)
      this.skyMat.uniforms.uBottom.value.set(s.skyBottom)
    } else {
      this.sky.visible = false
    }
    this.ground.visible = !!s.ground
    this.groundMat.color.set(s.groundColor)
    this.grid.visible = !!s.grid
    this.renderer.toneMappingExposure = s.exposure
    this.controls.autoRotate = !!s.autoRotate
    this.controls.autoRotateSpeed = 0.8
    this.renderer.shadowMap.enabled = !!s.shadows
    this.sun.castShadow = !!s.shadows
    this.sun.intensity = s.sunIntensity === undefined ? 2.6 : s.sunIntensity
    this.hemi.intensity = s.ambient === undefined ? (s.gradient ? 0.7 : 0.4) : s.ambient
    if (s.fog) {
      const far = Math.max(60, (this.treeHeight || 8) * 14)
      this.scene.fog = new THREE.Fog(new THREE.Color(s.background), far * 0.35, far)
    } else {
      this.scene.fog = null
    }
    // 太阳位置
    const az = (s.sunAzimuth || 0) * Math.PI / 180
    const el = (s.sunElevation || 40) * Math.PI / 180
    const r = Math.max(12, (this.treeHeight || 8) * 2.4)
    this.sun.position.set(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r)
    this.sun.target.position.set(0, (this.treeHeight || 8) * 0.35, 0)
    this.sun.target.updateMatrixWorld()
    this.uniforms.uSunDir.value.copy(this.sun.position).normalize()
    this.uniforms.uSunColor.value.copy(this.sun.color).multiplyScalar(Math.min(1, this.sun.intensity / 2.5))
  }

  updateGrowth(growth, value) {
    this.growthValue = value
    updateGrowthUniforms(this.uniforms, growth, value)
  }

  /** 自动生长: 每帧把 uGrowth 从当前值推到 1 */
  setGrowthAuto(auto, speed) {
    this.growthAuto = !!auto
    if (speed) this.growthSpeed = speed
  }

  setPlaying(p) {
    this.playing = !!p
  }

  /* ------------------------------------------------------------------ */
  /* 导出                                                                */
  /* ------------------------------------------------------------------ */
  exportGLB(name) {
    return exportGLB(this.treeGroup, name)
  }

  exportOBJ(name) {
    return exportOBJ(this.treeGroup, name)
  }

  screenshot(name) {
    this.renderer.render(this.scene, this.camera)
    return exportScreenshot(this.renderer, name)
  }

  /* ------------------------------------------------------------------ */
  /* 循环                                                                */
  /* ------------------------------------------------------------------ */
  tick() {
    if (this.disposed) return
    this._raf = requestAnimationFrame(this._loop)
    const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000
    const dt = Math.min(0.05, Math.max(0, nowSec - this.lastTime))
    this.lastTime = nowSec
    if (this.playing) {
      this.uniforms.uTime.value += dt * (this.windTimeScale || 1)
    }
    if (this.growthAuto && this.growthValue < 1) {
      this.growthValue = Math.min(1, this.growthValue + dt * this.growthSpeed)
      this.uniforms.uGrowth.value = this.growthValue
      this.uniforms.uGrowthEnabled.value = 1
      if (this.callbacks.onGrowth) this.callbacks.onGrowth(this.growthValue)
    }
    this.sky.position.copy(this.camera.position)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    if (this.callbacks.onFrame) this.callbacks.onFrame(this.renderer.info.render)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this._raf)
    this._ro.disconnect()
    this.controls.dispose()
    this.barkMesh?.geometry.dispose()
    this.leafMesh?.geometry.dispose()
    this.materials?.bark?.dispose()
    this.materials?.leaf?.dispose()
    this.ground.geometry.dispose()
    this.groundMat.dispose()
    this.sky.geometry.dispose()
    this.skyMat.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}
