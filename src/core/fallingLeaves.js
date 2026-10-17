import * as THREE from 'three'
import { makeRng } from './rng.js'
import { sampleEmitPositions } from './particles.js'
import { resolveEffectTexture, resolveEffectAspect } from './leafTexture.js'

/**
 * 落叶效果 (falling leaves)
 * ------------------------------------------------------------
 * 和粒子同一思路, 但"粒子"是真实叶片卡片:
 *   - 每个落叶 = 一张卡片 (默认 6 面), 全部合批成**一个 draw call**
 *   - 位置/下落/翻滚/受风全在顶点着色器里算 -> CPU 零开销 (只更新一次 uTime)
 *   - 风场与树木**共用同一份 uniform** (风向/强度/阵风一致, 风一吹落叶就顺风飘)
 *   - 叶片贴图沿用当前选中的叶片卡片 (alphaTest 裁出叶形)
 */

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
  // 正面朝上时亮一点, 背面暗一点 (翻飞时的明暗变化)
  vShade = 0.55 + 0.45 * max(0.0, R[1][1]) ;
  vShade *= fade;
}
`

const FALL_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uAlphaTest;
varying vec2 vUv;
varying float vShade;

void main() {
  vec4 tex = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
  // 没有贴图时用一个椭圆当叶形 (兜底, 不至于变成方块)
  if (uHasMap < 0.5) {
    vec2 d = vUv - vec2(0.5);
    if (length(vec2(d.x * 1.6, d.y)) > 0.5) discard;
  }
  if (uHasMap > 0.5 && tex.a < uAlphaTest) discard;
  vec3 col = (uHasMap > 0.5 ? tex.rgb : uColor) * vShade;
  gl_FragColor = vec4(col, (uHasMap > 0.5 ? 1.0 : uOpacity));
  if (vShade < 0.02) discard;
}
`

/**
 * 构建落叶网格
 * @param {THREE.BufferGeometry} canopyGeometry 叶片几何 (用于采样出生点)
 * @param {object} params 全量参数
 * @param {object} sharedUniforms 共享 uniform (风场/时间)
 * @param {THREE.Texture|null} map 叶片贴图
 * @param {{min:{x,y,z},max:{x,y,z}}} bbox 树冠包围盒
 */
export function buildFallingLeaves(canopyGeometry, params, sharedUniforms, map, bbox) {
  const F = params.fall || {}
  const count = Math.max(1, Math.round(F.count === undefined ? 80 : F.count))
  const seed = params.seed || 1
  // 出生点: 从树冠里采样 (和粒子同一套采样)
  const spawn = sampleEmitPositions(canopyGeometry, { particles: { count, spread: F.spread === undefined ? 1 : F.spread } }, seed)
  const F0 = params.fall || {}
  const aspect = resolveEffectAspect(F0.cardId, params.leaves && params.leaves.cardAspect)
  const halfW = 0.5 * Math.min(1.6, Math.max(0.35, aspect))
  const halfH = 0.5

  // 4 个顶点 / 2 个三角 / 每片叶; 顶点属性: position(出生点), uv, aLeafSeed
  const vertsPerLeaf = 4
  const pos = new Float32Array(count * vertsPerLeaf * 3)
  const uvs = new Float32Array(count * vertsPerLeaf * 2)
  const seeds = new Float32Array(count * vertsPerLeaf * 4)
  const idx = new Uint32Array(count * 6)
  const rng = makeRng(seed, 'falling-leaves')
  const corners = [
    [-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH],
  ]
  const cornerUv = [[0, 0], [1, 0], [1, 1], [0, 1]]
  for (let i = 0; i < count; i++) {
    const sx = spawn[i * 3], sy = spawn[i * 3 + 1], sz = spawn[i * 3 + 2]
    const phase = rng.next()
    const speedScale = 0.65 + rng.next() * 0.7
    const sizeScale = 0.7 + rng.next() * 0.6
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
    const b = i * vertsPerLeaf
    const o = i * 6
    idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2
    idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('aLeafSeed', new THREE.BufferAttribute(seeds, 4))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  // 用 uv 推导局部顶点 -> 把 "position = 出生点" 和 "局部形状" 分开
  geo.userData.halfW = halfW
  geo.userData.halfH = halfH

  const resolved = resolveEffectTexture({ cardId: F0.cardId, followMap: map })
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uFallSpeed: { value: F.speed === undefined ? 1 : F.speed },
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
      uHasMap: { value: 1 },
      uColor: { value: new THREE.Color(F.color || '#d9a441') },
      uOpacity: { value: F.opacity === undefined ? 1 : F.opacity },
      uAlphaTest: { value: F.alphaTest === undefined ? 0.35 : F.alphaTest },
      uHalf: { value: new THREE.Vector2(halfW, halfH) },
    },
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.visible = !!F.enabled
  return mesh
}

/** 只改参数, 不重建几何 (数量变化时才重建) */
export function updateFallingLeaves(mesh, params) {
  if (!mesh) return
  const F = params.fall || {}
  const u = mesh.material.uniforms
  mesh.visible = !!F.enabled
  u.uFallSpeed.value = F.speed === undefined ? 1 : F.speed
  u.uSizeScale.value = F.size === undefined ? 0.35 : F.size
  u.uSwirl.value = F.swirl === undefined ? 1 : F.swirl
  u.uSpinSpeed.value = F.spinSpeed === undefined ? 1.2 : F.spinSpeed
  u.uStagger.value = F.stagger === undefined ? 0.6 : F.stagger
  u.uWindFollow.value = F.windFollow === undefined ? 1 : F.windFollow
  u.uColor.value.set(F.color || '#d9a441')
  u.uOpacity.value = F.opacity === undefined ? 1 : F.opacity
  u.uAlphaTest.value = F.alphaTest === undefined ? 0.35 : F.alphaTest
}
