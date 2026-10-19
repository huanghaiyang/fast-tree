/**
 * 模型统计数字的唯一来源
 * ------------------------------------------------------------
 * 视口右下角 / 导出面板 / 状态栏都用这里算, 保证"全模三角面"一致:
 * 树皮(含果实) + 树叶 + 花朵 三者都算, 不能漏掉花朵。
 */
export function modelTriangleCount(stats = {}) {
  const s = stats || {}
  const n = (s.barkTriangles || 0) + (s.leafTriangles || 0) + (s.flowerTriangles || 0)
  return Math.max(0, Math.round(n))
}

export function modelVertexCount(stats = {}) {
  const s = stats || {}
  const n = (s.barkVertices || 0) + (s.leafVertices || 0) + (s.flowerVertices || 0)
  return Math.max(0, Math.round(n))
}
