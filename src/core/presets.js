/**
 * 预设树种 + 自动生成器 (薄封装: 真正的数据在 species.js / autowind.js)
 * ------------------------------------------------------------
 * - PRESETS: 树种列表 (橡树/松树/白桦/垂柳/樱花/灌木/枯树)
 * - applyPreset(params, id, stage, season): 按"树种+生长阶段+季节"组合出参数
 * - autoGenerate(seed, chaos): 由种子推导出"生物上说得通"的随机树
 * - autoWind(seed, intensity): 自动出风向 / 强度 / 阵风等风场参数
 *
 * 作用: 把"树种 / 生长阶段 / 季节"这套人类可读的分类, 翻译成 store 里那份完整参数树
 *       (字段清单与语义见 params.js 的 defaultParams())。
 * 输入 / 输出:
 *   applyPreset(params, id, stage, season) -> 新的完整 params (不修改入参)
 *   autoGenerate(seed, chaos, ...)         -> { params, type } (type = 实际抽到的树种 id)
 * 与其他模块的关系:
 *   species.js     提供形态基因表与 composeTree(); 本文件只做"封装 + 个体扰动"
 *   params.js      defaultParams / cloneParams / mergeParams 三个基础工具
 *   autowind.js    由种子推导风场 (species.js 内部也直接调它, 保证两条路径口径一致)
 *   treeBuilder.js estimateScale() 返回 {branches, leaves} 的规模估算, 用来做预算回缩
 *   消费方         store/treeStore.js (doApplyPreset / doAutoGenerate) 与面板 AutoPanel.vue
 * 确定性约定:
 *   所有随机都必须来自 makeRng(seed, 标签) 的具名子流, 且"标签 + 抽样顺序"固定 ——
 *   同一个 seed 在任意机器 / 任意次运行都得到同一棵树 (截图与 GLB 导出才可复现)。
 *   autoGenerate 的随机全部挂在 'auto-tree' 这一条子流上 (它再调 species.js 的
 *   compose:/season: 子流与 autowind 的 'auto-wind' 子流): 一旦增删/调换抽样语句,
 *   旧 seed 生成的树会整体改变 (属于破坏性改动, 需要谨慎)。
 */
import { defaultParams, cloneParams, mergeParams } from './params.js'
import { makeRng } from './rng.js'
import { estimateScale } from './treeBuilder.js'
import {
  SPECIES, GROWTH_STAGES, SEASONS, speciesById, stageById, seasonById,
  seasonProfile, composeTree, classificationName, classificationDesc, allCombinations,
} from './species.js'
import { autoWind } from './autowind.js'

export { autoWind, classificationName, classificationDesc, allCombinations }
export { SPECIES, GROWTH_STAGES, SEASONS, speciesById, stageById, seasonById, seasonProfile, composeTree }

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

/**
 * 生成一个新的随机种子 (整数 1 ~ 900000000)。
 *
 * 上限取 9 亿而不是 2^31: 种子会直接显示在 UI 里给用户抄写/分享, 9 位数更好读,
 * 又远小于 Number 的安全整数范围, 存成 JSON 往返不会失真。
 * 这是本文件唯一直接使用 Math.random() 的地方 —— 它只负责"挑一个种子",
 * 之后一切随机都回到该种子的 Rng 子流, 因此"换种子"是唯一的不可复现入口。
 *
 * @returns {number} 1 ~ 900000000 的整数 (不含 0: 0 会被上游当成"未设置种子")
 */
export function randomSeed() {
  return Math.floor(Math.random() * 900000000) + 1
}

/* ------------------------------------------------------------------ */
/* 树种预设 (对外保持原有接口: id/name/icon/patch)                       */
/* ------------------------------------------------------------------ */

/* 对外只暴露轻量元数据 (不含 patch 生成函数), 便于面板下拉框 / 缩略图列表直接遍历。
 * 字段语义:
 *   id        稳定标识, 同时也是 classify.species 的取值 (存档格式的一部分, 不可随意改)
 *   name/icon 面板显示用 (name 是中文名, icon 是 emoji)
 *   desc      一句话形态说明 (会出现在组合名/说明里)
 *   evergreen 常绿标记: 冬季不掉叶 (松树), 由 species.composeTree 消费
 *   patch()   形态补丁生成函数: 返回一份"参数子集", 由 mergeParams 覆盖到默认参数上 */
export const PRESETS = SPECIES.map((sp) => ({
  id: sp.id,
  name: sp.name,
  icon: sp.icon,
  desc: sp.desc,
  evergreen: !!sp.evergreen,
  patch: sp.patch,
}))

/* ------------------------------------------------------------------ */
/* 预设应用 (树种 + 生长阶段 + 季节)                                     */
/* ------------------------------------------------------------------ */

/**
 * 按 id 查树种元数据。
 * @param {string} id 树种 id (oak/pine/birch/willow/sakura/shrub/dead)
 * @returns {object|null} 命中的 PRESETS 条目; 未知 id 返回 null (调用方需自行兜底)
 */
export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null
}

/**
 * 结构深拷贝 (JSON 往返)。
 *
 * 参数树约定为"纯 JSON 结构" (只有 object/array/number/string/boolean/null),
 * 没有函数、Date、Map 或循环引用, 所以 JSON 往返就是最省事且够用的深拷贝。
 * 之所以处处要求深拷贝: 参数树被 Vue 的 reactive 包着, 直接把引用交给下一个预设
 * 会让"改新树"顺手改掉旧树 (撤销栈里保存的历史快照也会一起被污染)。
 *
 * @param {*} v 任意可 JSON 序列化的值
 * @returns {*} 深拷贝结果; undefined 原样返回 (保持"缺省即缺省"的语义)
 */
const deepCopy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/**
 * 组合时保留"用户自己的东西": 自定义 GLSL / 上传的贴图 / 场景 / 生长 / 风偏好。
 *
 * 为什么需要它: composeTree() 每次都从 defaultParams() 重新拼一棵树,
 * 而用户可能已经手写了 GLSL、上传了树皮/叶片贴图、摆好了灯光环境、调过生长进度。
 * 这些都不属于"树的形态基因", 换树种/换阶段/换季节时应当保持不变,
 * 否则用户每点一次预设就要重新上传一次贴图。
 *
 * 保留策略分三档:
 *   ① 整组深拷贝 (custom / scene / growth / lod): 整组都与形态无关
 *   ② 只保贴图与"怎么用贴图"的选择 (bark / leafMat): 颜色与粗糙度仍交给预设
 *   ③ 只保风场偏好 (wind): 风向/强度/开关属于用户意图, 具体相位仍由种子推导
 *
 * @param {object} next 新组合出来的参数 (来自 composeTree)
 * @param {object|null} prev 用户当前参数; 为 null 时直接返回 next (第一次打开页面)
 * @returns {object} next 本身 (就地修改并返回, 不额外拷贝)
 */
export function preserveUserBits(next, prev) {
  if (!prev) return next
  // ① 自定义 GLSL: 用户手写的着色器代码, 任何预设都不该覆盖
  if (prev.custom) next.custom = deepCopy(prev.custom)
  // 场景/灯光/雾/星空与树本身无关, 换树种时保持用户已调好的布光
  if (prev.scene) next.scene = deepCopy(prev.scene)
  // 生长动画进度: 用户可能停在 0.4 观察骨架, 不要因为换预设而跳回 1.0
  if (prev.growth) next.growth = deepCopy(prev.growth)
  // LOD 是"看这台机器的性能", 与树无关, 整组保留
  if (prev.lod) next.lod = deepCopy(prev.lod)
  // ② 树皮/树叶: 只保"用户自己上传的贴图"与"贴图怎么用"的选择;
  //    颜色/粗糙度/花纹这些属于形态基因, 交给新预设重新覆盖 (否则换树种看不出变化)
  if (prev.bark) {
    next.bark.texture = prev.bark.texture || ''
    next.bark.normalTexture = prev.bark.normalTexture || ''
    // 树皮几何管线属于用户选择, 不应被预设重置
    if (prev.bark.pipeline) next.bark.pipeline = prev.bark.pipeline
  }
  if (prev.leafMat) {
    next.leafMat.texture = prev.leafMat.texture || ''
    next.leafMat.normalTexture = prev.leafMat.normalTexture || ''
    // 染色相关是用户对"贴图怎么用"的选择, 切树种/季节时不应被重置
    next.leafMat.tintMode = prev.leafMat.tintMode
    next.leafMat.vertexColorMix = prev.leafMat.vertexColorMix
    next.leafMat.alphaTest = prev.leafMat.alphaTest
    next.leafMat.emissiveColor = prev.leafMat.emissiveColor
    next.leafMat.tint = prev.leafMat.tint
  }
  // ③ 风场: 开关/自动模式/方向/强度是用户意图, 保留;
  //    而速度、阵风、湍流等细节参数仍由 autoWind 重新推导 (它们才是"这棵树"的属性)
  if (prev.wind) {
    next.wind.enabled = prev.wind.enabled
    next.wind.auto = prev.wind.auto
    next.wind.direction = prev.wind.direction
    next.wind.intensity = prev.wind.intensity
  }
  return next
}

/**
 * 应用"树种 + 生长阶段 + 季节"预设 -> 完整参数。
 *
 * 设计要点:
 *   - **种子照抄当前参数**: 换树种/换季节不重新摇种子, 这样"换季节"相当于同一棵树
 *     换物候 (树形不动, 只变叶色/叶量), 符合用户的直觉期望。
 *   - 风力强度也照抄: 用户把风调大之后再换树种, 不应该突然回到微风。
 *   - 结果再过一遍 preserveUserBits, 保住贴图/GLSL/场景等"非形态"设置。
 *
 * @param {object|null} params 当前参数 (用于取 seed、风力与用户自定义内容)
 * @param {string} id 树种 id (oak/pine/birch/willow/sakura/shrub/dead)
 * @param {string} [stage='mature'] 生长阶段 id (seedling/sapling/young/mature/ancient)
 * @param {string} [season='summer'] 季节 id (spring/summer/autumn/winter)
 * @returns {object} 完整参数树 (新对象; 入参 params 不被修改)
 */
export function applyPreset(params, id, stage = 'mature', season = 'summer') {
  const seed = params && params.seed ? params.seed : 1
  const intensity = params && params.wind ? params.wind.intensity : 0.3
  const next = composeTree(id, stage, season, seed, { windIntensity: intensity })
  return preserveUserBits(next, params)
}

/* ------------------------------------------------------------------ */
/* 树种原型 / 自动生成                                                  */
/* ------------------------------------------------------------------ */

/* 树种 -> 叶色参考板 [基色, 高光色] (CSS hex 字符串)。
 * 注意: 当前文件内没有引用它 —— 自动生成的叶色改由 species.js 的季节调色板
 * (palette / tipPalette) 决定; 这里保留作为"该树种大致长什么颜色"的速查表,
 * 后续做个体色相派生时可直接复用。 */
const LEAF_PALETTES = {
  oak: ['#5d9c37', '#a3cd63'],
  maple: ['#d3712c', '#efb454'],
  birch: ['#8cc04f', '#dcec8e'],
  willow: ['#7cab41', '#b6d878'],
  pine: ['#4e8b46', '#87c26c'],
  sakura: ['#edaac4', '#f9dde6'],
  shrub: ['#5a9243', '#96c463'],
  dead: ['#7d7d6a', '#a3a38c'],
}

/* 自动生成: 一个种子 => 一棵随机但合理的树                              */
/* ------------------------------------------------------------------ */

/* ---------------- 自动生成的抽样权重 ----------------
 * 三组数组必须与各自的 ids 数组**同序等长**, 元素是"被抽中的概率" (该组求和 = 1):
 *   - 树种原型: 橡树最常见 (最典型的阔叶乔木), 枯树最少 (视觉上是特例)
 *   - 生长阶段: 由 GROWTH_STAGES 派生 id, 顺序固定为
 *     seedling / sapling / young / mature / ancient, 权重对应 5 个值
 *   - 季节:    由 SEASONS 派生 id, 顺序固定为 spring / summer / autumn / winter
 * 这些权重直接决定"点随机生成 10 次会看到什么", 改它们等于改产品的默认观感。 */
const ARCHETYPE_IDS = ['oak', 'maple', 'pine', 'birch', 'willow', 'sakura', 'shrub', 'dead']
const ARCHETYPE_WEIGHTS = [0.2, 0.13, 0.14, 0.14, 0.1, 0.11, 0.1, 0.08]
// 随机时"大树/小树"更常见, 树苗与古树是少数
const STAGE_IDS = GROWTH_STAGES.map((s) => s.id)
const STAGE_WEIGHTS = [0.1, 0.16, 0.24, 0.36, 0.14]
const SEASON_IDS = SEASONS.map((s) => s.id)
const SEASON_WEIGHTS = [0.26, 0.34, 0.26, 0.14]

/**
 * 按权重抽一个 id (轮盘赌)。
 *
 * 只消耗 **1 次** rng.next(), 这是刻意的: 抽样次数越少, 之后追加新的随机量时
 * 越不容易打乱已有种子的结果 (见文件头的确定性约定)。
 * 权重不必严格归一化, 内部按总和缩放; 全部抽空的极端情况回退到最后一个 id。
 *
 * @param {object} rng makeRng() 返回的随机流 (需要有 next(): 0..1)
 * @param {Array<string>} ids 候选 id (与 weights 同序)
 * @param {Array<number>} weights 相对权重 (>=0, 全 0 时会直接落到最后一个)
 * @returns {string} 抽中的 id
 */
function weightedPick(rng, ids, weights) {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < ids.length; i++) {
    r -= weights[i]
    if (r <= 0) return ids[i]
  }
  return ids[ids.length - 1]
}

/**
 * 自动生成: 树种 × 生长阶段 × 季节 都随机抽, 再叠加 chaos 幅度的个体扰动。
 *
 * 流程 (每一步都只在上一版"生物上站得住"的形态上做增量, 不会凭空造参数):
 *   ① 三条具名子流各抽一次: 树种 / 阶段 / 季节 (传了 force 系列参数就跳过对应抽样)
 *   ② composeTree 拼出完整参数 (此时用的是该物种的标准形态)
 *   ③ 叠加 chaos 幅度的个体扰动 → 树干、各级枝条、树叶
 *   ④ 枯树有概率补几片残叶 (否则"枯树"永远完全光秃, 显得假)
 *   ⑤ 风场按种子重推 (强度再随机浮动), 并把分类信息写回参数
 *   ⑥ 用 estimateScale 做叶片预算回缩, 防止枝条一多叶子指数爆炸
 *
 * 注意 force 系列参数只影响"分类", 不影响抽样消耗: 一旦传了 forceType,
 * 树种那次 rng 抽样被跳过, 后面的抽样位置整体前移 —— 所以同一 seed
 * 下"随机"与"指定树种"生成的树不是同一棵, 这是预期行为。
 *
 * @param {number} seed 种子 (决定一切随机)
 * @param {number} [chaos=0.6] 混乱度 0..1 (0 = 规整, 1 = 狂野); 会被夹到区间内
 * @param {string|null} [forceType=null] 强制树种 id
 * @param {string|null} [forceStage=null] 强制生长阶段 id
 * @param {string|null} [forceSeason=null] 强制季节 id
 * @returns {{params: object, type: string}} params = 完整参数树, type = 实际使用的树种 id
 */
export function autoGenerate(seed, chaos = 0.6, forceType = null, forceStage = null, forceSeason = null) {
  const rng = makeRng(seed, 'auto-tree')
  const k = Math.max(0, Math.min(1, chaos))
  const type = forceType || weightedPick(rng, ARCHETYPE_IDS, ARCHETYPE_WEIGHTS)
  const stage = forceStage || weightedPick(rng, STAGE_IDS, STAGE_WEIGHTS)
  const season = forceSeason || weightedPick(rng, SEASON_IDS, SEASON_WEIGHTS)

  // 1. 从"树种 + 阶段 + 季节"组合出发
  let params = composeTree(type, stage, season, seed, { chaos: k, windIntensity: rng.range(0.25, 0.6) })

  // 2. 再叠加 chaos 幅度的个体扰动 (阶段/季节已经定了形态与物候, 这里只做微调)。
  //    扰动幅度统一用 rng.range(1-0.4k, 1+0.45k) 这种"乘性 ±x%"形式:
  //    乘性扰动对大小不同的树等比生效, 不会把 1.6m 的灌木扰成 8m;
  //    每个字段后面都跟一个 Math.max/min 硬夹, 防止多次乘算后出现负值/畸形树。
  const t = params.trunk
  t.height = +(t.height * rng.range(1 - 0.4 * k, 1 + 0.45 * k)).toFixed(3)
  t.baseRadius = +(t.baseRadius * rng.range(1 - 0.3 * k, 1 + 0.35 * k)).toFixed(4)
  t.curve = +Math.max(0, t.curve + rng.signed() * 0.35 * k).toFixed(3)
  t.lean = +(rng.signed() * 0.14 * k).toFixed(3)
  t.leanDirection = Math.round(rng.range(0, 360))
  t.gnarl = +Math.max(0, t.gnarl + rng.signed() * 0.35 * k).toFixed(3)
  t.knots = Math.max(0, Math.round(t.knots + rng.signed() * 3 * k))
  t.twist = +Math.max(-0.6, t.twist + rng.signed() * 0.3 * k).toFixed(3)

  const lv = params.branches.level.map((L) => {
    const o = { ...L }
    o.count = Math.max(1, Math.round(L.count * rng.range(1 - 0.45 * k, 1 + 0.5 * k)))
    o.pitch = +Math.max(5, Math.min(145, L.pitch + rng.signed() * 22 * k)).toFixed(2)
    o.pitchVariance = +Math.max(0, L.pitchVariance + rng.signed() * 14 * k).toFixed(2)
    o.lengthRatio = +Math.max(0.05, L.lengthRatio * rng.range(1 - 0.3 * k, 1 + 0.35 * k)).toFixed(4)
    o.lengthVariance = +Math.max(0, Math.min(0.8, L.lengthVariance + rng.signed() * 0.2 * k)).toFixed(3)
    o.radiusRatio = +Math.max(0.1, Math.min(0.9, L.radiusRatio * rng.range(1 - 0.2 * k, 1 + 0.25 * k))).toFixed(4)
    o.curve = +Math.max(0, L.curve + rng.signed() * 0.4 * k).toFixed(3)
    o.gravity = +Math.max(-0.6, Math.min(0.5, L.gravity + rng.signed() * 0.3 * k)).toFixed(3)
    o.twist = +Math.max(-0.8, Math.min(0.8, L.twist + rng.signed() * 0.3 * k)).toFixed(3)
    // 叶序角: 70% 概率用黄金角 137.5° (自然界最常见的排布), 剩下 30% 在 90~200° 之间随机,
    // 这样大部分枝条看起来"有序", 少数个体出现对生/轮生的异类排布, 更接近真实林分
    o.phyllotaxis = +(rng.chance(0.7) ? 137.5 : rng.range(90, 200)).toFixed(2)
    o.spread = +Math.min(1.2, L.spread + rng.signed() * 0.3 * k).toFixed(3)
    return o
  })
  params.branches.level = lv
  // 有效层级数 1..5: 枝量是连乘的 (每层"每根父枝上长几根"), 所以层级数抖动 1 级 = 枝量翻几倍,
  // 这里只允许 ±1.4 的抖动, 并且夹在 1..5 (树干本身算第 0 层, 树枝最多 5 级)
  params.branches.levels = Math.max(1, Math.min(5, Math.round(params.branches.levels + rng.signed() * 1.4 * k)))
  params.branches.apicalDominance = +Math.max(0, Math.min(0.95, params.branches.apicalDominance + rng.signed() * 0.3 * k)).toFixed(3)
  params.branches.phototropism = +Math.max(-0.4, Math.min(0.4, params.branches.phototropism + rng.signed() * 0.15 * k)).toFixed(3)

  // 3. 树叶: 大小/密度微调 (颜色由季节决定, 这里只在同色系里做个体色差)
  const leaf = params.leaves
  if (leaf.enabled) {
    leaf.size = +Math.max(0.05, leaf.size * rng.range(1 - 0.25 * k, 1 + 0.3 * k)).toFixed(3)
    leaf.width = +Math.max(0.08, Math.min(1.4, leaf.width * rng.range(1 - 0.2 * k, 1 + 0.25 * k))).toFixed(3)
    leaf.clusterCount = Math.max(1, Math.round(leaf.clusterCount * rng.range(1 - 0.3 * k, 1 + 0.4 * k)))
    leaf.perBranch = Math.max(1, Math.round(leaf.perBranch * rng.range(1 - 0.3 * k, 1 + 0.35 * k)))
    leaf.colorVariance = +Math.min(0.7, leaf.colorVariance + rng.signed() * 0.12 * k).toFixed(3)
    leaf.pitch = +(leaf.pitch + rng.signed() * 16 * k).toFixed(2)
    leaf.droop = +Math.max(0, Math.min(1, leaf.droop + rng.signed() * 0.25 * k)).toFixed(3)
    // 少量个体的色相整体偏移 (例如某些橡树偏黄而非偏红)
    if (rng.chance(0.35)) leaf.color = rng.pick([leaf.color, leaf.colorTip])
  }

  // 4. 枯树有概率长几片残叶。levels 是"每层枝条是否长叶"的开关数组, 这里只点亮第 3 层,
  //    配合 clusterCount=1 就是"零星的几小撮残叶"; 不这么做的话枯树永远完全光秃, 反而假。
  if (type === 'dead' && rng.chance(0.35)) {
    leaf.enabled = true
    leaf.levels = [false, false, true, false, false]
    leaf.perBranch = rng.int(2, 5)
    leaf.clusterCount = 1
    leaf.size = +(leaf.size * 0.6).toFixed(3)
  }

  // 5. 风场: 档位再随种子浮动一点
  params.wind = { ...params.wind, ...autoWind(seed, rng.range(0.25, 0.95)) }
  params.auto.chaos = k
  // 把这次抽到的分类写回参数: 面板靠它显示"橡树 · 大树 · 秋", 存档也靠它复现同一棵树
  // (实际形态早已展开进各分组里, classify 只是元数据, 改它不会改变已生成的树)
  params.classify = { species: type, stage, season }
  params.seed = seed

  // 6. 叶片预算: 枝条一多, 叶子就指数爆炸, 这里按估算量回缩密度。
  //    composeTree 内部已按 leafBudget(默认 14000) 压过一轮, 但上面第 3 步的扰动
  //    又可能把 perBranch/clusterCount 顶上去, 所以这里再软性回缩一次。
  //    取立方根(而不是平方根)是保守做法: 两个密度参数同乘 s, 叶量大约按 s² 下降,
  //    一次只降到 budget^(2/3) 量级 —— 宁可略超预算, 也不要把树冠一次削秃。
  const est = estimateScale(params)
  const budget = 14000
  if (est.leaves > budget) {
    const scale = Math.max(1, Math.cbrt(budget / est.leaves))
    leaf.perBranch = Math.max(1, Math.round(leaf.perBranch * scale))
    leaf.clusterCount = Math.max(1, Math.round(leaf.clusterCount * scale))
  }

  return { params, type }
}

/**
 * 树种 id -> 面板显示名 ("🌳 橡树")。
 * 未知 id 原样返回, 这样即使存档里写了已经删掉的树种, UI 也不会显示成空白。
 * @param {string} type 树种 id
 * @returns {string} 带图标的显示名
 */
export function archetypeName(type) {
  const p = presetById(type)
  return p ? `${p.icon} ${p.name}` : type
}
