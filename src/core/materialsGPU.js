/**
 * WebGPU 材质系统 (TSL 版) —— materials.js 的 NodeMaterial 对应实现
 * ------------------------------------------------------------
 * 为什么需要这个文件:
 *   `materials.js` 靠 `onBeforeCompile` 往 MeshStandardMaterial 里注入 GLSL。
 *   WebGPURenderer 走 NodeMaterial/TSL 编译链, **完全忽略 onBeforeCompile**,
 *   于是风场/生长/苔藓/附生/选中这些效果会静默消失 (树还在, 但不动、不染色)。
 *   这里用 TSL 把同一套顶点动画与片元调制重新表达一遍。
 *
 * 设计取舍 (尽量少写第二份"参数解释"):
 *   - 每个 GPU 材质内部仍然创建一个对应的 legacy 材质 (materials.js 的 create*),
 *     所有贴图选择 / PBR 数值 / per-material uniform 的更新仍然走 materials.js 的
 *     update* 逻辑 —— 这里只在最后把结果"同步"到 NodeMaterial 上。
 *   - 因此本文件不重复实现 bark/leaf/flower 的参数含义, 只重复**着色器表达**。
 *
 * 与 WebGL 路径的已知差异 (可接受降级, UI 会提示):
 *   - 自定义 GLSL (custom shader) 不生效: TSL 无法直接嵌入 GLSL 片段;
 *   - 动态阴影: WebGPU 不使用 customDepthMaterial, 阴影里的树不随风摆动 (静态阴影正确);
 *   - Bloom / DOF: EffectComposer 是 WebGL 专用, WebGPU 下暂时跳过;
 *   - 叶片铰链用 TSL 的 Rodrigues 近似, 与 GLSL 版本公式一致。
 *
 * 对外 API 与 materials.js 对齐 (sceneManager 按后端二选一):
 *   createBarkMaterialGPU / createLeafMaterialGPU / createFlowerMaterialGPU
 *   updateMaterialsGPU(mats, params) / syncGpuUniforms(mats, sharedUniforms)
 *   createSkyMaterialGPU()  —— ShaderMaterial 天空穹顶的 Node 版本
 */

import * as THREE from 'three'
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import {
  attribute, uniform, vec2, vec3, vec4, float, uv,
  texture as sampleTexture, mat3, positionLocal, positionWorld, modelWorldMatrix,
  modelWorldMatrixInverse, cameraWorldMatrix, viewportSize, varying,
  normalWorld, frontFacing, cameraPosition, materialEmissive,
  mix, select, clamp, smoothstep, fract,
  sin, cos, pow, abs, max, length, normalize, dot, cross,
} from 'three/tsl'
import {
  createBarkMaterial, createLeafMaterial, createFlowerMaterial,
  updateBarkMaterial, updateLeafMaterial, updateFlowerMaterial,
} from './materials.js'

/**
 * 把树的自定义顶点属性打包进**一个** InterleavedBuffer。
 *
 * 为什么必须做: WebGPU 的 maxVertexBuffers 只有 8, 而 three 的 WebGPU 后端
 * **每个 BufferAttribute 占一个 vertex buffer** (不按底层内存合并)。树皮/树叶
 * 至少用到 position/normal/uv/color + aWind/aPhase/aOrigin/aGrow/aNodeId(+/aEpiphyte),
 * 一共 9~10 个, 会直接报:
 *   "Vertex buffer count (9) exceeds the maximum number of vertex buffers (8)"
 * 并把整条 render pipeline 作废 (树不显示/极卡)。
 *
 * 打包后 6 个自定义属性共享 1 个 buffer, 总数降到 5, 且 WebGL/WebGL2 后端也支持
 * InterleavedBuffer, 所以只在 Node 渲染路径调用, 不影响原 WebGL 路径的几何。
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {THREE.BufferGeometry} 同一个 geometry (就地替换属性)
 */
export function interleaveGpuAttributes(geometry) {
  if (!geometry || !geometry.attributes) return geometry
  const NAMES = ['aWind', 'aPhase', 'aOrigin', 'aGrow', 'aNodeId', 'aEpiphyte']
  const SIZES = { aWind: 1, aPhase: 1, aOrigin: 3, aGrow: 2, aNodeId: 1, aEpiphyte: 1 }
  const first = geometry.attributes[NAMES[0]]
  if (!first) return geometry
  if (first.isInterleavedBufferAttribute) return geometry
  const count = first.count
  const stride = NAMES.reduce((n, name) => n + SIZES[name], 0)
  const data = new Float32Array(count * stride)
  for (let i = 0; i < count; i++) {
    let o = i * stride
    for (const name of NAMES) {
      const a = geometry.attributes[name]
      const size = SIZES[name]
      if (a) {
        // 自定义属性都是 Float32; 缺失的属性补 0 (例如花朵几何没有 aEpiphyte)
        for (let k = 0; k < size; k++) data[o + k] = a.array[i * size + k]
      }
      o += size
    }
  }
  const ib = new THREE.InterleavedBuffer(data, stride)
  let offset = 0
  for (const name of NAMES) {
    geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(ib, SIZES[name], offset))
    offset += SIZES[name]
  }
  return geometry
}

/** 1×1 白色纹理: 没有贴图时仍要绑定一个有效 sampler (同 materials.js 的 whitePixelTexture)。 */
let _white = null
function whiteTexture() {
  if (!_white) {
    _white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat)
    _white.colorSpace = THREE.NoColorSpace
    _white.needsUpdate = true
  }
  return _white
}

/**
 * 创建材质用到的所有 TSL uniform 节点。
 *
 * 注意它们是**副本**: 每帧由 syncGpuUniforms() 从 materials.js 的共享/材质
 * uniform 表里拷值。这样做的好处是两边数据结构完全不用改, 代价是每帧几十次
 * 赋值 (可忽略), 而且 WebGL/WebGPU 可以共用同一套参数更新代码。
 */
function createNodeUniforms() {
  return {
    // ---- 共享: 时间 / 风场 ----
    time: uniform(0),
    windDir: uniform(new THREE.Vector2(1, 0)),
    windStrength: uniform(0.12),
    windSpeed: uniform(0.8),
    windFrequency: uniform(1),
    gust: uniform(0.35),
    gustSpeed: uniform(0.16),
    turbulence: uniform(0.12),
    spatialScale: uniform(0.22),
    windBias: uniform(0.3),
    flexFalloff: uniform(1.5),
    windEnabled: uniform(1),
    // ---- 共享: 生长 / 种子 ----
    growth: uniform(1),
    growthEnabled: uniform(0),
    seed: uniform(0),
    // ---- 共享: 太阳 / 选中 ----
    sunDir: uniform(new THREE.Vector3(0.5, 1, 0.35).normalize()),
    sunColor: uniform(new THREE.Color(1, 0.96, 0.9)),
    selectMode: uniform(0),
    selectMaterial: uniform(-1),
    selRangeCount: uniform(0),
    selRanges: Array.from({ length: 8 }, () => uniform(new THREE.Vector2(0, -1))),
    selColor: uniform(new THREE.Color('#ffd166')),
    selGlow: uniform(0.35),
    selDim: uniform(0.35),
    // ---- 材质私有 ----
    sway: uniform(1),
    leafFlutter: uniform(0),
    leafTwist: uniform(0),
    vertexColorMix: uniform(1),
    tint: uniform(new THREE.Color('#ffffff')),
    translucency: uniform(0),
    specular: uniform(0),
    specularShininess: uniform(28),
    specularColor: uniform(new THREE.Color('#ffffff')),
    scatter: uniform(0),
    scatterPower: uniform(2),
    backEnabled: uniform(0),
    backColor: uniform(new THREE.Color('#b9d49a')),
    hasBackMap: uniform(0),
    // 苔藓 (仅树皮)
    mossEnabled: uniform(0),
    mossCoverage: uniform(0.6),
    mossScale: uniform(6),
    mossHeightBias: uniform(0.35),
    mossColor: uniform(new THREE.Color('#4c6b32')),
    mossTexEnabled: uniform(0),
    mossTexRepeat: uniform(2),
    // 附生植物 (仅树叶)
    epiphyteEnabled: uniform(0),
    // 主贴图 UV 变换 (repeat/offset/rotation, 与 WebGL 的 texture.matrix 等价)
    mapMatrix: uniform(new THREE.Matrix3()),
  }
}

/** 从 legacy 材质同步 PBR 标量/贴图属性 (不含 uniform, 那些每帧同步)。 */
function refreshFromLegacy(mat) {
  const legacy = mat.userData.legacy
  if (!legacy) return
  mat.map = legacy.map || null
  mat.normalMap = legacy.normalMap || null
  mat.normalScale.copy(legacy.normalScale)
  mat.roughnessMap = legacy.roughnessMap || null
  mat.roughness = legacy.roughness
  mat.metalness = legacy.metalness
  mat.side = legacy.side
  mat.transparent = legacy.transparent
  mat.opacity = legacy.opacity
  mat.emissive.copy(legacy.emissive)
  mat.emissiveIntensity = legacy.emissiveIntensity
  const at = legacy.alphaTest || 0
  if ((mat.alphaTest > 0) !== (at > 0)) mat.needsUpdate = true
  mat.alphaTest = at
  // 贴图节点换图后需要重建 NodeMaterial 的纹理绑定
  const tn = mat.userData.texNodes
  if (tn) {
    if (tn.map.value !== (legacy.map || whiteTexture())) {
      tn.map.value = legacy.map || whiteTexture()
      mat.needsUpdate = true
    }
    tn.back.value = legacy.userData.uniforms.uBackMap.value || whiteTexture()
    tn.moss.value = legacy.userData.uniforms.uMossMap.value || whiteTexture()
    tn.epi.value = legacy.userData.uniforms.uEpiphyteMap.value || whiteTexture()
  }
  const srcMap = legacy.map || whiteTexture()
  srcMap.updateMatrix && srcMap.updateMatrix()
  mat.userData.nodeUniforms.mapMatrix.value.copy(srcMap.matrix)
}

/**
 * 逐帧同步 uniform 值 (共享层 + 材质私有层) 与贴图变换。
 *
 * 之所以放在渲染前而不是 update* 里: uTime 是每帧推进的, 而风场滑杆可能在任何
 * 时刻改; 统一在 _renderFrame 前同步一次最省心, 且开销只有几十次赋值。
 *
 * @param {{bark:Object, leaf:Object, flower:Object}} mats
 * @param {Object} shared createSharedUniforms() 的结果
 */
export function syncGpuUniforms(mats, shared) {
  if (!mats || !shared) return
  for (const key of ['bark', 'leaf', 'flower']) {
    const mat = mats[key]
    if (!mat || !mat.userData || !mat.userData.nodeUniforms) continue
    syncOne(mat, shared)
  }
}

/** 单个材质的 uniform 同步。 */
function syncOne(mat, shared) {
  const U = mat.userData.nodeUniforms
  const mu = mat.userData.uniforms || {}
  // ---- 共享层 ----
  U.time.value = shared.uTime.value
  U.windDir.value.copy(shared.uWindDir.value)
  U.windStrength.value = shared.uWindStrength.value
  U.windSpeed.value = shared.uWindSpeed.value
  U.windFrequency.value = shared.uWindFrequency.value
  U.gust.value = shared.uGust.value
  U.gustSpeed.value = shared.uGustSpeed.value
  U.turbulence.value = shared.uTurbulence.value
  U.spatialScale.value = shared.uSpatialScale.value
  U.windBias.value = shared.uWindBias.value
  U.flexFalloff.value = shared.uFlexFalloff.value
  U.windEnabled.value = shared.uWindEnabled.value
  U.growth.value = shared.uGrowth.value
  U.growthEnabled.value = shared.uGrowthEnabled.value
  U.seed.value = shared.uSeed.value
  U.sunDir.value.copy(shared.uSunDir.value)
  U.sunColor.value.copy(shared.uSunColor.value)
  U.selectMode.value = shared.uSelectMode.value
  U.selectMaterial.value = shared.uSelectMaterial.value
  U.selRangeCount.value = shared.uSelRangeCount.value
  for (let i = 0; i < 8; i++) U.selRanges[i].value.copy(shared.uSelRanges.value[i])
  U.selColor.value.copy(shared.uSelColor.value)
  U.selGlow.value = shared.uSelGlow.value
  U.selDim.value = shared.uSelDim.value
  // ---- 材质私有层 ----
  if (mu.uSway) U.sway.value = mu.uSway.value
  if (mu.uLeafFlutter) U.leafFlutter.value = mu.uLeafFlutter.value
  if (mu.uLeafTwist) U.leafTwist.value = mu.uLeafTwist.value
  if (mu.uVertexColorMix) U.vertexColorMix.value = mu.uVertexColorMix.value
  if (mu.uTint) U.tint.value.copy(mu.uTint.value)
  if (mu.uTranslucency) U.translucency.value = mu.uTranslucency.value
  if (mu.uSpecular) U.specular.value = mu.uSpecular.value
  if (mu.uSpecularShininess) U.specularShininess.value = mu.uSpecularShininess.value
  if (mu.uSpecularColor) U.specularColor.value.copy(mu.uSpecularColor.value)
  if (mu.uScatter) U.scatter.value = mu.uScatter.value
  if (mu.uScatterPower) U.scatterPower.value = mu.uScatterPower.value
  if (mu.uBackEnabled) U.backEnabled.value = mu.uBackEnabled.value
  if (mu.uBackColor) U.backColor.value.copy(mu.uBackColor.value)
  if (mu.uHasBackMap) U.hasBackMap.value = mu.uHasBackMap.value
  if (mu.uMossEnabled) U.mossEnabled.value = mu.uMossEnabled.value
  if (mu.uMossCoverage) U.mossCoverage.value = mu.uMossCoverage.value
  if (mu.uMossScale) U.mossScale.value = mu.uMossScale.value
  if (mu.uMossHeightBias) U.mossHeightBias.value = mu.uMossHeightBias.value
  if (mu.uMossColor) U.mossColor.value.copy(mu.uMossColor.value)
  if (mu.uMossTexEnabled) U.mossTexEnabled.value = mu.uMossTexEnabled.value
  if (mu.uMossTexRepeat) U.mossTexRepeat.value = mu.uMossTexRepeat.value
  if (mu.uEpiphyteEnabled) U.epiphyteEnabled.value = mu.uEpiphyteEnabled.value
  // UV 变换: 主贴图每帧可能被 rebuild 换掉, 顺手保持一致
  const src = mat.userData.legacy && mat.userData.legacy.map
  if (src) {
    src.updateMatrix && src.updateMatrix()
    U.mapMatrix.value.copy(src.matrix)
  }
}

/** 生成"跟随贴图 UV 变换"的 uv 节点。 */
function transformedUv(U) {
  return mat3(U.mapMatrix).mul(vec3(uv(), 1)).xy
}

/**
 * 顶点动画节点: 生长 -> 风场 -> 叶片铰链。
 *
 * 公式与 materials.js 的 vertexBody() 一一对应, 只是用 TSL 表达:
 *   growK = smoothstep(0..1, (uGrowth - aGrow.x) / (aGrow.y - aGrow.x))
 *   pos   = mix(aOrigin, position, mix(1, growK, uGrowthEnabled))
 *   风场  = 顺风主波 + 高频次波 + 阵风 + 湍流, 位移只沿下风向
 *   叶片  = 叶柄固定, 弯曲 + 绕水平轴铰链式俯仰
 *
 * @returns {{position: Object, wind: Object}} position 为顶点最终位置, wind 为柔度 varying
 */
function buildPositionNodes(U, isLeaf) {
  const aWind = attribute('aWind', 'float')
  const aPhase = attribute('aPhase', 'float')
  const aOrigin = attribute('aOrigin', 'vec3')
  const aGrow = attribute('aGrow', 'vec2')

  const growK = clamp(
    U.growth.sub(aGrow.x).div(max(aGrow.y.sub(aGrow.x), float(1e-4))),
    0, 1,
  )
  const smoothK = growK.mul(growK).mul(float(3).sub(growK.mul(2)))
  const growMix = mix(float(1), smoothK, U.growthEnabled)
  let pos = mix(aOrigin, positionLocal, growMix)

  const windDir = normalize(U.windDir.add(vec2(1e-5, 1e-6)))
  const windPerp = vec2(windDir.y.mul(-1), windDir.x)
  const flex = pow(clamp(aWind, 0, 1), U.flexFalloff)
  const world = modelWorldMatrix.mul(vec4(pos, 1))
  const phase = aPhase
    .add(dot(vec2(world.x, world.z), windDir).mul(U.spatialScale))
    .add(U.seed.mul(0.017))
  const tw = U.time.mul(U.windSpeed)
  const freq = max(U.windFrequency, 0.05)
  // 顺风主波 + 高频次波
  const wave = sin(tw.add(phase)).mul(0.72)
    .add(sin(tw.mul(2.17).mul(freq).add(phase.mul(1.7))).mul(0.28))
  const osc = wave.mul(0.5).add(0.5)
  // 阵风: 压低摆动区间的低谷
  const gust = float(1).sub(
    U.gust.mul(0.6).mul(float(1).sub(sin(tw.mul(U.gustSpeed).add(phase.mul(0.21))).mul(0.5).add(0.5))),
  )
  const along = osc.mul(gust).add(U.windBias.mul(0.35))
  const turb = sin(tw.mul(3.1).mul(freq).add(phase.mul(4.3)))
  const sway = windDir.mul(along).add(windPerp.mul(turb).mul(U.turbulence))
  const amount = U.windStrength.mul(U.sway).mul(flex).mul(U.windEnabled)
  pos = vec3(pos.x.add(sway.x.mul(amount)), pos.y, pos.z.add(sway.y.mul(amount)))

  if (isLeaf) {
    // 叶片: 叶柄固定, 下风向弯曲 + 绕水平轴 (垂直于风向) 铰链俯仰。
    const rel = pos.sub(aOrigin)
    const stemDist = length(rel)
    const flap = sin(tw.mul(4.1).mul(freq).add(phase.mul(6.3)))
    const surge = sin(tw.mul(1.35).add(phase.mul(2.1)))
    const leafAmp = U.leafFlutter.mul(U.windStrength).mul(1.8).mul(U.windEnabled).mul(aWind.add(0.35))
    const bendDir = normalize(vec3(windDir.x, -0.3, windDir.y))
    let rel2 = rel.add(bendDir.mul(stemDist.mul(leafAmp).mul(flap.mul(0.35).add(surge.mul(0.15)).add(0.5))))
    const pitch = flap.mul(U.leafTwist).mul(0.5).mul(U.windEnabled)
      .mul(U.windStrength.mul(2).add(0.35))
    // 罗德里格旋转: v*cos + (axis×v)*sin + axis*(axis·v)*(1-cos)
    const axis = vec3(windPerp.x, 0, windPerp.y)
    const c = cos(pitch)
    const s = sin(pitch)
    rel2 = rel2.mul(c)
      .add(cross(axis, rel2).mul(s))
      .add(axis.mul(dot(axis, rel2)).mul(float(1).sub(c)))
    pos = aOrigin.add(rel2)
  }

  return { position: pos, wind: flex }
}

/**
 * 构造一个 GPU 材质的节点图。
 *
 * @param {'bark'|'leaf'|'flower'} kind 材质类型
 * @param {Object} params 全局参数树
 * @param {Object} shared 共享 uniforms
 * @returns {MeshStandardNodeMaterial}
 */
function buildGpuMaterial(kind, params, shared) {
  const isLeaf = kind !== 'bark'
  const isBark = kind === 'bark'
  // 先造 legacy 材质: 贴图选择、PBR 数值、per-material uniform 全部复用它。
  const legacy = kind === 'bark'
    ? createBarkMaterial(params, shared)
    : kind === 'leaf' ? createLeafMaterial(params, shared) : createFlowerMaterial(params, shared)

  const mat = new MeshStandardNodeMaterial()
  mat.name = `FastTree-${kind}-GPU`
  mat.userData.legacy = legacy
  mat.userData.kind = legacy.userData.kind || kind
  mat.userData.uniforms = legacy.userData.uniforms
  const U = createNodeUniforms()
  mat.userData.nodeUniforms = U
  // legacy 材质只是"参数容器", 但为了统一释放路径, 跟着和它同生共死。
  mat.addEventListener('dispose', () => { try { legacy.dispose() } catch { /* ignore */ } })

  const mapUv = transformedUv(U)
  // 贴图节点集中登记, 换图时只改 .value, 不重建整张节点图。
  const texNodes = {
    map: sampleTexture(legacy.map || whiteTexture(), mapUv),
    back: sampleTexture(legacy.userData.uniforms.uBackMap.value || whiteTexture(), mapUv),
    moss: sampleTexture(legacy.userData.uniforms.uMossMap.value || whiteTexture(), uv().mul(U.mossTexRepeat)),
    epi: sampleTexture(legacy.userData.uniforms.uEpiphyteMap.value || whiteTexture(), mapUv),
  }
  mat.userData.texNodes = texNodes

  // ---- 顶点: 生长 / 风场 / 铰链 ----
  const { position, wind } = buildPositionNodes(U, isLeaf)
  mat.positionNode = position

  // ---- 片元: 贴图 * 顶点色 * 染色 / 背面 / 苔藓 / 附生 / 选中 ----
  const mapTexel = texNodes.map
  const backTexel = texNodes.back
  const vColor = attribute('color', 'vec3')
  const isBackFace = U.backEnabled.greaterThan(0.5).and(frontFacing.not())

  const frontRgb = mapTexel.rgb
    .mul(mix(vec3(1, 1, 1), vColor, U.vertexColorMix))
    .mul(U.tint)
  const backRgb = select(U.hasBackMap.greaterThan(0.5), backTexel.rgb, mapTexel.rgb).mul(U.backColor)
  let rgb = select(isBackFace, backRgb, frontRgb)
  let alpha = select(isBackFace, select(U.hasBackMap.greaterThan(0.5), backTexel.a, mapTexel.a), mapTexel.a)

  if (isBark) {
    // 苔藓: 双频正弦噪声 + 高度偏置 (公式与 materials.js 的 fragmentBody 一致)
    const mossUv = uv()
    const mossY = mossUv.y.mul(U.mossScale).mul(0.35)
    const mossX = mossUv.x.mul(U.mossScale)
    const mn = sin(mossX.mul(1.7).add(mossY.mul(0.9)))
      .mul(sin(mossY.mul(2.3).sub(mossX.mul(0.6)).add(1.7)))
    const mn2 = sin(mossY.mul(4.1).add(2.4)).mul(0.5)
    const pat = mn.mul(0.65).add(mn2.mul(0.35)).add(0.5)
    const low = float(1).sub(smoothstep(0, 2.4, mossUv.y))
    const thr = float(1).sub(U.mossCoverage.mul(0.95)).add(U.mossHeightBias.mul(low))
    const mt = texNodes.moss
    const lum = dot(mt.rgb, vec3(0.299, 0.587, 0.114))
    // 贴图模式: 亮度/alpha 收紧覆盖形状 (贴图越暗越不长苔藓)
    const mask = smoothstep(thr.sub(0.12), thr.add(0.08), pat)
      .mul(smoothstep(0.04, 0.75, max(lum, mt.a)))
    const mossCol = select(U.mossTexEnabled.greaterThan(0.5), mt.rgb, U.mossColor)
    rgb = mix(rgb, mossCol, mask.mul(0.9).mul(U.mossEnabled))
  } else {
    // 附生卡片: 额外叠一层独立贴图 (只在 aEpiphyte=1 的顶点上生效)
    const aEpiphyte = attribute('aEpiphyte', 'float')
    const epiOn = U.epiphyteEnabled.greaterThan(0.5).and(aEpiphyte.greaterThan(0.5))
    rgb = select(epiOn, rgb.mul(texNodes.epi.rgb), rgb)
    alpha = select(epiOn, alpha.mul(texNodes.epi.a), alpha)
  }

  // ---- 模型节点选中 (与 WebGL 的 vTreeSelected 判定一致) ----
  const aNodeId = attribute('aNodeId', 'float')
  let sel = float(0)
  for (let i = 0; i < 8; i++) {
    const rg = U.selRanges[i]
    const inRange = aNodeId.greaterThanEqual(rg.x.sub(0.5))
      .and(aNodeId.lessThanEqual(rg.y.add(0.5)))
      .and(float(i).lessThan(U.selRangeCount))
    sel = max(sel, select(inRange, float(1), float(0)))
  }
  // "只看某类材质"时, 该材质的全部顶点都算选中
  const matMatch = U.selectMaterial.greaterThanEqual(-0.5)
    .and(abs(U.selectMaterial.sub(isLeaf ? 1 : 0)).lessThan(0.5))
  sel = select(matMatch, float(1), sel)
  sel = select(U.selectMode.greaterThan(0.5), sel, float(0))

  // "其余变暗" / 选中混色
  rgb = select(U.selectMode.greaterThan(2.5).and(sel.lessThan(0.5)), rgb.mul(U.selDim), rgb)
  rgb = select(sel.greaterThan(0.5), mix(rgb, U.selColor, 0.3), rgb)
  // "仅显示选中": 未选中的像素直接 discard
  mat.maskNode = sel.greaterThan(0.5).or(U.selectMode.lessThan(1.5))

  mat.colorNode = vec4(rgb, alpha)

  // ---- 自发光: 材质自发光 + 选中辉光 + 叶片透光/反光/散光 ----
  let em = materialEmissive
    .add(select(sel.greaterThan(0.5), U.selColor.mul(U.selGlow), vec3(0, 0, 0)))
  if (isLeaf) {
    const n = normalize(normalWorld)
    const l = normalize(U.sunDir)
    const v = normalize(cameraPosition.sub(positionWorld))
    // 透光: |N·L|^1.4 * 顶点色 * 风摆增益
    const backLight = pow(abs(dot(n, l)), 1.4)
    em = em.add(rgb.mul(U.translucency).mul(backLight).mul(U.sunColor).mul(float(0.4).add(wind.mul(0.6))))
    // 反光: Blinn-Phong + 菲涅尔
    const h = normalize(l.add(v))
    const spec = pow(abs(dot(n, h)), max(float(1), U.specularShininess))
    const fres = float(0.35).add(float(0.65).mul(pow(float(1).sub(abs(dot(n, v))), 3)))
    em = em.add(U.specularColor.mul(U.specular.mul(3).mul(spec).mul(fres)).mul(U.sunColor))
    // 散光: 视线越贴近切线, 叶肉光程越短 -> 边缘透亮
    const scat = pow(float(1).sub(abs(dot(n, v))), U.scatterPower)
    em = em.add(rgb.mul(U.scatter).mul(scat).mul(float(0.35).add(max(dot(n, l), 0).mul(0.65))).mul(U.sunColor))
  }
  mat.emissiveNode = em

  // 同步一次 legacy 的 PBR 数值/贴图
  refreshFromLegacy(mat)
  mat.side = legacy.side
  mat.alphaTest = legacy.alphaTest || 0
  syncOne(mat, shared)
  return mat
}

/** 创建树皮 GPU 材质。 */
export function createBarkMaterialGPU(params, shared) {
  return buildGpuMaterial('bark', params, shared)
}

/** 创建树叶 GPU 材质。 */
export function createLeafMaterialGPU(params, shared) {
  return buildGpuMaterial('leaf', params, shared)
}

/** 创建花朵 GPU 材质 (与树叶同构, 只是贴图/自发光参数不同)。 */
export function createFlowerMaterialGPU(params, shared) {
  return buildGpuMaterial('flower', params, shared)
}

/** 同步一个 GPU 材质 (legacy 更新 + 属性/贴图复制)。 */
function updateOneGpu(mat, params, shared) {
  const legacy = mat.userData.legacy
  if (!legacy) return
  if (mat.userData.kind === 'bark') updateBarkMaterial(legacy, params, shared)
  else if (mat.userData.kind === 'flower') updateFlowerMaterial(legacy, params, shared)
  else updateLeafMaterial(legacy, params, shared)
  refreshFromLegacy(mat)
  syncOne(mat, shared)
}

export function updateBarkMaterialGPU(mat, params, shared) {
  updateOneGpu(mat, params, shared)
  return mat
}

export function updateLeafMaterialGPU(mat, params, shared) {
  updateOneGpu(mat, params, shared)
  return mat
}

export function updateFlowerMaterialGPU(mat, params, shared) {
  updateOneGpu(mat, params, shared)
  return mat
}

/**
 * 与 materials.js 的 updateMaterials 对齐的批量入口。
 * @param {{bark:Object, leaf:Object, flower:Object, uniforms:Object}} mats
 * @param {Object} params
 */
export function updateMaterialsGPU(mats, params) {
  if (!mats) return mats
  if (mats.bark) updateBarkMaterialGPU(mats.bark, params, mats.uniforms)
  if (mats.leaf) updateLeafMaterialGPU(mats.leaf, params, mats.uniforms)
  if (mats.flower) updateFlowerMaterialGPU(mats.flower, params, mats.uniforms)
  return mats
}

/**
 * 天空穹顶的 Node 版本: 球面高度渐变 (上/下两色)。
 *
 * 与 WebGL 版 SKY_FRAG 的区别: 这里直接拿 positionLocal (球体局部坐标) 算高度,
 * 不经过 varying —— NodeMaterial 会自动把它编译成顶点到片元的插值。
 * uniforms 放在 userData.uniforms 上, 因为 NodeMaterial 没有 WebGL 的 .uniforms 表。
 */
export function createSkyMaterialGPU() {
  const uTop = uniform(new THREE.Color(0x2a3c52))
  const uBottom = uniform(new THREE.Color(0x111820))
  const uOffset = uniform(0.1)
  const mat = new MeshBasicNodeMaterial()
  mat.name = 'Sky-GPU'
  const h = normalize(positionLocal.add(vec3(0, uOffset, 0))).y.mul(0.5).add(0.5)
  mat.colorNode = mix(uBottom, uTop, pow(clamp(h, 0, 1), float(0.85)))
  mat.side = THREE.BackSide
  mat.depthWrite = false
  mat.fog = false
  mat.userData.uniforms = { uTop, uBottom, uOffset }
  return mat
}

/* ==================================================================== */
/* 季节特效: NodeMaterial 版 (叶片粒子 / 落叶 / 地面堆积)               */
/* ==================================================================== */
/**
 * 为什么这三套要单独再做一遍:
 *   particles.js / fallingLeaves.js / litter.js 里全是 `ShaderMaterial`, 而 Node 渲染
 *   路径的材质库 (NodeLibrary) 里没有 ShaderMaterial —— 直接挂上去每帧报
 *   "not compatible", 画面里还什么都没有。之前 sceneManager 干脆在 Node 路径下
 *   直接 return(等于关闭特效), 于是"换后端就换了一套季节表现"。
 *
 * 设计约束 (与 materials.js 的 legacy 材质保持同一套参数语义):
 *   - **几何不动**: 三个构建器已经把顶点数据(出生点/角点uv/随机种子)算好了,
 *     这里只负责"用 TSL 把它动起来 + 上色", 所以不会出现两套采样逻辑漂移;
 *   - **uniform 键名对齐 legacy**: userData.uniforms 里的键名与 ShaderMaterial 的
 *     uniforms 完全一致(uSize/uSpeed/uFall/...), 于是 particles.js 等文件里的
 *     updateXxxMaterial() 可以原样复用, 只换读取位置(见各 update 函数里的
 *     `mat.uniforms || mat.userData.uniforms`);
 *   - **共享风场每帧同步**: 树/落叶/粒子用同一套 uTime/uWind*, 由
 *     syncEffectGpuUniforms() 每帧从 createSharedUniforms() 拷值。
 *
 * 与 WebGL 路径的**唯一**已知差异:
 *   粒子的点尺寸。WebGL 用 gl_PointSize (像素) 表达, 而 WebGPU 的 point primitive 恒为
 *   1px(WGSL 没有 gl_PointSize; WebGL2 后端里 three 也把它写死 1.0)。所以 Node 路径
 *   把粒子改成"面向相机的小四边形", 尺寸按同样的换算公式折算成世界单位
 *   (见 _particleHalfSize), 观感与 WebGL 基本一致。
 */

/* -------------------------- 伪装卡预览面片 -------------------------- */
/**
 * 伪装卡 3D 预览面片的 Node 材质 (图集逐格选图)。
 *
 * sceneManager.setImpostorPreview 在 WebGL 下用的是手写 ShaderMaterial:
 * 把 0..1 的局部 uv 平移到某一格 `(uv + cell) / grid`, 再按 alpha 阈值 discard。
 * Node 渲染路径没有 ShaderMaterial, 这里用同一套公式做等价实现。
 *
 * 与 WebGL 版的差别: 原片元手写了 tonemapping/colorspace 的 include,
 * Node 路径由渲染器在输出阶段统一处理, 不需要也不应该再手动做一次。
 *
 * @param {THREE.Texture} tex 图集贴图
 * @param {number} cols 列数
 * @param {number} rows 行数
 * @param {number} cellX 起始列 (0-based)
 * @param {number} cellY 起始行 (0-based)
 * @returns {MeshBasicNodeMaterial} 带 userData.uniforms.uCell 的材质
 */
export function createImpostorPreviewMaterialGPU(tex, cols, rows, cellX, cellY) {
  // uCell 用 uniform 节点: updateImpostorPreview 每帧只改 value, 不重建材质
  const uCell = uniform(new THREE.Vector2(cellX, cellY))
  const mat = new MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: true })
  mat.name = 'ImpostorPreview-GPU'
  mat.fog = false
  const atlasUv = vec2(uv().x.add(uCell.x).div(cols), uv().y.add(uCell.y).div(rows))
  const col = sampleTexture(tex, atlasUv)
  // 图集里树的轮廓外是透明像素, 不 discard 会画出整块矩形
  mat.maskNode = col.a.greaterThan(0.3)
  mat.colorNode = col
  mat.userData.uniforms = { uCell }
  return mat
}

/** 特效共享 uniform (时间/风场/太阳) —— 值每帧由 syncEffectGpuUniforms 拷进来。 */function createEffectSharedUniforms() {
  return {
    time: uniform(0),
    windDir: uniform(new THREE.Vector2(1, 0)),
    windStrength: uniform(0.12),
    windSpeed: uniform(0.8),
    gust: uniform(0.35),
    gustSpeed: uniform(0.16),
    windBias: uniform(0.3),
    windEnabled: uniform(1),
    sunDir: uniform(new THREE.Vector3(0.5, 1, 0.35).normalize()),
    sunColor: uniform(new THREE.Color(1, 0.96, 0.9)),
  }
}

/** @private 把特效共享 uniform 与场景共享表对齐 (逐帧调用)。 */
function syncEffectShared(U, shared) {
  U.time.value = shared.uTime.value
  U.windDir.value.copy(shared.uWindDir.value)
  U.windStrength.value = shared.uWindStrength.value
  U.windSpeed.value = shared.uWindSpeed.value
  U.gust.value = shared.uGust.value
  U.gustSpeed.value = shared.uGustSpeed.value
  U.windBias.value = shared.uWindBias.value
  U.windEnabled.value = shared.uWindEnabled.value
  if (shared.uSunDir) U.sunDir.value.copy(shared.uSunDir.value)
  if (shared.uSunColor) U.sunColor.value.copy(shared.uSunColor.value)
}

/**
 * 季节特效材质的逐帧同步入口 (sceneManager._renderFrame 调用)。
 *
 * @param {Array<THREE.Material>} materials build* 时登记的 GPU 特效材质表
 * @param {Object} shared createSharedUniforms() 的结果
 */
export function syncEffectGpuUniforms(materials, shared) {
  if (!materials || !shared) return
  for (const mat of materials) {
    const U = mat && mat.userData && mat.userData.effectShared
    if (U) syncEffectShared(U, shared)
  }
}

/* ---------------------------- 叶片粒子 ---------------------------- */
/**
 * 粒子四边形的半尺寸(世界单位)。
 *
 * WebGL 的点尺寸是 `uSize * uGlow * 600 / dist` 像素。把"像素"折回"世界单位":
 *   worldSize = pixels * (2 * dist * tan(fov/2)) / 画面高度(px)
 * 其中 dist 上下抵消, 于是只剩常数项:
 *   halfSize = uSize * uGlow * 600 * tan(fov/2) / H
 * tan(45°/2)=0.4142 —— TreeScene 的相机 fov 固定 45°, 所以这里写死 0.4142;
 * 画面高度取 viewportSize.y, 于是缩放窗口时粒子占比保持不变(与 WebGL 一致)。
 *
 * @param {Object} U 粒子材质的 uniform 节点表
 * @returns {Object} TSL 表达式
 * @private
 */
function _particleHalfSize(U) {
  return U.uSize.mul(U.uGlow).mul(600 * 0.4142)
    .div(max(viewportSize.y, float(1)))
}

/**
 * 叶片粒子的 Node 材质 (Mesh 四边形 billboard 版)。
 *
 * @param {Object} params 全量参数 (读 params.particles)
 * @param {THREE.Texture|null} [texture] 未使用(粒子是程序化圆点), 仅为签名对齐
 * @returns {MeshBasicNodeMaterial}
 */
export function createParticleMaterialGPU(params, texture) {
  const P = params.particles || {}
  const shared = createEffectSharedUniforms()
  const U = {
    ...shared,
    uSize: uniform(P.size === undefined ? 0.05 : P.size),
    uSpeed: uniform(P.speed === undefined ? 0.35 : P.speed),
    uFall: uniform(P.fall === undefined ? 1 : P.fall),
    uSway: uniform(P.sway === undefined ? 1 : P.sway),
    uSwirl: uniform(P.swirl === undefined ? 0.6 : P.swirl),
    // 下落总高度, 建材质时还不知道树高; updateParticleMaterial 会用叶片包围盒覆盖
    uHeight: uniform(10),
    uGlow: uniform(P.glow === undefined ? 0.8 : P.glow),
    uColor: uniform(new THREE.Color(P.color || '#fff0b8')),
    uOpacity: uniform(P.opacity === undefined ? 0.85 : P.opacity),
    uWindFollow: uniform(P.windFollow === undefined ? 1 : P.windFollow),
  }
  const mat = new MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  mat.name = 'Particles-GPU'
  mat.fog = false
  mat.userData.effectShared = shared
  // 私有 uniform 表: 键名与 particles.js 的 ShaderMaterial uniforms 一一对应,
  // updateParticleMaterial() 因此可以原样复用(UniformNode 也有 .value)。
  mat.userData.uniforms = {
    uSize: U.uSize, uSpeed: U.uSpeed, uFall: U.uFall, uSway: U.uSway, uSwirl: U.uSwirl,
    uHeight: U.uHeight, uGlow: U.uGlow, uColor: U.uColor, uOpacity: U.uOpacity,
    uWindFollow: U.uWindFollow,
  }

  const aSeed = attribute('aSeed', 'vec3')
  const phase = aSeed.x
  const speedScale = aSeed.y
  const swayScale = aSeed.z
  // 生命循环 0..1
  const t = fract(U.time.mul(U.uSpeed).mul(speedScale).add(phase))
  const fallY = t.mul(U.uFall).mul(max(float(1), U.uHeight.mul(0.85)))

  const windDir = normalize(U.windDir.add(vec2(1e-5, 1e-6)))
  const gustWave = sin(U.time.mul(U.gustSpeed).add(phase.mul(6.28318))).mul(0.5).add(0.5)
  const gust = float(1).sub(U.gust.mul(0.6).mul(float(1).sub(gustWave)))
  const along = U.windStrength.mul(U.uWindFollow).mul(gust.mul(0.55).add(U.windBias.mul(0.45))).mul(U.windEnabled)
  // 越到生命后期被吹得越远; 高频项让"被风带着走"带一点抖动
  const carry = along.mul(float(2.5).add(t.mul(9.0))).mul(
    float(1).add(sin(U.time.mul(U.windSpeed).mul(2.0).add(phase.mul(12.0))).mul(0.35)),
  )
  const lift = sin(U.time.mul(float(0.6).add(U.windSpeed)).add(phase.mul(9.0))).mul(along).mul(1.2)

  const ang = phase.add(t).mul(6.28318).mul(phase.add(0.5))
  const swayBase = t.mul(0.6).add(0.4)
  const swayX = sin(ang).mul(U.uSway).mul(swayScale).mul(swayBase)
    .add(sin(U.time.mul(0.7).add(phase.mul(12.0))).mul(U.uSwirl).mul(0.15))
  const swayZ = cos(ang.mul(0.8)).mul(U.uSway).mul(swayScale).mul(swayBase)
    .add(cos(U.time.mul(0.6).add(phase.mul(9.0))).mul(U.uSwirl).mul(0.15))

  const spawn = positionLocal.add(vec3(
    windDir.x.mul(carry).add(swayX),
    float(0).sub(fallY).add(lift),
    windDir.y.mul(carry).add(swayZ),
  ))

  // 正面朝向相机的四边形: 角点由 uv 推出来, 偏移量用"相机右/上"在世界空间叠加。
  const corner = uv().sub(vec2(0.5)).mul(2.0)
  const camRight = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz
  const camUp = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz
  const halfSize = _particleHalfSize(U)
  const worldPos = modelWorldMatrix.mul(vec4(spawn, 1)).xyz
    .add(camRight.mul(corner.x).add(camUp.mul(corner.y)).mul(halfSize))
  // positionNode 是**局部空间**的位置, 内置流程还会再乘一次 modelViewMatrix, 所以要转回去
  mat.positionNode = modelWorldMatrixInverse.mul(vec4(worldPos, 1)).xyz

  // 圆形软边点精灵 + 首尾淡入淡出
  const d = uv().sub(vec2(0.5))
  const r = length(d)
  const core = float(1).sub(smoothstep(0.05, 0.5, r))
  const fadeIn = smoothstep(0, 0.15, t)
  const fadeOut = float(1).sub(smoothstep(0.75, 1.0, t))
  const alpha = core.mul(fadeIn).mul(fadeOut).mul(U.uOpacity)
  mat.maskNode = r.lessThan(0.5).and(alpha.greaterThan(0.01))
  mat.colorNode = vec4(U.uColor.mul(float(0.5).add(U.uGlow.mul(0.9))), alpha)
  return mat
}

/* ------------------------------ 落叶 ------------------------------ */
/**
 * 落叶的 Node 材质 (MeshBasicNodeMaterial + 手写光照近似, 与 legacy 片元同构)。
 *
 * 顶点部分复刻 fallingLeaves.js 的 FALL_VERT:
 *   t 生命进度 -> 局部卡片按 rotY*rotX*rotZ 翻滚 -> 出生点减下落 -> 风场/打旋 -> p+local
 * 旋转用三次二维旋转展开(不用 mat3), 顺序与 GLSL 完全一致, 避免"矩阵列主序"误解。
 *
 * @param {Object} params 全量参数 (读 params.fall / params.effect*)
 * @param {Object} ctx 几何信息: { map, halfW, halfH }
 * @returns {MeshBasicNodeMaterial}
 */
export function createFallingLeavesMaterialGPU(params, ctx = {}) {
  const F = params.fall || {}
  // 贴图直接交给 sampleTexture, **不走 uniform**:
  // TSL 的 texture() 节点要求拿到真实 Texture(要读 uuid/filter 等), 塞 UniformNode 会在
  // 绑定阶段炸掉。贴图变了本来就走 fallRebuildKey 重建材质, 所以不需要动态替换。
  const map = ctx.map || whiteTexture()
  const shared = createEffectSharedUniforms()
  const U = {
    ...shared,
    uFallSpeed: uniform(F.speed === undefined ? 1 : F.speed),
    uFallHeight: uniform(Math.max(2, ctx.bbox ? ctx.bbox.max.y : 10)),
    uSizeScale: uniform(F.size === undefined ? 0.35 : F.size),
    uSwirl: uniform(F.swirl === undefined ? 1 : F.swirl),
    uSpinSpeed: uniform(F.spinSpeed === undefined ? 1.2 : F.spinSpeed),
    uStagger: uniform(F.stagger === undefined ? 0.6 : F.stagger),
    uWindFollow: uniform(F.windFollow === undefined ? 1 : F.windFollow),
    uHasMap: uniform(1),
    uColor: uniform(new THREE.Color(F.color || '#d9a441')),
    uOpacity: uniform(F.opacity === undefined ? 1 : F.opacity),
    uAlphaTest: uniform(F.alphaTest === undefined ? 0.35 : F.alphaTest),
    uHalf: uniform(new THREE.Vector2(ctx.halfW === undefined ? 0.5 : ctx.halfW, ctx.halfH === undefined ? 0.5 : ctx.halfH)),
    uInherit: uniform(0),
    uEmissive: uniform(0),
    uEmissiveColor: uniform(new THREE.Color('#ffffff')),
    uSpecular: uniform(0),
    uSpecularShininess: uniform(28),
    uSpecularColor: uniform(new THREE.Color('#ffffff')),
    uScatter: uniform(0),
    uScatterPower: uniform(2),
  }
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
  mat.name = 'FallingLeaves-GPU'
  mat.fog = false
  mat.userData.effectShared = shared
  mat.userData.uniforms = {
    uFallSpeed: U.uFallSpeed, uFallHeight: U.uFallHeight, uSizeScale: U.uSizeScale,
    uSwirl: U.uSwirl, uSpinSpeed: U.uSpinSpeed, uStagger: U.uStagger,
    uWindFollow: U.uWindFollow, uHasMap: U.uHasMap, uColor: U.uColor,
    uOpacity: U.uOpacity, uAlphaTest: U.uAlphaTest, uHalf: U.uHalf,
    uInherit: U.uInherit, uEmissive: U.uEmissive, uEmissiveColor: U.uEmissiveColor,
    uSpecular: U.uSpecular, uSpecularShininess: U.uSpecularShininess, uSpecularColor: U.uSpecularColor,
    uScatter: U.uScatter, uScatterPower: U.uScatterPower,
  }

  const aLeafSeed = attribute('aLeafSeed', 'vec4')
  const phase = aLeafSeed.x
  const speedScale = aLeafSeed.y
  const sizeScale = aLeafSeed.z
  const spinDir = aLeafSeed.w

  const t = fract(U.time.mul(U.uFallSpeed).mul(speedScale).mul(0.35).add(phase))
  // 局部卡片: position 存的是出生点, 真正的形状由 uv 展开
  const cardUv = uv().sub(vec2(0.5)).mul(2.0).mul(U.uHalf)
  const local0 = vec3(cardUv.x, cardUv.y, float(0)).mul(U.uSizeScale).mul(sizeScale)

  const spin = U.time.mul(U.uSpinSpeed).mul(spinDir)
    .mul(float(0.6).add(speedScale.mul(0.8))).add(phase.mul(6.28318))
  const tumble = t.mul(6.28318).mul(float(0.8).add(phase))
  const theta = phase.mul(6.28318).add(spin.mul(0.4))

  // ① 绕 Z 自旋
  const cA = cos(theta)
  const sA = sin(theta)
  const v1 = vec3(
    local0.x.mul(cA).sub(local0.y.mul(sA)),
    local0.x.mul(sA).add(local0.y.mul(cA)),
    local0.z,
  )
  // ② 绕 X 翻滚
  const cB = cos(tumble)
  const sB = sin(tumble)
  const v2 = vec3(
    v1.x,
    v1.y.mul(cB).sub(v1.z.mul(sB)),
    v1.y.mul(sB).add(v1.z.mul(cB)),
  )
  // ③ 绕 Y 旋转 (侧倾)
  const cC = cos(spin)
  const sC = sin(spin)
  const v3 = vec3(
    v2.x.mul(cC).add(v2.z.mul(sC)),
    v2.y,
    v2.x.negate().mul(sC).add(v2.z.mul(cC)),
  )

  const fall = t.mul(U.uFallHeight)
  const windDir = normalize(U.windDir.add(vec2(1e-5, 1e-6)))
  const gustWave = sin(U.time.mul(U.gustSpeed).add(phase.mul(6.28318))).mul(0.5).add(0.5)
  const gust = float(1).sub(U.gust.mul(0.6).mul(float(1).sub(gustWave)))
  const along = U.windStrength.mul(U.uWindFollow).mul(gust.mul(0.55).add(U.windBias.mul(0.45))).mul(U.windEnabled)
  const drift = along.mul(float(3.0).add(t.mul(14.0)))
  const ang2 = t.mul(6.28318).add(phase.mul(12.0)).mul(float(0.5).add(U.uSwirl))
  const swirlBase = t.mul(0.75).add(0.25).mul(U.uStagger)
  const swirlX = sin(ang2).mul(U.uSwirl).mul(swirlBase)
  const swirlZ = cos(ang2.mul(0.85)).mul(U.uSwirl).mul(swirlBase)
  const lift = sin(U.time.mul(float(1.0).add(U.windSpeed)).add(phase.mul(7.0))).mul(along).mul(0.8)

  // positionNode = 出生点(含下落/风场位移) + 翻滚后的卡片顶点。
  // treeGroup 无变换(恒等矩阵), 所以 model 空间与世界空间同一套数值 —— 与 legacy 一致。
  mat.positionNode = vec3(
    positionLocal.x.add(windDir.x.mul(drift).add(swirlX)),
    positionLocal.y.sub(fall).add(lift),
    positionLocal.z.add(windDir.y.mul(drift).add(swirlZ)),
  ).add(v3)

  // 翻滚时的明暗变化: legacy 取 R[1][1] = cos(theta)*cos(tumble), 这里用同一个量
  const fade = float(1).sub(smoothstep(0.85, 1.0, t))
  const vShade = varying(float(0.55).add(max(float(0), cA.mul(cB)).mul(0.45)).mul(fade))
  // 卡片法线 = R * (0,0,1) = (sinSpin*cosTumble, -sinTumble, cosSpin*cosTumble)
  const vNormal = varying(vec3(sC.mul(cB), sB.negate(), cC.mul(cB)))

  // 片元: 贴图/兜底椭圆 -> 继承光照
  const tex = sampleTexture(map, uv())
  const hasMap = U.uHasMap
  const dd = uv().sub(vec2(0.5))
  const ellipseOk = length(vec2(dd.x.mul(1.6), dd.y)).lessThan(0.5)
  mat.maskNode = select(
    hasMap.greaterThan(0.5),
    tex.a.greaterThanEqual(U.uAlphaTest),
    ellipseOk,
  )
  const baseRgb = select(hasMap.greaterThan(0.5), tex.rgb, U.uColor).mul(vShade)

  const N = normalize(vNormal).mul(select(frontFacing, float(1), float(-1)))
  const V = normalize(cameraPosition.sub(positionWorld))
  const L = normalize(U.sunDir)
  const Hv = normalize(L.add(V))
  const spec = pow(max(dot(N, Hv), float(0)), max(float(1), U.uSpecularShininess))
  const fres = float(0.35).add(pow(float(1).sub(max(dot(N, V), float(0))), float(3)).mul(0.65))
  const rim = pow(float(1).sub(abs(dot(N, V))), max(float(1), U.uScatterPower))
  const lit = float(0.35).add(max(dot(N, L), float(0)).mul(0.65))
  const extra = U.uEmissiveColor.mul(U.uEmissive)
    .add(U.uSpecularColor.mul(U.uSpecular.mul(3).mul(spec).mul(fres)).mul(U.sunColor))
    .add(tex.rgb.mul(U.uScatter.mul(rim).mul(lit)).mul(U.sunColor))
  const rgb = baseRgb.add(select(U.uInherit.greaterThan(0.5), extra, vec3(0)))
  const alpha = select(hasMap.greaterThan(0.5), float(1), U.uOpacity).mul(vShade)
  mat.colorNode = vec4(rgb, alpha)
  return mat
}

/* --------------------------- 地面落叶堆积 --------------------------- */
/**
 * 堆积的 Node 材质: 贴图 × 顶点色 × 明暗 + 可选继承光照。
 * 几何有 normal 属性, 所以直接用 normalWorld(不需要自己造 varying)。
 *
 * @param {Object} params 全量参数 (读 params.litter)
 * @param {Object} ctx { map }
 * @returns {MeshBasicNodeMaterial}
 */
export function createLitterMaterialGPU(params, ctx = {}) {
  const L = params.litter || {}
  // 同落叶: 贴图直接给 sampleTexture, 不进 uniform(贴图变化走 litterRebuildKey 重建)
  const map = ctx.map || whiteTexture()
  // 堆积的"太阳"沿用 legacy 的固定常量(场景没有昼夜系统, 只为继承光照分支提供 L 与光色)
  const shared = createEffectSharedUniforms()
  const U = {
    ...shared,
    uAlphaTest: uniform(L.alphaTest === undefined ? 0.35 : L.alphaTest),
    uShade: uniform(L.shade === undefined ? 0.78 : L.shade),
    uInherit: uniform(0),
    uEmissive: uniform(0),
    uEmissiveColor: uniform(new THREE.Color('#ffffff')),
    uSpecular: uniform(0),
    uSpecularShininess: uniform(28),
    uSpecularColor: uniform(new THREE.Color('#ffffff')),
    uScatter: uniform(0),
    uScatterPower: uniform(2),
  }
  const mat = new MeshBasicNodeMaterial({ side: THREE.DoubleSide })
  mat.name = 'Litter-GPU'
  mat.fog = false
  mat.userData.effectShared = shared
  mat.userData.uniforms = {
    uAlphaTest: U.uAlphaTest, uShade: U.uShade,
    uInherit: U.uInherit, uEmissive: U.uEmissive, uEmissiveColor: U.uEmissiveColor,
    uSpecular: U.uSpecular, uSpecularShininess: U.uSpecularShininess, uSpecularColor: U.uSpecularColor,
    uScatter: U.uScatter, uScatterPower: U.uScatterPower,
  }

  const tex = sampleTexture(map, uv())
  const vColor = attribute('color', 'vec3')
  const baseRgb = tex.rgb.mul(vColor).mul(U.uShade)
  mat.maskNode = tex.a.greaterThanEqual(U.uAlphaTest)

  const N = normalize(normalWorld).mul(select(frontFacing, float(1), float(-1)))
  const V = normalize(cameraPosition.sub(positionWorld))
  const Ld = normalize(U.sunDir)
  const Hv = normalize(Ld.add(V))
  const spec = pow(max(dot(N, Hv), float(0)), max(float(1), U.uSpecularShininess))
  const fres = float(0.35).add(pow(float(1).sub(max(dot(N, V), float(0))), float(3)).mul(0.65))
  const rim = pow(float(1).sub(abs(dot(N, V))), max(float(1), U.uScatterPower))
  const lit = float(0.35).add(max(dot(N, Ld), float(0)).mul(0.65))
  const extra = U.uEmissiveColor.mul(U.uEmissive)
    .add(U.uSpecularColor.mul(U.uSpecular.mul(3).mul(spec).mul(fres)).mul(U.sunColor))
    .add(tex.rgb.mul(U.uScatter.mul(rim).mul(lit)).mul(U.sunColor))
  const rgb = baseRgb.add(select(U.uInherit.greaterThan(0.5), extra, vec3(0)))
  mat.colorNode = vec4(rgb, tex.a)
  return mat
}

