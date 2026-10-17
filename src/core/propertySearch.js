import { LABEL_INDEX, TAB_NAMES } from './labelIndex.generated.js'
import { docFor } from './paramDocs.js'

/**
 * 属性快捷搜索
 * ------------------------------------------------------------
 * 数据源: labelIndex.generated.js (构建时从各面板组件的 label="..." 扫描生成) + paramDocs 的说明文本。
 * 匹配规则: 标签包含查询词 (中文/英文均可), 命中越靠前/越短越优先; 同时匹配说明文本。
 */
export function searchLabels(query, limit = 20) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const out = []
  for (const item of LABEL_INDEX) {
    const label = item.label
    const lower = label.toLowerCase()
    const doc = docFor(label) || ''
    const inLabel = lower.indexOf(q)
    const inDoc = doc ? doc.toLowerCase().indexOf(q) : -1
    if (inLabel < 0 && inDoc < 0) continue
    // 排序分: 标签开头命中 > 标签内含 > 仅说明命中; 标签越短越优先
    let score = 0
    if (inLabel === 0) score = 300
    else if (inLabel > 0) score = 200 - Math.min(50, inLabel)
    else score = 50
    score -= Math.min(60, label.length)
    out.push({ label, tab: item.tab, tabName: item.tabName || TAB_NAMES[item.tab] || item.tab, doc, score })
  }
  out.sort((a, b) => b.score - a.score || a.label.length - b.label.length)
  return out.slice(0, Math.max(1, limit))
}
