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
  normalWorld, frontFacing, cameraPosition, materialEmissive,
  mix, select, clamp, smoothstep,
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
