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
import { albedoNormalTexture } from './normalFromAlbedo.js'
import { makeBarkTextures, makeLeafTexture, loadTexture, setTextureRepeat, disposeTexture } from './textures.js'

const VERTEX_HEADER = /* glsl */`
attribute float aWind;
attribute float aPhase;
attribute vec3 aOrigin;
attribute vec2 aGrow;
attribute float aNodeId;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uWindFrequency;
uniform float uGust;
uniform float uGustSpeed;
uniform float uTurbulence;
uniform float uSpatialScale;
uniform float uWindBias;
uniform float uFlexFalloff;
uniform float uSway;
uniform float uLeafFlutter;
uniform float uLeafTwist;
uniform float uIsLeaf;
uniform float uWindEnabled;
uniform float uGrowth;
uniform float uGrowthEnabled;
uniform float uSeed;
// --- 模型节点选中 (节点树) ---
uniform float uSelectMode;      // 0 关 / 1 高亮 / 2 仅显示选中 / 3 其余变暗
uniform float uSelectMaterial;  // -1 不过滤 / 0 树皮 / 1 树叶
uniform vec2 uSelRanges[8];
uniform float uSelRangeCount;
varying vec2 vTreeUv;
varying float vTreeWind;
varying float vTreeSelected;

// 罗德里格旋转: 绕任意轴 (叶片用固定水平轴做铰链式俯仰, 不做绕垂直轴自转)
vec3 treeRotate(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
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
  vec2 windPerp = vec2(-windDir.y, windDir.x);
  float phase = aPhase + dot(treeWorld.xz, windDir) * uSpatialScale + uSeed * 0.017;
  float tw = uTime * uWindSpeed;
  float freq = max(0.05, uWindFrequency);
  // 顺风主波 + 高频次波
  float wave = sin(tw + phase) * 0.72 + sin(tw * 2.17 * freq + phase * 1.7) * 0.28;
  float osc = wave * 0.5 + 0.5;                 // 0..1
  // 阵风: 压低摆动区间的低谷 (uGust 越大, 起伏越强)
  float gust = 1.0 - uGust * 0.6 *
    (1.0 - (sin(tw * uGustSpeed + phase * 0.21) * 0.5 + 0.5));
  // 风只"推"不"拉": 位移恒偏下风向; bias 只抬低谷, 不削峰值
  // -> 摆动幅度几乎全部是"动"的 (静态偏置只占一小部分), 否则方向看不出来
  float along = osc * gust + uWindBias * 0.35;
  float turb = sin(tw * 3.1 * freq + phase * 4.3);
  vec2 sway = windDir * along + windPerp * turb * uTurbulence;
  float amount = uWindStrength * uSway * flex * uWindEnabled;
  treePos.xz += sway * amount;
  if (uIsLeaf > 0.5) {
    // 叶片: 叶柄固定不动, 只做"弯曲 + 铰链式俯仰"
    //  1) 弯曲方向固定且以水平分量为主 (下风向占绝对主导) -> 方向一眼可辨
    //  2) 俯仰绕固定的水平轴 (垂直于风向), 小角度来回 -> 物理上就是叶片迎风翻动
    vec3 rel = treePos - aOrigin;
    float stemDist = length(rel);
    float flap = sin(tw * 4.1 * freq + phase * 6.3);
    float surge = sin(tw * 1.35 + phase * 2.1);
    float leafAmp = uLeafFlutter * uWindStrength * 1.8 * uWindEnabled * (0.35 + aWind);
    vec3 bendDir = normalize(vec3(windDir.x, -0.3, windDir.y));
    rel += bendDir * stemDist * leafAmp * (0.5 + 0.35 * flap + 0.15 * surge);
    float pitch = flap * uLeafTwist * 0.5 * uWindEnabled * (0.35 + uWindStrength * 2.0);
    rel = treeRotate(rel, vec3(windPerp.x, 0.0, windPerp.y), pitch);
    treePos = aOrigin + rel;
  }
  transformed = treePos;
  // --- 模型节点选中判定 (逐顶点算一次, 片元直接用) ---
  float treeSel = 0.0;
  if (uSelectMode > 0.5) {
    if (uSelectMaterial > -0.5 && abs(uSelectMaterial - uIsLeaf) < 0.5) treeSel = 1.0;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= uSelRangeCount) break;
      vec2 rg = uSelRanges[i];
      if (aNodeId >= rg.x - 0.5 && aNodeId <= rg.y + 0.5) { treeSel = 1.0; break; }
    }
  }
  vTreeSelected = treeSel;
${customVertex || ''}
`
}

const FRAGMENT_HEADER = /* glsl */`
uniform float uTime;
uniform float uSeed;
uniform float uVertexColorMix;
uniform vec3 uTint;
uniform float uTranslucency;
// --- 叶片反光 / 散光 ---
uniform float uSpecular;
uniform float uSpecularShininess;
uniform vec3 uSpecularColor;
uniform float uScatter;
uniform float uScatterPower;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
// --- 模型节点选中 ---
uniform float uSelectMode;
uniform vec3 uSelColor;
uniform float uSelGlow;
uniform float uSelDim;
varying vec2 vTreeUv;
varying float vTreeWind;
varying float vTreeSelected;
`

function fragmentBody(customFragment) {
  return /* glsl */`
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
    // three r186: vColor 永远是 vec4 (USE_COLOR 时 vColor.rgb 承载颜色)
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vColor.rgb, uVertexColorMix);
  #endif
  diffuseColor.rgb *= uTint;
  // --- 模型节点: 隔离 / 变暗 / 选中着色 ---
  if (uSelectMode > 1.5 && vTreeSelected < 0.5) {
    if (uSelectMode < 2.5) discard;                 // 仅显示选中
    else diffuseColor.rgb *= uSelDim;               // 其余变暗
  }
  if (vTreeSelected > 0.5) {
    // 保持一点原有明暗, 避免高亮后完全变成色块
    diffuseColor.rgb = mix(diffuseColor.rgb, uSelColor, 0.3);
  }
${customFragment || ''}
`
}

const SELECTION_GLOW = /* glsl */`
  if (vTreeSelected > 0.5) {
    totalEmissiveRadiance += uSelColor * uSelGlow;
  }
`

const TRANSLUCENCY = /* glsl */`
  #ifndef FLAT_SHADED
    float treeBack = pow(max(dot(normalize(vNormal), normalize(-uSunDir)), 0.0), 1.4);
    totalEmissiveRadiance += diffuseColor.rgb * uTranslucency * treeBack * uSunColor * (0.4 + 0.6 * vTreeWind);
  #endif
`

/** 叶片反光 (叶面高光) + 散光 (叶肉散射/边缘透亮) */
const LEAF_REFLECTION = /* glsl */`
  #ifndef FLAT_SHADED
  {
    vec3 treeN = normalize(vNormal);
    vec3 treeV = normalize(vViewPosition);        // 视空间视线方向
    vec3 treeL = normalize(uSunDir);
    // 反光: Blinn-Phong 高光 + 菲涅尔增亮 -> 湿叶/蜡质叶面的那种反光
    if (uSpecular > 0.001) {
      vec3 treeH = normalize(treeL + treeV);
      float treeSpec = pow(max(dot(treeN, treeH), 0.0), max(1.0, uSpecularShininess));
      float treeFres = 0.35 + 0.65 * pow(1.0 - max(dot(treeN, treeV), 0.0), 3.0);
      totalEmissiveRadiance += uSpecularColor * (uSpecular * 3.0 * treeSpec * treeFres) * uSunColor;
    }
    // 散光: 视线与法线接近垂直时叶肉最薄 -> 边缘散射发亮 (逆光尤其明显)
    if (uScatter > 0.001) {
      float treeRim = pow(1.0 - abs(dot(treeN, treeV)), max(1.0, uScatterPower));
      float treeLit = 0.35 + 0.65 * max(dot(treeN, treeL), 0.0);
      totalEmissiveRadiance += diffuseColor.rgb * (uScatter * treeRim * treeLit) * uSunColor;
    }
  }
  #endif
`

/** 供自检使用: 返回注入用的 GLSL 片段与声明头 (静态检查"用了但没声明"的 uniform) */
export function internalShaderSources() {
  return {
    fragmentHeader: FRAGMENT_HEADER,
    vertexHeader: VERTEX_HEADER,
    snippets: { TRANSLUCENCY, LEAF_REFLECTION, SELECTION_GLOW },
  }
}

/**
 * 染色模式 -> 实际顶点色混合系数
 * @param m leafMat 参数
 * @param hasTexture 是否真的有贴图。程序化叶形是**中性灰度遮罩**, 颜色全部来自顶点色,
 *        所以"原色"模式在没有贴图时没有意义 -> 自动回落到跟随季节 (否则会渲染成白叶子)。
 */
export function resolveTintMix(m, hasTexture) {
  const mode = m.tintMode || 'season'
  const textured = hasTexture === undefined ? true : !!hasTexture
  if (mode === 'texture') return textured ? 0 : 1
  if (mode === 'season') return 1
  return m.vertexColorMix === undefined ? 0.5 : m.vertexColorMix
}

/** 若没有显式法线贴图且开启了自动生成, 就从 albedo 生成一张 */
function applyAutoNormal(mat, p) {
  const strength = p.normalFromAlbedo === undefined ? 0 : p.normalFromAlbedo
  if (p.normalTexture || strength <= 0 || !p.texture) {
    if (mat.normalMap && mat.userData.autoNormal) {
      mat.normalMap = null
      mat.userData.autoNormal = false
      mat.needsUpdate = true
    }
    return
  }
  const map = mat.map
  const tex = albedoNormalTexture(map, strength, p.texture)
  if (!tex) {
    // 贴图还没解码完 -> 等它 update 后重试 (只挂一次)
    if (map && typeof map.onUpdate !== 'function' || (map && !map.userData.__autoNormalHooked)) {
      if (map) {
        map.userData.__autoNormalHooked = true
        const prev = map.onUpdate
        map.onUpdate = () => {
          if (typeof prev === 'function') prev()
          const t = albedoNormalTexture(map, strength, p.texture)
          if (t && !mat.normalMap) {
            mat.normalMap = t
            mat.userData.autoNormal = true
            mat.needsUpdate = true
          }
        }
      }
    }
    return
  }
  // 已经是这张图了就不重复赋值 (避免每次更新材质都触发重编译)
  if (mat.normalMap === tex) return
  if (mat.userData.autoNormal && mat.normalMap) disposeTexture(mat.normalMap)
  mat.normalMap = tex
  mat.userData.autoNormal = true
  mat.needsUpdate = true
}

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
    uWindStrength: { value: 0.12 },
    uWindSpeed: { value: 0.8 },
    uWindFrequency: { value: 1.0 },
    uGust: { value: 0.35 },
    uGustSpeed: { value: 0.16 },
    uTurbulence: { value: 0.12 },
    uSpatialScale: { value: 0.22 },
    uWindBias: { value: 0.3 },
    uFlexFalloff: { value: 1.5 },
    uWindEnabled: { value: 1 },
    uGrowth: { value: 1 },
    uGrowthEnabled: { value: 0 },
    uSeed: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.5, 1, 0.35).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
    // 模型节点选中 (两个材质共用同一份, uSelectMaterial 再配合各自的 uIsLeaf 判定)
    uSelectMode: { value: 0 },
    uSelectMaterial: { value: -1 },
    uSelRangeCount: { value: 0 },
    uSelRanges: { value: Array.from({ length: 8 }, () => new THREE.Vector2(0, -1)) },
    uSelColor: { value: new THREE.Color('#ffd166') },
    uSelGlow: { value: 0.35 },
    uSelDim: { value: 0.35 },
  }
}

/** 每个材质独立 uniform */
export function perMaterialUniforms(params, isLeaf) {
  const w = params.wind
  const m = isLeaf ? params.leafMat : params.bark
  return {
    uIsLeaf: { value: isLeaf ? 1 : 0 },
    uSway: { value: isLeaf ? 1.0 : (w.barkSway === undefined ? 1 : w.barkSway) },
    uVertexColorMix: { value: isLeaf ? resolveTintMix(m, !!(params.leafMat && params.leafMat.texture)) : (m.vertexColorMix === undefined ? 1 : m.vertexColorMix) },
    uTint: { value: new THREE.Color(m.tint || '#ffffff') },
    uTranslucency: { value: isLeaf ? (m.translucency || 0) : 0 },
    uSpecular: { value: isLeaf ? (m.specular === undefined ? 0 : m.specular) : 0 },
    uSpecularShininess: { value: (m.specularShininess === undefined ? 28 : m.specularShininess) },
    uSpecularColor: { value: new THREE.Color(m.specularColor || '#ffffff') },
    uScatter: { value: isLeaf ? (m.scatter || 0) : 0 },
    uScatterPower: { value: (m.scatterPower === undefined ? 2 : m.scatterPower) },
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
    // 注意: 不能保留 three 的 <color_fragment> —— 在 vertexColors:true 时它**无条件**乘一次
    // vColor, 那样即使 uVertexColorMix=0 (贴图原色模式) 贴图仍会被季节叶色染色。
    // 用我们自己的 body 替换它: 顶点色只经过 mix(diffuse, diffuse*vColor, uVertexColorMix) 这一条路。
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      fragmentBody(customFragment),
    )
    // 选中高亮 (自发光) 必须在 totalEmissiveRadiance 声明之后注入
    const emissiveInjection = '#include <emissivemap_fragment>\n' + SELECTION_GLOW +
      (opts.translucency ? TRANSLUCENCY + LEAF_REFLECTION : '')
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      emissiveInjection,
    )
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
    normalScale: new THREE.Vector2(
      p.normalScale === undefined ? 1 : p.normalScale,
      p.normalScale === undefined ? 1 : p.normalScale,
    ),
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
  // 叶片自发光: 用叶色做底, 强度由滑杆控制 (让背光/阴影里的叶子不至于死黑)
  // 自发光用独立颜色: 不再隐式拿季节叶色当底色 (否则选了贴图也会被染色)
  mat.emissive.set(p.emissiveColor || '#ffffff')
  mat.emissiveIntensity = p.emissive || 0
  const u = mat.userData.uniforms
  u.uVertexColorMix.value = resolveTintMix(p, !!(p.texture || (params.leaves && params.leaves.cardMode)))
  u.uTint.value.set(p.tint || '#ffffff')
  u.uTranslucency.value = p.translucency
  // 反光 / 散光
  u.uSpecular.value = p.specular === undefined ? 0 : p.specular
  u.uSpecularShininess.value = p.specularShininess === undefined ? 28 : p.specularShininess
  u.uSpecularColor.value.set(p.specularColor || '#ffffff')
  u.uScatter.value = p.scatter === undefined ? 0 : p.scatter
  u.uScatterPower.value = p.scatterPower === undefined ? 2 : p.scatterPower
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
  // ---- 法线贴图: 显式贴图优先, 否则从 albedo 自动生成 ----
  // 注意: 必须放在 mat.map 赋值之后, 否则第一次更新时 map 还是 null, 生成不出法线
  if (p.normalTexture) {
    if (!mat.normalMap || mat.userData.autoNormal) {
      if (mat.userData.autoNormal && mat.normalMap) disposeTexture(mat.normalMap)
      mat.normalMap = loadTexture(p.normalTexture, { srgb: false, normal: true })
      mat.userData.autoNormal = false
      mat.needsUpdate = true
    }
  } else {
    applyAutoNormal(mat, p)
  }
  const ns = p.normalScale === undefined ? 1 : p.normalScale
  mat.normalScale.set(ns, ns)
  return mat
}

/** 风场参数 -> 共享 uniform */
export function updateWindUniforms(uniforms, wind) {
  const rad = (wind.direction || 0) * Math.PI / 180
  uniforms.uWindDir.value.set(Math.cos(rad), Math.sin(rad))
  uniforms.uWindStrength.value = wind.strength
  uniforms.uWindSpeed.value = wind.speed
  uniforms.uWindFrequency.value = Math.max(0.05, wind.frequency === undefined ? 1 : wind.frequency)
  uniforms.uGust.value = wind.gust
  uniforms.uGustSpeed.value = Math.max(0.01, wind.gustSpeed)
  uniforms.uTurbulence.value = wind.turbulence
  uniforms.uSpatialScale.value = wind.spatialScale
  uniforms.uWindBias.value = wind.bias === undefined ? 0.3 : wind.bias
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
