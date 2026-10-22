/**
 * 叶片: 形状模板 + 实例化写入
 * ------------------------------------------------------------
 * 模板在单位空间生成 (长度 1, 沿 +Y, 法线朝 +Z), 每片叶子通过
 * 正交基 + 非等比缩放变换到世界空间, 顶点颜色烘焙"叶基->叶尖"渐变。
 *
 * 叶片几何直接写入主 acc, 所以整棵树最终只有 2 个 draw call:
 * 树皮 1 个 + 树叶 1 个。
 *
 * 作用: 提供两种叶片模板 (程序化轮廓 / 贴图卡片), 以及把模板实例化进累加器的函数。
 * 输入 / 输出:
 *   - LEAF_OUTLINES[t](t) -> 半宽 (0..0.5); t 是沿叶轴的归一化位置 (0=叶柄, 1=叶尖)
 *   - buildLeafTemplate(o) / buildLeafCardTemplate(o) -> 模板缓冲 (positions/normals/uvs/index/vertexCount)
 *   - pushLeafInstance(acc, tmpl, basis, scale, pos, ...) -> void (写 acc)
 * 与其他模块的关系:
 *   上: treeStore 的 state.params.leaves (shape / width / curl / fold / 颜色) 决定入参;
 *   本文件也被 textures.js 引用 (用 LEAF_OUTLINES 画叶脉贴图的轮廓 alpha);
 *   下: sceneManager 在「长叶」阶段调用 pushLeafInstance, 结果与树皮合成两个几何体。
 * 关键概念 / 约定:
 *   - **单位空间**: 叶长恒为 1 (沿 +Y), 宽度由 aspect/leaves.width 决定, 单位一律是"米"前的比例;
 *     实例化时乘 scale 才变成真实尺寸。
 *   - **UV**: u 横跨叶片 (0=左缘, 1=右缘), v 沿叶轴 (0=叶柄, 1=叶尖), 与贴图方向一致。
 *   - **顶点属性布局** (acc.vertex 的参数顺序, 全项目统一):
 *       position(3) normal(3) uv(2) color(3) aWind aPhase aOrigin(3) aGrow0 aGrow1 aNodeId
 *     aWind/aPhase 驱动风场摆动; aOrigin 是叶柄基点的世界坐标 (摆动时以它为支点);
 *     aGrow0/aGrow1 是生长动画的起止阈值; aNodeId 用于选中时高亮整枝条。
 * 注意: 叶片只有单面几何, 靠材质的 side=DoubleSide + 法线翻转来两面受光;
 *       所以模板里不需要背面顶点 (省一半显存)。
 */
import * as THREE from 'three'

/** 形状轮廓: 返回 t (0=叶柄, 1=叶尖) 处的半宽
 *  约定: 所有形状归一到 0..0.5, 叶片粗细由 leaves.width 控制
 *  注: 不同树种的叶形差别很大 (参考图), 这里为每个树种群准备独立轮廓 */
// 统一公式骨架: base = sin(π·t^p)^q —— 两端收成 0、中部鼓起, p 控制最宽点的位置
// (p>1 -> 最宽处向叶尖移), q 控制胖瘦 (q 越小越接近矩形/针形)。
// 所有函数都必须返回 0..0.5 区间内的值, 否则渲染出来的叶片会超出预期宽度。
export const LEAF_OUTLINES = {
  // 卵形 (多数阔叶树): 最宽处略偏下, 中等胖瘦
  oval: (t) => Math.pow(Math.sin(Math.PI * t), 0.62) * 0.5,
  // 桦树叶: 三角状卵形, t^0.92 把最宽点稍稍推向叶尖
  birch: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.92)), 0.72) * 0.5,
  // 披针形 (柳): 窄长, 上限 0.48 让它比 oval 更瘦
  lance: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 1.05)), 0.5) * 0.48,
  // 针叶: q=0.34 -> 几乎等宽, 只有两端收尖; 0.42 是针叶束的显式宽度上限
  needle: (t) => Math.pow(Math.sin(Math.PI * t), 0.34) * 0.42,
  // 枫叶 (简化版): 6 个余弦起伏模拟裂片
  maple: (t) => {
    const base = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.15)), 0.55)
    // lobes = 0.82 + 0.18·cos(6πt): 沿叶轴产生 3 个完整的鼓/凹周期
    const lobes = 0.82 + 0.18 * Math.cos(t * Math.PI * 6)
    return base * lobes * 0.5
  },
  /** 橡树叶: 掌状 5 尖裂叶 (对齐用户提供的叶片卡片: 尖裂片 + 凹缺深 + 明显叶柄) */
  oak: (t) => {
    // 叶柄段 (前 12%) 只有细中脉
    if (t < 0.12) return 0.012
    // u: 把叶片主体重新归一化到 0..1 (0.12..1 映射成 0..1), 后面的公式只管主体
    const u = (t - 0.12) / 0.88
    // 整体轮廓: 中部最宽, 两端收窄 (掌状叶接近心形/卵形)
    const body = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.82)), 0.5)
    // 5 个尖裂片: 用"尖齿"函数叠加, 凹缺 (sinus) 很深
    // phase 把叶片主体切成 5 段; f = |sin(π(phase+0.5))| 在裂片中心为 0、在凹缺处为 1
    const teeth = 5
    const phase = u * teeth
    const f = Math.abs(Math.sin(Math.PI * (phase + 0.5)))       // 0..1, 裂片中心=0
    // lobe: 凹缺处最多收到 58% (1-0.42), 指数 1.6 让凹缺底部更窄、看起来更"尖"
    const lobe = 1 - 0.42 * Math.pow(f, 1.6)                    // 凹缺最多收 42%
    // 基部两片裂片略小, 顶端裂片收尖
    // 0.72 之后线性收窄 (斜率 1.6), 到 t=1 时衰减到 1-0.448≈0.55, 再被 max(0.05,·) 兜住不被削没
    const tipTaper = u < 0.72 ? 1 : 1 - (u - 0.72) * 1.6
    // max(0.01, ...) 防负数: 极端 t 下 tipTaper 可能变负, 负半宽会让三角形翻面
    return Math.max(0.01, body * lobe * Math.max(0.05, tipTaper)) * 0.5
  },
  /** 枫叶: 掌状 5 裂 */
  palmate: (t) => {
    const base = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.2)), 0.5)
    // cos(10πt) = 5 个周期 -> 5 个裂片; 振幅 0.3 比 maple 更大, 裂得更深
    const lobes = 0.7 + 0.3 * Math.cos(t * Math.PI * 10)
    return base * lobes * 0.5
  },
  /** 针叶束: 细长且几乎等宽 */
  needleLong: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.22) * 0.4,
  /** 心形叶 (椴/杨) */
  cordate: (t) => {
    const s = Math.sin(Math.PI * Math.pow(t, 0.8))
    // 0.82 + 0.18·cos(2πt): 一个完整周期的横向起伏 -> 基部(叶柄侧)相对更饱满的心形
    return (Math.pow(s, 0.5) * (0.82 + 0.18 * Math.cos(Math.PI * 2 * t))) * 0.5
  },
  /** 落叶: 干燥卷曲的残叶 (边缘不规则) */
  litter: (t) => {
    const base = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.05)), 0.6)
    // cos(7πt + 1.3): 高频小起伏 = 干枯叶缘的锯齿感; 相位 1.3 打散对称性
    const dry = 0.86 + 0.14 * Math.cos(t * Math.PI * 7 + 1.3)
    return base * dry * 0.5
  },
  /** 圆叶 (round): 近圆形叶片, 中部最宽, 上下端圆润收口 */
  round: (t) => {
    // 额外套一层 max(0, ·): sin 在 t>1 时会变负, 保证不会出现负半宽
    const base = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.55)
    // 叶尖 0.82 之后二次收口 (平方曲线 -> 边缘是圆的, 不是尖的)
    const tip = t > 0.82 ? 1 - 0.32 * Math.pow((t - 0.82) / 0.18, 2) : 1
    // widen: 让最宽处出现在 t≈0.43 (1/1.15 的位置), 而不是几何正中
    const widen = 0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, t * 1.15))
    return base * tip * widen * 0.98
  },
}

/** 全部可用叶形键名 (与 UI 下拉框选项一一对应, 顺序即 Object.keys 的插入顺序) */
export const LEAF_SHAPE_KEYS = Object.keys(LEAF_OUTLINES)

/**
 * 叶片"卡片"模板 (默认叶形)
 * ------------------------------------------------------------
 * 用户的叶片贴图已经按 alpha 裁掉透明边, 所以贴图矩形 = 叶片轮廓。
 * 用它做几何: 一个 (cols × rows) 的网格矩形, UV 直接铺满贴图,
 * 叶形完全由贴图 alpha 决定 (alphaTest 裁掉透明区) —— 这才是"照片级叶片"的正确做法。
 * @param {{aspect:number, segments:number, curl:number, fold:number, petiole:number}} o
 *        aspect = 裁剪后 宽/高; 长度归一为 1, 宽度 = aspect (再由 leaves.width 缩放)
 *
 * 与 buildLeafTemplate 的区别: 这里不做轮廓计算, 只生成一张"稍微弯曲的矩形网片";
 * 轮廓交给贴图的 alpha。网格是为了让弯曲(bow)有足够细分, 而不是为了轮廓精度。
 */
export function buildLeafCardTemplate(o = {}) {
  // aspect 夹在 0.15..3: 超出这个范围说明贴图量错了 (或用户传了坏值),
  // 不夹的话叶片会被拉成一根针或一块砖。
  const aspect = Math.max(0.15, Math.min(3, o.aspect || 1))
  const cols = Math.max(1, Math.round(o.cols || 1))
  // rows 上限 4: 卡片只需要"能弯"就够了, 再细分纯属浪费顶点 (每棵树几千片叶子)
  const rows = Math.max(2, Math.min(4, Math.round(o.rows || 3)))
  const curl = o.curl === undefined ? 0.1 : o.curl
  const fold = o.fold === undefined ? 0.12 : o.fold
  const halfW = 0.5 * aspect

  const positions = []
  const normals = []
  const uvs = []
  const index = []
  // 规则网格: (rows+1) × (cols+1) 个顶点, t 沿 +Y (叶柄->叶尖), u 沿 +X (左->右)
  for (let i = 0; i <= rows; i++) {
    const t = i / rows
    for (let j = 0; j <= cols; j++) {
      const u = j / cols
      const x = (u - 0.5) * 2 * halfW
      const y = t
      // 轻微弓弯/折叠: 让卡片不是纯平面 (受光更自然)
      // 两项叠加: curl·sin(πt) 是纵向弓背 (中段凸起, 两端贴回 0);
      // fold·|u-0.5|·2·halfW 是横向 V 折 (靠边越高, 中间是折痕) —— 乘 halfW 使折角与宽度无关。
      const z = curl * Math.sin(Math.PI * t) + fold * Math.abs(u - 0.5) * 2 * halfW
      positions.push(x, y, z)
      // 法线先给常量 +Z, 由调用方按需 computeVertexNormals (推进 acc 时只用原始法线)
      normals.push(0, 0, 1)
      uvs.push(u, t)
    }
  }
  // 每个格子两个三角形; 绕序 (a,b,d) / (a,d,c) 保证正面朝 +Z (与法线一致)
  const stride = cols + 1
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * stride + j
      const b = a + 1
      const c = a + stride
      const d = c + 1
      index.push(a, b, d)
      index.push(a, d, c)
    }
  }
  return { positions, normals, uvs, index, vertexCount: positions.length / 3 }
}

/**
 * 叶片几何工具
 * ------------------------------------------------------------
 * 用旋转体 (funnel) 网格代替平面卡片: 轴向 Y 从 0(花梗) 到 1(花口),
 * 半径由 LEAF_OUTLINES[shape] 给出, 口沿再叠加 5 瓣起伏。
 * 顶点数可控 (rings × radial), 默认 4×8 = 32 顶点 / 48 三角形。
 * @returns {{positions:number[], normals:number[], uvs:number[], index:number[], vertexCount:number, is3d:boolean}}
 *
 * 实际做法是「条带 (strip)」而不是真正的旋转体: 每圈只有左右两个顶点 (2·(rows+1) 个),
 * 三角形数 2·rows。这样一片叶子只有几十个顶点, 几万片叶子才吃得消。
 */
export function buildLeafTemplate(o = {}) {
  // shape 缺失/拼错时静默回退 oval —— 宁可形状不对也不要抛错中断整棵树的生成
  const shape = LEAF_OUTLINES[o.shape] || LEAF_OUTLINES.oval
  const rows = Math.max(2, Math.round(o.segments || 5))
  const curl = o.curl === undefined ? 0.18 : o.curl // 纵向弯曲 (单位空间, 会被 size 缩放)
  const fold = o.fold === undefined ? 0.28 : o.fold // 横向 V 形折叠
  const petiole = o.petiole === undefined ? 0.0 : o.petiole // 叶柄长度比例

  // 这里只借用 BufferGeometry 来算顶点法线 (computeVertexNormals 对条带也适用),
  // 算完立刻 dispose, 真正的几何数据仍由本函数返回的裸数组承载。
  const geo = new THREE.BufferGeometry()
  const positions = []
  const uvs = []
  const index = []

  for (let i = 0; i <= rows; i++) {
    const t = i / rows
    // 叶柄段: 前 petiole 比例内只保留中脉
    // inBlade: 把叶柄之后的区间重新归一化到 0..1, 让轮廓函数仍从"叶基部"开始算;
    // 叶柄内 (t < petiole) 时 (t-petiole) 为负, 用 max(0,·) 夹成 0。
    const inBlade = petiole > 0 ? Math.max(0, (t - petiole) / (1 - petiole)) : t
    // 叶柄段把半宽压到 0.012 (细中脉); 非叶柄段用轮廓给出的半宽
    const hw = shape(inBlade) * (petiole > 0 && t < petiole ? 0.012 : 1)
    const y = t
    // curl = 纵向弓弯, fold = 横向 V 形折叠。
    // 关键: 折叠抬升量按半宽等比缩放 -> 无论叶片宽窄, 折角恒定,
    // 细长针叶不会被"折"成侧立的刀片 (那样法线会背向太阳而发黑)。
    const midZ = curl * Math.sin(Math.PI * inBlade)
    const edgeZ = midZ + fold * hw
    // left
    positions.push(-hw, y, edgeZ)
    // u=0 在左缘, u=1 在右缘: 贴图左右不镜像, 与卡片模板保持同一套 UV 约定
    uvs.push(0, t)
    // right
    positions.push(hw, y, edgeZ)
    uvs.push(1, t)
  }
  // 每圈两个顶点 -> 相邻两圈拼两个三角形; 顶点顺序 l0,r0,r1 / l0,r1,l1 让绕序朝 +Z
  for (let i = 0; i < rows; i++) {
    const l0 = i * 2
    const r0 = i * 2 + 1
    const l1 = (i + 1) * 2
    const r1 = (i + 1) * 2 + 1
    index.push(l0, r0, r1)
    index.push(l0, r1, l1)
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(index)
  // 法线由几何推导 (轮廓是曲面, 手写常量法线会让高光位置不对)
  geo.computeVertexNormals()
  const normals = Array.from(geo.attributes.normal.array)
  geo.dispose()

  return { positions, normals, uvs, index, vertexCount: positions.length / 3 }
}

/**
 * 把一片叶子写入累加器
 * @param {import('./mathUtils.js').GeoAcc} acc
 * @param {*} tmpl   buildLeafTemplate 结果
 * @param {{x:THREE.Vector3,y:THREE.Vector3,z:THREE.Vector3}} basis 正交基 (y = 叶轴, z = 叶面法线)
 * @param {THREE.Vector3} scale 非等比缩放 (宽, 长, 厚)
 * @param {THREE.Vector3} pos   叶柄基点 (世界坐标)
 * @param {THREE.Color} color0  叶基颜色
 * @param {THREE.Color} color1  叶尖颜色
 *
 * 另外几个「风场/生长」属性 (JSDoc 未列出, 但同样是必需参数):
 * @param {number} wind     每片叶子的风力权重 (0..1, 越靠树冠越大, 决定摆幅)
 * @param {number} phase    摆动相位 (弧度或 0..1 的随机相), 让满树叶子不同步
 * @param {THREE.Vector3} origin 叶柄基点的世界坐标, 顶点着色器以它为摆动支点
 * @param {number} grow0    生长动画的起始阈值 (0..1, 与整树的生长进度比较)
 * @param {number} grow1    生长动画的完成阈值
 * @param {number} [nodeId=0] 所属枝条 id, 用于选中时整枝高亮
 * @param {THREE.Color|null} [stamenColor=null] 花蕊专用颜色 (花瓣模板带 stamenRange 时生效)
 */
export function pushLeafInstance(acc, tmpl, basis, scale, pos, color0, color1, wind, phase, origin, grow0, grow1, nodeId = 0, stamenColor = null) {
  const { positions, normals, uvs, index, stamenRange } = tmpl
  // base = 写入前的顶点数: 三角面索引必须整体后移它, 才能指向本片叶子刚写入的顶点
  const base = acc.vertexCount
  const n = tmpl.vertexCount
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    // ① 局部顶点先做非等比缩放 (宽/长/厚三个方向可以不同, 例如叶片被压扁)
    const lx = positions[i3] * scale.x
    const ly = positions[i3 + 1] * scale.y
    const lz = positions[i3 + 2] * scale.z
    // ② 用正交基把局部坐标搬到世界空间: world = pos + Bx·lx + By·ly + Bz·lz
    const wx = pos.x + basis.x.x * lx + basis.y.x * ly + basis.z.x * lz
    const wy = pos.y + basis.x.y * lx + basis.y.y * ly + basis.z.y * lz
    const wz = pos.z + basis.x.z * lx + basis.y.z * ly + basis.z.z * lz

    // 法线的逆转置: 先按缩放反向除, 再旋转
    // 非等比缩放会切变法线, 正确做法是用 (M^-1)^T; 对"正交基·对角缩放"这种矩阵,
    // 其逆转置等价于「先除以 scale 再乘正交基」, 也就是下面这两步。
    const nx0 = normals[i3] / scale.x
    const ny0 = normals[i3 + 1] / scale.y
    const nz0 = normals[i3 + 2] / scale.z
    let nx = basis.x.x * nx0 + basis.y.x * ny0 + basis.z.x * nz0
    let ny = basis.x.y * nx0 + basis.y.y * ny0 + basis.z.y * nz0
    let nz = basis.x.z * nx0 + basis.y.z * ny0 + basis.z.z * nz0
    // 归一化; 用 `|| 1` 兜住退化情况 (scale 里有 0 时会得到零向量, 不能让 NaN 传下去)
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl; ny /= nl; nz /= nl

    /* ---- 顶点色: 叶基 -> 叶尖的渐变 ---- */
    const v = uvs[i * 2 + 1]
    // 指数 0.75: 让渐变在中后段才明显变化 (叶基附近颜色更"实"), 比线性更自然
    const k = Math.pow(v, 0.75)
    // 花蕊顶点用独立颜色 (不受花瓣调色板影响)
    // stamenRange = [起始顶点下标, 顶点数], 由花朵模板提供; 普通叶片没有这个字段
    const inStamen = stamenColor && stamenRange && i >= stamenRange[0] && i < stamenRange[0] + stamenRange[1]
    const r = inStamen ? stamenColor.r : color0.r + (color1.r - color0.r) * k
    const g = inStamen ? stamenColor.g : color0.g + (color1.g - color0.g) * k
    const b = inStamen ? stamenColor.b : color0.b + (color1.b - color0.b) * k

    // 顶点属性顺序见文件头「顶点属性布局」; Math.min(1, ·) 是防御:
    // 颜色乘法 (比如饱和度调节) 有可能把分量推出 1, 顶点色 >1 会让 HDR 色调映射出脏白。
    acc.vertex(
      wx, wy, wz, nx, ny, nz,
      uvs[i * 2], uvs[i * 2 + 1],
      Math.min(1, r), Math.min(1, g), Math.min(1, b),
      wind, phase,
      origin.x, origin.y, origin.z,
      grow0, grow1, nodeId,
    )
  }
  // 三角面: 模板索引整体偏移 base 后写入
  for (let i = 0; i < index.length; i += 3) {
    acc.tri(base + index[i], base + index[i + 1], base + index[i + 2])
  }
}
