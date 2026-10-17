import * as THREE from 'three'
import { makeRng } from './rng.js'

/**
 * 叶片粒子发射 (花粉 / 光点 / 孢子)
 * ------------------------------------------------------------
 * 思路: 在叶片顶点位置采样"发射点", 用 Points + 顶点着色器做循环运动
 *      (下落 + 横向飘动 + 打旋 + 闪烁), CPU 零开销 —— 只有一次 uTime 更新。
 * 之所以从叶片采样: 粒子看起来是从树冠里冒出来的, 而不是凭空出现。
 */

/** 从叶片几何采样发射点 (均匀取 stride 个顶点), 返回 Float32Array */
export function sampleEmitPositions(leafGeometry, params, seed) {
  const P = params.particles || {}
  const count = Math.max(0, Math.round(P.count === undefined ? 240 : P.count))
  const pos = new Float32Array(count * 3)
  const attrs = leafGeometry && leafGeometry.attributes
  if (!leafGeometry || !attrs || !attrs.position || count === 0) return pos
  const src = attrs.position.array
  const n = attrs.position.count
  const rng = makeRng(seed || 1, 'particles')
  const spread = P.spread === undefined ? 1 : P.spread
  for (let i = 0; i < count; i++) {
    // 均匀随机挑一个叶片顶点 (不重复按序取, 避免聚成一条线)
    const v = Math.floor(rng.next() * n)
    const x = src[v * 3] * spread
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
    aSeed[i * 3] = rng.next()
    aSeed[i * 3 + 1] = 0.6 + rng.next() * 0.8
    aSeed[i * 3 + 2] = 0.5 + rng.next()
  }
  return aSeed
}

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
}
`

export function createParticleMaterial(params, sharedUniforms) {
  const P = params.particles || {}
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uSize: { value: P.size === undefined ? 0.05 : P.size },
      uSpeed: { value: P.speed === undefined ? 0.35 : P.speed },
      uFall: { value: P.fall === undefined ? 1 : P.fall },
      uSway: { value: P.sway === undefined ? 1 : P.sway },
      uSwirl: { value: P.swirl === undefined ? 0.6 : P.swirl },
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
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  return mat
}

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
  if (leafBBox) u.uHeight.value = Math.max(1, leafBBox.max.y - leafBBox.min.y)
}

/** 构建 Points 对象 */
export function buildParticlePoints(leafGeometry, params, sharedUniforms, seed) {
  const P = params.particles || {}
  const pos = sampleEmitPositions(leafGeometry, params, seed)
  const count = pos.length / 3
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(buildParticleSeeds(count, seed), 3))
  const mat = createParticleMaterial(params, sharedUniforms)
  if (leafGeometry) {
    if (!leafGeometry.boundingBox) leafGeometry.computeBoundingBox()
    updateParticleMaterial(mat, params, leafGeometry.boundingBox)
  }
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.visible = !!P.enabled
  return points
}
