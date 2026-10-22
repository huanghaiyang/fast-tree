/**
 * 模型统计数字的唯一来源
 * ------------------------------------------------------------
 * 视口右下角 / 导出面板 / 状态栏都用这里算, 保证"全模三角面"一致:
 * 树皮(含果实) + 树叶 + 花朵 三者都算, 不能漏掉花朵。
 *
 * 作用: 把分散在 `state.stats` 里的分项计数, 汇总成给用户看的顶点数 / 三角面数。
 * 输入 / 输出: `state.stats` 的快照对象 (各字段 number, 缺失或非数值按 0 处理) -> 非负整数。
 * 与其他模块的关系:
 *   - 写入方: Viewport.vue 重建后把 treeBuilder/材质统计写入 `state.stats`;
 *   - 读取方: store/treeStore.js 的 `totalTriangles` 计算属性 -> 各面板显示;
 *     以及自检脚本, 避免"面板数字"与"自检数字"两套口径对不上。
 * 关键约定:
 *   - **只读不写**: 本模块不修改传入的 stats, 也不做去重/合并, 纯粹的求和口径;
 *   - 只统计树本身的三类几何, 不含地面、网格、天空、伪装卡等辅助物体;
 *   - 结果取整并夹到 >= 0: 统计值可能来自浮点累加或 LOD 插值, 直接显示 `12345.0000001`
 *     既难看又会让"导出前后对比"出现假差异; 取整前先舍入, 负数(理论上不该出现)夹成 0。
 */

/**
 * 汇总"全模三角面数"(树皮含果实 + 树叶 + 花朵)。
 *
 * @param {{barkTriangles?: number, leafTriangles?: number, flowerTriangles?: number}} [stats]
 *   `state.stats` 快照; 三个字段单位都是"三角形个数", 缺省视为 0。
 * @returns {number} 三角面总数, 四舍五入后的非负整数。
 */
export function modelTriangleCount(stats = {}) {
  const s = stats || {}
  const n = (s.barkTriangles || 0) + (s.leafTriangles || 0) + (s.flowerTriangles || 0)
  return Math.max(0, Math.round(n))
}

/**
 * 汇总"全模顶点数"(树皮含果实 + 树叶 + 花朵)。
 *
 * 注意: 这是"各几何体 POSITION 属性的顶点数之和", 与三角面数是**两套独立统计**:
 * 索引几何里同一个顶点会被多个三角形共享(树叶卡片尤其明显), 所以
 * 不能用 `三角面数 × 3` 去反推它, 反之亦然。顶点数更接近显存/导出体积的真实量级,
 * 因此单独给一个函数, 而不是由三角面数换算。
 *
 * @param {{barkVertices?: number, leafVertices?: number, flowerVertices?: number}} [stats]
 *   `state.stats` 快照; 三个字段单位都是"顶点个数", 缺省视为 0。
 * @returns {number} 顶点总数, 四舍五入后的非负整数。
 */
export function modelVertexCount(stats = {}) {
  const s = stats || {}
  const n = (s.barkVertices || 0) + (s.leafVertices || 0) + (s.flowerVertices || 0)
  return Math.max(0, Math.round(n))
}
