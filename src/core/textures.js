/**
 * 程序化贴图 (无需任何外部资源, 打开即有树皮质感)
 * ------------------------------------------------------------
 * - makeBarkTextures(): 颜色图 + 法线图 + 粗糙度图 (由同一高度场派生)
 * - makeLeafTexture(): 叶脉细节 + 轮廓 alpha (配合 alphaTest 镂空)
 * 用户也可以在材质面板上传自己的贴图替换它们。
 *
 * 作用: 用纯 CPU 的噪声算法现算出树皮/树叶贴图, 让项目"零外部资源"即可跑起来。
 * 输入 / 输出:
 *   - makeBarkTextures({size,style,scale,contrast,seed,color,color2,bump})
 *       -> { map, normalMap, roughnessMap } | null (无 DOM 时)
 *   - makeLeafTexture({size,shape,seed,widthScale,veinColor}) -> { map } | null
 *   - loadTexture(url, opts) / disposeTexture(t) / setTextureRepeat(tex,u,v) —— 贴图通用工具
 * 与其他模块的关系:
 *   上游: state.params.bark / state.params.leaves 决定 style 与配色;
 *   下游: 生成的贴图交给 sceneManager 的材质 (map / normalMap / roughnessMap);
 *   贴图名与导出命名不在这里处理, 见 textureNaming.js。
 * 关键概念 / 约定:
 *   - 所有贴图都是正方形, 边长取 2 的幂 (默认 512 / 256), 便于生成 mipmap。
 *   - 树皮是**可平铺 (tileable)** 的: 采样坐标用的是 x/size 而不是像素坐标, 且
 *     valueNoise2D 的网格索引对 64 取模, 所以左右/上下边界天然无缝。
 *   - 颜色图是 sRGB; 法线图与粗糙度图是**数据贴图**, 必须保持线性 (NoColorSpace),
 *     否则法线会被当作颜色做 gamma 变换, 光照全错。
 *   - 随机源一律 mulberry32(mixSeed(seed, 标签)), 同一 seed 出同一张图。
 * 注意: 无 DOM (Node 自检) 时本模块全部返回 null, 调用方必须能接受"没有贴图"。
 */
import * as THREE from 'three'
import { mulberry32, mixSeed } from './rng.js'
import { LEAF_OUTLINES } from './leaf.js'

/** 建一张离屏 canvas 并设定尺寸 (Node 环境无 document, 由调用方先判空) */
function createCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * 平滑插值的 value noise (值噪声)。
 *
 * 做法: 预生成一个 64×64 的随机白噪声网格, 采样时对 4 个格点值做**双三次平滑插值**
 * (用 3t²-2t³ 代替线性 t)。平滑函数在 t=0/1 处的导数为 0, 所以格点边界上不会出现
 * 折线状的硬边 —— 这是树皮条纹看起来"连续"的关键。
 *
 * 网格索引对 64 取模 = **可平铺**: 超出 63 会绕回 0, 所以同一张噪声做成贴图后
 * 左右/上下边界严丝合缝, 平铺时看不到接缝。
 *
 * @param {number} seed 随机种子 (内部会混入 'vnoise' 标签)
 * @returns {(x:number, y:number) => number} 采样函数, 输入任意实数坐标 (单位为"格"), 返回 0..1
 */
function valueNoise2D(seed) {
  const G = 64
  const grid = new Float32Array(G * G)
  // mulberry32 是确定性 PRNG; mixSeed 把字符串标签混进种子, 避免不同用途撞到同一序列
  const rnd = mulberry32(mixSeed(seed, 'vnoise'))
  for (let i = 0; i < grid.length; i++) grid[i] = rnd()
  // 安全的模运算: JS 的 % 对负数返回负值, 加 G 再取模才是真正的循环索引
  const at = (x, y) => grid[(((y % G) + G) % G) * G + (((x % G) + G) % G)]
  return (x, y) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    // 平滑插值权重 (smoothstep): 两端导数为 0 -> 格点处无折痕
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    // 双线性混合 4 个角: 先在 x 方向插两次, 再在 y 方向插一次
    const a = at(xi, yi)
    const b = at(xi + 1, yi)
    const c = at(xi, yi + 1)
    const d = at(xi + 1, yi + 1)
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
  }
}

/**
 * 分形布朗运动 (fBm): 把同一张噪声按倍频叠加, 得到"大结构 + 细部纹理"的自然质感。
 *
 * 每一层 (octave): 频率 ×lacunarity, 振幅 ×gain。gain=0.5 是标准做法
 * (每层贡献减半, 收敛快且不产生明显的最细层噪点)。
 * 最后除以 norm 归一化到 0..1, 否则叠加后数值会接近 0..2, 后续对比度/色阶全乱。
 *
 * @param {(x:number,y:number)=>number} noise 基础噪声采样函数
 * @param {number} x 采样坐标 (单位为"格", 可任意缩放)
 * @param {number} y 采样坐标
 * @param {number} [octaves=4] 叠加层数 (越多越细, 越慢)
 * @param {number} [lacunarity=2] 每层频率倍数
 * @param {number} [gain=0.5] 每层振幅倍数
 * @returns {number} 0..1 的分形噪声值
 */
function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}

/** 把任意数值夹到 0..1 (写像素前的最后一道保险; 噪声/对比度运算可能越界) */
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * 树皮: 返回 { map, normalMap, roughnessMap } 或 null (无 DOM)
 *
 * 三张图**全部由同一张高度场 height[] 派生**, 所以颜色、凹凸、粗细必然对齐:
 *   height -> 颜色 (用 h 在 base..tip 之间插值) 、法线 (对 h 求梯度)、粗糙度 (h 越凹越粗)。
 * 一次循环算完 height + 颜色 + 粗糙度, 第二遍循环才算法线 (法线需要邻居像素)。
 *
 * @param {object} [o={}] 参数
 * @param {number} [o.size=512] 贴图边长 (像素, 建议 2 的幂)
 * @param {string} [o.style='rough'] 树皮风格: 'rough' | 'birch' | 'pine' | 'smooth'
 * @param {number} [o.scale=1] 纹理缩放 (越大条纹越密)
 * @param {number} [o.contrast=0.5] 对比度 0..1 (直接乘进高度场的动态范围)
 * @param {number} [o.seed=1] 随机种子 (决定条纹的走向与分布)
 * @param {string} [o.color='#6d5138'] 凹处 (低 h) 颜色
 * @param {string} [o.color2='#8d7053'] 凸处 (高 h) 颜色
 * @param {number} [o.bump=2.4] 法线强度 (内部再 ×3)
 * @returns {{map:THREE.CanvasTexture, normalMap:THREE.CanvasTexture, roughnessMap:THREE.CanvasTexture}|null}
 */
export function makeBarkTextures(o = {}) {
  if (typeof document === 'undefined') return null
  const size = o.size || 512
  const style = o.style || 'rough'
  const scale = o.scale === undefined ? 1 : o.scale
  const contrast = o.contrast === undefined ? 0.5 : o.contrast
  const seed = o.seed || 1
  const base = new THREE.Color(o.color || '#6d5138')
  const tip = new THREE.Color(o.color2 || '#8d7053')
  // 两张独立的噪声场: nA 负责主要的纵向条纹, nB 负责裂纹与细颗粒。
  // 用 seed 与 seed+977 两个不同的种子, 保证两张场互不相关 (否则纹理会出现"重影"周期感)。
  const nA = valueNoise2D(seed)
  const nB = valueNoise2D(seed + 977)

  const colorCanvas = createCanvas(size, size)
  const cctx = colorCanvas.getContext('2d')
  const cimg = cctx.createImageData(size, size)
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)

  // 白桦的皮孔比其它树种的条纹更细, 所以整体把纹理频率压到 0.8 倍
  const sx = scale * (style === 'birch' ? 0.8 : 1)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / size
      const fy = y / size
      // 纵向条纹 (沿树干方向拉长)
      // 频率 (26, 3.2): x 方向 26 个周期、y 方向只有 3.2 个 -> 纹路被拉成竖直的长条
      const ridges = fbm(nA, fx * 26 * sx, fy * 3.2 * sx, 4)
      // 横向裂纹: 频率反过来 (5, 34) -> 水平方向的横向裂口
      const cracks = fbm(nB, fx * 5 * sx, fy * 34 * sx, 3)
      // 细颗粒: 各向同性高频 (90,90), 放在最上层当"微观粗糙度"
      const grain = fbm(nB, fx * 90 * sx, fy * 90 * sx, 2)
      let h
      if (style === 'birch') {
        // 白桦: 整体基高 0.72 (亮), 起伏很小 -> 皮质细腻、颜色偏白
        h = 0.72 + (ridges - 0.5) * 0.35 + (grain - 0.5) * 0.12
        // 白桦的横向皮孔
        // sin(fy*34π) 给出 17 条横纹; pow(lent, 8) 把正弦削成"窄而深的刻痕" (只有峰值附近非零)
        const lent = Math.sin(fy * 34 * Math.PI + ridges * 6) * 0.5 + 0.5
        h -= Math.pow(lent, 8) * 0.45
      } else if (style === 'pine') {
        // 松树: 大块鳞片状龟裂。pow(plates,1.6) 让高值区更集中 -> 形成一块块凸起的鳞甲
        const plates = fbm(nA, fx * 12 * sx, fy * 7 * sx, 3)
        h = 0.35 + Math.pow(plates, 1.6) * 0.75
        // 再叠一层横向裂纹当鳞片之间的缝
        h += (cracks - 0.5) * 0.5
      } else if (style === 'smooth') {
        // 光滑树皮 (山毛榉/樱桃): 只留极弱的条纹与颗粒
        h = 0.5 + (ridges - 0.5) * 0.22 + (grain - 0.5) * 0.06
      } else {
        // rough
        // 粗糙树皮 (橡树/枫): 三个频段都吃进来, 纵向条纹占主导 (系数 0.85)
        h = 0.42 + (ridges - 0.5) * 0.85 + (cracks - 0.5) * 0.35 + (grain - 0.5) * 0.14
      }
      // 对比度: 以 0.5 为轴做线性拉伸。contrast=0.5 时系数为 1.4 (轻微加强),
      // contrast=0 时为 0.6 (压平), contrast=1 时为 2.2 (强烈凹凸)
      h = 0.5 + (h - 0.5) * (0.6 + contrast * 1.6)
      h = clamp01(h)
      const idx = y * size + x
      height[idx] = h
      // 粗糙度与高度反相关: 凹处(h 小)积灰/裂口更深 -> 更粗糙; 范围 0.55..1.0
      rough[idx] = clamp01(0.55 + (1 - h) * 0.45)

      // 颜色: 在 base(凹) .. tip(凸) 之间按 h 线性插值 -> 凸起处被"磨亮"
      const ci = idx * 4
      cimg.data[ci] = Math.round(clamp01(base.r + (tip.r - base.r) * h) * 255)
      cimg.data[ci + 1] = Math.round(clamp01(base.g + (tip.g - base.g) * h) * 255)
      cimg.data[ci + 2] = Math.round(clamp01(base.b + (tip.b - base.b) * h) * 255)
      cimg.data[ci + 3] = 255
    }
  }
  cctx.putImageData(cimg, 0, 0)

  // --- 由高度场派生法线图 ---
  // 用中心差分求梯度: dx = H(x+1) - H(x-1), 相当于 ∂h/∂x 的两倍步长;
  // 法线 = normalize(-dx, -dy, 1) —— 负号是因为高度上升的方向, 法线要往"下坡"倾斜。
  // 这样算出的法线图是**切线空间**的 (z 朝外), 与 three.js 的 normalMap 约定一致。
  const normalCanvas = createCanvas(size, size)
  const nctx = normalCanvas.getContext('2d')
  const nimg = nctx.createImageData(size, size)
  // strength: 用户给的 bump 乘 3.0 放大到"肉眼可辨"的量级 (高度场本身只有 0..1 的动态范围)
  const strength = o.bump === undefined ? 2.4 : o.bump * 3.0
  // H() 的取模是**环绕采样**: 取 x-1 / x+1 时边界会绕到对侧,
  // 于是法线图同样可平铺, 平铺接缝处不会出现一条"突边"。
  const H = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength
      let nx = -dx
      let ny = -dy
      let nz = 1
      const l = Math.hypot(nx, ny, nz)
      nx /= l; ny /= l; nz /= l
      const i = (y * size + x) * 4
      // 法线编码: 分量范围 -1..1 映射到 0..255 (n*0.5+0.5)。这是标准的切线空间法线编码,
      // 读图时必须用线性色彩空间 (NoColorSpace), 否则 sRGB 解码会把法线方向扭歪。
      nimg.data[i] = Math.round((nx * 0.5 + 0.5) * 255)
      nimg.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      nimg.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      nimg.data[i + 3] = 255
    }
  }
  nctx.putImageData(nimg, 0, 0)

  // --- 粗糙度图 ---
  // 存成灰度 (RGB 三通道同值), 因为 three.js 的 roughnessMap 只读 G 通道,
  // 但三通道同值便于在外部工具里直接肉眼看这张图。
  const roughCanvas = createCanvas(size, size)
  const rctx = roughCanvas.getContext('2d')
  const rimg = rctx.createImageData(size, size)
  for (let i = 0; i < rough.length; i++) {
    const v = Math.round(clamp01(rough[i]) * 255)
    rimg.data[i * 4] = v
    rimg.data[i * 4 + 1] = v
    rimg.data[i * 4 + 2] = v
    rimg.data[i * 4 + 3] = 255
  }
  rctx.putImageData(rimg, 0, 0)

  // 打包成 three.js 贴图。
  // 色彩空间约定 (非常重要):
  //   - map        是**颜色**, 必须标 SRGBColorSpace, 否则渲染出来会偏亮/发灰;
  //   - normalMap / roughnessMap 是**数据**, 保持默认的 NoColorSpace (线性),
  //     一旦被当成 sRGB 解码, 法线与粗糙度数值都会错。
  // RepeatWrapping: 树皮要沿树干方向重复很多次, 且噪声本身可平铺, 所以用重复而不是夹边。
  const map = new THREE.CanvasTexture(colorCanvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  const normalMap = new THREE.CanvasTexture(normalCanvas)
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
  const roughnessMap = new THREE.CanvasTexture(roughCanvas)
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping
  return { map, normalMap, roughnessMap }
}

/**
 * 树叶贴图: 浅色细节 (叶脉/斑点) + 轮廓 alpha
 *
 * 与"照片级叶卡"的区别: 这里画的是**程序化叶形**, alpha 由 LEAF_OUTLINES 的轮廓
 * 直接算出 (与 leaf.js 的几何轮廓同源), 所以贴图边缘和几何边缘严丝合缝。
 * 颜色刻意做成"浅色细节" (接近灰白 + 淡绿脉络): 真正的绿色由材质 color 与顶点色提供,
 * 这样一张贴图可以配任意树叶颜色。
 *
 * 画法 (逐像素光栅化, 不是矢量绘制):
 *   1. 把画布坐标映射到 (u, tv): u 横向 0..1, tv 纵向 0..1 且 **v=0 在底部**;
 *   2. 用 shape(tv) 求该行的半宽 hw, |u-0.5| > hw 的像素 alpha=0 (镂空);
 *   3. 内部像素: 基础明度 + fbm 斑点 -> 叠中脉与侧脉 -> 边缘羽化 alpha。
 *
 * @param {object} [o={}] 参数
 * @param {number} [o.size=256] 贴图边长 (像素)
 * @param {string} [o.shape='oval'] 叶形键名, 见 leaf.js 的 LEAF_OUTLINES
 * @param {number} [o.seed=7] 随机种子 (决定斑点分布)
 * @param {number} [o.widthScale=0.88] 轮廓横向缩放 (0.88 让叶片两侧留 6% 余量, 防羽化被裁掉)
 * @param {string} [o.veinColor='#b9c6a4'] 叶脉颜色 (淡黄绿)
 * @returns {{map:THREE.CanvasTexture}|null} 无 DOM 时返回 null
 */
export function makeLeafTexture(o = {}) {
  if (typeof document === 'undefined') return null
  const size = o.size || 256
  const shape = LEAF_OUTLINES[o.shape] || LEAF_OUTLINES.oval
  const seed = o.seed || 7
  const widthScale = o.widthScale === undefined ? 0.88 : o.widthScale
  const nA = valueNoise2D(seed + 31)
  const veinColor = o.veinColor || '#b9c6a4'
  const vein = new THREE.Color(veinColor)

  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(size, size)
  const grid = new Float32Array(size * size)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / (size - 1)
      const tv = 1 - py / (size - 1) // v=0 (叶柄) 在画布底部
      // hw = 该行的半宽; 1e-4 的容差是为了让"恰好落在边界上"的像素算作内部,
      // 否则最外圈会因为浮点误差整行丢失 (细长叶片的叶尖会缺一小块)。
      const hw = shape(tv) * widthScale
      const dx = u - 0.5
      const inside = Math.abs(dx) <= hw + 1e-4
      const idx = py * size + px
      if (!inside) {
        // 轮廓外: 只写 alpha=0, RGB 保持 0 —— 配合材质的 alphaTest 直接裁掉
        img.data[idx * 4 + 3] = 0
        continue
      }
      // 边缘羽化
      // edge 在"距边缘 hw*0.25 的带内"从 1 线性降到 0, 得到 1~2 像素的软过渡。
      // max(0.004, ...) 防除零: 叶尖处 hw 接近 0, 不兜住会算出 Infinity。
      const edge = clamp01((hw - Math.abs(dx)) / Math.max(0.004, hw * 0.25))
      // 斑点: 高频 fbm 做"叶面明暗不均", 振幅 0.28 保证不会盖过叶脉
      const speck = fbm(nA, u * 18, tv * 18, 3)
      let shade = 0.86 + (speck - 0.5) * 0.28
      grid[idx] = shade
      // 中脉
      // 高斯型脊线: dx 归一化到 0.012 宽度后平方取负指数 -> 中心亮、两侧迅速衰减
      const mid = Math.exp(-Math.pow(dx / 0.012, 2))
      // 侧脉
      // veinT: 沿叶轴每 1/9 一段做三角波 (0..1 往复), 得到一串等距的侧脉"周期";
      // 再与"当前像素到中脉的归一化距离"比较, 相近处即侧脉位置。
      // 乘 (1-mid) 是为了避免侧脉覆盖中脉 (中脉优先)。
      const veinT = Math.abs(((tv * 9) % 1) - 0.5) * 2
      const sideVein = Math.exp(-Math.pow((veinT - Math.abs(dx) / Math.max(0.02, hw)) * 6, 2)) * (1 - mid)
      // 混合权重: 中脉权重 0.85 (明显), 侧脉 0.25 (隐约可见)
      const veinMix = clamp01(mid * 0.85 + sideVein * 0.25)
      // 颜色 = shade 与 vein 色按权重混合; shade 是标量, 所以贴图本身是"淡灰绿"的中性细节
      const r = shade + (vein.r - shade) * veinMix
      const g = shade + (vein.g - shade) * veinMix
      const b = shade + (vein.b - shade) * veinMix
      img.data[idx * 4] = Math.round(clamp01(r) * 255)
      img.data[idx * 4 + 1] = Math.round(clamp01(g) * 255)
      img.data[idx * 4 + 2] = Math.round(clamp01(b) * 255)
      img.data[idx * 4 + 3] = Math.round(255 * edge)
    }
  }
  ctx.putImageData(img, 0, 0)
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping
  map.anisotropy = 4
  return { map }
}

/**
 * 修复花卡贴图的 alpha 蒙版：
 * 素材是从白底抠图生成的，白色花瓣内部经常会残留“封闭透明洞”（alpha=0 但被花瓣包住），
 * alphaTest 裁切后这些洞会露出黑色背景，看起来就是花瓣黑边/黑斑。
 * 这里做两件事（只在加载花卡时执行一次）：
 *  1. 从图像边缘洪水填充，保留真正的外部透明区域；
 *  2. 把不与边缘连通的透明洞填成不透明，并把 RGB 从最近的可见像素扩散过去，
 *     同时给外部透明区做颜色扩散，避免 mipmap/线性过滤把黑底混进花瓣边缘。
 */
function repairCardAlpha(image) {
  if (typeof document === 'undefined' || !image) return null
  const w = image.width || image.naturalWidth
  const h = image.height || image.naturalHeight
  if (!w || !h) return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0)
  let img
  try {
    img = ctx.getImageData(0, 0, w, h)
  } catch (e) {
    return null
  }
  const data = img.data
  const n = w * h
  // 二值化 alpha: >8 视为"可见"。不用 >0 是因为抠图边缘常残留 alpha=1..3 的杂点,
  // 那些其实是背景噪声, 当成不透明会让花瓣外轮廓毛糙一圈。
  const opaque = new Uint8Array(n)
  let transparent = 0
  let visible = 0
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3]
    if (a > 8) {
      opaque[i] = 1
      visible++
    } else {
      transparent++
    }
  }
  // 全不透明 (没有需要修的东西) 或全透明 (图是空的) 都没得修, 直接放弃
  if (!transparent || !visible) return null

  // 1) 从边缘向内找“真正的外部透明区”
  // 用**显式数组当队列 + head/tail 指针**做 BFS, 而不是 shift() 或 Array 栈:
  // shift() 是 O(n), 几十万像素会退化成 O(n²)。
  // 队列容量 n 是上界 (每个像素最多入队一次), 一次分配就够。
  const outside = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  const pushIfTransparent = (i) => {
    if (!opaque[i] && !outside[i]) {
      outside[i] = 1
      queue[tail++] = i
    }
  }
  for (let x = 0; x < w; x++) {
    pushIfTransparent(x)
    pushIfTransparent((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    pushIfTransparent(y * w)
    pushIfTransparent(y * w + w - 1)
  }
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i / w) | 0
    if (x > 0) pushIfTransparent(i - 1)
    if (x + 1 < w) pushIfTransparent(i + 1)
    if (y > 0) pushIfTransparent(i - w)
    if (y + 1 < h) pushIfTransparent(i + w)
  }

  // 2) RGB 从最近的不透明像素扩散到所有透明像素（颜色扩散/alpha bleeding）
  // 多源 BFS: 把所有不透明像素一次性作为起点入队, 然后逐层向外扩散。
  // 这样每个透明像素拿到的颜色来自"离它最近的不透明像素", 而不是黑色 (0,0,0)。
  // 为什么必须做: 纹理过滤/mipmap 会把 0,0,0 的透明像素颜色混进边缘, 产生黑边。
  const filled = new Uint8Array(n)
  head = 0
  tail = 0
  for (let i = 0; i < n; i++) {
    if (opaque[i]) {
      filled[i] = 1
      queue[tail++] = i
    }
  }
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i / w) | 0
    const neighbors = [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1]
    for (const j of neighbors) {
      if (j < 0 || filled[j]) continue
      filled[j] = 1
      data[j * 4] = data[i * 4]
      data[j * 4 + 1] = data[i * 4 + 1]
      data[j * 4 + 2] = data[i * 4 + 2]
      queue[tail++] = j
    }
  }

  // 3) 不与边缘连通的透明区域 = 花瓣内部的洞 -> 变成不透明
  // 判定依据: outside 只标记"能从画布边缘连通到"的透明像素, 所以
  // 「透明 且 非 outside」= 被花瓣包围的封闭洞 —— 抠图残留的白底就在这里。
  let repaired = 0
  for (let i = 0; i < n; i++) {
    if (!opaque[i] && !outside[i]) {
      data[i * 4 + 3] = 255
      repaired++
    }
  }
  if (!repaired) {
    // 没有内部洞也仍然用颜色扩散后的 canvas，消除 mipmap 黑边
    if (transparent > 0) {
      ctx.putImageData(img, 0, 0)
      return canvas
    }
    return null
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/**
 * 自动检测贴图能否直接平铺, 并在需要时生成"无缝版本" (树皮用)。
 *
 * 为什么需要: 内置照片树皮大多不是无缝素材 (左右/上下边缘的颜色对不上),
 * 一旦用 RepeatWrapping 平铺, 树干上就会出现硬接缝; 分辨率越低越明显。
 *
 * 做法:
 *   1. **自动检测 (按方向)**: 把图缩到 ≤96px, 分别比较"左/右边缘列"与"上/下边缘行"
 *      的平均色差, 再和图中部的相邻列/行色差 (当作噪声基线) 比较。
 *      边缘差明显高于基线 = 该方向不无缝; 两个方向都是无缝的图完全不动。
 *   2. **智能羽化**: 只修有缝的方向, 过渡带宽度按"接缝失配 / 内部噪声"的比值自适应
 *      (5%~16%, 最多不超过半幅): 失配越大带越宽, 颜色变化摊得越开, 不会留下明显的
 *      涂抹条。带内权重用 smootherstep, 两端一阶/二阶导为 0, 带与正常区域之间没有折线。
 *      中间内容完全不动, 做完后左=右、上=下, 平铺时颜色连续、无硬接缝。
 *
 * 无法读取像素 (跨域污染画布 / 未解码) 时返回 null, 调用方保持原图。
 *
 * @param {HTMLImageElement|HTMLCanvasElement} image 已加载完成的贴图源
 * @returns {HTMLCanvasElement|null} 无缝画布; 无需修复或无法处理时返回 null
 */
function makeSeamlessCanvas(image) {
  if (typeof document === 'undefined' || !image) return null
  const w = image.width || image.naturalWidth || 0
  const h = image.height || image.naturalHeight || 0
  if (w < 4 || h < 4) return null
  try {
    /* ---------- ① 缩略检测 ---------- */
    const S = 96
    const k = Math.min(1, S / Math.max(w, h))
    const dw = Math.max(8, Math.round(w * k))
    const dh = Math.max(8, Math.round(h * k))
    const probe = document.createElement('canvas')
    probe.width = dw
    probe.height = dh
    const pctx = probe.getContext('2d', { willReadFrequently: true })
    pctx.drawImage(image, 0, 0, dw, dh)
    const d = pctx.getImageData(0, 0, dw, dh).data
    const diffCol = (x1, x2) => {
      let s = 0
      for (let y = 0; y < dh; y++) {
        const a = (y * dw + x1) * 4
        const b = (y * dw + x2) * 4
        s += Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2])
      }
      return s / (dh * 3)
    }
    const diffRow = (y1, y2) => {
      let s = 0
      for (let x = 0; x < dw; x++) {
        const a = (y1 * dw + x) * 4
        const b = (y2 * dw + x) * 4
        s += Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2])
      }
      return s / (dw * 3)
    }
    const qx = Math.round(dw / 4)
    const qy = Math.round(dh / 4)
    const mx = Math.floor(dw / 2)
    const my = Math.floor(dh / 2)
    // 水平/垂直两个方向分别判断: 只修真正有缝的那个方向, 不留无谓的细节损失
    const edgeX = diffCol(0, dw - 1)
    const edgeY = diffRow(0, dh - 1)
    // 基线取三条内部相邻列/行差的均值: 单看中间一列可能刚好落在裂纹上, 造成误判
    const innerX = (diffCol(qx, qx + 1) + diffCol(mx, mx + 1) + diffCol(dw - 1 - qx, dw - qx)) / 3
    const innerY = (diffRow(qy, qy + 1) + diffRow(my, my + 1) + diffRow(dh - 1 - qy, dh - qy)) / 3
    // 判据: 边缘失配既要"相对内部噪声明显"(×1.25), 又要"绝对值有意义"(+2)。
    // 只写 ×1.5+4 会漏掉中等程度的接缝 (实测照片树皮 X 方向 45.8 vs 基线 29.6 被判为无缝,
    // 平铺后仍有一条横向硬边); 只写比值又会在本来就高噪的图上误判。
    const seamX = edgeX > innerX * 1.25 + 2
    const seamY = edgeY > innerY * 1.25 + 2
    if (!seamX && !seamY) return null

    /* ---------- ② 自适应羽化无缝化 (中间像素不动) ----------
     * 过渡带宽度不写死: 接缝失配 / 内部噪声 的比值越大, 带越宽 (5%~16%),
     * 这样颜色变化摊得更开, 不会在窄带上形成一条可见的"涂抹条"。
     * 权重用 smootherstep, 两端一阶/二阶导都为 0, 所以带的两头没有硬折线。
     */
    const bandRatio = (edge, inner) => {
      const ratio = edge / Math.max(1, inner)
      return Math.min(0.16, Math.max(0.05, 0.05 + (ratio - 1) * 0.05))
    }
    const feather = (t) => t * t * t * (t * (t * 6 - 15) + 10)
    const bandX = seamX
      ? Math.max(1, Math.min(Math.round(w * bandRatio(edgeX, innerX)), Math.floor((w - 2) / 2)))
      : 0
    const bandY = seamY
      ? Math.max(1, Math.min(Math.round(h * bandRatio(edgeY, innerY)), Math.floor((h - 2) / 2)))
      : 0

    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const cx = cv.getContext('2d', { willReadFrequently: true })
    cx.drawImage(image, 0, 0)
    const id = cx.getImageData(0, 0, w, h)
    const data = id.data
    // 水平: 每一行的左/右边缘都羽化到该行两端的平均值 -> 左边缘 = 右边缘
    if (bandX > 0) {
      for (let y = 0; y < h; y++) {
        const li = (y * w) * 4
        const ri = (y * w + w - 1) * 4
        // 先记下边缘原值: 下面 i=0 时会把边缘本身改掉, 后续像素必须以原值为基准
        const lr = data[li], lg = data[li + 1], lb = data[li + 2]
        const rr = data[ri], rg = data[ri + 1], rb = data[ri + 2]
        const tr = (lr + rr) / 2
        const tg = (lg + rg) / 2
        const tb = (lb + rb) / 2
        for (let i = 0; i < bandX; i++) {
          const t = feather(1 - i / bandX)
          const l = (y * w + i) * 4
          const r = (y * w + w - 1 - i) * 4
          data[l] += (tr - lr) * t
          data[l + 1] += (tg - lg) * t
          data[l + 2] += (tb - lb) * t
          data[r] += (tr - rr) * t
          data[r + 1] += (tg - rg) * t
          data[r + 2] += (tb - rb) * t
        }
      }
    }
    // 垂直: 同理把上/下边缘羽化到每列两端的平均值。水平已经让上下两行的左右端相等,
    // 所以这里左列与右列得到的目标值相同, 不会破坏水平方向的无缝性。
    if (bandY > 0) {
      for (let x = 0; x < w; x++) {
        const ti = x * 4
        const bi = ((h - 1) * w + x) * 4
        const tr0 = data[ti], tg0 = data[ti + 1], tb0 = data[ti + 2]
        const br0 = data[bi], bg0 = data[bi + 1], bb0 = data[bi + 2]
        const tr = (tr0 + br0) / 2
        const tg = (tg0 + bg0) / 2
        const tb = (tb0 + bb0) / 2
        for (let i = 0; i < bandY; i++) {
          const t = feather(1 - i / bandY)
          const u = (i * w + x) * 4
          const b = ((h - 1 - i) * w + x) * 4
          data[u] += (tr - tr0) * t
          data[u + 1] += (tg - tg0) * t
          data[u + 2] += (tb - tb0) * t
          data[b] += (tr - br0) * t
          data[b + 1] += (tg - bg0) * t
          data[b + 2] += (tb - bb0) * t
        }
      }
    }
    cx.putImageData(id, 0, 0)
    return cv
  } catch (e) {
    // 跨域画布无法 getImageData 等情况: 保持原图交给调用方
    return null
  }
}

/** 从 image URL / dataURL 载入贴图 (onError: 404/坏图时回调, 用于降级) */
// 说明: 返回值是**立刻**可用的 Texture 对象 (此时可能还没有像素), three.js 会在加载完成后
// 自动上传, 所以调用方不必等 onLoad 再建材质; 失败时只打一个 userData.loadFailed 标记。
// opts:
//   clamp     true = ClampToEdge (单张卡/整块面), 否则 RepeatWrapping (可平铺材质)
//   srgb      false 时不做 sRGB 解码 (法线/粗糙度这类数据贴图要传 false 或 normal:true)
//   normal    true 时强制 NoColorSpace (法线贴图专用, 优先级高于 srgb)
//   repairAlpha  true 时在加载完成后跑一遍 repairCardAlpha (花卡去黑洞/去黑边)
//   autoSeamless true 时自动检测平铺接缝, 非无缝图会在加载后转成无缝画布 (照片树皮)
//   onError   加载失败回调 (参数为 url), 用于把卡片标记成不可用并回退
export function loadTexture(url, opts = {}) {
  const tex = new THREE.TextureLoader().load(
    url,
    (loaded) => {
      if (opts.autoSeamless && loaded && loaded.image) {
        const fixed = makeSeamlessCanvas(loaded.image)
        if (fixed) {
          loaded.image = fixed
          loaded.needsUpdate = true
        }
      }
      if (opts.repairAlpha && loaded && loaded.image) {
        const fixed = repairCardAlpha(loaded.image)
        if (fixed) {
          loaded.image = fixed
          loaded.needsUpdate = true
        }
      }
    },
    undefined,
    () => { tex.userData.loadFailed = true; if (opts.onError) opts.onError(url) },
  )
  tex.wrapS = tex.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace
  tex.colorSpace = opts.normal ? THREE.NoColorSpace : tex.colorSpace
  tex.anisotropy = 8
  return tex
}

/** 释放一张贴图的 GPU 资源; 传 null/undefined 也安全 (幂等, 便于清理代码直接调用) */
export function disposeTexture(t) {
  if (t && t.dispose) t.dispose()
}

/**
 * 设置贴图的平铺重复次数 (u, v)。
 *
 * 传 0/undefined 会被替换成 1 —— 0 会让 UV 全塌到一个点, 是典型的"改完树皮变纯色"故障源。
 * needsUpdate 在改 repeat 时不是必须的 (它是 uniform 更新), 但保留它可以让贴图的
 * matrix 在本帧就刷新, 避免极端情况下的延迟一帧。
 *
 * @param {THREE.Texture|null} tex 目标贴图
 * @param {number} u 横向重复次数 (1 = 不重复)
 * @param {number} v 纵向重复次数
 */
export function setTextureRepeat(tex, u, v) {
  if (!tex) return
  tex.repeat.set(u || 1, v || 1)
  tex.needsUpdate = true
}
