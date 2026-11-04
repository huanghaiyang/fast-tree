/**
 * 生成"参数 -> 函数 -> 函数"关系图数据 (只读可视化用)。
 *
 * 为什么用脚本生成而不是手写:
 *   树生成器涉及 40+ 个模块、300+ 个函数、24 组参数, 手写关系图必然漏项且很快过期。
 *   本脚本直接扫描 src/core/*.js 与 src/store/treeStore.js:
 *     1. 函数: 函数声明 + 块体箭头函数, 记录所属模块、起始行号、是否导出;
 *     2. 调用: 在函数体 (扣除嵌套函数体) 里找 `name(` 与 `ns.name(`, 只保留能解析到
 *        本模块函数或 import 绑定目标的标识符 —— 宁可少边, 不要假边;
 *     3. 参数: 从 defaultParams() 递归展开出 24 个顶层参数组与全部叶子路径;
 *     4. 参数引用: 用"别名 + 属性名"推断参数组, 记录 `参数组 -> 函数` 的引用边。
 *
 * 产物: src/core/graphData.generated.js (纯数据, 无副作用, 浏览器端只 import 不执行)。
 * 用法: npm run graph  (改动 core 代码后重新生成; 图谱面板会提示数据生成时间)
 *
 * 约定: 生成的 id 全部稳定 (模块名:函数名), 因此同一次源码扫描结果逐字节一致,
 *       便于 review diff。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultParams } from '../src/core/params.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')

/* ------------------------------------------------------------------ *
 * 1. 文件与模块元信息
 * ------------------------------------------------------------------ */

// 扫描范围: core 全部源码 + store。generated 数据文件不含逻辑, 跳过。
const CORE_DIR = path.join(SRC, 'core')
const FILES = []
for (const f of fs.readdirSync(CORE_DIR)) {
  if (!f.endsWith('.js')) continue
  if (f.endsWith('.generated.js')) continue
  FILES.push(path.join(CORE_DIR, f))
}
FILES.push(path.join(SRC, 'store', 'treeStore.js'))

/** 模块分类: 图谱按分类分列, 让"参数/生成/材质/场景/导出"一眼可分。 */
const CATEGORY = {
  params: '参数与预设',
  treeBuilder: '参数与预设',
  params2: '参数与预设',
  paramDocs: '参数与预设',
  presets: '参数与预设',
  species: '参数与预设',
  templateDb: '参数与预设',
  ftree: '参数与预设',

  barkSkeleton: '几何生成',
  barkSkin: '几何生成',
  speedtreeBark: '几何生成',
  leaf: '几何生成',
  leafTexture: '几何生成',
  fruit: '几何生成',
  fruitMaterial: '几何生成',
  forceField: '几何生成',
  ambientOcclusion: '几何生成',
  meshTopology: '几何生成',
  mathUtils: '几何生成',
  rng: '几何生成',
  twist: '几何生成',
  leafEffects: '几何生成',

  materials: '材质与贴图',
  textures: '材质与贴图',
  barkTextures: '材质与贴图',
  environments: '材质与贴图',
  normalFromAlbedo: '材质与贴图',
  materialPreview: '材质与贴图',

  sceneManager: '场景与风',
  windModel: '场景与风',
  autowind: '场景与风',
  particles: '场景与风',
  fallingLeaves: '场景与风',
  litter: '场景与风',
  renderChunks: '场景与风',

  exporter: '导出与统计',
  exportPreview: '导出与统计',
  exportSplit: '导出与统计',
  impostor: '导出与统计',
  modelStats: '导出与统计',

  treeStore: '应用与接口',
  appApi: '应用与接口',
  apiRegistry: '应用与接口',
  propertySearch: '应用与接口',
}

const MODULE_CN = {
  params: '参数定义',
  paramDocs: '参数说明',
  presets: '预设',
  species: '树种',
  templateDb: '模板库',
  ftree: '工程文件',
  treeBuilder: '树构建器',
  barkSkeleton: '树皮骨架',
  barkSkin: '树皮蒙皮',
  speedtreeBark: 'SpeedTree 蒙皮',
  leaf: '树叶几何',
  leafTexture: '叶纹理',
  fruit: '果实',
  fruitMaterial: '果实材质',
  forceField: '力场',
  ambientOcclusion: '环境光遮蔽',
  meshTopology: '网格拓扑',
  mathUtils: '数学工具',
  rng: '随机流',
  twist: '扭曲编辑',
  leafEffects: '叶片特效',
  materials: '材质',
  textures: '贴图',
  barkTextures: '树皮贴图',
  environments: '环境',
  normalFromAlbedo: '法线生成',
  materialPreview: '材质预览',
  sceneManager: '场景管理',
  windModel: '风场模型',
  autowind: '自动风',
  particles: '粒子',
  fallingLeaves: '落叶',
  litter: '地表落叶',
  renderChunks: '渲染分块',
  exporter: 'GLB 导出',
  exportPreview: '导出预览',
  exportSplit: '导出拆分',
  impostor: 'Impostor',
  modelStats: '模型统计',
  treeStore: '状态仓库',
  appApi: '应用接口',
  apiRegistry: '接口注册',
  propertySearch: '属性搜索',
}

/* ------------------------------------------------------------------ *
 * 2. 代码清洗: 去注释与字符串 (保留换行, 保证行号可还原)
 * ------------------------------------------------------------------ */

/**
 * 把注释与字符串内容替换为空格, 保留 `\n` 与长度。
 * 这样后续用正则在清洗后的文本上扫描时, 不会把注释里的 "foo(" 或字符串里的
 * "bar(" 当成真实调用; 同时 index -> 行号的映射仍然成立。
 */
function stripCommentsAndStrings(src) {
  const out = src.split('')
  let i = 0
  const n = src.length
  let mode = null // 'line' | 'block' | 'single' | 'double' | 'template'
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    if (mode === 'line') {
      if (c === '\n') mode = null
      else out[i] = ' '
      i++
      continue
    }
    if (mode === 'block') {
      if (c === '*' && c2 === '/') { out[i] = ' '; out[i + 1] = ' '; i += 2; mode = null; continue }
      if (c !== '\n') out[i] = ' '
      i++
      continue
    }
    if (mode) { // 字符串内部
      const quote = mode === 'single' ? "'" : mode === 'double' ? '"' : '`'
      if (c === '\\') { out[i] = ' '; if (src[i + 1] !== '\n') out[i + 1] = ' '; i += 2; continue }
      if (c === quote) { out[i] = ' '; mode = null; i++; continue }
      if (c !== '\n') out[i] = ' '
      i++
      continue
    }
    // 正常代码
    if (c === '/' && c2 === '/') { out[i] = ' '; out[i + 1] = ' '; i += 2; mode = 'line'; continue }
    if (c === '/' && c2 === '*') { out[i] = ' '; out[i + 1] = ' '; i += 2; mode = 'block'; continue }
    if (c === "'") { out[i] = ' '; i++; mode = 'single'; continue }
    if (c === '"') { out[i] = ' '; i++; mode = 'double'; continue }
    if (c === '`') { out[i] = ' '; i++; mode = 'template'; continue }
    i++
  }
  return out.join('')
}

/* ------------------------------------------------------------------ *
 * 3. 扫描函数体
 * ------------------------------------------------------------------ */

/** 从 bodyOpen (`{` 的下标) 出发做括号配对, 返回闭合 `}` 的下标; 失败返回 -1。 */
function matchBrace(text, bodyOpen) {
  let depth = 0
  for (let i = bodyOpen; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'void',
  'new', 'delete', 'do', 'else', 'with', 'yield', 'await', 'super', 'import',
])

/**
 * 扫描一个文件里的函数 (声明式 + 块体箭头函数)。
 * 返回: [{ name, start, end, bodyStart, bodyEnd, line, exported }]
 * start/end 是整段函数的 [start, end] 下标 (end 为闭合 `}`), bodyStart/bodyEnd 是
 * 花括号内部区间, 供扫描调用与参数引用。
 */
function scanFunctions(text, original) {
  const fns = []
  const declRe = /(?:^|\n)[ \t]*(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g
  const arrowRe = /(?:^|\n)[ \t]*(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g
  // 类方法 / 对象方法简写: `  build(params, opts = {}) {`。
  // 只匹配"行首缩进 + 标识符 + 参数列表 + {" 的形状, 再用关键字黑名单排掉 if/for 等。
  const methodRe = /(?:^|\n)[ \t]+(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g

  const push = (name, exported, fnStart, bodyOpen) => {
    const bodyClose = matchBrace(text, bodyOpen)
    if (bodyClose < 0) return
    const line = original.slice(0, fnStart).split('\n').length
    fns.push({
      name,
      exported,
      start: fnStart,
      end: bodyClose,
      bodyStart: bodyOpen + 1,
      bodyEnd: bodyClose,
      line,
    })
  }

  /**
   * 从参数列表的左括号出发找函数体左花括号。
   * 不能简单用 indexOf('{') —— 像 `function f(params, options = {})` 这种默认参数里
   * 就先出现花括号, 会把函数体范围截成 `{}` 本身, 导致整个函数的调用/参数引用全部丢失。
   * 先做括号配对到参数列表右括号, 其后第一个 `{` 才是函数体。
   */
  const bodyOpenOf = (parenOpen) => {
    let depth = 0
    for (let i = parenOpen; i < text.length; i++) {
      const c = text[i]
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) {
          const brace = text.indexOf('{', i + 1)
          return brace
        }
      }
    }
    return -1
  }

  let m
  while ((m = declRe.exec(text))) {
    const fnStart = m.index + m[0].indexOf(m[2])
    let paren = -1
    for (let i = m.index; i < m.index + m[0].length; i++) if (text[i] === '(') { paren = i; break }
    if (paren < 0) continue
    const bodyOpen = bodyOpenOf(paren)
    if (bodyOpen < 0) continue
    push(m[2], !!m[1], fnStart, bodyOpen)
  }
  while ((m = arrowRe.exec(text))) {
    const fnStart = m.index + m[0].indexOf(m[2])
    const bodyOpen = m.index + m[0].length - 1
    push(m[2], !!m[1], fnStart, bodyOpen)
  }
  while ((m = methodRe.exec(text))) {
    const name = m[1]
    if (KEYWORDS.has(name)) continue
    const fnStart = m.index + m[0].indexOf(name)
    // 参数列表左括号 = name 之后第一个 '('; 用 bodyOpenOf 跳过默认参数里的花括号
    const paren = text.indexOf('(', fnStart + name.length)
    if (paren < 0) continue
    const bodyOpen = bodyOpenOf(paren)
    if (bodyOpen < 0) continue
    push(name, false, fnStart, bodyOpen)
  }
  // 同一位置可能被两种规则命中; 用 name+start 去重
  const seen = new Set()
  return fns.filter((f) => {
    const k = `${f.name}@${f.start}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).sort((a, b) => a.start - b.start)
}

/* ------------------------------------------------------------------ *
 * 4. import 绑定解析
 * ------------------------------------------------------------------ */

function parseImports(text) {
  /** @type {Map<string, {module:string, importName:string|null}>} */
  const bindings = new Map()
  const ns = new Map() // namespace 绑定: alias -> module
  const re = /import\s+([\s\S]*?)\s+from\s+['"](\.[^'"]+)['"]/g
  let m
  while ((m = re.exec(text))) {
    const spec = m[1].trim()
    const rel = m[2]
    const mod = path.basename(rel).replace(/\.js$/, '')
    if (spec.startsWith('*')) {
      const nm = spec.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
      if (nm) ns.set(nm[1], mod)
      continue
    }
    // 默认导入 + 命名导入: `Foo, { a as b }`
    const named = spec.match(/\{([\s\S]*)\}/)
    if (named) {
      for (const part of named[1].split(',')) {
        const s = part.trim()
        if (!s) continue
        const am = s.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
        if (am) bindings.set(am[2], { module: mod, importName: am[1] })
        else bindings.set(s, { module: mod, importName: s })
      }
    }
  }
  return { bindings, ns }
}

/* ------------------------------------------------------------------ *
 * 5. 参数组与叶子路径
 * ------------------------------------------------------------------ */

const params = defaultParams()

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 递归展开参数对象, 产出叶子路径。数组按"取第 0 个元素结构"展开并加 `[]` 后缀,
 * 避免把 branches.level 的 5 份相同结构重复列 5 遍 (详情面板里显示 `level[0..4]`)。
 */
function flattenParam(obj, prefix, out, depth = 0) {
  for (const [k, v] of Object.entries(obj)) {
    const keyPath = prefix ? `${prefix}.${k}` : k
    if (Array.isArray(v)) {
      if (v.length && isPlainObject(v[0]) && depth < 3) {
        flattenParam(v[0], keyPath + '[]', out, depth + 1)
      } else {
        out.push({ path: keyPath, value: JSON.stringify(v) })
      }
    } else if (isPlainObject(v)) {
      if (depth >= 3) out.push({ path: keyPath, value: '{…}' })
      else flattenParam(v, keyPath, out, depth + 1)
    } else {
      out.push({ path: keyPath, value: typeof v === 'string' ? v : String(v) })
    }
  }
}

const paramGroups = Object.keys(params).map((group) => {
  const fields = []
  if (isPlainObject(params[group])) flattenParam(params[group], '', fields)
  else fields.push({ path: group, value: String(params[group]) })
  return { id: group, name: group, fields }
})

// 深度 key -> 参数组 (用于 cfg/t 这类"局部配置别名"的归属推断)
const groupOfKey = new Map()
for (const g of paramGroups) {
  for (const f of g.fields) {
    const leaf = f.path.split('.').pop().replace(/\[\]/g, '')
    if (!groupOfKey.has(leaf)) groupOfKey.set(leaf, [])
    const list = groupOfKey.get(leaf)
    if (!list.includes(g.id)) list.push(g.id)
  }
}
// 顶层组名本身也是 key (P.trunk / P.leaves ...)
for (const g of paramGroups) groupOfKey.set(g.id, [g.id])

const TOP_GROUPS = new Set(paramGroups.map((g) => g.id))

/** 单字母参数别名: 只在 treeBuilder 里成立 (那里约定 `const t = P.trunk` 等)。 */
const SINGLE_ALIAS = {
  t: 'trunk', T: 'trunk', k: 'trunk', K: 'trunk',
  L: 'leaves', F: 'fruit', FL: 'flower', R: 'roots', W: 'wind',
}
const SINGLE_ALIAS_MODULE = 'treeBuilder'

/** 全局参数对象别名: P.trunk / params.branches / lastParams.wind ... */
const GLOBAL_ALIAS_RE = /(?:^|[^A-Za-z0-9_$])(?:P|params|p|lastParams)\.([A-Za-z_$][\w$]*)/g
const STATE_PARAMS_RE = /(?:^|[^A-Za-z0-9_$])(?:state\.params|this\.lastParams|this\.params)\.([A-Za-z_$][\w$]*)/g
/** 局部配置别名: cfg.height / o.nodeJumble ... 由 key 推断参数组。 */
const LOCAL_ALIAS_RE = /(?:^|[^A-Za-z0-9_$])(?:cfg|o|opts|options|conf|config)\.([A-Za-z_$][\w$]*)/g

const PREFERRED_GROUPS = ['branches', 'leaves', 'trunk', 'fruit', 'flower', 'roots']

// 每个参数组实际拥有的叶子 key, 用于校验"别名.key"是否真是该组参数 (防止把
// `skeleton.branches.push(...)` 之类的对象方法误认成参数引用)。
const GROUP_KEYS = new Map()
for (const g of paramGroups) {
  GROUP_KEYS.set(g.id, new Set(g.fields.map((f) => f.path.split('.').pop().replace(/\[\]/g, ''))))
}

/** 判断 key 是否属于 group 的参数集合。 */
function groupHasKey(group, key) {
  const s = GROUP_KEYS.get(group)
  return !!s && s.has(key)
}

/** 把一次 "别名.key" 引用解析成参数组; 无法确定或 key 不属于该组时返回 null (宁缺毋滥)。 */
function resolveGroup(key, fixedGroup, module) {
  if (fixedGroup) return groupHasKey(fixedGroup, key) ? fixedGroup : null
  if (TOP_GROUPS.has(key)) return key
  const cand = groupOfKey.get(key)
  if (!cand || !cand.length) return null
  for (const g of PREFERRED_GROUPS) if (cand.includes(g) && groupHasKey(g, key)) return g
  const only = cand.length === 1 && groupHasKey(cand[0], key) ? cand[0] : null
  return only
}

/* ------------------------------------------------------------------ *
 * 6. 主扫描
 * ------------------------------------------------------------------ */

const modules = []
const functionMap = new Map() // id -> fn
const moduleFns = new Map() // module -> Map(name -> fnId)

for (const file of FILES) {
  const original = fs.readFileSync(file, 'utf8')
  const clean = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'))
  const module = path.basename(file, '.js')
  const fns = scanFunctions(clean, original)

  // 同名函数 (嵌套/局部) 生成稳定后缀, 便于 id 唯一
  const nameCount = new Map()
  const idOf = new Map() // fn 对象 -> id
  for (const fn of fns) {
    const n = (nameCount.get(fn.name) || 0) + 1
    nameCount.set(fn.name, n)
    const id = `${module}:${fn.name}${n > 1 ? '#' + n : ''}`
    fn.id = id
    idOf.set(fn, id)
  }

  // 函数嵌套关系: 父函数 = 最小的包含区间
  for (const fn of fns) {
    fn.parent = null
    let best = null
    for (const other of fns) {
      if (other === fn) continue
      if (other.start <= fn.start && other.end >= fn.end) {
        if (!best || other.end - other.start < best.end - best.start) best = other
      }
    }
    fn.parent = best ? idOf.get(best) : null
  }

  const { bindings, ns } = parseImports(original)
  // module 内部按名字索引 (优先顶层/最早声明)
  const byName = new Map()
  for (const fn of fns) {
    const key = fn.name
    if (!byName.has(key)) byName.set(key, fn.id)
    else if (fn.parent == null && !byName.get('__top_' + key)) byName.set(key, fn.id)
  }

  const fnRecords = []
  for (const fn of fns) {
    // 直接函数体: 扣掉所有子函数区间的部分, 避免把子函数里的调用算到父函数头上
    const children = fns
      .filter((c) => c.parent === fn.id)
      .sort((a, b) => a.start - b.start)
    let body = ''
    let cursor = fn.bodyStart
    for (const c of children) {
      body += clean.slice(cursor, c.start)
      cursor = c.end + 1
    }
    body += clean.slice(cursor, fn.bodyEnd)

    const calls = new Set()
    const callRe = /(?:^|[^A-Za-z0-9_$.])([A-Za-z_$][\w$]*)\s*\(/g
    const nsCallRe = /(?:^|[^A-Za-z0-9_$])([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g
    let cm
    while ((cm = callRe.exec(body))) {
      const name = cm[1]
      if (KEYWORDS.has(name)) continue
      if (name === fn.name) continue // 递归: 保留? 递归对理解有价值, 但会自环; 跳过更清晰
      if (byName.has(name)) calls.add(byName.get(name))
      else if (bindings.has(name)) {
        const b = bindings.get(name)
        const target = `${b.module}:${b.importName}`
        const targetFn = functionMap.get(target) || null
        if (targetFn) calls.add(target)
        else calls.add(`@module:${b.module}`) // 目标模块存在但拿不到具体函数时保留模块级边
      }
    }
    while ((cm = nsCallRe.exec(body))) {
      const alias = cm[1]
      const name = cm[2]
      if (!ns.has(alias)) continue
      const mod = ns.get(alias)
      const target = `${mod}:${name}`
      if (functionMap.has(target)) calls.add(target)
      else calls.add(`@module:${mod}`)
    }

    // 参数引用
    const paramRefs = new Set()
    let pm
    const addParam = (group, key) => {
      if (!group) return
      // 整组引用 (P.wind / state.params.scene) 记成 group:*; 单字段引用要求 key 真属于该组。
      if (key === group) { paramRefs.add(`${group}:*`); return }
      if (groupHasKey(group, key)) paramRefs.add(`${group}:${key}`)
    }
    GLOBAL_ALIAS_RE.lastIndex = 0
    while ((pm = GLOBAL_ALIAS_RE.exec(body))) addParam(resolveGroup(pm[1], null, module), pm[1])
    STATE_PARAMS_RE.lastIndex = 0
    while ((pm = STATE_PARAMS_RE.exec(body))) addParam(resolveGroup(pm[1], null, module), pm[1])
    // 单字母别名 (t./L./F. …) 只在 treeBuilder 里按约定成立, 避免把普通局部变量
    // (例如骨架统计里的 `t.push`) 误判成参数引用。
    if (module === SINGLE_ALIAS_MODULE) {
      for (const [alias, group] of Object.entries(SINGLE_ALIAS)) {
        const re = new RegExp(`(?:^|[^A-Za-z0-9_$])${alias}\\.([A-Za-z_$][\\w$]*)`, 'g')
        let am
        while ((am = re.exec(body))) addParam(group, am[1])
      }
    }
    LOCAL_ALIAS_RE.lastIndex = 0
    while ((pm = LOCAL_ALIAS_RE.exec(body))) addParam(resolveGroup(pm[1], null, module), pm[1])

    fnRecords.push({
      id: fn.id,
      name: fn.name,
      module,
      line: fn.line,
      exported: !!fn.exported,
      parent: fn.parent,
      calls: [...calls].filter((c) => !c.startsWith('@module:')),
      externalCalls: [...calls].filter((c) => c.startsWith('@module:')).map((c) => c.slice(8)),
      paramRefs: [...paramRefs],
    })
  }

  for (const rec of fnRecords) functionMap.set(rec.id, rec)
  moduleFns.set(module, new Map(fnRecords.map((f) => [f.name, f.id])))
  modules.push({
    id: module,
    name: module,
    title: MODULE_CN[module] || module,
    category: CATEGORY[module] || '其他',
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    functions: fnRecords,
  })
}

/* ------------------------------------------------------------------ *
 * 7. 汇总边
 * ------------------------------------------------------------------ */

// 函数 -> 函数 (去掉指向本模块之外、无法解析的调用)
const callEdges = []
for (const fn of functionMap.values()) {
  for (const to of fn.calls) {
    if (!functionMap.has(to)) continue
    callEdges.push({ from: fn.id, to })
  }
}

// 参数组 -> 函数
const paramEdgeSeen = new Set()
const paramEdges = []
for (const fn of functionMap.values()) {
  for (const ref of fn.paramRefs) {
    const idx = ref.indexOf(':')
    const group = ref.slice(0, idx)
    const key = ref.slice(idx + 1)
    const id = `${group}:${key}:${fn.id}`
    if (paramEdgeSeen.has(id)) continue
    paramEdgeSeen.add(id)
    paramEdges.push({ group, key, to: fn.id })
  }
}

/* ------------------------------------------------------------------ *
 * 8. 输出
 * ------------------------------------------------------------------ */

const outPath = path.join(SRC, 'core', 'graphData.generated.js')
const payload = {
  params: paramGroups,
  modules,
  callEdges,
  paramEdges,
}
const banner = `/**
 * 此文件由 scripts/gen-graph.mjs 自动生成, 请勿手改。
 * 重新生成: npm run graph
 *
 * 内容: 参数组与叶子字段 / 模块与函数 / 函数调用边 / 参数引用边。
 * 供 components/FunctionGraph.vue 只读渲染"参数与调用关系图谱"。
 */
`
const body = `export const GRAPH_DATA = ${JSON.stringify(payload, null, 2)}\n`
fs.writeFileSync(outPath, banner + body, 'utf8')

const fnCount = functionMap.size
console.log(`[graph] 模块 ${modules.length} / 函数 ${fnCount} / 参数组 ${paramGroups.length} / 调用边 ${callEdges.length} / 参数边 ${paramEdges.length}`)
console.log(`[graph] -> ${path.relative(ROOT, outPath)}`)
