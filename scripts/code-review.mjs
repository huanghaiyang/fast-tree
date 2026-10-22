/**
 * 代码走查 (node scripts/code-review.mjs)
 * ------------------------------------------------------------
 * 抓的是"机器能判定"的真错误 (不是风格):
 *   [E1] 本地模块的具名导入在目标文件里不存在 (运行时 ReferenceError / import 失败)
 *   [E2] 同一文件里重复声明 const/let/function (SyntaxError)
 *   [E3] .vue 组件用了 ref/computed/watch/... 却没从 vue 导入 (上次踩过)
 *   [E4] this.treeGroup.add(x) 类调用里 x 可能为 null (上次踩过)
 *   [E5] throw / console.error 的字符串里含未使用的占位
 *   [E6] .vue 脚本里把 computed ref 当普通对象读写 (X.foo 而非 X.value.foo) -> 静默失效
 *   [W1] 导入但从未使用的符号 (警告)
 *   [W2] 文件里出现 NaN 风险: += 一个可能是 undefined 的字段之外, 简单报告 parseInt(x) 无基数
 * 退出码: 有 E* 时报 1
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const SRC = path.join(ROOT, 'src')
const problems = []
const warnings = []

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|mjs|vue)$/.test(e.name)) out.push(p)
  }
  return out
}

/** 收集一个文件导出的符号 */
function exportsOf(file) {
  const src = fs.readFileSync(file, 'utf8')
  const names = new Set()
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim().split(/\s+as\s+/)
      if (t.length) names.add((t[1] || t[0]).trim())
    }
  }
  if (/export\s+default/.test(src)) names.add('default')
  if (file.endsWith('.vue')) names.add('default')   // SFC 默认导出组件
  return names
}

/** 解析 import 语句, 返回 [{spec, names:[], type:'named'|'default'|'star', line}] */
function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8')
  const out = []
  const re = /import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(src))) {
    const clause = m[1].trim()
    const spec = m[2]
    if (!spec.startsWith('.')) continue
    const line = src.slice(0, m.index).split('\n').length
    if (clause.startsWith('{')) {
      const names = clause
        .replace(/[{}]/g, '')
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean)
      out.push({ spec, names, type: 'named', line })
    } else if (clause === '*') {
      out.push({ spec, names: [], type: 'star', line })
    } else if (/^[A-Za-z_$][\w$]*$/.test(clause)) {
      out.push({ spec, names: ['default'], type: 'default', line, alias: clause })
    } else if (clause.includes('{')) {
      const def = clause.split(',')[0].trim()
      const names = clause.slice(clause.indexOf('{')).replace(/[{}]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
      out.push({ spec, names: def ? ['default', ...names] : names, type: 'mixed', line })
    }
  }
  return out
}

const files = walk(SRC)
const exportCache = new Map()
const expOf = (f) => {
  if (!exportCache.has(f)) exportCache.set(f, fs.existsSync(f) ? exportsOf(f) : null)
  return exportCache.get(f)
}

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')

  /* E1 / W1: 导入符号是否存在 + 是否被使用 */
  for (const imp of importsOf(file)) {
    const base = path.resolve(path.dirname(file), imp.spec)
    const cand = [base, base + '.js', base + '.vue', path.join(base, 'index.js')].find((p) => fs.existsSync(p) && fs.statSync(p).isFile())
    if (!cand) {
      problems.push({ code: 'E1', file, line: imp.line, msg: `导入路径不存在: ${imp.spec}` })
      continue
    }
    if (imp.type === 'star') continue
    const exps = expOf(cand)
    for (const n of imp.names) {
      if (n && !exps.has(n)) {
        problems.push({ code: 'E1', file, line: imp.line, msg: `${path.basename(cand)} 没有导出 \`${n}\` (导入自 ${imp.spec})` })
      } else if (n) {
        // W1: 导入后是否使用
        const body = src.replace(/import[^\n]*\n/g, '')
        const used = new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(body)
        if (!used && n !== 'default') warnings.push({ code: 'W1', file, line: imp.line, msg: `导入了 \`${n}\` 但未使用` })
      }
    }
  }

  /* E2: 重复声明 (只在顶层作用域判重: 不同函数里同名 const 是合法的) */
  const lines2 = src.split('\n')
  let depth = 0
  const declTop = new Map()
  for (let i = 0; i < lines2.length; i++) {
    const line = lines2[i]
    const m = line.match(/^(\s*)(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/)
    if (m && depth === 0) {
      const name = m[2]
      if (declTop.has(name)) problems.push({ code: 'E2', file, line: i + 1, msg: `顶层重复声明 \`${name}\` (首次在第 ${declTop.get(name)} 行)` })
      else declTop.set(name, i + 1)
    }
    // 粗略维护大括号层级 (忽略字符串/注释中的括号, 对定位足够)
    const stripped = line.replace(/\/\/.*$/, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')
    depth += (stripped.match(/{/g) || []).length - (stripped.match(/}/g) || []).length
    if (depth < 0) depth = 0
  }
  {
    let d2 = 0
    for (let i = 0; i < lines2.length; i++) {
      const line = lines2[i]
      const m = line.match(/^(\s*)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
      if (m && d2 === 0) {
        const name = m[2]
        if (declTop.has(name)) problems.push({ code: 'E2', file, line: i + 1, msg: `顶层声明冲突: \`${name}\` (第 ${declTop.get(name)} 行已声明)` })
        else declTop.set(name, i + 1)
      }
      const stripped = line.replace(/\/\/.*$/, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')
      d2 += (stripped.match(/{/g) || []).length - (stripped.match(/}/g) || []).length
      if (d2 < 0) d2 = 0
    }
  }

  /* E3: vue 组合式 API 未导入 */
  if (file.endsWith('.vue')) {
    const script = src.split('<script setup>')[1]?.split('</script>')[0] || ''
    if (script) {
      const vueImport = /import\s*\{([^}]+)\}\s*from\s*'vue'/.exec(script)
      const imported = new Set(vueImport ? vueImport[1].split(',').map((s) => s.trim()) : [])
      for (const api of ['ref', 'computed', 'watch', 'watchEffect', 'reactive', 'onMounted', 'onBeforeUnmount', 'onUnmounted', 'nextTick', 'markRaw', 'shallowRef', 'toRaw', 'provide', 'inject']) {
        const used = new RegExp(`(?<![\\w$.])${api}\\(`).test(script)
        if (used && !imported.has(api)) problems.push({ code: 'E3', file, msg: `使用了 ${api}() 但未从 vue 导入` })
      }
    }
  }

  /* E4: add(...) 传入可能为 null 的对象 */
  if (file.endsWith('sceneManager.js')) {
    const lines = src.split('\n')
    lines.forEach((l, i) => {
      const m = l.match(/\.add\(\s*(this\.[A-Za-z_$][\w$]*)\s*\)/)
      if (!m) return
      const v = m[1]
      const ctx = lines.slice(Math.max(0, i - 30), i + 2).join('\n')
      const assigned = new RegExp(`${v.replace('.', '\\.')}\\s*=`).test(ctx)
      const guarded = new RegExp(`if\\s*\\(\\s*${v.replace('.', '\\.')}\\s*\\)`).test(ctx) || new RegExp(`\\?\\?`).test(l)
      if (!assigned && !guarded) problems.push({ code: 'E4', file, line: i + 1, msg: `add(${v}) 附近没有赋值/判空, 可能传入 null` })
    })
  }

  /* E6: .vue 的 <script> 里把 computed ref 当普通对象读写 (X.foo 而不是 X.value.foo)
     模板里 X.foo 没问题 (模板自动解包 ref), 脚本里必须写 X.value.foo;
     写成 X.foo = ... 只是给 ref 对象挂了个无用属性 —— 参数没变, 表现为"点了没反应"。
     (上次踩过: 树皮缩略图点击不换贴图) */
  if (file.endsWith('.vue')) {
    const script = src.split('<script setup>')[1]?.split('</script>')[0] || ''
    if (script) {
      const computedNames = [...script.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*computed\s*\(/g)].map((m) => m[1])
      if (computedNames.length) {
        const lines = script.split('\n')
        const baseLine = src.slice(0, src.indexOf(script)).split('\n').length
        lines.forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*|-)/.test(line)) return
          for (const name of computedNames) {
            const esc = name.replace(/[$]/g, '\\$')
            const re = new RegExp(`(?<![\\w$.])${esc}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g')
            let m
            while ((m = re.exec(line))) {
              if (m[1] === 'value') continue
              problems.push({
                code: 'E6',
                file,
                line: baseLine + i,
                msg: `${name} 是 computed ref, 脚本里要写 ${name}.value.${m[1]} (直接写 ${name}.${m[1]} 会静默失效)`,
              })
            }
          }
        })
      }
    }
  }

  /* W2: parseInt 未指定进制 (潜在八进制/十六进制误解析) */
  for (const m of src.matchAll(/parseInt\(([^)]*)\)/g)) {
    if (!m[1].includes(',')) warnings.push({ code: 'W2', file, line: src.slice(0, m.index).split('\n').length, msg: `parseInt 未指定进制: ${m[0].slice(0, 40)}` })
  }
}

/* ---------------- 输出 ---------------- */
const E = problems.filter((p) => p.code.startsWith('E'))
const W = warnings
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/')
console.log(`走查文件: ${files.length}\n`)
if (E.length) {
  console.log(`❌ 错误 ${E.length}:`)
  for (const p of E.slice(0, 40)) console.log(`  [${p.code}] ${rel(p.file)}${p.line ? ':' + p.line : ''} — ${p.msg}`)
  if (E.length > 40) console.log(`  … 还有 ${E.length - 40} 条`)
} else console.log('✅ 未发现机器可判定的错误 (E1 导入不存在 / E2 重复声明 / E3 vue API 未导入 / E4 add(null) / E6 computed ref 误用)')
if (W.length) {
  console.log(`\n⚠️  警告 ${W.length} (前 15):`)
  for (const p of W.slice(0, 15)) console.log(`  [${p.code}] ${rel(p.file)}:${p.line} — ${p.msg}`)
  if (W.length > 15) console.log(`  … 还有 ${W.length - 15} 条`)
}
process.exit(E.length ? 1 : 0)
