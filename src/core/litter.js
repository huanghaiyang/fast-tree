import * as THREE from 'three'
import { makeRng } from './rng.js'
import { resolveEffectTexture, resolveEffectAspect } from './leafTexture.js'
import { resolveLeafEffects } from './leafEffects.js'

const LITTER_VERT = /* glsl */`
attribute vec3 color;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vColor = color;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const LITTER_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uAlphaTest;
uniform float uShade;
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
varying vec3 vColor;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < uAlphaTest) discard;
  vec3 col = tex.rgb * vColor * uShade;
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
  gl_FragColor = vec4(col, tex.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function effectUniforms(params) {
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

export function updateLitterEffects(mesh, params) {
  if (!mesh || !mesh.material || !mesh.material.uniforms) return
  const u = mesh.material.uniforms
  const e = resolveLeafEffects(params, params.effectSource || 'leaf', params.effectInherit !== false)
  if (u.uInherit) u.uInherit.value = e.inherit
  if (u.uEmissive) u.uEmissive.value = e.emissive
  if (u.uEmissiveColor) u.uEmissiveColor.value.set(e.emissiveColor)
  if (u.uSpecular) u.uSpecular.value = e.specular
  if (u.uSpecularShininess) u.uSpecularShininess.value = e.specularShininess
  if (u.uSpecularColor) u.uSpecularColor.value.set(e.specularColor)
  if (u.uScatter) u.uScatter.value = e.scatter
  if (u.uScatterPower) u.uScatterPower.value = e.scatterPower
}

/** 堆积需要重建的判据 (同样包含"跟随的树叶贴图") */
export function litterRebuildKey(params) {
  const L = params.litter || {}
  return [
    L.cardId || '',
    Math.round(L.count === undefined ? 260 : L.count),
    Math.round((L.radius === undefined ? 1 : L.radius) * 100),
    Math.round((L.size === undefined ? 0.55 : L.size) * 100),
    Math.round((L.thickness === undefined ? 0.06 : L.thickness) * 1000),
    Math.round((L.colorVariance === undefined ? 0.45 : L.colorVariance) * 100),
    params.leafMat && params.leafMat.texture ? params.leafMat.texture : '',
    params.leaves && params.leaves.cardAspect,
  ].join('|')
}

/**
 * 地面落叶堆积
 * ------------------------------------------------------------
 * - 每片落叶 = 一张卡片 (2 三角), 全部合批 -> 1 个 draw call
 * - 卡片平铺在地面上, 随机朝向 + 轻微倾斜 + 随机层叠高度 -> 堆积感
 * - "不同形态": 通过 UV 随机翻转/旋转 + 顶点色色差实现 (只需要一张贴图)
 * - 静态几何, 不需要每帧更新 (风不影响地面落叶)
 */
export function buildLeafLitter(params, map, bbox) {
  const L = params.litter || {}
  const count = Math.max(1, Math.round(L.count === undefined ? 260 : L.count))
  const seed = params.seed || 1
  const rng = makeRng(seed, 'leaf-litter')

  // 分布半径: 树冠半径 × 参数
  const treeR = bbox
    ? Math.max(Math.abs(bbox.min.x), Math.abs(bbox.max.x), Math.abs(bbox.min.z), Math.abs(bbox.max.z))
    : 6
  const radius = Math.max(0.5, treeR * (L.radius === undefined ? 1.0 : L.radius))
  const size = L.size === undefined ? 0.55 : L.size
  const thickness = L.thickness === undefined ? 0.06 : L.thickness
  const aspect = resolveEffectAspect(L.cardId, params.leaves && params.leaves.cardAspect)
  const halfW = 0.5 * Math.min(1.6, Math.max(0.35, aspect)) * size
  const halfH = 0.5 * size
  const baseColor = new THREE.Color(L.color || '#ffffff')
  const colorVar = L.colorVariance === undefined ? 0.45 : L.colorVariance

  const vPer = 4
  const pos = new Float32Array(count * vPer * 3)
  const uvs = new Float32Array(count * vPer * 2)
  const cols = new Float32Array(count * vPer * 3)
  const nrm = new Float32Array(count * vPer * 3)
  const idx = new Uint32Array(count * 6)
  const cornerUv = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

  for (let i = 0; i < count; i++) {
    // 极坐标散布 (sqrt 保证面积均匀), 中心略密 -> 树下更厚
    const ang = rng.next() * Math.PI * 2
    const rr = Math.sqrt(rng.next()) * radius
    const cx = Math.cos(ang) * rr
    const cz = Math.sin(ang) * rr
    // 中心更厚 (堆积感): 越靠近树干, 层叠高度越高
    const centerBoost = 1 - Math.min(1, rr / Math.max(0.001, radius)) * 0.7
    const cy = 0.004 + rng.next() * thickness * centerBoost
    const yaw = rng.next() * Math.PI * 2
    const tilt = (rng.next() - 0.5) * 0.35 // 轻微倾斜 (不是完美贴地)
    // 每片叶子一个 UV 变换: 翻转 + 旋转 90° 的整数倍 -> 同一张贴图看起来是多形态
    const flipU = rng.next() < 0.5 ? 1 : 0
    const flipV = rng.next() < 0.5 ? 1 : 0
    const rot = Math.floor(rng.next() * 4)
    // 枯叶色差
    const tint = 1 + (rng.next() - 0.5) * 2 * colorVar
    const cr = Math.min(1, baseColor.r * tint)
    const cg = Math.min(1, baseColor.g * tint)
    const cb = Math.min(1, baseColor.b * tint)

    const cosY = Math.cos(yaw), sinY = Math.sin(yaw)
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt)
    const lift = halfH * Math.abs(sinT)   // 补偿倾斜: 避免边角穿到地面以下
    for (let v = 0; v < vPer; v++) {
      const k = i * vPer + v
      const lx = corner[v][0] * halfW
      const lz = corner[v][1] * halfH
      // 先绕 X 倾斜 (让叶片不完全水平), 再绕 Y 旋转
      const ty = lz * sinT
      const lz2 = lz * cosT
      const wx = cx + lx * cosY - lz2 * sinY
      const wz = cz + lx * sinY + lz2 * cosY
      const wy = cy + ty + lift
      pos[k * 3] = wx
      pos[k * 3 + 1] = wy
      pos[k * 3 + 2] = wz
      // 法线近似朝上 (带倾斜)
      nrm[k * 3] = Math.sin(tilt) * sinY * -1
      nrm[k * 3 + 1] = cosT
      nrm[k * 3 + 2] = Math.sin(tilt) * cosY * -1
      // UV: 先按角落, 再镜像/旋转
      let u = cornerUv[v][0], w = cornerUv[v][1]
      if (flipU) u = 1 - u
      if (flipV) w = 1 - w
      for (let r = 0; r < rot; r++) { const t2 = u; u = 1 - w; w = t2 }  // 顺时针转 90°
      uvs[k * 2] = u
      uvs[k * 2 + 1] = w
      cols[k * 3] = cr
      cols[k * 3 + 1] = cg
      cols[k * 3 + 2] = cb
    }
    const b = i * vPer
    const o = i * 6
    idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2
    idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))

  // 地面落叶用无光照着色器: 贴图颜色 × 顶点色 × 明暗系数,
  // 同时可选继承树叶/花朵的自发光、反光、散光。
  const resolved = resolveEffectTexture({ cardId: L.cardId, followMap: map })
  const shade = L.shade === undefined ? 0.78 : L.shade
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: resolved.map },
      uAlphaTest: { value: L.alphaTest === undefined ? 0.35 : L.alphaTest },
      uShade: { value: shade },
      uSunDir: { value: new THREE.Vector3(0.5, 1, 0.35).normalize() },
      uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
      ...effectUniforms(params),
    },
    vertexShader: LITTER_VERT,
    fragmentShader: LITTER_FRAG,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.frustumCulled = false
  mesh.visible = !!L.enabled
  return mesh
}
