/**
 * 果实 / 种子: 模板 + 实例化写入
 * ------------------------------------------------------------
 * 作用: 生成一颗「单位果实」的几何模板, 再把模板按每个挂果点的正交基/缩放写入
 *       全局累加器 (GeoAcc), 与树皮/叶片合并成同一批几何。
 * 输入 / 输出:
 *   - buildFruitTemplate(o) -> { positions, normals, uvs, colors, index, vertexCount, top, bottom, centerY }
 *   - pushFruitInstance(acc, tpl, o) -> void (直接写 acc)
 * 与其他模块的关系:
 *   上: treeStore 的 state.params.fruit 决定 type/颜色/比例;
 *   下: 由 sceneManager 在挂果阶段调用, acc 最终合成树的整体几何。
 *   导出: 视口里果实与树皮共用 bark 材质 (靠顶点色区分坚果/壳斗帽), 只有导出时才换成
 *         fruitMaterial.js 里的独立 Fruit 材质。
 * 关键概念 / 约定:
 *   - 模板在**单位空间**: 总高约 1, 沿 +Y 生长, 中心在原点附近 (centerY = 0)。
 *     实例化时统一由 scale 缩放到真实尺寸 (米), 所以模板里的数字都是无量纲比例。
 *   - 顶点属性布局与叶片**完全一致** (position / normal / uv / color + wind/phase/
 *     origin/grow/nodeId), 因此风场、生长动画、选中高亮这些着色器特性对果实同样生效。
 *   - 颜色烘在顶点色里 (坚果色 / 壳斗帽色), 不是贴图; 每颗果实的色差由 pushFruitInstance
 *     的 colorTint 再乘一次。
 * 注意: 旋转体两极是 r=0 的重复顶点, 必须单独补法线 (见 buildFruitTemplate 末尾),
 *       否则导出 OBJ/GLB 会出现零长度法线。
 */
import * as THREE from 'three'

/** 旋转体: 给定母线 (r, y) 列表, 绕 Y 轴旋成封闭体 */
function lathe(profile, radial, uScale = 1) {
  const positions = []
  const normals = []
  const uvs = []
  const index = []
  // 每条母线点 = 一圈 (rings 圈); 每圈 radial+1 个顶点 (首尾重合, 为了 UV 从 0 连续到 1)
  const rings = profile.length
  for (let i = 0; i < rings; i++) {
    const [r, y] = profile[i]
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      positions.push(Math.cos(a) * r, y, Math.sin(a) * r)
      // 先给一圈「水平朝外」的近似法线 (真正的法线稍后由 computeVertexNormals 重算)
      normals.push(Math.cos(a), 0, Math.sin(a))
      // u 沿圆周 (uScale 可让壳斗帽的纹理横向重复多次), v 沿母线从上到下
      uvs.push((j / radial) * uScale, i / (rings - 1))
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      // 相邻两圈之间铺两个三角形 (a,b,a+1) 与 (a+1,b,b+1), 索引绕序保证法线朝外
      const a = i * (radial + 1) + j
      const b = a + radial + 1
      index.push(a, b, a + 1)
      index.push(a + 1, b, b + 1)
    }
  }
  return { positions, normals, uvs, index }
}

/** 支持的果实类型; UI 下拉框的选项就是这份列表, 顺序即显示顺序 */
export const FRUIT_TYPES = ['acorn', 'berry', 'cone', 'nut']

/**
 * 单位果实模板: 总高 1 (沿 +Y), 中心在原点附近
 *
 * 组装顺序: 坚果主体 (旋转体) -> 可选壳斗帽 -> 可选果柄 -> 合并成单一索引缓冲。
 * 合并时**逐 part 平移索引** (idx + base), 这样最后只有一个 index 数组,
 * 实例化时只需一次 acc.tri 循环, 不必按 part 分开处理。
 *
 * @param {object} [o={}] 模板选项
 * @param {string} [o.type='acorn'] 果实类型, 取值见 FRUIT_TYPES; 非法值回退 acorn
 * @param {number} [o.radial=10] 旋转体的圆周分段 (>=5, 越大越圆); 果柄用其一半
 * @param {string} [o.color='#c8a86a'] 坚果主体颜色 (写入顶点色)
 * @param {string} [o.capColor='#8a6f45'] 壳斗帽 / 果柄颜色 (写入顶点色)
 * @returns {{positions:number[],normals:number[],uvs:number[],index:number[],colors:number[],
 *            vertexCount:number,top:number,bottom:number,centerY:number}}
 *   top / bottom 是模板沿 +Y 的上下端 (果柄末端 / 坚果底), 供挂果定位使用
 */
export function buildFruitTemplate(o = {}) {
  const type = FRUIT_TYPES.includes(o.type) ? o.type : 'acorn'
  const radial = Math.max(5, Math.round(o.radial || 10))
  const nutColor = new THREE.Color(o.color || '#c8a86a')
  const capColor = new THREE.Color(o.capColor || '#8a6f45')

  // 每种果实的母线 (r, y): 高度约 0..1, 果柄可忽略
  // 坚果: 底部圆钝(带小尖), 上部收窄插进壳斗帽; 顶部 y=+0.15 被帽子盖住
  // 母线约定: 第一个点 r=0 (下极点), 最后一个点 r=0 (上极点), 中间是外轮廓。
  // y 的取值范围约为 -0.55..0.5, 加帽子后整体约束在 ~1 的高度内。
  const nutProfile = {
    acorn: [[0.0, -0.55], [0.10, -0.53], [0.22, -0.47], [0.30, -0.36], [0.34, -0.18], [0.33, 0.0], [0.28, 0.14], [0.20, 0.22], [0.0, 0.26]],
    berry: [[0.0, -0.5], [0.16, -0.46], [0.30, -0.34], [0.36, -0.14], [0.35, 0.1], [0.27, 0.32], [0.13, 0.46], [0.0, 0.5]],
    cone: [[0.0, -0.5], [0.30, -0.44], [0.26, -0.30], [0.32, -0.24], [0.22, -0.08], [0.27, -0.02], [0.16, 0.14], [0.19, 0.2], [0.08, 0.36], [0.0, 0.5]],
    nut: [[0.0, -0.5], [0.20, -0.46], [0.32, -0.32], [0.36, -0.10], [0.33, 0.14], [0.24, 0.30], [0.0, 0.34]],
  }[type]
  // 松果的母线半径来回起伏 (0.30->0.26->0.32), 这就是鳞片层层叠叠的外轮廓

  const nut = lathe(nutProfile, radial)
  // parts / colorOf 一一对应: 第 p 个 part 的所有顶点都刷 colorOf[p]
  const parts = [nut]
  const colorOf = [nutColor]

  // 壳斗帽: 只给橡果/坚果 (顶部一小段包裹)
  if (type === 'acorn' || type === 'nut') {
    // 壳斗帽: 只包住**顶部约 1/3**, 下沿略宽于坚果 -> 一眼能看出"帽子在顶上"
    // capTop / capBottom 是帽子在模板 Y 轴上的上下界; capRim 是帽沿半径, 必须**大于**
    // 同高度处坚果的半径, 否则帽子会陷进坚果里看不出来。
    const capTop = type === 'acorn' ? 0.34 : 0.2
    const capBottom = type === 'acorn' ? 0.0 : -0.02
    const capRim = type === 'acorn' ? 0.395 : 0.35
    const capProfile = [
      [0.0, capTop + 0.02],
      [0.14, capTop],
      [0.26, capTop - 0.06],
      [capRim, capTop - 0.14],
      [capRim * 0.96, capBottom],        // 帽沿 (最宽处略鼓, 有粗糙感)
      [capRim * 0.88, capBottom - 0.05],
      [capRim * 0.6, capBottom - 0.07],
    ]
    // uScale = 2: 帽子比坚果小, 纹理横向重复两次才不会显得糊
    parts.push(lathe(capProfile, radial, 2))
    colorOf.push(capColor)
    // 果柄: 从帽顶向上伸出 (果实就是靠它挂在枝上)
    // 分段数取圆周的一半 (radial >> 1): 果柄很细, 不需要那么圆的截面
    const stem = lathe([[0.0, capTop], [0.055, capTop + 0.04], [0.05, capTop + 0.16], [0.0, capTop + 0.2]], Math.max(4, radial >> 1))
    parts.push(stem)
    colorOf.push(capColor)
  }

  // 统计整个模板沿 +Y 的上下界 (第 1、4、7... 个分量是 y)
  let partTop = -Infinity
  let partBottom = Infinity
  for (const part of parts) {
    for (let i = 1; i < part.positions.length; i += 3) {
      if (part.positions[i] > partTop) partTop = part.positions[i]
      if (part.positions[i] < partBottom) partBottom = part.positions[i]
    }
  }
  /* ---------------- 合并所有 part 成一份缓冲 ---------------- */
  const positions = []
  const normals = []
  const uvs = []
  const colors = []
  const index = []
  let base = 0
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]
    const c = colorOf[p]
    for (let i = 0; i < part.positions.length; i += 3) {
      positions.push(part.positions[i], part.positions[i + 1], part.positions[i + 2])
      normals.push(part.normals[i], part.normals[i + 1], part.normals[i + 2])
      colors.push(c.r, c.g, c.b)
    }
    uvs.push(...part.uvs)
    // 关键: 索引要整体后移 base, 否则第二个 part 会指向第一个 part 的顶点
    for (const idx of part.index) index.push(idx + base)
    base += part.positions.length / 3
  }
  /* ---------------- 法线重算 + 极点法线修补 ---------------- */
  // 法线重算 (旋转体母线不是球面, 用几何法线更自然)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  const n = geo.attributes.normal.array
  geo.dispose()
  // 旋转体两极是 r=0 的重复顶点, 连接极点的三角形面积为 0, computeVertexNormals 会给这些
  // 顶点留下**零法线** (导出 OBJ/GLB 时是非法数据: 法线长度 0, 很多 DCC/引擎会出黑斑)。
  // 极点法线解析上就是 ±Y: 按每个 part 的 y 上下界补成 (0,±1,0)。
  // 阈值 1e-12: 只要任一分量非零就认为 computeVertexNormals 已经给出了有效法线。
  let vOffset = 0
  for (const part of parts) {
    const count = part.positions.length / 3
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 1; i < part.positions.length; i += 3) {
      const y = part.positions[i]
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    for (let k = 0; k < count; k++) {
      const o = (vOffset + k) * 3
      if (Math.abs(n[o]) + Math.abs(n[o + 1]) + Math.abs(n[o + 2]) > 1e-12) continue
      const y = positions[(vOffset + k) * 3 + 1]
      n[o] = 0
      // 落在该 part 最低处的极点朝下 (-1), 其余朝上 (+1); 1e-6 是浮点等值判定的容差
      n[o + 1] = y <= minY + 1e-6 ? -1 : 1
      n[o + 2] = 0
    }
    vOffset += count
  }
  return {
    positions,
    normals: Array.from(n),
    uvs,
    colors,
    index,
    vertexCount: positions.length / 3,
    // 模板的上下端 (沿 +Y): 果柄末端 / 坚果底 -> 供挂果定位使用
    top: partTop,
    bottom: partBottom,
    centerY: 0,
  }
}

/**
 * 把一个果实模板实例写进 acc
 *
 * 变换约定: 模板沿 +Y 生长, 实例化时把 +Y 对齐到 dir (挂果方向),
 * 再绕 dir 转 roll 弧度 (让壳斗帽的纹理朝向不整齐划一)。
 * 非等比缩放 (sx, sy, sz) 在**局部坐标**里先施加, 再旋到世界空间。
 *
 * @param {object} acc GeoAcc 累加器 (提供 vertexCount / vertex() / tri())
 * @param {object} tpl buildFruitTemplate 的结果
 * @param {{pos:THREE.Vector3, dir:THREE.Vector3, roll:number, scale:THREE.Vector3|number,
 *          colorTint:THREE.Color, wind:number, phase:number, grow:number, origin:THREE.Vector3, nodeId:number}} o
 *        pos   挂果点世界坐标 (米); dir 挂果方向 (会被归一化); roll 绕自身轴旋转 (弧度);
 *        scale 非等比缩放 (米, 可传单个 number 表示等比); colorTint 每实例色差乘子;
 *        wind/phase/origin/grow 是给风场与生长动画用的顶点属性; nodeId 用于选中高亮反查
 */
export function pushFruitInstance(acc, tpl, o) {
  // 关键: 三角面索引必须基于"写入前的累加器顶点数"。
  // 模板会被多处复用 (tpl.offset 会失效), 用 acc.vertexCount 才永远正确。
  const base = acc.vertexCount
  const scale = o.scale === undefined ? 1 : o.scale
  const sx = typeof scale === 'number' ? scale : scale.x
  const sy = typeof scale === 'number' ? scale : scale.y
  const sz = typeof scale === 'number' ? scale : scale.z
  // 正交基: 果实沿 dir 生长, roll 绕自身轴
  const axis = o.dir.clone().normalize()
  // 选参考向量时避开与 axis 平行的情况: |axis.y| > 0.95 说明轴几乎竖直,
  // 此时用 X 当参考, 否则叉乘结果会退化成零向量。
  const ref = Math.abs(axis.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const tx = new THREE.Vector3().crossVectors(ref, axis).normalize()
  const tz = new THREE.Vector3().crossVectors(axis, tx).normalize()
  // roll: 在垂直轴的平面内把 (tx, tz) 这一对基底整体旋转 roll 弧度
  const cosR = Math.cos(o.roll || 0)
  const sinR = Math.sin(o.roll || 0)
  const ex = tx.clone().multiplyScalar(cosR).addScaledVector(tz, sinR) // 右
  const ez = new THREE.Vector3().crossVectors(axis, ex).normalize() // 前
  const tint = o.colorTint || new THREE.Color(1, 1, 1)

  const v = new THREE.Vector3()
  for (let i = 0; i < tpl.vertexCount; i++) {
    // 先在模板局部空间做非等比缩放, 再投射到 (ex, axis, ez) 构成的实例坐标系
    const px = tpl.positions[i * 3] * sx
    const py = tpl.positions[i * 3 + 1] * sy
    const pz = tpl.positions[i * 3 + 2] * sz
    // 世界位置 = 挂果点 + ex*px + axis*py + ez*pz
    v.copy(o.pos)
      .addScaledVector(ex, px)
      .addScaledVector(axis, py)
      .addScaledVector(ez, pz)
    acc.vertex(
      v.x, v.y, v.z,
      // 法线: 模板法线直接用正交基旋转即可 (正交基 + 等比量级, 忽略非等比带来的切变;
      // 果实接近球/椭球, 这点误差在视觉上不可见)
      tpl.normals[i * 3], tpl.normals[i * 3 + 1], tpl.normals[i * 3 + 2],
      tpl.uvs[i * 2], tpl.uvs[i * 2 + 1],
      // 顶点色 = 模板色 (坚果/帽) × 每实例 tint
      tpl.colors[i * 3] * tint.r, tpl.colors[i * 3 + 1] * tint.g, tpl.colors[i * 3 + 2] * tint.b,
      // grow 同时写进 grow0/grow1: 果实是整体生长, 没有叶片那种「基部->梢部」的渐变
      o.wind, o.phase, o.origin.x, o.origin.y, o.origin.z, o.grow, o.grow,
      o.nodeId || 0,
    )
  }
  for (let i = 0; i < tpl.index.length; i += 3) {
    acc.tri(base + tpl.index[i], base + tpl.index[i + 1], base + tpl.index[i + 2])
  }
}
