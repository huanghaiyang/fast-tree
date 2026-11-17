import * as THREE from 'three'

/**
 * 彩带布料求解器 (Verlet 质点网格 + 距离约束)
 *
 * 为什么不用正弦布条了:
 *   原来的彩带就是"一条 18 个顶点的双面布片, 每帧按 sin 摆动", 只有上下两条边,
 *   翻到侧面就是一条没有厚度的纸片 —— 布最重要的是"折叠 + 扭转", 这不是加正弦能编出来的。
 *
 * 算法来源: 这是 three.js 官方 cloth 示例 (examples/webgl_animation_cloth, 基于
 * Simon Green 的 mass-spring cloth, MIT) 的同一套思路, 自己重写了一份不依赖 JSCloth/ammo:
 *   ① 每个质点存位置 p 与上一帧位置 prev, 速度由 (p - prev) 隐式给出 (Verlet);
 *   ② 约束是"保持初始距离"的等式, 用松弛迭代 (Gauss-Seidel) 把两端各拉一半;
 *   ③ 顶边质点钉死 (pin), 其余受重力 + 风 + 阻尼;
 *   ④ 枝条当成胶囊做碰撞, 布不会穿进枝干。
 * 不引入 cannon-es/ammo 这类刚体库: 这里只有"布 vs 一根胶囊", 上物理引擎要多几百 KB
 * 和一次异步初始化, 收益为零。
 *
 * 确定性: 求解只吃 rng 给的初始褶皱与相位, 没有 Math.random; 构建时固定步数预解算,
 * 所以同一 seed 每次构建出的彩带形状逐字节一致 (selftest 的几何前缀断言依赖这个)。
 *
 * 为什么构建后还要逐帧跑: 预解算只给出"挂上去的静态形状", 运行时继续积分才有飘动。
 * 每帧只更新自己那几个顶点, 不重建几何、不加 draw call。
 */

const GRAVITY = -9.81

/** 质点网格的顶点下标: row 沿布长 (0 = 顶边), col 沿布宽 */
function pid(cols, r, c) {
  return r * (cols + 1) + c
}

/**
 * 建一块彩带布料。
 *
 * @param {object} o
 * @param {number} o.cols 横向格数 (建议 4)
 * @param {number} o.rows 纵向格数 (建议 14)
 * @param {number} o.width 布宽 (米)
 * @param {number} o.length 布长 (米)
 * @param {THREE.Vector3} o.origin 顶边中点 (挂在枝条下方的位置)
 * @param {THREE.Vector3} o.uAxis 布宽方向 (单位向量, 与枝条垂直且尽量水平)
 * @param {THREE.Vector3} o.down 布长的初始方向 (一般就是世界向下)
 * @param {THREE.Vector3} o.branchAxis 宿主枝的轴向 (碰撞胶囊的轴)
 * @param {number} o.branchRadius 宿主枝半径 (碰撞胶囊半径)
 * @param {object} o.rng makeRng 子流
 */
export function createRibbonCloth(o) {
  const cols = Math.max(1, o.cols)
  const rows = Math.max(2, o.rows)
  const n = (cols + 1) * (rows + 1)
  const width = o.width
  const length = o.length
  const phase = o.rng.range(0, Math.PI * 2)

  const p = new Float32Array(n * 3)
  const prev = new Float32Array(n * 3)
  const pinned = new Uint8Array(n)

  // 布宽方向 / 下落方向 / 布面法向
  const uAxis = o.uAxis.clone().normalize()
  const down = o.down.clone().normalize()
  const normal = new THREE.Vector3().crossVectors(uAxis, down).normalize()
  // 扭转轴: down × uAxis, 绕它转 uAxis 就等于"把布条沿长度扭一下"
  const twistAxis = new THREE.Vector3().crossVectors(down, uAxis).normalize()
  // 顶边整条钉住 (像系在枝上的一根横杆), 只钉顶边才挂得住又会自然垂坠
  const cellW = width / cols
  const cellH = length / rows
  const tmp = new THREE.Vector3()
  const uVec = new THREE.Vector3()
  for (let r = 0; r <= rows; r++) {
    const v = r / rows
    // 初始扭转: 一条完全平的布条正面看就是张纸, 侧看又消失; 先扭出接近 1 弧度的螺旋,
    // 重力/风只能让它更乱, 不会把它抚平, 所以这个初始条件不会被解算"白给"。
    const twist = Math.sin(v * Math.PI * 1.6 + phase) * 1.15 + v * 0.6
    const ct = Math.cos(twist)
    const st = Math.sin(twist)
    uVec.copy(uAxis).multiplyScalar(ct).addScaledVector(twistAxis, st)
    for (let c = 0; c <= cols; c++) {
      const u = c / cols - 0.5
      // 初始褶皱: 完全平的一张布在重力下会笔直下垂, 永远折不起来 ——
      // 先给一点沿法向的正弦鼓包, 让求解器"有褶可放大"
      const buckle = Math.sin(v * Math.PI * 1.9 + phase * 1.7) * width * 0.62 * (1 - 0.45 * v)
      // 横向卷边: 真彩带是卷筒上裁下来的, 横截面本身就带弧。纯弯曲不改变边长,
      // 所以约束不会把它拉平; 有了弧度, 法线沿布宽方向才有变化 (否则整条布一个色, 像塑料片)。
      const curl = width * 0.5 * (0.35 + 0.65 * v) * ((u * 2) * (u * 2) - 0.33)
      const jitter = o.rng.range(-0.006, 0.006) * (1 + v)
      tmp.copy(o.origin)
        .addScaledVector(uVec, u * width)
        .addScaledVector(down, v * length)
        .addScaledVector(normal, buckle + jitter + curl)
      const i = pid(cols, r, c) * 3
      p[i] = prev[i] = tmp.x
      p[i + 1] = prev[i + 1] = tmp.y
      p[i + 2] = prev[i + 2] = tmp.z
      if (r === 0) pinned[pid(cols, r, c)] = 1
    }
  }

  // ---- 约束: 结构 (上下左右) + 剪切 (两条对角) ----
  // 剪切约束是"布面"保持平面刚度的关键; 但彩带是窄条, 两条对角约束会把扭转也锁死
  // (实测: 整条彩带像硬纸板, 只能整体倾斜, 扭不出褶皱), 所以彩带 skipShear。
  const ia = []
  const ib = []
  const rest = []
  const addC = (a, b, len) => {
    ia.push(a)
    ib.push(b)
    rest.push(len)
  }
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      if (c < cols) addC(pid(cols, r, c), pid(cols, r, c + 1), cellW)
      if (r < rows) addC(pid(cols, r, c), pid(cols, r + 1, c), cellH)
      if (!o.skipShear && r < rows && c < cols) {
        const diag = Math.hypot(cellW, cellH)
        addC(pid(cols, r, c), pid(cols, r + 1, c + 1), diag)
        addC(pid(cols, r, c + 1), pid(cols, r + 1, c), diag)
      }
    }
  }

  return {
    cols, rows, n, width, length,
    p, prev, pinned,
    ia: Int32Array.from(ia),
    ib: Int32Array.from(ib),
    rest: Float32Array.from(rest),
    origin: o.origin.clone(),
    branchAxis: o.branchAxis.clone().normalize(),
    branchRadius: o.branchRadius,
    phase,
    // 累积时间: 构建时的预解算与运行时动画共用一条时间轴, 相位不跳变
    time: 0,
    iterations: 4,
  }
}

/**
 * 一步 Verlet 积分 + 约束松弛 + 碰撞。
 *
 * @param {object} cloth createRibbonCloth 的返回值
 * @param {number} dt 固定步长 (秒), 建议 1/60
 * @param {object} wind { dir: Vector3, strength, speed, gust, gustSpeed, turbulence, enabled, time }
 */
export function stepCloth(cloth, dt, wind) {
  const { n, p, prev, pinned } = cloth
  if (dt <= 0) return
  const dt2 = dt * dt
  const damping = 0.995
  // 风: strength 与树木共用同一口径(米)。布比叶片轻得多, 但也不能让风压过重力,
  // 否则彩带会被吹成水平的一条(实测 60 倍时 dx≈0.22 m, 布被吹平了), 20 倍刚好"垂着飘"。
  const windX = wind && wind.enabled ? wind.dir.x : 0
  const windZ = wind && wind.enabled ? wind.dir.z : 0
  const amp = wind && wind.enabled ? (wind.strength || 0.15) * 20 : 0
  const time = wind ? wind.time : 0
  const speed = wind ? wind.speed || 0.8 : 1
  const gustW = wind ? wind.gust === undefined ? 0.5 : wind.gust : 0
  const gustS = wind ? Math.max(0.01, wind.gustSpeed === undefined ? 0.16 : wind.gustSpeed) : 1
  const turb = wind ? wind.turbulence === undefined ? 0.12 : wind.turbulence : 0
  // 空间波: 树的风场本来就是"沿风向跑的波"(uSpatialScale, 1/米), 布只有几十厘米长,
  // 于是布的各段吃到不同相位 —— 这才是彩带会拐出 S 形的原因。
  const spatial = wind ? (wind.spatialScale === undefined ? 0.22 : wind.spatialScale) : 0
  const perpX = -windZ
  const perpZ = windX
  // 阵风: 低频起伏, 让布不是匀速抖动
  const gust = 1 + gustW * Math.sin(time * gustS * 6.28 + cloth.phase)

  for (let i = 0; i < n; i++) {
    if (pinned[i]) continue
    const o3 = i * 3
    const px = p[o3], py = p[o3 + 1], pz = p[o3 + 2]
    const vx = (px - prev[o3]) * damping
    const vy = (py - prev[o3 + 1]) * damping
    const vz = (pz - prev[o3 + 2]) * damping
    // 沿风向的行波相位 (与树的风场同一个 spatialScale 口径)
    const ph = (px * windX + pz * windZ) * spatial * 6.283
      + time * speed * 1.6
      + py * 2.2
      + cloth.phase
    const wave = Math.sin(ph)
    const lat = Math.cos(ph * 1.7 + py * 1.3)
    // 自由端摆幅更大: 越靠下 (离挂点越远) 越吃风, 布因此形成"头稳脚甩"的弯曲
    const vRaw = (cloth.origin.y - py) / cloth.length
    const freeK = 0.55 + 0.75 * Math.max(0, Math.min(1, vRaw))
    const aMain = amp * gust * freeK * (1 + gustW * wave * 0.7)
    const ax = windX * aMain + perpX * amp * lat * turb
    const az = windZ * aMain + perpZ * amp * lat * turb
    prev[o3] = px
    prev[o3 + 1] = py
    prev[o3 + 2] = pz
    p[o3] = px + vx + ax * dt2
    p[o3 + 1] = py + vy + GRAVITY * dt2
    p[o3 + 2] = pz + vz + az * dt2
  }

  // 约束松弛: 两端各退一半 -> 布不会被单边拉扯而"跳走"; 顶边钉死所以整体挂在枝上
  const { ia, ib, rest } = cloth
  for (let it = 0; it < cloth.iterations; it++) {
    for (let k = 0; k < ia.length; k++) {
      const a = ia[k]
      const b = ib[k]
      const oa = a * 3
      const ob = b * 3
      let dx = p[ob] - p[oa]
      let dy = p[ob + 1] - p[oa + 1]
      let dz = p[ob + 2] - p[oa + 2]
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < 1e-12) continue
      const d = Math.sqrt(d2)
      const corr = ((d - rest[k]) / d) * 0.5
      dx *= corr
      dy *= corr
      dz *= corr
      const pa = pinned[a]
      const pb = pinned[b]
      if (pa && pb) continue
      // corr 已含 0.5: 两端都自由时各走一半; 一头钉死时另一头走全部 (×2),
      // 否则被钉住那头等于白让掉一半长度, 垂下来的布会短一截。
      const ka = pa ? 0 : pb ? 2 : 1
      const kb = pb ? 0 : pa ? 2 : 1
      p[oa] += dx * ka
      p[oa + 1] += dy * ka
      p[oa + 2] += dz * ka
      p[ob] -= dx * kb
      p[ob + 1] -= dy * kb
      p[ob + 2] -= dz * kb
    }
  }

  // 枝条胶囊碰撞: 布从枝下挂出, 起风时会往枝干方向翻, 不挡的话会穿进树皮
  const axis = cloth.branchAxis
  const capR = cloth.branchRadius + 0.006
  for (let i = 0; i < n; i++) {
    if (pinned[i]) continue
    const o3 = i * 3
    let rx = p[o3] - cloth.origin.x
    let ry = p[o3 + 1] - cloth.origin.y
    let rz = p[o3 + 2] - cloth.origin.z
    // 投影到轴线上 (只取挂点附近一段, 远处枝的曲率不用管)
    let t = rx * axis.x + ry * axis.y + rz * axis.z
    t = Math.max(-0.25, Math.min(0.25, t))
    const nx = cloth.origin.x + axis.x * t
    const ny = cloth.origin.y + axis.y * t
    const nz = cloth.origin.z + axis.z * t
    rx = p[o3] - nx
    ry = p[o3 + 1] - ny
    rz = p[o3 + 2] - nz
    const dist = Math.sqrt(rx * rx + ry * ry + rz * rz)
    if (dist > 1e-6 && dist < capR) {
      const s = capR / dist
      p[o3] = nx + rx * s
      p[o3 + 1] = ny + ry * s
      p[o3 + 2] = nz + rz * s
    }
  }
  cloth.time += dt
}

/**
 * 构建时预解算: 挂上去的布先自然垂坠好, 页面一打开就是"已经挂了一阵子"的形状,
 * 而不是一打开看见一块刚摊平的布往下掉。
 *
 * @param {object} cloth
 * @param {number} steps 步数 (建议 90 = 1.5 秒)
 * @param {object} wind
 */
export function settleCloth(cloth, steps, wind) {
  for (let i = 0; i < steps; i++) {
    // 时间推进: 预解算也吃风, 所以静止形状是"被风吹歪"的, 不是笔直一条
    const w = { ...wind, time: wind.time + i / 60 }
    stepCloth(cloth, 1 / 60, w)
  }
}

/**
 * 把布料质点写进几何的 position / normal 属性块。
 *
 * 几何是 non-indexed 的 (每格 6 个顶点), 句柄里按同样的顺序记了 6 个质点下标,
 * 所以这里只需要"逐格算一次法线, 6 个顶点共用", 不必调 computeVertexNormals。
 *
 * @param {object} handle { cloth, base, quads: Int32Array } — quads 每 6 个一组 (p0,p1,p2,p0,p2,p3)
 * @param {THREE.BufferAttribute} posAttr
 * @param {THREE.BufferAttribute|null} nrmAttr
 */
export function writeCloth(handle, posAttr, nrmAttr) {
  const { cloth, base, quads } = handle
  const p = cloth.p
  const pos = posAttr.array
  const nrm = nrmAttr && nrmAttr.array
  const cols = cloth.cols
  const rows = cloth.rows

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const q = (r * cols + c) * 6
      const v0 = pid(cols, r, c)
      const v1 = pid(cols, r + 1, c)
      const v2 = pid(cols, r + 1, c + 1)
      const v3 = pid(cols, r, c + 1)
      // 法线: 用四边形两条对角线的叉积 (比只用一条边稳, 布被拉扁时也不抖)
      const ax = p[v2 * 3] - p[v0 * 3]
      const ay = p[v2 * 3 + 1] - p[v0 * 3 + 1]
      const az = p[v2 * 3 + 2] - p[v0 * 3 + 2]
      const bx = p[v3 * 3] - p[v1 * 3]
      const by = p[v3 * 3 + 1] - p[v1 * 3 + 1]
      const bz = p[v3 * 3 + 2] - p[v1 * 3 + 2]
      let nx = ay * bz - az * by
      let ny = az * bx - ax * bz
      let nz = ax * by - ay * bx
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (nl > 1e-9) {
        nx /= nl
        ny /= nl
        nz /= nl
      } else {
        nx = 0
        ny = 1
        nz = 0
      }
      for (let k = 0; k < 6; k++) {
        const src = quads[q + k]
        const vi = base + q + k
        pos[vi * 3] = p[src * 3]
        pos[vi * 3 + 1] = p[src * 3 + 1]
        pos[vi * 3 + 2] = p[src * 3 + 2]
        if (nrm) {
          nrm[vi * 3] = nx
          nrm[vi * 3 + 1] = ny
          nrm[vi * 3 + 2] = nz
        }
      }
    }
  }
  posAttr.needsUpdate = true
  if (nrmAttr) nrmAttr.needsUpdate = true
}

/** 顶点数: 每格 6 个 non-indexed 顶点 */
export function clothVertexCount(cols, rows) {
  return cols * rows * 6
}
