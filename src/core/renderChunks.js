/**
 * 渲染分块 (视锥剔除用的 chunk)
 * ------------------------------------------------------------
 * 作用: 把"整棵树合并成的一个大几何体"按空间网格切成若干小块, 让 Three.js 能逐块做
 *       视锥剔除 —— 只看树冠局部时, 屏幕外的枝条/叶片所在的块不会被提交渲染。
 *       这是"2 个 draw call 换视野外仍然全量提交"的折中: 改成 N 个 draw call,
 *       但每帧实际提交的数量随视角变化。
 * 输入 / 输出: `(源码合并几何, 材质, 选项)` -> `THREE.Mesh[]`; 每个 mesh 共享源几何的
 *       顶点属性, 只持有自己那一份三角形索引 (所以额外内存 ≈ 索引数组)。
 * 与其他模块的关系:
 *   - 上游: `sceneManager.js` 在合并出树皮/树叶几何后调用 `buildFrustumChunks()`;
 *   - 同文件的 `hideSourceMesh()` 把源 mesh 移到 `SOURCE_ONLY_LAYER` 层, 从此只用于
 *     导出/统计/粒子采样, 不再参与渲染;
 *   - 下游: 视锥剔除由 Three.js 渲染器自动完成 (依赖这里算出的 `boundingSphere`)。
 * 关键约定:
 *   - **源几何完全不动**: 本模块只读顶点属性、只新建索引数组, 不修改源 geometry;
 *   - 块是"三角形的空间分类", 不做顶点分裂也不需要: 相邻块共享顶点属性是允许的,
 *     因为拆分依据是三角形, 而索引指向的顶点数据仍在源属性里;
 *   - 单位: 世界坐标(米), 与 treeBuilder 输出一致。
 * 注意: 分块只影响**渲染**, 不影响导出的结构 —— 导出仍由 `exportSplit.js`
 *       按节点组重新拆分几何; 两者互不依赖, 不要试图复用这里的块。
 */
import * as THREE from 'three'

/** 源网格放到相机默认层之外: 只用于导出/统计, 不再直接渲染 */
export const SOURCE_ONLY_LAYER = 31

/**
 * 把合并几何按空间网格切成若干块 (只做渲染用; 源几何完全不动)。
 * 每一块有自己的包围球, Three.js 会按视锥逐块剔除 ——
 * 窗口外的树叶/花朵/果实(含在树皮几何里)所在的块不会提交渲染。
 *
 * 块几何共享源几何的顶点属性, 只复制三角形索引子集, 所以内存开销很小。
 *
 * 算法: 遍历三角形, 用**三角形重心**决定它属于哪个网格单元 (不是逐顶点分类,
 * 否则一个三角形可能被拆到两个块里); 同一单元的所有三角形归为一个 chunk。
 * 复杂度 O(三角形数), 没有空间排序/树结构 —— 树最多几十万面, 一次线性扫足够快。
 *
 * 退化与跳过条件 (全部返回 `[]`, 由调用方直接退回"单个大 mesh"渲染):
 *   - 没有 position 属性 / 没有索引 / 索引三角形数 < `minTriangles`;
 *   - 包围盒为空 (空几何)。
 * 前两条是"分块不划算"的判据: 块数太多时 draw call 与状态切换的开销会超过剔除省下的;
 * 而且非索引几何无法只复制索引子集, 只能跳过。
 *
 * @param {THREE.BufferGeometry} geometry 合并后的几何 (带 index)
 * @param {THREE.Material} material 所有块共享的材质 (不复制材质)
 * @param {object} [opts]
 * @param {string} [opts.name='Chunk'] 块命名前缀, 生成的 mesh 名形如 `Chunk-Cull0`
 * @param {[number, number, number]} [opts.grid=[2,2,2]] 三轴网格划分数, 内部夹到 >= 1
 * @param {number} [opts.minTriangles=120] 少于这么多三角形就不分块 (分块不划算)
 * @param {boolean} [opts.castShadow=true] 块是否投射阴影 (要与源 mesh 的设定保持一致)
 * @param {boolean} [opts.receiveShadow=false] 块是否接收阴影
 * @returns {THREE.Mesh[]} 块 mesh 列表; 空数组 = 调用方应保持原样渲染
 */
export function buildFrustumChunks(geometry, material, opts = {}) {
  const {
    name = 'Chunk',
    grid = [2, 2, 2],
    minTriangles = 120,
    castShadow = true,
    receiveShadow = false,
  } = opts
  // 前置校验: 几何/属性缺失(材质可能来自异步加载)直接放弃分块
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return []
  const index = geometry.index
  // 非索引几何没法只取三角形子集 -> 不分块; 面数太少 -> 也不值得
  if (!index || index.count < minTriangles * 3) return []

  geometry.computeBoundingBox()
  const rootBox = geometry.boundingBox
  if (!rootBox || rootBox.isEmpty()) return []
  const pos = geometry.attributes.position
  const idx = index.array
  // `| 0` 把浮点/字符串网格数截成整数; Math.max(1, ...) 保证除数不为 0
  const nx = Math.max(1, grid[0] | 0)
  const ny = Math.max(1, grid[1] | 0)
  const nz = Math.max(1, grid[2] | 0)
  // 1e-6 下限防"平行于某轴的薄片几何"出现零尺寸 -> 除零 -> NaN 索引
  const size = new THREE.Vector3(
    Math.max(1e-6, rootBox.max.x - rootBox.min.x),
    Math.max(1e-6, rootBox.max.y - rootBox.min.y),
    Math.max(1e-6, rootBox.max.z - rootBox.min.z),
  )
  // key 是 "ix,iy,iz" 字符串; 单元数通常只有几到几十个, Map 足够
  const cells = new Map()

  const cellKey = (x, y, z) => `${x},${y},${z}`
  /* ---------------- ① 按三角形重心分箱 ---------------- */
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3
    const b = idx[i + 1] * 3
    const c = idx[i + 2] * 3
    // 重心 = 三顶点平均 (世界坐标, 米); 用它避免三角形跨块
    const cx = (pos.array[a] + pos.array[b] + pos.array[c]) / 3
    const cy = (pos.array[a + 1] + pos.array[b + 1] + pos.array[c + 1]) / 3
    const cz = (pos.array[a + 2] + pos.array[b + 2] + pos.array[c + 2]) / 3
    // 归一化到 [0,1) 再乘格数; 末尾 clamp 兜住浮点误差导致的 ix === nx
    const ix = Math.min(nx - 1, Math.max(0, Math.floor(((cx - rootBox.min.x) / size.x) * nx)))
    const iy = Math.min(ny - 1, Math.max(0, Math.floor(((cy - rootBox.min.y) / size.y) * ny)))
    const iz = Math.min(nz - 1, Math.max(0, Math.floor(((cz - rootBox.min.z) / size.z) * nz)))
    const key = cellKey(ix, iy, iz)
    let cell = cells.get(key)
    if (!cell) {
      cell = []
      cells.set(key, cell)
    }
    // 存的是**原始顶点索引** (不是三角形序号), 后面可直接喂给 setIndex
    cell.push(idx[i], idx[i + 1], idx[i + 2])
  }

  /* ---------------- ② 每个非空单元生成一个 mesh ---------------- */
  const out = []
  let serial = 0
  for (const tris of cells.values()) {
    if (tris.length < 3) continue
    const chunk = new THREE.BufferGeometry()
    // 属性**共享**(同一批 BufferAttribute 实例, 不复制数据): 内存几乎不涨,
    // 代价是块与源几何必须同生共死 —— 源几何的 attribute 不能单独 dispose。
    for (const attrName of Object.keys(geometry.attributes)) {
      chunk.setAttribute(attrName, geometry.attributes[attrName])
    }
    chunk.setIndex(tris)
    // 包围盒/包围球必须按该块的三角形算, 不能用共享 position 的整体包围球,
    // 否则所有块的 boundingSphere 都是整棵树, 视锥剔除会失效。
    const box = new THREE.Box3()
    const p = new THREE.Vector3()
    for (let i = 0; i < tris.length; i++) {
      p.fromBufferAttribute(pos, tris[i])
      box.expandByPoint(p)
    }
    chunk.boundingBox = box
    // 用块内真实顶点到中心的距离算半径; 直接用包围盒角点会偏大, 视锥剔除会不够积极
    const center = box.getCenter(new THREE.Vector3())
    let radius2 = 0
    for (let i = 0; i < tris.length; i++) {
      const vx = pos.array[tris[i] * 3] - center.x
      const vy = pos.array[tris[i] * 3 + 1] - center.y
      const vz = pos.array[tris[i] * 3 + 2] - center.z
      const d2 = vx * vx + vy * vy + vz * vz
      if (d2 > radius2) radius2 = d2
    }
    chunk.boundingSphere = new THREE.Sphere(center, Math.sqrt(radius2))
    const mesh = new THREE.Mesh(chunk, material)
    // 名字带自增序号: 调试时能在 outliner/拾取结果里区分是哪个块
    mesh.name = `${name}-Cull${serial++}`
    mesh.castShadow = castShadow
    mesh.receiveShadow = receiveShadow
    mesh.frustumCulled = true
    out.push(mesh)
  }
  return out
}

/** 源网格不参与渲染 (但保留几何给导出/统计/粒子采样) */
export function hideSourceMesh(mesh) {
  if (!mesh) return
  // 只把 mesh 的 layer 改到 31: 相机默认只渲染 layer 0 -> 等同于"隐藏但仍在场景图里"。
  // 为什么不用 visible = false: 导出管线用 GLTFExporter 的 onlyVisible 选项,
  // visible=false 的对象会被**跳过不导出**; 而 layer 不参与导出判定,
  // 所以源几何能同时做到"不渲染"与"仍可导出/统计"。
  mesh.layers.set(SOURCE_ONLY_LAYER)
  // 源几何已不再绘制, 不做视锥剔除可省一次包围球测试
  mesh.frustumCulled = false
}
