/**
 * 应用命令执行器 + 桥客户端（应用级 API 门面）
 * ------------------------------------------------------------
 * 作用: 实现 src/core/apiRegistry.js 里声明的全部命令, 通过轮询本地桥
 *       (scripts/app-bridge-server.mjs, 默认 127.0.0.1:5275) 接收外部调用。
 *       => MCP 客户端 / 大模型 / 脚本 都走这一条通道, 能力面与应用功能一致。
 * 输入 / 输出:
 *       输入一条命令 = { id, name, args(JSON 对象) };
 *       输出统一为 { ok: boolean, data?: any, error?: string }。
 *       业务失败(如"未知开关")也返回 ok:false + error 中文文案, 而不是抛异常,
 *       这样外部 MCP 侧可以直接把 error 字符串转给人看。
 * 与其他模块的关系:
 *       - apiRegistry.js 声明"有哪些命令"(COMMAND_NAMES, 名字清单);
 *       - 本文件给出"每个命令怎么执行"(把 JSON 参数翻译成 treeStore / sceneManager 调用);
 *       - bridge 服务(HTTP)只负责排队与转发, 不含业务;
 *       - 少数命令直接摸 Three.js 对象, 走 UI 挂在 window 上的
 *         window.__fastTreeScene (TreeScene 实例) 和 window.THREE。
 *       命令表 COMMAND_HANDLERS 的键必须覆盖 COMMAND_NAMES, 否则 app.selfcheck
 *       会把没实现的命令列进 missingHandlers, 供联调时一眼看出漏了哪个。
 * 关键概念 / 约定:
 *       - 参数补丁用点号路径("leaves.density")逐级就地写入 state.params;
 *       - "改参数"类命令只写 reactive 的 treeStore.state, 真正的几何重建由 store
 *         的 watcher 触发 —— 命令自己绝不调用 build(), 唯一例外是 app.rebuild
 *         显式要求立即重建;
 *       - 角度类参数按 UI 口径传"度", 转弧度由下游(materials / sceneManager)负责;
 *       - 单位遵循项目约定: 长度=米, 时间=秒(除轮询间隔用毫秒), 比例=0..1 归一化。
 * 注意: 桥靠 400ms 轮询拉活, 页面关闭后命令会超时; 桥重启(dev 重开 MCP)时本文件
 *       会自动重新 hello 注册, 不需要手动刷新页面。
 */
import {
  state, sceneApi,
  applyClassification, setSeed, randomizeSeed, randomClassification,
  applyLeafCard, applyFlowerCard, doGenerateImpostor,
  undo, redo, getNodeModel, selectNodes, selectGroup, clearSelection,
  importParamsJSON,
} from '../store/treeStore.js'
import { SPECIES, GROWTH_STAGES, SEASONS } from './species.js'
import { LEAF_CARDS, LEAF_CARD_SETS } from './leafCards.generated.js'
import { BARK_TEXTURES, BARK_SETS } from './barkTextures.js'
import { COMMAND_NAMES } from './apiRegistry.js'

/**
 * 本地桥的基地址。
 * 端口在构建期由 Vite define 注入(__APP_BRIDGE_PORT__); 未注入时回落到 5275,
 * 保证纯静态预览也能正常加载模块 —— 只是连不上桥, 命令会一直排队到超时。
 */
const BRIDGE = 'http://127.0.0.1:' + (typeof __APP_BRIDGE_PORT__ !== 'undefined' ? __APP_BRIDGE_PORT__ : 5275)
/**
 * 按点号路径就地写值, 途经的中间层若为 null/undefined 会自动补成空对象。
 *
 * 语义是"只覆盖末级键": 同级其他字段原样保留, 因此外部可以发最小增量补丁
 * (例如只发 {"wind.speed": 1.4}), 不必回传整个 params。
 *
 * @param {Object} obj 目标对象, 通常是 reactive 的 treeStore.state.params
 * @param {string} path 点号分隔的属性路径, 如 'wind.direction'
 * @param {any} value 要写入的值(类型由调用方保证与目标字段一致)
 * @sideeffect 直接修改 obj(响应式对象会触发下游 watcher 重建)
 */
const pathExists = (obj, path) => {
  const parts = String(path).split(/\.|\[|\]/).filter((s) => s !== '')
  if (!parts.length) return false
  let o = obj
  for (let i = 0; i < parts.length - 1; i++) {
    o = o?.[parts[i]]
    if (o == null || typeof o !== 'object') return false
  }
  const last = parts[parts.length - 1]
  // 数字下标写进已存在的数组是合法的(例如空的 forces.items 里放第 0 个力场)
  if (/^\d+$/.test(last)) return Array.isArray(o)
  return o != null && typeof o === 'object' && last in o
}
const setAt = (obj, path, value) => {
  // 同时支持 'branches.levels[2].count' 与 'wind.speed' 两种写法:
  // 数组下标用 [n] 表示, 这样大模型可以只改某一层枝条而不必回传整个数组。
  const parts = String(path).split(/\.|\[|\]/).filter((s) => s !== '')
  let o = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (o[k] == null) o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {}
    o = o[k]
  }
  const last = parts[parts.length - 1]
  o[/^\d+$/.test(last) ? Number(last) : last] = value
}
/**
 * 在叶片卡片表里按 id 精确取卡; 未命中时退回"该批次的第一张卡"。
 *
 * 目的是让外部调用更宽容: 调用方可以只给 batch 让系统自己挑一张,
 * 不必先 list 再挑 id。两次 find 都是线性扫描, 卡片总量在百级, 无需索引。
 *
 * @param {string} [id] 卡片 id(LEAF_CARDS 里的 c.id)
 * @param {string} [batch] 批次名, 仅在 id 未命中时作为回落条件
 * @returns {Object|null} 命中的卡片 { id, url, batch, ... }; 都没有则 null
 */
const pickCard = (id, batch) => LEAF_CARDS.find((c) => c.id === id) || (batch ? LEAF_CARDS.find((c) => c.batch === batch) : null)

/**
 * 命令名 -> 处理器 的注册表(全部对外能力的唯一入口)。
 *
 * 处理器约定:
 *   - 签名 (args: Object) => data | { error: string } | Promise<...>;
 *   - 返回带 error 字段的对象 => runCommand 转成 { ok:false, error };
 *   - 其余返回值原样塞进 { ok:true, data };
 *   - 处理器内部不要自己 try/catch, 统一由 runCommand 兜底,
 *     避免异常被吞成"半成品但 ok:true"的数据。
 *
 * 返回值的形状没有强 schema, 但惯例是"回显实际生效的值":
 * 例如 app.set_wind 会把写入后的 strength/speed/gust 一起返回,
 * 让调用方无需再发一次 get 就能确认状态。
 */
export const COMMAND_HANDLERS = {
  /* ---------------- 元信息 / 全局状态 ---------------- */
  /** 返回全部命令名清单(等价于 MCP 的 tools/list, 供调用方自省能力面)。 */
  'app.help': () => ({ commands: COMMAND_NAMES }),
  /**
   * 汇总当前树的一屏状态。
   *
   * triangles 是三块网格(bark + leaf + flower)三角面相加的近似值, 用来快速判断
   * 场景规模; counts 里的 height / spread 截到两位小数, 单位米, 其余为整数计数。
   * 全部字段都做了 `|| 0` 兜底 —— 树还没生成时这些统计量是 undefined。
   */
  'app.status': () => ({
    species: state.archetype,
    stage: state.params.auto && state.params.auto.stage,
    season: state.params.auto && state.params.auto.season,
    leaves: state.stats.leaves || 0,
    flowers: state.stats.flowers || 0,
    fruit: state.stats.fruit || state.stats.fruits || 0,
    triangles: (state.stats.barkTriangles || 0) + (state.stats.leafTriangles || 0) + (state.stats.flowerTriangles || 0),
    counts: {
      leaves: state.stats.leaves || 0,
      flowers: state.stats.flowers || 0,
      fruit: state.stats.fruit || 0,
      barkTriangles: state.stats.barkTriangles || 0,
      leafTriangles: state.stats.leafTriangles || 0,
      flowerTriangles: state.stats.flowerTriangles || 0,
      height: state.stats.height ? +state.stats.height.toFixed(2) : 0,
      spread: state.stats.spread ? +state.stats.spread.toFixed(2) : 0,
      nodes: state.stats.nodeCount || 0,
    },
  }),
  /* ---------------- 参数读写(点号路径补丁) ---------------- */
  /**
   * 读取参数树。可不带参数读全量(默认树约 8KB, 一次就能放进大模型上下文),
   * 也可以按 group 取一个分组、按 path 取单个子树 (如 'leaves' / 'branches.levels[0]'),
   * 便于大模型在不确定键名时按需读取, 避免一次塞进过长的 JSON。
   * 返回的是 reactive 对象本身(未做深拷贝), 调用方只读, 不要就地改。
   */
  'app.get_params': (a) => {
    const base = a?.group ? state.params[a.group] ?? null : state.params
    if (!a?.path) return base
    let o = base
    for (const k of String(a.path).split(/\.|\[|\]/).filter((s) => s !== '')) {
      if (o == null) return null
      o = o[k]
    }
    return o ?? null
  },
  /**
   * 用点号路径批量写参数, 逐键就地合并; 写响应式对象即触发下游重建。
   *
   * @param {{patch: Object<string, any>}} a patch 的键是路径、值是目标值,
   *   例 { 'leaves.density': 0.7, 'wind.speed': 1.2 }; 键顺序无关。
   * @returns {{applied: number, keys: string[]}} 实际写入的键数与键列表
   */
  'app.set_params': (a) => {
    const patch = a?.patch || {}
    const applied = []
    const ignored = []
    for (const k of Object.keys(patch)) {
      // 不存在的键直接忽略并回报: 悄悄写进去会生成脏字段, 模型也永远发现不了自己拼错了
      if (!pathExists(state.params, k)) { ignored.push(k); continue }
      setAt(state.params, k, patch[k])
      applied.push(k)
    }
    return { applied: applied.length, keys: applied, ignored: ignored.length ? ignored : undefined }
  },
  /** 把整棵 params 树序列化成 JSON 字符串(用于保存方案或跨实例搬运)。 */
  'app.export_params': () => ({ json: JSON.stringify(state.params) }),
  /**
   * 从 JSON 字符串整体导入参数 —— 是"替换"而非增量合并。
   * importParamsJSON 内部会校验字段并补默认值, 失败返回假值, 此时前端参数保持不变。
   */
  'app.import_params': (a) => {
    const ok = importParamsJSON(String(a?.json || ''))
    return { imported: !!ok }
  },
  /* ---------------- 物种 / 生长阶段 / 季节 预设 ---------------- */
  /**
   * 列出可选的物种、生长阶段、季节, 并给出组合总数。
   * stages / seasons 的元素既可能是字符串也可能是 { id }, 统一取 id 兜底;
   * combinations = 三者数量相乘, 只给调用方一个"规模感", 不做实际枚举。
   */
  'app.list_species': () => ({
    species: SPECIES.map((s) => ({ id: s.id, name: s.name })),
    stages: GROWTH_STAGES.map((s) => s.id || s),
    seasons: SEASONS.map((s) => s.id || s),
    combinations: SPECIES.length * GROWTH_STAGES.length * SEASONS.length,
  }),
  /**
   * 一次性套用"物种 + 阶段 + 季节"三轴组合(等同于 UI 顶栏的预设按钮)。
   * applyClassification 会把三轴一起写进 params 并触发一次重建,
   * 所以下面三个 set_* 命令都靠"读当前另两轴 + 只换一轴"来实现单轴切换。
   */
  'app.apply_preset': (a) => {
    // 省略 stage/season 时沿用当前值, 而不是悄悄退回 mature/summer
    const cur = state.params.classify || {}
    const switching = !!a.species && a.species !== cur.species
    applyClassification(a.species, a.stage || cur.stage, a.season || cur.season)
    const p = state.params
    // 换树种时旧叶卡(如柳叶/花穗)对新叶形完全不对, 而且 tintMode='texture' 会让
    // leaves.color 失效 —— 只保留给同树种, 换树种一律回程序化叶形 + 跟随叶色。
    if (switching) {
      p.leaves.cardMode = false
      p.leafMat.texture = ''
      p.leafMat.tintMode = 'season'
    }
    return {
      species: p.classify?.species,
      stage: p.classify?.stage,
      season: p.classify?.season,
      // 直接把预设后的关键参数回给模型, 省掉一轮 get_params
      summary: {
        height: p.trunk?.height,
        baseRadius: p.trunk?.baseRadius,
        fork: p.trunk?.fork ? { enabled: p.trunk.fork.enabled, count: p.trunk.fork.count, height: p.trunk.fork.height, angle: p.trunk.fork.angle } : undefined,
        levels: p.branches?.levels,
        levelCounts: Array.isArray(p.branches?.level) ? p.branches.level.map((l) => l.count) : undefined,
        leafSize: p.leaves?.size,
        leafColor: p.leaves?.color,
        leafShape: p.leaves?.shape,
        cardMode: p.leaves?.cardMode,
        tintMode: p.leafMat?.tintMode,
        leafTexture: p.leafMat?.texture ? String(p.leafMat.texture).split('/').pop() : '',
        barkTexture: p.bark?.texture ? String(p.bark.texture).split('/').pop() : '',
      },
    }
  },
  /** 只换物种, 阶段/季节沿用当前值(从 classify 里读)。 */
  'app.set_species': (a) => {
    const cur = state.params.classify || {}
    const switching = !!a.species && a.species !== cur.species
    applyClassification(a.species, cur.stage, cur.season)
    const p = state.params
    if (switching) {
      p.leaves.cardMode = false
      p.leafMat.texture = ''
      p.leafMat.tintMode = 'season'
    }
    return { species: a.species, stage: cur.stage, season: cur.season }
  },
  /** 只换生长阶段, 物种/季节沿用当前值。 */
  'app.set_stage': (a) => {
    const cur = state.params.classify || {}
    applyClassification(cur.species || state.archetype, a.stage, cur.season)
    return { species: cur.species, stage: a.stage, season: cur.season }
  },
  /** 只换季节, 物种/阶段沿用当前值。 */
  'app.set_season': (a) => {
    const cur = state.params.classify || {}
    applyClassification(cur.species || state.archetype, cur.stage, a.season)
    return { species: cur.species, stage: cur.stage, season: a.season }
  },
  /* ---------------- 随机与种子 ---------------- */
  /**
   * 随机化。
   * @param {{all?: boolean}} a all=true 时连物种/阶段/季节一起随机(randomClassification);
   *   否则只换种子(randomizeSeed) —— 后者是"同一棵树换个随机流", 形态家族不变。
   * @returns {{species: string, seed: number}} 实际生效的物种与种子
   */
  'app.randomize': (a) => {
    if (a?.all) randomClassification()
    else randomizeSeed()
    return { species: state.archetype, seed: state.params.seed }
  },
  /**
   * 直接设定随机种子。
   * 种子是整个程序化生成管线的确定性根: 同一个 seed + 同一套参数 ⇒ 逐顶点一致,
   * 因此这条命令也是"复现某棵树"的唯一入口。取整是为了避免浮点种子在不同
   * 引擎里哈希出不同结果; 非数字输入按 0 处理。
   */
  'app.set_seed': (a) => {
    setSeed(Math.round(Number(a.seed) || 0))
    return { seed: state.params.seed }
  },
  /* ---------------- 重建 / 撤销 / 重做 ---------------- */
  /** 强制立即重建(绕过 watcher 的防抖), 用于外部脚本"改完就想看到结果"的场景。 */
  'app.rebuild': () => {
    sceneApi.rebuildNow(true)
    return { rebuilt: true }
  },
  'app.undo': () => { undo(); return { undone: true } },
  'app.redo': () => { redo(); return { redone: true } },
  /* ---------------- 开关类(布尔翻转) ---------------- */
  /**
   * 统一开关入口: 传 value 则设为该值, 不传则取反。
   * 覆盖所有"启用/禁用"型字段(树叶/花/果/落叶/堆积/粒子/根/播放/线框),
   * 免去外部为每个开关各写一条命令。
   *
   * wireframe 是唯一的多态开关: 内部用 'off' / 'all' 两个字符串表示,
   * 因此这里先折算成布尔再翻回去, 保持与 UI 三位开关的兼容。
   *
   * @param {{target: string, value?: boolean}} a target 见下面 if 链; value 缺省=翻转
   * @returns {{target: string, leaves: boolean, flower: boolean, fruit: boolean}
   *   | {error: string}} 回显三个主开关状态, 未知 target 报错
   */
  'app.toggle': (a) => {
    const target = a?.target
    const value = a?.value === undefined ? null : !!a.value
    const flip = (cur) => (value === null ? !cur : value)
    const P = state.params
    if (target === 'leaves') P.leaves.enabled = flip(P.leaves.enabled)
    else if (target === 'flower') P.flower.enabled = flip(P.flower.enabled)
    else if (target === 'fruit') P.fruit.enabled = flip(P.fruit.enabled)
    else if (target === 'fall') P.fall.enabled = flip(P.fall.enabled)
    else if (target === 'litter') P.litter.enabled = flip(P.litter.enabled)
    else if (target === 'flowerFall') P.flowerFall.enabled = flip(P.flowerFall.enabled)
    else if (target === 'flowerLitter') P.flowerLitter.enabled = flip(P.flowerLitter.enabled)
    else if (target === 'particles') P.particles.enabled = flip(P.particles.enabled)
    else if (target === 'roots') P.roots.enabled = flip(P.roots.enabled)
    else if (target === 'playing') state.playing = flip(!!state.playing)
    else if (target === 'wireframe') {
      const cur = P.scene.wireframe && P.scene.wireframe !== 'off'
      P.scene.wireframe = flip(!!cur) ? 'all' : 'off'
    } else return { error: `未知开关: ${target}` }
    return { target, leaves: P.leaves.enabled, flower: P.flower.enabled, fruit: P.fruit.enabled }
  },
  /* ---------------- 风场 / 生长动画 / LOD ---------------- */
  /**
   * 调风场。全部字段可选, 只写传入的那几项(其余保持原值)。
   *
   * 字段物理含义(与 materials.js 的 uniform 一一对应):
   *   - strength  风力强度, 0..1 量级, 决定枝端最大摆动幅度(米级位移的乘数);
   *   - direction 风向, 单位"度", 0° = +X, 逆时针增长, 内部转成 uWindDir 二维向量;
   *   - speed     摆动频率倍率, 越大摆动越快(不均匀, 低频树干 + 高频叶片);
   *   - gust      阵风强度, 0..1; 着色器里 gust = 1 - uGust*0.6*(1-slow), 即越大越会
   *               把摆幅的低谷压低(阵风间歇更明显), 0 = 等幅恒定风;
   *   - auto      true 时由 UI 定时器缓慢改变风向/强度(模拟自然风转向);
   *   - enabled   false 则着色器里 uWindEnabled = 0, 完全静止。
   * @returns {Object} 回显写入后的全部风场字段, 便于调用方确认而不必再 get 一次
   */
  'app.set_wind': (a) => {
    const w = state.params.wind
    if (a?.strength !== undefined) w.strength = a.strength
    if (a?.direction !== undefined) w.direction = a.direction
    if (a?.speed !== undefined) w.speed = a.speed
    if (a?.gust !== undefined) w.gust = a.gust
    if (a?.enabled !== undefined) w.enabled = !!a.enabled
    if (a?.auto !== undefined) w.auto = !!a.auto
    return { strength: w.strength, direction: w.direction, speed: w.speed, gust: w.gust, enabled: w.enabled, auto: w.auto }
  },
  /**
   * 调生长动画(顶点着色器按 aGrow 区间逐段长出来)。
   * value 夹到 0..1: 0 = 完全未长出, 1 = 成型; 越界值会被静默截断,
   * 避免外部传 1.5 导致 uGrowth 越界把整棵树拉到远处。
   * auto=true 时由渲染循环每帧自增 speed(单位: 归一化进度/秒)。
   */
  'app.set_growth': (a) => {
    if (a?.value !== undefined) state.params.growth = Math.max(0, Math.min(1, a.value))
    if (a?.auto !== undefined) state.params.growthAuto = !!a.auto
    if (a?.speed !== undefined) state.params.growthSpeed = a.speed
    return { growth: state.params.growth, auto: state.params.growthAuto, speed: state.params.growthSpeed }
  },
  /**
   * 设置叶片总量上限(LOD 抽稀前的主开关)。
   * maxLeaves 是"全模最多保留多少片叶", 取非负整数; 远处的 LOD1/LOD2 会在
   * 这个基数上再乘以 keep1 / keep2 进一步抽稀。
   */
  'app.set_lod': (a) => {
    if (a?.maxLeaves !== undefined) state.params.lod.maxLeaves = Math.max(0, Math.round(a.maxLeaves))
    return { maxLeaves: state.params.lod.maxLeaves }
  },
  /* ---------------- 贴图卡片资源(树叶卡 / 花朵卡 / 树皮贴图) ---------------- */
  /**
   * 列出叶片卡片(可选按批次过滤), 默认只回前 40 条样本。
   * limit 被夹到 1..200: 卡片总量可能上千, 全量返回会把 MCP 上下文冲爆,
   * 所以这里主动截断, 调用方需要特定批次时用 batch 收敛。
   */
  'app.list_leaf_cards': (a) => {
    let list = LEAF_CARDS
    if (a?.batch) list = list.filter((c) => c.batch === a.batch)
    const limit = Math.max(1, Math.min(200, Math.round(a?.limit || 40)))
    return {
      total: list.length,
      batch: a?.batch || 'all',
      // 批次中文名: 大模型只拿到 "batch1-r01-c01" 无法判断是枫叶还是柳絮,
      // 必须给可读描述才能按参考图选卡片 (例如 ① 秋色系 / ⑬ 柳花穗)。
      batches: LEAF_CARD_SETS.map((s) => ({ id: s.id, name: s.name, rows: s.rows, cols: s.cols })),
      sample: list.slice(0, limit).map((c) => ({ id: c.id, url: c.url, batch: c.batch })),
    }
  },
  /**
   * 套用一张叶片卡片(改树叶贴图)。
   * id 未命中时可用 batch 兜底(pickCard 内部逻辑), 所以最小调用可以是
   * { batch: 'broadleaf-01' }。找不到就返回可读错误, 提示先 list。
   */
  'app.apply_leaf_card': (a) => {
    const card = pickCard(a?.id, a?.batch)
    if (!card) return { error: '未找到卡片 (可先 app.list_leaf_cards)' }
    applyLeafCard(card.id)
    return { applied: card.id, url: card.url, target: 'leaf' }
  },
  /** 套用一张花朵卡片; 选择逻辑与 apply_leaf_card 相同, 但作用到花朵贴图。 */
  'app.apply_flower_card': (a) => {
    const card = pickCard(a?.id, a?.batch)
    if (!card) return { error: '未找到卡片 (可先 app.list_leaf_cards)' }
    applyFlowerCard(card.id)
    return { applied: card.id, url: card.url, target: 'flower' }
  },
  /**
   * 列出树皮贴图, 并附上全部贴图集(batch)的 id/名称/行列数。
   * rows × cols 说明该 batch 的图集切分尺寸, set_bark_texture 的 row/col
   * 就是按这个网格寻址的(行列均从 1 开始)。
   */
  'app.list_bark_textures': (a) => {
    let list = BARK_TEXTURES
    if (a?.batch) list = list.filter((t) => t.batch === a.batch)
    return {
      total: list.length,
      batches: BARK_SETS.map((s) => ({ id: s.id, name: s.name, rows: s.rows, cols: s.cols })),
      sample: list.slice(0, 40).map((t) => ({ id: t.id, url: t.url, batch: t.batch, row: t.row, col: t.col })),
    }
  },
  /**
   * 设置树皮贴图。两种寻址方式:
   *   1) 直接给 url(绝对/相对都可, 原样存进 params.bark.texture);
   *   2) 给 batch + row + col, 在图集里按行列号查表。
   * 未给 batch 时默认取第一套(BARK_SETS[0]), row/col 未给时默认第 1 行第 1 列。
   */
  'app.set_bark_texture': (a) => {
    let t = null
    if (a?.url) t = { url: a.url }
    else {
      const set = BARK_SETS.find((x) => x.id === a?.batch) || BARK_SETS[0]
      t = BARK_TEXTURES.find((x) => x.batch === set.id && x.row === (a?.row || 1) && x.col === (a?.col || 1))
    }
    if (!t) return { error: '未找到树皮贴图' }
    state.params.bark.texture = t.url
    return { applied: t.url }
  },
  /* ---------------- 材质微调 ---------------- */
  /**
   * 按点号路径微调某个材质的参数。
   *
   * target 与 params 分组的映射: bark→bark, leaf→leafMat, flower→flower
   * (注意树叶分组叫 leafMat, 与 UI 里的"树叶材质"对应, 不是 leaves 生长参数)。
   * 例: { target: 'bark', props: { 'roughness': 0.9 } }
   *
   * @param {{target: string, props: Object<string, any>}} a 未知 target 返回错误
   * @returns {{target: string, applied: string[]}} 实际写入的属性名列表
   */
  'app.set_material': (a) => {
    const map = { bark: 'bark', leaf: 'leafMat', flower: 'flower' }
    const group = map[a?.target]
    if (!group) return { error: 'target 必须是 bark/leaf/flower' }
    const props = a?.props || {}
    for (const [k, v] of Object.entries(props)) setAt(state.params[group], k, v)
    return { target: a.target, applied: Object.keys(props) }
  },
  /* ---------------- 模型节点树 / 选中 ---------------- */
  /**
   * 读模型节点树(节点树的扁平化视图)。
   *
   * getNodeModel 可能返回数组, 也可能返回 { nodes: [...] }, 这里统一成数组。
   * byType 是"每个类型有多少个节点"的直方图, 用来快速判断树的分枝结构;
   * sample 只取前 limit 条(夹到 1..400), 全量节点可能有几千条, 不适合直出。
   */
  'app.node_tree': (a) => {
    const model = getNodeModel()
    const arr = Array.isArray(model) ? model : (model && Array.isArray(model.nodes) ? model.nodes : [])
    const limit = Math.max(1, Math.min(400, Math.round(a?.limit || 80)))
    const byType = {}
    for (const n of arr) byType[n.type || 'unknown'] = (byType[n.type || 'unknown'] || 0) + 1
    return {
      total: arr.length,
      byType,
      sample: arr.slice(0, limit).map((n) => ({ id: n.id, type: n.type, level: n.level, group: n.group, name: n.name, leaves: n.meta && n.meta.leaves })),
    }
  },
  /**
   * 选中节点。优先级: group > id > 清空。
   * 都不给等于"取消选中", 这样外部可以用同一条命令表达两种意图。
   * 选中状态会经由 uniforms 传给着色器做高亮/隔离, 不重建几何。
   */
  'app.select_node': (a) => {
    if (a?.group) { selectGroup(a.group); return { selected: a.group } }
    if (a?.id !== undefined) { selectNodes([a.id]); return { selected: a.id } }
    clearSelection()
    return { selected: null }
  },
  /* ---------------- 相机 / 截图 / 伪装卡 ---------------- */
  /**
   * 相机取景。
   *   frame / reset → 交给 TreeScene.frameCamera() 按树高自动取全景;
   *   其它(front / side / top …) → 用树的世界包围盒算出中心与半径 r,
   *     沿预设方向单位向量 × r × 0.8 摆机位(0.8 是经验系数: 略近于包围球表面,
   *     让树在画面里占约 2/3), 再把 OrbitControls 的 target 移到中心。
   * 没有 __fastTreeScene(场景还没挂载)时返回错误而不是抛异常。
   *
   * @param {{action?: string}} a action 缺省 'frame'
   */
  'app.camera': (a) => {
    const sc = window.__fastTreeScene
    const action = a?.action || 'frame'
    const THREE = window.THREE
    if (!sc) return { error: '场景不可用' }
    if (action === 'frame' || action === 'reset') {
      sc.frameCamera?.()
    } else if (THREE && sc.camera && sc.treeGroup) {
      const box = new THREE.Box3().setFromObject(sc.treeGroup)
      const center = box.getCenter(new THREE.Vector3())
      const r = box.getSize(new THREE.Vector3()).length() || 20
      const dirs = { front: [0, 0.35, 1], side: [1, 0.35, 0], top: [0.01, 1, 0.01] }
      const d = dirs[action] || dirs.front
      sc.camera.position.set(center.x + d[0] * r * 0.8, center.y + d[1] * r * 0.8, center.z + d[2] * r * 0.8)
      sc.camera.lookAt(center)
      if (sc.controls) { sc.controls.target.copy(center); sc.controls.update() }
    }
    return { action }
  },
  /**
   * 截取当前视口。
   *
   * 默认输出 **JPEG + 最长边 900px** (max/quality 可调): 大模型看图只需要轮廓与颜色,
   * 原尺寸 PNG 往往几百 KB ~ 几 MB, base64 后会把上下文和请求体一起撑爆。
   * 需要无损原图时传 { max: 0 } 走 PNG 原尺寸。
   *
   * 先手动 render 一次: renderer 开了 preserveDrawingBuffer, 但若上一帧已被
   * 浏览器合成器清空, 直接 toDataURL 可能拿到黑图, 主动重绘最稳。
   * bytes 是 base64 长度的 3/4 估算(每 4 个 base64 字符承载 3 字节), 不是精确值。
   *
   * @param {{max?:number, quality?:number}} [a] max=最长边像素(0=不缩放), quality=JPEG 质量 0.4~0.95
   * @returns {{dataUrl:string, bytes:number, width:number, height:number, format:string}}
   */
  'app.screenshot': (a) => {
    const sc = window.__fastTreeScene
    const renderer = sc && sc.renderer
    const canvas = renderer && renderer.domElement
    if (!canvas) return { error: '渲染器不可用' }
    // 窗口最小化/容器折叠时 canvas 会被压到 1x1。直接截只会得到一张无意义的图,
    // 而大模型会把它当成"当前画面"去和参考图对比, 进而盲调参数。
    // 这里临时把绘制缓冲放大到 1280x800 再渲染, 截完恢复原尺寸与相机比例。
    const oldW = Math.max(1, canvas.width || 1)
    const oldH = Math.max(1, canvas.height || 1)
    let restore = null
    if (oldW < 32 || oldH < 32) {
      const w = 1280
      const h = 800
      const oldAspect = sc.camera.aspect
      const oldCssW = Math.max(1, canvas.clientWidth || oldW)
      const oldCssH = Math.max(1, canvas.clientHeight || oldH)
      const oldPR = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1
      renderer.setPixelRatio(1)
      renderer.setSize(w, h, false)
      sc.camera.aspect = w / h
      sc.camera.updateProjectionMatrix()
      restore = () => {
        renderer.setPixelRatio(oldPR)
        renderer.setSize(oldCssW, oldCssH, false)
        sc.camera.aspect = oldAspect
        sc.camera.updateProjectionMatrix()
      }
    }
    try {
      renderer.render(sc.scene, sc.camera)
      const max = a?.max === undefined ? 900 : Number(a.max)
      const quality = Math.min(0.95, Math.max(0.4, Number(a?.quality) || 0.82))
      // 先尝试缩放到 JPEG: 浏览器不支持 canvas 编码时会抛错, 这时退回原尺寸 PNG。
      if (Number.isFinite(max) && max > 0) {
        const longest = Math.max(canvas.width || 1, canvas.height || 1)
        const scale = Math.min(1, max / longest)
        const width = Math.max(1, Math.round((canvas.width || 1) * scale))
        const height = Math.max(1, Math.round((canvas.height || 1) * scale))
        try {
          const cv = document.createElement('canvas')
          cv.width = width
          cv.height = height
          const ctx = cv.getContext('2d')
          ctx.drawImage(canvas, 0, 0, width, height)
          const url = cv.toDataURL('image/jpeg', quality)
          return { dataUrl: url, bytes: Math.round(url.length * 0.75), width, height, format: 'jpeg' }
        } catch (e) {
          // 忽略, 走下面的 PNG 分支
        }
      }
      const url = canvas.toDataURL('image/png')
      return { dataUrl: url, bytes: Math.round(url.length * 0.75), width: canvas.width, height: canvas.height, format: 'png' }
    } finally {
      if (restore) restore()
    }
  },
  /**
   * 生成伪装卡(Impostor / LOD 远景卡片)。
   *
   * mode='atlas' → 单张图集, 按方位角 × 俯仰角切格; 预览时按相机角度选格。
   * mode='cross' → 多张按角度摆放的交叉面片, 从任意水平方向看都有正对镜头的一片。
   * 拍摄期间会临时隐藏地面/网格/天空/粒子/落花落叶/花朵等干扰物, 只留树,
   * 拍完由 generateImpostor 负责恢复。
   * 返回的 dataUrl 是整张图集 PNG; meta 里带 center/radius/fov/distance/
   * layout(行列)/views/elevations, 是 setImpostorPreview 重建 3D 预览的唯一依据。
   */
  'app.impostor': (a) => {
    const res = doGenerateImpostor({ mode: a?.mode || 'atlas', views: a?.views, size: a?.size, elevations: a?.elevations })
    return { meta: res.meta, width: res.width, height: res.height, coverage: res.coverage, dataUrl: res.dataUrl }
  },
  /**
   * 导出模型并触发浏览器下载。
   * format 只区分 'obj' 与"其它"(即 glb); name 缺省用时间戳, 避免覆盖同名文件。
   * 导出内容是静态三件套(树皮/树叶/花朵), 不含粒子、落叶、线框与风场动画 ——
   * 那些依赖顶点着色器按时间驱动, 静态导出只会得到错位几何。
   */
  'app.export_model': (a) => {
    const fmt = (a?.format || 'glb').toLowerCase()
    const name = a?.name || `tree-${Date.now()}`
    if (fmt === 'obj') sceneApi.exportOBJ(name)
    else sceneApi.exportGLB(name)
    return { format: fmt, name }
  },
  /**
   * 运行期自检: 把"渲染管线是否健康"的关键事实一次性回给外部。
   *
   * 各项含义:
   *   - scene / bark / leaves / flowers: 主要对象是否已创建;
   *   - leafTexture / flowerTexture: 贴图是否真的解码出了 image(而不只是有 URL),
   *     只看 URL 会在加载失败时误报"正常";
   *   - shaderErrors: renderer.info.programs 里带 diagnostics 的程序数量,
   *     非 0 表示有 GLSL 编译/链接错误 —— 风场/选中着色器注入失败时最先炸这里;
   *   - drawCalls: 上一帧 draw call 数, 可用来确认视锥分块是否真的生效;
   *   - missingHandlers: apiRegistry 声明了但本文件没实现的命令名(应为空数组)。
   */
  'app.selfcheck': () => {
    const sc = window.__fastTreeScene
    const programs = (sc?.renderer?.info?.programs || [])
    let shaderErrors = 0
    for (const p of programs) {
      if (p.diagnostics && (p.diagnostics.vertexShader || p.diagnostics.fragmentShader || p.diagnostics.programLog)) shaderErrors++
    }
    const implemented = Object.keys(COMMAND_HANDLERS)
    const missing = COMMAND_NAMES.filter((n) => !implemented.includes(n))
    return {
      scene: !!sc,
      bark: !!sc?.barkMesh,
      leaves: !!sc?.leafMesh,
      flowers: !!sc?.flowerMesh,
      flowerMaterial: !!sc?.materials?.flower,
      flowerTexture: !!(sc?.materials?.flower && sc.materials.flower.map && sc.materials.flower.map.image),
      leafTexture: !!(sc?.materials?.leaf?.map && sc.materials.leaf.map.image),
      flowerFall: !!sc?.flowerFallMesh,
      flowerLitter: !!sc?.flowerLitterMesh,
      shaderErrors,
      drawCalls: sc?.renderer?.info?.render?.calls || 0,
      leafCards: LEAF_CARDS.length,
      barkTextures: BARK_TEXTURES.length,
      commandHandlers: implemented.length,
      missingHandlers: missing,
      stats: { leaves: state.stats.leaves, flowers: state.stats.flowers },
    }
  },
}

/**
 * 执行一条命令, 并把它规范成统一的 { ok, data | error } 回执。
 *
 * 三步:
 *   ① 查表 —— 未知命令直接拒绝, 不进入业务;
 *   ② await —— 处理器允许异步(例如需要等贴图/几何就绪);
 *      并额外识别"处理器用 { error } 表达业务失败"这一约定,
 *      把它转成 ok:false, 这样外部只需判一个 ok 字段;
 *   ③ catch —— 任何异常都收敛成字符串错误, 绝不让异常冒到轮询循环里
 *      (一旦冒出去, 那一条命令的结果就永远回不到桥, 外部会一直等到超时)。
 *
 * @param {string} name 命令名, 必须是 COMMAND_HANDLERS 的键
 * @param {Object} [args] 命令参数(纯 JSON 对象)
 * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
 */
async function runCommand(name, args) {
  const fn = COMMAND_HANDLERS[name]
  if (!fn) return { ok: false, error: `未知命令: ${name}` }
  try {
    const data = await fn(args || {})
    if (data && data.error) return { ok: false, error: data.error }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

/* ---------------- 桥客户端: 注册 / 轮询 / 命令分发 ---------------- */
/** 轮询定时器句柄; 非 null 表示客户端已启动(用于 startBridgeClient 幂等)。 */
let timer = null
/** 是否与桥保持有效会话; 掉线后下一轮会自动重新 hello。 */
let connected = false
/** 桥分配的消费者 id(每次 hello 可能变化), 为空则必须先注册才能 poll。 */
let consumerId = ''
/** 注册请求进行中标志, 防止 400ms 一轮的循环并发发出多个 hello。 */
let registerPending = false
/** 命令表版本号; 与命令数量一起上报, 桥可据此判断前端是否需要刷新。 */
const BRIDGE_VERSION = 33
/**
 * 稳定标签页标识: HMR 重新执行本模块时会再注册一次, 旧轮询若没清掉,
 * 同一页面就会在桥上挂出多个实例 (命令也就会重复执行)。带 tabId 让桥在注册时去重。
 * 用 sessionStorage 保证刷新后仍是同一个标签页。
 */
const TAB_ID = (() => {
  try {
    let v = sessionStorage.getItem('fasttree.tab')
    if (!v) { v = 't' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('fasttree.tab', v) }
    return v
  } catch (e) {
    return 't' + Math.random().toString(36).slice(2, 10)
  }
})()
/** 本实例支持的命令名列表(从注册表派生, 天然不会与实现脱节)。 */
const COMMAND_LIST = Object.keys(COMMAND_HANDLERS)
/**
 * 查询桥连接状态(供 UI 显示"已连接/未连接"指示灯)。
 * @returns {{connected: boolean, url: string}} url 是当前使用的桥地址
 */
export function bridgeStatus() {
  return { connected, url: BRIDGE }
}
/**
 * 当前页面在桥上的实例 id。
 * 多窗口/多标签时每个页面各有独立场景, 聊天请求必须带上它, 让大模型的
 * 工具调用落在"发起对话的这个窗口", 否则会出现"改了 A 却截图 B"。
 */
export function bridgeConsumerId() {
  return consumerId
}
/**
 * 向桥注册本实例能力; 桥重启后会自动重新注册 (无需刷新页面)。
 *
 * 上报内容 = 命令清单 + 当前页面路径 + 版本(命令数/BRIDGE_VERSION)。
 * 桥回一个 consumerId, 后续 poll 必须带上它才能领到属于自己的命令队列。
 * 用 registerPending 做单飞保护: 轮询周期 400ms, 慢网下 hello 可能跨越多个周期,
 * 若不去重会重复注册、把自己挤出队列。
 */
async function registerConsumer() {
  if (registerPending) return
  registerPending = true
  try {
    const res = await fetch(BRIDGE + '/bridge/hello', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: COMMAND_LIST,
        path: location.pathname,
        version: COMMAND_LIST.length + '/' + BRIDGE_VERSION,
        tabId: TAB_ID,
        // 多标签页时桥要优先把命令发给前台可见的那个实例 (后台标签会被节流)
        visible: document.visibilityState === 'visible',
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (j && j.consumerId) { consumerId = j.consumerId; connected = true }
  } catch (e) {
    connected = false
  } finally {
    registerPending = false
  }
}
/**
 * 启动桥客户端(幂等: 已在跑则直接返回)。
 *
 * 做三件事:
 *   ① 把命令执行器挂到 window.__fastTreeCommandApi —— 方便在 DevTools 控制台里
 *      直接跑 __fastTreeCommandApi.run('app.status'), 排查问题时不必起 MCP;
 *   ② 立刻发一次 hello 注册;
 *   ③ 起一个 400ms 的轮询循环: 有命令就逐条执行、逐条回传结果。
 *
 * 为什么用轮询而不是 WebSocket: 桥是极简 HTTP 服务, 无状态、无心跳,
 * 断线后靠"下一轮重新注册"自愈, 不需要重连状态机。代价是最高 400ms 延迟,
 * 对"改参数看结果"这类交互完全够用。
 *
 * 循环内串行执行命令(await 每条): 保证"改参数 → 重建 → 导出"这种有依赖的
 * 批次按调用顺序生效, 不会并发打架。
 * @sideeffect 建立 window 全局、注册定时器、持续发起网络请求
 */
export function startBridgeClient() {
  if (timer) return
  // HMR 重新执行本模块时, 旧模块实例的 timer 变量已随模块一起丢失, 但它的定时器还在跑;
  // window 上的句柄不会丢, 先停掉旧的, 避免同一标签页出现多个轮询循环互相顶掉注册。
  try { if (window.__fastTreeBridgeTimer) clearInterval(window.__fastTreeBridgeTimer) } catch (e) { /* 忽略 */ }
  window.__fastTreeCommandApi = { run: runCommand, handlers: COMMAND_LIST }
  registerConsumer()
  timer = setInterval(async () => {
    // 桥还没连上 (首次 / 重启中) -> 重新注册, 避免 dev 重启 MCP 后必须刷新页面
    if (!connected || !consumerId) { await registerConsumer(); return }
    try {
      const res = await fetch(`${BRIDGE}/bridge/poll?id=${encodeURIComponent(consumerId)}&visible=${document.visibilityState === 'visible' ? 1 : 0}`, { cache: 'no-store' })
      // 桥重启后旧 consumerId 会被丢弃: 轮询返回 404, 必须重新注册而不是继续空轮询。
      if (!res.ok) { connected = false; consumerId = ''; await registerConsumer(); return }
      const json = await res.json()
      connected = true
      // commands 是本次轮询领到的命令数组(可能为空); 逐条执行并回传结果。
      for (const c of json.commands || []) {
        const r = await runCommand(c.name, c.args)
        // 结果回传不 await: 单条结果丢包不应该拖慢后面的命令,
        // 失败也只影响这一条(桥侧会超时), 所以 catch 直接吞掉。
        fetch(`${BRIDGE}/bridge/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: c.id, ...r }),
        }).catch(() => {})
      }
    } catch (e) {
      // 任何网络/解析异常都视为掉线: 清空 consumerId, 下一轮会重新 hello。
      connected = false
      consumerId = ''
    }
  }, 400)
  window.__fastTreeBridgeTimer = timer
}
/**
 * 停止桥客户端(组件卸载时调用)。
 * 只清定时器与连接标志, 不清理 window.__fastTreeCommandApi ——
 * 保留它可以让卸载后在控制台手动调用命令做诊断(此时命令照样能执行,
 * 只是没有桥来分发)。
 */
export function stopBridgeClient() {
  if (timer) clearInterval(timer)
  timer = null
  try { if (window.__fastTreeBridgeTimer) window.__fastTreeBridgeTimer = null } catch (e) { /* 忽略 */ }
  connected = false
}
// dev 下 HMR 会重新执行本模块: 先停掉旧轮询, 否则每次热更新都会在桥上多挂一个实例
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    try { stopBridgeClient() } catch (e) { /* 忽略 */ }
  })
}
