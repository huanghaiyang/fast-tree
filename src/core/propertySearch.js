import { LABEL_INDEX, TAB_NAMES } from './labelIndex.generated.js'
import { docFor } from './paramDocs.js'

/**
 * 属性快捷搜索
 * ------------------------------------------------------------
 * 数据源: labelIndex.generated.js (构建时从各面板组件的 label="..." 扫描生成) + paramDocs 的说明文本。
 * 匹配规则: 标签包含查询词 (中文/英文均可), 命中越靠前/越短越优先; 同时匹配说明文本。
 *
 * 作用: 用户在一大堆参数里按名字找滑杆 —— 返回"标签 + 所属标签页 + 说明"的候选列表,
 *       UI 侧据此跳到对应 tab 并高亮该参数 (本模块只**算**不跳转, 保持纯函数好测)。
 * 输入 / 输出:
 *   - 入参 query: 用户输入的原始字符串 (大小写、首尾空格都不敏感);
 *   - 输出: `Array<{label, tab, tabName, doc, score}>`, 已按相关性降序排好并截断。
 * 与其他模块的关系:
 *   - 上游: `labelIndex.generated.js` (构建产物, 只读数据) / `paramDocs.js` (参数说明文本);
 *   - 下游: 搜索框组件 -> `store/treeStore.js` 的 `setActiveTab()` 切标签页。
 * 关键约定:
 *   - 索引只有几百条, 因此每次按键线性扫一遍即可, 不做倒排索引/防抖 (省一条缓存失效链路);
 *   - 匹配是**子串包含**, 不是模糊/拼音匹配: 想搜"叶子"得输入"叶", 输入"yz"搜不到。
 */

/**
 * 按关键词搜索参数标签。
 *
 * 排序分构成 (数值越大越靠前):
 *   - 标签以查询词开头      -> 300 (最像"用户就是想说这个参数");
 *   - 标签中间命中          -> 200 - min(50, 命中位置) (越靠前越好, 位置惩罚封顶 50);
 *   - 只有说明文本命中      -> 50  (仍然算命中, 但永远排在标签命中之后);
 *   - 再统一减 `min(60, label.length)`: 标签越短越"专指", 避免长句标签挤掉精确短名。
 * 最终排序: 先比 score, 相同再比标签长度 (短的在前)。
 *
 * @param {string} query 搜索词; 中英文均可, 大小写/首尾空格不敏感。空串直接返回 `[]`。
 * @param {number} [limit=20] 最多返回条数; 内部会夹到 >= 1 (传 0/负数按 1 处理)。
 * @returns {Array<{label: string, tab: string, tabName: string, doc: string, score: number}>}
 *   `label` 参数标签原文 (UI 显示/高亮用), `tab` 标签页 id, `tabName` 展示名,
 *   `doc` 参数说明 (无说明时为空串), `score` 内部排序分 (一般不需要展示给用户)。
 */
export function searchLabels(query, limit = 20) {
  // 归一化: 非字符串(null/undefined/对象)安全转成 ''; 大小写折叠, 去掉首尾空白
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
    // tabName 三级兜底: 索引里自带的展示名 -> TAB_NAMES 映射 -> 直接显示 tab id (防数据缺口)
    out.push({ label, tab: item.tab, tabName: item.tabName || TAB_NAMES[item.tab] || item.tab, doc, score })
  }
  // 主序 score 降序; 同分时短标签优先 (更可能是精确的参数名而不是长描述)
  out.sort((a, b) => b.score - a.score || a.label.length - b.label.length)
  // 末尾 Math.max(1, limit): 保证 UI 至少拿到 1 条, 避免调用方传 0 时看到"什么都没有"
  return out.slice(0, Math.max(1, limit))
}
