/**
 * 叶片粒子发射 (花粉 / 光点 / 孢子)
 * ------------------------------------------------------------
 * 思路: 在叶片顶点位置采样"发射点", 用 Points + 顶点着色器做循环运动
 *      (下落 + 横向飘动 + 打旋 + 闪烁), CPU 零开销 —— 只有一次 uTime 更新。
 * 之所以从叶片采样: 粒子看起来是从树冠里冒出来的, 而不是凭空出现。
 *
 * 作用: 提供粒子系统的三件套 —— 发射点采样、每粒子随机种子、ShaderMaterial。
 * 输入 / 输出:
 *   - sampleEmitPositions(leafGeometry, params, seed) -> Float32Array(count*3) 出生点 (米, 世界坐标)
 *   - buildParticleSeeds(count, seed) -> Float32Array(count*3) 每粒子的 (phase, speedScale, swayScale)
 *   - buildParticlePoints(...) -> THREE.Points
 * 与其他模块的关系:
 *   上游: 叶片几何由 leaf.js 生成并合并, 这里只读取它的 position 属性;
 *   下游: 由 sceneManager 把返回的 Points 加进场景, 每帧只更新共享的 uTime;
 *   风场 uniform 是**共享对象**(sharedUniforms), 与树/落叶/粒子同源。
 * 关键概念 / 约定:
 *   - 粒子是「纯 GPU 动画」: 位置属性存的是出生点, 下坠/飘动全在顶点着色器里按 uTime 计算,
 *     所以 CPU 每帧只写一个 float, 粒子上限可以开很高。
 *   - 随机数一律来自 core/rng.js 的 makeRng(seed, 阶段标签) 子流, 保证同一 seed
 *     的粒子分布可复现, 且不会因为改了粒子参数而挪动树干。
 * 注意: 本文件里的 GLSL 是模板字符串 (§ 里的注释是着色器注释, 不是 JS 注释),
 *       改动它们等同于改代码, 会被守卫判定为语义变更。
 */
import * as THREE from 'three'
import { makeRng } from './rng.js'

/** 从叶片几何采样发射点 (均匀取 stride 个顶点), 返回 Float32Array */
export function sampleEmitPositions(leafGeometry, params, seed) {
  const P = params.particles || {}
  // count = 0 也允许: 返回全零长度的数组, 上层 Points 会变成空几何 (等价于关闭)
  const count = Math.max(0, Math.round(P.count === undefined ? 240 : P.count))
  // Float32Array 直接就是 GPU 顶点缓冲想要的格式 (BufferAttribute 会零拷贝复用这块内存),
  // 用普通数组还得再转换一次
  const pos = new Float32Array(count * 3)
  const attrs = leafGeometry && leafGeometry.attributes
  // 树还没长叶子 / 参数为 0 时没有采样源, 直接返回零数组 (调用方自己判断 count)
  if (!leafGeometry || !attrs || !attrs.position || count === 0) return pos
  const src = attrs.position.array
  const n = attrs.position.count
  // 独立随机子流: 只受 seed 与阶段标签 'particles' 影响
  const rng = makeRng(seed || 1, 'particles')
  const spread = P.spread === undefined ? 1 : P.spread
  for (let i = 0; i < count; i++) {
    // 均匀随机挑一个叶片顶点 (不重复按序取, 避免聚成一条线)
    const v = Math.floor(rng.next() * n)
    // spread 收缩横向分布: 树叶几何本身是三角形列表, 顶点分布天然不均匀,
    // 这里不再做面积加权 —— 粒子只是点缀, 顶点密的地方略多一点反而更像花果簇。
    const x = src[v * 3] * spread
    // Y 方向的 spread 是「半衰减」的: 0.55 + 0.45*spread, 保证即使 spread=0,
    // 粒子的高度分布也不会全部塌到地面 (否则看起来像地上冒烟而不是树冠飘落)。
    const y = src[v * 3 + 1] * (0.55 + 0.45 * spread)
    const z = src[v * 3 + 2] * spread
    pos[i * 3] = x
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = z
  }
  return pos
}

/** 每个粒子的随机相/速度扰动 (让运动不同步) */
export function buildParticleSeeds(count, seed) {
  const rng = makeRng(seed || 1, 'particles-seed')
  const aSeed = new Float32Array(count * 3) // phase, speedScale, swayScale
  for (let i = 0; i < count; i++) {
    // phase: 0..1, 生命循环的起始偏移 -> 同一时刻粒子处在不同生命阶段, 不会整批同步下落
    aSeed[i * 3] = rng.next()
    // speedScale: 0.6..1.4, 各自下落快慢 (轻的飘得慢)
    aSeed[i * 3 + 1] = 0.6 + rng.next() * 0.8
    // swayScale: 0.5..1.5, 横向摆动幅度倍率
    aSeed[i * 3 + 2] = 0.5 + rng.next()
  }
  return aSeed
}

/* ---------------- 顶点着色器: 生命循环 / 下落 / 风场 / 点尺寸 ---------------- */
export const PARTICLE_VERT = /* glsl */`
uniform float uTime;
uniform float uSize;
uniform float uSpeed;
uniform float uFall;
uniform float uSway;
uniform float uSwirl;
uniform float uHeight;
uniform float uGlow;
// --- 风场 (与树木共用同一份 uniform) ---
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uGust;
uniform float uGustSpeed;
uniform float uWindBias;
uniform float uWindEnabled;
uniform float uWindSpeed;
uniform float uWindFollow;   // 粒子受风影响倍率
attribute vec3 aSeed;      // phase, speedScale, swayScale
varying float vAlpha;
varying float vGlow;

void main() {
  float phase = aSeed.x;
  float speedScale = aSeed.y;
  float swayScale = aSeed.z;
  // 生命循环 0..1
  float t = fract(uTime * uSpeed * speedScale + phase);
  vec3 p = position;
  // 下落: 从树冠高度落到地面
  p.y -= t * uFall * max(1.0, uHeight * 0.85);
  // --- 风场: 沿下风向被吹走 (与树同源, 风向/强度/阵风一致) ---
  vec2 windDir = normalize(uWindDir + vec2(1e-5, 1e-6));
  // 阵风: 同一套起伏模型, 让粒子跟着树一起"一阵一阵"地走
  float gust = 1.0 - uGust * 0.6 * (1.0 - (sin(uTime * uGustSpeed + phase * 6.28318) * 0.5 + 0.5));
  // 风只推不拉 + bias 抬低谷 (与树叶同一规则)
  float along = uWindStrength * uWindFollow * (0.55 * gust + uWindBias * 0.45) * uWindEnabled;
  // 越到生命后期被吹得越远 (粒子被风带着走)
  float carry = along * (2.5 + 9.0 * t) * (1.0 + 0.35 * sin(uTime * uWindSpeed * 2.0 + phase * 12.0));
  p.x += windDir.x * carry;
  p.z += windDir.y * carry;
  // 垂直分量: 强风时粒子被上扬/翻卷
  p.y += sin(uTime * (0.6 + uWindSpeed) + phase * 9.0) * along * 1.2;

  // 独立的横向飘动 + 打旋 (无风时也有细微运动)
  float ang = (phase + t) * 6.28318 * (0.5 + phase);
  p.x += sin(ang) * uSway * swayScale * (0.4 + 0.6 * t) + sin(uTime * 0.7 + phase * 12.0) * uSwirl * 0.15;
  p.z += cos(ang * 0.8) * uSway * swayScale * (0.4 + 0.6 * t) + cos(uTime * 0.6 + phase * 9.0) * uSwirl * 0.15;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // 近大远小
  gl_PointSize = max(1.0, uSize * uGlow * 600.0 / max(0.001, -mv.z));
  // 淡入淡出 (首尾各 15%)
  vAlpha = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.75, 1.0, t));
  vGlow = uGlow;
}
`

/* ---------------- 片元着色器: 圆形软边点精灵 + 色调映射 ---------------- */
export const PARTICLE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying float vGlow;

void main() {
  // 圆形软边点精灵
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (r > 0.5) discard;
  float core = smoothstep(0.5, 0.05, r);
  float a = core * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * (0.5 + 0.9 * vGlow), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/**
 * 创建粒子材质 (ShaderMaterial)。
 *
 * 关键点: 风场相关的 uniform **不是拷贝值, 而是直接引用 sharedUniforms 里的同一个对象**,
 * 所以 sceneManager 改风向/强度/阵风时粒子立刻同步 —— 不需要任何刷新逻辑。
 * 其余 uniform 是各自独立的 { value } 容器, 可以单独立改。
 *
 * @param {object} params 全量参数 (读 params.particles)
 * @param {object} sharedUniforms 共享 uniform 池 (uTime + 风场 + uSunDir 等)
 * @returns {THREE.ShaderMaterial} 加法混合、不写深度的粒子材质
 */
export function createParticleMaterial(params, sharedUniforms) {
  const P = params.particles || {}
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      // uTime 也共享: 一个全局时间驱动全场景的动画
      uTime: sharedUniforms.uTime,
      // 以下默认值 (0.05/0.35/1/1/0.6/0.8/0.85) 是出厂观感: 细小白金色光点缓缓飘落
      uSize: { value: P.size === undefined ? 0.05 : P.size },
      uSpeed: { value: P.speed === undefined ? 0.35 : P.speed },
      uFall: { value: P.fall === undefined ? 1 : P.fall },
      uSway: { value: P.sway === undefined ? 1 : P.sway },
      uSwirl: { value: P.swirl === undefined ? 0.6 : P.swirl },
      // uHeight 初值 10: 建材质时还不知道树高, 稍后 updateParticleMaterial 会用包围盒覆盖
      // 它是"下落总高度", 决定粒子从多高落到地面 (与 uFall 相乘)
      uHeight: { value: 10 },
      uGlow: { value: P.glow === undefined ? 0.8 : P.glow },
      uColor: { value: new THREE.Color(P.color || '#fff0b8') },
      uOpacity: { value: P.opacity === undefined ? 0.85 : P.opacity },
      // 直接引用共享风场 uniform (同一个对象: 风向/强度/阵风改动会立即同步到粒子)
      uWindDir: sharedUniforms.uWindDir,
      uWindStrength: sharedUniforms.uWindStrength,
      uGust: sharedUniforms.uGust,
      uGustSpeed: sharedUniforms.uGustSpeed,
      uWindBias: sharedUniforms.uWindBias,
      uWindEnabled: sharedUniforms.uWindEnabled,
      uWindSpeed: sharedUniforms.uWindSpeed,
      uWindFollow: { value: P.windFollow === undefined ? 1 : P.windFollow },
    },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    // 加法混合: 光点叠加会更亮, 适合花粉/萤火; depthWrite=false 避免半透明互相遮挡
    // 注意: 加法混合下颜色会累积, 所以 uOpacity 不宜过高 (默认 0.85 已接近饱和)
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  return mat
}

/**
 * 参数变化时原地更新粒子材质 (不重建几何, 不重建材质)。
 *
 * 与 createParticleMaterial 的区别: 这里不碰几何/属性, 只改 uniform 的 value;
 * uWindFollow 做了存在性判断, 以防传入的是别的材质 (没有这个 uniform)。
 *
 * @param {THREE.ShaderMaterial} mat createParticleMaterial 的返回值
 * @param {object} params 全量参数
 * @param {{max:{y:number}, min:{y:number}}|null} leafBBox 当前叶片几何的包围盒, 用于更新下落高度
 */
export function updateParticleMaterial(mat, params, leafBBox) {
  if (!mat) return
  const P = params.particles || {}
  const u = mat.uniforms
  u.uSize.value = P.size === undefined ? 0.05 : P.size
  u.uSpeed.value = P.speed === undefined ? 0.35 : P.speed
  u.uFall.value = P.fall === undefined ? 1 : P.fall
  u.uSway.value = P.sway === undefined ? 1 : P.sway
  u.uSwirl.value = P.swirl === undefined ? 0.6 : P.swirl
  u.uGlow.value = P.glow === undefined ? 0.8 : P.glow
  u.uColor.value.set(P.color || '#fff0b8')
  u.uOpacity.value = P.opacity === undefined ? 0.85 : P.opacity
  if (u.uWindFollow) u.uWindFollow.value = P.windFollow === undefined ? 1 : P.windFollow
  // 下落总高度 ≈ 树冠高度: 粒子从最顶端的叶片落到地面正好走完一个生命循环。
  // max(1, ...) 是防 0: 空几何的包围盒高度为 0 会导致除法/乘法退化。
  if (leafBBox) u.uHeight.value = Math.max(1, leafBBox.max.y - leafBBox.min.y)
}

/** 构建 Points 对象 */
export function buildParticlePoints(leafGeometry, params, sharedUniforms, seed) {
  const P = params.particles || {}
  const pos = sampleEmitPositions(leafGeometry, params, seed)
  const count = pos.length / 3
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  // aSeed 是 vec3: 每顶点 3 个随机数, 见 buildParticleSeeds
  geo.setAttribute('aSeed', new THREE.BufferAttribute(buildParticleSeeds(count, seed), 3))
  const mat = createParticleMaterial(params, sharedUniforms)
  if (leafGeometry) {
    // 包围盒可能还没算过 (几何是手动拼的省略了 computeBoundingBox), 这里按需补一次
    // 注意 computeBoundingBox 是懒计算: 只有 uHeight 需要它, 所以放在这里而不是无条件调用
    if (!leafGeometry.boundingBox) leafGeometry.computeBoundingBox()
    updateParticleMaterial(mat, params, leafGeometry.boundingBox)
  }
  const points = new THREE.Points(geo, mat)
  // frustumCulled = false: 顶点在着色器里大幅位移, CPU 侧的包围球完全不准,
  // 交给视锥剔除会导致「转头就整批消失」, 所以干脆关掉剔除 (粒子数量少, 代价可忽略)。
  // 同理, Points 只用 position 属性算包围球, 而本文件的位置数据是"出生点",
  // 与粒子实际出现的位置并不一致 —— 这也是必须关剔除的原因之一。
  points.frustumCulled = false
  points.visible = !!P.enabled
  return points
}
