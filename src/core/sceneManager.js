/**
 * 场景管理: 渲染器 / 相机 / 灯光 / 天空 / 地面 / 导出 / 动画循环
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildTree } from './treeBuilder.js'
import {
  createSharedUniforms, createBarkMaterial, createLeafMaterial, createFlowerMaterial,
  updateMaterials, updateWindUniforms, updateGrowthUniforms, rebindCustomShader,
} from './materials.js'
import { exportGLB, exportOBJ, exportScreenshot } from './exporter.js'
import { buildParticlePoints, updateParticleMaterial } from './particles.js'
import { buildFallingLeaves, updateFallingLeaves, fallRebuildKey } from './fallingLeaves.js'
import { buildLeafLitter, litterRebuildKey } from './litter.js'
import { generateImpostor } from './impostor.js'
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
    this.flowerMesh = null
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
        flower: createFlowerMaterial(params, this.uniforms),
        uniforms: this.uniforms,
      }
    }
    return this.materials
  }

  updateMaterialParams(params) {
    this.updateParticles(params)
    this.updateFall(params)
    this.updateFlowerFall(params)
    this.updateLitter(params)
    this.updateFlowerLitter(params)
    const mats = this.ensureMaterials(params)
    updateMaterials(mats, params)
    if (this.barkMesh) this.barkMesh.material = mats.bark
    if (this.leafMesh) this.leafMesh.material = mats.leaf
    if (this.flowerMesh) this.flowerMesh.material = mats.flower || mats.leaf
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
    if (this.flowerMesh) {
      this.treeGroup.remove(this.flowerMesh)
      this.flowerMesh.geometry.dispose()
      // 花朵与树叶共用材质实例 -> 只释放几何, 不 dispose 材质
      this.flowerMesh.material = null
      this.flowerMesh = null
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
    // 花朵: 独立网格, 材质继承树叶 (基础功能继承) —— 与树叶是否启用无关
    if (result.flowerGeometry) {
      this.flowerMesh = new THREE.Mesh(result.flowerGeometry, this.materials.flower || this.materials.leaf)
      this.flowerMesh.castShadow = true
      this.flowerMesh.receiveShadow = false
      this.flowerMesh.name = 'Flowers'
      this.treeGroup.add(this.flowerMesh)
    }
    this.applyShadowFlags()
    // 叶片粒子发射 (从叶片位置采样发射点)
    this.rebuildParticles(params)
    // 落叶 (真实叶片卡片, 从树冠落下)
    this.rebuildFall(params)
    this.rebuildFlowerFall(params)
    // 地面落叶堆积
    this.rebuildLitter(params)
    this.rebuildFlowerLitter(params)

    if (this.wireBark || this.wireLeaf || (params.scene && params.scene.wireframe && params.scene.wireframe !== 'off')) {
      this.applyWireframe(params.scene && params.scene.wireframe)
    }

    // 重建会新建/重新显示 mesh -> 伪装卡预览期间必须重新隐藏, 否则与真树叠加
    this._rehideForImpostorPreview()

    this.stats = { ...result.stats, totalMs: performance.now() - t }
    const info = boxInfo(result.barkGeometry)
    this.treeHeight = Math.max(0.5, this.stats.height)
    this.treeSpread = Math.max(0.5, this.stats.spread || 1)
    this.treeCenter = info.center.clone()

    // 模型节点表 (节点树面板 + 选中高亮)
    this.nodes = result.nodes || []
    this.groups = result.groups || []

    if (opts.frameCamera !== false) this.frameCamera()
    if (this.callbacks.onStats) this.callbacks.onStats(this.stats)
    if (this.callbacks.onModel) this.callbacks.onModel({ nodes: this.nodes, groups: this.groups })
    return this.stats
  }

  /* ------------------------------------------------------------------ */
  /* 模型节点: 选中高亮 / 隔离 / 包围盒 / 聚焦                            */
  /* ------------------------------------------------------------------ */
  setSelection(sel) {
    const u = this.uniforms
    const hasTarget = (sel.ids && sel.ids.length > 0) || sel.material != null
    const modeMap = { highlight: 1, isolate: 2, dim: 3 }
    this.selectMode = hasTarget ? (modeMap[sel.mode] || 1) : 0
    u.uSelectMode.value = this.selectMode
    u.uSelectMaterial.value = sel.material === 'bark' ? 0 : sel.material === 'leaf' ? 1 : -1
    const ranges = sel.ranges || []
    const n = Math.min(8, ranges.length)
    u.uSelRangeCount.value = n
    for (let i = 0; i < 8; i++) {
      const v = u.uSelRanges.value[i]
      if (i < n) v.set(ranges[i][0], ranges[i][1])
      else v.set(0, -1)
    }
    u.uSelColor.value.set(sel.color || '#ffd166')
    u.uSelGlow.value = sel.glow === undefined ? 0.35 : sel.glow
    u.uSelDim.value = sel.dim === undefined ? 0.35 : sel.dim
    this.setSelectionBox(sel.box || null)
    this.applyShadowFlags()
  }

  /** 隔离模式下被隐藏的几何不该再投影 (阴影 pass 用的是独立depth材质, 看不到选中逻辑) */
  applyShadowFlags() {
    const isolate = this.selectMode === 2
    const on = !!this.shadowsEnabled && !isolate
    if (this.barkMesh) this.barkMesh.castShadow = on
    if (this.leafMesh) this.leafMesh.castShadow = on
  }

  /** 选中框 (世界坐标 min/max 数组) 或 null */
  setSelectionBox(box) {
    if (!box || !box.min || !box.max) {
      if (this.selBox) this.selBox.visible = false
      return
    }
    if (!this.selBox) {
      const b3 = new THREE.Box3()
      this.selBox = new THREE.Box3Helper(b3, 0xffd166)
      this.selBox.material.depthTest = false
      this.selBox.material.transparent = true
      this.selBox.material.opacity = 0.9
      this.selBox.renderOrder = 10
      this.scene.add(this.selBox)
    }
    this.selBox.box.min.set(box.min[0], box.min[1], box.min[2])
    this.selBox.box.max.set(box.max[0], box.max[1], box.max[2])
    this.selBox.visible = true
    this.selBox.updateMatrixWorld(true)
  }

  /** 把相机聚焦到某个包围盒 */
  focusBox(min, max) {
    if (!min || !max) return
    const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0.4)
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target)
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.5, 0.8)
    dir.normalize()
    this.controls.target.copy(c)
    this.camera.position.copy(c).addScaledVector(dir, size * 2.3)
    this.controls.update()
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
    // 线框展示模式 (展示三角面)
    const wire = s.wireframe || 'off'
    if (wire !== (this._wireMode || 'off')) {
      this._wireMode = wire
      if (this.barkMesh) this.applyWireframe(wire)
    }
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
    this.shadowsEnabled = !!s.shadows
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
    this.applyShadowFlags()
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

  /** 把相机的地面基交给风向指示器: 屏幕右方向 + 屏幕"远去"方向的水平投影 */
  getWindScreenBasis() {
    const m = this.camera.matrixWorld.elements
    const right = new THREE.Vector3(m[0], m[1], m[2]).normalize()
    const fwd = new THREE.Vector3(-m[8], -m[9], -m[10]) // 相机看向 -Z
    const fl = Math.hypot(fwd.x, fwd.z) || 1
    return {
      right: [right.x, right.y, right.z],
      fwd: [fwd.x / fl, 0, fwd.z / fl],
    }
  }

  /** 线框展示: off / overlay (实体+线框) / only (只看三角面) */
  applyWireframe(mode) {
    const m = mode || 'off'
    for (const key of ['wireBark', 'wireLeaf']) {
      if (this[key]) {
        this.treeGroup.remove(this[key])
        this[key].material.dispose()
        this[key] = null
      }
    }
    const solid = m === 'off'
    this.barkMesh.visible = true
    if (this.leafMesh) this.leafMesh.visible = true
    if (solid) {
      this.barkMesh.material.wireframe = false
      if (this.leafMesh) this.leafMesh.material.wireframe = false
      return
    }
    // overlay: 保留实体, 叠加线框; only: 只显示线框
    this.barkMesh.visible = m === 'overlay'
    if (this.leafMesh) this.leafMesh.visible = m === 'overlay'
    const mk = (geo, color) => {
      const mat = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = 2
      mesh.castShadow = false
      mesh.receiveShadow = false
      return mesh
    }
    this.wireBark = mk(this.barkMesh.geometry, 0x7fe0c0)
    this.treeGroup.add(this.wireBark)
    if (this.leafMesh) {
      this.wireLeaf = mk(this.leafMesh.geometry, 0xffd166)
      this.treeGroup.add(this.wireLeaf)
    }
  }

  /* ------------------------------------------------------------------ */
  /* 叶片粒子发射                                                        */
  /* ------------------------------------------------------------------ */
  rebuildParticles(params) {
    if (!this.treeGroup) return
    if (this.particles) {
      this.treeGroup.remove(this.particles)
      this.particles.geometry.dispose()
      this.particles.material.dispose()
      this.particles = null
    }
    const P = params.particles || {}
    if (!P.enabled || !this.leafMesh) return
    this.particles = buildParticlePoints(this.leafMesh.geometry, params, this.uniforms, params.seed)
    this.particles.renderOrder = 3
    this.treeGroup.add(this.particles)
  }

  /** 只改粒子参数 (不重建整树): 数量变化才重新采样, 其余只更新 uniform */
  updateParticles(params) {
    const P = params.particles || {}
    if (!this.particles) {
      if (P.enabled) this.rebuildParticles(params)
      return
    }
    this.particles.visible = !!P.enabled
    const want = Math.max(0, Math.round(P.count === undefined ? 240 : P.count))
    const have = this.particles.geometry.attributes.position.count
    if (want !== have) {
      this.rebuildParticles(params)
      return
    }
    updateParticleMaterial(this.particles.material, params, this.leafMesh ? this.leafMesh.geometry.boundingBox : null)
  }

  /* ------------------------------------------------------------------ */
  /* 落叶                                                                */
  /* ------------------------------------------------------------------ */
  rebuildFall(params) {
    if (!this.treeGroup) return
    if (this.fallMesh) {
      this.treeGroup.remove(this.fallMesh)
      this.fallMesh.geometry.dispose()
      this.fallMesh.material.dispose()
      this.fallMesh = null
    }
    const F = params.fall || {}
    if (!F.enabled || !this.leafMesh) return
    const geo = this.leafMesh.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    const followMap = params.leafMat && params.leafMat.texture ? (this.materials.leaf.map || null) : null
    this.fallMesh = buildFallingLeaves(geo, params, this.uniforms, followMap, geo.boundingBox)
    this.fallMesh.renderOrder = 2
    this.treeGroup.add(this.fallMesh)
  }

  updateFall(params) {
    const F = params.fall || {}
    if (!F.enabled) {
      if (this.fallMesh) this.fallMesh.visible = false
      return
    }
    // 贴图卡片/数量/宽高比变化时必须重建 (否则换贴图不生效 -> 看起来像"跟随树叶失效")
    const key = fallRebuildKey(params)
    if (!this.fallMesh || key !== this._fallKey) {
      this._fallKey = key
      this.rebuildFall(params)
      return
    }
    updateFallingLeaves(this.fallMesh, params)
  }

  /* ------------------------------------------------------------------ */
  /* 落花 / 落花堆积 (参照落叶实现, 参数/贴图独立)                       */
  /* ------------------------------------------------------------------ */
  /** 把花朵参数映射成落叶构建器认识的"fall 形状" */
  _flowerFallParams(params) {
    const FF = params.flowerFall || {}
    const F = params.flower || {}
    return {
      ...params,
      fall: { ...params.fall, ...FF },
      // 让重建键/取贴图都跟着"花朵贴图"走
      leafMat: { ...params.leafMat, texture: F.texture || '' },
    }
  }
  _flowerLitterParams(params) {
    const FL2 = params.flowerLitter || {}
    const F = params.flower || {}
    return {
      ...params,
      litter: { ...params.litter, ...FL2 },
      leafMat: { ...params.leafMat, texture: F.texture || '' },
    }
  }
  _flowerCanopyGeometry() {
    if (this.flowerMesh) return this.flowerMesh.geometry
    return this.leafMesh ? this.leafMesh.geometry : null
  }
  rebuildFlowerFall(params) {
    if (!this.treeGroup) return
    if (this.flowerFallMesh) {
      this.treeGroup.remove(this.flowerFallMesh)
      this.flowerFallMesh.geometry.dispose()
      this.flowerFallMesh.material.dispose()
      this.flowerFallMesh = null
    }
    const FF = params.flowerFall || {}
    if (!FF.enabled) return
    const geo = this._flowerCanopyGeometry()
    if (!geo) return
    if (!geo.boundingBox) geo.computeBoundingBox()
    const followMap = (this.materials.flower && this.materials.flower.map) || null
    const adapted = this._flowerFallParams(params)
    this.flowerFallMesh = buildFallingLeaves(geo, adapted, this.uniforms, followMap, geo.boundingBox)
    this.flowerFallMesh.renderOrder = 2
    this.treeGroup.add(this.flowerFallMesh)
  }
  updateFlowerFall(params) {
    const FF = params.flowerFall || {}
    if (!FF.enabled) {
      if (this.flowerFallMesh) this.flowerFallMesh.visible = false
      return
    }
    const adapted = this._flowerFallParams(params)
    const key = fallRebuildKey(adapted)
    if (!this.flowerFallMesh || key !== this._flowerFallKey) {
      this._flowerFallKey = key
      this.rebuildFlowerFall(params)
      return
    }
    updateFallingLeaves(this.flowerFallMesh, adapted)
  }
  rebuildFlowerLitter(params) {
    if (!this.treeGroup) return
    if (this.flowerLitterMesh) {
      this.treeGroup.remove(this.flowerLitterMesh)
      this.flowerLitterMesh.geometry.dispose()
      this.flowerLitterMesh.material.dispose()
      this.flowerLitterMesh = null
    }
    const FL2 = params.flowerLitter || {}
    if (!FL2.enabled) return
    const geo = this._flowerCanopyGeometry()
    if (!geo) return
    if (!geo.boundingBox) geo.computeBoundingBox()
    const followMap = (this.materials.flower && this.materials.flower.map) || null
    const adapted = this._flowerLitterParams(params)
    this.flowerLitterMesh = buildLeafLitter(adapted, followMap, geo.boundingBox)
    this.flowerLitterMesh.renderOrder = 1
    this.treeGroup.add(this.flowerLitterMesh)
  }
  updateFlowerLitter(params) {
    const FL2 = params.flowerLitter || {}
    if (!FL2.enabled) {
      if (this.flowerLitterMesh) this.flowerLitterMesh.visible = false
      return
    }
    const adapted = this._flowerLitterParams(params)
    const key = litterRebuildKey(adapted)
    if (!this.flowerLitterMesh || key !== this._flowerLitterKey) {
      this._flowerLitterKey = key
      this.rebuildFlowerLitter(params)
      return
    }
    this.flowerLitterMesh.visible = true
  }

  /* ------------------------------------------------------------------ */
  /* 地面落叶堆积                                                        */
  /* ------------------------------------------------------------------ */
  rebuildLitter(params) {
    if (!this.treeGroup) return
    if (this.litterMesh) {
      this.treeGroup.remove(this.litterMesh)
      this.litterMesh.geometry.dispose()
      this.litterMesh.material.dispose()
      this.litterMesh = null
    }
    const L = params.litter || {}
    if (!L.enabled) return
    const leafGeo = this.leafMesh ? this.leafMesh.geometry : null
    if (leafGeo && !leafGeo.boundingBox) leafGeo.computeBoundingBox()
    const followMap = params.leafMat && params.leafMat.texture ? (this.materials.leaf.map || null) : null
    this.litterMesh = buildLeafLitter(params, followMap, leafGeo ? leafGeo.boundingBox : null)
    this.litterMesh.renderOrder = 1
    this.treeGroup.add(this.litterMesh)
  }

  updateLitter(params) {
    const L = params.litter || {}
    if (!L.enabled) {
      if (this.litterMesh) this.litterMesh.visible = false
      return
    }
    const key = litterRebuildKey(params)
    if (!this.litterMesh || key !== this._litterKey) {
      this._litterKey = key
      this.rebuildLitter(params)
      return
    }
    this.litterMesh.visible = true
  }

  /* ------------------------------------------------------------------ */
  /* 伪装卡生成 (Impostor / Cross-card)                                  */
  /* ------------------------------------------------------------------ */
  makeImpostor(opts = {}) {
    // 生成前先撤掉上一张伪装卡:
    // 1) 它会让真树处于隐藏状态 -> 新图集拍不到树
    // 2) 它本身也在场景里 -> 会被拍进新图集 (卡里套卡 = 叠加态)
    if (this._impostorGroup) this.clearImpostorPreview()

    const box = new THREE.Box3()
    if (this.barkMesh) box.expandByObject(this.barkMesh)
    if (this.leafMesh) box.expandByObject(this.leafMesh)
    if (box.isEmpty()) throw new Error('还没有可用的树')
    const bbox = { min: box.min, max: box.max }
    const hide = [this.ground, this.grid, this.sky, this.particles, this.fallMesh, this.litterMesh, this.flowerMesh, this.flowerFallMesh, this.flowerLitterMesh, this._impostorGroup]
    return generateImpostor({
      renderer: this.renderer,
      scene: this.scene,
      bbox,
      hide,
      ...opts,
    })
  }

  /* ------------------------------------------------------------------ */
  /* 伪装卡 3D 预览 (可以像模型一样环绕 — 按相机方位角切图集帧)           */
  /* ------------------------------------------------------------------ */
  setImpostorPreview(result) {
    this.clearImpostorPreview()
    if (!result) return
    const meta = result.meta || {}
    const layout = meta.layout || { cols: 1, rows: 1 }
    const views = Math.max(1, meta.views || 1)
    const center = new THREE.Vector3(
      meta.center ? meta.center[0] : 0,
      meta.center ? meta.center[1] : 5,
      meta.center ? meta.center[2] : 0,
    )
    const r = Math.max(1, meta.radius || 5)
    const tex = new THREE.TextureLoader().load(result.dataUrl)
    this._impostorTexture = tex
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping

    const group = new THREE.Group()
    group.position.copy(center)
    const mkMat = (cell) => new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uGrid: { value: new THREE.Vector2(layout.cols, layout.rows) },
        uCell: { value: new THREE.Vector2(cell.x, cell.y) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D uMap; uniform vec2 uGrid; uniform vec2 uCell;
        varying vec2 vUv;
        void main(){
          vec2 cell = 1.0 / uGrid;
          vec2 uv = vec2((vUv.x + uCell.x) / uGrid.x, (vUv.y + uCell.y) / uGrid.y);
          vec4 c = texture2D(uMap, uv);
          if (c.a < 0.3) discard;
          gl_FragColor = c;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
    })
    // 渲染用的视锥在树心处的半高 = dist * tan(fov/2); 面片应与之一致, 这样和真树同尺寸
    const fov = (meta.fov || 18) * Math.PI / 180
    const tile = 2 * (meta.distance || r * 3) * Math.tan(fov / 2)
    const w = tile / 2
    const h = tile / 2
    if (meta.mode === 'cross') {
      // 交叉卡: 每行是一张面片贴图, 按各自角度摆放 -> 真的"从各角度看都是树"
      const angles = meta.angles || []
      angles.forEach((ang, i) => {
        const geo = new THREE.PlaneGeometry(w * 2, h * 2)
        const mat = mkMat(new THREE.Vector2(0, layout.rows - 1 - i))
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.y = (ang * Math.PI) / 180
        group.add(mesh)
      })
    } else {
      // 图集: 一张面片 + 按相机方位角切帧
      const geo = new THREE.PlaneGeometry(w * 2, h * 2)
      const mat = mkMat(new THREE.Vector2(0, 0))
      const mesh = new THREE.Mesh(geo, mat)
      mesh.userData.atlasCell = true
      group.add(mesh)
      this._impostorAtlas = { mesh, mat, layout, views, angles: meta.angles || [], azCount: layout.cols, elevations: meta.elevations || [0] }
    }
    this._impostorGroup = group
    this.scene.add(group)
    // 隐藏除灯光与伪装卡以外的一切 (不依赖固定名单: 后续重建出来的新对象也会被藏起来,
    // 否则真树和伪装卡会"叠加"显示)
    this._impostorHidden = []
    for (const obj of this.scene.children) {
      if (!obj.visible) continue
      if (obj === group) continue
      if (obj.isLight) continue
      this._impostorHidden.push(obj)
      obj.visible = false
    }
  }

  /** 重建后如果还在伪装卡预览状态, 把新对象重新藏起来 (否则会叠加真树) */
  _rehideForImpostorPreview() {
    if (!this._impostorGroup) return
    for (const obj of this.scene.children) {
      if (!obj.visible) continue
      if (obj === this._impostorGroup) continue
      if (obj.isLight) continue
      if (!this._impostorHidden.includes(obj)) this._impostorHidden.push(obj)
      obj.visible = false
    }
  }

  /** 每帧更新: 图集模式下按相机方位角 + 俯仰角选帧 */
  updateImpostorPreview() {
    const a = this._impostorAtlas
    if (!a || !this._impostorGroup) return
    const c = this._impostorGroup.position
    const cam = this.camera.position
    const dx = cam.x - c.x, dy = cam.y - c.y, dz = cam.z - c.z
    let ang = (Math.atan2(dx, dz) * 180) / Math.PI
    if (ang < 0) ang += 360
    // 俯仰角: 相机越高越接近俯视 (90 = 正俯视)
    const horiz = Math.hypot(dx, dz)
    const el = Math.abs(dy) < 1e-4 && horiz < 1e-4 ? 0 : (Math.atan2(dy, horiz) * 180) / Math.PI
    const azStep = 360 / Math.max(1, a.azCount)
    const col = Math.round(ang / azStep) % Math.max(1, a.azCount)
    // 选最接近的仰角层
    let row = 0
    let best = Infinity
    ;(a.elevations || [0]).forEach((e, i) => {
      const dd = Math.abs(e - el)
      if (dd < best) { best = dd; row = i }
    })
    a.mat.uniforms.uCell.value.set(col, a.layout.rows - 1 - row)
    // 面片始终转向相机 (球面 billboard): 否则绕到背面看到的是同一张图的**镜像**,
    // 看起来就像"只拍了 180°, 之后对称排列"。
    const upVec = Math.abs(el) > 88 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0)
    const mt = new THREE.Matrix4()
    mt.lookAt(cam, c, upVec)
    a.mesh.quaternion.setFromRotationMatrix(mt)
  }

  clearImpostorPreview() {
    if (this._impostorAtlas && this._impostorAtlas.mat) this._impostorAtlas.mat.dispose()
    if (this._impostorAtlas && this._impostorAtlas.mesh) this._impostorAtlas.mesh.geometry.dispose()
    if (this._impostorGroup) {
      this._impostorGroup.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose() } })
      this.scene.remove(this._impostorGroup)
    }
    if (this._impostorTexture) { this._impostorTexture.dispose(); this._impostorTexture = null }
    this._impostorGroup = null
    this._impostorAtlas = null
    for (const m of this._impostorHidden || []) m.visible = true
    this._impostorHidden = []
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
    this.updateImpostorPreview()
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
    if (this.selBox) {
      this.scene.remove(this.selBox)
      this.selBox.geometry.dispose()
      this.selBox.material.dispose()
      this.selBox = null
    }
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
