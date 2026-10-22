/**
 * 落叶效果 (falling leaves)
 * ------------------------------------------------------------
 * 和粒子同一思路, 但"粒子"是真实叶片卡片:
 *   - 每个落叶 = 一张卡片 (默认 6 面), 全部合批成**一个 draw call**
 *   - 位置/下落/翻滚/受风全在顶点着色器里算 -> CPU 零开销 (只更新一次 uTime)
 *   - 风场与树木**共用同一份 uniform** (风向/强度/阵风一致, 风一吹落叶就顺风飘)
 *   - 叶片贴图沿用当前选中的叶片卡片 (alphaTest 裁出叶形)
 *
 * 作用: 构建并驱动「天空中飘落的叶片」这一层效果。
 * 输入 / 输出:
 *   - buildFallingLeaves(canopyGeometry, params, sharedUniforms, map, bbox) -> THREE.Mesh
 *   - updateFallingLeaves(mesh, params) -> void (只改 uniform, 不重建几何/材质)
 *   - fallRebuildKey(params) -> string (判据: 变了才需要重建)
 * 与其他模块的关系:
 *   出生点来自 particles.js 的 sampleEmitPositions (与粒子共用同一套树冠采样);
 *   贴图/宽高比来自 leafTexture.js; 光照继承来自 leafEffects.js;
 *   风场 uniform 与 sceneManager 的树木材质是同一批对象 (改一处全场景同步);
 *   下游由 sceneManager 加入场景并每帧只推进 uTime。
 * 关键概念 / 约定:
 *   - **position 存的是"出生点"** (每片叶子的 4 个顶点写同一个出生点), 卡片的实际形状
 *     由 uv 在着色器里推导 (local = (uv-0.5)*2*half)。这样做的好处是每片叶子只需
 *     1 个位置就能携带完整的运动状态, 顶点数据量减半。
 *   - aLeafSeed (vec4) = phase, speedScale, sizeScale, spinDir —— 每片叶子的随机参数。
 *   - 坐标单位是米; 下落高度取树冠包围盒高度, 保证 t=1 时正好落地。
 * 注意: 本文件含 GLSL 模板字符串, 其中的 `//` 是着色器注释, 改动等于改代码。
 */
import * as THREE from 'three'
import { makeRng } from './rng.js'
import { sampleEmitPositions } from './particles.js'
import { resolveEffectTexture, resolveEffectAspect } from './leafTexture.js'
import { resolveLeafEffects } from './leafEffects.js'

/* ---------------- 顶点着色器: 生命循环 / 翻滚 / 下落 / 风场 ---------------- */
// 说明: 卡片是在**顶点着色器里被旋转的**, 所以顶点数据只有出生点 + uv,
// 位置更新完全不需要 CPU 参与 (每帧只写一个 uTime)。
//
// 每帧的计算顺序 (阅读时按这个顺序看 main()):
//   ① t = fract(...)                生命进度 0..1, 由 uTime/速度/每叶 speedScale/phase 决定
//   ② local = R * (uv 展开的方形)    在局部空间做自旋(spin) + 翻滚(tumble) + 侧倾
//   ③ p = 出生点 - 下落              t=1 时正好落到 y≈0 (uFallHeight 取树冠高度)
//   ④ 风场 + 打旋                    与树木共用 uniform, 所以风向一变落叶立刻同向飘
//   ⑤ world = p + local             卡片中心跟着出生点走, 局部旋转只改变朝向
const FALL_VERT = /* glsl */`
uniform float uTime;
uniform float uFallSpeed;
uniform float uFallHeight;
uniform float uSizeScale;
uniform float uSwirl;
uniform float uSpinSpeed;
uniform float uStagger;
uniform vec2 uHalf;   // 卡片半宽/半高 (由叶片宽高比决定)
// --- 风场 (与树木/粒子共用同一份 uniform 对象) ---
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uGust;
uniform float uGustSpeed;
uniform float uWindBias;
uniform float uWindEnabled;
uniform float uWindFollow;
attribute vec4 aLeafSeed;   // phase, speedScale, sizeScale, spinDir
varying vec2 vUv;
varying float vShade;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }

void main() {
  float phase = aLeafSeed.x;
  float speedScale = aLeafSeed.y;
  float sizeScale = aLeafSeed.z;
  float spinDir = aLeafSeed.w;

  // 生命循环 0..1 (每片叶子错开)
  float t = fract(uTime * uFallSpeed * speedScale * 0.35 + phase);

  // 卡片局部顶点 (xy 平面, 中心在原点) -> 先在局部空间转起来 (翻滚 + 自旋)
  // position 存的是出生点; 卡片局部形状由 uv 推导 (uv 铺满贴图)
  vec3 local = vec3((uv - 0.5) * 2.0 * uHalf, 0.0) * uSizeScale * sizeScale;
  float spin = uTime * uSpinSpeed * spinDir * (0.6 + 0.8 * speedScale) + phase * 6.28318;
  float tumble = t * 6.28318 * (0.8 + phase);
  mat3 R = rotY(spin) * rotX(tumble) * rotZ(phase * 6.28318 + spin * 0.4);
  local = R * local;

  // 下落: 从树冠高度落到地面 (t=1 时落地)
  vec3 p = position;                       // position 存的是"出生点"
  p.y -= t * uFallHeight;
  // 落地后淡出 (后 15% 生命)
  float fade = 1.0 - smoothstep(0.85, 1.0, t);

  // 风场: 与树同源 (只推不拉 + bias 抬低谷), 越到后期被吹得越远
  vec2 windDir = normalize(uWindDir + vec2(1e-5, 1e-6));
  float gust = 1.0 - uGust * 0.6 * (1.0 - (sin(uTime * uGustSpeed + phase * 6.28318) * 0.5 + 0.5));
  float along = uWindStrength * uWindFollow * (0.55 * gust + uWindBias * 0.45) * uWindEnabled;
  p.x += windDir.x * along * (3.0 + 14.0 * t);
  p.z += windDir.y * along * (3.0 + 14.0 * t);
  // 打旋/摆动 (无风时也有一点飘)
  float ang = (t * 6.28318 + phase * 12.0) * (0.5 + uSwirl);
  p.x += sin(ang) * uSwirl * (0.25 + 0.75 * t) * uStagger;
  p.z += cos(ang * 0.85) * uSwirl * (0.25 + 0.75 * t) * uStagger;
  p.y += sin(uTime * (1.0 + uWindSpeed) + phase * 7.0) * along * 0.8;

  // 卡片最终位置 = 出生点 + 局部旋转后的顶点
  vec3 world = p + local;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;

  vUv = uv;
  // 法线/世界位置给碎片着色器继承树叶自发光/反光/散光
  vWorldNormal = normalize(mat3(modelMatrix) * (R * vec3(0.0, 0.0, 1.0)));
  vWorldPos = world;
  // 正面朝上时亮一点, 背面暗一点 (翻飞时的明暗变化)
  vShade = 0.55 + 0.45 * max(0.0, R[1][1]) ;
  vShade *= fade;
}
`

/* ---------------- 片元着色器: 贴图采样 / 无贴图椭圆兜底 / 光效继承 ---------------- */
// uHasMap < 0.5 的分支是"没有贴图"时的兜底: 用椭圆隐式方程裁出叶形,
// 这样即使贴图 404 也不会出现一堆方块在空中飞。
// 本片元着色器也导出 (export), 方便别处 (如导出预览/自检页面) 复用同一套观感。
export const FALL_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uAlphaTest;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uInherit;
uniform float uEmissive;
uniform vec3 uEmissiveColor;
uniform float uSpecular;
uniform float uSpecularShininess;
uniform vec3 uSpecularColor;
uniform float uScatter;
uniform float uScatterPower;
varying vec2 vUv;
varying float vShade;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec4 tex = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
  // 没有贴图时用一个椭圆当叶形 (兜底, 不至于变成方块)
  if (uHasMap < 0.5) {
    vec2 d = vUv - vec2(0.5);
    if (length(vec2(d.x * 1.6, d.y)) > 0.5) discard;
  }
  if (uHasMap > 0.5 && tex.a < uAlphaTest) discard;
  // 贴图是 sRGB 纹理, 采样后已是线性值; 输出必须和主树叶材质走同一套变换,
  // 否则同一张贴图在"树上"和"落叶上"颜色会不一致。
  vec3 col = (uHasMap > 0.5 ? tex.rgb : uColor) * vShade;
  // 落叶继承树叶材质: 自发光 / 反光 / 散光
  if (uInherit > 0.5) {
    vec3 N = normalize(vWorldNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);
    col += uEmissiveColor * uEmissive;
    if (uSpecular > 0.001) {
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), max(1.0, uSpecularShininess));
      float fres = 0.35 + 0.65 * pow(1.0 - max(dot(N, V), 0.0), 3.0);
      col += uSpecularColor * (uSpecular * 3.0 * spec * fres) * uSunColor;
    }
    if (uScatter > 0.001) {
      float rim = pow(1.0 - abs(dot(N, V)), max(1.0, uScatterPower));
      float lit = 0.35 + 0.65 * max(dot(N, L), 0.0);
      col += tex.rgb * (uScatter * rim * lit) * uSunColor;
    }
  }
  float alpha = (uHasMap > 0.5 ? 1.0 : uOpacity) * vShade;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** 落叶需要重建的判据: 任一变化都要重新生成几何/材质 */
// 说明: 数量/尺寸/宽高比/贴图选择变了就必须重建几何;
// 浮点先定点取整再拼串, 避免浮点抖动导致每帧重建。
// 反过来说: 速度/旋转/风力这些只影响 uniform 的参数**故意不在这里** —— 它们走
// updateFallingLeaves 原地更新, 不需要重建 (重建一次要重采样出生点, 会看到"整片叶子瞬移")。
export function fallRebuildKey(params) {
  const F = params.fall || {}
  return [
    F.cardId || '',
    Math.round(F.count === undefined ? 80 : F.count),
    // 跟随树叶时, 树叶贴图变了也必须重建 (否则跟随的落叶不会换贴图)
    params.leafMat && params.leafMat.texture ? params.leafMat.texture : '',
    params.leaves && params.leaves.cardAspect,
  ].join('|')
}

/**
 * 构建落叶网格
 * @param {THREE.BufferGeometry} canopyGeometry 叶片几何 (用于采样出生点)
 * @param {object} params 全量参数
 * @param {object} sharedUniforms 共享 uniform (风场/时间)
 * @param {THREE.Texture|null} map 叶片贴图
 * @param {{min:{x,y,z},max:{x,y,z}}} bbox 树冠包围盒
 */
// 注: 上面这段 JSDoc 描述的是 buildFallingLeaves (本文件末尾的导出函数),
// 历史上被放在了这里; 为不改动既有注释与代码顺序, 保留原位, 此处仅作指认说明。

/**
 * 把「继承树叶光照」的 8 个 uniform 打包成容器 (新建材质时使用)。
 *
 * 为什么落叶也需要这一组: 落叶用的是自己写的 ShaderMaterial, 不会自动获得树冠材质
 * 的自发光/高光/边缘散射; 如果不同步, 同一棵树上"还在树上的叶子"和"飘落的叶子"
 * 观感会明显割裂 (尤其开了自发光的花树)。同步口径统一由 leafEffects.js 提供。
 *
 * @param {object} params 全量参数 (effectSource / effectInherit 决定继承源与是否继承)
 * @returns {Object<string, {value: any}>} uInherit/uEmissive/uEmissiveColor/
 *          uSpecular/uSpecularShininess/uSpecularColor/uScatter/uScatterPower
 */
function effectUniforms(params) {
  // effectSource: 'leaf' | 'flower' —— 落叶可以继承树叶, 也可以继承花朵(花瓣飘落时)
  const e = resolveLeafEffects(params, params.effectSource || 'leaf', params.effectInherit !== false)
  return {
    uInherit: { value: e.inherit },
    uEmissive: { value: e.emissive },
    uEmissiveColor: { value: new THREE.Color(e.emissiveColor) },
    uSpecular: { value: e.specular },
    uSpecularShininess: { value: e.specularShininess },
    uSpecularColor: { value: new THREE.Color(e.specularColor) },
    uScatter: { value: e.scatter },
    uScatterPower: { value: e.scatterPower },
  }
}

/**
 * 就地刷新已存在材质上的「继承光照」uniform (不重建材质)。
 *
 * @param {object} u 材质的 uniforms 对象
 * @param {object} params 全量参数
 */
function writeEffectUniforms(u, params) {
  const e = resolveLeafEffects(params, params.effectSource || 'leaf', params.effectInherit !== false)
  // 逐个 if 判断: 兼容缺少某个 uniform 的旧材质
  if (u.uInherit) u.uInherit.value = e.inherit
  if (u.uEmissive) u.uEmissive.value = e.emissive
  if (u.uEmissiveColor) u.uEmissiveColor.value.set(e.emissiveColor)
  if (u.uSpecular) u.uSpecular.value = e.specular
  if (u.uSpecularShininess) u.uSpecularShininess.value = e.specularShininess
  if (u.uSpecularColor) u.uSpecularColor.value.set(e.specularColor)
  if (u.uScatter) u.uScatter.value = e.scatter
  if (u.uScatterPower) u.uScatterPower.value = e.scatterPower
}

/**
 * 构建飘落的落叶层 (一个 Mesh 承载 count 片叶子, 1 个 draw call)。
 *
 * 几何组织方式:
 *   - 每片叶子 4 个顶点 / 2 个三角;
 *   - position 写「出生点」(4 个顶点相同), 卡片形状由 uv + uHalf 在着色器里推导;
 *   - aLeafSeed 每片叶子一个 vec4 随机参数, 4 个顶点相同。
 * 这样顶点缓冲只有 3+2+4=9 个 float/顶点, 而且完全静态 (不会逐帧回写)。
 *
 * @param {THREE.BufferGeometry} canopyGeometry 叶片几何, 用于采样出生点
 * @param {object} params 全量参数 (读 params.fall / params.seed / params.effect*)
 * @param {object} sharedUniforms 共享 uniform 池 (uTime + 风场 + 太阳)
 * @param {THREE.Texture|null} map 树冠贴图, 用于 cardId 为空时"跟随"
 * @param {{min:{x,y,z},max:{x,y,z}}|null} bbox 树冠包围盒, 决定下落总高度
 * @returns {THREE.Mesh} 落叶网格 (ShaderMaterial, 半透明、双面、不写深度)
 */
export function buildFallingLeaves(canopyGeometry, params, sharedUniforms, map, bbox) {
  const F = params.fall || {}
  const count = Math.max(1, Math.round(F.count === undefined ? 80 : F.count))
  // seed 决定出生点分布与每片叶子的随机相; 同一 seed 的落叶层完全可复现
  const seed = params.seed || 1
  // 出生点: 从树冠里采样 (和粒子同一套采样)
  // 复用 particles.js 的采样器: 把 fall 参数伪装成 { particles: {...} } 的形状传进去
  const spawn = sampleEmitPositions(canopyGeometry, { particles: { count, spread: F.spread === undefined ? 1 : F.spread } }, seed)
  const F0 = params.fall || {}
  const aspect = resolveEffectAspect(F0.cardId, params.leaves && params.leaves.cardAspect)
  // 半宽夹在 0.35..1.6: 防止极端宽高比把落叶拉成纸片或巨幕
  const halfW = 0.5 * Math.min(1.6, Math.max(0.35, aspect))
  // 半高固定 0.5: 落叶的"长"恒为 1 (再乘 uSizeScale), 只有宽度随贴图宽高比变化
  const halfH = 0.5

  // 4 个顶点 / 2 个三角 / 每片叶; 顶点属性: position(出生点), uv, aLeafSeed
  // 内存占用: 每片叶 4*(3+2+4)=36 个 float ≈ 144 字节, 80 片叶子不到 12KB —— 全部常驻显存,
  // 运行时不再回写, 所以落叶层对 CPU 的开销严格为 0。
  const vertsPerLeaf = 4
  const pos = new Float32Array(count * vertsPerLeaf * 3)
  const uvs = new Float32Array(count * vertsPerLeaf * 2)
  const seeds = new Float32Array(count * vertsPerLeaf * 4)
  const idx = new Uint32Array(count * 6)
  // 独立随机子流: 只受 seed 与阶段标签影响 -> 改落叶数量不会挪动树干
  const rng = makeRng(seed, 'falling-leaves')
  // 四角局部坐标由着色器从 uv 推导, 这里的 corners 仅用于说明/保持与 uv 的对应关系
  const corners = [
    [-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH],
  ]
  const cornerUv = [[0, 0], [1, 0], [1, 1], [0, 1]]
  for (let i = 0; i < count; i++) {
    // 随机数取值顺序固定为 phase -> speedScale -> sizeScale -> spinDir。
    // 改动顺序会让同一 seed 下整批落叶的运动全变, 所以新参数只能追加在末尾。
    // 出生点: spawn 与粒子共用同一套采样结果格式 (x,y,z 连续存放)
    const sx = spawn[i * 3], sy = spawn[i * 3 + 1], sz = spawn[i * 3 + 2]
    // phase 0..1: 生命循环偏移 -> 叶子们不同时落地
    const phase = rng.next()
    // speedScale 0.65..1.35: 下落快慢差异
    const speedScale = 0.65 + rng.next() * 0.7
    // sizeScale 0.7..1.3: 大小差异 (避免看起来是复制品)
    const sizeScale = 0.7 + rng.next() * 0.6
    // spinDir ±1: 自旋方向 (顺时针/逆时针各半)
    const spinDir = rng.next() < 0.5 ? -1 : 1
    for (let v = 0; v < vertsPerLeaf; v++) {
      const k = i * vertsPerLeaf + v
      // 注意: 局部顶点存在 (x,y,0), 但着色器里用 position 当"出生点",
      // 所以我们把出生点放进 position, 局部偏移用 uv*2-1 推导 -> 见着色器 local 计算
      pos[k * 3] = sx
      pos[k * 3 + 1] = sy
      pos[k * 3 + 2] = sz
      uvs[k * 2] = cornerUv[v][0]
      uvs[k * 2 + 1] = cornerUv[v][1]
      seeds[k * 4] = phase
      seeds[k * 4 + 1] = speedScale
      seeds[k * 4 + 2] = sizeScale
      seeds[k * 4 + 3] = spinDir
    }
    // 两个三角形: (0,1,2) 与 (0,2,3), 与 cornerUv 的下标顺序一致
    const b = i * vertsPerLeaf
    const o = i * 6
    idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2
    idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3
  }

  /* ---------------- 组装几何 ---------------- */
  const geo = new THREE.BufferGeometry()
  // 三个属性一次性灌入, 之后永不更新 (没有 setUsage(DynamicDrawUsage) 的需求)
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('aLeafSeed', new THREE.BufferAttribute(seeds, 4))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  // 用 uv 推导局部顶点 -> 把 "position = 出生点" 和 "局部形状" 分开
  // userData 里的半宽半高只是"记录", 真正生效的是材质 uniform uHalf
  geo.userData.halfW = halfW
  geo.userData.halfH = halfH

  /* ---------------- 材质 ---------------- */
  // 贴图解析走 leafTexture 的三级降级 (自己的卡 -> 跟随树冠 -> 程序化椭圆),
  // 所以 uMap 永远非空; uHasMap 恒为 1, 见下方注释。
  const resolved = resolveEffectTexture({ cardId: F0.cardId, followMap: map })
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      // uTime 与风场直接引用共享对象 -> 全场景同步, 无需刷新
      uTime: sharedUniforms.uTime,
      uFallSpeed: { value: F.speed === undefined ? 1 : F.speed },
      // 下落总高度 = 树冠最高点 (至少 2 米): t=1 时落在 y≈0, 正好是地面
      uFallHeight: { value: Math.max(2, bbox ? bbox.max.y : 10) },
      uSizeScale: { value: F.size === undefined ? 0.35 : F.size },
      uSwirl: { value: F.swirl === undefined ? 1 : F.swirl },
      uSpinSpeed: { value: F.spinSpeed === undefined ? 1.2 : F.spinSpeed },
      uStagger: { value: F.stagger === undefined ? 0.6 : F.stagger },
      uWindDir: sharedUniforms.uWindDir,
      uWindStrength: sharedUniforms.uWindStrength,
      uWindSpeed: sharedUniforms.uWindSpeed,
      uGust: sharedUniforms.uGust,
      uGustSpeed: sharedUniforms.uGustSpeed,
      uWindBias: sharedUniforms.uWindBias,
      uWindEnabled: sharedUniforms.uWindEnabled,
      uWindFollow: { value: F.windFollow === undefined ? 1 : F.windFollow },
      uMap: { value: resolved.map },
      // uHasMap 恒为 1: resolveEffectTexture 保证总会返回一张图 (最差是程序化椭圆),
      // 所以片元着色器里那条"无贴图"分支实际只在极端情况下才会走到。
      uHasMap: { value: 1 },
      uColor: { value: new THREE.Color(F.color || '#d9a441') },
      uOpacity: { value: F.opacity === undefined ? 1 : F.opacity },
      uAlphaTest: { value: F.alphaTest === undefined ? 0.35 : F.alphaTest },
      // 卡片半宽/半高: 着色器用它把 uv 展开成局部顶点
      uHalf: { value: new THREE.Vector2(halfW, halfH) },
      uSunDir: sharedUniforms.uSunDir,
      uSunColor: sharedUniforms.uSunColor,
      ...effectUniforms(params),
    },
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    // 半透明: 落地淡出需要 alpha; depthWrite=false 避免半透明叶片互相遮挡出硬边
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  // 顶点在着色器里大幅位移, CPU 侧包围球完全不准 -> 关掉视锥剔除, 否则转头就整批消失
  // 代价是这层永远参与绘制, 但它只有一个 draw call (几百个三角形), 完全可以接受
  mesh.frustumCulled = false
  mesh.visible = !!F.enabled
  return mesh
}

/** 只改参数, 不重建几何 (数量变化时才重建) */
// 注意: 这里**不更新** uHalf / uMap —— 宽高比与贴图是几何/纹理层面的属性,
// 改了它们必须走 fallRebuildKey 触发重建, 光改 uniform 会让卡片形状与贴图对不上。
// 另外 uFallHeight 也不在这里更新: 它由树高决定, 树高变化本身就意味着整树重建。
export function updateFallingLeaves(mesh, params) {
  if (!mesh) return
  const F = params.fall || {}
  const u = mesh.material.uniforms
  mesh.visible = !!F.enabled
  // 逐项写 uniform.value: 材质已在 GPU 上, 改数值不触发重编译, 几乎零成本
  u.uFallSpeed.value = F.speed === undefined ? 1 : F.speed
  u.uSizeScale.value = F.size === undefined ? 0.35 : F.size
  u.uSwirl.value = F.swirl === undefined ? 1 : F.swirl
  u.uSpinSpeed.value = F.spinSpeed === undefined ? 1.2 : F.spinSpeed
  u.uStagger.value = F.stagger === undefined ? 0.6 : F.stagger
  u.uWindFollow.value = F.windFollow === undefined ? 1 : F.windFollow
  u.uColor.value.set(F.color || '#d9a441')
  u.uOpacity.value = F.opacity === undefined ? 1 : F.opacity
  u.uAlphaTest.value = F.alphaTest === undefined ? 0.35 : F.alphaTest
  // 继承光照那 8 个 uniform 单独封装, 与 litter.js 保持一致的更新语义
  writeEffectUniforms(u, params)
}
