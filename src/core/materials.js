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
 *
 * 作用: 全项目所有可见表面的材质来源 —— 树皮 / 树叶 / 花朵三套 PBR 材质,
 *       并把"动画"（风场、生长）与"交互"（节点选中）做成着色器注入,
 *       这样几何体本身不需要每帧重建。
 * 输入 / 输出: 输入是 `store/treeStore.js` 的 params 参数树
 *       (params.bark / params.leafMat / params.flower / params.wind / params.custom);
 *       输出是配置好的 `THREE.MeshStandardMaterial`（带 userData.uniforms / kind）。
 * 与其他模块的关系:
 *       - `sceneManager.js` 调 create* / update* 并把材质挂到树皮/树叶/花朵三个 Mesh 上，
 *         每帧只改 `uniforms.uTime`（见 updateWind/growthUniforms 与渲染循环）;
 *       - 贴图由 `textures.js` 生产（程序化树皮/叶片纹理 + loadTexture 缓存）,
 *         自动法线由 `normalFromAlbedo.js` 生成;
 *       - 导出走 `exporter.js` → `textureNaming.js`，那里会临时补槽/对齐/改名，
 *         但**材质本身仍是本文件生产的这一份**（所以 UBO/uniform 必须可安全序列化）;
 *       - `materialPreview.js` 复用同一套 create* 工厂，保证预览与视口观感一致。
 * 关键概念 / 约定:
 *       - 颜色: `THREE.Color` 构造时按 sRGB 解释并转线性空间参与光照；传入的字符串
 *         一律是 UI 里的十六进制色（#rrggbb），不要在这里再手工做 gamma;
 *       - 单位: 几何是米；风场位移量级 (uWindStrength≈0.12) 也是米;
 *       - 闪烁/抖动类参数 (uGust/uTurbulence/uLeafFlutter) 都是 0..1 的无量纲增益;
 *       - 顶点属性约定（由几何构建侧写入）:
 *           aWind    : 0..1，该顶点"随风弯曲能力"（树梢 1、根部 0）
 *           aPhase   : 随机相位（让相邻枝条不同步摆动）
 *           aOrigin  : 叶片铰链的支点（叶柄根部）世界/局部坐标
 *           aGrow    : vec2(开始阈值, 结束阈值)，生长动画的时间窗
 *           aNodeId  : 所属模型节点 id，供"节点树选中"匹配范围
 * 注意: 所有注入都是 three chunk 的**字符串替换**，chunk 名一旦随 three 版本变化，
 *       替换会静默失效（功能消失但不报错）。selftest / internalShaderSources()
 *       就是为了盯住这一点；改注入点时必须同步更新那里的断言。
 */
import * as THREE from 'three'
import { albedoNormalTexture } from './normalFromAlbedo.js'
import { makeBarkTextures, makeLeafTexture, loadTexture, setTextureRepeat, disposeTexture } from './textures.js'

/**
 * 背面贴图的兜底采样: 1×1 白色纹理 (始终绑定 sampler, 避免 uniform 为空)
 *
 * 为什么需要它：`uBackMap` 是 sampler2D，即使 `uHasBackMap = 0` 也**必须**绑定一张
 * 有效纹理，否则 WebGL 在部分驱动上会因"sampler 类型 uniform 未绑定"而报错/出黑块。
 * 白色是乘法单位元，绑白图等价于"没有背面贴图"。
 * 全局单例 + 懒创建：所有材质共用一张 4 字节纹理，不需要每个材质各建一份。
 */
let _whitePixelTexture = null
function whitePixelTexture() {
  if (!_whitePixelTexture) {
    _whitePixelTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat)
    // 数据贴图没有"颜色"语义，标记为线性，避免被当成 sRGB 再解一次码。
    _whitePixelTexture.colorSpace = THREE.NoColorSpace
    _whitePixelTexture.needsUpdate = true
  }
  return _whitePixelTexture
}

/**
 * 顶点着色器的公共声明头（拼接在所有 MeshStandardMaterial 顶点着色器之前）。
 *
 * 内容分三组：
 *   1. 几何属性: aWind / aPhase / aOrigin / aGrow / aNodeId —— 由几何构建侧写入；
 *   2. 全局动画 uniform: 时间、风向、风速、阵风、湍流、空间缩放、生长进度；
 *   3. 每个材质自己的 uniform: uSway / uUvWarp / uLeafFlutter / uLeafTwist / uIsLeaf
 *      与"节点选中"状态（uSelectMode / uSelRanges[8]）。
 * 末尾的 `treeRotate()` 是罗德里格旋转公式，叶片的铰链式俯仰用它（见 vertexBody）。
 */
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

/**
 * 生成替换 `<begin_vertex>` 的顶点变换主体 —— 风场 / 生长 / 叶片铰链 / 节点选中。
 *
 * 注入时序（对 transformed 的加工顺序不能换）：
 *   ① 取当前顶点位置 treePos = transformed；
 *   ② **生长**：按 aGrow 时间窗算 growK（0..1，smoothstep 缓动），
 *      把顶点从 aOrigin 插值到最终位置 —— 于是枝条"从根部往梢部长出来"；
 *   ③ 世界坐标 + 风向投影算相位（同风向线上的一段枝条同步摆，不会各自乱摆）；
 *   ④ **风场**：主波 + 次波 + 阵风 + 湍流，沿风向/垂直风向合成水平位移，
 *      乘 flex（aWind^uFlexFalloff）让根部不动、树梢摆动最大；
 *   ⑤ **叶片额外**：叶柄固定，只做"下风向弯曲 + 绕水平轴的铰链式俯仰"；
 *   ⑥ **节点选中**：按 aNodeId 是否落在 uSelRanges 区间内算出 vTreeSelected。
 *
 * 为什么先算树世界位置再算相位：`dot(treeWorld.xz, windDir) * uSpatialScale`
 * 是一个沿风向的"行波"相位，使同一棵树上的大枝/小枝保持连贯的行波，
 * 而不是逐顶点随机 —— 随机相位会让整棵树看起来像在抖动。
 *
 * @param {string} customVertex 用户自定义顶点 GLSL（已判空；为空串时原样拼接）
 * @returns {string} 可替换 `<begin_vertex>` 的整段 GLSL 源码
 */
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

/**
 * 片元着色器的公共声明头。
 *
 * 与顶点头里的属性不同，这里全是 uniform 与 varying：
 *   - 从顶点阶段带下来的 vTreeUv / vTreeWind / vTreeSelected；
 *   - 材质侧参数：顶点色混合量 uVertexColorMix、整体染色 uTint、透光 uTranslucency；
 *   - 叶片光学：反光 (uSpecular/uSpecularShininess/uSpecularColor) 与
 *     散光 (uScatter/uScatterPower)，都需要太阳方向/颜色（uSunDir/uSunColor）；
 *   - 双面叶片：uBackEnabled/uBackColor/uHasBackMap/uBackMap；
 *   - 选中高亮：uSelectMode/uSelColor/uSelGlow/uSelDim。
 * 注意：`uSunDir` 是**世界空间**方向，进片元后先用 viewMatrix 变到视空间再参与点乘。
 */
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

/**
 * 生成替换 `<color_fragment>` 的片元主体 —— 顶点色 / 背面颜色 / 选中隔离。
 *
 * 为什么要**替换**而不是追加：three 自带的 `<color_fragment>` 在
 * `vertexColors: true` 时**无条件**执行 `diffuseColor.rgb *= vColor`，
 * 那样即使 uVertexColorMix = 0（"贴图原色"模式），贴图也会被季节叶色染色，
 * 滑杆最左端就失效了。这里改成只走一条 `mix(diffuse, diffuse*vColor, uMix)`。
 *
 * 分支顺序有语义：
 *   ① 背面（uBackEnabled 且 !gl_FrontFacing）只乘 uBackColor，**不参与**顶点色染色，
 *      否则叶片背面会被季节色染成和正面一样；
 *   ② 背面模式关闭时，正面/背面都按 uVertexColorMix 混顶点色，再乘 uTint；
 *   ③ 之后才是节点选中（隔离 discard / 变暗 / 选中混色），
 *      放在最后是为了让"选中色"覆盖前面所有的染色结果。
 *
 * @param {string} customFragment 用户自定义片元 GLSL（已判空；为空串时原样拼接）
 * @returns {string} 可替换 `<color_fragment>` 的整段 GLSL 源码
 */
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

/**
 * 选中高亮片段：给选中的顶点在 `totalEmissiveRadiance` 上叠一层自发光。
 *
 * 走 `totalEmissiveRadiance` 而不是直接改 diffuse，是因为它参与完整光照 + 色调映射，
 * 即使在暗部也能看出"被选中"的发光感，而不是单纯把颜色调亮。
 * 强度由 uSelGlow 控制（默认 0.35，够醒目又不至于把树皮纹理冲成一片白）。
 */
const SELECTION_GLOW = /* glsl */`
  if (vTreeSelected > 0.5) {
    totalEmissiveRadiance += uSelColor * uSelGlow;
  }
`

/**
 * 叶片透光（次表面透射的廉价近似）。
 *
 * 物理直觉：叶肉很薄，阳光穿过叶片后从背面射出，所以**逆光时叶片发亮**。
 * 这里没有真的做次表面散射，而是用 |N·L| 的幂次当作"穿过的光通量"：
 *   - 用 abs() 而不是 max(0, ·)：太阳在叶片背后（背面朝光）时也应该透光，
 *     否则只有顺光一侧的叶子有透光，逆光一片死黑；
 *   - pow(..., 1.4) 让正对太阳（透光最多）时曲线更陡，符合薄片透射的观感；
 *   - 再乘 `(0.4 + 0.6 * vTreeWind)`：风把叶子吹得越弯，透光越强一点，
 *     避免静止的树看起来像塑料（也顺带掩盖了低模叶片的生硬）。
 * uTranslucency 直接来自叶材质滑杆，0 = 关闭（整段在数值上是 0，开销可忽略）。
 */
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

/**
 * 叶片反光 (叶面高光) + 散光 (叶肉散射/边缘透亮)
 *
 * 两项都加在 `totalEmissiveRadiance`（色调映射之前的"辐射亮度"路径），因为它们的
 * 本质是**光照现象**，应当和主光一样被曝光/色调映射统一处理。
 *
 * 反光：Blinn-Phong（半程向量 H = normalize(L+V)）而不是 GGX —— 叶片是薄片，
 *   物理 BRDF 的微表面模型在这种亚像素厚度的卡片上收益很低，而 Blinn-Phong
 *   的指数（uSpecularShininess，默认 28）直观对应"光泽度"，调参体验更好。
 *   乘菲涅尔 `0.35 + 0.65·(1-|N·V|)^3`：掠射角反光更强，就是"湿叶/蜡质叶面"
 *   那种边缘发亮的观感；3 次幂是常用的 Schlick 近似。
 *
 * 散光：`(1-|N·V|)^power` 当作"穿过叶肉的光程"，视线越接近切线方向叶肉越薄，
 *   散射越亮 → 逆光时叶片边缘出现一圈透亮的光晕。再乘 `0.35 + 0.65·max(N·L,0)`
 *   让背光面不至于亮得不真实（那部分由 TRANSLUCENCY 负责）。
 *
 * 两处都用 `abs(dot(...))`：three 会在背面朝观察者时翻转法线，用 abs 可以保证
 * 正/反面得到同一套光学响应，不会出现"只有一面反光"。
 */
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

/**
 * 双面叶片: 用 gl_FrontFacing 在正面贴图 / 背面贴图之间切换 (alpha 一起切换)
 *
 * 替换的是 `<map_fragment>` —— three 在这里做 `diffuseColor *= texture2D(map, vMapUv)`。
 * 这里把结果存到局部变量 treeFrontTexel，背面再按 uHasBackMap 决定用背面贴图
 * 还是复用正面贴图：
 *   - 复用正面贴图是常见的省资源做法（一张叶卡两面用），只是背面颜色/亮度
 *     由 fragmentBody 里的 uBackColor 另调；
 *   - 必须整条 vec4 一起替换（含 alpha），否则正面/背面的 alphaTest 裁形会不一致，
 *     叶片背面会出现"透明的叶脉"或"实心的叶缘空隙"。
 * 该片段只在 isLeaf = true 时注入（树皮是实体，没有正反面之分）。
 */
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
 *
 * 三种模式（对应 UI 的染色下拉框）：
 *   - `'texture'`：贴图原色。**有贴图时返回 0**（完全不染）；没有贴图时返回 1 ——
 *     程序化叶形是中性灰度遮罩，颜色全靠顶点色，否则会渲染成白叶子；
 *   - `'season'` ：跟随季节色，恒返回 1（顶点色全量生效）；
 *   - 其它（含未设置）：自定义模式，读 `m.vertexColorMix`（0..1），默认 0.5。
 *
 * @param {object} m leafMat 参数（花材质也复用同一套字段）
 * @param {boolean} [hasTexture] 是否真的有贴图。程序化叶形是**中性灰度遮罩**, 颜色全部来自顶点色,
 *        所以"原色"模式在没有贴图时没有意义 -> 自动回落到跟随季节 (否则会渲染成白叶子)。
 * @returns {number} 顶点色混合系数 0..1（0 = 只用贴图色，1 = 完全用顶点色）
 */
export function resolveTintMix(m, hasTexture) {
  const mode = m.tintMode || 'season'
  // undefined 视为"有贴图"：早期版本的参数表里没有 hasTexture，保持旧行为。
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
  // 三个条件任一不满足就"什么都不挂"：已有用户法线（不能覆盖）、强度为 0
  // （滑杆归零应彻底关闭）、没有 diffuse（没有高度场可推）。
  if (p.normalTexture || strength <= 0 || !p.texture) {
    // 只摘掉**自己挂的**那张（flagKey 标记），用户上传的法线保持不动。
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
    // 用 userData 上的标记保证只挂钩一次：onUpdate 里再挂会在每次更新时
    // 层层包装回调，形成无限增长的调用链。
    if (map && !map.userData.__autoNormalHooked) {
      map.userData.__autoNormalHooked = true
      const prev = map.onUpdate
      map.onUpdate = () => {
        if (typeof prev === 'function') prev()
        const t = albedoNormalTexture(map, strength, p.texture)
        // 只在当前仍没有法线时补上：期间用户可能已手动指定了法线贴图。
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

/**
 * FNV-1a 32 位字符串哈希，返回 base36 短串。
 *
 * 用途：把"自定义 GLSL 源码"压成一个短键，拼进 `customProgramCacheKey`。
 * 为什么不用源码本身当键：源码可能几百行，每次比较都是长字符串；而且
 * three 的 cache key 会进入 program 的 Map 键，越短越好。
 * 初值 2166136261 / 质数 16777619 是 FNV-1a 的标准参数；`Math.imul` 保证
 * 32 位截断（普通 * 在 JS 里会溢出成 53 位浮点，哈希质量会崩）。
 * `>>> 0` 把有符号结果转回无符号，否则负数的 toString(36) 会带 '-'。
 *
 * @param {string} s 待哈希字符串
 * @returns {string} base36 表示的 32 位哈希（长度通常 6~7）
 */
function hashCode(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/**
 * 全局共享 uniform (同一个对象被两个材质引用)
 *
 * "共享"的含义：树皮/树叶/花朵三个材质的 shader.uniforms 里放的是**同一个对象引用**，
 * 所以每帧只改一份 `uTime` 就能让所有材质同步，不必逐个材质遍历。
 * 调用方：`sceneManager.js` 的渲染循环（改 uTime）、
 *        `updateWindUniforms()` / `updateGrowthUniforms()`（改风与生长）、
 *        节点选中逻辑（改 uSelectMode / uSelRanges）。
 *
 * 默认值即"无风静止"状态：uWindStrength 0.12 是米级的轻微摆动，
 * uWindEnabled 1 但强度小；uGrowthEnabled 0 = 不播放生长动画。
 * @returns {Object<string, {value: *}>} three 格式的 uniform 表
 */
export function createSharedUniforms() {
  return {
    // ---- 动画时钟 ----
    uTime: { value: 0 },                                    // 秒；风场/抖动全部由它驱动
    // ---- 风场（世界空间）----
    uWindDir: { value: new THREE.Vector2(1, 0) },           // 水平风向（单位向量，XZ 平面）
    uWindStrength: { value: 0.12 },                          // 位移幅度，米
    uWindSpeed: { value: 0.8 },                              // 时间缩放，越大摆得越快
    uWindFrequency: { value: 1.0 },                          // 次波频率倍率（主波固定 1×）
    uGust: { value: 0.35 },                                  // 阵风强度 0..1，压低摆动低谷
    uGustSpeed: { value: 0.16 },                             // 阵风变化速度（很慢，像气流过境）
    uTurbulence: { value: 0.12 },                            // 垂直风向的乱流幅度
    uSpatialScale: { value: 0.22 },                          // 沿风向的行波相位密度（1/米）
    uWindBias: { value: 0.3 },                               // 静态偏置，保证"只推不拉"
    uFlexFalloff: { value: 1.5 },                            // aWind 的指数，越大则只有树梢动
    uWindEnabled: { value: 1 },                              // 0 = 完全关风（静态预览/导出用）
    // ---- 生长动画 ----
    uGrowth: { value: 1 },                                   // 0..1 生长进度，1 = 完全长成
    uGrowthEnabled: { value: 0 },                            // 1 = 播放生长（顶点回插到 aOrigin）
    // ---- 确定性种子 ----
    uSeed: { value: 0 },                                     // 0..999，参与相位偏移，让每棵树风形不同
    // ---- 太阳（叶片透光/反光/散光与主光方向共用）----
    uSunDir: { value: new THREE.Vector3(0.5, 1, 0.35).normalize() }, // 世界空间，指向光源
    uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },     // 略偏暖，模拟日光
    // 模型节点选中 (两个材质共用同一份, uSelectMaterial 再配合各自的 uIsLeaf 判定)
    uSelectMode: { value: 0 },                               // 0 关 / 1 高亮 / 2 仅显示 / 3 变暗
    uSelectMaterial: { value: -1 },                          // -1 不过滤 / 0 树皮 / 1 树叶
    uSelRangeCount: { value: 0 },                            // uSelRanges 里有效的区间个数
    // 固定长度 8 的区间数组：WebGL1 不支持动态长度 uniform 数组，
    // 多选时超出 8 个节点会被截断（UI 侧已限制最多同时选中 8 段）。
    uSelRanges: { value: Array.from({ length: 8 }, () => new THREE.Vector2(0, -1)) },
    uSelColor: { value: new THREE.Color('#ffd166') },        // 选中色：琥珀黄，和树皮的暖色区分得开
    uSelGlow: { value: 0.35 },                               // 选中自发光强度
    uSelDim: { value: 0.35 },                                // "其余变暗"模式下的亮度系数
  }
}

/**
 * 每个材质独立的 uniform
 *
 * 与 shared 的区别：这些值**每个材质一份**（树皮/树叶/花朵各自不同），存在
 * `material.userData.uniforms` 里，材质创建后还能改（update*Material 就改这里）。
 * 叶/皮共用同一张表结构，用 `isLeaf` 决定哪些项对当前材质有意义
 * （例如 uTranslucency 对树皮恒为 0 —— 树皮不透光，留着项只是为了两个材质的
 * uniform 表结构一致，避免着色器里出现未声明 uniform）。
 *
 * @param {object} params 全局参数树（读 params.wind / params.bark / params.leafMat）
 * @param {boolean} isLeaf true = 叶片材质，false = 树皮材质
 * @returns {Object<string, {value: *}>} 该材质专属的 uniform 表
 */
export function perMaterialUniforms(params, isLeaf) {
  const w = params.wind
  const m = isLeaf ? params.leafMat : params.bark
  return {
    uIsLeaf: { value: isLeaf ? 1 : 0 },                      // 片元里据此走叶片专属分支
    // 树皮只保留很小一部分风力（barkSway），否则树干会像面条一样整体弯曲。
    uSway: { value: isLeaf ? 1.0 : (w.barkSway === undefined ? 1 : w.barkSway) },
    // 贴图扭曲默认关闭：树皮会破坏平铺接缝，叶片会让叶脉歪掉，只作为特效开关。
    uUvWarp: { value: isLeaf ? 0.0 : 0.0 },
    uUvWarpScale: { value: 8.0 },                            // 扭曲用的低频正弦空间频率
    // 顶点色混合系数：叶片走 resolveTintMix（受染色模式控制），树皮默认 1（全用顶点色）。
    uVertexColorMix: { value: isLeaf ? resolveTintMix(m, !!(params.leafMat && params.leafMat.texture)) : (m.vertexColorMix === undefined ? 1 : m.vertexColorMix) },
    uTint: { value: new THREE.Color(m.tint || '#ffffff') },  // 整体染色（乘在 diffuse 上）
    uTranslucency: { value: isLeaf ? (m.translucency || 0) : 0 },  // 透光强度，树皮恒 0
    // 反光：specular 为高光强度，shininess 为 Blinn-Phong 指数，specularColor 为高光染色。
    uSpecular: { value: isLeaf ? (m.specular === undefined ? 0 : m.specular) : 0 },
    uSpecularShininess: { value: (m.specularShininess === undefined ? 28 : m.specularShininess) },
    uSpecularColor: { value: new THREE.Color(m.specularColor || '#ffffff') },
    // 散光：scatter 为强度，scatterPower 为边缘幂次（越大光晕越窄）。
    uScatter: { value: isLeaf ? (m.scatter || 0) : 0 },
    uScatterPower: { value: (m.scatterPower === undefined ? 2 : m.scatterPower) },
    uLeafFlutter: { value: w.leafFlutter },                   // 叶片抖动幅度（0..1）
    uLeafTwist: { value: w.leafTwist },                       // 叶片俯仰扭转量（0..1）
    // 双面叶片：创建时先关掉，updateLeafMaterial 再按参数打开
    uBackEnabled: { value: 0 },
    uBackColor: { value: new THREE.Color(m.backColor || '#b9d49a') },  // 默认背面是偏浅的黄绿
    uHasBackMap: { value: 0 },                               // 0 = 复用正面贴图
    uBackMap: { value: whitePixelTexture() },                // 先绑白色占位，见 whitePixelTexture()
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

/**
 * 创建树皮材质（树干的唯一材质）。
 *
 * 与叶材质的关键差别：
 *   - `side = FrontSide`：树干是闭合实体，开双面只是白费一半填充率；
 *   - 没有透光/反光/散光（那些是薄片的光学现象）；
 *   - 贴图来源有两种（见 updateBarkMaterial）：用户上传的照片贴图，
 *     或 `textures.js` 的程序化树皮（含颜色/法线/粗糙度三张）；
 *   - 顶点色仍然启用：树干基部/背光面的明暗与色相变化靠几何侧烘的顶点色实现。
 *
 * 创建流程固定为"先建材质 → 挂注入 → 立即跑一次 update"：材质参数（贴图、
 * 缩放、UV）全在 update 里设置，create 只负责骨架，避免两处各写一半默认值。
 *
 * @param {object} params 全局参数树（本函数读 params.bark / params.custom）
 * @param {object} sharedUniforms `createSharedUniforms()` 的返回值
 * @returns {THREE.MeshStandardMaterial} 带 userData.kind='bark' 与 userData.uniforms
 */
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

/**
 * 花朵材质参数: 在树叶材质参数基础上, 用花朵自己的贴图/染色/裁切覆盖
 *
 * 做法是"造一份假的 params"：把 params.leafMat 整体替换成以树叶参数为底、
 * 再用 params.flower 覆盖的字段集合，然后**复用整个叶材质创建/更新流程**。
 * 好处是花朵自动获得叶片的那套着色器注入（透光/反光/散光/顶点色/双面）而不
 * 需要第二套代码；代价是每次更新都会新建一个临时对象（参数对象很小，可忽略）。
 *
 * 花朵与树叶刻意解耦的字段：贴图、tintMode、alphaTest、自发光、反光、散光、
 * UV 变换（textureU/V、repeat、rotation）。刻意**不复用**的：背面独立材质
 * （backEnabled 固定 false，花卡不做双面贴图）、程序化叶形（花朵只用贴图）。
 *
 * @param {object} params 全局参数树（读 params.flower，缺省为 {}）
 * @returns {object} 一个新的 params 对象（浅拷贝，不修改入参）
 */
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

/**
 * 花朵材质 (独立实例: 可以有和树叶不同的贴图/着色)
 *
 * 实现上直接复用 createLeafMaterial（喂 flowerLeafParams 生成的参数），
 * 只把 userData.kind 改成 'flower' —— 这个 kind 是**下游所有分支的判据**：
 *   - `exporter.js` / `textureNaming.js` 用它决定资源名前缀（`flower_diff` 等）
 *     以及是否参与四图成套对齐；
 *   - `applyAutoNormal` 的 flagKey 与 `ensureExportMaterialMaps` 的强度选择
 *     也会看它（花朵的自动法线强度默认更高，1.5，因为花瓣起伏更细）。
 * 所以**不要**把它改名成 'leaf'，否则导出的资源会与树叶混在一起。
 *
 * @param {object} params 全局参数树
 * @param {object} sharedUniforms 共享 uniform 表
 * @returns {THREE.MeshStandardMaterial} kind = 'flower' 的叶系材质
 */
export function createFlowerMaterial(params, sharedUniforms) {
  const mat = createLeafMaterial(flowerLeafParams(params), sharedUniforms)
  mat.userData.kind = 'flower'
  return mat
}

/**
 * 用最新参数刷新花朵材质（不重建材质实例，不触发着色器重编译）。
 *
 * 走的是 updateLeafMaterial + flowerLeafParams，所以与视口里树叶的更新路径完全一致；
 * 只有在 `rebindCustomShader()`（自定义 GLSL 改动）时才需要重新编译。
 *
 * @param {THREE.Material} mat 由 createFlowerMaterial 创建的材质
 * @param {object} params 全局参数树
 * @param {object} sharedUniforms 共享 uniform 表（当前实现未直接使用，保持与其它 update* 一致）
 * @returns {THREE.Material} 同一个材质对象（便于链式调用）
 */
export function updateFlowerMaterial(mat, params, sharedUniforms) {
  updateLeafMaterial(mat, flowerLeafParams(params), sharedUniforms)
  return mat
}

/**
 * 创建树叶材质（叶片/花卡共用同一套着色器注入）。
 *
 * 构造参数里三处刻意的选择：
 *   - `transparent: false` + `alphaTest`：叶片的透明区域必须是**硬裁切**
 *     （glTF 的 alphaMode=MASK 语义）。开 transparent 会让叶片进入混合队列，
 *     排序错乱时叶与叶之间会出现"透出后面叶子"的鬼影，而且 GLB 导出语义也不同；
 *   - `side` 由 `doubleSided` 决定：单面叶卡在掠射角会消失，但双面又贵一倍，
 *     所以交给用户选（背面独立材质打开时 updateLeafMaterial 会强制双面）；
 *   - `normalScale` 用 Vector2（three 允许 x/y 分别缩放），这里两向同值。
 *
 * @param {object} params 全局参数树（本函数读 params.leafMat / params.custom）
 * @param {object} sharedUniforms 共享 uniform 表
 * @returns {THREE.MeshStandardMaterial} 带 userData.kind='leaf' 与 userData.uniforms
 */
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

/** 纹理缓存键的失效标记（当前仅由 invalidateTextureCaches() 重置；
 *  真正的"这张图换了吗"判断在 material.userData.__texKey 上逐材质做）。
 *  保留这两个变量是为了给外部一个显式的"清缓存"入口，行为不动。 */
let barkTextureCacheKey = ''
let leafTextureCacheKey = ''

/**
 * 用最新参数刷新树皮材质（不重建材质实例）。
 *
 * 职责分三段：
 *   ① **标量 PBR 参数**：roughness / metalness / normalScale 直接写回 THREE 材质，
 *      `color` 恒设白 —— 树皮的颜色全部来自贴图或顶点色，材质基色只当乘法单位元；
 *   ② **材质专属 uniform**：风力比例、UV 扭曲、顶点色混合系数、整体染色；
 *   ③ **贴图换图（带缓存键）**：这是唯一会 `mat.needsUpdate = true` 的地方。
 *
 * 换图为什么用 key 而不是每次都赋：`mat.needsUpdate = true` 会让 three 重新
 * 编译程序（编译一次几十毫秒），滑杆每帧都变就会卡死。key 编码了"决定这张图的
 * 全部输入"，只有这些输入变了才真的重建。
 *
 * @param {THREE.Material} mat createBarkMaterial 创建的材质
 * @param {object} params 全局参数树
 * @param {object} sharedUniforms 共享 uniform 表（当前实现未直接使用，保留签名一致）
 * @returns {THREE.Material} 同一个材质对象
 */
export function updateBarkMaterial(mat, params, sharedUniforms) {
  const p = params.bark
  /* ---------------- ① 标量 PBR 参数 ---------------- */
  mat.roughness = p.roughness
  mat.metalness = p.metalness
  mat.color.set(0xffffff)                    // 基色恒白：颜色由贴图/顶点色决定
  mat.normalScale.set(p.normalScale, p.normalScale)
  /* ---------------- ② 材质专属 uniform ---------------- */
  const u = mat.userData.uniforms
  u.uSway.value = params.wind.barkSway === undefined ? 1 : params.wind.barkSway
  u.uUvWarp.value = p.uvWarp === undefined ? 0 : p.uvWarp
  u.uUvWarpScale.value = p.uvWarpScale === undefined ? 8 : p.uvWarpScale
  u.uVertexColorMix.value = p.vertexColorMix
  u.uTint.value.set(p.tint || '#ffffff')

  /* ---------------- ③ 贴图来源：照片贴图 或 程序化 ---------------- */
  if (p.texture) {
    // 键只取 URL 末尾 48 字符：完整 dataURL 可能几百 KB，当 Map 键会拖慢比较；
    // 文件名的尾部（含扩展名与可能的 hash）通常足以区分不同贴图。
    const key = 'user:' + p.texture.slice(-48) + ':' + (p.normalTexture || '').slice(-24)
    if (key !== mat.userData.__texKey) {
      mat.userData.__texKey = key
      // 先释放上一轮程序化生成的三张图，否则换图时显存只增不减。
      clearAutoBarkTextures(mat)
      // autoSeamless: 照片树皮多半不是无缝素材, 加载时自动检测并做边缘融合,
      // 否则平铺后树干上会出现一圈圈硬接缝 (低分辨率素材尤其明显)。
      mat.map = loadTexture(p.texture, { autoSeamless: true })
      // 法线贴图必须按线性数据 + normal 模式加载（srgb: false 且走法线专用解码），
      // 否则会被 sRGB 解码一次，光照方向整体偏掉。
      if (p.normalTexture) mat.normalMap = loadTexture(p.normalTexture, { srgb: false, normal: true, autoSeamless: true })
      else mat.normalMap = null
      // 照片树皮不提供粗糙度贴图时置空：让材质标量 roughness 生效，
      // 而不是留一张上一轮程序化图造成"图与滑杆打架"。
      mat.roughnessMap = null
      mat.needsUpdate = true
    }
  } else {
    const proc = p.procedural || {}
    // 程序化树皮的键包含**所有影响像素的生成参数**（风格/尺度/对比/凹凸/两种颜色），
    // 少写一个就会导致"改了色但图没重生成"。
    const key = `proc:${proc.style}:${proc.scale}:${proc.contrast}:${p.bump}:${p.color}:${p.color2}`
    if (key !== mat.userData.__texKey) {
      mat.userData.__texKey = key
      clearAutoBarkTextures(mat)
      const tex = makeBarkTextures({
        style: proc.style, scale: proc.scale, contrast: proc.contrast,
        color: p.color, color2: p.color2, bump: p.bump, seed: 12345,
      })
      if (tex) {
        // 三张图都记在 userData.auto* 上：它们由本函数拥有，换参时必须由
        // clearAutoBarkTextures 统一 dispose，不能交给材质生命周期管理。
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
    // 注意 flagKey 用 'autoBarkNormal' 而不是默认的 'autoNormal'：
    // 默认键已被程序化法线占用，混用会让摘除逻辑误删程序化法线。
    applyAutoNormal(mat, p, 'autoBarkNormal')
  } else if (mat.userData.autoBarkNormal) {
    // 显式关闭: 清掉自动生成的法线 (不然滑杆归零后仍然生效)
    if (mat.normalMap) disposeTexture(mat.normalMap)
    mat.normalMap = null
    mat.userData.autoBarkNormal = false
    mat.needsUpdate = true
  }
  // 三张图的平铺必须一致，否则颜色/法线/粗糙度的图案会互相错位（"裂纹不对缝"）。
  setTextureRepeat(mat.map, p.uvScaleU, p.uvScaleV)
  setTextureRepeat(mat.normalMap, p.uvScaleU, p.uvScaleV)
  setTextureRepeat(mat.roughnessMap, p.uvScaleU, p.uvScaleV)
  return mat
}

/**
 * 释放"由材质自己生成/拥有"的树皮贴图（程序化三张 + 自动法线），并清空槽位。
 *
 * 为什么需要单独一个函数：这些纹理不是从贴图库加载的共享资源（`loadTexture`
 * 有缓存，重复 load 不会新建），而是每次换参数时新生成的，必须由这里显式
 * dispose，否则调滑杆会持续泄漏 GPU 纹理。
 * "只清自己的"：只有当前槽位指向自己的图时才置空，不会误伤用户上传的贴图。
 *
 * @param {THREE.Material} mat 树皮材质
 */
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

/**
 * 用最新参数刷新树叶（或花卡）材质。
 *
 * 这是整个材质系统里最长的一条更新路径，因为它要同时处理 6 件互相依赖的事，
 * **顺序不能随意调整**（下面用分节标注了原因）：
 *   ① 标量 PBR + 双面开关（backEnabled 隐含需要 DoubleSide）；
 *   ② 自发光：颜色与强度分开写，颜色不再隐式取季节叶色；
 *   ③ 共享 uniform（顶点色混合、透光、反光、散光、风场抖动量）；
 *   ④ 双面叶片的背面贴图（独立于正面，带自己的缓存键与 dispose）；
 *   ⑤ 正面贴图（用户贴图 / 程序化叶形，带缓存键）；
 *   ⑥ UV 变换 + 法线贴图 —— **必须在 ⑤ 之后**，因为自动法线要把 mat.map 当输入。
 *
 * alpha 的两个坑：
 *   - `alphaTest` 必须显式写：花卡贴图的透明区是黑色，alphaTest=0 会把黑底画出来；
 *   - 贴图加载失败时（`userData.loadFailed`）要主动清掉 map 并把 alphaTest 归零，
 *     否则"空采样 + alphaTest>0"会把整片叶子裁成不可见。
 *
 * @param {THREE.Material} mat createLeafMaterial / createFlowerMaterial 创建的材质
 * @param {object} params 全局参数树
 * @param {object} sharedUniforms 共享 uniform 表（当前实现未直接使用，保留签名一致）
 * @returns {THREE.Material} 同一个材质对象
 */
export function updateLeafMaterial(mat, params, sharedUniforms) {
  const p = params.leafMat
  /* ---------------- ① 标量 PBR 参数与双面开关 ---------------- */
  mat.roughness = p.roughness
  mat.metalness = p.metalness
  // 花朵现在只有平面花卡: 两种材质都必须按贴图 alpha 裁形
  // (alphaTest = 0 会把贴图透明区绘制成黑边)
  mat.alphaTest = p.alphaTest || 0
  // 开启背面独立材质时自动启用双面渲染, 否则永远看不到背面
  mat.side = (p.doubleSided || p.backEnabled) ? THREE.DoubleSide : THREE.FrontSide
  mat.color.set(0xffffff)                 // 同树皮：基色恒白，颜色来自贴图/顶点色
  /* ---------------- ② 自发光（颜色 × 强度，写入标准 glTF 字段） ---------------- */
  // 叶片自发光: 用叶色做底, 强度由滑杆控制 (让背光/阴影里的叶子不至于死黑)
  // 自发光用独立颜色: 不再隐式拿季节叶色当底色 (否则选了贴图也会被染色)
  mat.emissive.set(p.emissiveColor || '#ffffff')
  mat.emissiveIntensity = p.emissive || 0
  /* ---------------- ③ 材质专属 uniform ---------------- */
  const u = mat.userData.uniforms
  // 顶点色混合：有贴图"或"程序化卡片模式时按染色模式算，否则回落到全顶点色。
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
  /* ---------------- ④ 双面叶片：背面开关 / 颜色 / 独立贴图 ---------------- */
  u.uBackEnabled.value = p.backEnabled ? 1 : 0
  u.uBackColor.value.set(p.backColor || '#b9d49a')
  const backKey = p.backTexture || ''
  if (backKey !== mat.userData.__backTexKey) {
    mat.userData.__backTexKey = backKey
    // 先释放旧背面图；它由本函数拥有（不走共享缓存），不 dispose 会随换图累积。
    if (mat.userData.backMap) {
      disposeTexture(mat.userData.backMap)
      mat.userData.backMap = null
    }
    if (backKey) {
      // clamp: 叶卡 UV 超出 0..1 时不应平铺出重复图案；repairAlpha: 花卡内部的
      // 封闭透明洞需要修补（否则洞里会透出背景）。
      const tex = loadTexture(backKey, { clamp: true, repairAlpha: p.alphaRepair === true })
      mat.userData.backMap = tex
      u.uBackMap.value = tex
      u.uHasBackMap.value = 1
    } else {
      // 没有背面图时绑白图（乘法单位元）并置 uHasBackMap=0，片元里会复用正面图。
      u.uBackMap.value = whitePixelTexture()
      u.uHasBackMap.value = 0
    }
  }

  /* ---------------- ⑤ 正面贴图：用户贴图 或 程序化叶形 ---------------- */
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
    // 释放顺序：旧的用户图（old）与旧的程序化图（hadAuto）可能不是同一张，
    // 两个判断都要做，且都要排除"恰好就是当前这张"的情况，否则会把新图释放掉。
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
    // textureRepeatU/V 缺省回落到统一的 textureRepeat（旧参数只有单值这一项）。
    const rru = p.textureRepeatU === undefined ? rr : p.textureRepeatU
    const rrv = p.textureRepeatV === undefined ? rr : p.textureRepeatV
    const rot = p.textureRotation || 0
    // 先比较再写：offset/repeat 赋值本身不贵，但 needsUpdate=true 会触发
    // 纹理重新上传；无条件设 true 会让每帧滑杆更新都重传一次贴图。
    const changed = mat.map.offset.x !== ru || mat.map.offset.y !== rv ||
      mat.map.repeat.x !== rru || mat.map.repeat.y !== rrv || mat.map.rotation !== rot
    // center 固定在 (0.5,0.5)：旋转绕贴图中心，符合"在叶片上转纹理"的直觉。
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
      bt.needsUpdate = true        // 背面图每次换 UV 都重传：它不在上面 changed 的判断里
    }
  }

  /* ---------------- ⑥ 法线贴图：显式贴图优先，否则从 albedo 自动生成 ---------------- */
  // 注意: 必须放在 mat.map 赋值之后, 否则第一次更新时 map 还是 null, 生成不出法线
  if (p.normalTexture) {
    // 只有"当前没有法线"或"当前法线是自动生成的"才加载用户法线；
    // 后者需要先 dispose 自动法线，避免两张图同时存在（显存 + 语义混乱）。
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

/**
 * 风场参数 -> 共享 uniform
 *
 * UI 上的风向是**度**（0° = +X，逆时针为正，俯视 XZ 平面），这里转成弧度并
 * 取 (cos, sin) 作为 XZ 平面单位向量 —— 于是"风向角"就是向量与 +X 轴的夹角。
 *
 * 两处下限钳制的原因：
 *   - `uWindFrequency` 最小 0.05：顶点着色器里 `tw * 2.17 * freq` 会乘时间，
 *     freq=0 时次波完全消失，整棵树的摆动会退化成单一正弦，看起来像机械摆动；
 *   - `uGustSpeed` 最小 0.01：它是乘在时间上的，0 会让阵风项恒定，等于关掉阵风
 *     却仍留一段无意义计算（也会让"阵风"滑杆看起来失灵）。
 *
 * @param {object} uniforms `createSharedUniforms()` 返回的共享 uniform 表
 * @param {object} wind params.wind 风场参数（direction 为度，其余为 0..1 增益或倍率）
 */
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

/**
 * 生长动画 -> 共享 uniform
 *
 * `value` 是 0..1 的归一化进度；`uGrowthEnabled` 只在"开关打开且尚未长完"时为 1 ——
 * 长到 0.999 以上后顶点着色器里的 `mix(1.0, growK, uGrowthEnabled)` 恒等于最终位置，
 * 关闭开关可以让 three 不必再为这段分支做无意义的顶点插值（也便于导出静态姿态）。
 *
 * @param {object} uniforms 共享 uniform 表
 * @param {object} growth params.growth（读 enabled）
 * @param {number} value 生长进度 0..1（0 = 只有 aOrigin 点，1 = 完全展开）
 */
export function updateGrowthUniforms(uniforms, growth, value) {
  uniforms.uGrowth.value = value
  uniforms.uGrowthEnabled.value = (growth && growth.enabled && value < 0.999) ? 1 : 0
}

/**
 * 材质参数整体刷新 (不动几何)
 *
 * 参数变化时的高频入口：只改材质（贴图/uniform/PBR 标量），**不重建几何体**，
 * 所以调色滑杆不会触发树木重生成。几何相关的参数（枝干形态、叶量）走 treeBuilder。
 * 返回同一个 mats 对象，便于调用方链式使用。
 *
 * @param {{bark: THREE.Material, leaf: THREE.Material, flower?: THREE.Material, uniforms: object}} mats
 *        场景持有的材质集合（flower 可能不存在 —— 没有花朵时不会创建）
 * @param {object} params 全局参数树
 * @returns {object} 同一个 mats 对象
 */
export function updateMaterials(mats, params) {
  updateBarkMaterial(mats.bark, params, mats.uniforms)
  updateLeafMaterial(mats.leaf, params, mats.uniforms)
  if (mats.flower) updateFlowerMaterial(mats.flower, params, mats.uniforms)
  updateWindUniforms(mats.uniforms, params.wind)
  // seed 参与风相位偏移（着色器里 `uSeed * 0.017`），以及"每棵树的摆动不同步"。
  // 取模 1000 只是把大整数种子压成小值：相位是 0..2π 的循环量，过大没有意义，
  // 而浮点 uniform 用小数比用百万级整数更稳定。
  mats.uniforms.uSeed.value = params.seed % 1000
  return mats
}

/**
 * 自定义 GLSL 改动后重新绑定 (触发重编译)
 *
 * 自定义着色器代码是**编译期**插进程序的（不是 uniform），所以改了源码就必须
 * 让 three 重新编译：重新执行 applyTreeShader 换掉 onBeforeCompile 与
 * customProgramCacheKey，再置 needsUpdate。
 *
 * 注意 `isLeaf` 只看 userData.kind === 'leaf'：
 *   - 花材质（kind='flower'）会走 **bark 分支**（无透光、不替换 map_fragment），
 *     这是既有行为；花朵需要透光时应改用 createFlowerMaterial 重建，
 *     而不是靠这个函数"升级"。—— 改动这里的判定会连带改变花的观感，需谨慎。
 *   - translucency 与 isLeaf 同值：树皮不透光，透光片段只对薄片有意义。
 *
 * @param {THREE.Material} mat 目标材质
 * @param {object} params 全局参数树（读 params.custom）
 * @param {object} sharedUniforms 共享 uniform 表
 * @returns {THREE.Material} 同一个材质对象
 */
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

/**
 * 清空纹理缓存键，强制下一次 update*Material 重新生成/加载贴图。
 *
 * 使用场景：外部替换了贴图文件内容（URL 不变）、或需要释放全部生成纹理后重建。
 * 只重置模块级的两个标记；逐材质的 `userData.__texKey` 不清 ——
 * 真正的重载由调用方接着触发一次 updateMaterials 完成。
 */
export function invalidateTextureCaches() {
  barkTextureCacheKey = ''
  leafTextureCacheKey = ''
}
