/**
 * 骨架蒙皮 (Single 2-manifold Bark Skin)
 * ------------------------------------------------------------
 * 作用: 把 barkSkeleton 的骨架图变成**一整张封闭的树皮几何** (树干 + 所有树枝 + 树根连成一体),
 *       分叉处是真的"在父枝上开洞, 再用一圈桥接面接到子枝根部", 而不是两根管子互相穿插。
 *
 * 输入: barkSkeleton 的骨架图 (节点 / 边 / 半径 / 父子关系), 需先跑过
 *       finalizeBarkSkeleton (补 attach) 与 enforceChildBranchRadii (子枝半径 ≤ 父枝 80%)。
 * 输出: 一整张封闭的树皮几何 (树干 + 所有树枝 + 树根连成一体)
 *       { geometry, stats, validation, rings, ringM, debug } —— 与 speedtreeBark 同形, 上层可平滑切换。
 *
 * 流程严格按"先骨架、后蒙皮":
 *   1) 骨架节点 -> 截面环 (rings): 每个骨架节点生成一圈顶点, 半径 = 骨架半径 × 截面调制
 *   2) 骨架边   -> 扫掠蒙皮: 相邻两圈环之间铺三角带
 *   3) 分叉节点 -> 显式环桥接: 在父分支的环带上**真的切一个窗口**(删掉那几格),
 *      再把窗口边缘的环和子分支根部的环用 zipper 缝合 (不是两根管子互相穿过)
 *   4) 根部/枝梢 -> 端盖: 树干基部一圈三角扇; 每条分支/树根的末梢一圈三角扇
 *
 * 因此:
 *   - 不会丢弃任何骨架分支 (每条分支都生成自己的环与三角面)
 *   - 不做最大连通过滤 (连通性是构造保证的)
 *   - 不用 SDF / 隐式场
 *   - 不做"每根树枝单独建管再合并/布尔并集"
 *
 * 与其他模块的关系:
 *   treeBuilder 生长骨架 -> barkSkeleton.finalizeBarkSkeleton / enforceChildBranchRadii
 *   -> 本文件 buildBarkSkin -> meshTopology.validateSkin 自检 -> treeBuilder 合并累加器
 *   -> sceneManager 注入材质/风场着色器, 导出走 exporter。
 *
 * 关键概念 / 约定 (读代码前先记住这五个词):
 *   - 环 (ring): 一个骨架节点对应的一圈顶点; 每圈存 M+1 个顶点, 第 M 个是 UV 接缝复制顶点
 *     (位置/法线同第 0 列, 只有 uv.x 不同), 见 ③ 节与 seamPairs。
 *   - 环带 (band): 第 i 条环带 = ring[i] 与 ring[i+1] 之间那圈三角带; 分叉窗口切在某条环带上。
 *   - 窗口 (window): 父枝环带上被删掉的 K 格三角面, 它留下的洞就是子枝的出口。
 *   - rim: 父枝被切出窗口后, 洞口剩余网格的边界环 (按剩余三角面的实际棱方向排序)。
 *   - 环坐标系 (side/up): 平行移动推进的正交基, 见 buildRingBases。
 *
 * 分叉窗口的几何意图 (为什么不能简单布尔并集):
 *   布尔并集的结果是隐式三角化 —— 拿不到可复用的环顶点, 也就无法把"这条三角面属于哪个骨架
 *   分支"写进 aNodeId, 节点树选中/隔离/拆分导出会直接失效; 而且在分叉薄壁处布尔运算容易
 *   产生非流形边、重合面与隐藏空腔。显式桥接则把分叉拆成三步可控的几何操作:
 *   在父枝精确位置加密环带 (窗口高度 ≈ 子枝直径) -> 切掉 K 格 -> 用两段 zipper 缝合,
 *   于是"骨架里每条分支都有面 + 整张网格单连通"是构造保证的, 不是事后修补的。
 *
 * 注意 (红线):
 *   - 本文件是"构造即证明": 拓扑合法性来自构造顺序, 改动顺序会直接破坏 2-manifold 性质,
 *     所以任何改动都必须跑 meshTopology 自检 (opts.validate 默认开启)。
 *   - 单位: 米 (位置/半径), 内部角度一律弧度, 坐标是世界坐标 (生成阶段没有局部变换)。
 */
import * as THREE from 'three'
import { GeoAcc, anyPerp, clamp01 } from './mathUtils.js'
import { validateSkin } from './meshTopology.js'

const TAU = Math.PI * 2

/**
 * 平滑阶跃 3u²-2u³: 0→1 且两端导数为 0。
 * 截面的形状过渡 (基部 flare / 末梢收尖) 用它而不是线性插值, 否则过渡区两端
 * 会留下肉眼可见的折线棱。
 * @param {number} u 输入, 会 clamp 到 0..1
 * @returns {number} 0..1
 */
function smoothstep01(u) {
  u = clamp01(u)
  return u * u * (3 - 2 * u)
}

/**
 * 归一化颜色输入: 支持 THREE.Color 与任何带 r/g/b 字段的对象; 缺失时返回白色。
 * @param {THREE.Color|{r:number,g:number,b:number}|null|undefined} c
 * @returns {{r:number,g:number,b:number}} 线性 0..1
 */
function rgb(c) {
  if (!c) return { r: 1, g: 1, b: 1 }
  if (c.isColor || (c.r !== undefined && c.g !== undefined && c.b !== undefined)) return { r: c.r, g: c.g, b: c.b }
  return { r: 1, g: 1, b: 1 }
}

/**
 * 归一化向量输入: 支持 THREE.Vector3 与 {x,y,z} 普通对象, 缺失时用 fallback。
 * @param {THREE.Vector3|{x:number,y:number,z:number}|null|undefined} v
 * @param {THREE.Vector3} [fallback] 缺省值 (不给则为原点)
 * @returns {THREE.Vector3}
 */
function vec3(v, fallback) {
  if (!v) return fallback || new THREE.Vector3()
  if (v.isVector3) return v
  return new THREE.Vector3(v.x || 0, v.y || 0, v.z || 0)
}

/**
 * 用户周向分段 × barkDetail (自适应时会在此基础上增加, 但不会低于它)
 *
 * 含义是"用户参数构成的下限"而非最终值: 分叉窗口规划可能为了塞下窗口而抬高分段数
 * (见 planBranchWindows), 但绝不会低于用户设定。于是 UI 上调大 radialSegments 一定
 * 让几何更细, 参数审计能看到"改了真的变"。
 *
 * @param {object} branch 骨架分支 (读 branch.render.radialSegments, 缺省 8)
 * @param {number} barkDetail LOD 倍率
 * @returns {number} clamp 到 [3,48] 的周向面数
 */
function baseRadialSegments(branch, barkDetail) {
  const user = Math.round((branch.render.radialSegments === undefined ? 8 : branch.render.radialSegments) * barkDetail)
  return Math.max(3, Math.min(48, user))
}

/**
 * 单个环顶点处的半径调制 (截面形状 / 半径回调 / 基部领口 / 末梢收尖)。
 * 不含顶点噪声 (噪声只影响外观, 窗口尺寸估算用不到)。
 *
 * 这是"半径倍率"而不是"最终半径": 调用方拿 f.radius * mod 才是顶点到骨架中心的距离。
 *
 * 魔法数来历:
 *   - square 的 1/max(|cos|,|sin|) 在 45° 处等于 √2 ≈ 1.414; 不加下限时方形截面的
 *     四个角会尖到 1.414 倍半径, 看起来像四角星。截到 0.62 后角部最多比边短 38%,
 *     是一个"圆角方管"的比例。
 *   - star 的 (0.5 + 0.5·cos(angle·points)) 在 [0,1] 起伏: 峰值处倍率为 1 (凸起不变),
 *     谷值处被 starDepth 压下去, 所以星形不会整体缩小截面。
 *   - baseFlareLen 默认 0.14: 树干基部外扩段的归一化长度, 到 14% 枝高才完全消失。
 *   - tipRound 的 sqrt(1-u²): 圆弧剖面, 末梢收成半球而不是锥尖。
 *
 * @param {object} branch 骨架分支 (用到 render 与 frames)
 * @param {number} ringIndex 环序号 (= 骨架帧下标, 0 = 基部)
 * @param {number} angle 环上角度 (弧度, 0..2π)
 * @returns {number} 半径倍率 (1 = 不调制)
 */
function ringModifier(branch, ringIndex, angle) {
  const f = branch.frames[ringIndex]
  const r = branch.render
  let mod = 1
  const cs = r.crossSection || 'round'
  if (cs === 'star') {
    const depth = r.starDepth || 0
    const points = r.starPoints || 6
    mod *= 1 - depth * (0.5 + 0.5 * Math.cos(angle * points))
  } else if (cs === 'square') {
    mod *= 1 / Math.max(0.62, Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))))
  }
  if (r.radiusModifier) mod *= r.radiusModifier(f.t, angle, f.radius)
  const bf = r.baseFlare || 0
  if (bf > 0) {
    const u = Math.min(1, Math.max(0, f.t / Math.max(1e-4, r.baseFlareLen === undefined ? 0.14 : r.baseFlareLen)))
    mod *= 1 + bf * (1 - smoothstep01(u))
  }
  const tr = r.tipRound || 0
  if (tr > 0) {
    const u = Math.min(1, Math.max(0, (f.t - (1 - tr)) / Math.max(1e-4, tr)))
    if (u > 0) mod *= Math.sqrt(Math.max(1e-4, 1 - u * u))
  }
  return mod
}

/**
 * 环的平均有效半径 (估算窗口宽度用)。
 *
 * 沿环均匀取 8 个角度平均 ringModifier, 得到"这个环平均有多粗"。
 * 用平均而不是 f.radius 原值: 星形/方形截面的实际外廓可能比骨架半径大也可能小,
 * 窗口角宽必须按**真实外廓**换算, 否则截面一变窗口就小了。
 * 8 个采样点是不可导截面的折中 (再多对结果影响 <1%, 但每环都要算)。
 *
 * @param {object} branch 骨架分支
 * @param {number} ringIndex 环序号
 * @returns {number} 平均有效半径 (米), 下限 1e-5 防除零
 */
function averageRingRadius(branch, ringIndex) {
  const f = branch.frames[ringIndex]
  let sum = 0
  const n = 8
  for (let k = 0; k < n; k++) sum += ringModifier(branch, ringIndex, (k / n) * TAU)
  return Math.max(1e-5, f.radius * (sum / n))
}

/**
 * 子分支根部环的有效半径 (含基部领口)。
 *
 * 注意用的是 ringModifier(child, 0, ...) 的结果而不是 child.frames[0].radius:
 * 子枝基部通常带 baseFlare (领口外扩), 窗口必须按"实际最粗处"来开, 否则桥接面
 * 会从领口里穿出来。窗口角宽 ratio = childRadius / 父枝环平均半径 就取自这里。
 *
 * @param {object} child 子分支骨架
 * @returns {number} 子枝根部的平均有效半径 (米), 下限 1e-5
 */
function childBaseRadius(child) {
  const f = child.frames[0]
  let sum = 0
  const n = 8
  for (let k = 0; k < n; k++) sum += ringModifier(child, 0, (k / n) * TAU)
  return Math.max(1e-5, f.radius * (sum / n))
}

/**
 * 与 buildTube 一致的平行移动坐标系 (只依赖骨架帧, 与周向分段数无关)。
 *
 * 为什么必须"平行移动"而不是每帧重新叉乘某个固定参考轴: 当枝条方向接近参考轴 (例如
 * 笔直向上的树干接近 UP) 时, 叉乘结果趋近 0, 归一化后方向发生 180° 跳变, 表现为
 * 截面的 0 列突然翻到对面 —— 贴图上就是沿枝条出现一条扭麻花。平行移动每次只把
 * 上一帧的 side 投影到新切平面, 旋转量最小, 因此沿枝条连续、无跳变。
 *
 * 这一步与周向分段数 M 无关, 所以"窗口规划 (只关心角度)"和"真正生成顶点 (关心 M)"
 * 可以共用同一套基 —— 两处算出的方位角一致, 窗口才对得齐子枝根部的顶点。
 *
 * @param {Array<{dir: THREE.Vector3, roll?: number}>} frames 骨架帧 (dir 已归一化)
 * @returns {Array<{side: THREE.Vector3, up: THREE.Vector3}>} 每帧正交基 (up = dir × side)
 */
function buildRingBases(frames) {
  const bases = []
  const side = anyPerp(frames[0].dir.clone()).normalize()
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (i > 0) {
      side.addScaledVector(f.dir, -side.dot(f.dir))
      if (side.lengthSq() < 1e-10) anyPerp(f.dir, side)
      side.normalize()
      const rollDelta = (f.roll || 0) - (frames[i - 1].roll || 0)
      if (rollDelta) side.applyAxisAngle(f.dir, rollDelta)
      side.addScaledVector(f.dir, -side.dot(f.dir))
      if (side.lengthSq() < 1e-10) anyPerp(f.dir, side)
      side.normalize()
    } else if (f.roll) {
      side.applyAxisAngle(f.dir, f.roll)
      side.addScaledVector(f.dir, -side.dot(f.dir)).normalize()
    }
    const up = new THREE.Vector3().crossVectors(f.dir, side).normalize()
    bases.push({ side: side.clone(), up })
  }
  return bases
}

/**
 * 计算某条分支的周向分段数 + 每个子分支的切孔窗口。
 * 自适应: 同一根父枝上同一环带里挂的子枝越多 / 越粗, 父枝的周向分段就越大,
 * 保证每个窗口之间有至少一格"桥墩", 不会互相吞掉。
 *
 * 这三个量要一起解 (单独看谁都解不出来):
 *   M       周向面数 —— 既要让用户的 radialSegments 真的生效, 又要足够容纳所有窗口 + 间隔;
 *   K       窗口宽度 (格数) —— 由"子枝粗细折算的角宽"决定, 拥挤时按角宽比例缩小;
 *   start   窗口起始列 —— 从子枝期望方位最近的列向两侧探, 找第一个放得下的位置。
 * 另外还有 band (窗口所在环带): 默认取子枝贴合高度所在的那条, 只有实在放不下才允许挪。
 *
 * 求解顺序 (失败时按"代价从小到大"降级, 这条优先级是本函数最重要的设计):
 *   ① 收窄窗口 K (仍在正确的贴合环带上, 只是洞口比子枝略窄 —— 桥接会自然收口);
 *   ② 抬高周向分辨率 M (更多列 = 更多空位, 代价是面数);
 *   ③ 只有 K 已经缩到 1 还放不下, 才把子枝挪到相邻环带。
 * 绝不为"放下窗口"把分叉挪到离贴合高度很远的环带: 那会让桥接面从子枝基部斜着拉出去,
 * 视觉上是"树枝被拉偏/长出一片斜鳍", 比洞口窄一点难看得多。
 *
 * 兜底与预算: 最多 maxAttempts 轮 / 500ms (极端参数不允许把交互卡住)。仍然失败时
 * 依次退到"窗口相邻无间隔"(只保证列不重叠) 和"返回已放下的窗口 + failed 标记",
 * 绝不假装成功 —— failed 会一路传到 stats.failedWindows 并由 validation.ok 置 false。
 *
 * @param {object} branch 父分支 (frames 是**蒙皮帧**, 已含分叉处加密环, 见 buildSkinFrames)
 * @param {Array<number>} children 挂在它上面的子分支 index 列表
 * @param {Map<number, {parentBranch:number, band:number, tGlobal:number,
 *        azimuth:number, surfaceNormal:THREE.Vector3, childRadius:number}>} attachOf
 *        子分支 -> 贴合信息 (band/azimuth/childRadius 是这里要用的)
 * @param {number} barkDetail LOD 倍率
 * @returns {{M:number, windows:Array<{child:number, band:number, start:number,
 *            K:number, parentBranch:number}>, K:Map<number, number>, failed?:boolean}}
 *          M = 该父枝的周向面数; windows 里每项 = 一个子枝的洞口; K 回传每个子枝的窗口宽度。
 */
function planBranchWindows(branch, children, attachOf, barkDetail) {
  const nBands = branch.frames.length - 1
  // 有子枝的分支至少 8 列: 窗口按列量化, 列数太少时(例如 4 列)一个列的偏移就是 90°,
  // 洞口会落到与生长方位差很远的侧面。树干保留用户设置 (参数有效性审计要求它真的生效)。
  const isTrunkBranch = branch.parent === null || branch.parent === undefined
  const userM = Math.max(baseRadialSegments(branch, barkDetail), (!isTrunkBranch && children.length > 0) ? 8 : 3)
  // 用户周向分段即使低于"窗口容量需求"也应该影响几何 (参数审计要求改了就变):
  // 在自适应分辨率之上再加一个与 userM 成比例的余量, 而不是被 requiredM 完全吃掉。
  const userBoost = Math.max(0, Math.round(userM / 3))
  const info = new Map()
  for (const idx of children) {
    const child = attachOf.get(idx)
    if (!child) continue
    let band = Math.max(0, Math.min(nBands - 1, child.band))
    // 父分支自己的基部是桥接出来的(不是端盖): 环 0 的边被基部桥接占用,
    // 再在环 0 上切窗口会让同一圈棱出现 3 个面, 所以避开 band 0。
    if (branch.parent !== null && branch.parent !== undefined && band === 0 && nBands >= 3) band = 1
    info.set(idx, { ...child, band })
  }
  if (!info.size) return { M: userM, windows: [], K: new Map() }

  // 周向分段上限随"父枝上挂多少子枝"放大: UI 内是 64 列, 但脚本/JSON 导入可能给出
  // 远超 UI 范围的 roots.count / 每枝子枝数。给到 4096 列 (可容纳单环带 ~2000 根子枝),
  // 保证每根子枝都能切到窗口; 超过这个极端输入会走 no-gap 兜底, 仍失败时 validation 如实报告。
  const radialCap = Math.max(64, Math.min(4096, 2 * info.size + 4))

  // 角宽比例: 子枝根部直径 / 父枝该环带周长
  for (const [, it] of info) {
    // 父枝"在那个高度"的平均外廓半径: 取环带上下两圈的平均值 (窗口跨两圈)。
    const rParent = 0.5 * (averageRingRadius(branch, it.band) + averageRingRadius(branch, it.band + 1))
    // ratio 是"子枝半径 / 父枝半径"。0.06 下限保证窗口至少有可见宽度;
    // 0.92 上限是因为 asin 在自变量趋 1 时导数爆炸 (角度趋 π), 再大就没有桥接意义了。
    const ratio = Math.max(0.06, Math.min(0.92, it.childRadius / Math.max(1e-6, rParent)))
    // 弦对角: 圆管贴在圆柱面上, 开口所张的圆心角 ≈ 2·asin(r_child / r_parent)。
    // 小比值时 ≈ 2·ratio (线性), 大比值时比线性更快外扩 —— 这正是需要的: 粗子枝要占更大的洞。
    it.angle = 2 * Math.asin(ratio)
    // frac = 洞口占整圈的比例, 后面用它把角度换算成"需要多少列"。
    it.frac = it.angle / TAU
  }

  // 按环带分组: 同一环带上的窗口共享同一对环棱, 必须一起排 (互相避让);
  // 组内按方位角排序, 使"相邻窗口在环上也是相邻的", 首次放置就大概率成功。
  const groupOf = new Map()
  for (const [idx] of info) groupOf.set(idx, info.get(idx).band)
  const groupKey = (band) => String(band)
  const buildGroups = () => {
    const g = new Map()
    for (const [idx] of info) {
      const b = groupOf.get(idx)
      const k = groupKey(b)
      if (!g.has(k)) g.set(k, { band: b, children: [] })
      g.get(k).children.push(idx)
    }
    for (const grp of g.values()) grp.children.sort((a, b) => info.get(a).azimuth - info.get(b).azimuth)
    return [...g.values()].sort((a, b) => a.band - b.band)
  }
  const requiredM = (groups) => {
    // 迭代抬高: 假设当前 M 不变, 数一遍"所有窗口 (各 k 列) + 两侧各 1 列间隔"需要多少列;
    // 不够就把 M 抬到 total 再重算。每轮 M 单调增长, 10 轮足够收敛或触顶 radialCap。
    let need = userM
    for (const grp of groups) {
      let m = need
      for (let iter = 0; iter < 10; iter++) {
        let total = 0
        for (const idx of grp.children) {
          const it = info.get(idx)
          const k = Math.max(1, Math.ceil(m * it.frac - 1e-9))
          total += k + 2 // 窗口 + 两侧各一格间隔 (rangeFree 会在 s-1..s+k 检查)
        }
        if (total <= m) break
        m = Math.min(radialCap, Math.max(m + 1, total))
      }
      need = Math.max(need, m)
    }
    return Math.min(radialCap, need)
  }

  const maxAttempts = Math.max(48, Math.min(400, info.size * 2))
  const planStart = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
  const planBudget = 500 // ms: 极端输入不允许把交互卡住; 超时后走兜底并如实报告失败
  let mFloor = userM
  /** 子枝窗口宽度上限: 放不下时先收窄窗口, 而不是把分叉窗口挪到别的环带 (会拉出斜鳍) */
  const kCap = new Map()
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const elapsed = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - planStart
    if (elapsed > planBudget) break
    const groups = buildGroups()
    // 本轮采用的 M: 取"容量需求 (requiredM)"与"分辨率地板 (mFloor, 由失败重试抬高)"的较大者,
    // 再加 userBoost —— 后者保证用户调大 radialSegments 时, 即使容量需求更小, 几何也真的更细。
    const M = Math.min(radialCap, Math.max(requiredM(groups), mFloor) + userBoost)
    // 每个窗口的 K
    const K = new Map()
    for (const grp of groups) {
      // 按角宽比例换算每个窗口"理想宽度" (列数), ceil 保证不会比子枝细到看不出洞。
      const raws = grp.children.map((idx) => Math.max(1, Math.ceil(M * info.get(idx).frac - 1e-9)))
      // 一圈 M 列里, 每个窗口至少要占 1 列、窗口之间至少留 1 列桥墩,
      // 所以"窗口总宽"的预算上限是 M - 子枝数; max(子枝数, ...) 保证每根至少 1 列。
      let budget = Math.max(grp.children.length, M - grp.children.length)
      const sum = raws.reduce((a, b) => a + b, 0)
      if (sum <= budget) {
        grp.children.forEach((idx, i) => K.set(idx, raws[i]))
      } else {
        // 子枝太粗 / 太密: 按角宽比例缩窗口, 保证总占用(窗口+间隔)不超一圈
        const fracSum = grp.children.reduce((a, idx) => a + info.get(idx).frac, 0)
        let assigned = 0
        grp.children.forEach((idx, i) => {
          const share = info.get(idx).frac / Math.max(1e-9, fracSum)
          let k = Math.max(1, Math.floor(share * budget + 1e-9))
          if (i === grp.children.length - 1) k = Math.max(1, budget - assigned)
          k = Math.max(1, Math.min(k, budget - assigned - (grp.children.length - 1 - i)))
          assigned += k
          K.set(idx, k)
        })
      }
      for (const idx of grp.children) {
        const cap = kCap.get(idx)
        if (cap !== undefined) K.set(idx, Math.max(1, Math.min(K.get(idx) || 1, cap)))
      }
    }
    const placed = placeWindows(groups, info, K, M)
    if (placed.ok) {
      return { M, windows: placed.windows, K }
    }
    // 放不下时按"代价从小到大"处理:
    //   1) 先收窄这个子枝的窗口 (仍在正确的贴合环带上)
    //   2) 再提高周向分辨率
    //   3) 只有在 K 已经缩到 1 还放不下时, 才把子枝挪到相邻环带
    // 绝不为了放下窗口把分叉挪到离贴合高度很远的地方 (那会拉出大片斜鳍/看起来像树枝被拉偏)。
    const failed = placed.fail
    const capNow = kCap.get(failed)
    const curK = K.get(failed) || 1
    if (capNow === undefined && curK > 1) {
      kCap.set(failed, Math.max(1, Math.floor(curK / 2)))
      continue
    }
    if (capNow !== undefined && capNow > 1) {
      kCap.set(failed, Math.max(1, Math.floor(capNow / 2)))
      continue
    }
    if (M < radialCap) {
      mFloor = Math.min(radialCap, Math.max(mFloor, M) + 4)
      continue
    }
    // 环带全扫描: 先近后远, 找一条还有空位的环带 (K 已缩到 1, 尽量只挪 1~2 条)
    const cur = groupOf.get(failed)
    const candidates = []
    for (let b = 0; b < nBands; b++) {
      if (b === cur) continue
      if (branch.parent !== null && branch.parent !== undefined && b === 0) continue
      candidates.push(b)
    }
    candidates.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur))
    let moved = false
    for (const b of candidates) {
      groupOf.set(failed, b)
      kCap.delete(failed)
      moved = true
      break
    }
    if (!moved) break
  }

  // 最终兜底: 先压到 1 格并留间隔; 再不行就允许窗口相邻 (只保证列不重叠)。
  // 无论如何每个子分支都会得到桥接, 绝不出现"骨架有分支、蒙皮没接上"的开口。
  const groups = buildGroups()
  let M = Math.max(userM, mFloor) + userBoost
  for (const grp of groups) M = Math.max(M, grp.children.length * 2)
  M = Math.min(radialCap, M)
  const K = new Map()
  for (const grp of groups) for (const idx of grp.children) K.set(idx, 1)
  let placed = placeWindows(groups, info, K, M, true)
  if (placed.ok) return { M, windows: placed.windows, K }
  const noGapM = Math.min(radialCap, Math.max(M, groups.reduce((s, g) => s + g.children.length, 0) + 1))
  placed = placeWindows(groups, info, K, noGapM, false)
  if (placed.ok) return { M: noGapM, windows: placed.windows, K }
  // 理论上只有"单环带子枝数 > 1024"这种极端输入才会到这里:
  // 仍然返回已放下的窗口, 但把失败暴露给 stats.validation (不会假装全部桥接成功)
  return { M: noGapM, windows: placed.windows, K, failed: true }
}

/**
 * 在环带上给窗口找互不重叠的列。
 * - requireGap=true : 窗口之间至少留 1 格"桥墩"; 相邻环带的窗口列也必须错开
 *                     (共享同一圈环棱时, 同列窗口会让棱出现第 3 个面)
 * - requireGap=false: 兜底模式, 只保证窗口列本身不重叠
 *
 * 相邻环带为何必须错列 (更具体的后果): 上下两个窗口若列重叠, 它们会在中间那圈环上
 * 连成一个"8 字形"洞口 —— 中间共用的顶点 link 变成两个环 (非流形点), 两个子枝的桥接
 * 面还会在同一处交叉。错开至少 1 列就保证两个洞口之间仍有实体相连。
 *
 * 放置策略: 从"离子枝期望方位最近的那一列"开始向两侧交替探测 (0, +1, -1, +2, -2 ...),
 * 取第一个满足条件的列。正常情况下第一个候选就可用 (O(1)); 只有一圈上挤了很多子枝时
 * 才多探几步, 从而避免 M 很大时退化成 O(M × 子枝数)。
 *
 * @param {Array<{band:number, children:Array<number>}>} groups 按环带分组、组内按方位角排序
 * @param {Map} info 子枝 -> {azimuth, frac, ...} 贴合信息
 * @param {Map<number, number>} K 子枝 -> 窗口宽度 (列数)
 * @param {number} M 周向面数
 * @param {boolean} [requireGap=true] 是否要求窗口之间留桥墩 + 相邻环带错列
 * @returns {{ok:boolean, fail?:number, windows:Array}} ok=false 时 fail 是放不下的那个子枝 index
 */
function placeWindows(groups, info, K, M, requireGap = true) {
  const occByBand = new Map() // band -> Uint8Array(M), 只标记窗口列
  const windows = []
  // 每个环带一张 M 位的占用表 (Uint8Array: 一圈最多 4096 列, 按位组省内存也省 GC)。
  const getOcc = (band) => {
    if (!occByBand.has(band)) occByBand.set(band, new Uint8Array(M))
    return occByBand.get(band)
  }
  // 取模再取模是为了处理负数列号 (探测时会往左越过 0)。
  const colFree = (band, c) => {
    const arr = getOcc(band)
    return arr[((c % M) + M) % M] === 0
  }
  const mark = (band, s, k) => {
    const arr = getOcc(band)
    for (let c = s; c < s + k; c++) arr[((c % M) + M) % M] = 1
  }
  const rangeFree = (band, s, k) => {
    // 接缝两侧各留 1 列: 窗口只切 1..M-2 的格子, 不碰 UV 缝所在的两条棱
    if (s < 1 || s + k > M - 1) return false
    const from = requireGap ? s - 1 : s
    const to = requireGap ? s + k : s + k - 1
    for (let c = from; c <= to; c++) if (!colFree(band, c)) return false
    return true
  }
  for (const grp of groups) {
    const band = grp.band
    for (const idx of grp.children) {
      const it = info.get(idx)
      const k = K.get(idx) || 1
      // 期望方位对应的浮点列号 (0..M)。
      const desired = (it.azimuth / TAU) * M
      // 从"离目标方位最近的列"开始向两侧探测: 正常情况下第一个候选就可用 (O(1)),
      // 只有大量子枝挤在一圈时才会多探几步 —— 避免 M 很大时退化成 O(M × 子枝数)。
      // s0 让窗口以期望方位为中心: 起始列 = 中心列 - (k-1)/2。
      const s0 = Math.round(desired - (k - 1) / 2)
      // 窗口不能贴到 0 列 / M 列 (UV 缝所在的两条棱), 两侧各留 1 列缓冲。
      const lo = 1
      const hi = M - k - 1
      if (hi < lo) return { ok: false, fail: idx, windows }
      let bestS = -1
      for (let d = 0; d <= M; d++) {
        // d 展开成 0, +1, -1, +2, -2, ... 的探测序列 (step 取半、符号交替)。
        const step = Math.ceil(d / 2)
        const sign = d % 2 === 0 ? 1 : -1
        const s = s0 + sign * step
        if (s < lo || s > hi) continue
        if (!rangeFree(band, s, k)) continue
        let okAdj = true
        for (const nb of [band - 1, band + 1]) {
          if (nb < 0 || !occByBand.has(nb)) continue
          const from = requireGap ? s - 1 : s
          const to = requireGap ? s + k : s + k - 1
          for (let c = from; c <= to; c++) {
            if (!colFree(nb, c)) { okAdj = false; break }
          }
          if (!okAdj) break
        }
        if (!okAdj) continue
        bestS = s
        break
      }
      if (bestS < 0) return { ok: false, fail: idx, windows }
      mark(band, bestS, k)
      windows.push({ child: idx, band, start: bestS, K: k, parentBranch: it.parentBranch })
    }
  }
  return { ok: true, windows }
}

/** 按归一化弧长采样一个闭合环上的点 (返回插值后的属性, 不新建顶点)
 *
 * 用途: 在 rim 与子枝 ring0 之间生成中间领口环时, 需要"按同一条弧长进度"在两个环上
 * 各取一个对应点, 才能把它们配成一对 (否则两环顶点数不同, 直接按下标配对会拧成麻花)。
 *
 * @param {GeoAcc} acc 顶点累加器 (只读)
 * @param {Array<number>} loop 环的顶点下标数组 (闭合, 首尾不重复)
 * @param {number} u 归一化弧长位置 (0..1, 内部会取模到 [0,1))
 * @returns {object|null} 插值后的顶点属性; loop 为空时返回 null
 */
function sampleLoopVertex(acc, loop, u) {
  const n = loop.length
  if (!n) return null
  if (n === 1) return readVertex(acc, loop[0])
  const params = closedParams(loop, (a, b) => distanceBetween(acc, a, b))
  u = ((u % 1) + 1) % 1
  let k = 0
  while (k < n - 1 && params[k + 1] < u) k++
  const span = params[k + 1] - params[k]
  const f = span < 1e-9 ? 0 : (u - params[k]) / span
  return mixVertex(readVertex(acc, loop[k]), readVertex(acc, loop[(k + 1) % n]), f)
}

/**
 * 从顶点累加器里"读回"一个顶点的全部属性 (position/normal/uv/color/风场/aNodeId)。
 *
 * 为什么要读回: 桥接/领口需要在已有顶点**之间**插值, 而 GeoAcc 只提供 push 不提供 get;
 * 读回成普通对象后就能交给 mixVertex 做线性混合。
 *
 * @param {GeoAcc} acc 顶点累加器
 * @param {number} i 顶点下标
 * @returns {{pos:Array<number>, normal:Array<number>, uv:Array<number>, color:Array<number>,
 *            wind:number, phase:number, origin:Array<number>, grow:Array<number>, nodeId:number}}
 */
function readVertex(acc, i) {
  const p = acc.position
  const n = acc.normal
  const uv = acc.uv
  const c = acc.color
  return {
    pos: [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]],
    normal: [n[i * 3], n[i * 3 + 1], n[i * 3 + 2]],
    uv: [uv[i * 2], uv[i * 2 + 1]],
    color: [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]],
    wind: acc.aWind[i], phase: acc.aPhase[i],
    origin: [acc.aOrigin[i * 3], acc.aOrigin[i * 3 + 1], acc.aOrigin[i * 3 + 2]],
    grow: [acc.aGrow[i * 2], acc.aGrow[i * 2 + 1]],
    nodeId: acc.aNodeId[i],
  }
}

/**
 * 两个顶点属性按 f 线性混合 (f=0 取 a, f=1 取 b)。
 *
 * 细节:
 *   - 法线插值后重新归一化: 两个单位向量线性插值后长度 <1, 不归一化会让光照变暗。
 *   - uv/color/风场/origin/grow 都直接线性插值, 保证领口环在视觉上与两侧一致。
 *   - nodeId 不能用插值 (会得到非法的浮点 id), 取较近的那一侧 (f<0.5 取 a 的)。
 *
 * @param {object} a readVertex 读出的顶点
 * @param {object} b readVertex 读出的顶点
 * @param {number} f 混合系数 0..1
 * @returns {object} 混合后的顶点 (同 readVertex 结构)
 */
function mixVertex(a, b, f) {
  const mix = (x, y) => x + (y - x) * f
  const nx = mix(a.normal[0], b.normal[0])
  const ny = mix(a.normal[1], b.normal[1])
  const nz = mix(a.normal[2], b.normal[2])
  const nl = Math.hypot(nx, ny, nz) || 1
  return {
    pos: [mix(a.pos[0], b.pos[0]), mix(a.pos[1], b.pos[1]), mix(a.pos[2], b.pos[2])],
    normal: [nx / nl, ny / nl, nz / nl],
    uv: [mix(a.uv[0], b.uv[0]), mix(a.uv[1], b.uv[1])],
    color: [mix(a.color[0], b.color[0]), mix(a.color[1], b.color[1]), mix(a.color[2], b.color[2])],
    wind: mix(a.wind, b.wind), phase: mix(a.phase, b.phase),
    origin: [mix(a.origin[0], b.origin[0]), mix(a.origin[1], b.origin[1]), mix(a.origin[2], b.origin[2])],
    grow: [mix(a.grow[0], b.grow[0]), mix(a.grow[1], b.grow[1])],
    nodeId: f < 0.5 ? a.nodeId : b.nodeId,
  }
}

/**
 * 窗口 rim 与子枝 ring0 之间的中间领口环: 把又长又平的桥接三角面细分成两层
 *
 * 做法: 对每个 u ∈ [0,1), 在 rim 上按弧长取一点、在子枝 ring0 上按同一弧长进度取一点,
 * 两者各取 50% 混合成一个新顶点。于是领口环在几何上"悬"在 rim 与 ring0 中间,
 * 两段 zipper (rim→collar, collar→ring0) 各只需跨越一半距离, 三角形更接近等边。
 *
 * 为什么必须有它: 直接 stitch(rim, childRing0) 时, 洞口跨度大而两侧顶点数不同,
 * zipper 会拉出跨越大半个洞口的狭长三角形 (斜鳍), 光照上是一条条暗棱, 蒙皮形变
 * 时也会明显穿帮。插一层中间环后每段跨度减半, 观感立刻正常。
 *
 * 拓扑安全性: 它只**新增**一圈内部顶点, 不改变洞口边界 (rim 与 ring0 仍是原顶点),
 * 所以无论插几层, 结果仍是 2-manifold (两条边界环 + 中间环, 各自被恰好 2 个面共享)。
 *
 * @param {GeoAcc} acc 顶点累加器 (会写入新顶点)
 * @param {Array<number>} rim 父枝洞口边界环 (顶点下标, 已按边界走向排序)
 * @param {Array<number>} child 子枝根环 (顶点下标, 已按最近接缝旋转对齐)
 * @param {number} count 领口环的顶点数 (取两者中较大者, 至少 24, 让细分足够均匀)
 * @returns {Array<number>} 新写入的领口环顶点下标数组
 */
function buildCollarLoop(acc, rim, child, count) {
  const out = []
  for (let i = 0; i < count; i++) {
    const u = i / count
    const a = sampleLoopVertex(acc, rim, u)
    const b = sampleLoopVertex(acc, child, u)
    const m = mixVertex(a, b, 0.5)
    out.push(acc.vertex(
      m.pos[0], m.pos[1], m.pos[2],
      m.normal[0], m.normal[1], m.normal[2],
      m.uv[0], m.uv[1],
      m.color[0], m.color[1], m.color[2],
      m.wind, m.phase,
      m.origin[0], m.origin[1], m.origin[2],
      m.grow[0], m.grow[1], m.nodeId,
    ))
  }
  return out
}

/**
 * 把两个闭合环缝成一条三角带 (zipper stitching), 返回生成的三角形数。
 *
 * 核心思想: 不按顶点下标配对, 而按**归一化累积弧长**推进。每一步比较两侧"走到下一个
 * 顶点所需的弧长进度", 谁更小就先走谁, 于是两条顶点数不同的环也能均匀缝合,
 * 且长三角形最少 (按距离比按下标缝合能减少约一半的狭长面)。
 *
 * 绕序: A 环正向、B 环反向出现在三角形里 —— 因为洞口边界环 (rim) 是从"被删三角面"
 * 反推出来的走向, 而子环按自身自然顺序, 两者相对方向相反才能让桥接面法线朝外。
 *
 * @param {GeoAcc} acc 顶点累加器
 * @param {Array<number>} A 环 A 的顶点下标 (闭合)
 * @param {Array<number>} B 环 B 的顶点下标 (闭合)
 * @param {(u:number, v:number)=>number} scaleLoop 距离函数 (给两个顶点下标, 返回距离权重;
 *        内部按该函数算弧长比例, 所以传入 distanceBetween 即可按真实空间距离缝合)
 * @returns {number} 三角形数 (A、B 任一少于 2 个顶点时返回 0, 不做缝合)
 */
function stitchLoops(acc, A, B, scaleLoop) {
  const nA = A.length
  const nB = B.length
  if (nA < 2 || nB < 2) return 0
  const tA = closedParams(A, scaleLoop)
  const tB = closedParams(B, scaleLoop)
  let i = 0
  let j = 0
  let tris = 0
  while (i < nA || j < nB) {
    const pa = i < nA ? tA[i + 1] : Infinity
    const pb = j < nB ? tB[j + 1] : Infinity
    if (i < nA && (j >= nB || pa <= pb + 1e-9)) {
      acc.tri(A[i % nA], A[(i + 1) % nA], B[j % nB])
      i++
    } else {
      acc.tri(A[i % nA], B[(j + 1) % nB], B[j % nB])
      j++
    }
    tris++
  }
  return tris
}

/**
 * 计算闭合环的归一化累积弧长参数表 (长度 n+1, out[0]=0, out[n]=1)。
 *
 * 这是 zipper 缝合的"公共进度轴": 两侧环各自把自己的弧长映射到 0..1,
 * 于是"走到 40%"在两边对应同一段相对位置。
 *
 * 退化处理: 若总弧长 < 1e-9 (环退化成一点, 例如子枝半径被 clamp 到极小),
 * 直接退回等分参数 k/n —— 既不除零, 也保证下面的 while 循环能推进完。
 *
 * @param {Array<number>} loop 环的顶点下标数组 (闭合, 首尾不重复)
 * @param {(u:number, v:number)=>number} scaleLoop 距离函数 (可为 null, 那时每段权重取 1)
 * @returns {Array<number>} 归一化累积参数, 长度 n+1
 */
function closedParams(loop, scaleLoop) {
  const n = loop.length
  const out = new Array(n + 1)
  out[0] = 0
  let total = 0
  const dist = (u, v) => (scaleLoop ? scaleLoop(u, v) : 1)
  const cum = [0]
  for (let k = 0; k < n; k++) {
    total += dist(loop[k], loop[(k + 1) % n])
    cum.push(total)
  }
  if (total < 1e-9) {
    for (let k = 0; k <= n; k++) out[k] = k / n
    return out
  }
  for (let k = 0; k <= n; k++) out[k] = cum[k] / total
  return out
}

/**
 * 子分支在父分支骨架上的贴合参数 t (0..1, 按节点序号线性)。
 *
 * 把 finalizeBarkSkeleton 存下的 (段序号 segment + 段内参数 t) 换算成沿整条父枝的
 * 归一化位置: (segment + t) / (节点数 - 1)。注意分母是**骨架帧**的段数而不是蒙皮帧:
 * t 是纯相对量, 蒙皮帧只是在同一段曲线上多插了几个采样点, 相对位置含义不变。
 *
 * @param {object} child 子分支 (读 child.attach)
 * @param {object} parent 父分支 (读 frames.length)
 * @returns {number} 沿父枝的归一化位置 0..1 (无 attach 时回 0)
 */
function childAttachT(child, parent) {
  const a = child.attach
  const n = parent.frames.length
  if (!a || n < 2) return 0
  const seg = Math.max(0, Math.min(n - 2, a.segment))
  return clamp01((seg + clamp01(a.t)) / (n - 1))
}

/**
 * 在骨架帧序列的 t 处插值出一帧 (位置/方向/半径/roll 线性插值)。
 *
 * 只在 buildSkinFrames 往父枝里插"加密环"时被调用: 加密位置几乎不会正好落在原骨架
 * 节点上, 所以必须临时造一个帧。方向先 lerp 再 normalize (线性插值会缩短长度);
 * 位置用 Vector3.lerp; 半径/roll/profileRoll 直接线性插值。返回值是**新对象**,
 * 不与 frames 里的帧共享引用, 调用方可安全修改。
 *
 * @param {Array<object>} frames 骨架帧序列 (至少 1 帧)
 * @param {number} t 归一化位置 0..1
 * @returns {object} 新帧 { pos, dir, radius, t, roll, profileRoll }
 */
function sampleSkinFrame(frames, t) {
  const n = frames.length
  if (n === 1) return { ...frames[0], t }
  const x = clamp01(t) * (n - 1)
  const i = Math.min(n - 2, Math.floor(x))
  const f = x - i
  const a = frames[i]
  const b = frames[i + 1]
  return {
    pos: a.pos.clone().lerp(b.pos, f),
    dir: a.dir.clone().lerp(b.dir, f).normalize(),
    radius: a.radius + (b.radius - a.radius) * f,
    t,
    roll: (a.roll || 0) + ((b.roll || 0) - (a.roll || 0)) * f,
    profileRoll: (a.profileRoll || 0) + ((b.profileRoll || 0) - (a.profileRoll || 0)) * f,
  }
}

/**
 * 找出归一化位置 t 落在哪一条环带 (返回环带序号 i, 满足 t <= frames[i+1].t)。
 *
 * 环带序号同时是"窗口切在哪两圈环之间"的编号, 所以子枝贴合点 -> 环带 -> 窗口是
 * 一条链。t = 1 (贴到最末端) 时没有下一条带, 返回最后一条, 避免越界。
 *
 * @param {Array<{t:number}>} frames 帧序列 (t 递增)
 * @param {number} t 归一化位置 0..1
 * @returns {number} 环带下标 0..frames.length-2
 */
function findBandAt(frames, t) {
  for (let i = 0; i < frames.length - 1; i++) {
    if (t <= frames[i + 1].t + 1e-9) return i
  }
  return Math.max(0, frames.length - 2)
}

/**
 * 蒙皮用骨架帧: 在每条子分支的贴合高度处, 往父分支里插入两圈截面环
 * (t_attach ± 1.15×子枝半径)。这样分叉窗口的高度约等于子枝直径,
 * 桥接环紧贴树枝基部, 不会因为父枝环带过高被拉成大片斜鳍 (视觉上像树枝被拉偏)。
 * 只影响蒙皮取样, 不改骨架图本身。
 *
 * 三个细节决定"分叉看起来正不正常":
 *   ① 加密位置用**弧长**折成 t: epsT = 1.15·r_child / 父枝总弧长。1.15 是半个窗口
 *      (窗口高度 = 2·epsT·总长 ≈ 2.3·子枝半径 ≈ 1.15·子枝直径), 略大于子枝直径,
 *      给领口和肩部留出过渡余量; 用弧长而不是节点序号, 保证粗细不同的父枝上窗口
 *      物理高度一致。
 *   ② 带内的原骨架帧必须删掉: 否则 attach 的 t 可能落在加密带的一侧, 窗口整体偏向
 *      树枝根部的上方/下方, 桥接就会被拉出一大片斜三角。
 *   ③ 加密带太薄 (hi-lo < 0.0015) 时强行撑到 0.0015: 否则可能落在两条环之间连
 *      一条环带都没有, 窗口无处可切。
 *
 * 返回的帧序列只用于蒙皮 (bases/rings/窗口规划都基于它), 骨架图与 stats 里的节点数
 * 仍按原始 frames 统计, 所以"蒙皮帧数 > 骨架节点数"是正常的。
 *
 * @param {object} branch 骨架分支 (读 frames / children / parent)
 * @param {Array<object>} branchList 全部分支 (用 childAttachT/childBaseRadius 查子枝)
 * @returns {Array<object>} 加密后的帧序列 (按 t 升序; 未涉及分叉的分支原样返回)
 */
function buildSkinFrames(branch, branchList) {
  const frames = branch.frames
  const n = frames.length
  if (!branch.children || !branch.children.length || n < 2) return frames
  let total = 0
  for (let i = 1; i < n; i++) total += frames[i].pos.distanceTo(frames[i - 1].pos)
  if (total < 1e-6) return frames
  const isChildOfSomething = branch.parent !== null && branch.parent !== undefined
  const cuts = []
  for (const childIdx of branch.children) {
    const child = branchList[childIdx]
    if (!child) continue
    const t = childAttachT(child, branch)
    const r = childBaseRadius(child)
    // 把"1.15 倍子枝半径"的物理距离折成 t 方向的长度; 0.0015 是 t 上的最小可分辨量,
    // 防止总弧长很大时 epsT 小到浮点无法与相邻帧区分。
    const epsT = Math.max(0.0015, (r * 1.15) / total)
    // 有父枝的分支, 基部 t=0 附近已经被"基部桥接"占用, 加密带整体向内让一点 (0.002),
    // 避免与父枝给它开的窗口抢同一圈环。
    let lo = Math.max(isChildOfSomething ? 0.002 : 0, t - epsT)
    let hi = Math.min(0.998, t + epsT)
    if (hi - lo < 0.0015) hi = Math.min(0.998, lo + 0.0015)
    cuts.push(lo, hi)
  }
  if (!cuts.length) return frames
  const ts = []
  for (let i = 0; i < n; i++) {
    const t = frames[i].t
    // 分叉局部加密带内不要再被原有骨架帧切断: 否则 attach t 会落在带的一侧,
    // 窗口整体偏向树枝根部的上方/下方, 桥接就会拉出一大片斜三角。
    let insideCut = false
    for (let c = 0; c < cuts.length; c += 2) {
      if (t > cuts[c] + 1e-5 && t < cuts[c + 1] - 1e-5) { insideCut = true; break }
    }
    if (!insideCut) ts.push(t)
  }
  for (const t of cuts) {
    // 端点附近不插环: t≈0 或 t≈1 处只有一圈环, 围不出"上下两圈"的窗口带。
    if (t <= 1e-5 || t >= 1 - 1e-5) continue
    // 与已有帧重合的也不插 (1e-4 容差): 两条几乎重合的环会形成零宽度环带,
    // 窗口在那儿算出的 K 会变成 0, 后续除零/空三角。
    let dup = false
    for (const e of ts) {
      if (Math.abs(e - t) < 1e-4) { dup = true; break }
    }
    if (!dup) ts.push(t)
  }
  ts.sort((a, b) => a - b)
  const out = []
  for (const t of ts) {
    // t 与某个原始骨架帧完全重合 (1e-9) 时直接复用原帧对象: 省一次插值,
    // 也保证该处的位置/方向与骨架严格一致 (不然插值会引入极小抖动)。
    let exact = null
    for (let i = 0; i < n; i++) {
      if (Math.abs(frames[i].t - t) < 1e-9) { exact = frames[i]; break }
    }
    out.push(exact || sampleSkinFrame(frames, t))
  }
  return out
}

/**
 * 生成整张树皮蒙皮。
 *
 * 六个阶段 (与代码里 ①~⑥ 的分节横幅一一对应):
 *   ① 把"子分支贴到父分支哪一段"换算成蒙皮帧上的环带 + 方位角 (attachOf);
 *   ② 为每条分支规划周向分段数 M 与每个子枝的切孔窗口 (planBranchWindows);
 *   ③ 按蒙皮帧生成全部截面环, 每圈 M+1 个顶点 (最后一个为 UV 接缝复制顶点);
 *   ④ 沿环带铺侧壁三角面, 遇到窗口格就跳过 (洞口由 ⑤ 补上);
 *   ⑤ 每个窗口: 取 rim -> 插中间领口环 -> 两段 zipper 接到子枝 ring0;
 *   ⑥ 端盖: 只有"无父枝"的树干/主根封底, 所有分支的末梢封顶。
 *
 * 肩部权重 (shoulder0/shoulder1) 的含义: 子枝前两圈环的截面方向不是直接用自身 dir,
 * 而是在"父枝表面法线"和"子枝自身生长方向"之间插值:
 *   - shoulder0 默认 0.7 → 第 0 圈方向 = 70% 子枝自身方向 + 30% 父枝表面法线。
 *     若 0.7 取到 0 会变成"完全贴父枝表面", 第 0 圈被子枝半径一撑就扁成椭圆,
 *     树枝根部看起来像被压扁; 保留大部分自身方向才保住根部圆度。
 *   - shoulder1 默认 1.0 → 第 1 圈已经完全回到自身方向, 之后照常扫掠。
 *   两圈之间的过渡让分叉"先贴平父枝再抬出", 而不是一圈斜截面直接怼出尖角。
 *
 * @param {object} skeleton finalizeBarkSkeleton 之后的骨架 (含 branches/nodes/edges)
 * @param {{barkDetail?:number, validate?:boolean, shoulder0?:number, shoulder1?:number,
 *          debug?:boolean}} [opts]
 *   barkDetail: 周向分段倍率 (LOD), 最终 M 仍被 clamp 在 [3,48] 或按窗口容量抬高
 *   validate  : 默认 true, 结束时跑 meshTopology.validateSkin (拓扑 + 覆盖 + 体积)
 *   shoulder0 / shoulder1: 第 0/1 圈"自身方向"的权重 (0..1), 见上
 *   debug     : true 时返回 plan/attachOf/skinFrames 供调试面板查看
 * @returns {{geometry: THREE.BufferGeometry, stats: object, validation: object|null,
 *            rings: Array<Array<number>>, ringM: Array<number>, debug: object|null}}
 *   rings[branchIndex] = 该分支每圈第一个顶点的全局下标; ringM[branchIndex] = 周向面数。
 */
export function buildBarkSkin(skeleton, opts = {}) {
  const barkDetail = opts.barkDetail === undefined ? 1 : opts.barkDetail
  // 肩部权重: 0 = 完全贴父枝表面法线, 1 = 完全回到子枝自身方向。
  // 第 0 圈太大时树枝根部会被压扁, 所以默认保留一部分"自身方向"。
  const shoulder0 = opts.shoulder0 === undefined ? 0.7 : clamp01(opts.shoulder0)
  const shoulder1 = opts.shoulder1 === undefined ? 1.0 : clamp01(opts.shoulder1)
  const branchList = skeleton.branches
  // 蒙皮帧 = 骨架帧 + 子分支贴合处的局部加密环 (让分叉切口高度≈子枝直径)
  const skinFrames = branchList.map((b) => buildSkinFrames(b, branchList))
  const bases = skinFrames.map((frames) => buildRingBases(frames))

  /* ---------- 1. 骨架子分支 -> 父骨架边的贴合信息 (段 / 方位角) ---------- */
  // 这里产出的 attachOf 是后面两件事的唯一依据:
  //   窗口开在父枝的哪条环带 (band)、第几列 (azimuth 换算成列号)、开多大 (childRadius)。
  // 注意所有计算都在**蒙皮帧** (skinFrames) 上做, 因为窗口切的是蒙皮环, 不是骨架帧。
  const attachOf = new Map()
  for (const branch of branchList) {
    if (branch.parent === null || branch.parent === undefined) continue
    const parent = branchList[branch.parent]
    const parentFrames = skinFrames[parent.index]
    const tGlobal = childAttachT(branch, parent)
    const band = findBandAt(parentFrames, tGlobal)
    const frame = parentFrames[band]
    const basis = bases[parent.index][band]
    // 方位角: 树枝用"生长方向的径向分量"(细枝更稳); 树根用起点位置
    // (根基是按世界水平方向放在 flare 表面上的, 与倾斜主干的径向分量可能不一致)。
    const dir0 = branch.frames[0].dir
    const vDir = dir0.clone().addScaledVector(frame.dir, -dir0.dot(frame.dir))
    let az = 0
    if (branch.type !== 'root' && vDir.lengthSq() > 1e-12) {
      az = Math.atan2(vDir.dot(basis.up), vDir.dot(basis.side))
    } else {
      const v = branch.frames[0].pos.clone().sub(frame.pos)
      v.addScaledVector(frame.dir, -v.dot(frame.dir))
      az = v.lengthSq() < 1e-12 ? 0 : Math.atan2(v.dot(basis.up), v.dot(basis.side))
    }
    const azNorm = az < 0 ? az + TAU : az
    // atan2(v·up, v·side) 的含义: 把"切平面内的径向方向"换算成相对环坐标系的极角,
    // 0 = 环的第 0 列 (side 方向), 逆时针增大。于是窗口列号 = azNorm/2π · M 可直接算出,
    // 与生成顶点时用的 angle = (j/M)·2π 完全同一套角度基准 —— 两侧必须共用 basis
    // (见 buildRingBases 的说明), 否则窗口会开偏。
    // 父枝在该方位的表面法线: 用于子枝肩部 (第 0 圈贴父枝切平面, 再平滑转回自身方向)
    const surfaceNormal = basis.side.clone().multiplyScalar(Math.cos(az)).addScaledVector(basis.up, Math.sin(az)).normalize()
    attachOf.set(branch.index, {
      parentBranch: parent.index,
      band,
      tGlobal,
      azimuth: azNorm,
      surfaceNormal,
      childRadius: childBaseRadius(branch),
    })
  }

  /* ---------- 2. 规划每个骨架节点的环 (周向分段) + 分叉窗口 ---------- */
  const plan = new Map()
  for (const branch of branchList) {
    // 用一个"frames 已被替换成蒙皮帧"的浅拷贝去规划: planBranchWindows 内部要按帧下标
    // 算平均半径, 必须和 ③ 节真正生成顶点时的帧序列完全一致 (多一环少一环窗口就错位);
    // 浅拷贝保证骨架对象本身不被改动。
    const planBranch = { ...branch, frames: skinFrames[branch.index] }
    plan.set(branch.index, planBranchWindows(planBranch, branch.children, attachOf, barkDetail))
  }
  // 每个子分支都应该切到一个窗口 (树干没有父分支); 统计缺口, 失败时如实报告
  // expectedWindows 的口径 = 所有分支的 children 数之和 = "应开的窗口总数";
  // plannedWindows = 实际规划出来的窗口数; 两者之差就是没接上的分叉数。
  const expectedWindows = branchList.reduce((s, b) => s + b.children.length, 0)
  let plannedWindows = 0
  for (const p of plan.values()) plannedWindows += p.windows.length
  const missingWindows = Math.max(0, expectedWindows - plannedWindows)

  /* ---------- 3. 在骨架节点生成截面环 ---------- */
  // acc 是全树共用的顶点累加器: 所有分支的顶点按生成顺序连续存放, 所以
  // "ringStarts[branch][ring] + 列号" 能唯一定位任意顶点 —— 桥接与封口全靠这个寻址方式。
  const acc = new GeoAcc()
  /** rings[branchIndex] = [ringVertexStart, ...] */
  const rings = branchList.map(() => [])
  const ringM = branchList.map(() => 0)
  // UV 接缝: 每圈多复制 1 个顶点 (位置/法线同第 0 列, uv.x = uMeters),
  // 这样最后一格贴图不会从 0.97 回插到 0 (那会在树干/树枝上留下一条拉伸带)。
  // 渲染上是一条零宽 UV 缝; 拓扑校验按 seamPairs 焊接后仍是封闭 2-manifold。
  const seamPairs = []

  for (const branch of branchList) {
    const r = branch.render
    const M = Math.max(3, plan.get(branch.index).M || baseRadialSegments(branch, barkDetail))
    ringM[branch.index] = M
    const frames = skinFrames[branch.index]
    // 半径调制 (领口/收尖) 按加密后的帧取 t; 其余渲染参数不变
    const skinBranch = frames === branch.frames ? branch : { ...branch, frames }
    // 肩部: 有父枝的分支, 前两圈把截面环法线从"父枝表面法线"平滑转回"自身生长方向",
    // 让分叉处贴平父枝再抬出, 而不是一圈斜截面直接怼出尖角。
    const attach = (branch.parent === null || branch.parent === undefined) ? null : attachOf.get(branch.index)
    const Mf = M
    const color = rgb(r.color)
    const color2 = r.color2 ? rgb(r.color2) : null
    const colorVariance = r.colorVariance || 0
    const rng = r.rng || null
    const wind0 = r.wind0 || 0
    const wind1 = r.wind1 === undefined ? 1 : r.wind1
    const windCurve = r.windCurve || 1.4
    const grow = r.grow || [0, 1]
    const origin = vec3(r.origin, frames[0].pos)
    const phase = r.phase || 0
    const uvScaleV = r.uvScaleV === undefined ? 1 : r.uvScaleV
    const uvScaleU = r.uvScaleU === undefined ? 1 : r.uvScaleU
    const noiseAmp = r.vertexNoise === undefined ? 0.035 : r.vertexNoise
    const noiseSeedA = rng ? rng.range(0, 100) : 0
    const noiseSeedB = rng ? rng.range(0, 100) : 0
    const squashX = r.squashX === undefined ? 1 : r.squashX
    const squashZ = r.squashZ === undefined ? 1 : r.squashZ
    const slot = branch.slot

    let sumR = 0
    for (const f of frames) sumR += f.radius
    const avgR = sumR / frames.length
    // U 方向直接按"周长(米)"展开: 1 个 UV 单位 = 1 米, 由材质 repeat 统一控制每米重复次数。
    // 不能用 round + clamp(≥1): 半径 <16cm 的细枝会被强制包满整张贴图, 纹理横向被压缩
    // 5~10 倍, 树干与细枝的纹理比例对不上 ("细枝上贴图变小、接不上"的根因)。
    const uMeters = TAU * avgR * uvScaleU

    // arc = 从基部累计到当前帧的弧长 (米), 直接作为 v 坐标: U/V 都以米为单位,
    // 贴图在两个方向上密度一致, 不会被斜着拉伸。
    let arc = 0
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      if (i > 0) arc += f.pos.distanceTo(frames[i - 1].pos)
      const basis = bases[branch.index][i]
      let side = basis.side
      let up = basis.up
      if (attach && i <= 1) {
        // 第 0 圈: 在父枝表面法线与子枝方向之间混合 (默认 70% 自身方向 + 30% 表面),
        // 保留根部圆度; 第 1 圈: 继续过渡回自身生长方向。
        const w = i === 0 ? shoulder0 : shoulder1
        // n = lerp(父枝表面法线, 子枝方向, w): w 越大越靠"子枝自身方向"。
        const n = attach.surfaceNormal.clone().lerp(f.dir, w)
        // 若两者接近反向 (夹角 > ~157°), 线性插值结果趋近零向量, 归一化会得到垃圾方向;
        // 0.04 是长度平方阈值 (对应长度 0.2), 此时直接取子枝方向更安全。
        if (n.lengthSq() < 0.04) n.copy(f.dir)
        n.normalize()
        // 把 basis.side 投影到以 n 为法线的切平面上得到该圈的 side, 再叉乘出 up,
        // 保证这一圈的截面仍是正交系 (只是朝向被"掰"向父枝表面)。
        const s = basis.side.clone().addScaledVector(n, -basis.side.dot(n))
        if (s.lengthSq() < 1e-10) anyPerp(n, s)
        s.normalize()
        side = s
        up = new THREE.Vector3().crossVectors(n, s).normalize()
      }
      const baseIndex = acc.vertexCount
      // 记下本圈第一个顶点的全局下标: ⑤ 的桥接正是用 "环起点 + 列号" 定位 A_s / B_s。
      rings[branch.index].push(baseIndex)
      const wind = wind0 + (wind1 - wind0) * Math.pow(clamp01(f.t), windCurve)
      for (let j = 0; j <= Mf; j++) {
        const jm = j % Mf
        const angle = (jm / Mf) * TAU
        const ca = Math.cos(angle)
        const sa = Math.sin(angle)
        let mod = ringModifier(skinBranch, i, angle)
        // 顶点噪声: 两个不同频率的正弦叠加 (周向 3 个波 + 纵向 9π 相位), 幅值默认 0.035。
        // 3.5% 的半径起伏足以打碎"完美圆柱"的塑料感, 又不会破坏树的轮廓;
        // 种子来自 rng 子流 (确定性): 同一个 seed 永远得到同一棵树。
        if (noiseAmp > 0) {
          const w = Math.sin(angle * 3 + noiseSeedA) * 0.5 + Math.sin(f.t * 9 * Math.PI + noiseSeedB) * 0.5
          mod *= 1 + w * noiseAmp
        }
        const rr = Math.max(0.0008, f.radius * mod)
        const nx = side.x * ca * squashX + up.x * sa * squashZ
        const ny = side.y * ca * squashX + up.y * sa * squashZ
        const nz = side.z * ca * squashX + up.z * sa * squashZ
        const nl = Math.hypot(nx, ny, nz) || 1
        const px = f.pos.x + side.x * ca * rr * squashX + up.x * sa * rr * squashZ
        const py = f.pos.y + side.y * ca * rr * squashX + up.y * sa * rr * squashZ
        const pz = f.pos.z + side.z * ca * rr * squashX + up.z * sa * rr * squashZ
        let cr = color.r
        let cg = color.g
        let cb = color.b
        // 沿 t 从基部色过渡到梢部色 (color2 缺省时不渐变, 全部用基色)。
        if (color2) {
          cr = color.r + (color2.r - color.r) * f.t
          cg = color.g + (color2.g - color.g) * f.t
          cb = color.b + (color2.b - color.b) * f.t
        }
        // 颜色扰动: 有 rng 用确定性随机 (rng.signed()), 没有则退回按角度/高度取正弦 ——
        // 两条路都是确定性的, 只是前者更像"随机斑驳"。
        if (colorVariance) {
          const v = 1 + (rng ? rng.signed() * colorVariance : Math.sin(angle * 5 + f.t * 20) * colorVariance)
          cr *= v
          cg *= v
          cb *= v
        }
        acc.vertex(
          px, py, pz,
          nx / nl, ny / nl, nz / nl,
          (j / Mf) * uMeters, arc * uvScaleV,
          clamp01(cr), clamp01(cg), clamp01(cb),
          wind, phase,
          origin.x, origin.y, origin.z,
          grow[0], grow[1],
          slot,
        )
      }
      // 第 Mf 号顶点与第 0 号位置/法线相同, 只有 uv.x = uMeters (而不是 0)。
      // 这一对要登记下来, 拓扑校验时焊回; Mf > 2 是防御性判断 (M 已被 clamp 到 >=3)。
      if (Mf > 2) seamPairs.push([baseIndex + Mf, baseIndex])
    }
  }

  /* ---------- 4. 沿骨架边扫掠蒙皮 (环带), 分叉处跳过窗口 ---------- */
  // 窗口原本是按"子枝"生成的 (每个子枝一个 w), 但扫掠是按"父枝的环带"遍历的,
  // 所以这里先转置成 父分支 -> 环带 -> 该带上的所有窗口, 扫掠时 O(1) 就能查到要跳哪几列。
  const windowAt = new Map() // branchIndex -> Map(band -> [window])
  for (const [branchIndex, p] of plan) {
    for (const w of p.windows) {
      if (!windowAt.has(w.parentBranch)) windowAt.set(w.parentBranch, new Map())
      const m = windowAt.get(w.parentBranch)
      if (!m.has(w.band)) m.set(w.band, [])
      m.get(w.band).push(w)
    }
  }

  for (const branch of branchList) {
    const M = ringM[branch.index]
    const ringStart = rings[branch.index]
    const wins = windowAt.get(branch.index)
    for (let b = 0; b < ringStart.length - 1; b++) {
      const a0 = ringStart[b]
      const b0 = ringStart[b + 1]
      const bandWins = wins ? wins.get(b) : null
      for (let j = 0; j < M; j++) {
        // 一格 = 两个三角形。落在窗口列区间 [start, start+K) 的格整列不铺 ——
        // 这里**只留洞**, 补洞是 ⑤ 的桥接; 若在这里顺手补面, 同一个洞口会被缝两次,
        // 直接产生非流形边。
        if (bandWins) {
          let skipped = false
          for (const w of bandWins) {
            const s = w.start
            if (j >= s && j < s + w.K) { skipped = true; break }
          }
          if (skipped) continue
        }
        // 最后一格用接缝复制顶点 (j2 = M), 不回到 0: 贴图 UV 连续, 不再拉伸
        const j2 = j + 1
        acc.tri(a0 + j, a0 + j2, b0 + j2)
        acc.tri(a0 + j, b0 + j2, b0 + j)
      }
    }
  }

  /* ---------- 5. 分叉节点: 显式环桥接 (窗口边缘环 <-> 子分支根部环) ---------- */
  // 这是整条管线唯一的"缝合"环节: 洞口已在 ④ 留出, 这里把 rim 与子枝 ring0 接上。
  // 每个窗口产生 1 条桥接带 (bridgeStrips) 与两段 zipper 的三角形 (bridgeTriangles);
  // bridgeFailed 收集"环缺失"这种不该发生的不一致, 交给 stats 暴露 —— 不静默吞掉。
  let bridgeStrips = 0
  let bridgeTriangles = 0
  const bridgeFailed = []
  for (const branch of branchList) {
    const p = plan.get(branch.index)
    for (const w of p.windows) {
      const parentBranch = branchList[w.parentBranch]
      const M = ringM[parentBranch.index]
      const childM = ringM[w.child]
      const ringA = rings[parentBranch.index][w.band]
      const ringB = rings[parentBranch.index][w.band + 1]
      const childRing = rings[w.child][0]
      // 环缺失说明"规划认为有这条环带, 但环没生成出来" —— 属于编程错误而非输入问题。
      // 记下来让 stats.failedWindows > 0 -> validation.ok = false, 不要静默跳过 (那会留下一个洞)。
      if (ringA === undefined || ringB === undefined || childRing === undefined) { bridgeFailed.push(w.child); continue }
      const s = w.start
      const K = w.K
      // 删除窗口后, 剩下网格在洞口的边界棱方向 (从被删三角面推出来):
      //   B_s -> A_s -> A_{s+1} -> ... -> A_{s+K} -> B_{s+K} -> B_{s+K-1} -> ... -> B_{s+1}
      // 桥接三角形要沿这些棱同向走, 所以 A 环用这个顺序; 子环按自身自然顺序 (在桥接里反向出现)。
      //
      // 这个顺序是怎么推出来的 (每条边界棱都被"剩下的那个面"和"桥接面"共享, 两者必须反向遍历):
      //   - 底边 A_j-A_{j+1} (下圈): 剩下的面是上一条环带的 T2, 它按 A_{j+1}->A_j 走,
      //     所以桥接要按 A_j->A_{j+1} (递增) 走 —— 对应 rim 里 A 段递增;
      //   - 顶边 B_j-B_{j+1} (上圈): 剩下的面是下一条环带的 T1, 它按 B_j->B_{j+1} 走,
      //     所以桥接要按递减走 —— 对应 rim 里 B 段倒序;
      //   - 两条竖棱 A_s-B_s 与 A_{s+K}-B_{s+K}: 分别由左邻格 T1 / 右邻格 T2 保留,
      //     方向要求桥接走 B_s->A_s 与 A_{s+K}->B_{s+K} —— 即 rim 的首尾两段。
      // 顺序一旦写反, 桥接面绕序与周围曲面相反: 法线朝内、有向体积变负, 表现为黑边/漏光。
      const rim = []
      rim.push(ringB + s)
      for (let k = 0; k <= K; k++) rim.push(ringA + (s + k))
      rim.push(ringB + (s + K))
      for (let k = K - 1; k >= 1; k--) rim.push(ringB + (s + k))
      const B = []
      for (let j = 0; j < childM; j++) B.push(childRing + j)
      // 旋转子环, 让接缝落在最近的位置 (避免桥接面绕一圈)
      const offset = bestRotation(acc, rim, B, childM)
      const B2 = B.slice(offset).concat(B.slice(0, offset))
      // 细化洞口: 在窗口 rim 与子枝 ring0 之间插一圈中间领口环, 再分两段 stitch。
      // 原来直接 stitch 会产生跨越大半个洞口的狭长三角面 (斜鳍), 细分后三角面更均匀,
      // 边界仍是原来的 rim/child 环, 拓扑保持 2-manifold。
      // 领口环的顶点数: 至少 24 (小洞口也要有足够细分, 否则一层里就出现长条面),
      // 且不少于 rim / 子环的顶点数 —— 取较大者让两段 zipper 的单步跨度接近,
      // 不会出现"第一段很粗、第二段很细"的密度跳变。
      const collarCount = Math.max(24, rim.length, B2.length)
      const collar = buildCollarLoop(acc, rim, B2, collarCount)
      bridgeTriangles += stitchLoops(acc, rim, collar, (u, v) => distanceBetween(acc, u, v))
      bridgeTriangles += stitchLoops(acc, collar, B2, (u, v) => distanceBetween(acc, u, v))
      bridgeStrips++
    }
  }

  /* ---------- 6. 端盖: 树干基部 + 所有枝梢/根梢 ---------- */
  // 封口规则只有两条, 但必须严格遵守, 否则会出现"双层面"(非流形)或"洞"(边界边):
  //   - 基部: **只有**没有父枝的分支 (树干/主根) 才封底。其他分支的基部已经被 ⑤ 的
  //     桥接缝合到父枝上, 再封一层就是同一圈棱上有 3 个面 (非流形边);
  //   - 末梢: 所有分支都封顶 (枝条末端本来就没有别的面来接)。
  let caps = 0
  for (const branch of branchList) {
    const M = ringM[branch.index]
    const ringStart = rings[branch.index]
    const r = branch.render
    const frames = skinFrames[branch.index]
    const color = rgb(r.color)
    const color2 = r.color2 ? rgb(r.color2) : null
    const origin = vec3(r.origin, frames[0].pos)
    const phase = r.phase || 0
    const grow = r.grow || [0, 1]
    const slot = branch.slot
    const last = frames.length - 1
    // 基部: 只有整棵树的根(=树干)需要封底; 其他分支基部都桥接到父枝
    if (branch.parent === null || branch.parent === undefined) {
      const f = frames[0]
      // 封底中心点: 法线取 -dir (朝下/朝外), 颜色取基色。
      const ci = acc.vertex(
        f.pos.x, f.pos.y, f.pos.z,
        -f.dir.x, -f.dir.y, -f.dir.z,
        0, 0,
        clamp01(color.r), clamp01(color.g), clamp01(color.b),
        r.wind0 || 0, phase, origin.x, origin.y, origin.z, grow[0], grow[1], slot,
      )
      const a0 = ringStart[0]
      for (let j = 0; j < M; j++) {
        const j2 = (j + 1) % M
        acc.tri(a0 + j2, a0 + j, ci)
      }
      caps++
    }
    // 末梢: 所有分支/树根都以三角扇收口
    {
      const f = frames[last]
      // 梢部颜色取 color2 (若有), 与侧壁沿 t 的渐变终点一致, 封口不会出现色差。
      const cc = color2 || color
      const ci = acc.vertex(
        f.pos.x, f.pos.y, f.pos.z,
        f.dir.x, f.dir.y, f.dir.z,
        0, 0,
        clamp01(cc.r), clamp01(cc.g), clamp01(cc.b),
        r.wind1 === undefined ? 1 : r.wind1, phase, origin.x, origin.y, origin.z, grow[0], grow[1], slot,
      )
      const b0 = ringStart[last]
      for (let j = 0; j < M; j++) {
        const j2 = (j + 1) % M
        acc.tri(b0 + j, b0 + j2, ci)
      }
      caps++
    }
  }

  const geometry = acc.build()
  // 接缝顶点对 (复制顶点 -> 原顶点): 渲染用 UV 缝, 拓扑校验时焊回
  if (seamPairs.length) geometry.userData.seamPairs = seamPairs
  // stats 字段含义 (与 speedtreeBark 同名同义, 便于 UI 用同一套展示):
  //   bridgeStrips/bridgeTriangles  桥接带数与桥接三角形数 (分叉缝合的工作量);
  //   caps                          端盖数 (= 1 个树干底 + 每根分支 1 个梢部封口);
  //   expectedWindows/plannedWindows/failedWindows  应开/已开/未开的分叉窗口数;
  //   radialByBranch                每根分支最终采用的周向面数 (排查"参数没生效"用);
  //   triangles/vertices            几何规模。
  const stats = {
    skeletonBranches: branchList.length,
    skeletonNodes: skeleton.nodes.length,
    skeletonEdges: skeleton.edges.length,
    bridgeStrips,
    bridgeTriangles,
    caps,
    expectedWindows,
    plannedWindows,
    failedWindows: missingWindows + bridgeFailed.length,
    radialByBranch: ringM,
    triangles: acc.triangleCount,
    vertices: acc.vertexCount,
  }
  let validation = null
  if (opts.validate !== false) {
    // validateSkin 会自动从 userData.seamPairs 取 UV 缝配对, 所以这里不需要显式传 weldPairs。
    validation = validateSkin(geometry, branchList)
    // 两个判据都要看: 拓扑 (boundary/nonManifold/components/missing) + 窗口是否全部接上。
    // 缺窗口时拓扑通常也会报 boundary, 但显式置 ok=false 能把"哪一步失败"区分开。
    validation.failedWindows = stats.failedWindows
    if (stats.failedWindows > 0) validation.ok = false
    stats.validation = validation
  }
  // 失败一定发声: 这个警告在开发期能直接定位是"容量不够"还是"环缺失"。
  if (stats.failedWindows > 0) {
    console.warn('[FastTree] 骨架蒙皮有子分支未完成窗口桥接:', stats.failedWindows,
      `(expected ${expectedWindows}, planned ${plannedWindows}, bridgeErrors ${bridgeFailed.length})`)
  }
  // debug 里带着完整的 plan / attachOf / skinFrames (可能上万帧), 只在显式 opts.debug 时构建,
  // 且不要把它序列化进导出文件 —— 它只用于调试面板与离线诊断。
  const debug = opts.debug ? {
    plan,
    attachOf,
    skinFrameCount: skinFrames.map((f) => f.length),
    skinFrames,
  } : null
  return { geometry, stats, validation, rings, ringM, debug }
}

/**
 * 找出子枝根环的旋转偏移: 让 ring 的第 0 个顶点尽量靠近 rim 的第 0 个顶点。
 *
 * 为什么需要: rim 与子枝 ring0 的顶点顺序各自从自己的"起点"开始 (rim 由窗口左边界起,
 * 子枝从它的 UV 接缝起), 直接 stitch 会让桥接面绕着洞口拧一整圈。这里只做**循环移位**,
 * 不改变环的走向, 因此拓扑上完全等价, 只是让缝合路径变短、更均匀。
 *
 * @param {GeoAcc} acc 顶点累加器 (读位置)
 * @param {Array<number>} rim 父枝洞口边界环
 * @param {Array<number>} childRing 子枝根环顶点下标
 * @param {number} childM 子枝环的顶点数 (相邻两列的角距 = 2π/childM)
 * @returns {number} 0..childM-1 的旋转偏移量
 */
function bestRotation(acc, rim, childRing, childM) {
  if (childM <= 1) return 0
  const pos = acc.position
  const ax = pos[rim[0] * 3]
  const ay = pos[rim[0] * 3 + 1]
  const az = pos[rim[0] * 3 + 2]
  let best = 0
  let bestD = Infinity
  for (let k = 0; k < childM; k++) {
    const idx = childRing[k]
    const dx = pos[idx * 3] - ax
    const dy = pos[idx * 3 + 1] - ay
    const dz = pos[idx * 3 + 2] - az
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestD) { bestD = d; best = k }
  }
  return best
}

/**
 * 两个顶点之间的欧氏距离 (米), 用作 zipper 缝合的弧长权重。
 * 距离为 0 时返回 1: 退化段若返回 0, 累积弧长会停滞, 缝合循环可能原地打转。
 * @param {GeoAcc} acc 顶点累加器
 * @param {number} ia 顶点下标 a
 * @param {number} ib 顶点下标 b
 * @returns {number} 距离 (下限 1)
 */
function distanceBetween(acc, ia, ib) {
  const p = acc.position
  const dx = p[ia * 3] - p[ib * 3]
  const dy = p[ia * 3 + 1] - p[ib * 3 + 1]
  const dz = p[ia * 3 + 2] - p[ib * 3 + 2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
}
