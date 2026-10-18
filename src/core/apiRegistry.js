/**
 * 应用命令注册表 (唯一真相来源)
 * ------------------------------------------------------------
 * 服务端 MCP (scripts/app-bridge-server.mjs) 直接 import 这份定义,
 * 浏览器侧 appApi.js 负责实现这些命令的 handler。
 * 所以"MCP 暴露的能力"与"应用实际能力"始终对齐:
 * 新增功能 -> 在这里加一条 + appApi 里加 handler -> MCP/大模型立刻可用。
 */
const SPECIES = ['oak', 'sakura', 'birch', 'maple', 'pine', 'willow', 'banyan']
const STAGES = ['sapling', 'young', 'mature', 'ancient']
const SEASONS = ['spring', 'summer', 'autumn', 'winter']
const TARGETS = [
  'leaves', 'flower', 'fruit', 'fall', 'litter', 'flowerFall', 'flowerLitter',
  'particles', 'roots', 'playing', 'wireframe',
]

const CMD = (name, description, params = {}) => ({ name, description, params })

export const COMMANDS = [
  CMD('app.help', '列出全部可用命令 (名称/说明/参数)'),
  CMD('app.status', '应用状态: 树种/阶段/季节, 树叶/花朵/果实数量, 三角面数, 节点数'),
  CMD('app.selfcheck', '应用侧自检: 场景/材质/着色器/卡片库/贴图/命令处理器'),
  CMD('app.get_params', '读取参数 (group 可选: geometry/material/wind/scene/leaves/flower/flowerFall/flowerLitter)', { group: { type: 'string' } }),
  CMD('app.set_params', '按点路径批量改参数, 例 {"leaves.size":0.4,"flower.enabled":true}', { patch: { type: 'object', required: true } }),
  CMD('app.export_params', '导出完整参数 JSON 字符串'),
  CMD('app.import_params', '导入参数 JSON 字符串并重建', { json: { type: 'string', required: true } }),
  CMD('app.list_species', '列出树种/阶段/季节/全部组合'),
  CMD('app.apply_preset', '应用树种+阶段+季节', {
    species: { type: 'string', enum: SPECIES, required: true },
    stage: { type: 'string', enum: STAGES },
    season: { type: 'string', enum: SEASONS },
  }),
  CMD('app.set_species', '只换树种 (保留阶段/季节)', { species: { type: 'string', enum: SPECIES, required: true } }),
  CMD('app.set_stage', '只换生长阶段', { stage: { type: 'string', enum: STAGES, required: true } }),
  CMD('app.set_season', '只换季节', { season: { type: 'string', enum: SEASONS, required: true } }),
  CMD('app.randomize', '随机种子 (+ 可选随机树种/季节) 并重建', { all: { type: 'boolean' } }),
  CMD('app.set_seed', '设置随机种子', { seed: { type: 'number', required: true } }),
  CMD('app.rebuild', '按当前参数重建并取景'),
  CMD('app.undo', '撤销'),
  CMD('app.redo', '重做'),
  CMD('app.toggle', '开关系统', { target: { type: 'string', enum: TARGETS, required: true }, value: { type: 'boolean' } }),
  CMD('app.set_wind', '风场: 强度/方向/速度/阵风/开关/自动', {
    strength: { type: 'number' }, direction: { type: 'number' }, speed: { type: 'number' },
    gust: { type: 'number' }, enabled: { type: 'boolean' }, auto: { type: 'boolean' },
  }),
  CMD('app.set_growth', '生长动画: 进度/自动/速度', { value: { type: 'number' }, auto: { type: 'boolean' }, speed: { type: 'number' } }),
  CMD('app.set_lod', '面数预算', { maxLeaves: { type: 'number' } }),
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
  CMD('app.node_tree', '读取节点树 (类型/层级/数量统计)', { limit: { type: 'number' } }),
  CMD('app.select_node', '选中节点 (传 id 或 group)', { id: { type: 'number' }, group: { type: 'string' } }),
  CMD('app.camera', '相机取景', { action: { type: 'string', enum: ['frame', 'front', 'top', 'side', 'reset'], required: true } }),
  CMD('app.screenshot', '截图 (返回 PNG dataURL, 供视觉模型查看)'),
  CMD('app.impostor', '生成伪装卡', {
    mode: { type: 'string', enum: ['atlas', 'cross'] }, views: { type: 'number' },
    size: { type: 'number' }, elevations: { type: 'number' },
  }),
  CMD('app.export_model', '导出模型文件 (glb/obj)', {
    format: { type: 'string', enum: ['glb', 'obj'], required: true }, name: { type: 'string' },
  }),
].map((c) => ({ ...c, params: c.params || {} }))

export const COMMAND_NAMES = COMMANDS.map((c) => c.name)

/** 命令名 <-> MCP tool 名 (点换下划线) */
export const toToolName = (n) => n.replace(/\./g, '_')
export const fromToolName = (n) => COMMANDS.find((c) => toToolName(c.name) === n)?.name || n

/** MCP tools/list 用的 schema */
export function toolsForMcp() {
  return COMMANDS.map((c) => ({
    name: toToolName(c.name),
    description: c.description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(c.params || {}).map(([k, sp]) => {
          const p = { type: sp.type, description: sp.description || '' }
          if (sp.enum) p.enum = sp.enum
          return [k, p]
        }),
      ),
      required: Object.entries(c.params || {}).filter(([, sp]) => sp.required).map(([k]) => k),
    },
  }))
}
