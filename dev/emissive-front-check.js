/* 树叶 / 花朵 "自发光正面不生效" 回归复核 (真实应用场景)
 * ------------------------------------------------------------
 * 背景: three 的自发光原本加在 outgoingLight 上、再统一做 tone mapping。
 * 正面叶片被阳光照到很亮时这份加法会被 ACES 压掉, 只有背面/树下看得见 ->
 * 表现为"自发光仅背面生效"。修复后自发光改在 tone mapping 之后按显示空间合成。
 *
 * 本页在真实 App 里量:
 *   1) 自发光 0 -> 1 的像素差, 分别统计"正面三角形"和"背面三角形"覆盖的像素;
 *   2) 两者量级必须接近 (比值 0.82 ~ 1.25), 且两面都要有明显变化;
 *   3) 透光/反光/散光 依旧正反面都生效 (回归)。
 */
import * as THREE from 'three'

const R = []
let fail = 0
const line = (s) => { R.push(s); document.getElementById('out').textContent = R.join('\n') }
const check = (name, cond, detail = '') => {
  if (!cond) fail++
  line((cond ? '✔ ' : '✘ ') + name + (detail ? ' — ' + detail : ''))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, timeout = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) { try { if (fn()) return true } catch { } await sleep(100) }
  return false
}
const f = document.getElementById('f')
let win = null
f.addEventListener('load', () => { win = f.contentWindow })

function grab(S) {
  S.renderer.render(S.scene, S.camera)
  const src = S.renderer.domElement
  const c = document.createElement('canvas')
  c.width = src.width; c.height = src.height
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0)
  return ctx.getImageData(0, 0, c.width, c.height)
}

setTimeout(async () => {
  try {
    for (let i = 0; i < 200 && !win; i++) await sleep(100)
    await waitFor(() => win.__fastTree && win.__fastTree.ready && win.__fastTreeScene && win.__fastTreeSceneApi, 40000)
    const st = win.__fastTree, S = win.__fastTreeScene, api = win.__fastTreeSceneApi
    await sleep(800)
    const p = st.params

    /* ---------- 场景: 只留树叶, 保留默认灯光 (正面被照亮才是原 bug 条件) ---------- */
    p.leaves.enabled = true
    p.flower.enabled = false
    p.fruit.enabled = false
    p.particles.enabled = false
    p.fall.enabled = false
    p.litter.enabled = false
    p.scene.ground = false
    p.scene.grid = false
    p.scene.fog = false
    p.scene.gradient = false
    p.scene.stars = 0
    p.scene.background = '#000000'
    p.leafMat.texture = ''
    p.leafMat.alphaTest = 0
    p.leafMat.normalFromAlbedo = 0
    p.leafMat.backEnabled = false
    p.leafMat.emissive = 0
    p.leafMat.translucency = 0
    p.leafMat.specular = 0
    p.leafMat.scatter = 0
    p.leafMat.emissiveColor = '#ffffff'
    api.rebuildNow(false)
    await sleep(700)
    S.sky.visible = false

    const leafMat = S.materials.leaf
    const meshes = []
    for (const c of (S._cullChunks || [])) if (c.kind === 'leaf') meshes.push(c.mesh)
    if (S.leafMesh) { S.leafMesh.layers.enable(0); meshes.push(S.leafMesh) }
    S.scene.traverse((o) => { if (o.isMesh && !meshes.includes(o)) o.visible = false })
    for (const m of meshes) m.visible = true
    check('场景里有树叶几何', meshes.length > 0, String(meshes.length))

    /* ---------- 正面/背面掩码 ---------- */
    const wm = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide })
    for (const m of meshes) m.material = wm
    wm.side = THREE.FrontSide; wm.needsUpdate = true
    await sleep(120)
    const frontMask = grab(S)
    wm.side = THREE.BackSide; wm.needsUpdate = true
    await sleep(120)
    const backMask = grab(S)
    for (const m of meshes) m.material = leafMat

    const opaque = (d, i) => (d[i] + d[i + 1] + d[i + 2]) > 24
    const dAt = (A, B, i) => Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])
    function measure(A, B) {
      const out = { front: { n: 0, sum: 0 }, back: { n: 0, sum: 0 } }
      for (let i = 0; i < frontMask.data.length; i += 4) {
        if (opaque(frontMask.data, i)) { out.front.n++; out.front.sum += dAt(A, B, i) }
        if (opaque(backMask.data, i)) { out.back.n++; out.back.sum += dAt(A, B, i) }
      }
      out.front.mean = out.front.n ? out.front.sum / out.front.n : 0
      out.back.mean = out.back.n ? out.back.sum / out.back.n : 0
      return out
    }
    async function deltaOf(apply, reset) {
      reset()
      S.updateMaterialParams(p)
      await sleep(160)
      const A = grab(S)
      apply()
      S.updateMaterialParams(p)
      await sleep(160)
      const B = grab(S)
      return measure(A, B)
    }

    const zero = () => {
      p.leafMat.emissive = 0
      p.leafMat.translucency = 0
      p.leafMat.specular = 0
      p.leafMat.scatter = 0
    }

    /* ---------- 1. 自发光 强度 0 -> 1 ---------- */
    line('===== 自发光 (0 -> 1) =====')
    const em = await deltaOf(() => { p.leafMat.emissive = 1 }, zero)
    line(`  正面 Δ=${em.front.mean.toFixed(1)} (px=${em.front.n}) | 背面 Δ=${em.back.mean.toFixed(1)} (px=${em.back.n})`)
    check('自发光: 正面有明显变化 (Δ>20)', em.front.mean > 20, em.front.mean.toFixed(1))
    check('自发光: 背面有明显变化 (Δ>20)', em.back.mean > 20, em.back.mean.toFixed(1))
    const emRatio = em.back.mean > 0 ? em.front.mean / em.back.mean : 0
    line(`  正面/背面 比值 = ${emRatio.toFixed(3)} (修复前约 0.73; 现在应接近 1)`)
    check('自发光: 正面/背面量级一致 (0.82 ~ 1.25)', emRatio > 0.82 && emRatio < 1.25, emRatio.toFixed(3))

    /* ---------- 2. 半强度也一致 ---------- */
    line('\n===== 自发光 (0 -> 0.5) =====')
    const em5 = await deltaOf(() => { p.leafMat.emissive = 0.5 }, zero)
    const em5Ratio = em5.back.mean > 0 ? em5.front.mean / em5.back.mean : 0
    line(`  正面 Δ=${em5.front.mean.toFixed(1)} | 背面 Δ=${em5.back.mean.toFixed(1)} | 比值=${em5Ratio.toFixed(3)}`)
    check('半强度: 正面/背面量级一致 (0.82 ~ 1.25)', em5Ratio > 0.82 && em5Ratio < 1.25, em5Ratio.toFixed(3))

    /* ---------- 3. 透光/反光/散光回归 ---------- */
    line('\n===== 透光 / 反光 / 散光 回归 =====')
    const tr = await deltaOf(() => { p.leafMat.translucency = 1 }, zero)
    const sp = await deltaOf(() => { p.leafMat.specular = 1.5 }, zero)
    const sc = await deltaOf(() => { p.leafMat.scatter = 1.5 }, zero)
    line(`  透光: 正面 Δ=${tr.front.mean.toFixed(1)} 背面 Δ=${tr.back.mean.toFixed(1)}`)
    line(`  反光: 正面 Δ=${sp.front.mean.toFixed(1)} 背面 Δ=${sp.back.mean.toFixed(1)}`)
    line(`  散光: 正面 Δ=${sc.front.mean.toFixed(1)} 背面 Δ=${sc.back.mean.toFixed(1)}`)
    check('透光正反面都生效', tr.front.mean > 6 && tr.back.mean > 6)
    check('反光正反面都生效', sp.front.mean > 6 && sp.back.mean > 6)
    check('散光正反面都生效', sc.front.mean > 6 && sc.back.mean > 6)

    /* ---------- 4. 关闭自发光 -> 不残留 ---------- */
    zero()
    S.updateMaterialParams(p)
    await sleep(120)
    line('\n结果: ' + (fail ? 'EMISSIVE-FRONT-FAIL ' + fail : 'EMISSIVE-FRONT-OK'))
    document.title = (fail ? 'EMISSIVE-FRONT-FAIL(' + fail + ')' : 'EMISSIVE-FRONT-OK') + ' :: ' + JSON.stringify({
      front: +em.front.mean.toFixed(1), back: +em.back.mean.toFixed(1), ratio: +emRatio.toFixed(3),
      ratioHalf: +em5Ratio.toFixed(3),
    })
  } catch (e) {
    document.title = 'EMISSIVE-FRONT-EX :: ' + (e && e.stack ? e.stack : e).toString().slice(0, 900)
    line('EX: ' + (e && e.stack ? e.stack : e))
  }
}, 2000)
