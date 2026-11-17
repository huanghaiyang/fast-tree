import * as THREE from 'three'
import { makeRng } from './rng.js'
import { createRibbonCloth, settleCloth } from './cloth.js'

/**
 * 竹笋 / 鸟巢 / 槲寄生 / 彩带 —— 挂件几何 (独立网格, 单独材质)
 *
 * 适用范围: 鸟巢 / 槲寄生 / 彩带对所有树种通用 (挂在骨架枝条上, 与主干/分枝的
 * 具体结构无关); 竹笋是竹种独有的, 只有 params.bamboo.enabled 时才生成。
 *
 * 为什么单独一个网格而不是并进 barkGeometry:
 *   ① 树皮材质是"贴图 + 顶点色微调", 两根红彩带并进去会被竹节贴图染成暗红斑驳,
 *      竹笋也会带上竹节环 (它其实有鞘环, 但颜色必须自己掌控);
 *   ② 挂件需要自发光感的纯色 (布条/巢枝), 用 MeshStandardMaterial + vertexColors 最省;
 *   ③ 挂件不参与蒙皮的拓扑校验 (boundary=0 / components=1), 并进去会破坏验收。
 *   代价: 多一次 draw call, 且不继承风场/LOD —— 挂件小、位置静态, 可以接受。
 *
 * 所有内容都是确定性的 (makeRng(seed,'attachments')): 同一 seed 复现同一组挂件。
 */

const UP = new THREE.Vector3(0, 1, 0)
const DOWN = new THREE.Vector3(0, -1, 0)

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function mix(a, b, t) {
  return a + (b - a) * t
}

/** 极简几何累加器: 位置/颜色/索引, 法线最后统一 computeVertexNormals */
class Geo {
  constructor() {
    this.pos = []
    this.col = []
    this.idx = []
    this.count = 0
  }

  vertex(p, c) {
    this.pos.push(p.x, p.y, p.z)
    this.col.push(c.r, c.g, c.b)
    return this.count++
  }

  tri(a, b, c) {
    this.idx.push(a, b, c)
  }

  /** 两个环 (等长) 之间铺一圈四边形; 法线朝外由调用方保证绕序 */
  bridge(ringA, ringB, closed = true) {
    const n = ringA.length
    const m = closed ? n : n - 1
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n
      this.tri(ringA[i], ringB[j], ringA[j])
      this.tri(ringA[i], ringB[i], ringB[j])
    }
  }

  build() {
    if (!this.count) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setIndex(this.idx)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }
}

/**
 * 竹笋: 一根带鞘的锥体。
 * 外形关键不是锥, 而是"一节节鞘" —— 每 3 圈半径突然外扩一次, 形成锯齿形轮廓,
 * 远看就是一层层包着的笋壳; 颜色从基部乳黄 → 顶部青绿。
 */
function addShoot(geo, base, dir, height, radius, rng) {
  const rings = 13
  const radial = 8
  const baseCol = new THREE.Color(0.20, 0.17, 0.08)
  const tipCol = new THREE.Color(0.10, 0.16, 0.06)
  const rot = rng.range(0, Math.PI * 2)

  // 平行移动坐标系: 笋几乎竖直, 用一个固定参考轴就够
  const side = new THREE.Vector3().crossVectors(dir, UP)
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
  side.normalize()
  const up = new THREE.Vector3().crossVectors(dir, side).normalize()

  const ringList = []
  const pushRing = (t, rMul, colorMul) => {
    const taper = 1 - 0.78 * t
    const r = Math.max(0.012, radius * taper * rMul)
    const c = baseCol.clone().lerp(tipCol, Math.pow(t, 1.2))
    if (colorMul !== 1) c.multiplyScalar(colorMul)
    const ring = []
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2 + rot
      const p = base.clone().addScaledVector(dir, height * t)
        .addScaledVector(side, Math.cos(a) * r)
        .addScaledVector(up, Math.sin(a) * r)
      ring.push(geo.vertex(p, c))
    }
    ringList.push(ring)
  }
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    // 鞘唇: 每 3 圈外扩一次, 紧接着在同一高度再收回 + 压暗一圈。
    // 只做"一圈加宽"会被光滑法线抹平 (轮廓看不出锯齿), 必须成对出现才形成台阶。
    if (i % 3 === 0 && i > 0 && i < rings - 1) {
      pushRing(t, 1.28, 0.86)
      pushRing(t + 0.012, 1.0, 0.62)
    } else {
      pushRing(t, 1, 1)
    }
  }
  for (let i = 0; i < rings; i++) geo.bridge(ringList[i], ringList[i + 1])

  // 笋尖: 收口到一点, 再带 3 片小苞叶 (朝外上方翘)
  const tipPos = base.clone().addScaledVector(dir, height * 0.92)
  const tipV = geo.vertex(tipPos, tipCol)
  const lastRing = ringList[ringList.length - 1]
  for (let j = 0; j < radial; j++) geo.tri(lastRing[(j + 1) % radial], lastRing[j], tipV)
  const bractCol = new THREE.Color(0.16, 0.20, 0.10)
  for (let b = 0; b < 3; b++) {
    const a = rot + (b / 3) * Math.PI * 2
    const outward = new THREE.Vector3(side.x * Math.cos(a) + up.x * Math.sin(a),
      side.y * Math.cos(a) + up.y * Math.sin(a),
      side.z * Math.cos(a) + up.z * Math.sin(a))
    // 苞叶: 一片朝外上方翘的三角形 (太窄会变成"天线"一样的白细线, 所以放宽、压低)
    const p0 = base.clone().addScaledVector(dir, height * 0.78)
    const p1 = p0.clone().addScaledVector(dir, height * 0.16).addScaledVector(outward, radius * 1.05)
    const p2 = p0.clone().addScaledVector(dir, height * 0.20)
    const v0 = geo.vertex(p0, bractCol)
    const v1 = geo.vertex(p1, bractCol)
    const v2 = geo.vertex(p2, bractCol)
    geo.tri(v0, v1, v2)
  }
}

/** 沿折线扫一根细管 (巢枝/藤条用); 半径不变, 4 边 */
function addTube(geo, pts, radius, color, sides = 4) {
  let side = new THREE.Vector3(1, 0, 0)
  const rings = []
  for (let i = 0; i < pts.length; i++) {
    const dir = new THREE.Vector3()
    if (i === 0) dir.subVectors(pts[1], pts[0])
    else if (i === pts.length - 1) dir.subVectors(pts[i], pts[i - 1])
    else dir.subVectors(pts[i + 1], pts[i - 1])
    dir.normalize()
    // 折线方向变了要重新投影 side, 否则管子会在拐弯处扭成麻花
    side.addScaledVector(dir, -side.dot(dir))
    if (side.lengthSq() < 1e-8) side.set(0, 0, 1).addScaledVector(dir, -dir.z)
    side.normalize()
    const up = new THREE.Vector3().crossVectors(dir, side).normalize()
    const ring = []
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2
      const p = pts[i].clone().addScaledVector(side, Math.cos(a) * radius).addScaledVector(up, Math.sin(a) * radius)
      ring.push(geo.vertex(p, color))
    }
    rings.push(ring)
  }
  for (let i = 0; i < rings.length - 1; i++) geo.bridge(rings[i], rings[i + 1])
}

/**
 * 鸟巢: 碗形 + 两圈交叉的巢枝。
 * 只做"看得懂的剪影": 外圈 11 根沿碗壁斜上的枝条 + 内圈 7 根, 再压一圈碗底线。
 */
function addNest(geo, pos, scale, rng) {
  const c1 = new THREE.Color(0.34, 0.26, 0.17)
  const c2 = new THREE.Color(0.24, 0.18, 0.12)
  const outer = 11
  const rOuter = scale
  const rInner = scale * 0.62
  const bowlH = scale * 0.62
  for (let i = 0; i < outer; i++) {
    const a = (i / outer) * Math.PI * 2 + rng.range(-0.12, 0.12)
    const r = rOuter * rng.range(0.92, 1.06)
    const p0 = pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r))
    const p1 = pos.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.86, bowlH * 0.55, Math.sin(a) * r * 0.86))
    const p2 = pos.clone().add(new THREE.Vector3(Math.cos(a + 0.16) * r * 0.74, bowlH, Math.sin(a + 0.16) * r * 0.74))
    addTube(geo, [p0, p1, p2], scale * 0.05, i % 2 ? c1 : c2, 4)
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2)
    const r = rInner * rng.range(0.9, 1.1)
    const p0 = pos.clone().add(new THREE.Vector3(Math.cos(a) * r, bowlH * 0.2, Math.sin(a) * r))
    const p1 = pos.clone().add(new THREE.Vector3(Math.cos(a + 0.5) * r * 0.9, bowlH * 0.9, Math.sin(a + 0.5) * r * 0.9))
    addTube(geo, [p0, p1], scale * 0.045, c2, 4)
  }
  // 碗底: 一圈短枝连成底面 (否则从上方看是空的)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const r = rInner * 0.55
    const p0 = pos.clone().add(new THREE.Vector3(Math.cos(a) * r, bowlH * 0.12, Math.sin(a) * r))
    const p1 = pos.clone().add(new THREE.Vector3(Math.cos(a + 1.2) * r, bowlH * 0.12, Math.sin(a + 1.2) * r))
    addTube(geo, [p0, p1], scale * 0.04, c2, 3)
  }
}

/** 槲寄生: 一簇叶团 (5 个压扁的小球拼成的"团", 不是一颗整球) + 几颗白色浆果 */
function addMistletoe(geo, pos, scale, rng) {
  const leaf = new THREE.Color(0.26, 0.40, 0.17)
  const leaf2 = new THREE.Color(0.19, 0.32, 0.12)
  const berry = new THREE.Color(0.90, 0.91, 0.80)
  // 主团 + 4 个偏移的小团: 单一整球一眼就是"绿气球", 拼团才有叶簇的轮廓
  const blobs = 5
  for (let i = 0; i < blobs; i++) {
    const a = rng.range(0, Math.PI * 2)
    const dist = i === 0 ? 0 : scale * rng.range(0.35, 0.62)
    const rr = i === 0 ? scale * 0.72 : scale * rng.range(0.36, 0.5)
    const bp = pos.clone().add(new THREE.Vector3(Math.cos(a) * dist, rng.range(-0.25, 0.3) * scale, Math.sin(a) * dist))
    addSphere(geo, bp, rr, i % 2 ? leaf2 : leaf, 0.72)
  }
  for (let b = 0; b < 3; b++) {
    const a = rng.range(0, Math.PI * 2)
    const el = rng.range(-0.3, 0.7)
    const bp = pos.clone().add(new THREE.Vector3(Math.cos(a) * scale * 0.7 * Math.cos(el), Math.sin(el) * scale * 0.55, Math.sin(a) * scale * 0.7 * Math.cos(el)))
    addSphere(geo, bp, scale * 0.14, berry)
  }
}

/** 低成本球 (浆果/叶团); squashY < 1 时压扁成叶簇 */
function addSphere(geo, pos, r, color, squashY = 1) {
  const rings = 4
  const radial = 6
  const ringList = []
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI
    const rr = Math.sin(phi) * r
    const y = -Math.cos(phi) * r * squashY
    const ring = []
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2
      ring.push(geo.vertex(pos.clone().add(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr)), color))
    }
    ringList.push(ring)
  }
  for (let i = 0; i < rings; i++) geo.bridge(ringList[i], ringList[i + 1])
}

/**
 * 彩带: 一块真正被"布"求解过的窄布条。
 *
 * 以前这里是一条 9 段 × 2 顶点的布片, 摆动是 sin 函数贴上去的 —— 侧面看就是张纸。
 * 现在用质点网格布料 (见 cloth.js): 顶边钉在枝上, 顶边以下受重力 + 风 + 湍流,
 * 距离约束把布撑开, 折叠与扭转是求解出来的, 不是画出来的。
 *
 * 布料只作用于彩带这一个挂件类型: 巢是枝、槲寄生是叶团, 都不该被风吹成布。
 *
 * @param {object} ctx { wind, handles } —— 同一棵树上所有彩带共享风场与句柄表
 */
function addRibbon(geo, top, f, length, width, color, rng, ctx) {
  const COL = 5
  const ROW = 16
  const axis = f && f.dir && f.dir.lengthSq() > 1e-8 ? f.dir.clone().normalize() : UP.clone()
  // 布宽方向: 与枝轴垂直且尽量水平。枝近竖直时退化, 用 rng 定一个水平方位(保持确定性)
  const uAxis = new THREE.Vector3().crossVectors(axis, UP)
  if (uAxis.lengthSq() < 1e-8) {
    const a = rng.range(0, Math.PI * 2)
    uAxis.set(Math.cos(a), 0, Math.sin(a))
  }
  uAxis.normalize()
  const cloth = createRibbonCloth({
    cols: COL,
    rows: ROW,
    width,
    length,
    origin: top,
    uAxis,
    down: DOWN,
    branchAxis: axis,
    branchRadius: Math.max(0.008, (f && f.radius) || 0.01),
    rng,
    // 彩带是窄条: 去掉剪切约束才扭得动 (见 cloth.js)
    skipShear: true,
  })
  // 预解算 1.5 秒: 打开页面看到的就是"已经挂了一阵子"的样子, 不是刚开始掉下来的布
  settleCloth(cloth, 90, ctx.wind)

  const base = geo.count
  const quads = new Int32Array(COL * ROW * 6)
  for (let r = 0; r < ROW; r++) {
    const c = color.clone().multiplyScalar(0.86 + 0.14 * (1 - (r + 0.5) / ROW))
    for (let q = 0; q < COL; q++) {
      const v0 = r * (COL + 1) + q
      const v1 = (r + 1) * (COL + 1) + q
      const v2 = (r + 1) * (COL + 1) + q + 1
      const v3 = r * (COL + 1) + q + 1
      const order = [v0, v1, v2, v0, v2, v3]
      const qo = (r * COL + q) * 6
      for (let k = 0; k < 6; k++) {
        const s = order[k]
        quads[qo + k] = s
        geo.vertex(
          new THREE.Vector3(cloth.p[s * 3], cloth.p[s * 3 + 1], cloth.p[s * 3 + 2]),
          c
        )
      }
      // 每格两个三角形 (四边形按 v0-v1-v2 / v0-v2-v3 切, 和顶点顺序一致)
      const vb = base + qo
      geo.tri(vb, vb + 1, vb + 2)
      geo.tri(vb + 3, vb + 4, vb + 5)
    }
  }
  ctx.handles.push({ cloth, base, quads })
}

/**
 * 在枝条折线上按归一化位置 t 取一个插值帧。
 *
 * 为什么不用 frames[round(t*len)]: 帧是"等参数间隔"采样的, 直接取整会让手工摆放
 * 的滑杆出现一格一格的跳变; 线性插值让 t 连续可控。半径一起插值, 挂件的
 * "向上/向下偏移"才不会在帧边界突然跳一下。
 * @param {object} branch 骨架分支 (frames: [{pos, radius, t}] 或只有 1 帧)
 * @param {number} t 0..1
 */
function sampleFrame(branch, t) {
  const fs = branch.frames
  const tt = clamp01(t)
  if (fs.length < 2) {
    return { pos: fs[0].pos.clone(), radius: fs[0].radius || 0.02, dir: fs[0].dir ? fs[0].dir.clone() : null }
  }
  let i = 0
  while (i < fs.length - 2 && fs[i + 1].t < tt) i++
  const a = fs[i]
  const b = fs[i + 1]
  const span = b.t - a.t || 1
  const k = clamp01((tt - a.t) / span)
  const dir = a.dir && b.dir
    ? a.dir.clone().lerp(b.dir, k).normalize()
    : null
  return {
    pos: a.pos.clone().lerp(b.pos, k),
    radius: mix(a.radius || 0.02, b.radius || 0.02, k),
    dir,
  }
}

/**
 * 求一个垂直于枝条方向、尽量朝向 worldDir 的方向。
 *
 * 为什么需要: 大树的树干半径可以到 30cm, 仍然"沿世界竖直方向往上偏"会把鸟巢
 * 整颗埋进树干里; 沿"垂直于枝条、尽量向上"偏, 竖直树干上就变成水平向外偏,
 * 巢才会贴在树皮外侧。水平枝上这个方向基本就是正上方 (与旧行为一致)。
 * 近竖直枝 (树干/竹竿) 时 UP 与切线几乎平行, 投影退化 -> 取任意水平方位
 * (用 rng 定方位, 保证同一 seed 可复现)。
 */
function perpDir(dir, prefer, rng) {
  if (!dir) return prefer.clone()
  const t = dir.clone().normalize()
  const p = prefer.clone().addScaledVector(t, -prefer.dot(t))
  if (p.lengthSq() > 0.09) return p.normalize()
  const ref = Math.abs(t.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
  const b1 = new THREE.Vector3().crossVectors(t, ref).normalize()
  const b2 = new THREE.Vector3().crossVectors(t, b1).normalize()
  const a = rng.range(0, Math.PI * 2)
  return b1.multiplyScalar(Math.cos(a)).add(b2.multiplyScalar(Math.sin(a))).normalize()
}

/**
 * 计算挂件中心/顶点的位置: 从骨架帧沿"垂直于枝条、尽量朝上/朝下"偏出枝干表面。
 *
 * 为什么随机散布也要走这里: 小树回落到"任意枝"后, 宿主可能是 20~30cm 粗的主干;
 * 沿世界竖直方向偏移只会沿着树干轴线滑动, 巢会整颗埋进木头里。按法向偏才能保证
 * 挂在树皮外侧。水平枝上法向就是正上/正下方, 与旧的竖直偏移一致。
 *
 * @param {object} f 骨架帧 { pos, radius, dir }
 * @param {'nest'|'mistletoe'|'ribbon'} type 挂件类型 (决定朝上还是朝下)
 * @param {number} scale 挂件自身的外形尺寸 (用于让偏移量与挂件大小匹配)
 */
function attachRef(f, type, scale, rng) {
  const prefer = type === 'nest' ? UP : DOWN
  const dir = perpDir(f.dir, prefer, rng)
  let off
  if (type === 'nest') off = Math.max(0.05, f.radius + 0.29 * scale * 0.55)
  else if (type === 'mistletoe') off = Math.max(f.radius * 1.4, f.radius + 0.18 * scale * 0.5)
  else off = Math.max(0.04, f.radius + 0.02)
  return f.pos.clone().addScaledVector(dir, off)
}

/**
 * 按手工实例 (params.attachments.items[i]) 在骨架上放一件挂件。
 * node 失效时回落到第一根可挂枝: 改竿数/竹高会重排分支下标, 挂件不该因此
 * 整批消失 (消失比"挪到别处"更难察觉, 也更容易被误当成参数失效)。
 * @returns {string|null} 实际生成的类型 ('nest'|'mistletoe'|'ribbon')
 */
function addManualItem(geo, item, branches, hostBranches, ribbonCol, rng, ctx) {
  let b = branches[item.node]
  if (!b || !b.frames || b.frames.length < 2) b = hostBranches[0]
  if (!b) return null
  const f = sampleFrame(b, item.t)
  const size = Math.min(4, Math.max(0.2, Number(item.size) || 1))
  if (item.type === 'mistletoe') {
    const pos = attachRef(f, 'mistletoe', size, rng)
    addMistletoe(geo, pos, 0.18 * size, rng)
    return 'mistletoe'
  }
  if (item.type === 'ribbon') {
    const top = attachRef(f, 'ribbon', size, rng)
    addRibbon(geo, top, f, 0.75 * size, 0.072 * size, ribbonCol, rng, ctx)
    return 'ribbon'
  }
  const pos = attachRef(f, 'nest', size, rng)
  addNest(geo, pos, 0.29 * size, rng)
  return 'nest'
}

/**
 * params.wind -> 布料用的风场。
 * 方向角与树木共用同一套口径 (0° = +X, 俯视 XZ 平面逆时针), 这样彩带和树梢朝同一个方向飘。
 */
function windFromParams(wind) {
  const w = wind || {}
  const rad = ((w.direction === undefined ? 45 : w.direction) * Math.PI) / 180
  return {
    dir: new THREE.Vector3(Math.cos(rad), 0, Math.sin(rad)),
    strength: w.strength === undefined ? 0.12 : w.strength,
    speed: w.speed === undefined ? 0.8 : w.speed,
    gust: w.gust === undefined ? 0.5 : w.gust,
    gustSpeed: w.gustSpeed === undefined ? 0.16 : w.gustSpeed,
    turbulence: w.turbulence === undefined ? 0.12 : w.turbulence,
    enabled: w.enabled !== false,
    time: 0,
  }
}

/**
 * 入口: 根据参数在骨架上撒挂件。
 *
 * 鸟巢/槲寄生/彩带对所有树种通用 —— 它们只依赖"骨架分支折线", 与树种结构无关;
 * 竹笋是竹种独有的, 由 params.bamboo 控制 (非竹种 bamboo.enabled=false, 数量为 0)。
 *
 * @param {object} skeleton { branches: [{ location..., frames, level, slot }] }
 * @param {object} params 完整参数树 (读 params.bamboo 与 params.attachments)
 */
export function buildAttachments(skeleton, params, seed = 1) {
  const bamboo = params.bamboo || {}
  const A = params.attachments || {}
  const stats = { shoots: 0, nests: 0, mistletoes: 0, ribbons: 0, custom: 0 }
  if (!skeleton || !Array.isArray(skeleton.branches) || A.enabled === false) {
    return { geometry: null, stats }
  }
  const rng = makeRng(seed, 'attachments')
  const geo = new Geo()
  const branches = skeleton.branches
  // 布料上下文: 风场 (与树木同源) + 每块布的句柄 (运行时逐帧回写顶点用)
  const ctx = { wind: windFromParams(params.wind), handles: [] }

  // ---- 竹笋: 从每根竿的出土点旁边冒出来 (只在竹种下) ----
  // 竹笋的几何贴着"一丛细竿的出土点", 换成橡树/松树会变成主干旁一根胖锥,
  // 语义不对, 所以这里仍然由 bamboo.enabled 把关。
  const shootN = bamboo.enabled ? Math.max(0, Math.round(bamboo.shoots === undefined ? 4 : bamboo.shoots)) : 0
  if (shootN > 0) {
    const culms = branches.filter((b) => b.level === 1 && b.type === 'branch')
    for (let i = 0; i < shootN && culms.length; i++) {
      const c = culms[i % culms.length]
      const f = c.frames[0]
      const a = rng.range(0, Math.PI * 2)
      const off = rng.range(0.18, 0.42)
      const base = f.pos.clone().add(new THREE.Vector3(Math.cos(a) * off, 0, Math.sin(a) * off))
      base.y = 0
      const h = Math.max(0.15, (bamboo.shootHeight === undefined ? 0.85 : bamboo.shootHeight) * rng.range(0.7, 1.05))
      // 笋比竿粗得多 (鲜笋是"胖锥"): 半径给到竿的 1.8~2.6 倍, 否则远看像一根白牙签
      const r = Math.max(0.04, (bamboo.culmRadius === undefined ? 0.048 : bamboo.culmRadius) * rng.range(1.8, 2.6))
      const dir = new THREE.Vector3(rng.range(-0.08, 0.08), 1, rng.range(-0.08, 0.08)).normalize()
      addShoot(geo, base, dir, h, r, rng)
      stats.shoots++
    }
  }

  // ---- 鸟巢 / 槲寄生 / 彩带: 挂在 L2+ 的枝条分叉附近 ----
  // 优先 L2+ (细枝): 巢和彩带挂在细枝上才像"枝杈里的小东西";
  // 小树/幼苗可能一根 L2+ 都没有 (levels 只展开到 L1), 这时回落到任意有足够
  // 帧数的枝 (含主干) —— 否则"树上一件挂件都没有", 用户会以为参数失效。
  const MIN_FRAMES = 4
  let hostBranches = branches.filter((b) => b.level >= 2 && b.frames && b.frames.length > MIN_FRAMES)
  if (!hostBranches.length) {
    hostBranches = branches.filter((b) => b.frames && b.frames.length > MIN_FRAMES)
  }
  const pickFrame = (lo, hi) => {
    if (!hostBranches.length) return null
    const b = hostBranches[Math.floor(rng.range(0, hostBranches.length))]
    const fi = Math.floor(rng.range(lo, hi) * (b.frames.length - 1))
    const f = b.frames[Math.max(1, Math.min(b.frames.length - 1, fi))]
    return { b, f }
  }

  const nestN = Math.max(0, Math.round(A.nest === undefined ? 1 : A.nest))
  for (let i = 0; i < nestN; i++) {
    const hit = pickFrame(0.35, 0.8)
    if (!hit) break
    const scale = rng.range(0.24, 0.34)
    const pos = attachRef(hit.f, 'nest', scale, rng)
    addNest(geo, pos, scale, rng)
    stats.nests++
  }

  const misN = Math.max(0, Math.round(A.mistletoe === undefined ? 2 : A.mistletoe))
  for (let i = 0; i < misN; i++) {
    const hit = pickFrame(0.3, 0.75)
    if (!hit) break
    const scale = rng.range(0.14, 0.22)
    const pos = attachRef(hit.f, 'mistletoe', scale, rng)
    addMistletoe(geo, pos, scale, rng)
    stats.mistletoes++
  }

  const ribN = Math.max(0, Math.round(A.ribbons === undefined ? 3 : A.ribbons))
  const ribbonCol = new THREE.Color(A.ribbonColor || '#c81f1f')
  for (let i = 0; i < ribN; i++) {
    const hit = pickFrame(0.25, 0.7)
    if (!hit) break
    const top = attachRef(hit.f, 'ribbon', 1, rng)
    addRibbon(geo, top, hit.f, rng.range(0.5, 1.0), rng.range(0.06, 0.085), ribbonCol, rng, ctx)
    stats.ribbons++
  }

  // ---- 手工摆放: items[] 逐件生成 ----
  // 顺序放在随机散布之后: rng 的调用次数不会因为"加了/删了手工挂件"而改变,
  // 已有的随机挂件位置保持稳定 (否则每点一次视口, 整丛挂件都会重新洗牌)。
  const items = Array.isArray(A.items) ? A.items : []
  for (const item of items) {
    const type = addManualItem(geo, item, branches, hostBranches, ribbonCol, rng, ctx)
    if (!type) continue
    stats.custom++
    if (type === 'nest') stats.nests++
    else if (type === 'mistletoe') stats.mistletoes++
    else stats.ribbons++
  }

  return { geometry: geo.build(), stats, cloth: { handles: ctx.handles, wind: ctx.wind } }
}
