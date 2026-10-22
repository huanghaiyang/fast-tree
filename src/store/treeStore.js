/**
 * 全局状态 (轻量 store, 不引入 pinia)
 * ------------------------------------------------------------
 * 作用: 整个应用的唯一状态源 —— 参数树 + 构建统计 + 渲染信息 + 全部"动作"(actions)。
 *       UI 只读 `state` / 只通过本文件导出的函数改 `state`;
 *       渲染层 (Viewport.vue) 反过来把场景能力注入 `sceneApi`, 由这里的动作去调用,
 *       这样 store 不需要 import Three.js, 也不与渲染管线强耦合。
 * 输入 / 输出:
 *   - `state` 是 Vue 的 `reactive` 对象: 任何写入都会驱动所有读它的组件重渲染;
 *   - 动作函数大多无返回值 (或返回刚生成的对象/是否成功), 副作用就是"改 state"。
 * 与其他模块的关系:
 *   - 上游: `main.js` -> App.vue; 参数结构与默认值来自 `core/params.js`,
 *     树种/阶段/季节预设来自 `core/presets.js` 与 `core/species.js`;
 *   - 下游: 所有面板组件读/写 `state`; `Viewport.vue` watch 各版本号触发
 *     重建几何 / 重编译着色器 / 重新取景;
 *   - 桥接: `sceneApi` 由 Viewport.vue 挂载时注入实现 (导出/截图/取景/伪装卡)。
 * 关键概念 (5 个版本号, 都是**递增计数器**而不是布尔标志):
 *   - `frameVersion`   : +1 = 重新取景 (相机重新框住树), 不重建几何;
 *   - `regrowToken`    : +1 = 从种子重新长一遍 (生长动画清零重播), 只在"真换了一棵树"时用;
 *   - `rebuildVersion` : +1 = 强制重建几何 + 重新取景 (预设切换/尺寸剧变);
 *   - `materialVersion`: +1 = 自定义 GLSL 改了, 需要重编译着色器;
 *   - `nodeVersion`    : 模型节点表 (非响应式大数组) 换了, UI 要重新读一次。
 *   为什么用递增数字: 同一个值写两次不会触发 Vue 的 watch; 而连续两次"取景"请求
 *   必须是两次独立事件, 布尔标志会被合并掉。
 * 约定 (确定性纪律):
 *   所有随机都必须来自 `core/rng.js` 的随机子流 (`makeRng(seed, '阶段标签')`),
 *   本文件里一律用子流, **不要用 Math.random()** (少数调试/随机换卡片处除外),
 *   否则"改树叶参数会挪动树干" —— 同一种子不再复现同一棵树。
 * 注意: 模块 import 时就会创建 `state` 并跑一次 `applyPreset` ——
 *       所以任何在模块顶层读 `state` 的代码, 拿到的都是 oak/成熟/夏季 这套初始值。
 */
import { reactive, computed } from 'vue'
import { defaultParams, cloneParams, normalizeParams, mergeParams } from '../core/params.js'
// 预设与树种: applyPreset 负责"树种×阶段×季节"的展开, autoGenerate 负责"种子 -> 一棵完整的树"
import { autoGenerate, autoWind, applyPreset, randomSeed, presetById, archetypeName } from '../core/presets.js'
import { SPECIES, GROWTH_STAGES, SEASONS } from '../core/species.js'
// 卡片库是构建期扫描生成的静态数据; pickExistingCard 用于异步探测贴图是否真的存在
import { LEAF_CARDS, LEAF_CARD_BY_ID, leafCardsFor, leafCardRows, LEAF_CARD_BATCHES, randomLeafAsset, randomFlowerAsset, pickExistingCard } from '../core/leafCards.generated.js'
// selectionRanges: 把"选中的节点 id"换算成几何顶点区间, 供着色器高亮用
import { selectionRanges } from '../core/treeBuilder.js'
import { makeRng } from '../core/rng.js'
import { modelTriangleCount } from '../core/modelStats.js'

export const state = reactive({
  // 初始参数 = 默认树种 (oak) 的成熟/夏季预设 -> 一进页面就是带果实的橡树
  params: normalizeParams(applyPreset(defaultParams(), 'oak', 'mature', 'summer')),
  // 最近一次构建的统计 (由 treeBuilder 写入): 数量 + 三角面/顶点 + 构建耗时(ms) + 冠幅/树高(米)
  stats: {
    branches: 0, leaves: 0, barkTriangles: 0, leafTriangles: 0,
    barkVertices: 0, leafVertices: 0, buildMs: 0, height: 0, spread: 0, nodeCount: 0,
  },
  // 渲染信息: 来自 renderer.info (本帧 draw call 数与提交三角面数), 用于性能面板
  renderInfo: { calls: 0, triangles: 0 },
  // 动态 LOD: 当前档位 + 各级统计 (由 sceneManager 回调)
  lodLevel: 0,
  lodInfo: [],
  // 扭曲句柄编辑 (视口叠加层)
  twistEdit: false,
  twistTarget: 'trunk',   // trunk | branches
  twistLevel: 1,          // 编辑哪一层树枝 (1..5)
  // 伪装卡生成结果 + 预览开关 (主预览区显示 2D 卡片还是 3D 树)
  impostorResult: null,
  impostorBusy: false,
  impostorPreview: false,
  // 着色器编译错误文本 (空串 = 正常); 由场景层捕获后写入, UI 显示红色提示条
  shaderError: '',
  // busy: 有重建/导出等长任务在跑; ready: 首帧已渲染完成 (两者控制 loading 遮罩)
  busy: false,
  ready: false,
  // 生长动画播放开关 (与 params.growth.enabled 不同: 这个只是"暂停画面")
  playing: true,
  activeTab: 'auto',        // 当前参数标签页 (属性搜索跳转会改它)
  archetype: 'oak',
  autoType: null,      // 强制树种 (null = 随机)
  timeScale: 1,
  frameVersion: 0,     // 请求重新取景
  regrowToken: 0,      // 请求"重新长一遍"(只有真正生成新树时才用)
  rebuildVersion: 0,   // 请求强制重建
  materialVersion: 0,  // 请求重新编译自定义 GLSL
  nodeVersion: 0,      // 模型节点表刷新计数
  nodePanelOpen: false, // 右侧「模型节点」面板 (默认不展示)
  // --- 模型节点选中 ---
  // 说明: `ids` / `material` 二选一 —— 要么选中若干节点, 要么选"某个材质整体" (树皮/树叶)。
  selection: {
    ids: [],           // 选中的 node id
    material: null,    // 'bark' | 'leaf' | null
    mode: 'highlight', // highlight | isolate | dim
    activeId: null,    // 详情面板展示的节点
    color: '#ffd166',  // 高亮色 (叠加层描边/自发光)
    glow: 0.35,        // 高亮发光强度 0..1
    dim: 0.35,         // dim 模式下非选中部分的压暗比例 0..1
    label: '',         // 选中摘要文本 (如 "树枝 L1 · 12 个节点"), 由 describeSelection 生成
  },
})

/* ------------------------------------------------------------------ */
/* 模型节点表 (数量可能上千, 放在非响应式容器里, 用 nodeVersion 触发刷新)   */
/* ------------------------------------------------------------------ */
// 为什么不用 reactive: 上千个节点 + 每节点带 bbox 数组, 做成响应式会让 Vue 递归代理
// 每个对象, 重建一次要几毫秒以上; 而 UI 只需要"整表换了一次"这个信号 ->
// 用 state.nodeVersion 这一个响应式数字代替, 消费方 watch 它后自己来读这里的普通数据。
// 结构: nodes 全量; groups 按 type/层级聚合的分组; byId/groupById 是 O(1) 查询索引。
const nodeModel = { nodes: [], groups: [], byId: new Map(), groupById: new Map() }

/**
 * 取节点表原始对象 (非响应式)。
 * 注意: 调用方不要长期持有它 —— `setNodeModel` 会原地替换 `nodes`/`groups` 数组,
 *       上面的 Map 也是重建的; 需要跟着刷新就 watch `state.nodeVersion`。
 * @returns {{nodes: Array<object>, groups: Array<object>, byId: Map, groupById: Map}}
 */
export function getNodeModel() {
  return nodeModel
}

/**
 * 用新的节点表整体替换 (每次重建几何后由场景层调用)。
 *
 * 除替换数据外还做三件收尾:
 *   1. `state.nodeVersion++` 通知 UI 重新读取;
 *   2. 清理失效选中: 旧节点 id 在新表里可能已不存在 (种子变了/参数变了), 过滤掉,
 *      若过滤后为空且没有材质选中, 清掉详情面板的 activeId;
 *   3. 重算高亮区间与选中包围盒 —— 节点表的 bbox/顶点区间都变了, 不重算的话
 *      黄色选中框会停在旧位置。
 *
 * @param {{nodes?: Array<object>, groups?: Array<object>}} model 新节点表; 字段缺省按空数组
 */
export function setNodeModel(model) {
  nodeModel.nodes = model.nodes || []
  nodeModel.groups = model.groups || []
  nodeModel.byId = new Map(nodeModel.nodes.map((n) => [n.id, n]))
  nodeModel.groupById = new Map(nodeModel.groups.map((g) => [g.id, g]))
  state.nodeVersion++
  // 重建后之前选中的节点可能已不存在
  const alive = new Set(nodeModel.nodes.map((n) => n.id))
  const kept = state.selection.ids.filter((id) => alive.has(id))
  if (kept.length !== state.selection.ids.length) {
    state.selection.ids = kept
    if (kept.length === 0 && !state.selection.material) state.selection.activeId = null
  }
  if (!kept.length && state.selection.material) {
    // 材质节点恒在
  }
  refreshSelectionRanges()
  // 节点表重建后节点 bbox/几何都变了 -> 选中框必须同步重算，
  // 否则移动/旋转单枝时黄色节点框会停在旧位置。
  updateSelectionBox()
}

/**
 * 重算"选中 -> 顶点区间"与摘要文本。
 * `selectionRanges()` 是 pure 函数, 把 node id 列表换算成 `[start, end]` 顶点区间数组,
 * 着色器据此把选中部分高亮; 所以节点表/选中集一变就要重算。
 */
function refreshSelectionRanges() {
  const sel = state.selection
  sel.ranges = selectionRanges(sel.ids)
  sel.label = describeSelection(sel)
}

/**
 * 生成选中摘要文本 (显示在视口角标/详情面板标题)。
 *
 * 三种措辞:
 *   - 多选且同组 -> `树枝 L1 · 12 个节点`;
 *   - 单选        -> `组名 · 节点名` (树干/树根 直接显示节点名, 因为组名与名字重复);
 *   - 多选跨组    -> `7 个节点 (3 组)`。
 * 材质选中会前缀 `材质 · 树皮/树叶`; 两者可同时存在 (用 " + " 连接)。
 *
 * @param {object} sel `state.selection`
 * @returns {string} 摘要文本; 什么都没选时为空串
 */
function describeSelection(sel) {
  if (!sel.ids.length && !sel.material) return ''
  const parts = []
  if (sel.material === 'bark') parts.push('材质 · 树皮')
  else if (sel.material === 'leaf') parts.push('材质 · 树叶')
  const groups = new Set()
  // single 记录"最后一个能查到的节点", 只在单选分支里用到 (ids 里可能有失效 id)
  let single = null
  for (const id of sel.ids) {
    const n = nodeModel.byId.get(id)
    if (!n) continue
    groups.add(n.groupName)
    single = n
  }
  if (groups.size === 1 && sel.ids.length > 1) {
    const g = [...groups][0]
    parts.push(`${g} · ${sel.ids.length} 个节点`)
  } else if (sel.ids.length === 1 && single) {
    parts.push(groups.has('树干') || groups.has('树根') ? single.name : `${single.groupName} · ${single.name}`)
  } else if (sel.ids.length > 1) {
    parts.push(`${sel.ids.length} 个节点 (${groups.size} 组)`)
  }
  return parts.join(' + ')
}

/**
 * 选中一批节点 (替换或追加模式)。
 *
 * @param {number|number[]} ids 节点 id 或 id 数组
 * @param {object} [opts]
 * @param {boolean} [opts.additive] true = 与当前选中集做"切换"(已选中的剔除, 未选中的加入);
 *   false/省略 = 整体替换
 * @param {('bark'|'leaf'|null)} [opts.material] 同时选中某个材质整体; 不传则清空材质选中
 * @param {number} [opts.activeId] 详情面板要展示的节点; 省略则取 ids 的最后一个
 * @returns {void} 副作用: 改 `state.selection` 并重算 ranges/box
 */
export function selectNodes(ids, opts = {}) {
  const sel = state.selection
  const list = Array.isArray(ids) ? ids : [ids]
  if (opts.additive) {
    const set = new Set(sel.ids)
    for (const id of list) {
      // 用 Set 做"异或": 再次点同一个节点就是取消选中
      if (set.has(id)) set.delete(id)
      else set.add(id)
    }
    sel.ids = [...set]
  } else {
    // 去重但不排序: 保留调用方的顺序 (详情面板 default activeId 依赖"最后一个")
    sel.ids = [...new Set(list)]
  }
  sel.material = opts.material || null
  if (opts.activeId !== undefined) sel.activeId = opts.activeId
  else sel.activeId = sel.ids.length ? sel.ids[sel.ids.length - 1] : null
  refreshSelectionRanges()
  updateSelectionBox()
}

/**
 * 选中一个"分组"(节点表里的 group, 例如"树枝 L1"), 或整体选中某个材质。
 *
 * 材质分组 (group.material 有值) 走特殊路径: 只设 material, 清空 ids,
 * 并把选中框直接用分组的 bbox —— 材质没有"顶点区间"概念, 高亮由渲染层按材质处理。
 *
 * @param {string} groupId 分组 id
 * @param {object} [opts] `additive` 追加/切换; `activeId` 指定详情面板展示的节点
 * @returns {void}
 */
export function selectGroup(groupId, opts = {}) {
  const g = nodeModel.groupById.get(groupId)
  if (!g) return
  if (g.material) {
    state.selection.material = g.material
    state.selection.ids = []
    state.selection.activeId = null
    refreshSelectionRanges()
    state.selection.box = g.bbox
    return
  }
  selectNodes(opts.additive && !g.material ? g.nodeIds : g.nodeIds.slice(), {
    additive: opts.additive,
    activeId: opts.activeId !== undefined ? opts.activeId : g.nodeIds[0],
  })
}

/**
 * 清空全部选中状态 (含材质选中、高亮区间、选中框与摘要文本)。
 * 用于"点了空白处"或重建前的复位。
 * @returns {void}
 */
export function clearSelection() {
  const sel = state.selection
  sel.ids = []
  sel.material = null
  sel.activeId = null
  sel.ranges = []
  sel.box = null
  sel.label = ''
}

/** 右侧模型节点面板 (默认收起) */
export function toggleNodePanel(force) {
  // force 省略 = 切换; 传值 = 强制设为该值 (!! 归一成布尔, 便于 UI 直接传事件对象)
  state.nodePanelOpen = force === undefined ? !state.nodePanelOpen : !!force
}

/** 从视口/别处点"节点"时: 打开面板并选中一批节点 */
export function openNodePanel(selectId) {
  state.nodePanelOpen = true
  // selectId 允许 0 (合法 id), 所以必须显式判断 undefined/null 而不是假值判断
  if (selectId !== undefined && selectId !== null) selectNodes([selectId], { activeId: selectId })
}

/**
 * 设置高亮模式。
 * @param {'highlight'|'isolate'|'dim'} mode highlight = 选中发光; isolate = 只显示选中;
 *   dim = 其它部分压暗 (压暗比例见 `selection.dim`)
 */
export function setSelectionMode(mode) {
  state.selection.mode = mode
}

/** 把相机对准当前选中的包围盒 (没有选中框时什么都不做) */
export function focusSelection() {
  const box = state.selection.box
  if (box && sceneApi.focusBox) sceneApi.focusBox(box.min, box.max)
}

/**
 * 把相机对准单个节点的包围盒。
 * @param {number} nodeId 节点 id; 节点不存在或没有 bbox 时安全跳过
 */
export function focusNode(nodeId) {
  const n = nodeModel.byId.get(nodeId)
  if (n && n.bbox && sceneApi.focusBox) sceneApi.focusBox(n.bbox.min, n.bbox.max)
}

/**
 * 重算选中包围盒 (`selection.box`, 世界坐标, 米)。
 *
 * 两种情况:
 *   - 没有选中节点: 若选中的是材质, 用 `material-<name>` 分组的 bbox; 否则为 null;
 *   - 有选中节点: 取所有节点 bbox 的**并集** (逐轴取 min/max)。
 * 这里新建 `{min:[...], max:[...]}` 而不是直接引用节点 bbox 对象:
 * 并集计算会就地修改 min/max 数组, 直接引用会污染节点表里的原始数据。
 */
function updateSelectionBox() {
  const sel = state.selection
  if (!sel.ids.length) {
    const n = sel.material ? nodeModel.groupById.get('material-' + sel.material) : null
    sel.box = n && n.bbox ? n.bbox : null
    return
  }
  let box = null
  for (const id of sel.ids) {
    const n = nodeModel.byId.get(id)
    if (!n || !n.bbox) continue
    // 第一个有效节点: 复制一份数组作为起点 (不要引用原数组, 见上方说明)
    if (!box) box = { min: [...n.bbox.min], max: [...n.bbox.max] }
    else {
      for (let i = 0; i < 3; i++) {
        if (n.bbox.min[i] < box.min[i]) box.min[i] = n.bbox.min[i]
        if (n.bbox.max[i] > box.max[i]) box.max[i] = n.bbox.max[i]
      }
    }
  }
  sel.box = box
}

/**
 * 选中状态签名 (给 Viewport 做变更监听)。
 *
 * 为什么需要: `state.selection` 是深层响应式对象, 直接 watch 它会让每次内部写都触发
 * (包括 ranges/box 的中间态), 容易重复重建高亮。这里把所有会影响渲染的字段拼成一个
 * **字符串签名**, Viewport 只 watch 这个字符串 —— 值不变就不做事。
 * 参与签名的字段: 模式、材质、高亮色/发光/压暗、顶点区间列表、选中框。
 *
 * @returns {string} 由 `;` 分隔的确定性字符串
 */
export function selectionSignature() {
  const s = state.selection
  return [
    s.mode, s.material || '', s.color, s.glow, s.dim,
    (s.ranges || []).map((r) => r.join('-')).join(','),
    s.box ? s.box.min.join(',') + '|' + s.box.max.join(',') : '',
  ].join(';')
}

/* ---------------- 撤销 / 重做 ----------------
 * 用"参数 JSON 快照"而不是命令模式: 参数是纯数据树, 快照 = 一次 JSON.stringify,
 * 实现简单且不会漏掉某个字段。代价是内存 (每份快照几 KB~几十 KB) 与深拷贝开销,
 * 所以限制 40 步; 连续相同快照会被去重 (见 pushUndo)。
 */
const undoStack = []
const redoStack = []
const MAX_UNDO = 40

/** 由 Viewport 注入的场景操作 (导出/截图/取景) */
export const sceneApi = {
  exportGLB: null,
  exportOBJ: null,
  screenshot: null,
  prepareExport: null,
  frameCamera: null,
  focusBox: null,
  getWindScreenBasis: null,
  makeImpostor: null,
  setImpostorModel: null,
  rebuildNow: null,
}

/** 当前参数的 JSON 快照 (撤销栈的最小存储单元) */
function snapshot() {
  return JSON.stringify(state.params)
}

/**
 * 记录一次可撤销的快照 (在修改前调用)。
 *
 * 语义: "调用者即将改动参数, 先把**旧值**记下来"。因此必须在改之前调用,
 * 这一条纪律在本文件的所有动作里统一遵守。
 * 两个去重/清理细节:
 *   - 与栈顶快照完全相同则不入栈 (避免"点了滑杆但值没变"产生一堆等价快照);
 *   - 入栈后清空 redo 栈: 一旦有了新的分支, 旧的"重做"路径就失效了。
 */
export function pushUndo() {
  const snap = snapshot()
  if (undoStack[undoStack.length - 1] === snap) return
  undoStack.push(snap)
  // 超过上限丢最旧的一条 (shift 是 O(n), 但 MAX_UNDO=40 时可忽略)
  if (undoStack.length > MAX_UNDO) undoStack.shift()
  redoStack.length = 0
}

/** 能否撤销 (计算属性, 供按钮禁用态使用) */
export const canUndo = computed(() => undoStack.length > 0)
/** 能否重做 (计算属性, 供按钮禁用态使用) */
export const canRedo = computed(() => redoStack.length > 0)

/**
 * 撤销: 把当前参数推进 redo 栈, 弹出 undo 栈顶并作为新参数。
 * JSON.parse 得到的是普通对象, 必须再过一遍 `normalizeParams` 补齐/校验字段
 * (旧快照可能来自更早版本的参数结构, 缺字段会导致下游 undefined)。
 * @returns {boolean} 是否真的撤销了一步 (栈空时返回 false)
 */
export function undo() {
  if (!undoStack.length) return false
  const cur = snapshot()
  const prev = undoStack.pop()
  redoStack.push(cur)
  state.params = normalizeParams(JSON.parse(prev))
  return true
}

/**
 * 重做: 与 undo 对称 (弹出 redo 栈顶, 把当前值压回 undo 栈)。
 * @returns {boolean} 是否真的重做了一步 (栈空时返回 false)
 */
export function redo() {
  if (!redoStack.length) return false
  const cur = snapshot()
  const next = redoStack.pop()
  undoStack.push(cur)
  state.params = normalizeParams(JSON.parse(next))
  return true
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */
/* 约定 (所有动作都适用):
 *   1) 会改参数的"用户可见操作"先 `pushUndo()` (随机换种子这类也算一步可撤销操作);
 *   2) 改完参数后, 由 Viewport 的 watch 依据参数变化自动重建 ——
 *      动作本身**不直接**调重建 (除少数必须显式 bump 版本号的场景);
 *   3) 想"重建并重新取景"用 `rebuildVersion++`; 只想重新取景用 `frameVersion++`;
 *      换了全新一棵树 (要重播生长动画) 才用 `regrowToken++`。三者语义不能混。
 */

/**
 * 直接设置随机种子 (不触发 undo 记录, 由调用方决定是否需要)。
 * @param {number} seed 种子; 内部取整并保证 >= 1 (0/NaN/负数都退化成 1)
 * @returns {void} 副作用: 覆盖 `params.seed`, 并清空逐枝手工编辑 `branchEdits`
 *   (枝编辑是"相对于某个骨架"的偏移, 换了种子骨架就变了, 必须清掉否则会错位)
 */
export function setSeed(seed) {
  state.params.seed = Math.max(1, Math.floor(seed) || 1)
  state.params.branchEdits = {}
}

/**
 * 随机换一个种子, 并按新种子重挑叶片/花朵素材与风场参数。
 * 这是"刷新一下看看"这个按钮的实现: 一步可撤销, 且保持用户当前树种/阶段/季节不变。
 * @returns {void}
 */
export function randomizeSeed() {
  pushUndo()
  state.params.seed = randomSeed()
  state.params.branchEdits = {}
  // 素材与风场都由种子决定 -> 必须跟着换, 否则"换了种子但叶子还是旧的"会显得随机没生效
  randomizeFoliageAssets(state.params.seed)
  if (state.params.wind.auto) {
    Object.assign(state.params.wind, autoWind(state.params.seed, state.params.wind.intensity))
  }
}

/** 请求"按当前参数重建"(+ 重新取景); 不产生新种子, 也不重播生长动画 */
export function regenerateNow() {
  state.rebuildVersion++
}

/**
 * 由种子自动生成一棵完整的树
 *
 * 与"应用预设"的区别: 预设是手工调好的参数组, 而这里是**程序化生成**——
 * `autoGenerate(seed, chaos, type)` 会返回一整套随机但协调的参数 + 实际用到的树种。
 *
 * 关键点: 生成结果会**覆盖**大部分参数, 但用户的"环境/材质/生长/LOD/自定义 GLSL"
 * 必须保留 (用户只是点了"随机", 不该把调好的天空和材质冲掉), 所以用 `mergeParams`
 * 把 `keep` 里的几组覆盖回去。
 *
 * @param {object} [opts]
 * @param {number} [opts.seed] 指定种子; 省略则随机
 * @param {number} [opts.chaos] 混乱度 (来自 UI 的 auto.chaos); 省略则沿用当前值
 * @param {string|null} [opts.type] 强制树种 id; 省略则用 `state.autoType` (null = 随机)
 * @returns {string} 实际使用的树种 id (可能由 autoGenerate 随机决定)
 */
export function doAutoGenerate(opts = {}) {
  pushUndo()
  state.params.branchEdits = {}
  const seed = opts.seed !== undefined ? opts.seed : (randomSeed())
  const chaos = opts.chaos !== undefined ? opts.chaos : state.params.auto.chaos
  const type = opts.type !== undefined ? opts.type : state.autoType
  const { params, type: usedType } = autoGenerate(seed, chaos, type || null)
  // 保留场景/材质/自定义 GLSL 等用户设置
  // cloneParams 是深拷贝: 后面的 mergeParams 会写这些子对象, 不克隆就会改到旧 params
  const keep = {
    scene: cloneParams(state.params.scene),
    custom: cloneParams(state.params.custom),
    bark: { ...cloneParams(state.params.bark), ...pickBarkOverrides(state.params) },
    leafMat: { ...cloneParams(state.params.leafMat) },
    growth: cloneParams(state.params.growth),
    lod: cloneParams(state.params.lod),
  }
  const next = mergeParams(params, keep)
  state.params = normalizeParams(next)
  // 显式回写: mergeParams/normalizeParams 不保证保留 seed 与 chaos (它们属于"生成输入"不是"生成结果")
  state.params.seed = seed
  state.params.auto.chaos = chaos
  state.archetype = usedType
  state.regrowToken++   // 这是一棵新树: 让它重新长一遍
  return usedType
}

/**
 * 从当前树皮设置里挑出"用户覆盖项", 用于在自动生成后保留手工调整。
 *
 * 只挑**用户可能手动改过的表现类字段** (贴图/色调/UV 缩放/顶点色混合/粗糙度/法线…),
 * 不挑结构性字段 (花纹类型等), 这样"随机换树"后仍沿用预设的花纹风格但保留用户微调。
 * `if (b.texture)` 的额外一行: 只有用户真的选了自定义贴图时, 才连 `procedural`
 * 一起保留, 否则让它跟随新预设 (是否用程序化花纹)。
 *
 * @param {object} p `state.params`
 * @returns {object} 可以直接 merge 回新参数 `bark` 的覆盖项
 */
function pickBarkOverrides(p) {
  // 保留用户自定义贴图 / 调节值, 但让预设的花纹风格生效
  const b = p.bark
  const out = {
    texture: b.texture,
    normalTexture: b.normalTexture,
    tint: b.tint,
    uvScaleU: b.uvScaleU,
    uvScaleV: b.uvScaleV,
    vertexColorMix: b.vertexColorMix,
    roughness: b.roughness,
    metalness: b.metalness,
    normalScale: b.normalScale,
    bump: b.bump,
  }
  if (b.texture) out.procedural = b.procedural
  return out
}

/**
 * 应用一个"树种预设"(只换树种, 阶段/季节沿用当前值)。
 *
 * 与 `doAutoGenerate` 的区别: 预设是手工调好的参数组 (确定性), 不走随机生成,
 * 所以这里是"读表 + 覆盖 params", 不涉及 seed。
 * 副作用: 记录 undo、清空逐枝手工编辑、更新 `state.archetype`、自动模式下重算风场,
 * 最后 `rebuildVersion++` 让 Viewport 重建几何**并重新取景** (换树种尺寸可能剧变)。
 * @param {string} id 预设 id (与 treeStore 外部的 presets 表一致)
 * @returns {void}
 */
export function doApplyPreset(id) {
  pushUndo()
  state.params = normalizeParams(applyPreset(state.params, id))
  state.params.branchEdits = {}
  state.archetype = id
  if (state.params.wind.auto) {
    Object.assign(state.params.wind, autoWind(state.params.seed, state.params.wind.intensity))
  }
  state.rebuildVersion++   // 重建并重新取景
}

/**
 * 按"树种 + 生长阶段 + 季节"重新生成 (三维预设)。
 *
 * 这是主界面最常用的组合切换: 三个维度一起哈希成一套参数。
 * `state.classifySig` 记录 `树种/阶段/季节` 字符串, 供 UI 高亮当前组合;
 * 注意它不在 `state` 的初始声明里, 属于"用到才创建"的字段。
 * `rebuildVersion++` 而不是 `regrowToken++`: 这是"换参数重建", 用户正在看的视角要尽量保留,
 * 但尺寸可能剧变所以仍要重新取景 (见下方注释)。
 *
 * @param {string} speciesId 树种 id
 * @param {string} stageId 生长阶段 id (sapling/young/mature/ancient)
 * @param {string} seasonId 季节 id (spring/summer/autumn/winter)
 * @returns {object} 新的 `state.params.classify` (当前分类信息, 供调用方显示)
 */
export function applyClassification(speciesId, stageId, seasonId) {
  pushUndo()
  state.params = normalizeParams(applyPreset(state.params, speciesId, stageId, seasonId))
  state.archetype = speciesId
  state.classifySig = `${speciesId}/${stageId}/${seasonId}`
  if (state.params.wind.auto) {
    Object.assign(state.params.wind, autoWind(state.params.seed, state.params.wind.intensity))
  }
  // 大树 -> 树苗这种尺寸剧变要重新取景, 否则新树可能只有几个像素
  state.rebuildVersion++
  return state.params.classify
}

/**
 * 应用一张内置叶片卡片 (贴图 + 卡片几何 + 宽高比)。
 *
 * 一条"换叶子外观"的完整操作, 一次性改四个地方:
 *   - `leaves.cardMode = true`      : 用卡片(四边形)而不是程序化叶形;
 *   - `leaves.cardAspect = aspect`  : 卡片宽高比跟随贴图, 否则叶子会被拉扁;
 *   - `leafMat.texture / textureHasAlpha` : 贴图落在**树叶材质**上 (不在 leaves 组里);
 *   - `leafMat.tintMode = 'texture'`: 见下方注释 (不要乘季节顶点色)。
 * `alphaTest` 夹到 0.2..0.5: 太低会把贴图的透明背景画成黑边, 太高会把细叶尖裁掉。
 *
 * @param {string} cardId 卡片 id
 * @param {{alphaTest?: number}} [opts] 指定裁切阈值 (省略则沿用当前值/默认 0.35)
 * @returns {object|null} 卡片对象; id 不存在时返回 null (不抛错, 便于"随机挑一张"的调用方处理)
 */
export function applyLeafCard(cardId, opts = {}) {
  const card = LEAF_CARD_BY_ID.get(cardId)
  if (!card) return null
  pushUndo()
  const p = state.params
  p.leaves.cardMode = true
  p.leaves.cardAspect = card.aspect
  p.leafMat.texture = card.url
  p.leafMat.textureHasAlpha = true
  // 卡片是照片级贴图: 默认直接用贴图原色 (顶点色是季节调色板, 乘上去会把橙色叶子染绿)
  p.leafMat.tintMode = 'texture'
  if (opts.alphaTest !== undefined) p.leafMat.alphaTest = opts.alphaTest
  p.leafMat.alphaTest = Math.max(0.2, Math.min(0.5, p.leafMat.alphaTest || 0.35))
  state.cardId = card.id
  // 注意: 不要 bump rebuildVersion —— 它的语义是"重建 + 重新取景",
  // 换叶片贴图/叶形不该把用户正在看的视角拉回去。
  // 几何变化 (leaves.cardMode/cardAspect) 由 Viewport 的几何组 watcher 自动触发重建。
  return card
}

/**
 * 读取图片真实宽高比 (宽/高)。
 *
 * 用 `new Image()` 加载而不是从材质纹理读: 纹理可能是被压缩/翻转过的副本,
 * 只有原始图片的 `naturalWidth/naturalHeight` 才是贴图作者意图的比例。
 * `crossOrigin = 'anonymous'`: 内置素材可能要经过同源/跨域加载, 不设会被 canvas 污染
 * (本函数只读尺寸, 但同一张图别处可能被画进 canvas)。
 * 失败/缺尺寸一律 resolve(0) 而不是 reject —— 调用方用 `if (!aspect)` 统一处理,
 * 不能让"图片 404"变成未捕获的 Promise 异常。
 * @param {string} url 图片地址
 * @returns {Promise<number>} 宽高比; 加载失败或尺寸为 0 时返回 0
 */
function imageAspect(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(0)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0)
    img.onerror = () => resolve(0)
    img.src = url
  })
}

/**
 * 适配贴图尺寸: 把卡片宽高比设成贴图真实比例 (树叶)
 * 用户换了自定义贴图后点"适配", 让叶片不再被拉伸。
 * @returns {Promise<number>} 实际设置的宽高比; 读不到尺寸时返回 0 且**不**改参数/不入 undo
 */
export async function fitLeafCardToTexture() {
  const url = state.params.leafMat.texture
  const aspect = await imageAspect(url)
  if (!aspect) return 0
  // 先取尺寸再 pushUndo: 异步等待期间用户可能又改了点别的, 快照要反映"落笔前"的状态
  pushUndo()
  state.params.leaves.cardAspect = +aspect.toFixed(3)
  return aspect
}

/**
 * 适配贴图尺寸 (花朵) —— 与 `fitLeafCardToTexture` 完全对称, 只是落在 `params.flower` 上。
 * @returns {Promise<number>} 实际设置的宽高比; 读不到尺寸时返回 0
 */
export async function fitFlowerCardToTexture() {
  const url = state.params.flower.texture
  const aspect = await imageAspect(url)
  if (!aspect) return 0
  pushUndo()
  state.params.flower.cardAspect = +aspect.toFixed(3)
  return aspect
}

/**
 * 应用一张内置卡片作为花朵贴图 (参照树叶 applyLeafCard)
 * 注意这里是"3D 花冠表面贴图", 不是独立的平面卡片, 所以只改 `params.flower` 的贴图相关字段。
 * @param {string} cardId 卡片 id
 * @returns {boolean} 是否应用成功 (id 不存在为 false)
 */
export function applyFlowerCard(cardId) {
  const card = LEAF_CARD_BY_ID.get(cardId) || LEAF_CARDS.find((c) => c.id === cardId)
  if (!card) return false
  const f = state.params.flower
  f.texture = card.url
  f.cardId = card.id
  f.cardMode = true
  f.cardAspect = card.aspect || 1
  f.tintMode = 'texture'
  f.alphaTest = 0.35
  if (!f.enabled) f.enabled = true
  return true
}

/**
 * 随机一张花朵卡片 (从"看起来像花朵"的批次里挑)。
 *
 * 池子判定比较宽松: batch 以 `fl_` 开头、名字/批次里含 `flower`、或属于 batch1/batch2 ——
 * 因为卡片库是构建期扫目录生成的, 批次命名历史上有过几套约定, 宁可多包含一点,
 * 让用户在"随机花朵"里也能抽到普通叶片批次中的花朵资源。
 * @returns {boolean} 是否成功应用 (池子为空或卡片不存在时为 false)
 */
export function randomFlowerCard() {
  const pool = LEAF_CARDS.filter((c) => /^fl_|flower/i.test(c.batch) || c.batch.startsWith('fl_') || c.batch === 'batch1' || c.batch === 'batch2')
  // 这里刻意用 Math.random: "随机再来一张"是纯 UI 手势, 不需要可复现性 (也不进参数/导出)
  const card = pool[Math.floor(Math.random() * pool.length)]
  return card ? applyFlowerCard(card.id) : false
}

/**
 * 树叶/花朵默认从素材库随机挑选 (不用颜色绘制):
 * - 树叶: 卡片模式 + 随机叶子卡片 + 原色贴图
 * - 花朵: 随机花朵卡片作为 3D 花冠表面贴图 (不是平面卡片)
 * 由 seed 决定, 同一个种子外观一致.
 *
 * 两段式设计 (很重要):
 *   ① **同步段**立即按种子选出卡片并写进参数 —— 保证首帧就有叶子, 不会出现"先光秃再长叶";
 *   ② **异步段** (IIFE) 逐个探测贴图是否真能加载 (卡片库是"路径枚举", 存在空位/404),
 *      失败就换成能用的卡片, 全都不行则退回程序化叶形。异步段不 pushUndo,
 *      因为它是"修正"而不是用户操作, 不该占用撤销栈。
 * 随机纪律: 两段都用 `seed + 固定标签` 的子流 ('foliage-assets' / 'leaf-verify' / 'flower-verify'),
 *   所以同一种子既复现外观, 又不会因为别处加了一次随机而整体漂移。
 *
 * @param {number} [seed=state.params.seed] 种子
 * @returns {{leaf: string, flower: string}} 同步段选中的卡片 id (异步修正后可能变化, 以 state 为准)
 */
export function randomizeFoliageAssets(seed = state.params.seed) {
  const rng = makeRng(seed, 'foliage-assets')
  const leafCard = randomLeafAsset(() => rng.next())
  const flowerCard = randomFlowerAsset(() => rng.next())
  const L = state.params.leaves
  const M = state.params.leafMat
  L.cardMode = true
  // `|| 1`: 卡片数据里 aspect 可能缺失/为 0, 用 1 兜底避免几何被压成一条线
  L.cardAspect = leafCard.aspect || 1
  // 叶子贴图在"树叶材质"上 (与 applyLeafCard 一致)
  M.texture = leafCard.url
  M.textureHasAlpha = true
  M.tintMode = 'texture'
  M.alphaTest = 0.35
  state.cardId = leafCard.id
  L.cardId = leafCard.id      // 面板高亮用
  const F = state.params.flower
  // 没抽到花朵卡片时保留原有花朵设置 (可能用户手动指定过, 或本来就不用花)
  if (flowerCard) {
    F.cardId = flowerCard.id
    F.texture = flowerCard.url
    F.cardAspect = flowerCard.aspect || 1
    F.tintMode = 'texture'
    // 花朵卡片的透明背景是黑色 RGB + 0 alpha；alphaTest=0 会把整张黑色背景也画出来。
    // 必须保留裁切阈值（和 applyFlowerCard 的默认值一致），否则花朵周围会出现黑边/黑块。
    F.alphaTest = 0.35
  }
  // 异步校正: 卡片库是路径枚举 (有空位), 只保留真实存在的卡片;
  // 若当前这张 404, 换成真实存在的; 全都探测不到 -> 退回程序化叶形 (宁可样式变, 不要光秃秃)
  // `const seedAt = seed` + 下面的 `;(async () => ...)`: 先把种子固定下来, 避免异步执行时
  // `state.params.seed` 已被用户改成别的值, 导致"校验用的种子"与"选卡片用的种子"不一致。
  const seedAt = seed
  ;(async () => {
    // 最多试 6 张: 卡片库里有小段空位, 6 次基本一定能落到一张真实存在的图上
    const leafOk = await pickExistingCard('leaf', () => makeRng(seedAt, 'leaf-verify').next(), 6)
    if (!leafOk) {
      state.params.leaves.cardMode = false   // 兜底: 程序化叶形 (一定可见)
      return
    }
    // 只有探测结果与当前卡片不同才写参数: 避免把用户在这期间手动换的卡片又改回去...
    // (这里的判据是"当前参数里的 cardId", 所以用户刚手动换过时通常不会命中重写)
    if (leafOk.id !== state.params.leaves.cardId) {
      state.params.leafMat.texture = leafOk.url
      state.params.leaves.cardId = leafOk.id
      state.params.leaves.cardAspect = leafOk.aspect || 1
      state.cardId = leafOk.id
    }
    const flowerOk = await pickExistingCard('flower', () => makeRng(seedAt, 'flower-verify').next(), 6)
    if (flowerOk && flowerOk.id !== state.params.flower.cardId) {
      state.params.flower.texture = flowerOk.url
      state.params.flower.cardId = flowerOk.id
      state.params.flower.cardAspect = flowerOk.aspect || 1
    }
  })()
  return { leaf: leafCard.id, flower: flowerCard ? flowerCard.id : '' }
}

/**
 * 生成伪装卡 (atlas = 图集伪装卡, cross = 交叉卡)
 *
 * 真正的渲染在 `sceneApi.makeImpostor` (Viewport.vue 注入), 这里只负责
 * 置忙状态、保存结果、并自动切到"卡片预览"模式 (让用户马上看到效果)。
 * `impostorBusy` 由 finally 复位: 生成过程可能抛错 (WebGL 上下文丢失/尺寸非法),
 * 若不用 finally, 出错后按钮会永远卡在 loading。
 * @param {object} [opts] 透传给生成器: `{mode, views, size, elevations}`
 * @returns {object|null} 生成结果 (dataUrl/width/height/coverage/meta)
 */
export function doGenerateImpostor(opts = {}) {
  state.impostorBusy = true
  try {
    const res = sceneApi.makeImpostor(opts)
    state.impostorResult = res
    setImpostorPreview(true)        // 生成后自动在主预览区以 3D 面片展示 (可环绕)
    return res
  } finally {
    state.impostorBusy = false
  }
}

/** 切换参数标签页 (属性搜索跳转会用到) */
export function setActiveTab(tab) {
  // 空串/undefined 忽略: 属性搜索在没有命中时也会调用它, 不该把当前标签清空
  if (tab) state.activeTab = tab
}

/**
 * 开关"伪装卡预览"模式。
 *
 * 行为: 预览开启时把伪装卡作为一个 impostor 面片放进场景 (可像模型一样环绕观察),
 * 关闭时移除。**注意 `state.impostorResult` 不会被清空**, 关掉预览再打开仍能看到上次结果。
 * @param {boolean} on true = 显示 3D 卡片面片; false = 拿掉面片回到真实树
 * @returns {void}
 */
export function setImpostorPreview(on) {
  state.impostorPreview = !!on
  // 3D 预览: 把伪装卡作为一个 impostor 面片放进场景 (可以像模型一样环绕观察)
  if (on && state.impostorResult) {
    sceneApi.setImpostorModel(state.impostorResult)
  } else {
    // 没有结果却要求开启时也走这里 -> 传 null, 等价于"确保场景里没有卡片面片"
    sceneApi.setImpostorModel(null)
  }
}

/**
 * 下载伪装卡 PNG (+ 可选元信息 JSON)。
 *
 * 文件名带 mode/views/size, 便于同一目录下多次导出后区分:
 * `impostor-atlas-8v-512.png` / `.json`。
 * PNG 直接用 dataUrl 作为 href (不转 Blob); JSON 则要手动建 objectURL, 并在 2s 后释放。
 * @param {boolean} [withMeta=true] 是否同时下载视角元信息 JSON (运行时摆放卡片需要它)
 * @returns {boolean} 是否执行了下载 (没有生成结果时为 false)
 */
export function downloadImpostor(withMeta = true) {
  const res = state.impostorResult
  if (!res) return false
  const a = document.createElement('a')
  a.href = res.dataUrl
  a.download = `impostor-${res.meta.mode}-${res.meta.views}v-${res.meta.size}.png`
  a.click()
  if (withMeta) {
    const blob = new Blob([JSON.stringify(res.meta, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `impostor-${res.meta.mode}-${res.meta.views}v.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 2000)
  }
  return true
}

/**
 * 按批次/折行范围随机换一张叶片卡片。
 * @param {string} [batch] 批次名 (省略 = 全库)
 * @param {number} [row] 图片折行号 (省略 = 不限); 用于"同一张贴图集里的某一行"这种挑选
 * @returns {object|null} 卡片对象; 过滤后为空时为 null
 * 注意: 这里用 Math.random 而不是种子子流 —— 属于用户手动"再来一张", 不要求可复现。
 */
export function randomLeafCard(batch, row) {
  const pool = LEAF_CARDS.filter((c) => (!batch || c.batch === batch) && (!row || c.row === row))
  if (!pool.length) return null
  return applyLeafCard(pool[Math.floor(Math.random() * pool.length)].id)
}

/**
 * 随机换一组"树种 × 阶段 × 季节"。
 * 三个维度各自用 Math.random 独立抽取 —— 这是"给我看点不一样的"这种探索型操作,
 * 刻意不做种子复现; 真正需要复现时用 setSeed/导入参数。
 * @returns {object} 新的分类信息 (applyClassification 的返回值)
 */
export function randomClassification() {
  const species = SPECIES[Math.floor(Math.random() * SPECIES.length)].id
  const stage = GROWTH_STAGES[Math.floor(Math.random() * GROWTH_STAGES.length)].id
  const season = SEASONS[Math.floor(Math.random() * SEASONS.length)].id
  return applyClassification(species, stage, season)
}

/** 风力滑杆: 自动模式下一并重算风向/阵风/湍流 */
export function setWindIntensity(v) {
  state.params.wind.intensity = v
  // 手动模式下只改总强度, 其它风参数保持用户微调过的值
  if (state.params.wind.auto) {
    Object.assign(state.params.wind, autoWind(state.params.seed, v))
  }
}

/**
 * 随机一套风场 (风向 + 由风力推出的全部参数)。
 *
 * 注意 `autoWind` 的第一个参数用的是**临时随机种子** (1..900000) 而不是当前的
 * `state.params.seed`: 这样"随机风"不会因为树种子没变而得到同一套风 ——
 * 风的随机性独立于树的随机性, 但一旦写进参数就固定下来 (可导出可复现)。
 * @returns {void}
 */
export function randomizeWind() {
  pushUndo()
  const dir = Math.floor(Math.random() * 360)
  const next = autoWind(Math.floor(Math.random() * 900000) + 1, state.params.wind.intensity)
  // direction 放在后面覆盖: 让"随机风向"优先于 autoWind 由种子推出的方向
  Object.assign(state.params.wind, next, { direction: dir })
}

/**
 * 开关风的"自动模式"。
 * 打开时立刻按当前种子与风力重算所有风参数 (否则界面显示"自动"但数值还是旧的手调值)。
 * @param {boolean} v true = 自动 (隐藏细调滑杆, 由 intensity 驱动全部参数)
 */
export function setWindAuto(v) {
  state.params.wind.auto = v
  if (v) Object.assign(state.params.wind, autoWind(state.params.seed, state.params.wind.intensity))
}

/**
 * 把某一组参数恢复成默认值 (可撤销)。
 * @param {string} section 参数组名 ('all' = 全部恢复默认; 'branches' = 逐枝结构;
 *   其它 = `state.params` 上的同名子对象)
 * @returns {void}
 * 注意: `section === 'branches'` 单独一条分支, 是因为枝条参数在 params 里可能被
 * 拆到多处 (branchEdits 与 branches 分离), 只重置 branches 才会同时保留手工枝编辑。
 * 未知 section 会被静默忽略 (不会把 params 弄坏)。
 */
export function resetSection(section) {
  pushUndo()
  const d = defaultParams()
  if (section === 'all') {
    state.params = d
    return
  }
  if (section === 'branches') {
    state.params.branches = d.branches
    return
  }
  if (state.params[section] !== undefined) {
    state.params[section] = d[section]
  }
}

/**
 * 导入参数 JSON 文本 (用于"载入之前保存的参数文件")。
 *
 * 兼容两种输入形状:
 *   - 完整文件: `{format, version, seed, params}` -> 取 `data.params`;
 *   - 裸参数对象 (手写/旧版本导出) -> 直接把整个对象当参数。
 * 无论哪种都要过 `normalizeParams`: 参数结构可能来自旧版本, 缺字段会被补齐,
 * 否则下游 `params.组名.字段名` 会读到 undefined 而崩在很远的地方。
 * 解析失败会抛出 `SyntaxError` (由调用方 try/catch 转成用户可见的错误提示)。
 * @param {string} text JSON 文本
 * @returns {object} 导入后的 `state.params`
 */
export function importParamsJSON(text) {
  const data = JSON.parse(text)
  const raw = data && data.params ? data.params : data
  pushUndo()
  state.params = normalizeParams(raw)
  return state.params
}

/**
 * 按当前种子重新推导一整套自动风参数 (不改变 intensity)。
 * 用于"种子换了但风没跟着变"的场景 (例如外部脚本直接改了 seed)。
 * 与 `setWindAuto(true)` 的区别: 这里不检查/修改 `wind.auto` 开关。
 * @returns {void}
 */
export function applyWindAutoFromSeed() {
  Object.assign(state.params.wind, autoWind(state.params.seed, state.params.wind.intensity))
}

/**
 * 当前"树种"的显示名 (计算属性)。
 * 优先级: 强制树种 `autoType` > 已知预设 `archetype` > 字面量"随机"。
 * 注意 `autoType` 为真时即使 archetype 有值也优先显示 autoType —— 因为自动生成时
 * archetype 会被写成"实际用到的树种", 而用户显式选的 autoType 才是他关心的信息。
 */
export const archetypeLabel = computed(() => {
  if (state.autoType) return archetypeName(state.autoType)
  return presetById(state.archetype) ? archetypeName(state.archetype) : '随机'
})

/** 全模三角面数 (计算属性): 树皮+树叶+花朵, 口径见 core/modelStats.js */
export const totalTriangles = computed(() => modelTriangleCount(state.stats))

// 开发期把 store 挂到 window, 方便在浏览器控制台里调试 / 脚本化验证
// 只在 DEV 且存在 window 时执行: 生产构建里 `import.meta.env.DEV` 为 false 会被整体摇掉,
// 不会把内部函数泄漏到全局。`__fastTree` 给状态, `__fastTreeApi` 给一组动作 (函数不能被序列化,
// 但挂在 window 上可以直接调用, 便于自动化脚本触发"随机换树/换卡片/生成伪装卡")。
if (typeof window !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  window.__fastTree = state
  window.__fastTreeApi = {
    pushUndo, doAutoGenerate, doApplyPreset, setSeed, randomizeSeed,
    doGenerateImpostor, downloadImpostor, setImpostorPreview,
    applyFlowerCard, randomFlowerCard, randomizeFoliageAssets,
    fitLeafCardToTexture, fitFlowerCardToTexture,
    applyClassification, randomClassification, applyLeafCard, randomLeafCard,
  }
}

