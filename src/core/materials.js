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

/** 背面贴图的兜底采样: 1×1 白色纹理 (始终绑定 sampler, 避免 uniform 为空) */
let _whitePixelTexture = null
function whitePixelTexture() {
  if (!_whitePixelTexture) {
    _whitePixelTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat)
    _whitePixelTexture.colorSpace = THREE.NoColorSpace
    _whitePixelTexture.needsUpdate = true
  }
  return _whitePixelTexture
}

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
uniform float uUvWarp;
uniform float uUvWarpScale;
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
// --- 双面叶片: 背面独立颜色/贴图 ---
uniform float uBackEnabled;
uniform vec3 uBackColor;
uniform float uHasBackMap;
uniform sampler2D uBackMap;
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
  // 双面叶片: 背面使用独立颜色/贴图, 不参与正面的季节顶点色染色
  bool treeBackFace = (uBackEnabled > 0.5) && !gl_FrontFacing;
  if (treeBackFace) {
    diffuseColor.rgb *= uBackColor;
  } else {
    #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
      // three r186: vColor 永远是 vec4 (USE_COLOR 时 vColor.rgb 承载颜色)
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vColor.rgb, uVertexColorMix);
    #endif
    diffuseColor.rgb *= uTint;
  }
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
    // 用视图空间 normal/vViewPosition/光源；正反面 normal 由 three 翻转，
    // 不会再出现"只有背面透光/反光"。
    vec3 treeN = normalize(normal);
    vec3 treeL = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    float treeBack = pow(abs(dot(treeN, treeL)), 1.4);
    totalEmissiveRadiance += diffuseColor.rgb * uTranslucency * treeBack * uSunColor * (0.4 + 0.6 * vTreeWind);
  #endif
`

/** 叶片反光 (叶面高光) + 散光 (叶肉散射/边缘透亮) */
const LEAF_REFLECTION = /* glsl */`
  #ifndef FLAT_SHADED
  {
    // 关键: 用 three 处理过正/反面翻转的视图空间 normal，而不是原始顶点法线。
    vec3 treeN = normalize(normal);
    vec3 treeV = normalize(vViewPosition);        // 视空间视线方向
    vec3 treeL = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    // 反光: Blinn-Phong 高光 + 菲涅尔增亮 -> 湿叶/蜡质叶面的那种反光
    if (uSpecular > 0.001) {
      vec3 treeH = normalize(treeL + treeV);
      float treeSpec = pow(abs(dot(treeN, treeH)), max(1.0, uSpecularShininess));
      float treeFres = 0.35 + 0.65 * pow(1.0 - abs(dot(treeN, treeV)), 3.0);
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

/**
 * 自发光"显示空间"二次合成（注入在 tone mapping + 输出色彩空间转换**之后**）
 * ============================================================================
 * ## 为什么需要这一层
 * three 的 `emissive` 是"辐射亮度"：`outgoingLight += emissive`，随后**整条像素**
 * 一起做 ACES tone mapping × exposure。对叶/花这种双面卡片会出现：
 *   - **正面**（朝太阳、被照得很亮）已经处在 tone 曲线的高位，同一份加法被压缩
 *     到几乎看不出变化 → 观感是"正面自发光不生效"；
 *   - **背面 / 树下**很暗，同样的加法非常显眼 → "只有背面生效"。
 * 所以根因不是 `side` / `gl_FrontFacing`（正反两面走同一份着色器），而是
 * **加法发生的位置**。参见 `docs/树皮骨架与单蒙皮-技术文档.md` §5.19。
 *
 * ## 做法
 * 物理路径里的 emissive 项在 `applyTreeShader()` 里被清零
 * （`totalEmissiveRadiance = vec3(0.0)`），改在这里按**显示空间**合成：
 *   1) **色相**：向自发光颜色混合 → 被强光照白的正面也能明确看出颜色变化；
 *   2) **亮度**：显示空间加法 → 同一个强度值在亮面/暗面产生接近的视觉增量。
 * 两项都只依赖 `emissive`（= emissiveColor × emissiveIntensity），与法线/朝向无关，
 * 所以正反面天然一致；实测正/背面像素变化比值 0.73 → 0.96（半强度 1.00）。
 *
 * ## 参数（想调"发光观感"就改这两个数）
 *   - `EMISSIVE_HUE_MIX`：色相混合上限（0 = 只提亮，1 = 最大强度时完全变成自发光色）；
 *   - `EMISSIVE_ADD`：显示空间亮度增量上限（emissive=1 时加多少，0..1 的显示空间量）。
 * 两者都乘 `treeAmt`，所以滑杆 0..1 的行为单调、可预期；权重会自动写进 GLSL
 * 字符串，不需要同步改两处（`internalShaderSources()` 也读这两个常量）。
 *
 * ## 注意
 *   - 最高强度会**接近白色**（显示空间加法 + 向发光色混合本来就是往亮推），这是
 *     自发光该有的观感；不希望过曝就调低 `EMISSIVE_ADD`；
 *   - 这里改的是**视口合成**；材质的 `mat.emissive / emissiveIntensity` 照旧写入，
 *     GLB 导出的 emissiveFactor 不受影响（外部软件走标准 glTF 语义）；
 *   - 与"选中高亮 / 透光 / 反光 / 散光"不冲突：它们仍加在 `totalEmissiveRadiance`
 *     （tone mapping 之前），只有材质自发光走这一层。
 */
const EMISSIVE_HUE_MIX = 0.10
const EMISSIVE_ADD = 0.22
const EMISSIVE_COMPOSITE = /* glsl */`
  {
    // emissive = emissiveColor(线性) * emissiveIntensity(0..1)，由 three 每帧上传
    vec3 treeEmis = emissive;
    // 取最大通道当"强度"：纯色自发光（如 #ff0000）的最大通道就等于 intensity，
    // 因此不需要额外再传一个 intensity uniform
    float treeEmax = max(treeEmis.r, max(treeEmis.g, treeEmis.b));
    if (treeEmax > 1e-4) {                                 // 强度 0 时整段是纯 no-op
      vec3 treeHue = treeEmis / treeEmax;                  // 归一化色相（主导通道 = 1）
      float treeAmt = clamp(treeEmax, 0.0, 1.0);           // 强度 0..1
      // 1) 色相：向自发光色混合。被阳光照白的正面也能看到颜色变化；
      //    纯白自发光时这一步等价于"提亮到白"，视觉上仍然是发光。
      gl_FragColor.rgb = mix(gl_FragColor.rgb, treeHue, treeAmt * ${EMISSIVE_HUE_MIX.toFixed(2)});
      // 2) 亮度：显示空间加法，保证"正面被照亮"时也有同量级的发光增量；
      //    加法后钳到 1（此时 gl_FragColor 已在输出色彩空间，>1 会被截断成怪色）
      gl_FragColor.rgb = min(gl_FragColor.rgb + treeHue * (treeAmt * ${EMISSIVE_ADD.toFixed(2)}), vec3(1.0));
    }
  }
`

/** 双面叶片: 用 gl_FrontFacing 在正面贴图 / 背面贴图之间切换 (alpha 一起切换) */
const LEAF_BACK_MAP_FRAGMENT = /* glsl */`
#ifdef USE_MAP
  vec4 treeFrontTexel = texture2D( map, vMapUv );
  if (uBackEnabled > 0.5 && !gl_FrontFacing) {
    vec4 treeBackTexel = (uHasBackMap > 0.5) ? texture2D( uBackMap, vMapUv ) : treeFrontTexel;
    diffuseColor *= treeBackTexel;
  } else {
    diffuseColor *= treeFrontTexel;
  }
#endif
`

/**
 * 供自检 / 外部诊断使用：把注入用的 GLSL 片段与声明头原文暴露出来。
 *
 * 用途：
 *   - `selftest` 静态断言"片段里没有用未声明的 uniform""正反面高光用了 abs""自发光
 *     合成注入在 colorspace 之后"等，避免改着色器时静默破坏约定；
 *   - 导出/调试面板可以直接展示实际注入的代码。
 * 注意：这里返回的是**原文引用**，调用方不要修改（字符串不可变，改也无效）。
 */
export function internalShaderSources() {
  return {
    fragmentHeader: FRAGMENT_HEADER,
    vertexHeader: VERTEX_HEADER,
    snippets: { TRANSLUCENCY, LEAF_REFLECTION, SELECTION_GLOW, LEAF_BACK_MAP_FRAGMENT, EMISSIVE_COMPOSITE },
    emissiveComposite: { hueMix: EMISSIVE_HUE_MIX, add: EMISSIVE_ADD },
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

/**
 * 按参数"挂上/摘掉"从 albedo 自动生成的视口法线贴图（叶片/花朵/树皮通用）。
 *
 * 触发条件（三者同时满足才生成）：未上传法线贴图 `p.normalTexture`、强度
 * `p.normalFromAlbedo > 0`、且当前有 diffuse 贴图 `p.texture`。任一不满足就
 * 摘掉自己之前挂的自动法线（只摘自己的，不碰用户上传的）。
 *
 * 生命周期 / 契约：
 *   - 生成走 `albedoNormalTexture()`（长边 256、flipY 跟随源贴图、带缓存）；
 *   - `p.texture` 变化（换卡片）会重新生成：缓存键含 URL，所以不会拿到旧图；
 *   - 贴图还没解码完时生成会失败 → 挂到该贴图的 `onUpdate` 上等一次，成功后标记
 *     `userData[flagKey] = true`；
 *   - 同时在 `mat.userData.autoNormalStrength` 记录强度：**导出**时
 *     `ensureExportTextureAlignment()` 需要用它按全尺寸重新生成（视口版是压缩过的，
 *     不能直接导出）。
 *
 * @param {THREE.Material} mat 目标材质
 * @param {object} p 材质参数（leafMat / flower / bark）
 * @param {string} [flagKey] userData 里的标记键名 —— 树皮已有 `autoNormal` 用来存
 *        程序化法线贴图，所以必须用不同的键，否则会把程序化法线当成自动法线清掉
 */
function applyAutoNormal(mat, p, flagKey = 'autoNormal') {
  const strength = p.normalFromAlbedo === undefined ? 0 : p.normalFromAlbedo
  if (p.normalTexture || strength <= 0 || !p.texture) {
    if (mat.normalMap && mat.userData[flagKey]) {
      mat.normalMap = null
      mat.userData[flagKey] = false
      mat.userData.autoNormalStrength = 0
      mat.needsUpdate = true
    }
    return
  }
  const map = mat.map
  const tex = albedoNormalTexture(map, strength, p.texture)
  if (!tex) {
    // 贴图还没解码完 -> 等它 update 后重试 (只挂一次)
    if (map && !map.userData.__autoNormalHooked) {
      map.userData.__autoNormalHooked = true
      const prev = map.onUpdate
      map.onUpdate = () => {
        if (typeof prev === 'function') prev()
        const t = albedoNormalTexture(map, strength, p.texture)
        if (t && !mat.normalMap) {
          mat.normalMap = t
          mat.userData[flagKey] = true
          mat.userData.autoNormalStrength = strength
          mat.needsUpdate = true
        }
      }
    }
    return
  }
  // 已经是这张图了就不重复赋值 (避免每次更新材质都触发重编译)
  if (mat.normalMap === tex) return
  if (mat.userData[flagKey] && mat.normalMap) disposeTexture(mat.normalMap)
  mat.normalMap = tex
  mat.userData[flagKey] = true
  mat.userData.autoNormalStrength = strength
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
    uUvWarp: { value: isLeaf ? 0.0 : 0.0 },
    uUvWarpScale: { value: 8.0 },
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
    // 双面叶片
    uBackEnabled: { value: 0 },
    uBackColor: { value: new THREE.Color(m.backColor || '#b9d49a') },
    uHasBackMap: { value: 0 },
    uBackMap: { value: whitePixelTexture() },
  }
}

/**
 * 给 MeshStandardMaterial 注入"树专用"着色器代码（叶/花/树皮共用同一套注入点）。
 *
 * 注入点一览（都是 three 的 chunk 替换，替换失败 = 该功能静默失效，selftest 有断言）：
 *
 * | 注入点 | 内容 | 作用 |
 * | --- | --- | --- |
 * | `<begin_vertex>` | `vertexBody()` + 自定义顶点 GLSL | 生长动画、风场位移、叶片铰链、节点选中 |
 * | `<uv_vertex>` | 贴图扭曲（低频正弦偏移 vMapUv） | 叶片纹理抖动 |
 * | `<map_fragment>` | `LEAF_BACK_MAP_FRAGMENT`（仅 isLeaf） | 正/背面独立贴图（gl_FrontFacing） |
 * | `<color_fragment>` | `fragmentBody()` + 自定义片元 GLSL | 顶点色只走 uVertexColorMix、背面独立颜色、选中/隔离 |
 * | `<emissivemap_fragment>` | 选中高亮 + 清空 three 自带 emissive + 透光/反光/散光 | 光照类附加项 |
 * | `<colorspace_fragment>` | `EMISSIVE_COMPOSITE` | 材质自发光按显示空间合成（修"只在背面生效"） |
 *
 * uniform 分两类（见文件头）：
 *   - `shared`：时间/风场/太阳等，所有材质共享同一个对象，改一次全局生效；
 *   - `material`：每个材质自己的（uTint/uTranslucency/uBackEnabled…），
 *     存在 `mat.userData.uniforms` 里，编译前后都能安全更新。
 *
 * `customProgramCacheKey` 把"是否叶片 / 自定义 GLSL 哈希 / 是否有透光"编进程序
 * 缓存键：两种材质的注入代码不同却共用缓存键时，three 会复用一个 program，
 * 导致后编译的材质拿到前者的着色器。
 *
 * @param {THREE.MeshStandardMaterial} material 目标材质（叶/花/树皮）
 * @param {object} shaderUniforms 合并后的 uniform 表（shared + material 专属）
 * @param {{isLeaf?:boolean, translucency?:boolean, customEnabled?:boolean,
 *          customVertex?:string, customFragment?:string}} opts
 */
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
    // 贴图扭曲: 用低频正弦场偏移 vMapUv (只影响贴图采样, 不改几何)
    if (shader.vertexShader.includes('#include <uv_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
        if (uUvWarp > 0.0) {
          float wx = vMapUv.x * uUvWarpScale;
          float wy = vMapUv.y * uUvWarpScale;
          float n1 = sin(wy * 0.7 + wx * 0.35) * sin(wx * 0.9 + 1.7);
          float n2 = sin(wx * 0.6 - wy * 0.4 + 2.3) * sin(wy * 1.1 + 0.4);
          float n3 = sin((wx + wy) * 0.45 + 3.1);
          vMapUv += vec2(n1, n2 + n3 * 0.5) * uUvWarp;
        }
#endif`,
      )
    }
    shader.fragmentShader = FRAGMENT_HEADER + shader.fragmentShader
    // 双面叶片: 背面采样背面贴图 (没有背面贴图则沿用正面贴图), 正面保持原逻辑
    if (isLeaf) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        LEAF_BACK_MAP_FRAGMENT,
      )
    }
    // 注意: 不能保留 three 的 <color_fragment> —— 在 vertexColors:true 时它**无条件**乘一次
    // vColor, 那样即使 uVertexColorMix=0 (贴图原色模式) 贴图仍会被季节叶色染色。
    // 用我们自己的 body 替换它: 顶点色只经过 mix(diffuse, diffuse*vColor, uVertexColorMix) 这一条路。
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      fragmentBody(customFragment),
    )
    // 选中高亮 / 透光 / 反光 / 散光 / 材质自发光，都必须在
    // `totalEmissiveRadiance` 声明之后注入（该变量由 three 的 physical 片元着色器
    // 在 <emissivemap_fragment> 之前初始化为 `emissive`）。
    //
    // **清零 three 自带的 emissive 项**：它会被加进 outgoingLight 再统一 tone mapping，
    // 正面被阳光照亮时被压得看不出，造成"自发光只有背面生效"（见 EMISSIVE_COMPOSITE
    // 的说明）。这里清零后，材质自发光改由后面的显示空间合成负责；
    // 高亮 / 透光 / 反光 / 散光仍然走原来的辐射亮度路径（它们本来就是"光照"）。
    const emissiveInjection = '#include <emissivemap_fragment>\n' +
      'totalEmissiveRadiance = vec3(0.0);\n' +
      SELECTION_GLOW +
      (opts.translucency ? TRANSLUCENCY + LEAF_REFLECTION : '')
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      emissiveInjection,
    )
    // 自发光二次合成：必须放在 <colorspace_fragment> **之后**。
    // 此时 gl_FragColor 已经是 tone mapping + 输出色彩空间（sRGB）后的显示值，
    // 在这里做色相混合 / 加法，才不会被 ACES 按底色亮度压缩（根的因见上面常量注释）。
    // 该 chunk 在 MeshStandardMaterial 的片元着色器里一定存在，替换失败会让自发光
    // 完全消失，所以 `dev/emissive-front-check.html` 与 selftest 都断言了注入位置。
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <colorspace_fragment>',
      '#include <colorspace_fragment>\n' + EMISSIVE_COMPOSITE,
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

/** 花朵材质参数: 在树叶材质参数基础上, 用花朵自己的贴图/染色/裁切覆盖 */
function flowerLeafParams(params) {
  const f = params.flower || {}
  return {
    ...params,
    leafMat: {
      ...params.leafMat,
      texture: f.texture || '',
      normalTexture: f.normalTexture || '',
      tintMode: f.tintMode || 'texture',
      // 花朵贴图透明区是黑色；alphaTest<=0 会把整张卡片的黑底画出来。
      // 即使旧参数/旧存档里是 0，也强制回落到默认裁切阈值。
      alphaTest: !f.alphaTest || f.alphaTest <= 0.01 ? 0.35 : f.alphaTest,
      // 花卡素材的白色花瓣内部可能有封闭透明洞；加载时修复 alpha 并做颜色扩散。
      alphaRepair: true,
      normalFromAlbedo: f.normalFromAlbedo || 0,
      textureU: f.textureU || 0,
      textureV: f.textureV || 0,
      textureRepeat: f.textureRepeat === undefined ? 1 : f.textureRepeat,
      textureRepeatU: f.textureRepeatU === undefined ? (f.textureRepeat === undefined ? 1 : f.textureRepeat) : f.textureRepeatU,
      textureRepeatV: f.textureRepeatV === undefined ? (f.textureRepeat === undefined ? 1 : f.textureRepeat) : f.textureRepeatV,
      textureRotation: f.textureRotation || 0,
      translucency: f.translucency === undefined ? params.leafMat.translucency : f.translucency,
      // 花朵也使用自己的自发光/反光/散光 (与树叶解耦)
      emissive: f.emissive === undefined ? 0 : f.emissive,
      emissiveColor: f.emissiveColor || '#ffffff',
      specular: f.specular === undefined ? 0 : f.specular,
      specularShininess: f.specularShininess === undefined ? 24 : f.specularShininess,
      specularColor: f.specularColor || '#ffffff',
      scatter: f.scatter === undefined ? 0 : f.scatter,
      scatterPower: f.scatterPower === undefined ? 2 : f.scatterPower,
      // 背面独立材质只给树叶用, 花朵保持单面材质
      backEnabled: false,
      backTexture: '',
    },
  }
}

/** 花朵材质 (独立实例: 可以有和树叶不同的贴图/着色) */
export function createFlowerMaterial(params, sharedUniforms) {
  const mat = createLeafMaterial(flowerLeafParams(params), sharedUniforms)
  mat.userData.kind = 'flower'
  return mat
}

export function updateFlowerMaterial(mat, params, sharedUniforms) {
  updateLeafMaterial(mat, flowerLeafParams(params), sharedUniforms)
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
  u.uUvWarp.value = p.uvWarp === undefined ? 0 : p.uvWarp
  u.uUvWarpScale.value = p.uvWarpScale === undefined ? 8 : p.uvWarpScale
  u.uVertexColorMix.value = p.vertexColorMix
  u.uTint.value.set(p.tint || '#ffffff')

  if (p.texture) {
    const key = 'user:' + p.texture.slice(-48) + ':' + (p.normalTexture || '').slice(-24)
    if (key !== mat.userData.__texKey) {
      mat.userData.__texKey = key
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
    if (key !== mat.userData.__texKey) {
      mat.userData.__texKey = key
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
  // 照片树皮: 没有自带法线贴图时, 从颜色贴图自动生成 (裂纹/凹凸 -> 真实光照细节)
  // 程序化树皮已经有 makeBarkTextures 生成的法线, 不走这里
  const wantAutoNormal = !!p.texture && !p.normalTexture && (p.normalFromAlbedo || 0) > 0
  if (wantAutoNormal) {
    applyAutoNormal(mat, p, 'autoBarkNormal')
  } else if (mat.userData.autoBarkNormal) {
    // 显式关闭: 清掉自动生成的法线 (不然滑杆归零后仍然生效)
    if (mat.normalMap) disposeTexture(mat.normalMap)
    mat.normalMap = null
    mat.userData.autoBarkNormal = false
    mat.needsUpdate = true
  }
  setTextureRepeat(mat.map, p.uvScaleU, p.uvScaleV)
  setTextureRepeat(mat.normalMap, p.uvScaleU, p.uvScaleV)
  setTextureRepeat(mat.roughnessMap, p.uvScaleU, p.uvScaleV)
  return mat
}

function clearAutoBarkTextures(mat) {
  const auto = [mat.userData.autoMap, mat.userData.autoNormal, mat.userData.autoRough, mat.userData.autoBarkNormal]
  for (const t of auto) if (t && t.isTexture) disposeTexture(t)
  mat.userData.autoMap = null
  mat.userData.autoNormal = null
  mat.userData.autoRough = null
  mat.userData.autoBarkNormal = null
  if (auto.includes(mat.map)) mat.map = null
  if (auto.includes(mat.normalMap)) mat.normalMap = null
  if (auto.includes(mat.roughnessMap)) mat.roughnessMap = null
}

export function updateLeafMaterial(mat, params, sharedUniforms) {
  const p = params.leafMat
  mat.roughness = p.roughness
  mat.metalness = p.metalness
  // 花朵现在只有平面花卡: 两种材质都必须按贴图 alpha 裁形
  // (alphaTest = 0 会把贴图透明区绘制成黑边)
  mat.alphaTest = p.alphaTest || 0
  // 开启背面独立材质时自动启用双面渲染, 否则永远看不到背面
  mat.side = (p.doubleSided || p.backEnabled) ? THREE.DoubleSide : THREE.FrontSide
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
  // 双面叶片: 背面开关 / 颜色 / 独立贴图
  u.uBackEnabled.value = p.backEnabled ? 1 : 0
  u.uBackColor.value.set(p.backColor || '#b9d49a')
  const backKey = p.backTexture || ''
  if (backKey !== mat.userData.__backTexKey) {
    mat.userData.__backTexKey = backKey
    if (mat.userData.backMap) {
      disposeTexture(mat.userData.backMap)
      mat.userData.backMap = null
    }
    if (backKey) {
      const tex = loadTexture(backKey, { clamp: true, repairAlpha: p.alphaRepair === true })
      mat.userData.backMap = tex
      u.uBackMap.value = tex
      u.uHasBackMap.value = 1
    } else {
      u.uBackMap.value = whitePixelTexture()
      u.uHasBackMap.value = 0
    }
  }

  const key = p.texture ? 'user:' + p.texture.slice(-48) : 'auto:' + params.leaves.shape
  if (key !== mat.userData.__texKey) {
    mat.userData.__texKey = key
    const old = mat.map
    const hadAuto = mat.userData.autoLeafMap
    if (p.texture) {
      mat.map = loadTexture(p.texture, { clamp: true, repairAlpha: p.alphaRepair === true })
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
  // ---- 贴图加载失败兜底: 清掉 map 并关掉 alphaTest, 否则贴图空采样 + alphaTest 会把叶片全裁掉 ----
  if (mat.map && mat.map.userData && mat.map.userData.loadFailed) {
    mat.map = null
    mat.alphaTest = 0
    mat.needsUpdate = true
  }

  // ---- 贴图在模型上的位置/缩放/旋转 (花朵可视化面板会改这几个) ----
  if (mat.map) {
    const ru = p.textureU || 0
    const rv = p.textureV || 0
    const rr = p.textureRepeat === undefined ? 1 : p.textureRepeat
    const rru = p.textureRepeatU === undefined ? rr : p.textureRepeatU
    const rrv = p.textureRepeatV === undefined ? rr : p.textureRepeatV
    const rot = p.textureRotation || 0
    const changed = mat.map.offset.x !== ru || mat.map.offset.y !== rv ||
      mat.map.repeat.x !== rru || mat.map.repeat.y !== rrv || mat.map.rotation !== rot
    mat.map.center.set(0.5, 0.5)
    mat.map.offset.set(ru, rv)
    mat.map.repeat.set(rru, rrv)
    mat.map.rotation = rot
    if (changed) mat.map.needsUpdate = true
    // 背面贴图共用同一套 UV 位置/缩放/旋转
    if (mat.userData.backMap) {
      const bt = mat.userData.backMap
      bt.center.set(0.5, 0.5)
      bt.offset.set(ru, rv)
      bt.repeat.set(rru, rrv)
      bt.rotation = rot
      bt.needsUpdate = true
    }
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
  if (mats.flower) updateFlowerMaterial(mats.flower, params, mats.uniforms)
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
