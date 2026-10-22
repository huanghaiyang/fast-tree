/**
 * 地面落叶堆积 (litter)
 * ------------------------------------------------------------
 * 作用: 在树冠投影范围内的地面上铺一层落叶卡片, 让树"落地"而不是悬在空中。
 * 输入 / 输出:
 *   - buildLeafLitter(params, map, bbox) -> THREE.Mesh (一个 draw call 的全部落叶)
 *   - litterRebuildKey(params) -> string (判据: 变了才需要重建几何)
 *   - updateLitterEffects(mesh, params) -> void (只刷 uniform, 不重建)
 * 与其他模块的关系:
 *   上: state.params.litter (数量/半径/尺寸/厚度/色差/贴图选择) 与树冠包围盒 bbox;
 *   贴图与宽高比走 leafTexture.js 的 resolveEffectTexture / resolveEffectAspect;
 *   光照继承走 leafEffects.js 的 resolveLeafEffects;
 *   下: 返回的 mesh 由 sceneManager 加进场景, 静态显示, 不参与风场与生长动画。
 * 关键概念 / 约定:
 *   - 每片落叶 = 一张矩形卡片 (4 顶点 / 2 三角), 全部合批 -> 1 个 draw call。
 *   - 坐标: 世界坐标, 单位米; 地面近似取 y≈0 (不做地形贴地, 因为本项目没有地形网格)。
 *   - 顶点属性: position / uv / color / normal。color 是"枯叶色差"(基色 × 每片随机),
 *     normal 是近似的向上法线 (带轻微倾斜), 供光照继承分支使用。
 * 注意: 本文件含 GLSL 模板字符串, 其中的 `//` 是着色器注释, 改动等于改代码。
 */
import * as THREE from 'three'
import { makeRng } from './rng.js'
import { resolveEffectTexture, resolveEffectAspect } from './leafTexture.js'
import { resolveLeafEffects } from './leafEffects.js'

/* ---------------- 地面落叶的顶点/片元着色器 (无光照 + 可选继承树叶光效) ---------------- */
// 顶点着色器: 只做「世界位置/世界法线」准备。地面落叶是静态的,
// 没有风、没有生长, 所以不需要任何随时间变化的 uniform。
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

// 片元着色器: 贴图色 × 顶点色 × 明暗系数; uInherit > 0.5 时再叠加自发光/高光/边缘散射。
// 注意它不是 PBR, 所以这些"高光/散射"都是手工近似, 只为和树叶材质观感一致。
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

/**
 * 把 resolveLeafEffects 的结果打包成 uniform 容器 (新建材质时用)。
 *
 * 与 fallingLeaves.js 里同名函数是**各自独立的副本** (两个文件的着色器 uniform 集合不同),
 * 不要试图合并 —— 合并会把两个效果的参数耦合在一起。
 *
 * @param {object} params 全量参数
 * @returns {Object<string, {value: any}>} 8 个「继承光照」uniform
 */
function effectUniforms(params) {
  // source/effectInherit 允许地面落叶选择「继承树叶」还是「继承花朵」的光效
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
 * 参数变化时就地刷新地面落叶的「继承光照」uniform (不重建几何/材质)。
 *
 * 每个 uniform 都做 if 判断: 材质可能来自旧版本 (缺少某个 uniform),
 * 或是别的 ShaderMaterial, 直接写 .value 会抛错。
 *
 * @param {THREE.Mesh|null} mesh buildLeafLitter 的返回值
 * @param {object} params 全量参数
 */
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
// 说明: 这些字段任一变化都会改变几何布局或贴图选择, 必须重建;
// 浮点字段先做定点取整 (×100 / ×1000) 再拼字符串, 避免 0.0000001 的抖动触发重建。
// 末尾还拼了「跟随的树叶贴图」和「树叶宽高比」: 因为落叶可能跟随树冠贴图,
// 那两者变了同样要重算卡片宽高。
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
 *
 * @param {object} params 全量参数 (读 params.litter / params.seed / params.effect*)
 * @param {THREE.Texture|null} map 树冠当前贴图, 用于 cardId 为空时"跟随"
 * @param {{min:{x,y,z},max:{x,y,z}}|null} bbox 树冠包围盒 (米), 决定散布半径
 * @returns {THREE.Mesh} 合批后的落叶网格 (材质为自定义 ShaderMaterial)
 */
export function buildLeafLitter(params, map, bbox) {
  const L = params.litter || {}
  const count = Math.max(1, Math.round(L.count === undefined ? 260 : L.count))
  const seed = params.seed || 1
  // 独立随机子流: 改落叶参数不会影响树干/树枝的随机序列 (确定性纪律)
  const rng = makeRng(seed, 'leaf-litter')

  // 分布半径: 树冠半径 × 参数
  // 用包围盒 XZ 方向的最大绝对值当"树冠半径"; 没有 bbox 时退回 6 米的经验值。
  const treeR = bbox
    ? Math.max(Math.abs(bbox.min.x), Math.abs(bbox.max.x), Math.abs(bbox.min.z), Math.abs(bbox.max.z))
    : 6
  // 最小 0.5 米: 半径太小会让所有落叶叠在树干处 (中心密度爆炸), 视觉上是一坨而不是一层
  const radius = Math.max(0.5, treeR * (L.radius === undefined ? 1.0 : L.radius))
  const size = L.size === undefined ? 0.55 : L.size
  const thickness = L.thickness === undefined ? 0.06 : L.thickness
  // 卡片宽高比: 自己的卡 -> 树叶的卡 -> 1
  const aspect = resolveEffectAspect(L.cardId, params.leaves && params.leaves.cardAspect)
  // 半宽夹在 0.35..1.6 之间: 极端宽高比 (比如整枝花簇) 会让单片落叶大得离谱
  const halfW = 0.5 * Math.min(1.6, Math.max(0.35, aspect)) * size
  const halfH = 0.5 * size
  const baseColor = new THREE.Color(L.color || '#ffffff')
  // colorVariance: 0 时所有落叶同色 (看起来像贴图复制), 0.45 是"脏但不过火"的默认值
  const colorVar = L.colorVariance === undefined ? 0.45 : L.colorVariance

  /* ---------------- 预分配缓冲: count × 4 顶点, count × 6 索引 ---------------- */
  // 全部用 TypedArray 预分配 (而不是 push), 几千片落叶时能省下大量 GC。
  // 属性布局 (与 three.js 内置 attribute 名一致, 供自定义着色器直接读取):
  //   position(3) uv(2) color(3) normal(3); index 用 Uint32Array (顶点数可能超过 65535)。
  const vPer = 4
  const pos = new Float32Array(count * vPer * 3)
  const uvs = new Float32Array(count * vPer * 2)
  const cols = new Float32Array(count * vPer * 3)
  const nrm = new Float32Array(count * vPer * 3)
  const idx = new Uint32Array(count * 6)
  // 四个角的 UV 与"单位方形"坐标, 下标顺序一致 (0=左下 1=右下 2=右上 3=左上)
  // corner 用 ±1 而不是 ±0.5: 乘 halfW/halfH 之后中心仍在 (cx,cz), 但推导时更直观
  const cornerUv = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

  for (let i = 0; i < count; i++) {
    // 注意随机数的**取值顺序**: ang -> rr -> cy -> yaw -> tilt -> flip -> rot -> tint。
    // 这个顺序一旦改动, 同一 seed 生成的整片落叶层就全变样了 (所以新增参数只能往后追加)。
    // 极坐标散布 (sqrt 保证面积均匀), 中心略密 -> 树下更厚
    // 若直接用 rng 当半径, 点会聚在中心 (面积元 r·dr), 开方后才是面积均匀分布。
    const ang = rng.next() * Math.PI * 2
    const rr = Math.sqrt(rng.next()) * radius
    const cx = Math.cos(ang) * rr
    const cz = Math.sin(ang) * rr
    // 中心更厚 (堆积感): 越靠近树干, 层叠高度越高
    // centerBoost 从树干处的 1 线性降到边缘的 0.3 (1-0.7)
    const centerBoost = 1 - Math.min(1, rr / Math.max(0.001, radius)) * 0.7
    // 0.004 是"离地最小间隙": 完全贴地会和地面 z-fighting (深度冲突闪条纹)
    const cy = 0.004 + rng.next() * thickness * centerBoost
    const yaw = rng.next() * Math.PI * 2
    const tilt = (rng.next() - 0.5) * 0.35 // 轻微倾斜 (不是完美贴地): ±0.175 弧度 ≈ ±10°
    // 每片叶子一个 UV 变换: 翻转 + 旋转 90° 的整数倍 -> 同一张贴图看起来是多形态
    const flipU = rng.next() < 0.5 ? 1 : 0
    const flipV = rng.next() < 0.5 ? 1 : 0
    const rot = Math.floor(rng.next() * 4)
    // 枯叶色差: tint 在 1±colorVar 之间随机, 乘到基色上形成深浅不一的腐叶层
    const tint = 1 + (rng.next() - 0.5) * 2 * colorVar
    const cr = Math.min(1, baseColor.r * tint)
    const cg = Math.min(1, baseColor.g * tint)
    const cb = Math.min(1, baseColor.b * tint)

    // 三角函数预先算好: 每片叶子 4 个顶点共用同一组 cos/sin, 提前算可省 8 次三角运算
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw)
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt)
    const lift = halfH * Math.abs(sinT)   // 补偿倾斜: 避免边角穿到地面以下
    for (let v = 0; v < vPer; v++) {
      // 第 i 片叶子的第 v 个角 = 缓冲区里的第 i*4+v 个顶点
      const k = i * vPer + v
      const lx = corner[v][0] * halfW
      const lz = corner[v][1] * halfH
      // 先绕 X 倾斜 (让叶片不完全水平), 再绕 Y 旋转
      // 倾斜: 把平面内的 z 抬到 y 上 (ty), 同时 z 分量乘 cosT 缩短 —— 即绕 X 轴的二维旋转。
      const ty = lz * sinT
      const lz2 = lz * cosT
      // 再绕 Y 轴旋转 yaw, 得到世界的 X/Z
      const wx = cx + lx * cosY - lz2 * sinY
      const wz = cz + lx * sinY + lz2 * cosY
      // + lift 整体抬高, 保证倾斜后最低的角也不低于 cy
      const wy = cy + ty + lift
      pos[k * 3] = wx
      pos[k * 3 + 1] = wy
      pos[k * 3 + 2] = wz
      // 法线近似朝上 (带倾斜)
      // 精确法线应是 (0, cosT, 0) 绕 Y 转后的结果再加上倾斜分量; 这里取足够近似的写法:
      // Y 分量 cosT 保证主要朝上, X/Z 的小分量让倾斜感在光照里体现出来。
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
      // 顶点色在此处是"单片统一色" (4 个角相同): 整片叶子一起变深浅, 而不是片内渐变。
      // 因为落叶是干枯的, 片内渐变的绿色会显得像"还活着"。
      cols[k * 3] = cr
      cols[k * 3 + 1] = cg
      cols[k * 3 + 2] = cb
    }
    // 索引: 两个三角形 (0,1,2) 与 (0,2,3), 与 corner/cornerUv 的下标顺序对应
    // 注意索引是**相对整块缓冲**的绝对下标, 所以基址要加 b = i*vPer
    const b = i * vPer
    const o = i * 6
    idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2
    idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3
  }

  /* ---------------- 组装几何 + 材质 ---------------- */
  // 四个属性都直接来自上面的 TypedArray, 没有拷贝 (BufferAttribute 直接持有同一个 ArrayBuffer)。
  // setIndex 用 BufferAttribute 包装 Uint32Array: 支持超过 65535 个顶点 (几百片叶子就会超)。
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))

  // 地面落叶用无光照着色器: 贴图颜色 × 顶点色 × 明暗系数,
  // 同时可选继承树叶/花朵的自发光、反光、散光。
  // 贴图三级降级见 leafTexture.resolveEffectTexture (自己的卡 -> 跟随树冠 -> 程序化椭圆)
  // 注意跟随模式下拿到的是**树冠材质那张 Texture 的引用**, 不是拷贝, 所以树冠换贴图时
  // 落叶会一起换 (但几何不会重建, 宽高比需要靠 litterRebuildKey 兜住)。
  const resolved = resolveEffectTexture({ cardId: L.cardId, followMap: map })
  // shade 默认 0.78: 落叶在地上本来就应该比树上的叶子暗一点 (腐化/积灰)
  const shade = L.shade === undefined ? 0.78 : L.shade
  // 为什么不用 MeshStandardMaterial: 落叶是"贴图 + 顶点色"的简单表面, 用 PBR 会
  // 带来不必要的开销, 而且无法精确复刻树冠材质的"边缘散射"观感。手写着色器的代价是
  // 光照参数得自己从 leafEffects 拷过来 —— 这就是下面 ...effectUniforms(params) 的用途。
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: resolved.map },
      // uAlphaTest 默认 0.35: 卡片的贴图 alpha 在边缘是羽化的, 阈值过高会把叶片削瘦,
      // 过低则会把贴图外围的半透明脏边也留下 (出现一圈方框影子)
      uAlphaTest: { value: L.alphaTest === undefined ? 0.35 : L.alphaTest },
      uShade: { value: shade },
      // 太阳方向与颜色是固定常量 (场景里没有昼夜系统), 只为继承光照分支提供 L 与光色
      uSunDir: { value: new THREE.Vector3(0.5, 1, 0.35).normalize() },
      uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
      ...effectUniforms(params),
    },
    vertexShader: LITTER_VERT,
    fragmentShader: LITTER_FRAG,
    // DoubleSide: 卡片单面几何, 从侧面看必须仍然可见 (落叶会被踢翻起来)
    side: THREE.DoubleSide,
    // 不透明 + 写深度: 落叶是实体, 半透明排序会带来大量 overdraw 与穿插错误
    transparent: false,
    depthWrite: true,
  })
  const mesh = new THREE.Mesh(geo, mat)
  // 接收阴影 (树上投下的影子会落在地上落叶上), 但自己不投射 —— 薄片投影收益极低
  // 而且会给阴影贴图增加大量细碎三角形, 得不偿失
  mesh.receiveShadow = true
  mesh.castShadow = false
  // 顶点在世界坐标里已经铺开几米, three.js 用几何包围球剔除不准 (且本就要常在视野内),
  // 直接关掉剔除省一次包围球计算
  mesh.frustumCulled = false
  mesh.visible = !!L.enabled
  return mesh
}
