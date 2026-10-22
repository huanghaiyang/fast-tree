/**
 * 应用命令注册表 (唯一真相来源)
 * ------------------------------------------------------------
 * 服务端 MCP (scripts/app-bridge-server.mjs) 直接 import 这份定义,
 * 浏览器侧 appApi.js 负责实现这些命令的 handler。
 * 所以"MCP 暴露的能力"与"应用实际能力"始终对齐:
 * 新增功能 -> 在这里加一条 + appApi 里加 handler -> MCP/大模型立刻可用。
 *
 * 作用: 用一份声明式表, 同时描述"应用支持哪些命令"和"每个命令要什么参数",
 *       再由此自动派生出 MCP `tools/list` 的 JSON Schema。
 * 输入 / 输出: 本模块只导出**静态数据 + 两个纯函数**, 没有任何副作用, 也不碰 Vue/Three。
 * 与其他模块的关系:
 *   - `scripts/app-bridge-server.mjs` (Node 侧) 读 `COMMANDS` / `toolsForMcp()`,
 *     把命令逐条注册成 MCP tool;
 *   - `src/core/appApi.js` (浏览器侧) 按 `COMMANDS[i].name` 提供 handler,
 *     收到调用后 `fromToolName()` 还原成带点的命令名再分发;
 *   - UI 侧不建议硬编码命令字符串, 从 `COMMAND_NAMES` 取。
 * 关键约定:
 *   1) 命令名统一 `app.` 前缀 + 蛇形小写, 点号只在内部使用; MCP 工具名不能带点,
 *      所以对外用 `app_<命令名>` (见 `toToolName`), 两者必须可逆 —— 这条不变量由本文件维护;
 *   2) `description` 是**写给大模型看的**, 要写清"做什么 + 关键参数语义", 不是写给用户看的;
 *   3) 参数描述对象统一形状 `{type, required?, enum?, description?}`:
 *      只有 `type` 是必需的, `required: true` 表示必填, `enum` 限定取值;
 *      `required` 是本文件内部的简化写法, 不是 JSON Schema 关键字 (派生时才翻译成 `required` 数组)。
 */

/* ---------------- 枚举白名单 ----------------
 * 这些数组同时是"校验范围"和"给大模型的候选值提示"。
 * 必须与 src/core/species.js 的 SPECIES / GROWTH_STAGES / SEASONS 的 id 保持一致,
 * 否则 MCP 侧合法、应用侧查不到对应预设 (会静默回退到默认值)。
 */
const SPECIES = ['oak', 'sakura', 'birch', 'maple', 'pine', 'willow', 'banyan']
const STAGES = ['sapling', 'young', 'mature', 'ancient']
const SEASONS = ['spring', 'summer', 'autumn', 'winter']
// app.toggle 支持的开关目标; 顺序与 README/自检脚本里的列举顺序一致
const TARGETS = [
  'leaves', 'flower', 'fruit', 'fall', 'litter', 'flowerFall', 'flowerLitter',
  'particles', 'roots', 'playing', 'wireframe',
]

/**
 * 命令声明简写: 省掉重复的 `params: {}` 样板。
 * 注意 `params = {}` 的默认值让"无参命令"可以只写前两个参数。
 * @param {string} name 点分命令名 (`app.<动词>`, 例如 `app.set_params`)
 * @param {string} description 给大模型读的一句话说明
 * @param {Object<string, {type: string, required?: boolean, enum?: string[], description?: string}>} [params]
 *   参数名 -> 参数描述对象
 */
const CMD = (name, description, params = {}) => ({ name, description, params })

/**
 * 全部命令清单 —— **本文件的唯一真相来源**。
 * 每条命令的 params 写法见上方 `CMD` 的说明; 加命令时同步在 `src/core/appApi.js` 补 handler。
 */
export const COMMANDS = [
  // ---- 元信息 / 帮助 ----
  CMD('app.help', '列出全部可用命令 (名称/说明/参数)'),
  CMD('app.status', '应用状态: 树种/阶段/季节, 树叶/花朵/果实数量, 三角面数, 节点数'),
  CMD('app.selfcheck', '应用侧自检: 场景/材质/着色器/卡片库/贴图/命令处理器'),
  // ---- 参数读写 (整组 / 点路径批量 / 全量导入导出) ----
  CMD('app.get_params', '读取参数 (group 可选: geometry/material/wind/scene/leaves/flower/flowerFall/flowerLitter)', { group: { type: 'string' } }),
  CMD('app.set_params', '按点路径批量改参数, 例 {"leaves.size":0.4,"flower.enabled":true}', { patch: { type: 'object', required: true } }),
  CMD('app.export_params', '导出完整参数 JSON 字符串'),
  CMD('app.import_params', '导入参数 JSON 字符串并重建', { json: { type: 'string', required: true } }),
  // ---- 树种 / 阶段 / 季节组合 ----
  CMD('app.list_species', '列出树种/阶段/季节/全部组合'),
  CMD('app.apply_preset', '应用树种+阶段+季节', {
    species: { type: 'string', enum: SPECIES, required: true },
    stage: { type: 'string', enum: STAGES },
    season: { type: 'string', enum: SEASONS },
  }),
  CMD('app.set_species', '只换树种 (保留阶段/季节)', { species: { type: 'string', enum: SPECIES, required: true } }),
  CMD('app.set_stage', '只换生长阶段', { stage: { type: 'string', enum: STAGES, required: true } }),
  CMD('app.set_season', '只换季节', { season: { type: 'string', enum: SEASONS, required: true } }),
  // ---- 种子与重建 (都会让整棵树重新生成, 属于"重"操作) ----
  CMD('app.randomize', '随机种子 (+ 可选随机树种/季节) 并重建', { all: { type: 'boolean' } }),
  CMD('app.set_seed', '设置随机种子', { seed: { type: 'number', required: true } }),
  CMD('app.rebuild', '按当前参数重建并取景'),
  // ---- 历史 ----
  CMD('app.undo', '撤销'),
  CMD('app.redo', '重做'),
  // ---- 运行时开关 / 风场 / 生长动画 / 面数预算 ----
  CMD('app.toggle', '开关系统', { target: { type: 'string', enum: TARGETS, required: true }, value: { type: 'boolean' } }),
  CMD('app.set_wind', '风场: 强度/方向/速度/阵风/开关/自动', {
    strength: { type: 'number' }, direction: { type: 'number' }, speed: { type: 'number' },
    gust: { type: 'number' }, enabled: { type: 'boolean' }, auto: { type: 'boolean' },
  }),
  CMD('app.set_growth', '生长动画: 进度/自动/速度', { value: { type: 'number' }, auto: { type: 'boolean' }, speed: { type: 'number' } }),
  CMD('app.set_lod', '面数预算', { maxLeaves: { type: 'number' } }),
  // ---- 内置素材 (叶片/花朵卡片、树皮贴图) ----
  CMD('app.list_leaf_cards', '列出内置叶片/花朵卡片', { batch: { type: 'string' }, limit: { type: 'number' } }),
  CMD('app.apply_leaf_card', '设置树叶卡片 (id 或 batch)', { id: { type: 'string' }, batch: { type: 'string' } }),
  CMD('app.apply_flower_card', '设置花朵卡片 (id 或 batch; 含樱花批次)', { id: { type: 'string' }, batch: { type: 'string' } }),
  CMD('app.list_bark_textures', '列出内置树皮贴图', { batch: { type: 'string' } }),
  CMD('app.set_bark_texture', '设置树皮贴图', {
    batch: { type: 'string' }, row: { type: 'number' }, col: { type: 'number' }, url: { type: 'string' },
  }),
  CMD('app.set_material', '改材质属性 (target: bark|leaf|flower; props: 任意材质字段)', {
    target: { type: 'string', enum: ['bark', 'leaf', 'flower'], required: true },
    props: { type: 'object', required: true },
  }),
  // ---- 模型节点树 / 选中 ----
  CMD('app.node_tree', '读取节点树 (类型/层级/数量统计)', { limit: { type: 'number' } }),
  CMD('app.select_node', '选中节点 (传 id 或 group)', { id: { type: 'number' }, group: { type: 'string' } }),
  // ---- 相机 / 截图 ----
  CMD('app.camera', '相机取景', { action: { type: 'string', enum: ['frame', 'front', 'top', 'side', 'reset'], required: true } }),
  CMD('app.screenshot', '截图 (返回 PNG dataURL, 供视觉模型查看)'),
  // ---- 伪装卡 / 导出 ----
  CMD('app.impostor', '生成伪装卡', {
    mode: { type: 'string', enum: ['atlas', 'cross'] }, views: { type: 'number' },
    size: { type: 'number' }, elevations: { type: 'number' },
  }),
  CMD('app.export_model', '导出模型文件 (glb/obj)', {
    format: { type: 'string', enum: ['glb', 'obj'], required: true }, name: { type: 'string' },
  }),
  // 兜底: 保证每条命令的 params 一定是对象 (下面的 toolsForMcp 会直接 Object.entries 它)
].map((c) => ({ ...c, params: c.params || {} }))

/** 全部命令名字符串数组, 便于 UI 下拉/文档生成时不必再遍历对象 */
export const COMMAND_NAMES = COMMANDS.map((c) => c.name)

/**
 * 命令名 <-> MCP tool 名 (点换下划线)。
 * MCP 的工具名只允许 `[A-Za-z0-9_-]`, 点号非法, 所以 `app.set_params` -> `app_set_params`。
 * 这条不变量必须可逆: `fromToolName(toToolName(n)) === n`, 否则大模型调用会落到错误命令。
 */
export const toToolName = (n) => n.replace(/\./g, '_')
/**
 * MCP tool 名还原成点分命令名。
 * 若查不到 (例如上游传了个未知工具名), **原样返回**而不是抛错 ——
 * 让调用方自己报"未知命令", 这样错误信息里还能带上用户原本传的名字, 便于排查。
 */
export const fromToolName = (n) => COMMANDS.find((c) => toToolName(c.name) === n)?.name || n

/**
 * MCP tools/list 用的 schema
 *
 * 把本文件的简化参数描述翻译成 JSON Schema:
 *   - `type` / `enum` 直接透传, 保证大模型能拿到取值枚举;
 *   - `required: true` 不是 JSON Schema 关键字, 这里**收集成顶层 `required` 数组**;
 *   - 描述文本统一放到每个属性的 `description` (缺省为空串, 避免 schema 里出现 null)。
 * 注意此处使用 `Object.fromEntries(...)` 以保持参数顺序 = 源码里的书写顺序,
 * 顺序会影响大模型读 schema 时的注意力分配, 所以"重要参数写前面"是有意义的。
 *
 * @returns {Array<{name: string, description: string, inputSchema: object}>}
 *   直接可被 MCP 服务端序列化返回的工具清单。
 */
export function toolsForMcp() {
  return COMMANDS.map((c) => ({
    name: toToolName(c.name),
    description: c.description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(c.params || {}).map(([k, sp]) => {
          const p = { type: sp.type, description: sp.description || '' }
          // enum 只在声明过时才写, 否则空 enum 会让部分客户端判定"无可选值"
          if (sp.enum) p.enum = sp.enum
          return [k, p]
        }),
      ),
      // 只把标了 required 的参数名收集进 JSON Schema 的 required 数组
      required: Object.entries(c.params || {}).filter(([, sp]) => sp.required).map(([k]) => k),
    },
  }))
}
