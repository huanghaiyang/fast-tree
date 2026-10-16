/**
 * 材质系统: PBR + 风场 / 生长动画 / 自定义 GLSL
 * ------------------------------------------------------------
 * 使用 three 的 MeshStandardMaterial (完整 PBR + 贴图 + 可导出 glTF),
 * 通过 onBeforeCompile 注入:
 *   1) 顶点: 生长动画 (aGrow/aOrigin) + 风场位移 (aWind/aPhase)
 *   2) 片元: 顶点色调制 + 自定义 GLSL + 叶片透光
 *
 * uniform 分两类:
 *   shared   —— 所有材质引用同一对象 (时间/风场/生长), 改一次全局生效
 *   material —— 每个材质独立 (uSway/uTint/uIsLeaf/叶片抖动…),
 *               存放在 material.userData.uniforms, 编译前后都能安全更新
 */
import * as THREE from 'three'
import { makeBarkTextures, makeLeafTexture, loadTexture, setTextureRepeat, disposeTexture } from './textures.js'

const VERTEX_HEADER = /* glsl */`
attribute float aWind;
attribute float aPhase;
attribute vec3 aOrigin;
attribute vec2 aGrow;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uGust;
uniform float uGustSpeed;
uniform float uTurbulence;
uniform float uSpatialScale;
uniform float uFlexFalloff;
uniform float uSway;
uniform float uLeafFlutter;
uniform float uLeafTwist;
uniform float uIsLeaf;
uniform float uWindEnabled;
uniform float uGrowth;
uniform float uGrowthEnabled;
uniform float uSeed;
varying vec2 vTreeUv;
varying float vTreeWind;
`

function vertexBody(customVertex) {
  return /* glsl */`
  vec3 treePos = transformed;
  float growK = clamp((uGrowth - aGrow.x) / max(1e-4, aGrow.y - aGrow.x), 0.0, 1.0);
  growK = growK * growK * (3.0 - 2.0 * growK);
  treePos = mix(aOrigin, treePos, mix(1.0, growK, uGrowthEnabled));
  #ifdef USE_UV
    vTreeUv = uv;
  #else
    vTreeUv = vec2(0.0);
  #endif
  vec4 treeWorld = modelMatrix * vec4(treePos, 1.0);
  float flex = pow(clamp(aWind, 0.0, 1.0), uFlexFalloff);
  vTreeWind = flex;
  vec2 windDir = normalize(uWindDir + vec2(1e-5, 1e-6));
  float phase = aPhase + dot(treeWorld.xz, windDir) * uSpatialScale + uSeed * 0.017;
  float tw = uTime * uWindSpeed;
  float wave = sin(tw + phase) * 0.6 + sin(tw * 2.17 + phase * 1.7) * 0.25 + sin(tw * 0.37 + phase * 0.5) * 0.15;
  float gust = mix(1.0, sin(tw * uGustSpeed + phase * 0.21) * 0.5 + 0.5, uGust);
  vec2 perp = vec2(-windDir.y, windDir.x);
  float turb = sin(tw * 3.1 + phase * 4.3) * uTurbulence;
  vec2 sway = windDir * (wave * gust) + perp * turb;
  float amount = uWindStrength * uSway * flex * uWindEnabled;
  treePos.xz += sway * amount;
  if (uIsLeaf > 0.5) {
    float f1 = sin(tw * 3.7 + phase * 6.1);
    float f2 = cos(tw * 2.3 + phase * 3.7);
    treePos += vec3(perp.x, 0.0, perp.y) * f1 * uLeafFlutter * uWindStrength * 0.22 * uWindEnabled * (0.35 + aWind);
    vec3 rel = treePos - aOrigin;
    float ang = f2 * uLeafTwist * uWindStrength * uWindEnabled;
    float ca = cos(ang);
    float sa = sin(ang);
    rel.xz = vec2(rel.x * ca - rel.z * sa, rel.x * sa + rel.z * ca);
    treePos = aOrigin + rel;
  }
  transformed = treePos;
${customVertex || ''}
`
}

const FRAGMENT_HEADER = /* glsl */`
uniform float uTime;
uniform float uSeed;
uniform float uVertexColorMix;
uniform vec3 uTint;
uniform float uTranslucency;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec2 vTreeUv;
varying float vTreeWind;
`

function fragmentBody(customFragment) {
  return /* glsl */`
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
    // three r186: vColor 永远是 vec4 (USE_COLOR 时 vColor.rgb 承载颜色)
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vColor.rgb, uVertexColorMix);
  #endif
  diffuseColor.rgb *= uTint;
${customFragment || ''}
`
}

const TRANSLUCENCY = /* glsl */`
  #ifndef FLAT_SHADED
    float treeBack = pow(max(dot(normalize(vNormal), normalize(-uSunDir)), 0.0), 1.4);
    totalEmissiveRadiance += diffuseColor.rgb * uTranslucency * treeBack * uSunColor * (0.4 + 0.6 * vTreeWind);
  #endif
`

function hashCode(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/** 全局共享 uniform (同一个对象被两个材质引用) */
export function createSharedUniforms() {
  return {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindStrength: { value: 0.35 },
    uWindSpeed: { value: 1.15 },
    uGust: { value: 0.45 },
    uGustSpeed: { value: 0.22 },
    uTurbulence: { value: 0.3 },
    uSpatialScale: { value: 0.3 },
    uFlexFalloff: { value: 1.5 },
    uWindEnabled: { value: 1 },
    uGrowth: { value: 1 },
    uGrowthEnabled: { value: 0 },
    uSeed: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.5, 1, 0.35).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
  }
}

/** 每个材质独立 uniform */
export function perMaterialUniforms(params, isLeaf) {
  const w = params.wind
  const m = isLeaf ? params.leafMat : params.bark
  return {
    uIsLeaf: { value: isLeaf ? 1 : 0 },
    uSway: { value: isLeaf ? 1.0 : (w.barkSway === undefined ? 1 : w.barkSway) },
    uVertexColorMix: { value: m.vertexColorMix === undefined ? 1 : m.vertexColorMix },
    uTint: { value: new THREE.Color(m.tint || '#ffffff') },
    uTranslucency: { value: isLeaf ? (m.translucency || 0) : 0 },
    uLeafFlutter: { value: w.leafFlutter },
    uLeafTwist: { value: w.leafTwist },
  }
}

function applyTreeShader(material, shaderUniforms, opts) {
  const isLeaf = !!opts.isLeaf
  const customVertex = (opts.customEnabled && opts.customVertex) ? opts.customVertex : ''
  const customFragment = (opts.customEnabled && opts.customFragment) ? opts.customFragment : ''
  const cacheKey = `${isLeaf ? 'leaf' : 'bark'}:${hashCode(customVertex + '||' + customFragment)}:${opts.translucency ? 1 : 0}`

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shaderUniforms)
    shader.vertexShader = VERTEX_HEADER + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' + vertexBody(customVertex),
    )
    shader.fragmentShader = FRAGMENT_HEADER + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n' + fragmentBody(customFragment),
    )
    if (opts.translucency) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' + TRANSLUCENCY,
      )
    }
    material.userData.shader = shader
  }
  material.customProgramCacheKey = () => cacheKey
  return material
}

/* ------------------------------------------------------------------ */
/* 创建                                                                */
/* ------------------------------------------------------------------ */

export function createBarkMaterial(params, sharedUniforms) {
  const p = params.bark
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    roughness: p.roughness,
    metalness: p.metalness,
    vertexColors: true,
    side: THREE.FrontSide,
  })
  mat.userData.kind = 'bark'
  mat.userData.uniforms = perMaterialUniforms(params, false)
  applyTreeShader(mat, { ...sharedUniforms, ...mat.userData.uniforms }, {
    isLeaf: false,
    translucency: false,
    customEnabled: params.custom.enabled,
    customVertex: params.custom.vertex,
    customFragment: params.custom.fragment,
  })
  updateBarkMaterial(mat, params, sharedUniforms)
  return mat
}

export function createLeafMaterial(params, sharedUniforms) {
  const p = params.leafMat
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    roughness: p.roughness,
    metalness: p.metalness,
    vertexColors: true,
    side: p.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    alphaTest: p.alphaTest,
    transparent: false,
  })
  mat.userData.kind = 'leaf'
  mat.userData.uniforms = perMaterialUniforms(params, true)
  applyTreeShader(mat, { ...sharedUniforms, ...mat.userData.uniforms }, {
    isLeaf: true,
    translucency: true,
    customEnabled: params.custom.enabled,
    customVertex: params.custom.vertex,
    customFragment: params.custom.fragment,
  })
  updateLeafMaterial(mat, params, sharedUniforms)
  return mat
}

/* ------------------------------------------------------------------ */
/* 更新                                                                */
/* ------------------------------------------------------------------ */

let barkTextureCacheKey = ''
let leafTextureCacheKey = ''

export function updateBarkMaterial(mat, params, sharedUniforms) {
  const p = params.bark
  mat.roughness = p.roughness
  mat.metalness = p.metalness
  mat.color.set(0xffffff)
  mat.normalScale.set(p.normalScale, p.normalScale)
  const u = mat.userData.uniforms
  u.uSway.value = params.wind.barkSway === undefined ? 1 : params.wind.barkSway
  u.uVertexColorMix.value = p.vertexColorMix
  u.uTint.value.set(p.tint || '#ffffff')

  if (p.texture) {
    const key = 'user:' + p.texture.slice(-48) + ':' + (p.normalTexture || '').slice(-24)
    if (key !== barkTextureCacheKey) {
      barkTextureCacheKey = key
      clearAutoBarkTextures(mat)
      mat.map = loadTexture(p.texture)
      if (p.normalTexture) mat.normalMap = loadTexture(p.normalTexture, { srgb: false, normal: true })
      else mat.normalMap = null
      mat.roughnessMap = null
      mat.needsUpdate = true
    }
  } else {
    const proc = p.procedural || {}
    const key = `proc:${proc.style}:${proc.scale}:${proc.contrast}:${p.bump}:${p.color}:${p.color2}`
    if (key !== barkTextureCacheKey) {
      barkTextureCacheKey = key
      clearAutoBarkTextures(mat)
      const tex = makeBarkTextures({
        style: proc.style, scale: proc.scale, contrast: proc.contrast,
        color: p.color, color2: p.color2, bump: p.bump, seed: 12345,
      })
      if (tex) {
        mat.userData.autoMap = tex.map
        mat.userData.autoNormal = tex.normalMap
        mat.userData.autoRough = tex.roughnessMap
        mat.map = tex.map
        mat.normalMap = tex.normalMap
        mat.roughnessMap = tex.roughnessMap
      }
      mat.needsUpdate = true
    }
  }
  setTextureRepeat(mat.map, p.uvScaleU, p.uvScaleV)
  setTextureRepeat(mat.normalMap, p.uvScaleU, p.uvScaleV)
  setTextureRepeat(mat.roughnessMap, p.uvScaleU, p.uvScaleV)
  return mat
}

function clearAutoBarkTextures(mat) {
  const auto = [mat.userData.autoMap, mat.userData.autoNormal, mat.userData.autoRough]
  for (const t of auto) disposeTexture(t)
  mat.userData.autoMap = null
  mat.userData.autoNormal = null
  mat.userData.autoRough = null
  if (auto.includes(mat.map)) mat.map = null
  if (auto.includes(mat.normalMap)) mat.normalMap = null
  if (auto.includes(mat.roughnessMap)) mat.roughnessMap = null
}

export function updateLeafMaterial(mat, params, sharedUniforms) {
  const p = params.leafMat
  mat.roughness = p.roughness
  mat.metalness = p.metalness
  mat.alphaTest = p.alphaTest
  mat.side = p.doubleSided ? THREE.DoubleSide : THREE.FrontSide
  mat.color.set(0xffffff)
  const u = mat.userData.uniforms
  u.uVertexColorMix.value = p.vertexColorMix
  u.uTint.value.set(p.tint || '#ffffff')
  u.uTranslucency.value = p.translucency
  u.uLeafFlutter.value = params.wind.leafFlutter
  u.uLeafTwist.value = params.wind.leafTwist

  const key = p.texture ? 'user:' + p.texture.slice(-48) : 'auto:' + params.leaves.shape
  if (key !== leafTextureCacheKey) {
    leafTextureCacheKey = key
    const old = mat.map
    const hadAuto = mat.userData.autoLeafMap
    if (p.texture) {
      mat.map = loadTexture(p.texture, { clamp: true })
      mat.userData.autoLeafMap = null
    } else {
      const tex = makeLeafTexture({ shape: params.leaves.shape, seed: 7 })
      if (tex) {
        mat.map = tex.map
        mat.userData.autoLeafMap = tex.map
      }
    }
    if (old && old !== mat.map && old !== hadAuto) disposeTexture(old)
    if (hadAuto && hadAuto !== mat.map) disposeTexture(hadAuto)
    mat.needsUpdate = true
  }
  if (p.normalTexture) {
    if (!mat.normalMap) {
      mat.normalMap = loadTexture(p.normalTexture, { srgb: false, normal: true })
      mat.needsUpdate = true
    }
  } else if (mat.normalMap) {
    disposeTexture(mat.normalMap)
    mat.normalMap = null
    mat.needsUpdate = true
  }
  return mat
}

/** 风场参数 -> 共享 uniform */
export function updateWindUniforms(uniforms, wind) {
  const rad = (wind.direction || 0) * Math.PI / 180
  uniforms.uWindDir.value.set(Math.cos(rad), Math.sin(rad))
  uniforms.uWindStrength.value = wind.strength
  uniforms.uWindSpeed.value = wind.speed
  uniforms.uGust.value = wind.gust
  uniforms.uGustSpeed.value = Math.max(0.01, wind.gustSpeed)
  uniforms.uTurbulence.value = wind.turbulence
  uniforms.uSpatialScale.value = wind.spatialScale
  uniforms.uFlexFalloff.value = wind.flexFalloff
  uniforms.uWindEnabled.value = wind.enabled ? 1 : 0
}

/** 生长动画 -> 共享 uniform */
export function updateGrowthUniforms(uniforms, growth, value) {
  uniforms.uGrowth.value = value
  uniforms.uGrowthEnabled.value = (growth && growth.enabled && value < 0.999) ? 1 : 0
}

/** 材质参数整体刷新 (不动几何) */
export function updateMaterials(mats, params) {
  updateBarkMaterial(mats.bark, params, mats.uniforms)
  updateLeafMaterial(mats.leaf, params, mats.uniforms)
  updateWindUniforms(mats.uniforms, params.wind)
  mats.uniforms.uSeed.value = params.seed % 1000
  return mats
}

/** 自定义 GLSL 改动后重新绑定 (触发重编译) */
export function rebindCustomShader(mat, params, sharedUniforms) {
  const isLeaf = mat.userData.kind === 'leaf'
  applyTreeShader(mat, { ...sharedUniforms, ...mat.userData.uniforms }, {
    isLeaf,
    translucency: isLeaf,
    customEnabled: params.custom.enabled,
    customVertex: params.custom.vertex,
    customFragment: params.custom.fragment,
  })
  mat.needsUpdate = true
  return mat
}

export function invalidateTextureCaches() {
  barkTextureCacheKey = ''
  leafTextureCacheKey = ''
}
