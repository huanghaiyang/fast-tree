/**
 * 主生成器: 参数 -> 两个合并后的几何体 (树皮 + 树叶)
 * ------------------------------------------------------------
 * 作用: 把一份参数对象 (params) 变成可渲染的几何: 递归生长出全部枝条骨架,
 *       再一次性蒙皮成树皮, 并按枝条挂上树叶/花朵/果实实例, 最后做 AO 烘焙与节点表整理。
 * 输入 / 输出:
 *   输入 params —— 完整的树木参数 (trunk / branches / leaves / fruit / flower / roots /
 *        bark / lod / ao / seed / branchEdits ...), 见 core/params.js;
 *   输出 { barkGeometry, leafGeometry, flowerGeometry, nodes, groups, twistGuides,
 *        skeleton, skinStats, stats }。
 * 与其他模块的关系:
 *   store/treeStore 调 buildTree -> 这里调 rng(随机流)、barkSkeleton(骨架图)、
 *   barkSkin / speedtreeBark(蒙皮)、leaf / fruit(实例模板)、ambientOcclusion(烘焙);
 *   产物交给 sceneManager 渲染, 交给 exporter 导出。
 * 关键概念 / 约定:
 *   - 递归生长模型: 树干(level 0) -> 树枝(level 1..N) -> 树叶;
 *   - 长度单位米, 角度参数在别处已转弧度 (本文件内部以弧度运算, DEG 只用于把 UI 的度换过来);
 *   - 每阶段使用独立随机子流 (makeRng(seed, '标签')), 因此"调树叶"不会挪动树干;
 *   - 骨架(位置/半径/父子关系)与蒙皮(几何)分离: 先长完整棵树, 再统一蒙皮,
 *     这样分叉处可以真实开孔桥接, 保证整张树皮是一个 2-manifold。
 * 注意:
 *   - 顶点里的 aNodeId 在生成阶段存的是 "slot 序号", 必须经 finalizeNodes 才能变成最终 node id;
 *   - 所有几何在同一个坐标系下烘焙 (世界坐标, +Y 向上, 地面 y=0), 不做局部变换。
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeRng } from './rng.js'
import { createForceField } from './forceField.js'
import { createBarkSkeleton, addBarkBranch, finalizeBarkSkeleton, enforceChildBranchRadii } from './barkSkeleton.js'
import { buildBarkSkin } from './barkSkin.js'
import { buildSpeedtreeBark } from './speedtreeBark.js'
import { buildLeafTemplate, buildLeafCardTemplate, pushLeafInstance } from './leaf.js'
import { buildFruitTemplate, pushFruitInstance } from './fruit.js'
import { buildOcclusionGrid, bakeOcclusion, bakeOcclusionByRanges } from './ambientOcclusion.js'
import {
  GeoAcc, growFrames, sampleFrame, anyPerp, azimuthPerp, rotateTowardUp,
  clamp01, lerp, boxInfo, UP,
} from './mathUtils.js'

// UI 上的角度参数一律是"度", 进生成器后乘 DEG 转成弧度; 内部只保留弧度运算。
const DEG = Math.PI / 180

/**
 * 生长动画区间: [start, end], 按层级推进。
 *
 * 数组下标 = 枝级 (0 = 树干, 1..5 = L1..L5)。每个元素是该层的全局生长时间窗 (0..1),
 * 写进顶点属性 aGrow, 由着色器按"当前生长进度"把顶点从 origin 缩放展开。
 * 层级越深窗口越晚、越短, 于是视觉上表现为"先长树干 -> 再分叉 -> 最后抽枝长叶"。
 */
const LEVEL_GROW = [
  [0.00, 0.30], // 树干
  [0.14, 0.46], // L1
  [0.32, 0.62], // L2
  [0.48, 0.76], // L3
  [0.62, 0.88], // L4
  [0.74, 0.96], // L5
]

/**
 * 高精度计时 (毫秒)。
 * 优先用 performance.now (单调递增, 不受系统时钟调整影响), 退化到 Date.now;
 * 仅用于统计 buildTree 的耗时 (stats.buildMs), 不参与任何几何计算。
 */
function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

/**
 * 计算一根子枝的初始生长方向。
 *
 * 步骤: 在父枝轴向的法平面上, 以叶序角 (phyllotaxis, 默认 137.5° 黄金角) 为基础方位,
 * 叠加 ±spread 的随机散布 (乘 π —— 注意这是"弧度域的半宽", 不是度);
 * 再沿该方位切向俯仰 pitch 度 (带 pitchVariance 抖动), 得到初始 dir;
 * 最后统一叠加三类"向上驱动力": 全局重力缩放 gravity、向光性 phototropism、该层 upBias。
 * 叶序角保证相邻枝条绕父枝错开, 不会挤在同一侧。
 *
 * @param {Rng} rng 该枝层的随机子流
 * @param {THREE.Vector3} parentDir 父枝在附着点的切向 (会被 clone, 不修改原值)
 * @param {Object} cfg 该层参数 (phyllotaxis / spread / pitch / pitchVariance / gravity / upBias)
 * @param {number} k 该层第几根枝 (用于累加叶序角)
 * @param {Object} params 全局参数 (读 branches.gravityScale / phototropism)
 * @returns {THREE.Vector3} 归一化后的子枝初始方向 (世界坐标)
 */
function childDirection(rng, parentDir, cfg, k, params) {
  // 父枝轴向 + 其上任意一个垂直基向量: 两者张成"绕父枝的方位圆"。
  const axis = parentDir.clone().normalize()
  const perp = anyPerp(axis)
  // 方位角 = 序号 × 叶序角 + 随机散布。黄金角 137.5° 是植物学的叶序常数,
  // 能让相邻枝条互不遮挡; spread 的单位在这里是 π 弧度 (≈180°), 因此 0.2 约等于 ±36°。
  const az = k * (cfg.phyllotaxis || 137.5) * DEG + rng.range(-cfg.spread, cfg.spread) * Math.PI
  const side = perp.clone().applyAxisAngle(axis, az)
  // 俯仰: 绕"切向 side"把方向从父枝轴压开 pitch 度。pitch 越大, 枝条越接近垂直父枝。
  const pitch = (cfg.pitch + rng.signed() * cfg.pitchVariance) * DEG
  const dir = axis.clone().applyAxisAngle(side, pitch)
  // 向上驱动力合并: gravity 是"重力/趋光"标量 (负=下垂), gravityScale 是全局倍率,
  // phototropism 是所有枝层共享的向光性, upBias 是这一层的额外抬升。
  const g = (cfg.gravity || 0) * (params.branches.gravityScale || 1) +
    (params.branches.phototropism || 0) + (cfg.upBias || 0)
  rotateTowardUp(dir, g)
  return dir.normalize()
}

/**
 * 取父枝骨架在 t 处的环坐标系 (与 barkSkin 的平行移动一致)。
 * 用于把子枝基部放到"父枝实际表面"上 —— 树干有 flare/knots 时,
 * 未调制的 skeleton 半径会明显小于真实表面, 子枝就会埋进外扩里,
 * 桥接时看起来像从洞口反着长回去 (约 180° 反向)。
 *
 * 实现: 从首帧的方向出发取任意垂直向量, 逐帧做平行移动 (投影回新切平面) 并叠加该帧的
 * roll 增量; 这样得到的 side 与蒙皮阶段使用的环坐标系完全同源, 子枝开口才能与父枝
 * 表面的环带对齐。索引取最近帧 (round) 而非线性插值 —— 环坐标系不适合跨帧插值。
 *
 * @param {Array<Object>} frames 父枝骨架帧
 * @param {number} t 沿父枝的归一化位置, 0..1
 * @returns {{side: THREE.Vector3, up: THREE.Vector3, frame: Object}} 环坐标系的 side/up 与该处帧
 */
function frameBasisAt(frames, t) {
  const n = frames.length
  // 取最近帧 (四舍五入): 环坐标系不做跨帧插值, 否则 side/up 会失去正交性。
  const idx = Math.max(0, Math.min(n - 1, Math.round(clamp01(t) * (n - 1))))
  const side = anyPerp(frames[0].dir.clone()).normalize()
  for (let i = 0; i <= idx; i++) {
    const f = frames[i]
    if (i > 0) {
      // 平行移动第一步: 把上一帧的 side 投影到当前帧的法平面 (side -= (side·dir)·dir)。
      side.addScaledVector(f.dir, -side.dot(f.dir))
      // 投影后退化 (side 与 dir 共线) 时重新取一个任意垂直向量兜底。
      if (side.lengthSq() < 1e-10) anyPerp(f.dir, side)
      side.normalize()
      // 再叠加这一帧相对上一帧的 roll 增量, 让 side 跟着枝条扭转一起转。
      const rollDelta = (f.roll || 0) - (frames[i - 1].roll || 0)
      if (rollDelta) side.applyAxisAngle(f.dir, rollDelta)
      // roll 旋转会让 side 略微离开法平面, 再投影一次恢复正交。
      side.addScaledVector(f.dir, -side.dot(f.dir)).normalize()
    } else if (f.roll) {
      // 首帧: 直接施加初始 roll (没有"上一帧"可比)。
      side.applyAxisAngle(f.dir, f.roll)
      side.addScaledVector(f.dir, -side.dot(f.dir)).normalize()
    }
  }
  const f = frames[idx]
  // up = dir × side: 与 dir、side 一起构成右手正交基 (蒙皮环带就用这组基)。
  const up = new THREE.Vector3().crossVectors(f.dir, side).normalize()
  return { side, up, frame: f }
}

/**
 * 生成一棵树 (主入口)。
 *
 * 阶段顺序 (顺序本身就是设计的一部分, 不能随便调换):
 *   ① 建骨架容器(createBarkSkeleton)与累加器(树叶/花朵/果实各一个 GeoAcc);
 *   ② 准备模板 (叶形/花朵卡片/果实) 与各阶段随机子流 (leaves/fruit/flowers/branch-level-N);
 *   ③ 树干 -> 树根 -> L1..LN 递归长枝 (addBarkBranch 只登记骨架, 不出几何);
 *   ④ finalizeBarkSkeleton + enforceChildBranchRadii 后统一蒙皮 (barkSkin 或 speedtree);
 *   ⑤ 果实几何并入树皮几何; 花朵后置生成 (需要先采到附着枝);
 *   ⑥ 程序化 AO 烘焙进顶点色;
 *   ⑦ finalizeNodes 把 slot 序号重排成最终 node id, 并统计节点/组的面数与包围盒。
 * 全程除 options 外不读外部可变状态, 同一 seed + 同一 params 的结果逐字节可复现。
 *
 * @param {Object} params 完整树木参数 (见 core/params.js 与 species/*)
 * @param {Object} [options={}] 生成选项
 * @param {boolean} [options.validate] 传给蒙皮器: 是否做拓扑校验 (默认 true; 仅调试时关)
 * @returns {{barkGeometry: THREE.BufferGeometry, leafGeometry: THREE.BufferGeometry|null,
 *   flowerGeometry: THREE.BufferGeometry|null, nodes: Array, groups: Array, twistGuides: Object,
 *   skeleton: Object, skinStats: Object, stats: Object}}
 *   树皮/树叶/花朵三个几何 + 节点树 + 扭曲句柄引导线 + 骨架与统计信息
 */
export function buildTree(params, options = {}) {
  const t0 = now()
  const P = params
  // 空间引导力: 把吸引子/排斥子变成逐段转向器; 未启用或没有对象时为 null。
  // 只作用于树干与树枝 (树根在地表以下, 不受场景障碍物影响), 见 forceField.js。
  const forceField = createForceField(P.forces)
  const branchParams = P.branches
  // 一体建模开关: 打开后枝条基部带一点极轻微的领口 (baseFlare), 让分叉看起来更"连续长出来"。
  const onePiece = !!(P.trunk && P.trunk.onePiece)
  const L = P.leaves
  // 果实配置允许整个缺失: 缺省即关闭, 后面的判断都只看 F.enabled。
  const F = P.fruit || { enabled: false, levels: [] }
  // 挂果层级回退: 如果设置里勾选的层级在这棵树上一级都没有 (比如默认树只有 3 层枝,
  // 而果实勾的是 L4), 就退到最深的可用层级 —— 否则"打开果实开关"会毫无反应。
  const effFruitLevels = (() => {
    const lv = Array.isArray(F.levels) ? F.levels : []
    // 这棵树实际有多少级枝 (至少 1 级); 果实勾选的层级数组可能比它长。
    const maxLv = Math.max(1, Math.round(P.branches.levels || 1))
    // 只要有一个勾选层级落在有效范围内, 就原样使用用户的选择。
    if (lv.some((on, i) => on && i < maxLv)) return lv
    // 否则退到最深可用层: 先补齐长度, 再把最后一层点亮。这样"打开果实开关"至少能看见果实。
    const out = lv.slice(0, 5)
    while (out.length < maxLv) out.push(false)
    out[maxLv - 1] = true
    return out
  })()

  // 骨架先行: 这里只收集骨架 (节点/边/半径/父子关系), 不生成任何树皮几何。
  // 全部生长结束后由 barkSkin 一次性蒙皮 (分叉切孔桥接 / 端盖), 保证单张 2-manifold。
  const barkSkeleton = createBarkSkeleton()
  // 树叶与果实各自一个顶点累加器: 树皮是"一个连通曲面", 而叶片/果实是大量独立实例,
  // 分开累加才能在最后分别 merge 成两个几何体 (对应两套材质)。
  const leafAcc = new GeoAcc()
  // 花朵: 独立累加器 + 复用树叶的"记录附件点 -> 后置生成"策略
  // (花朵的参数与树叶完全独立, 但要挂在同一批枝条上, 所以先只记录枝条, 等枝条长完再采样)
  const FL = P.flower || {}
  const flowerAcc = FL.enabled ? new GeoAcc() : null
  const flowerBranches = []
  // 花朵模板: 平面花卡 (照片级素材) 或 程序化叶形轮廓; 可选十字交叉
  // useShape 时走程序化叶形 (花瓣轮廓 + curl/fold), 否则用 1x3 的平面花卡 (贴照片素材),
  // cardAspect 控制花卡宽高比, curl/fold 给出轻微弯曲, 避免完全平面显得像贴纸。
  const flowerCardTemplate = () => (FL.useShape
    ? buildLeafTemplate({
        shape: FL.shape || 'oval',
        segments: FL.segments, curl: FL.curl, fold: FL.fold, petiole: FL.petiole,
      })
    : buildLeafCardTemplate({
        aspect: FL.cardAspect || 1, cols: 1, rows: 3,
        curl: FL.cardCurl === undefined ? 0.1 : FL.cardCurl,
        fold: FL.cardFold === undefined ? 0.12 : FL.cardFold,
      }))

  /**
   * 把多个模板按给定欧拉角合并成一个几何 (十字交叉用)。
   *
   * 逐顶点做两次旋转: 先绕 Y (yaw), 再绕 X (pitch), 位置与法线用同一套旋转矩阵,
   * 索引加上该模板的顶点基址 base。UV 直接拼接不变 —— 十字交叉的多片共用同一张贴图。
   * 注意这里保留的 stamenRange 恒为 null: 合并后无法再区分单片的雄蕊区间。
   *
   * @param {Array<Object>} tpls 模板数组 (每个含 positions/normals/uvs/index)
   * @param {Array<Array<number>>} rotations 每个模板的 [rx, ry] 欧拉角 (弧度)
   * @returns {{positions: Array<number>, normals: Array<number>, uvs: Array<number>, index: Array<number>, vertexCount: number, stamenRange: null}}
   */
  const mergeFlowerTemplates = (tpls, rotations) => {
    const positions = []
    const normals = []
    const uvs = []
    const index = []
    const stamenRange = null
    tpls.forEach((tpl, i) => {
      const [rx, ry] = rotations[i] || [0, 0]
      const cx = Math.cos(rx), sx = Math.sin(rx)
      const cy = Math.cos(ry), sy = Math.sin(ry)
      // 本片模板在合并后数组里的顶点基址 (索引要整体平移这段偏移)。
      const base = positions.length / 3
      for (let k = 0; k < tpl.positions.length; k += 3) {
        let x = tpl.positions[k]
        let y = tpl.positions[k + 1]
        let z = tpl.positions[k + 2]
        // 绕 Y
        let x1 = x * cy + z * sy
        let z1 = -x * sy + z * cy
        // 绕 X
        let y1 = y * cx - z1 * sx
        let z2 = y * sx + z1 * cx
        positions.push(x1, y1, z2)
        // 法线必须跟着做同样的旋转, 否则交叉花瓣的背光面会算错 (平移对法线无影响)。
        const nx = tpl.normals[k], ny = tpl.normals[k + 1], nz = tpl.normals[k + 2]
        const nx1 = nx * cy + nz * sy
        const nz1 = -nx * sy + nz * cy
        const ny1 = ny * cx - nz1 * sx
        const nz2 = ny * sx + nz1 * cx
        normals.push(nx1, ny1, nz2)
      }
      for (let k = 0; k < tpl.uvs.length; k++) uvs.push(tpl.uvs[k])
      for (const idx of tpl.index) index.push(base + idx)
    })
    return { positions, normals, uvs, index, vertexCount: positions.length / 3, stamenRange }
  }

  /**
   * 按 cross 模式构造花朵模板。
   * 单面花卡从侧面看是一条线, 所以用 2~3 片互相垂直的副本做"十字交叉":
   *   'v' 两片都绕 Y 差 90°  => 两片竖直面互成十字 (侧看仍像花);
   *   'h' 第二片再绕 X 差 90° => 一竖一横 (俯视也有轮廓);
   *   其他值 (双向) 三片 => 最贵但任何角度都饱满。
   */
  const makeFlowerTemplate = () => {
    const tpl = flowerCardTemplate()
    const mode = FL.cross || 'none'
    if (mode === 'none') return tpl
    const HALF_PI = Math.PI / 2
    if (mode === 'v') return mergeFlowerTemplates([tpl, tpl], [[0, 0], [0, HALF_PI]])          // 竖向交叉 (两片竖直面)
    if (mode === 'h') return mergeFlowerTemplates([tpl, tpl], [[0, 0], [HALF_PI, 0]])          // 横向交叉 (一竖一横)
    return mergeFlowerTemplates([tpl, tpl, tpl], [[0, 0], [0, HALF_PI], [HALF_PI, 0]])          // 双向交叉 (3 片)
  }
  /**
   * 按叶形生成一个叶片模板 (可复用的原型几何)。
   * cardMode 走"照片卡片"路径 (一张平面卡 + 轻微 curl/fold), 否则走"程序化叶形"路径;
   * 两者接口一致 (positions/normals/uvs/index), 下游 pushLeafInstance 不区分来源。
   *
   * @param {string} shape 程序化叶形名 (oval/needle/heart/...), cardMode 下忽略
   * @returns {Object} 叶片模板
   */
  const makeTemplate = (shape) => (L.cardMode
    ? buildLeafCardTemplate({
        aspect: L.cardAspect || 1,
        cols: 1,
        rows: 3,
        curl: L.cardCurl === undefined ? 0.1 : L.cardCurl,
        fold: L.cardFold === undefined ? 0.12 : L.cardFold,
      })
    : buildLeafTemplate({
        shape, segments: L.segments, curl: L.curl, fold: L.fold, petiole: L.petiole,
      }))
  const leafTemplate = makeTemplate(L.shape)
  // 叶形混合: shapeMix 里每一项都生成一个模板, 实例化时按权重随机挑
  // 权重换算成"重复次数" (×8 取整): 权重 1 的叶形在候选数组里出现 8 次,
  // 权重 2 出现 16 次 —— 这样下游只需 rng.pick 等概率抽取, 就等价于按权重抽样,
  // 且不需要在每片叶子上再做一次前缀和查询。
  const mixList = Array.isArray(L.shapeMix)
    ? L.shapeMix.filter((m) => m && m.shape && (m.weight === undefined || m.weight > 0))
    : []
  const leafTemplates = mixList.length
    ? mixList.flatMap((m) => {
        const tpl = makeTemplate(m.shape)
        const n = Math.max(1, Math.round((m.weight === undefined ? 1 : m.weight) * 8))
        return new Array(n).fill(tpl)
      })
    : [leafTemplate]
  // 叶片总数上限: 防参数开太大导致内存/构建时间爆炸 (默认 6 万, 由 lod.maxLeaves 覆盖)。
  const maxLeaves = Math.max(0, Math.round((P.lod && P.lod.maxLeaves) || 60000))
  // 随机子流纪律: 每个阶段/每层各自 fork, 改一处不会平移别处的随机序列。
  const leafRng = makeRng(P.seed, 'leaves')
  const fruitRng = makeRng(P.seed, 'fruit')
  // 叶片保留比例用"确定性抽样"而不是 rng.chance: 不同 LOD 只少画叶子,
  // 叶片位置/其余随机流完全不变 -> 远景/近景切换时树形不跳变
  // 实现: 对全局递增的 leafDrawIndex 取模, 命中才真正生成。
  // （待确认: 被跳过时该叶子的后续 rng 消耗也随之跳过, 严格说不同 leafRatio 之间
  //   保留下来的叶片位置会发生整体平移; 本机制保证的是"同一 leafRatio 下逐次生成一致"。
  //   与上方原注释的期望存在出入, 未改动代码, 仅标注以便复核。）
  const leafKeepEvery = P.lod && P.lod.leafRatio < 1
    ? Math.max(1, Math.round(1 / Math.max(0.001, P.lod.leafRatio)))
    : 1
  let leafDrawIndex = 0
  let fruitCount = 0
  const fruitAttach = []   // 挂果点 (自检用)
  const fruitOrient = []   // [果柄端到挂果点距离, 坚果底到挂果点距离] (自检用)
  const fruitAcc = new GeoAcc()
  const levelRng = {}
  for (let i = 1; i <= 5; i++) levelRng[i] = makeRng(P.seed, 'branch-level-' + i)

  // 全局计数 (stats 上报用): 枝条根数、叶片实例数
  let branchCount = 0
  let leafCount = 0

  /* ------------------------------------------------------------------ */
  /* 模型节点 (节点树的原始记录)                                          */
  /* ------------------------------------------------------------------ */
  // 生成阶段先给每个元素一个顺序 slot, 顶点里写的是 slot;
  // 全部生成完后按"组"重排成最终 node id (保证每组 id 连续, 便于用区间高亮)
  const slots = []
  // 每层每类元素的命名计数器 (顺带用于生成"L2 枝 #7"这样的可读名字)
  const levelBranchCounter = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const levelLeafCounter = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const levelFruitCounter = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  /**
   * 登记一个节点, 返回它的 slot 序号。
   * 注意: 这里传入的 parent 是 **slot 序号**, 不是最终 node id; finalizeNodes 目前只重排
   * id 与 aNodeId, 并不改写 parent —— 需要按父级找节点时用 nodes[].slot 反查。
   * （待确认: 当前 src 内未见 node.parent 的消费方, 保留字段以兼容节点树扩展。）
   */
  const addSlot = (info) => {
    const s = slots.length
    slots.push(info)
    return s
  }

  // 叶片基色/梢色: 每个实例在两点颜色之间做带随机方差的乘法调制, 得到自然的深浅差。
  const leafBase = new THREE.Color(L.color)
  const leafTip = new THREE.Color(L.colorTip)
  // AO 遮挡点云: 记录叶片/花朵中心 (世界坐标), 生成完后统一烘焙
  const aoSamples = []
  // 叶片/花朵的顶点区间: AO 按"每个实例一次查询"烘焙, 比逐顶点快一个量级
  // 区间格式 [v0, v1, cx, cy, cz]: 顶点范围 + 实例中心 (世界坐标)。
  const leafAoRanges = []
  const flowerAoRanges = []

  /* ------------------------------------------------------------------ */
  /* 叶片                                                                */
  /* ------------------------------------------------------------------ */
  /**
   * 在一根枝条上撒叶簇 (每个叶簇 = clusterCount 片叶卡)。
   *
   * 分布模型: 沿枝条在 [startT, endT] 区间上按 (i+0.5)/perBranch 均匀取样 (半格偏移,
   * 避免叶子全挤在端点上), 每个取样点再绕枝轴按叶序角展开 clusterCount 片。
   * 所有随机来自共享的 leafRng 单流 (顺序固定), 因此入叶参数只影响叶子自身。
   * 副作用: 首次真正生成叶片时惰性登记一个 leaves 节点 (leafSlot); 同时把枝条记入
   * flowerBranches, 供花朵后置生成使用 (即使树叶关闭也会记录)。
   *
   * @param {Array<Object>} frames 该枝条骨架帧
   * @param {number} level 枝级 (1..N), 用于分组与生长区间
   * @param {number} branchWind 该枝梢部的风柔度 (叶子在此基础上 +0.12)
   * @param {number} parentSlot 该枝条的节点 slot (作为叶节点父级)
   */
  const spawnLeaves = (frames, level, branchWind, parentSlot) => {
    // 花朵独立: 即使树叶关闭, 也要跑位置采集 (否则花朵没有附着点)
    if ((!L.enabled && !FL.enabled) || leafCount >= maxLeaves) return
    // 记录这条可开花的枝条: 花朵用自己的 perBranch/clusterCount/startT/endT 采样
    if (flowerAcc) flowerBranches.push({ frames, level, wind1: branchWind })
    const rng = leafRng
    // 每根枝条的叶簇数 / 每簇叶片数 (至少 1, 防止参数为 0 时静默无叶)
    const perBranch = Math.max(1, Math.round(L.perBranch))
    const clusterCount = Math.max(1, Math.round(L.clusterCount))
    // 分布区间 (自动纠正用户把 start/end 填反的情况)
    const tA = Math.min(L.startT, L.endT)
    const tB = Math.max(L.startT, L.endT)
    // 每簇之间的方位步进: branchWrap 开启时把 totalTurns 圈均分到 perBranch 个簇
    // (叶子绕着枝条盘绕), 否则用固定叶序角 137.5°。两者都能保证相邻簇不重叠。
    const phyllo = L.branchWrap
      ? (Math.max(0.1, Number(L.branchWrapTurns) || 2) * Math.PI * 2) / perBranch
      : (L.phyllotaxis === undefined ? 137.5 : L.phyllotaxis) * DEG
    // 该枝条的叶节点 (惰性创建: 真的长出叶子才登记)
    let leafSlot = -1
    const leafStart = leafCount

    // 沿枝条均匀布簇; tt 加上 ±0.04 抖动并夹到 [0.01, 0.999] —— 端点留一点余量,
    // 既避开枝条最细的梢尖 (半径太小叶子会穿出), 也避开基部与父枝的桥接区。
    for (let i = 0; i < perBranch; i++) {
      if (leafCount >= maxLeaves) return
      const u = (i + 0.5) / perBranch
      let tt = lerp(tA, tB, u) + rng.signed() * 0.04
      tt = Math.min(0.999, Math.max(0.01, tt))
      const fr = sampleFrame(frames, tt)
      if (!fr) continue
      const dir = fr.dir
      const perp = anyPerp(dir)
      // 方位基准 = 序号步进 + 随机整圈偏移 + 该处的扭曲角。
      // 加 profileRoll 是为了让叶簇跟着枝条"扭"——否则扭曲开启后叶子的螺旋会与树皮纹理脱节。
      const azimuthBase = i * phyllo + rng.range(0, Math.PI * 2) + (fr.profileRoll || 0)

      // 每个叶簇内部: 绕枝轴再展开 clusterCount 片
      for (let c = 0; c < clusterCount; c++) {
        if (leafCount >= maxLeaves) return
        // 确定性的 LOD 抽稀: 只有索引命中才生成 (leafDrawIndex 的自增在 continue 之前完成,
        // 因此每个候选叶片都占一个确定的位置, 不依赖 rng 的概率)。
        if (leafKeepEvery > 1 && leafDrawIndex++ % leafKeepEvery !== 0) continue

        // 簇内方位抖动 ±1.3 rad (≈±75°), 避免同簇叶片完全对称、像贴纸。
        const az = azimuthBase + rng.range(-1.3, 1.3)
        const sideAxis = perp.clone().applyAxisAngle(dir, az)
        // 叶基半径 = 枝条半径 + 簇半径 × 散布系数 × sqrt(u)。
        // sqrt 让偏移量在圆盘面积上均匀分布 (否则叶片会往中心扎堆, 边缘稀疏)。
        const leafR = fr.radius + L.clusterRadius * L.clusterSpread * Math.sqrt(rng.next())
        // 位置 = 枝条表面上的点 + 径向偏移 + 沿枝轴的 ±3cm 抖动 (打散"排队"感)。
        const pos = fr.pos.clone()
          .addScaledVector(sideAxis, leafR)
          .addScaledVector(dir, rng.range(-0.03, 0.03))

        // --- 叶轴方向 ---
        // 叶轴 = 枝条切向, 先绕"垂直于枝轴的俯仰轴"压开 pitch 度 (叶柄从枝上翘起),
        // 再按 droop 下垂 (rotateTowardUp 负角度)、按 twist 绕枝轴自转, 全部带随机方差。
        const stem = dir.clone()
        const pitchAxis = perp.clone().applyAxisAngle(dir, az)
        stem.applyAxisAngle(pitchAxis, (L.pitch + rng.signed() * L.pitchVariance) * DEG)
        if (L.droop) rotateTowardUp(stem, -L.droop * rng.range(0.35, 1.0) * 0.9)
        if (L.twist) stem.applyAxisAngle(dir, rng.signed() * L.twist)
        stem.normalize()

        // --- 叶面法线 ---
        // 先取任意垂直向量, 绕叶轴随机滚转 (rollVariance 度 -> 乘 /180 得到"圈数"再乘 2π 的等效写法),
        // 再统一朝上翻转、并按 faceUp 在"随机法线"和 +Y 之间插值 —— faceUp=1 时叶片完全水平朝天。
        const nrm = anyPerp(stem)
        nrm.applyAxisAngle(stem, rng.range(0, Math.PI * 2) * (L.rollVariance / 180))
        if (nrm.dot(UP) < 0) nrm.negate()
        nrm.lerp(UP, clamp01(L.faceUp)).normalize()

        // --- 正交基 ---
        // 叶片模板在局部坐标里 y = 叶轴 (长度方向), z = 叶面法线, x = 宽度方向。
        // 这里把 nrm 投影成与叶轴垂直的 zA (施密特正交化), 再叉乘出 xA, 保证三轴严格正交。
        const yA = stem
        const zA = nrm.clone().addScaledVector(yA, -nrm.dot(yA))
        if (zA.lengthSq() < 1e-8) anyPerp(yA, zA)
        zA.normalize()
        const xA = new THREE.Vector3().crossVectors(yA, zA).normalize()
        // 模型旋转: 绕叶面法线转整张叶片 (贴图偏移/叶柄方向反了时 ±180 校正)
        const modelRot = (L.modelRotation || 0) * DEG
        if (modelRot) {
          xA.applyAxisAngle(zA, modelRot)
          yA.applyAxisAngle(zA, modelRot)
        }

        const size = Math.max(0.005, L.size * rng.vary(L.sizeVariance))
        // 下限 5mm 是防退化阈值: 叶片小到亚毫米级时, 顶点色/AO 的精度会把它抖成噪点。
        // z 轴是叶片的"横向/离面"方向, 必须和宽度同尺度缩放,
        // 否则细长叶 (针叶) 的折角会被拉陡, 法线侧立 -> 背光发黑
        // 卡片模式下卡片本身是单位正方形, 所以要显式乘 cardAspect 还原宽高比。
        const widthMul = L.cardMode ? (L.cardAspect || 1) * (L.width === undefined ? 1 : L.width) : L.width
        const scale = new THREE.Vector3(size * widthMul, size, size * widthMul)

        // 基色/梢色各自做 ±colorVariance 的乘法抖动; 梢部抖动幅度打七折 (×0.7),
        // 让"叶尖更浅"的渐变在整棵树上保持可读, 不会被随机噪声吃掉。
        // Math.max(0, ...) 防止负值导致颜色翻转。
        const tintA = leafBase.clone().multiplyScalar(Math.max(0, 1 + rng.signed() * L.colorVariance))
        const tintB = leafTip.clone().multiplyScalar(Math.max(0, 1 + rng.signed() * L.colorVariance * 0.7))

        // 叶片比枝条略软 (风柔度 +0.12), 上限 1; phase 随机整圈, 让每片叶子摆动不同步。
        const wind = Math.min(1, branchWind + 0.12)
        const phase = rng.range(0, Math.PI * 2)
        // 生长动画区间: 叶片在枝条长到 50%~90% 时展开, 0.14 的窗口宽度 ≈ 快速抽叶。
        const g0 = Math.min(0.98, 0.5 + rng.next() * 0.4)
        const g1 = Math.min(1.0, g0 + 0.14)

        // 惰性登记叶节点: 只有该枝条真的长出第一片叶子才建节点, 空枝不会出现在节点树里。
        // (leafSlot 一旦赋值, 同枝后续叶片共用这一个节点。)
        if (L.enabled && leafSlot < 0) {
          levelLeafCounter[level] = (levelLeafCounter[level] || 0) + 1
          leafSlot = addSlot({
            type: 'leaves',
            level,
            group: `leaves-L${level}`,
            name: `L${level} 叶簇 #${levelLeafCounter[level]}`,
            parent: parentSlot,
            meta: { leaves: 0 },
          })
        }

        // 叶形混合: 同一棵树可以混用多种叶形 (不同树种叶形差别很大)
        const tpl = leafTemplates.length > 1 ? rng.pick(leafTemplates) : leafTemplate
        if (L.enabled) {
          const v0 = leafAcc.vertexCount
          // 实例化: 把模板顶点按 {x,y,z} 三轴 + scale 变换到世界坐标, 并写入风/AO/生长/节点属性。
          // 最后一个参数是雄蕊颜色 —— 只有模板声明了 stamenRange (程序化花朵) 才用得上,
          // （待确认: stamenColor 未在本文件声明, 实际参数恒为 null 分支, 未改动代码）
          pushLeafInstance(
            leafAcc, tpl,
            { x: xA, y: yA, z: zA }, scale, pos,
            tintA, tintB, wind, phase,
            pos.clone(), g0, g1, leafSlot,
            tpl.stamenRange ? stamenColor : null,
          )
          // 记下这片叶子的顶点范围 + 中心, AO 阶段按区间一次烘焙
          leafAoRanges.push([v0, leafAcc.vertexCount, pos.x, pos.y, pos.z])
        }
        if (L.enabled && slots[leafSlot]) slots[leafSlot].meta.leaves++
        // 点云样本: 每个实例只取中心一个点 (够用且便宜, 逐顶点会让点云膨胀几十倍)
        if (L.enabled) aoSamples.push(pos.x, pos.y, pos.z)
        leafCount++
      }
    }
    // 叶簇数 ≈ 本枝实际生成的叶片数 / 每簇片数 (四舍五入, 至少 1)
    if (leafSlot >= 0 && slots[leafSlot]) {
      slots[leafSlot].meta.clusters = Math.max(1, Math.round((leafCount - leafStart) / Math.max(1, clusterCount)))
    }
  }

  /* ------------------------------------------------------------------ */
  /* 递归生长                                                            */
  /* ------------------------------------------------------------------ */
  /**
   * 在一根父枝上递归生成下一级枝条。
   *
   * 分布: 沿父枝 [startT, endT] 均匀放 count 根 (半格偏移 + startJitter 抖动),
   * 越靠梢部的枝条越短 (顶端优势 apicalDominance), 半径按父枝该处半径的比例取,
   * 方向由 childDirection 决定, 最终递归调用 buildBranch 继续向下长。
   * 递归深度由 branches.levels 控制; 每层用 levelRng[level] 独立子流, 改 L2 参数不影响 L1。
   *
   * @param {Array<Object>} parentFrames 父枝骨架帧
   * @param {number} parentLevel 父枝级 (树干 = 0)
   * @param {number} parentLength 父枝长度 (米), 用于按比例算子枝长
   * @param {Rng} parentRng 父枝随机流 (这里只在极少数回退分支用到)
   * @param {number} parentWind0 父枝基部的风柔度
   * @param {number} parentWind1 父枝梢部的风柔度
   * @param {number} parentSlot 父枝节点 slot
   * @param {Object} parentBranch 父枝骨架分支 (addBarkBranch 的返回值)
   * @param {number|null} clampEndT 额外的分布终点上限 (当前唯一调用处传 null = 不额外截断)
   * @param {Object} [parentSurface] 父枝"真实表面"信息 {frames, modifier, squashX, squashZ}
   *        —— 存在时子枝基部贴到含 flare/knots/椭圆压扁后的表面, 而不是裸骨架半径
   */
  const spawnChildren = (parentFrames, parentLevel, parentLength, parentRng, parentWind0, parentWind1, parentSlot, parentBranch, clampEndT, parentSurface) => {
    const level = parentLevel + 1
    // 层数封顶 / 该层未启用 / 数量为 0 => 停止递归。这三个都是"合法空状态", 直接返回。
    if (level > branchParams.levels) return
    const cfg = branchParams.level[level - 1]
    if (!cfg || !cfg.enabled || cfg.count <= 0) return

    // 该层的专属随机子流: 只随 (seed, 'branch-level-N') 变化, 与父枝消耗到第几个数无关。
    const rng = levelRng[level]
    const count = Math.max(0, Math.round(cfg.count))
    // 分布窗口: startSpread 让整层枝条整体往上挪 (给叶下留空间), 再按 clampEndT 截断。
    const startT = clamp01(Math.min(cfg.startT, cfg.endT) + (branchParams.startSpread || 0))
    let endT = clamp01(Math.max(cfg.startT, cfg.endT))
    if (clampEndT !== undefined && clampEndT !== null) endT = Math.min(endT, clamp01(clampEndT))
    if (endT <= startT) return

    for (let k = 0; k < count; k++) {
      const u = (k + 0.5) / count
      // tt 抖动后夹在 [0.008, 0.997]: 太靠基部会与父枝桥接区冲突, 太靠梢部则父枝半径太小。
      let tt = lerp(startT, endT, u) + rng.signed() * cfg.startJitter
      tt = Math.min(0.997, Math.max(0.008, tt))
      const fr = sampleFrame(parentFrames, tt)
      if (!fr) continue

      // 顶端优势: tt 越接近梢部, 子枝越短。指数 1.6 让"基部枝明显长、梢部枝短促",
      // 比线性衰减更接近真实乔木的轮廓 (抛物线形树冠)。
      const apical = 1 - (branchParams.apicalDominance || 0) * Math.pow(tt, 1.6)
      // 长度 = 父枝长 × 该层长度比 × 方差 × 顶端优势 × 全局长度缩放; 下限 1cm 防退化。
      const length = Math.max(0.01,
        parentLength * cfg.lengthRatio * rng.vary(cfg.lengthVariance) * apical * (branchParams.lengthScale || 1))
      // 基部半径 = 父枝该处半径 × 该层半径比 × 方差 × 全局半径缩放; 下限 0.8mm。
      const radius0 = Math.max(0.0008,
        fr.radius * cfg.radiusRatio * rng.vary(cfg.radiusVariance) * (branchParams.radiusScale || 1))
      const radius1 = Math.max(0.0005, radius0 * cfg.taper)
      const dir = childDirection(rng, fr.dir, cfg, k, P)
      // 扭转跟随: 用完整 roll (基础 twist + 扭曲曲线句柄), 不只是 profileRoll。
      // 这样主干一起扭时, 子枝的贴附点/生长方向会跟着转; 树枝的 twist 也会带动它的子枝。
      const roll = fr.roll || 0
      if (roll) dir.applyAxisAngle(fr.dir, roll)
      // 贴附方位必须跟随枝条真实的生长方位: 取 dir 垂直于父枝轴的分量。
      // 否则"贴在父枝一侧、却朝另一侧/父枝内部生长", 蒙皮时子枝基部环与父枝洞口平面
      // 会相差 ~90°, 肩部桥接被迫在很短距离内扭转 90°, 看起来就像树枝基部被翻转。
      // 只有枝条几乎平行于父枝 (径向分量≈0) 时, 才退回叶序角。
      // （待确认: 回退分支里的 profileRoll 未在此作用域声明; 该分支仅在 dir 几乎平行父枝时命中,
      //   未改动代码, 仅在此标注以便排查。）
      const radialDir = dir.clone().addScaledVector(fr.dir, -dir.dot(fr.dir))
      const outDir = radialDir.lengthSq() > 1e-8
        ? radialDir.normalize()
        : azimuthPerp(fr.dir, k * (cfg.phyllotaxis || 137.5) * DEG + profileRoll, new THREE.Vector3())
      // 分支基部贴到父枝"实际表面"上 (骨架先定位置, 蒙皮阶段再在父枝上切孔桥接)。
      // 父枝有 flare/knots 时必须用调制后的半径, 否则子枝基部会埋在外扩内部,
      // 桥接后视觉上像树枝从洞口反着长回去。
      // 默认 (无 parentSurface) 用骨架半径 ×0.95 略微内收, 保证基部一定在表面之内。
      let attachRadius = fr.radius * 0.95
      if (parentSurface) {
        // 把 outDir 转到父枝环坐标系里得到方位角 az, 再用该枝的 radiusModifier 求表面半径。
        const basis = frameBasisAt(parentSurface.frames, tt)
        const az = Math.atan2(outDir.dot(basis.up), outDir.dot(basis.side))
        const mod = parentSurface.modifier ? parentSurface.modifier(basis.frame.t, az, basis.frame.radius) : 1
        // 椭圆压扁: 表面半径随方位在 squashX/squashZ 之间过渡, proj 是该方位的等效投影系数。
        // —— 压扁后的截面是椭圆, 直接用圆形半径会让斜向的子枝浮空或埋入。
        const sx = parentSurface.squashX === undefined ? 1 : parentSurface.squashX
        const sz = parentSurface.squashZ === undefined ? 1 : parentSurface.squashZ
        const proj = Math.hypot(Math.cos(az) * sx, Math.sin(az) * sz)
        // 取"骨架半径"和"调制后表面半径"的较大者, 再 ×0.92 稍微压进表面,
        // 保证根部一定与父枝表面相交 (蒙皮切孔时才有实料可桥接)。
        attachRadius = Math.max(fr.radius, basis.frame.radius * mod * proj) * 0.92
      }
      const startPos = fr.pos.clone().addScaledVector(outDir, attachRadius)

      // 风柔度沿父枝线性插值到该附着点, 子枝梢部再增加一点 (默认 +0.3, 由 windGain 缩放)。
      const wind0 = lerp(parentWind0, parentWind1, tt)
      const wind1 = Math.min(1, wind0 + 0.3 * (cfg.windGain === undefined ? 1 : cfg.windGain))

      buildBranch({
        level, startPos, startDir: dir, length, radius0, radius1, cfg, rng, wind0, wind1,
        parentSlot, parentBranch,
      })
    }
  }

  /* ------------------------------------------------------------------ */
  /* 单枝手工编辑 (半径/移动/旋转/扭曲)                                   */
  /* ------------------------------------------------------------------ */
  // 以骨架分支下标为 key, 在同一 seed/骨架结构下稳定。编辑在 addBarkBranch
  // 之前应用到 frames, 因此子枝、叶片、果实和蒙皮窗口都会跟着变换。
  // 稳定性边界: 下标是"生成顺序", 一旦改了会影响骨架结构的参数 (层数 / 每层数量 /
  // 树干分叉), 旧编辑记录就可能落到别的枝条上 —— 这是设计取舍, 换取"免存路径"的简单性。
  const branchEdits = P.branchEdits && typeof P.branchEdits === 'object' ? P.branchEdits : null
  /**
   * 读取某个分支下标的人工编辑记录 (可能是旧 JSON 里的脏数据)。
   * @param {number} index 骨架分支下标 (树干=0, 之后按生成顺序递增)
   * @returns {Object|null} 编辑记录 {radiusScale, rotX, rotY, rotZ, twist, moveX, moveY, moveZ}
   */
  const branchEditOf = (index) => {
    if (!branchEdits) return null
    const e = branchEdits[index]
    if (!e || typeof e !== 'object') return null
    return e
  }
  /**
   * 把人工编辑应用到一根枝条的骨架上 (就地进行, 影响后续所有消费者)。
   *
   * 顺序很重要: 半径缩放 -> 绕基点旋转 -> 扭转 -> 平移。
   * 旋转的支点 pivot 取首帧位置 (枝条基部), 这样"转角度"看起来像绕树皮上的着生点摆动,
   * 而不是绕世界原点甩出去。扭转按 t 线性加权 (根部不动、梢部转最多), 避免基部被拧脱。
   * 因为调用点在 addBarkBranch 之前, 之后生成的子枝/叶片/蒙皮窗口都会自动跟随。
   *
   * @param {Array<Object>} frames 枝条骨架帧 (原地修改)
   * @param {number} index 骨架分支下标
   */
  const applyBranchEdit = (frames, index) => {
    const e = branchEditOf(index)
    if (!e || !Array.isArray(frames) || !frames.length) return
    // num: 把外部值安全转成数字 (NaN/不可解析 => 默认值), 兼容旧存档里的字符串数字
    const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
    // 半径缩放夹在 [0.05, 6]: 太小会退化到看不见, 太大会与父枝/邻枝严重穿插。
    const radiusScale = Math.max(0.05, Math.min(6, num(e.radiusScale, 1)))
    const rx = num(e.rotX) * DEG
    const ry = num(e.rotY) * DEG
    const rz = num(e.rotZ) * DEG
    const twist = num(e.twist) * DEG
    const mx = num(e.moveX)
    const my = num(e.moveY)
    const mz = num(e.moveZ)
    // 旋转支点 = 枝条基部 (首帧位置), 见上方说明。
    const pivot = frames[0].pos.clone()
    // 三个角都为 0 时不建四元数, 省掉整枝的矩阵运算开销。
    const q = (rx || ry || rz) ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ')) : null
    for (const f of frames) {
      // 半径下限 0.5mm: 与 growFrames 的防退化阈值一致, 保证蒙皮不会除零。
      f.radius = Math.max(0.0005, (f.radius || 0.0005) * radiusScale)
      if (q) {
        // 位置绕 pivot 旋转: p' = q·(p - pivot) + pivot; 方向只转不平移。
        f.pos.sub(pivot).applyQuaternion(q).add(pivot)
        if (f.dir) f.dir.applyQuaternion(q).normalize()
      }
      if (twist) {
        // 扭转量按 t 线性分配: 基部 0、梢部 1, 同时写进 roll 和 profileRoll,
        // 因为下游有分别只读其中一个的地方 (导丝/贴图偏移)。
        const k = Number.isFinite(f.t) ? f.t : 0
        f.roll = (f.roll || 0) + twist * k
        f.profileRoll = (f.profileRoll || 0) + twist * k
      }
      // 平移最后做, 保证上面的旋转支点不被本次平移影响。
      if (mx || my || mz) f.pos.set(f.pos.x + mx, f.pos.y + my, f.pos.z + mz)
    }
  }

  /**
   * 构建一根枝条: 生成骨架帧 -> 应用人工编辑 -> 登记骨架分支 -> 递归子枝/叶/果。
   *
   * 这是递归生长模型的实际执行体 (树干与树根不走这里, 它们各自有特殊处理)。
   * 调用顺序是硬约束: frames 必须在 addBarkBranch 之前算好并编辑完, 因为骨架一旦登记,
   * 子枝贴附、叶片位置、蒙皮窗口全部基于它; 之后再改就会与已登记的父子关系脱节。
   *
   * @param {Object} o 参数包
   * @param {number} o.level 枝级 (1..N)
   * @param {THREE.Vector3} o.startPos 枝条基部位置 (世界坐标, 米)
   * @param {THREE.Vector3} o.startDir 初始生长方向
   * @param {number} o.length 长度 (米)
   * @param {number} o.radius0 基部半径 (米)
   * @param {number} o.radius1 梢部半径 (米)
   * @param {Object} o.cfg 该层参数 (curve/gravity/segments/radialSegments/crossSection/...)
   * @param {Rng} o.rng 该枝专属随机子流
   * @param {number} o.wind0 基部风柔度 0..1
   * @param {number} o.wind1 梢部风柔度 0..1
   * @param {number} o.parentSlot 父枝节点 slot
   * @param {Object} o.parentBranch 父枝骨架分支
   * @param {number} [o.tipRound] 梢部圆钝程度 (0 = 平截面)
   * @param {number} [o.baseFlare] 基部领口强度 (分叉主枝可覆盖)
   * @param {number} [o.baseFlareLen] 领口长度占比
   */
  const buildBranch = (o) => {
    const { level, startPos, startDir, length, radius0, radius1, cfg, rng, wind0, wind1, parentSlot, parentBranch } = o
    // 骨架帧: 曲率/重力/扭转全部来自该层参数; gnarl 固定 0.18 —— 它是"枝干不应是数学完美曲线"
    // 的全局手感系数, 按层暴露给用户会与 curve/curveVariance 语义重叠, 因此不开放。
    const frames = growFrames(rng, {
      startPos,
      startDir,
      length,
      radius0,
      radius1,
      radiusCurve: cfg.radiusCurve || 1.2,
      segments: Math.max(2, Math.round(cfg.segments)),
      curve: cfg.curve || 0,
      curveVariance: cfg.curveVariance || 0,
      gravity: (cfg.gravity || 0) * (branchParams.gravityScale || 1) +
        (branchParams.phototropism || 0) + (cfg.upBias || 0),
      forceField,
      twist: cfg.twist || 0,
      twistProfile: cfg.twistProfile || (P.branches && P.branches.twistProfile),
      gnarl: 0.18,
      taperRatio: cfg.taper,
    })
    // 单枝编辑必须在 addBarkBranch 之前应用: 子枝 attach / 叶片 / 蒙皮窗口
    // 都从修改后的 frames 计算。
    // 分支下标 = 当前已登记的分支数 (树干/树根也是分支, 各占一个下标)。
    const branchIndex = barkSkeleton.branches.length
    applyBranchEdit(frames, branchIndex)
    // 每层取第一根枝条作为该层扭曲句柄的可视化引导线
    // (twistGuides 在树干之后声明, 但 buildBranch 只在树干建好后才被调用, 因此这里已初始化)
    if (level >= 1 && !twistGuides.branches[level]) twistGuides.branches[level] = sampleGuidePoints(frames)

    // 环向分段数受 LOD 的 barkDetail 缩放; 下限 3 —— 少于 3 条边的管子没有体积感。
    const radialSegments = Math.max(3, Math.round(cfg.radialSegments * ((P.lod && P.lod.barkDetail) || 1)))
    // 第 3 级及以上视为"嫩枝": 顶点色偏黄绿 (模拟幼枝的叶绿素), 更深层用中性灰白。
    const isYoung = level >= 3
    const colorBase = isYoung ? new THREE.Color(0.82, 0.94, 0.74) : new THREE.Color(0.88, 0.88, 0.86)
    const growSpan = LEVEL_GROW[Math.min(level, LEVEL_GROW.length - 1)]

    // 节点登记: meta 里存的是"可读摘要", 供节点树/属性面板显示; branchIndex 用于反查骨架分支。
    levelBranchCounter[level] = (levelBranchCounter[level] || 0) + 1
    const mySlot = addSlot({
      type: 'branch',
      level,
      group: `branch-L${level}`,
      name: `L${level} 枝 #${levelBranchCounter[level]}`,
      parent: parentSlot,
      meta: { length, radius: radius0, segments: Math.max(2, Math.round(cfg.segments)), branchIndex },
    })

    // 骨架先行: 这里只登记骨架分支 (节点/边/半径/父子关系)。
    // 树皮几何在全部生长结束后由 barkSkin 一次性生成 (分叉切孔桥接 + 端盖)。
    // 一体建模: 加大基部领口, 让枝条与树干/父枝更像连续长出来的一棵树
    const myBranch = addBarkBranch(barkSkeleton, {
      frames,
      parent: parentBranch === undefined ? null : parentBranch,
      slot: mySlot,
      type: 'branch',
      level,
      // render 里是"蒙皮阶段的参数": 横截面形状、顶点色、风、生长窗口等。
      // 这些不参与生长方向计算, 只影响 barkSkin/speedtreeBark 如何把这根骨架变成网格。
      render: {
        radialSegments,
        crossSection: cfg.crossSection || 'round',
        starDepth: cfg.starDepth || 0,
        color: colorBase,
        // color2 是"明暗端的第二种颜色", 与 color 做顶点级渐变; 留白 (1,1,1) 表示不额外染色。
        color2: new THREE.Color(1.0, 1.0, 1.0),
        colorVariance: 0.05,
        // 蒙皮纹理噪声用独立子流: 改纹理细节不会影响生长随机序列。
        rng: rng.fork('bark'),
        wind0,
        wind1,
        // 风曲线指数: >1 表示柔度沿枝条"靠后段才快速上升"(根部稳、梢部摆), 1.5 是枝条手感值。
        windCurve: 1.5,
        grow: growSpan,
        // 生长动画的收缩原点 = 枝条基部
        origin: frames[0].pos.clone(),
        phase: rng.range(0, Math.PI * 2),
        // 末梢圆钝收尖 (不是平截面)。
        // 基部领口不再靠"把子枝基部吹粗"来遮缝: 现在分叉是真实切孔 + 环桥接,
        // 过大的 baseFlare 会让子枝基部接近父枝粗度, 窗口过大、桥接变成大片斜鳍,
        // 视觉上就像树枝在基部被拉偏。保留 0 基准 (+ onePiece 极轻微领口)。
        tipRound: o.tipRound === undefined ? 0.06 : o.tipRound,
        // onePiece 时额外加 0.06 的极轻微领口 (见文件头 onePiece 说明)。
        baseFlare: (o.baseFlare === undefined ? 0 : o.baseFlare) + (onePiece ? 0.06 : 0),
        // 领口沿轴向的衰减长度 (占枝条长度的比例): L1 用 0.16, 更深层用 0.13,
        // 因为细枝上过长的领口会显得像"肿包"。
        baseFlareLen: (o.baseFlareLen === undefined ? (level === 1 ? 0.16 : 0.13) : o.baseFlareLen),
        // 顶点级噪声: 让管子表面不是完美光滑的旋转体, 5% 的径向扰动足以产生树皮质感。
        vertexNoise: 0.05,
      },
    })
    branchCount++

    // 递归顺序: 先长子枝 (建立父子关系), 再挂叶, 最后挂果 ——
    // 因为叶/果的节点父级是本枝, 而子枝的节点父级也是本枝, 顺序不影响 id 语义,
    // 但先长骨架可以让"叶子长在最终位置的枝条上"(子枝已把父枝撑开)。
    if (level < branchParams.levels) spawnChildren(frames, level, length, rng, wind0, wind1, mySlot, myBranch)
    const leafIdx = level - 1
    // 花朵独立: 树叶关闭时仍要跑 spawnLeaves 采集开花位置 (只是不写入叶片几何)
    if ((L.enabled || FL.enabled) && L.levels[leafIdx]) spawnLeaves(frames, level, wind1, mySlot)
    if (F.enabled && effFruitLevels[leafIdx]) spawnFruit(frames, level, wind1, mySlot)
  }

  /* ------------------------------------------------------------------ */
  /* 树干                                                                */
  /* ------------------------------------------------------------------ */
  const t = P.trunk
  // 树干专属随机子流: 树干形状只依赖 (seed, 'trunk'), 与枝叶参数完全隔离。
  const trunkRng = makeRng(P.seed, 'trunk')
  const trunkDir = new THREE.Vector3(0, 1, 0)
  if (t.lean) {
    // 倾斜: leanDirection 是"倾斜方位"(度, 绕 Y), lean 是倾斜量 (弧度)。
    // 先在水平面上取该方位的单位向量作旋转轴, 再把 +Y 绕它转 lean —— 得到倾斜的主干初始方向。
    const leanAxis = new THREE.Vector3(Math.cos(t.leanDirection * DEG), 0, Math.sin(t.leanDirection * DEG)).normalize()
    trunkDir.applyAxisAngle(leanAxis, t.lean)
  }

  // 节瘤: 固定位置的高斯凸起
  const knots = []
  // 节瘤形态参数: 强度/纵向跨度/角向跨度。默认比以前更收束, 避免节瘤在树干上
  // 形成一圈“箍” (原来的角向半宽 0.5~1.6 rad 太宽, 看起来像环而不是局部凸起)。
  // knotSpread 是纵向 (t 方向) 的高斯 σ; knotAngle 是角向的高斯 σ (弧度)。
  const knotStrength = t.knotStrength === undefined ? 0.75 : Math.max(0, Number(t.knotStrength) || 0)
  const knotSpread = t.knotSpread === undefined ? 0.05 : Math.max(0.002, Number(t.knotSpread) || 0.05)
  const knotAngle = t.knotAngle === undefined ? 0.7 : Math.max(0.05, Number(t.knotAngle) || 0.7)
  for (let i = 0; i < (t.knots || 0); i++) {
    // 位置与尺寸都用 trunkRng 一次性抽定: 同一 seed 下节瘤永远长在同一处。
    // size 再乘 0.5~1.5 的随机倍率, 避免所有瘤一样大。
    knots.push({
      t: trunkRng.range(0.05, 0.85),
      angle: trunkRng.range(0, Math.PI * 2),
      size: (t.knotSize || 0.3) * knotStrength * trunkRng.range(0.5, 1.5),
      spread: knotSpread * trunkRng.range(0.6, 1.4),
      aspread: knotAngle * trunkRng.range(0.6, 1.4),
    })
  }
  // 根部"板根/表层根"的方位分布: 真实树木基部不是圆锥, 而是 4~6 条放射状凸起
  // (每条的方位固定, 这样同一棵树每次生成都一样)
  const rootLobeCount = 5
  const rootLobePhase = trunkRng.range(0, Math.PI * 2)
  /**
   * 树干半径调制函数: 给定归一化高度 tt 与绕轴方位 angle, 返回半径的乘数。
   *
   * 三部分相乘:
   *   ① 基部整体外扩 flare: 1 + flare·(1-u)^2.6, 幂次 2.6 让底部"鼓"、往上弧形收进去
   *      (u = tt/flareHeight, 只在 flareHeight 以下生效);
   *   ② 放射状板根: 1 + 0.55·flare·(1-u)^2.2·lobe, lobe = cos(5·(angle-phase))^2.5,
   *      5 条沿周向的凸起, 幂次 2.5 让它窄而尖 (像板根而不是圆鼓包);
   *   ③ 每个节瘤: 1 + size·exp(-(dt²+da²)), 其中 dt/da 分别是纵向/角向的标准化距离,
   *      即二维高斯凸起。角向距离取最短弧长 (da>π 时取 2π-da), 否则接缝处会断。
   *
   * @param {number} tt 归一化高度 (0 = 地面, 1 = 树梢)
   * @param {number} angle 绕树干的方位角 (弧度)
   * @returns {number} 半径乘数 (>=0, 1 表示不调制)
   */
  const trunkRadiusMod = (tt, angle) => {
    let m = 1
    if (t.flare > 0 && t.flareHeight > 0 && tt < t.flareHeight) {
      const u = tt / t.flareHeight            // 0 = 地面, 1 = 扩展区顶部
      // 1) 整体扩张: 幂次 >2 让底部更"鼓"、往上是弧形收进去 (圆锥形太假)
      const baseFlare = 1 + t.flare * Math.pow(1 - u, 2.6)
      // 2) 放射状板根: 沿方位周期性加粗, 越靠近地面越明显
      const lobe = Math.pow(Math.max(0, Math.cos(rootLobeCount * (angle - rootLobePhase))), 2.5)
      const lobeAmp = t.flare * 0.55 * Math.pow(1 - u, 2.2)
      m *= baseFlare * (1 + lobeAmp * lobe)
    }
    // ③ 节瘤: 二维高斯凸起。dt 用纵向 σ 归一, daN 用角向 σ 归一,
    //    指数里是两者的平方和 —— 即"到瘤中心的标准化距离²", 于是等高线是椭圆。
    for (const k of knots) {
      const dt = (tt - k.t) / k.spread
      let da = Math.abs(angle - k.angle)
      // 角向距离取环面上的最短弧 (0..π), 否则 0/2π 接缝两侧会出现一道沟。
      if (da > Math.PI) da = Math.PI * 2 - da
      const daN = da / k.aspread
      m *= 1 + k.size * Math.exp(-(dt * dt + daN * daN))
    }
    return m
  }

  // 树干骨架: 基部半径 baseRadius, 梢部半径 = 基部 × taper, 下限 3mm (再细就不像树干)。
  const trunkR0 = t.baseRadius
  const trunkR1 = Math.max(0.003, t.baseRadius * t.taper)
  // 树干骨架: 从地面原点 (0,0,0) 起长, 长度即树高。
  // gravity 传 0 —— 树干的"直立/倾斜"由 lean 决定, 若再叠加重力会出现双重弯折。
  const trunkFramesAll = growFrames(trunkRng, {
    startPos: new THREE.Vector3(0, 0, 0),
    startDir: trunkDir,
    length: t.height,
    radius0: trunkR0,
    radius1: trunkR1,
    radiusCurve: t.radiusCurve,
    segments: Math.max(3, Math.round(t.segments)),
    curve: t.curve,
    curveVariance: t.curveVariance,
    gravity: 0,
    forceField,
    twist: t.twist,
    twistProfile: t.twistProfile,
    gnarl: t.gnarl,
    taperRatio: t.taper,
  })
  // 扭曲句柄用的引导线 (树干 + 每层代表枝的骨架采样)
  const twistGuides = { trunk: sampleGuidePoints(trunkFramesAll), branches: {} }

  // 分叉 (多主枝): 橡树这类乔木常在 1/3 高度处分成 2~4 条主枝
  // 关键: 主干**不截断** (截断会留一个可见的平截面), 而是继续向上当"主导枝";
  //       分叉点以上用 smoothstep 平滑变细 (载荷分给主枝), 主枝带"领口"从这里长出去。
  // forkT = 分叉高度的归一化位置 (0..1); trunkShrink = 分叉后主干保留的粗细比例
  // (0.62 表示主干在该高度以上收细到原来的 62%, 视觉上像把载荷分给了侧枝)。
  const forkCfg = t.fork || {}
  const forkOn = !!forkCfg.enabled && Math.round(forkCfg.count || 0) > 0
  const forkT = forkOn ? clamp01(forkCfg.height === undefined ? 0.34 : forkCfg.height) : 1
  const forkShrink = forkOn ? Math.max(0.2, Math.min(1, forkCfg.trunkShrink === undefined ? 0.62 : forkCfg.trunkShrink)) : 1
  const trunkFrames = trunkFramesAll
  const baseTrunkMod = trunkRadiusMod
  // 分叉处的主干收细: 在 [forkT-0.07, forkT+0.13] 的 0.2 窗口里用 smoothstep 从 1 过渡到
  // (1 - (1-forkShrink))。用平滑过渡而不是硬切, 是为了避免骨架半径突变导致蒙皮环带扭结。
  const trunkModifier = forkOn
    ? (tt, a, r) => {
        const u = Math.min(1, Math.max(0, (tt - (forkT - 0.07)) / 0.2))
        const s = u * u * (3 - 2 * u)
        return baseTrunkMod(tt, a, r) * (1 - (1 - forkShrink) * s)
      }
    : baseTrunkMod

  // 椭圆截面: squash = 横向/纵向 的比值。用 (1/√squash, √squash) 分配两个轴,
  // 使两轴乘积恒为 1 —— 即"压扁但不改变截面面积", 于是体积/风阻量级不变, 只是形状变扁。
  // 下限 0.2 防止压成一条线。
  const squash = Math.max(0.2, t.squash || 1)
  // 树干也是可编辑分支 (index 0)
  // 下标 0 是"树干固定占位": 树根与枝层都在它之后登记, 因此树干编辑永远对应 0。
  const trunkBranchIndex = barkSkeleton.branches.length
  applyBranchEdit(trunkFrames, trunkBranchIndex)
  // 树干实际截面 (含 flare/knots 与 squash): 子枝/树根的基部要贴在这个表面上
  // 椭圆两半轴: X 用 1/√squash、Z 用 √squash (面积不变, 见上方 squash 说明)。
  const trunkSquashX = 1 / Math.sqrt(squash)
  const trunkSquashZ = Math.sqrt(squash)
  const trunkSlot = addSlot({
    type: 'trunk',
    level: 0,
    group: 'trunk',
    name: '树干',
    parent: null,
    meta: { length: t.height * forkT, radius: trunkR0, segments: Math.max(3, Math.round(t.segments)), fork: forkOn ? Math.round(forkCfg.count) : 0, branchIndex: trunkBranchIndex },
  })
  // 树干: 登记为骨架根分支 (parent = null)。基部端盖在蒙皮阶段生成。
  const trunkBranch = addBarkBranch(barkSkeleton, {
    frames: trunkFrames,
    parent: null,
    slot: trunkSlot,
    type: 'trunk',
    level: 0,
    render: {
      // 树干横截面分段: 同样受 LOD barkDetail 缩放, 但至少 4 段 (树干是最显眼的部件)。
      radialSegments: Math.max(4, Math.round(t.radialSegments * ((P.lod && P.lod.barkDetail) || 1))),
      crossSection: 'round',
      squashX: trunkSquashX,
      squashZ: trunkSquashZ,
      color: new THREE.Color(0.84, 0.82, 0.8),
      color2: new THREE.Color(1.0, 1.0, 1.0),
      colorVariance: 0.06,
      // 树皮噪声独立子流: 改噪声参数不会挪动树干骨架。
      rng: trunkRng.fork('bark-noise'),
      // 风柔度: 树干基部几乎不动 (0.012), 到梢部才 0.2 —— 树干是整棵树的"刚性脊梁"。
      wind0: 0.012,
      wind1: 0.2,
      // 树干的风曲线指数 1.9 (>枝的 1.5): 前 90% 高度基本笔直, 只在近梢部明显弯曲。
      windCurve: 1.9,
      grow: LEVEL_GROW[0],
      origin: new THREE.Vector3(0, 0, 0),
      phase: trunkRng.range(0, Math.PI * 2),
      // 把 flare/knots/分叉收细统一挂成"半径调制器", 蒙皮时逐环调用。
      radiusModifier: trunkModifier,
      // 树干噪声比枝条低 (0.03 vs 0.05): 大树干上过强的噪声会显得像熔岩表面。
      vertexNoise: 0.03,
      tipRound: 0.05,
    },
  })
  branchCount++

  /* ------------------------------------------------------------------ */
  /* 树根                                                                */
  /* ------------------------------------------------------------------ */
  const R = P.roots
  if (R && R.enabled && R.count > 0) {
    // 树根专属子流: 根系数量/方位只依赖 (seed, 'roots')。
    const rootRng = makeRng(P.seed, 'roots')
    const rc = Math.max(1, Math.round(R.count))
    // 根系窗口错位: 两个粗根如果方位很接近, 又在同一高度开窗, 两个洞会挤在一起。
    // 按方位做贪心分层, 同一层里只放"角向不重叠"的根, 重叠的根分到更高的层。
    // rootTiers[i] 是第 i 层已放置的根 {az, width}; 最多 4 层 (第 3 层是兜底, 见下方 rootTier 循环)。
    const rootTiers = [[], [], [], []]
    // 每升高一层, 根的开口高度上移 0.075 (归一化树高) —— 约等于 0.075 × 树高 的垂直间距,
    // 足以让两个直径相近的开口在蒙皮后不互相吃到对方的环带。
    const rootStaggerGap = 0.075
    const rootHeightOffset = R.heightOffset === undefined ? 0 : Number(R.heightOffset) || 0
    const rootAutoStagger = R.autoStagger !== false
    for (let k = 0; k < rc; k++) {
      // 方位: 按序号均分整圈 (spread 可只铺 1/2 或 1/4 圈), 再 ±0.25 rad 抖动避免机械感。
      const u = (k + 0.5) / rc
      const az = u * Math.PI * 2 * (R.spread === undefined ? 1 : R.spread) + rootRng.range(-0.25, 0.25)
      // 俯仰: pitch 是"从竖直向下量"的夹角 (度), ±12° 抖动。所以 pitch=90° 时根完全水平。
      const pitch = (R.pitch + rootRng.signed() * 12) * DEG
      // 球面坐标转笛卡尔: x/z 用 sin(pitch) 摊开, y 用 cos(pitch) 保持向上分量。
      const dir = new THREE.Vector3(
        Math.cos(az) * Math.sin(pitch),
        Math.cos(pitch),
        Math.sin(az) * Math.sin(pitch),
      ).normalize()
      // 长度按树高比例; 半径按树干基部半径比例 (粗根), 再各自抖动。
      const length = Math.max(0.02, t.height * R.length * rootRng.vary(R.lengthVariance))
      const radius0 = Math.max(0.002, t.baseRadius * R.radiusRatio * rootRng.vary(0.3))
      const rootSlot = addSlot({
        type: 'root',
        level: 0,
        group: 'roots',
        name: `树根 #${k + 1}`,
        parent: trunkSlot,
        meta: { length, radius: radius0 },
      })
      // 树根基部落在"外扩后的真实树干表面"上, 且放在一个能完整容纳薄环带的
      // 高度 (太靠近 t=0 时环带会被 0 截断, 洞口很高而根环在底缘, 桥接拉成空腔)。
      const rootDirH = new THREE.Vector3(dir.x, 0, dir.z)
      if (rootDirH.lengthSq() < 1e-8) rootDirH.set(1, 0, 0)
      rootDirH.normalize()
      // 根的开口在树干上占据的归一化高度 ≈ 根直径 / 树高 (×1.15 留余量)。
      // 这就是"薄环带高度": 环带比它还低就会被 t=0 截断, 洞口底缘与根环错位。
      const rootEpsT = Math.min(0.12, Math.max(0.01, (radius0 * 1.15) / Math.max(1, t.height)))
      // 实际开口高度取薄环带的 2.4 倍 (并夹在 5%~20% 树高): 给桥接留出上下各一圈的余量。
      const rootBaseT = Math.min(0.2, Math.max(0.05, rootEpsT * 2.4))
      // 自动错位: 至少让相邻序号的根分到不同高度 (k%2), 再按角向冲突继续加层。
      let rootTier = rootAutoStagger && rc > 1 ? (k % 2) : 0
      if (rootAutoStagger) {
        // 根窗口的角向宽度 (粗根接近半圆, 用 asin 估算)
        const rootWidth = 2 * Math.asin(Math.min(0.95, radius0 / Math.max(0.05, t.baseRadius)))
        for (; rootTier < 3; rootTier++) {
          const conflict = rootTiers[rootTier].some((q) => {
            let da = Math.abs(q.az - az)
            da = Math.min(da, Math.PI * 2 - da)
            return da < (q.width + rootWidth) * 0.55 + 0.06
          })
          if (!conflict) break
        }
        rootTier = Math.min(rootTier, 3)
        rootTiers[rootTier].push({ az, width: rootWidth })
      }
      // 开口高度 = 基准 + 层偏移 + 用户偏移 + 微抖动, 上限 35% 树高 (再高就不像根了)。
      const rootT = Math.min(0.35, Math.max(0.02,
        rootBaseT + rootTier * rootStaggerGap + rootHeightOffset + rootRng.range(-0.008, 0.008)))
      const rootFrame = sampleFrame(trunkFrames, rootT)
      // 树根也跟随主干的扭转
      rootDirH.applyAxisAngle(rootFrame.dir, rootFrame.roll || 0)
      // 与子枝同理: 用父枝(树干)的真实表面而不是骨架半径, 否则根会埋在 flare 里。
      const rootBasis = frameBasisAt(trunkFrames, rootT)
      const rootAz = Math.atan2(rootDirH.dot(rootBasis.up), rootDirH.dot(rootBasis.side))
      const rootMod = trunkModifier(rootT, rootAz, rootFrame.radius)
      const rootProj = Math.hypot(Math.cos(rootAz) * trunkSquashX, Math.sin(rootAz) * trunkSquashZ)
      // ×0.99 让根部稍微压进表面 (保证与树干相交, 蒙皮时才能切出完整的洞口)。
      const rootSurfaceR = Math.max(rootFrame.radius, rootFrame.radius * rootMod * rootProj) * 0.99
      const frames = growFrames(rootRng, {
        startPos: rootFrame.pos.clone().addScaledVector(rootDirH, rootSurfaceR),
        startDir: dir,
        length,
        radius0,
        // 根部收细比 0.16 (比枝条的 0.2 更快收尖): 真实粗根是"快速分叉变细"的。
        radius1: radius0 * 0.16,
        radiusCurve: 1.2,
        segments: Math.max(2, Math.round(R.segments)),
        curve: R.curve,
        // 根的弯曲方差 0.4 明显大于枝条默认值: 根系要显得比枝干更"乱"。
        curveVariance: 0.4,
        // 负重力 = 往下扎 (sink 越大越往下钻), 这正是树根的形态特征。
        gravity: -R.sink,
        twist: 0.15,
        // 不规则度 0.5: 根在地表附近会左右扭动, 比枝条更明显。
        gnarl: 0.5,
        taperRatio: 0.16,
      })
      // 树根也是骨架分支 (父分支 = 树干), 基部由蒙皮阶段切孔桥接, 梢部端盖
      const rootBranchIndex = barkSkeleton.branches.length
      applyBranchEdit(frames, rootBranchIndex)
      addBarkBranch(barkSkeleton, {
        frames,
        parent: trunkBranch,
        slot: rootSlot,
        type: 'root',
        level: 0,
        render: {
          radialSegments: Math.max(3, Math.round(R.radialSegments * ((P.lod && P.lod.barkDetail) || 1))),
          color: new THREE.Color(0.78, 0.75, 0.72),
          color2: new THREE.Color(0.92, 0.9, 0.88),
          colorVariance: 0.08,
          rng: rootRng.fork('bark'),
          // 根几乎不动: 基部 0、梢部 0.04, 只保留极轻微的地表震动感。
          wind0: 0.0,
          wind1: 0.04,
          windCurve: 1.2,
          // 生长动画: 根在整段动画的 0~18% 就长完 (最先出现, 像"扎根"再长树)。
          grow: [0, 0.18],
          // 收缩原点贴近地面 (稍抬高 2cm, 避免与地面 z-fighting)
          origin: new THREE.Vector3(dir.x * t.baseRadius * 0.4, 0.02, dir.z * t.baseRadius * 0.4),
          phase: rootRng.range(0, Math.PI * 2),
          baseFlare: onePiece ? 0.06 : 0,
          baseFlareLen: 0.1,
          // 根的顶点噪声比枝干高 (0.07): 泥土/树皮交界的粗糙感更强。
          vertexNoise: 0.07,
          tipRound: 0.06,
        },
      })
      slots[rootSlot].meta.branchIndex = rootBranchIndex
      branchCount++
    }
  }

  /* ------------------------------------------------------------------ */
  /* 果实 (橡果等): 并进树皮几何 -> 共用树皮材质, 顶点色区分坚果/壳斗帽     */
  /* ------------------------------------------------------------------ */
  /**
   * 在一根枝条上挂果实 (橡果等)。
   *
   * 分布: 只取枝条的 35%~100% 段 (基部太粗、且会被桥接窗口占用), 每个取样点成一簇,
   * 簇内沿"枝长参数"而非世界坐标散开 —— 这样无论枝条怎么弯曲, 果实都贴在枝条表面。
   * 果实几何并进树皮几何 (共用树皮材质), 靠顶点色区分坚果/壳斗帽。
   * 副作用: 惰性登记 fruit 节点; 记录挂果点/朝向证据供自检。
   *
   * @param {Array<Object>} frames 枝条骨架帧
   * @param {number} level 枝级 (决定生长区间)
   * @param {number} branchWind 该枝风柔度 (果实 +0.05)
   * @param {number} parentSlot 该枝条节点 slot
   */
  const spawnFruit = (frames, level, branchWind, parentSlot) => {
    const rng = fruitRng
    // 每枝的挂果点数 / 每簇果实数 (都至少 1, 保证开启后能看见)
    const count = Math.max(1, Math.round(F.perBranch))
    const per = Math.max(1, Math.round(F.clusterCount))
    const fruitTpl = buildFruitTemplate({
      type: F.type,
      color: F.color,
      capColor: F.capColor,
      radial: F.radial,
    })
    // 模板的 +Y 上端就是果柄末端 -> 让它正好落在枝条表面
    // top 是模板里"果柄末端到原点"的距离 (米, 未缩放), 后面要乘 scale 才是真实长度。
    const stemHalf = fruitTpl.top
    // 枝条总长: 用来把"簇内偏移"换算成曲线参数, 免得偏移到枝条外面去
    // (注意用首尾帧的直线距离而不是弧长累加 —— 这里只需要一个量级正确的换算尺。)
    const branchLen = Math.max(0.01, frames[frames.length - 1].pos.distanceTo(frames[0].pos))
    let fruitSlot = -1
    for (let k = 0; k < count; k++) {
      // 只挂在枝条的 35%~100% 段: 基部被分叉窗口占用, 且太靠近树干会把果实埋进桥接区。
      const tt = 0.35 + 0.65 * ((k + 0.5) / count) + rng.signed() * 0.06
      const fr0 = sampleFrame(frames, Math.min(0.98, Math.max(0.05, tt)))
      if (!fr0) continue
      for (let j = 0; j < per; j++) {
        // 同簇果实沿**枝长参数**散开 (不是在世界坐标里平移) -> 永远贴在枝条表面上
        // 簇内偏移: 换算成枝长参数后**上限 6%** —— 短枝上也不会把同簇果实甩到枝条两端
        // 公式: 世界偏移量 clusterRadius (米) ×1.2 ÷ 枝长 (米) = 归一化 t 的偏移。
        const dT = Math.max(-0.06, Math.min(0.06, (rng.range(-F.clusterRadius, F.clusterRadius) * 1.2) / branchLen))
        const t = Math.min(0.995, Math.max(0.02, tt + dT))
        const fr = sampleFrame(frames, t)
        if (!fr) continue
        // 挂果方位: 绕枝轴随机, 以"枝条下表面"为主; 跟随扭曲曲线旋转
        // 先取 π 作为"另一侧"的基准方位, 再 ±0.9 rad; 加 profileRoll 让果簇跟着枝条扭转。
        const az = Math.PI + rng.range(-0.9, 0.9) + (fr.profileRoll || 0)
        const radial = azimuthPerp(fr.dir, az, new THREE.Vector3())
        if (radial.dot(UP) > 0) radial.negate()      // 指向下方 = 枝条下表面
        // 表面点: 沿径向偏移 0.9×半径 (略微压进树皮, 防止果柄悬空); 下限 4mm 防止零半径枝条。
        const surface = fr.pos.clone().addScaledVector(radial, Math.max(0.004, fr.radius) * 0.9)
        const scale = Math.max(0.01, F.size * rng.vary(F.sizeVariance))
        // 纵向拉伸 1.25: 橡果这类果实通常比宽略高, 纯等比会显得像珠子。
        const scaleY = scale * 1.25
        // 果柄方向: 从果实指向枝条 (主要朝上, 略沿枝轴) -> 果实自然垂在枝下
        // droop 越大, 果柄越贴向枝条走向 (斜挂), ×0.35 是避免完全贴平的系数。
        const stemDir = UP.clone().lerp(fr.dir, F.droop * 0.35 * rng.range(0.5, 1.3)).normalize()
        // 果柄末端贴着枝条表面 -> 果实中心 = 表面点 - 果柄方向 × 果柄长度
        // ×0.92 让果柄稍微插进枝条, 避免接缝处出现缝隙。
        const pos = surface.clone().addScaledVector(stemDir, -stemHalf * scaleY * 0.92)
        // 预算控制: 超过 maxCount 直接跳过 (默认 420 个); chance 是概率抽稀 (默认 0.5)。
        // 第一个果实不受 chance 影响 (fruitCount > 0 才抽), 避免小概率下整枝空果。
        if (fruitCount >= Math.max(0, Math.round(F.maxCount === undefined ? 420 : F.maxCount))) continue
        if (fruitCount > 0 && !rng.chance(F.chance === undefined ? 0.5 : F.chance)) continue
        // 惰性登记果实节点 (整个枝条的果实共用一个节点)
        if (fruitSlot < 0) {
          levelFruitCounter[level] = (levelFruitCounter[level] || 0) + 1
          fruitSlot = addSlot({
            type: 'fruit',
            level,
            group: `fruit-L${level}`,
            name: `L${level} 果实簇 #${levelFruitCounter[level]}`,
            parent: parentSlot,
            meta: { fruit: 0, type: F.type },
          })
        }
        // 颜色抖动: 每个果实整体乘一个 0.2..1 区间的亮度系数, 避免同簇果实颜色完全一致。
        const tint = new THREE.Color(1, 1, 1).multiplyScalar(Math.max(0.2, 1 + rng.signed() * F.colorVariance))
        // 实例化: pos 是果实中心, dir 是果柄方向 (+Y 对齐到它), roll 让果实绕自身轴随机转。
        // grow 取该层生长区间的末端 +0.06 —— 果实比枝条晚一点点出现, 像"先有枝再结果"。
        pushFruitInstance(fruitAcc, fruitTpl, {
          pos,
          dir: stemDir,
          roll: rng.range(0, Math.PI * 2),
          scale: new THREE.Vector3(scale, scaleY, scale),
          colorTint: tint,
          wind: Math.min(1, branchWind + 0.05),
          phase: rng.range(0, Math.PI * 2),
          grow: Math.min(1, LEVEL_GROW[Math.min(level, LEVEL_GROW.length - 1)][1] + 0.06),
          origin: surface.clone(),
          nodeId: fruitSlot,
        })
        // 记录挂果点 + 朝向证据 (自检用来验证"真的挂在枝条上"且"没有挂反")
        // fruitOrient 两项分别是: 果柄末端到挂果点的距离 (应≈0)、坚果底到挂果点的距离 (应≈果实长度)。
        fruitAttach.push([surface.x, surface.y, surface.z])
        fruitOrient.push([
          Math.abs(fruitTpl.top * scaleY * 0.08) + pos.clone().addScaledVector(stemDir, fruitTpl.top * scaleY).distanceTo(surface),
          pos.clone().addScaledVector(stemDir, fruitTpl.bottom * scaleY).distanceTo(surface),
        ])
        fruitCount++
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 树枝                                                                */
  /* ------------------------------------------------------------------ */
  // 主干上的第一级枝条: 一直长到梢部 (主干不再截断)
  // 传入"真实树干表面"(含 flare/knots), 让贴主干生长的枝条基部不会埋在外扩内部。
  // wind0/wind1 取树干的风柔度 (0.012 -> 0.2): L1 枝条的风属性从树干表面值起步,
  // 保证"树干不动、枝条开始摆"在视觉上是连续的。
  // clampEndT 传 null = 不在分布上额外截断 (L1 可以一路长到树梢)。
  spawnChildren(trunkFrames, 0, t.height, trunkRng, 0.012, 0.2, trunkSlot, trunkBranch, null, {
    frames: trunkFrames,
    modifier: trunkModifier,
    squashX: trunkSquashX,
    squashZ: trunkSquashZ,
  })

  // 分叉主枝: 从主干内部伸出, 带领口融合; 主干自身继续向上作为主导枝
  if (forkOn) {
    // 分叉主枝继承 L1 的其余参数 (横截面/每枝数量等), 只覆盖"更粗更直"的那几项。
    const base1 = branchParams.level[0] || {}
    const fr = sampleFrame(trunkFramesAll, forkT)
    if (fr) {
      const rng = trunkRng.fork('fork-leaders')
      // count 里含"主干自己"这一条: 所以真正额外分出的主枝数是 count-1 (最多 6)。
      const n = Math.max(1, Math.min(6, Math.round(forkCfg.count) - 1))
      // angle = 主枝与主干轴的夹角 (默认 27°); spread = 方位分布宽度 (单位是弧度, 默认 0.85);
      // radiusScale = 主枝基部半径 / 该处主干半径 (0.66); lengthScale 用来微调整体长度。
      const angle = (forkCfg.angle === undefined ? 27 : forkCfg.angle) * DEG
      const spread = forkCfg.spread === undefined ? 0.85 : forkCfg.spread
      const radiusScale = forkCfg.radiusScale === undefined ? 0.66 : forkCfg.radiusScale
      const lengthScale = forkCfg.lengthScale === undefined ? 1.0 : forkCfg.lengthScale
      // 主枝参数 = L1 参数, 但曲率更小、更向上 (fork 主枝是"直立的主干分叉", 不是侧枝)。
      // upBias 0.1 额外朝上抬, 避免分叉后主枝横着长、树冠变成平顶。
      const leaderCfg = {
        ...base1,
        taper: forkCfg.taper === undefined ? 0.3 : forkCfg.taper,
        curve: forkCfg.curve === undefined ? 0.45 : forkCfg.curve,
        curveVariance: 0.55,
        gravity: forkCfg.gravity === undefined ? 0.03 : forkCfg.gravity,
        upBias: 0.1,
        segments: Math.max(5, Math.round((base1.segments || 8) * 0.9)),
      }
      // 记录已有 L1 枝在主干上的高度, 分叉主枝尽量避开它们的窗口高度。
      /**
       * 把一个世界坐标点投影到主干骨架上, 返回其归一化弧长位置 t。
       *
       * 逐个线段做"点到线段的最近点"求解 (投影参数 u 夹在 0..1), 取距离最小的那一段,
       * 再用 (i + u) / (段数) 折算成 t。用于把"已有枝条的基部位置"换算成高度坐标,
       * 从而判断分叉主枝该在哪个高度错开。
       *
       * @param {THREE.Vector3} p 世界坐标点
       * @returns {number} 主干上的归一化位置 0..1
       */
      const projectTOnTrunk = (p) => {
        let best = 0, bestD = Infinity
        for (let i = 0; i < trunkFramesAll.length - 1; i++) {
          const a = trunkFramesAll[i].pos
          const b = trunkFramesAll[i + 1].pos
          const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
          const den = abx * abx + aby * aby + abz * abz || 1
          let u = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / den
          u = Math.max(0, Math.min(1, u))
          const qx = a.x + abx * u, qy = a.y + aby * u, qz = a.z + abz * u
          const d = (p.x - qx) ** 2 + (p.y - qy) ** 2 + (p.z - qz) ** 2
          if (d < bestD) { bestD = d; best = (i + u) / (trunkFramesAll.length - 1) }
        }
        return best
      }
      // 已有 L1 枝的"占位"列表: {t: 主干上的高度, r: 该处半径}。
      // parent === 0 表示父分支是下标 0 的树干骨架 (barkSkeleton.branches[0])。
      const occupiedT = barkSkeleton.branches
        .filter((b) => b.type === 'branch' && b.parent === 0)
        .map((b) => ({ t: projectTOnTrunk(b.frames[0].pos), r: b.frames[0].radius }))
      // 主干总弧长 (米): 把"两个洞需要的间距(米)"换算成归一化 t 的间距。
      let trunkLen = 0
      for (let i = 1; i < trunkFramesAll.length; i++) trunkLen += trunkFramesAll[i].pos.distanceTo(trunkFramesAll[i - 1].pos)
      trunkLen = Math.max(1e-3, trunkLen)
      for (let k = 0; k < n; k++) {
        // 分叉主枝错开一点高度: 多条主枝如果都从 forkT 同一圈长出来,
        // 粗主枝的两个窗口会挤在主干同一处。这里给它们 ± 少量 t 偏移,
        // 并避开已有 L1 枝的高度; 窗口随各自基部走, 仍然对中。
        // (k-(n-1)/2) 让偏移围绕 0 对称分布, 步长 0.05 归一化树高。
        const nominalT = forkT + (k - (n - 1) / 2) * 0.05 + rng.range(-0.004, 0.004)
        let leaderT = Math.min(0.98, Math.max(0.02, nominalT))
        let bestClear = -Infinity
        const leaderR = Math.max(0.002, fr.radius * radiusScale)
        // 在 nominalT 附近按 ±0.03/0.06/.../0.21 的候选偏移找一个"离已有窗口最远"的高度。
        // 判据: 两洞中心距 - 需要的间距; 需要的间距 ≈ (r1+r2)×1.15 / 主干弧长, 再加 0.012 的
        // 归一化安全余量 (1.2% 树高) —— 留出桥接环带的宽度。
        for (const off of [0, 0.03, -0.03, 0.06, -0.06, 0.09, -0.09, 0.12, -0.12, 0.15, -0.15, 0.18, -0.18, 0.21, -0.21]) {
          const cand = Math.min(0.98, Math.max(0.02, nominalT + off))
          let clear = Infinity
          for (const q of occupiedT) {
            const need = ((leaderR + q.r) * 1.15) / trunkLen + 0.012
            clear = Math.min(clear, Math.abs(cand - q.t) - need)
          }
          if (clear > bestClear) { bestClear = clear; leaderT = cand }
        }
        // 把选中的高度登记进占位表, 后续主枝会继续避开它。
        occupiedT.push({ t: leaderT, r: leaderR })
        const lf = sampleFrame(trunkFramesAll, leaderT) || fr
        // 方位: 均分整圈 + ±0.5·spread 抖动 (spread 默认 0.85, 即最大 ±0.425 rad)
        const az = ((k + 0.5) / n) * Math.PI * 2 + rng.range(-0.5, 0.5) * spread
        const side = azimuthPerp(lf.dir, az, new THREE.Vector3())
        // 以 side 为轴把主干方向压开 angle 度 (×0.8~1.25 抖动), 得到主枝初始方向;
        // 再强制抬 0.06 rad, 让主枝整体偏上。
        const dir = lf.dir.clone().applyAxisAngle(side, angle * rng.range(0.8, 1.25))
        rotateTowardUp(dir, 0.06)
        // 分叉主枝也要跟随主干的扭转 (基础 twist + 扭曲曲线)
        if (lf.roll) dir.applyAxisAngle(lf.dir, lf.roll)
        const r0 = Math.max(0.002, lf.radius * radiusScale * rng.vary(0.1))
        // 分叉主枝: 基部也要落在主干"真实表面"上 (含 forkShrink/squash/flare)。
        // 旧实现沿 dir 偏移 0.45R, 主枝环会深埋在主干内部, 桥接后洞口露出空腔,
        // 且与生长方向不对齐 (看起来像主枝插进树干再从里面穿出来)。
        const radialDir = dir.clone().addScaledVector(lf.dir, -dir.dot(lf.dir))
        // 退化兜底: 主枝方向几乎与主干平行时, 用方位基向量 side 当径向方向。
        if (radialDir.lengthSq() < 1e-10) radialDir.copy(side)
        radialDir.normalize()
        // 转到主干环坐标系求方位, 再用 trunkModifier (含 forkShrink 与 flare/knots) 求表面半径。
        const lb = frameBasisAt(trunkFramesAll, leaderT)
        const la = Math.atan2(radialDir.dot(lb.up), radialDir.dot(lb.side))
        const lmod = trunkModifier(leaderT, la, lb.frame.radius)
        const lproj = Math.hypot(Math.cos(la) * trunkSquashX, Math.sin(la) * trunkSquashZ)
        // ×0.95 略微内收: 保证主枝基部与主干表面相交, 蒙皮才能切出干净洞口。
        const lr = Math.max(lf.radius, lb.frame.radius * lmod * lproj) * 0.95
        const startPos = lf.pos.clone().addScaledVector(radialDir, lr)
        // 主枝长度 = 分叉点以上剩余的树干高度 × lengthScale (分叉后由主枝接手往上长) × 抖动。
        buildBranch({
          level: 1,
          startPos,
          startDir: dir,
          length: Math.max(0.05, t.height * (1 - forkT) * lengthScale * rng.vary(0.16)),
          radius0: r0,
          radius1: Math.max(0.0008, r0 * leaderCfg.taper),
          cfg: leaderCfg,
          rng,
          // 风柔度从主干梢部的 0.2 起步, 再按该层的 windGain 增加。
          wind0: 0.2,
          wind1: Math.min(1, 0.2 + 0.3 * (base1.windGain === undefined ? 1 : base1.windGain)),
          parentSlot: trunkSlot,
          parentBranch: trunkBranch,
          // 分叉主枝不额外加基部领口 (它的"领口"由主干的 forkShrink 收细提供),
          // 但保留稍长的领口长度 0.2, 让桥接过渡更缓。
          baseFlare: 0,
          baseFlareLen: 0.2,
        })
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 蒙皮 + 节点表                                                        */
  /* ------------------------------------------------------------------ */
  // 骨架图已完成 (含父子关系/贴合点) -> 一次性生成整张 2-manifold 树皮蒙皮。
  // 分叉在父环带上真实切孔并桥接, 树干基部与所有枝梢端盖封闭;
  // 不丢弃任何骨架分支, 不做最大连通过滤, 不用 SDF, 不逐枝建管再合并。
  finalizeBarkSkeleton(barkSkeleton)
  // 蒙皮前逐级约束子枝半径: 任意子枝基部半径 <= 父枝贴合处半径的 80%。
  // 父分支先于子分支处理, L1 收细后 L2/L3 会继续按新的父半径约束。
  // 0.8 是经验上限: 再大子枝开口会接近父枝周长的一半, 桥接环带被拉成"斜鳍";
  // 再小则粗枝被压细, 树干上出现"突然收腰"的假感。
  const radiusClamp = enforceChildBranchRadii(barkSkeleton, 0.8)
  // 两条蒙皮管线可选: 'skin'(默认, 分叉切孔+环桥接的 2-manifold 蒙皮) 或
  // 'speedtree'(SpeedTree 式的逐枝管体, 视觉更"工业", 但拓扑不同)。UI 上可切换对比。
  const skinMode = P.bark && P.bark.pipeline === 'speedtree' ? 'speedtree' : 'skin'
  const skin = skinMode === 'speedtree'
    ? buildSpeedtreeBark(barkSkeleton, {
      barkDetail: (P.lod && P.lod.barkDetail) || 1,
      validate: options.validate !== false,
    })
    : buildBarkSkin(barkSkeleton, {
      barkDetail: (P.lod && P.lod.barkDetail) || 1,
      validate: options.validate !== false,
    })
  // 把半径约束的统计挂进蒙皮统计, 便于自检/调试面板查看"压细了多少根枝"。
  skin.stats.radiusClamp = radiusClamp
  let barkGeometry = skin.geometry
  // 果实并进树皮几何 (共用树皮材质); 失败时 (null) 丢弃果实几何并保留树皮。
  if (fruitAcc.vertexCount > 0) {
    const fruitGeo = fruitAcc.build()
    // 第二个参数 false = 不生成 groups: 整块树皮+果实共用同一个材质槽 (一件材质画完)。
    const combined = mergeGeometries([barkGeometry, fruitGeo], false)
    if (combined) {
      // 保留 UV 接缝顶点对 (拓扑校验/导出检查要用), mergeGeometries 不会自动带过来
      combined.userData = { ...barkGeometry.userData }
      combined.computeBoundingBox()
      combined.computeBoundingSphere()
      // 合并后原来的两个几何体不再被引用, 立即释放 GPU 侧缓冲。
      barkGeometry.dispose()
      fruitGeo.dispose()
      barkGeometry = combined
    } else {
      // 合并失败 (属性布局不一致等): 只丢弃果实, 保住树皮主几何。
      fruitGeo.dispose()
    }
  }
  const leafGeometry = leafAcc.vertexCount > 0 ? leafAcc.build() : null

  /* ---- 花朵: 用花朵自己的设置独立采样 (层级/每枝数量/每簇数/分布起止/朝向) ---- */
  // 为什么放在蒙皮之后单独跑: 花朵参数与树叶完全独立, 且要复用"已长完的枝条帧"。
  // 生成阶段只记录 flowerBranches (哪些枝可以开花), 这里再用 flowers 子流重新采样一遍位置,
  // 因此调花的参数不会影响叶子/骨架 (随机流隔离)。
  let flowerGeometry = null
  let flowerCount = 0
  if (flowerAcc && flowerBranches.length && FL.enabled) {
    const fTpls = [makeFlowerTemplate()]
    // 整棵树的全部花朵共用一个节点 (与"每枝一个叶簇节点"不同: 花朵通常只需整体显隐)。
    const flowerSlot = addSlot({
      type: 'flowers', level: FL.level || 3, group: 'flowers', name: '花朵',
      parent: trunkSlot, meta: { leaves: 0, clusters: 0 },
    })
    // 尺寸默认值: 花径 0.42m、宽高比 1、大小方差 0.2
    const fSize = FL.size === undefined ? 0.42 : FL.size
    const fWidth = FL.width === undefined ? 1 : FL.width
    const sizeVar = FL.sizeVariance === undefined ? 0.2 : FL.sizeVariance
    const c0 = new THREE.Color(FL.color || '#f2a7c3')
    const c1 = new THREE.Color(FL.colorTip || '#fbe3ec')
    const levelsOn = Array.isArray(FL.levels) ? FL.levels : null
    // 每枝花朵数 / 每簇花朵数 (每簇最多 12, 再多在视觉上只是重叠, 纯浪费顶点)
    const perBranch = Math.max(1, Math.round(FL.perBranch === undefined ? 4 : FL.perBranch))
    const perCluster = Math.max(1, Math.min(12, Math.round(FL.clusterCount === undefined ? 2 : FL.clusterCount)))
    // 分布区间 (自动纠正反填) + 密度 (0.02..1, 作为逐点抽取概率)
    const tA = Math.min(FL.startT === undefined ? 0.2 : FL.startT, FL.endT === undefined ? 1 : FL.endT)
    const tB = Math.max(FL.startT === undefined ? 0.2 : FL.startT, FL.endT === undefined ? 1 : FL.endT)
    const density = Math.max(0.02, Math.min(1, FL.density === undefined ? 1 : FL.density))
    // 簇半径 = clusterRadius × clusterSpread
    const clusterR = (FL.clusterRadius === undefined ? 0.16 : FL.clusterRadius) * (FL.clusterSpread === undefined ? 1 : FL.clusterSpread)
    // 俯仰与其方差在参数里是度, 这里统一转弧度
    const pitchRad = ((FL.pitch === undefined ? 55 : FL.pitch) * Math.PI) / 180
    const pitchVar = ((FL.pitchVariance === undefined ? 20 : FL.pitchVariance) * Math.PI) / 180
    const rollVar = FL.rollVariance === undefined ? 0.6 : FL.rollVariance
    const droopAmt = FL.droop === undefined ? 0 : FL.droop
    const upVec = new THREE.Vector3(0, 1, 0)
    // 花朵专属随机子流: 调花不会挪动叶/枝。
    const fRng = makeRng(P.seed, 'flowers')
    for (const br of flowerBranches) {
      // 层级过滤: levelsOn 是"每级是否开花"的布尔数组; 父枝层级可能超过数组长度, 需夹取。
      const lvIdx = Math.max(0, Math.min((levelsOn ? levelsOn.length : 5) - 1, (br.level || 1) - 1))
      if (levelsOn && levelsOn[lvIdx] === false) continue
      // 逐枝条参数副本: 目前恒等于全局值, 保留这层间接是为了将来支持"每枝覆盖"而不改调用点。
      const entryPer = perBranch
      const entryTA = tA
      const entryTB = tB
      for (let i = 0; i < entryPer; i++) {
        // 密度用概率抽样直接跳过整点 (不消耗后续位置随机, 保证调密度只改数量不改位置)
        if (!fRng.chance(density)) continue
        const u = (i + 0.5) / entryPer
        let tt = entryTA + (entryTB - entryTA) * u + fRng.signed() * 0.04
        tt = Math.min(0.999, Math.max(0.01, tt))
        const fr = sampleFrame(br.frames, tt)
        if (!fr) continue
        const dir = fr.dir.clone()
        const perp = anyPerp(dir)
        // 方位步进: branchWrap 时把 N 圈均分到该枝的花数, 否则用固定 137.5° 叶序角;
        // 再加整圈随机偏移与该处扭曲角 (花簇跟着枝条扭转)。
        const azimuthBase = i * (FL.branchWrap
          ? (Math.max(0.1, Number(FL.branchWrapTurns) || 2) * Math.PI * 2) / entryPer
          : 137.5 * DEG) + fRng.range(0, Math.PI * 2) + (fr.profileRoll || 0)
        for (let c = 0; c < perCluster; c++) {
          const tpl = fTpls[Math.floor(fRng.next() * fTpls.length) % fTpls.length]
          // 颜色抖动: 每朵花乘一个 ±16% 的亮度系数 (只乘 0.3 的幅度, 比叶片更克制)
          const jitter = 1 + fRng.signed() * (FL.colorVariance === undefined ? 0.16 : FL.colorVariance) * 0.3
          const sv = fSize * (1 + fRng.signed() * sizeVar)
          // 花瓣是"卡片", 宽高比单独用 fWidth 控制; y 是花轴方向 (花的长轴)
          const scale = new THREE.Vector3(sv * fWidth, sv, sv * fWidth)
          // 位置: 枝条表面 + 簇内散布
          // 簇内方位均分 2π (c/perCluster), radial 由"径向基向量 cos + 切向基向量 sin"合成,
          // 得到垂直于枝轴平面内的一个圆; ×range(0.2,1) 让花在圆内随机取半径 (避免整齐的环)。
          const az = azimuthBase + (c / perCluster) * Math.PI * 2
          const radial = perp.clone().multiplyScalar(Math.cos(az)).add(new THREE.Vector3().crossVectors(dir, perp).multiplyScalar(Math.sin(az)))
          const pos = fr.pos.clone().add(radial.multiplyScalar(clusterR * fRng.range(0.2, 1)))
          // 朝向: 花轴 = 枝条方向 -> faceUp 朝上 -> 加俯仰 -> 下垂 -> 自转
          // by 从枝轴插值向 +Y (0.45): 花朝向"外上方", 比完全朝上更自然。
          const by = dir.clone()
          if (FL.faceUp !== false) by.lerp(upVec, 0.45).normalize()
          const pitch = pitchRad + fRng.signed() * pitchVar
          // 在 (bx, bz) 平面内把 by 俯仰 pitch 弧度: 等价于绕 bx 旋转。
          const bx = perp.clone()
          // 环绕生长: 让花的朝向也绕枝轴转 (而不只是位置偏移)。
          // 簇半径默认 0 时位置偏移会退化为 0, 这一步保证"环绕"仍然可见。
          if (FL.branchWrap) bx.applyAxisAngle(dir, az)
          const bz = new THREE.Vector3().crossVectors(bx, by).normalize()
          const byRot = by.clone().multiplyScalar(Math.sin(pitch)).add(bz.clone().multiplyScalar(Math.cos(pitch))).normalize()
          // 下垂: 沿 -Y 拉一点, ×0.4 是幅度系数 (droop 参数本身的 40%)
          if (droopAmt) byRot.add(upVec.clone().multiplyScalar(-droopAmt * 0.4)).normalize()
          // 自转: 固定 twist (弧度) + ±rollVar 随机, 让花面绕花轴转开
          const spin = (FL.twist || 0) + fRng.signed() * rollVar
          const bxRot = bx.clone().applyAxisAngle(byRot, spin)
          const bzRot = new THREE.Vector3().crossVectors(bxRot, byRot).normalize()
          // 花朵模型旋转: 绕花面法线转整张花卡
          const flowerModelRot = (FL.modelRotation || 0) * DEG
          if (flowerModelRot) {
            bxRot.applyAxisAngle(bzRot, flowerModelRot)
            byRot.applyAxisAngle(bzRot, flowerModelRot)
          }
          const v0 = flowerAcc.vertexCount
          // 与叶片实例化同一套接口: 三轴基 {x,y,z} + scale 把模板贴到世界坐标。
          // 生长区间固定为 [0.5, 1]: 花朵总在动画后半程才开, 与"先长枝后开花"一致。
          pushLeafInstance(
            flowerAcc, tpl,
            { x: bxRot, y: byRot, z: bzRot }, scale, pos,
            c0.clone().multiplyScalar(jitter), c1.clone().multiplyScalar(jitter),
            br.wind1 || 0, fRng.range(0, Math.PI * 2), pos.clone(), 0.5, 1, flowerSlot,
            tpl.stamenRange ? stamenCol : null,
          )
          // AO 按实例烘焙: 记下顶点区间与中心点
          flowerAoRanges.push([v0, flowerAcc.vertexCount, pos.x, pos.y, pos.z])
          flowerCount++
          aoSamples.push(pos.x, pos.y, pos.z)
        }
      }
    }
    // 节点统计: leaves 这里表示"花朵总数", clusters 表示"可开花枝条数"(命名沿用叶片节点结构)
    if (flowerSlot >= 0 && slots[flowerSlot]) {
      slots[flowerSlot].meta.leaves = flowerCount
      slots[flowerSlot].meta.clusters = flowerBranches.length
    }
    // 有花才建几何; 0 顶点时保持 null, 下游 (AO/导出/渲染) 都会跳过。
    if (flowerAcc.vertexCount > 0) flowerGeometry = flowerAcc.build()
  }

  /* ------------------------------------------------------------------ */
  /* 程序化 AO: 用叶片/花朵点云估算遮挡, 乘进顶点色 (可导出到 GLB)          */
  /* ------------------------------------------------------------------ */
  const aoStats = { enabled: false, samples: aoSamples.length / 3, threshold: 0 }
  const AO = P.ao || {}
  // 三个前置条件: 未显式关闭、强度 > 0、点云至少 3 个样本 (9 个浮点)。
  // 点太少时遮挡统计没有意义, 而且 buildOcclusionGrid 在空点云上会退化。
  if (AO.enabled !== false && (AO.strength || 0) > 0 && aoSamples.length >= 9) {
    // 0.9 米是遮挡采样半径的默认值: 大约等于"一个叶簇到邻近叶簇"的距离,
    // 太小会漏掉云团感, 太大会把整棵树压成一个均匀暗色。
    const grid = buildOcclusionGrid(aoSamples, AO.radius === undefined ? 0.9 : AO.radius)
    const strength = Math.max(0, Math.min(1, AO.strength))
    // 树皮: 逐顶点 (枝条本身就是大面积表面); 叶片/花朵: 每个实例只查一次中心
    // (叶片是薄片, 逐顶点查询既慢又会因顶点位置差异产生斑驳噪点)。
    const b = bakeOcclusion(barkGeometry, grid, strength)
    const l = leafGeometry ? bakeOcclusionByRanges(leafGeometry, grid, strength, leafAoRanges) : null
    // 花朵的 AO 强度打七折 (×0.7): 花瓣薄且常朝上, 满强度会显得脏。
    const f = flowerGeometry ? bakeOcclusionByRanges(flowerGeometry, grid, strength * 0.7, flowerAoRanges) : null
    aoStats.enabled = true
    aoStats.threshold = b.threshold
    aoStats.affected = (b.affected || 0) + (l ? l.affected : 0) + (f ? f.affected : 0)
  }

  // 节点表: 此时顶点里存的还是 slot, finalizeNodes 会就地把 aNodeId 改写成最终 node id,
  // 并统计每个节点/组的面数、顶点数与包围盒。
  const { nodes, groups } = finalizeNodes(slots, barkGeometry, leafGeometry)

  // 整棵树的包围信息: 树皮与树叶分开算, 再取并集得到"真实树高/树幅"。
  const bInfo = boxInfo(barkGeometry)
  const lInfo = leafGeometry ? boxInfo(leafGeometry) : null
  // maxY/minY 取两者较高/较低者: 叶子常常比树皮更高 (树梢叶簇), 树根可能更低。
  const maxY = lInfo ? Math.max(bInfo.max.y, lInfo.max.y) : bInfo.max.y
  const minY = Math.min(bInfo.min.y, lInfo ? lInfo.min.y : bInfo.min.y)
  // spread = 水平方向的最大跨度 (X/Z 中较大者, 树皮与树叶取并集)。
  const maxXZ = Math.max(bInfo.size.x, bInfo.size.z, lInfo ? Math.max(lInfo.size.x, lInfo.size.z) : 0)

  return {
    barkGeometry,
    leafGeometry,
    flowerGeometry,
    nodes,
    groups,
    // 扭曲句柄引导线: {trunk: [x,y,z,...], branches: {1: [...], ...}} 扁平 xyz 数组,
    // 每根枝条按 t 均匀采样 17 点 (见 sampleGuidePoints), 供 UI 手柄层画曲线/命中测试。
    twistGuides,
    // 骨架图与蒙皮统计 (自检 / dev 检查页 / 调试用):
    // stats.skin.validation = { boundary, nonManifold, components, skinnedBranches, ... }
    skeleton: barkSkeleton,
    skinStats: skin.stats,
    // stats: 供 UI 显示"规模/性能/预算"的一次性汇总 (不参与渲染)。
    //   branches/leaves/fruit/flowers 是实例数; *Triangles/*Vertices 是最终几何规模;
    //   buildMs 是本次构建耗时 (毫秒); height/spread 是包围盒尺寸 (米);
    //   skin 是蒙皮统计 (含拓扑校验), ao 是烘焙统计。
    stats: {
      branches: branchCount,
      leaves: L.enabled ? leafCount : 0,
    fruit: fruitCount,
    fruitAttach,
    fruitOrient,
      barkTriangles: barkGeometry.index ? barkGeometry.index.count / 3 : 0,
      leafTriangles: leafGeometry && leafGeometry.index ? leafGeometry.index.count / 3 : 0,
      barkVertices: barkGeometry.attributes.position ? barkGeometry.attributes.position.count : 0,
      leafVertices: leafGeometry ? leafGeometry.attributes.position.count : 0,
    flowers: flowerCount,
    flowerTriangles: flowerGeometry && flowerGeometry.index ? flowerGeometry.index.count / 3 : 0,
    flowerVertices: flowerGeometry ? flowerGeometry.attributes.position.count : 0,
      skin: skin.stats,
      buildMs: now() - t0,
      height: maxY - minY,
      spread: maxXZ,
      trunkLength: t.height,
      levelCount: branchParams.levels,
      nodeCount: nodes.length,
      ao: aoStats,
    },
  }
}

/* ------------------------------------------------------------------ */
/* 节点表: slot -> 最终 node id, 并统计每个节点的面数/顶点数/包围盒        */
/* ------------------------------------------------------------------ */

/**
 * 组顺序: 同一组的节点 id 连续 -> 选中一组只需一个 id 区间。
 *
 * finalizeNodes 按这个数组的顺序遍历并把元素重排进 nodes, 因此"组在数组里的位置"
 * 直接决定最终 node id 的排布。前端可以据此只传 {idStart, idEnd} 给着色器做区间高亮,
 * 而不必逐个 id 比较。改顺序 = 改对外 id 契约, 需要同步检查 sceneManager 里的使用方。
 *
 * 字段: id(组标识) / name(显示名) / icon(节点树图标) / type(bark|leaf|fruit|material) /
 *       level(枝级, 材质组没有) / material(材质组专用: bark|leaf)。
 */
const NODE_GROUPS = [
  { id: 'trunk', name: '树干', icon: '🪵', type: 'bark' },
  { id: 'roots', name: '树根', icon: '🪵', type: 'bark' },
  // ---- 树枝: 每级一组 (L1..L5)。level 字段让 UI 能按层折叠/批量显隐 ----
  { id: 'branch-L1', name: '树枝 L1', icon: '🌿', type: 'bark', level: 1 },
  { id: 'branch-L2', name: '树枝 L2', icon: '🌿', type: 'bark', level: 2 },
  { id: 'branch-L3', name: '树枝 L3', icon: '🌿', type: 'bark', level: 3 },
  { id: 'branch-L4', name: '树枝 L4', icon: '🌿', type: 'bark', level: 4 },
  { id: 'branch-L5', name: '树枝 L5', icon: '🌿', type: 'bark', level: 5 },
  // ---- 树叶: 与枝层一一对应 (leaves-LN 挂在该层枝条下面), type='leaf' 用于材质分组 ----
  { id: 'leaves-L1', name: '树叶 L1', icon: '🍃', type: 'leaf', level: 1 },
  { id: 'leaves-L2', name: '树叶 L2', icon: '🍃', type: 'leaf', level: 2 },
  { id: 'leaves-L3', name: '树叶 L3', icon: '🍃', type: 'leaf', level: 3 },
  { id: 'leaves-L4', name: '树叶 L4', icon: '🍃', type: 'leaf', level: 4 },
  { id: 'leaves-L5', name: '树叶 L5', icon: '🍃', type: 'leaf', level: 5 },
  // ---- 果实: 同样按枝层分组; 每根枝条的果实共用一个节点 (见 spawnFruit) ----
  { id: 'fruit-L1', name: '果实 L1', icon: '🌰', type: 'fruit', level: 1 },
  { id: 'fruit-L2', name: '果实 L2', icon: '🌰', type: 'fruit', level: 2 },
  { id: 'fruit-L3', name: '果实 L3', icon: '🌰', type: 'fruit', level: 3 },
  { id: 'fruit-L4', name: '果实 L4', icon: '🌰', type: 'fruit', level: 4 },
  { id: 'fruit-L5', name: '果实 L5', icon: '🌰', type: 'fruit', level: 5 },
  // ---- 材质: 伪节点, 不参与 slot 重排 (finalizeNodes 跳过 type==='material') ----
  // 选中它等于"高亮整块几何", 由 finalizeNodes 末尾单独追加, id 在真实节点之后。
  { id: 'material-bark', name: '材质 · 树皮', icon: '🎨', type: 'material', material: 'bark' },
  { id: 'material-leaf', name: '材质 · 树叶', icon: '🎨', type: 'material', material: 'leaf' },
]

/**
 * 把一根枝条的骨架按 t 均匀采样成扭曲句柄的引导线 (扁平 xyz 数组)。
 *
 * 为什么是 17 点: 手柄层只需要"能看出弯曲和扭转"的多段折线, 17 点足够平滑
 * (16 段, 单点约 6% 枝长), 又能让一棵 300 根枝的树只占几十 KB 内存;
 * 点数再多对交互没有可见收益。
 *
 * @param {Array<Object>} frames 骨架帧
 * @param {number} [n=17] 采样点数 (内部至少 2)
 * @returns {Array<number>} 扁平数组 [x0,y0,z0, x1,y1,z1, ...], 世界坐标, 米
 */
function sampleGuidePoints(frames, n = 17) {
  const out = []
  if (!frames || !frames.length) return out
  const count = Math.max(2, n)
  for (let i = 0; i < count; i++) {
    const fr = sampleFrame(frames, i / (count - 1))
    if (!fr) continue
    out.push(fr.pos.x, fr.pos.y, fr.pos.z)
  }
  return out
}

/**
 * 空包围盒: min 初始化为 +∞、max 为 -∞, 便于用 unionBox 依次吞并任意子盒。
 * 注意这是"可增长的累加器", 不是合法的空盒语义 (不要拿去求中心)。
 * @returns {{min: Array<number>, max: Array<number>}}
 */
function emptyBox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
}

/**
 * 把盒子 b 并进 a (原地修改 a, 返回 a)。
 * 任一参数为空时直接返回另一个 —— 这样"还没有任何子盒"的情况不需要特判。
 * @param {{min: Array<number>, max: Array<number>}|null} a 目标盒
 * @param {{min: Array<number>, max: Array<number>}|null} b 待并入的盒
 * @returns {{min: Array<number>, max: Array<number>}|null} 并集
 */
function unionBox(a, b) {
  if (!a) return b
  if (!b) return a
  for (let i = 0; i < 3; i++) {
    if (b.min[i] < a.min[i]) a.min[i] = b.min[i]
    if (b.max[i] > a.max[i]) a.max[i] = b.max[i]
  }
  return a
}

/**
 * 把生成阶段的 slot 重排成最终 node id, 并统计每个节点/组的规模与包围盒。
 *
 * 为什么要重排: 生成时节点是按"长的顺序"登记的, 同一组的元素散落在数组各处;
 * 而 UI 需要"同一组 id 连续", 才能用一个 [idStart,idEnd] 区间做着色器高亮。
 * 本函数还负责把几何体里 aNodeId 属性的 slot 值就地改写成最终 id ——
 * 这是一次性契约, 调用后该几何体的节点信息才对渲染/导出有效。
 *
 * @param {Array} slots  生成阶段记录的元素 (顶点里存的是 slot 序号)
 * @param {THREE.BufferGeometry} barkGeometry 树皮几何 (含 aNodeId 属性, 会被就地改写)
 * @param {THREE.BufferGeometry|null} leafGeometry 树叶几何 (同上; 无叶时为 null)
 * @returns {{nodes: Array<Object>, groups: Array<Object>}} 节点表与组表
 *   node: {id, slot, type, group, groupName, level, name, parent, meta, stats:{triangles,vertices}, bbox}
 *   group: {id, name, icon, type, level, material, count, idStart, idEnd, nodeIds, stats, bbox, children}
 */
export function finalizeNodes(slots, barkGeometry, leafGeometry) {
  // 1) 按组重排, 得到最终 node id
  // slotToId[s] = 该 slot 对应的最终 id; 初始 -1 表示"未映射"(材质伪节点不会被映射)。
  const nodes = []
  const slotToId = new Int32Array(slots.length).fill(-1)
  for (const g of NODE_GROUPS) {
    // 材质组不是真实元素 (没有 slot), 跳过; 它们在第 3 步单独追加。
    if (g.type === 'material') continue
    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s]
      if (!slot || slot.group !== g.id) continue
      // 新 id 就是当前 nodes 长度 —— 按组顺序追加, 天然保证同组 id 连续。
      const id = nodes.length
      slotToId[s] = id
      nodes.push({
        id,
        slot: s,
        type: slot.type,
        group: g.id,
        groupName: g.name,
        level: slot.level || 0,
        name: slot.name,
        parent: slot.parent === null || slot.parent === undefined ? null : slot.parent,
        meta: slot.meta || {},
        stats: { triangles: 0, vertices: 0 },
        bbox: null,
      })
    }
  }

  // 2) 把顶点里的 slot 改写成 node id, 同时统计顶点数 / 包围盒
  // 一次线性扫描即可完成: 顶点属性 aNodeId 与 position 一一对应, 顺带累积 bbox 与计数,
  // 避免为每个节点再单独遍历一遍几何。三角形数则在单独的索引扫描里统计。
  /**
   * 就地改写一块几何的 aNodeId 并累加节点统计。
   * @param {THREE.BufferGeometry|null} geometry 待处理的几何
   * @param {Object} target 输出对象, 会被写入 info = {vertices, triangles}
   */
  const measure = (geometry, target) => {
    if (!geometry) return
    const attr = geometry.attributes.aNodeId
    if (!attr) return
    const ids = attr.array
    const pos = geometry.attributes.position.array
    // acc: nodeId -> {v: 顶点数, t: 三角形数, box: 该节点的局部包围盒}
    const acc = new Map()
    for (let i = 0; i < ids.length; i++) {
      // slotToId 是 Int32Array, 越界读取返回 undefined 而不是抛错, 这里显式兜底为 -1。
      const id = slotToId[ids[i]] === undefined ? -1 : slotToId[ids[i]]
      ids[i] = id
      if (id < 0) continue
      let rec = acc.get(id)
      if (!rec) {
        rec = { v: 0, t: 0, box: emptyBox() }
        acc.set(id, rec)
      }
      rec.v++
      const i3 = i * 3
      for (let k = 0; k < 3; k++) {
        const val = pos[i3 + k]
        if (val < rec.box.min[k]) rec.box.min[k] = val
        if (val > rec.box.max[k]) rec.box.max[k] = val
      }
    }
    // 属性被原地改写, 必须标脏才会重新上传到 GPU。
    attr.needsUpdate = true
    // 面数: 每个三角形取第一个顶点所属节点
    // (共享顶点/接缝顶点可能属于不同节点, 但三角形整体归属于"切口起点", 这样统计最稳定。)
    const index = geometry.index ? geometry.index.array : null
    if (index) {
      for (let t = 0; t < index.length; t += 3) {
        const id = ids[index[t]]
        const rec = acc.get(id)
        if (rec) rec.t++
      }
    }
    for (const [id, rec] of acc) {
      const node = nodes[id]
      if (!node) continue
      node.stats.vertices += rec.v
      node.stats.triangles += rec.t
      // 同一节点可能跨多个 draw 批次 (树皮/树叶分别 measure), 因此用并集累加。
      node.bbox = unionBox(node.bbox, rec.box)
    }
    target.info = { vertices: ids.length, triangles: index ? index.length / 3 : 0 }
  }

  const barkInfo = {}
  const leafInfo = {}
  measure(barkGeometry, barkInfo)
  measure(leafGeometry, leafInfo)

  // 3) 材质节点 (覆盖整块几何, 选中时按材质高亮)
  // 这两个是"伪节点": 没有自己的顶点区间, 面数/顶点数直接取对应几何的总量。
  // 它们的 id 在真实节点之后 (nodes.length), 因而不影响既有 id 的稳定性。
  const barkMatNode = {
    id: nodes.length,
    type: 'material',
    group: 'material-bark',
    groupName: '材质 · 树皮',
    level: -1,
    name: '材质 · 树皮',
    parent: null,
    material: 'bark',
    meta: {},
    stats: { triangles: barkInfo.triangles || 0, vertices: barkInfo.vertices || 0 },
    bbox: null,
  }
  nodes.push(barkMatNode)
  const leafMatNode = {
    id: nodes.length,
    type: 'material',
    group: 'material-leaf',
    groupName: '材质 · 树叶',
    level: -1,
    name: '材质 · 树叶',
    parent: null,
    material: 'leaf',
    meta: {},
    stats: { triangles: leafInfo.triangles || 0, vertices: leafInfo.vertices || 0 },
    bbox: null,
  }
  nodes.push(leafMatNode)

  // 4) 组元数据 (含 id 区间, 供着色器区间高亮)
  // 空组直接跳过 (例如没开树根/花), 这样 UI 不会列出长度为 0 的组。
  const groups = []
  for (const g of NODE_GROUPS) {
    const members = nodes.filter((n) => n.group === g.id)
    if (!members.length) continue
    const stats = { triangles: 0, vertices: 0 }
    let box = null
    for (const m of members) {
      stats.triangles += m.stats.triangles
      stats.vertices += m.stats.vertices
      // 复制一份 min/max: unionBox 会原地改第一个参数, 不能让组盒的累积污染节点盒。
      if (m.bbox) box = unionBox(box, { min: [...m.bbox.min], max: [...m.bbox.max] })
    }
    groups.push({
      id: g.id,
      name: g.name,
      icon: g.icon,
      type: g.type,
      level: g.level === undefined ? -1 : g.level,
      material: g.material || null,
      count: members.length,
      // idStart/idEnd 是"连续区间"契约: 组内 id 必然连续 (见 NODE_GROUPS 的排序),
      // 着色器只需这两个数就能高亮整组; nodeIds 是给需要逐个 id 的场合 (如隔离) 备用。
      idStart: members[0].id,
      idEnd: members[members.length - 1].id,
      nodeIds: members.map((m) => m.id),
      stats,
      bbox: box,
      // children 是节点树面板用的轻量投影 (只带展示字段, 不复制 stats 之外的大对象)。
      children: members.map((m) => ({ id: m.id, name: m.name, stats: m.stats, level: m.level, meta: m.meta })),
    })
  }

  return { nodes, groups }
}

/**
 * 把一组 node id 压缩成 <=8 个连续区间 (着色器用)。
 *
 * 为什么是 8: 着色器里用 uniform 数组传"高亮区间"是固定大小 (8 对), 既避免动态循环,
 * 也避开 WebGL1 对 uniform 数组长度的保守限制。选中散落节点时宁可"多亮一点"
 * (合并相邻区间), 也不能超过 8 段而丢选中反馈 —— 这是 UX 取舍, 不是近似算法。
 *
 * @param {Array<number>} ids 选中的 node id (可重复/乱序/含非法值)
 * @param {number} [maxRanges=8] 允许的最大区间数
 * @returns {Array<Array<number>>} 每个元素是 [start, end] 闭区间
 */
export function selectionRanges(ids, maxRanges = 8) {
  const sorted = [...new Set(ids)].filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  const ranges = []
  for (const id of sorted) {
    const last = ranges[ranges.length - 1]
    // 与上一段首尾相接 (id === last[1]+1) 就延长该段, 否则新开一段。
    if (last && id === last[1] + 1) last[1] = id
    else ranges.push([id, id])
  }
  // 区间过多时合并最近的几段 (宁可多亮一点, 也不丢选中反馈)
  // 每次挑"间隔最小"的相邻两段合并, 直到段数降到 maxRanges —— 贪心, 保证多亮的节点最少。
  while (ranges.length > maxRanges) {
    let bestI = 0
    let bestGap = Infinity
    for (let i = 0; i < ranges.length - 1; i++) {
      const gap = ranges[i + 1][0] - ranges[i][1]
      if (gap < bestGap) {
        bestGap = gap
        bestI = i
      }
    }
    ranges[bestI] = [ranges[bestI][0], ranges[bestI + 1][1]]
    ranges.splice(bestI + 1, 1)
  }
  return ranges
}

/**
 * 只计算统计信息 (不建几何), 供 UI 预估规模与预算控制。
 *
 * 用闭式级数而不是真跑一遍生成: 每层数量是确定的 (count 固定), 所以枝条总数 =
 * 各层数量的乘积按层累加; 复杂度 O(levels) (≤5), 可以在滑块拖动时每帧调用。
 * 注意: 会把"树干分叉出的主枝"也算进去 —— 它们等同于一级枝。
 *
 * 公式 (cnt(i) = 第 i 层每条父枝上的枝条数, forkN = 树干分叉主枝数):
 *   子树(level) = 1 + cnt(level+1) + cnt(level+1)·cnt(level+2) + ...
 *   条数(level) = cnt(1)·…·cnt(level) + forkN·cnt(2)·…·cnt(level)
 *   总枝数      = 子树(0) + forkN·子树(1)
 *   叶片数      = Σ_{开叶的层 i} 条数(i) · perBranch · clusterCount
 *
 * @param {Object} params 树木参数 (只读 branches.levels / branches.level / trunk.fork / leaves)
 * @returns {{branches: number, leaves: number}} 预估枝条根数与叶片实例数
 */
export function estimateScale(params) {
  const lv = params.branches.levels
  /** 第 level 层每条父枝上长几根 (未启用/缺配置 => 0) */
  const cnt = (level) => {
    const cfg = params.branches.level[level - 1]
    return cfg && cfg.enabled ? Math.max(0, Math.round(cfg.count)) : 0
  }
  // 分叉主枝数: 它们直接挂在树干上, 相当于"额外的一级枝", 因此单列一项。
  const forkN = (params.trunk && params.trunk.fork && params.trunk.fork.enabled)
    ? Math.max(0, Math.round(params.trunk.fork.count)) : 0

  /** 一条 level 级枝条的整棵子树节点数 (含自己) */
  const subtree = (level) => {
    let acc = 1
    let prod = 1
    for (let i = level + 1; i <= lv; i++) {
      prod *= cnt(i)
      acc += prod
      // 上限 2e6 只是防溢出/防 UI 卡死的保险丝 (参数极端时乘积会爆到 1e15)。
      if (acc > 2e6) return acc
    }
    return acc
  }
  /** level 级枝条的条数 (含分叉主枝带来的那部分) */
  const countAt = (level) => {
    let n = 1
    for (let i = 1; i <= level; i++) n *= cnt(i)
    if (forkN) {
      // 分叉主枝从 L1 起步, 所以它自己算 1 条 L1, 其下仍按 cnt(2..level) 展开。
      let f = forkN
      for (let i = 2; i <= level; i++) f *= cnt(i)
      n += f
    }
    return n
  }

  // 总枝数 = 树干子树 (含所有 L1 及其后代) + 每条分叉主枝的子树。
  let branches = subtree(0) + forkN * subtree(1)
  let leaves = 0
  for (let i = 1; i <= lv; i++) {
    // 该层不开叶就整层跳过
    if (!params.leaves.levels[i - 1]) continue
    leaves += countAt(i) * Math.max(1, Math.round(params.leaves.perBranch)) *
      Math.max(1, Math.round(params.leaves.clusterCount))
  }
  return { branches, leaves }
}

