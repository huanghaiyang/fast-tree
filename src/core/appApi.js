/**
 * 应用命令执行器 + 桥客户端
 * ------------------------------------------------------------
 * 实现 src/core/apiRegistry.js 里声明的全部命令, 通过轮询本地桥
 * (scripts/app-bridge-server.mjs, 默认 127.0.0.1:5275) 接收外部调用。
 * => MCP 客户端 / 大模型 / 脚本 都走这一条通道, 能力面与应用功能一致。
 */
import {
  state, sceneApi,
  applyClassification, setSeed, randomizeSeed, randomClassification,
  applyLeafCard, applyFlowerCard, doGenerateImpostor,
  undo, redo, getNodeModel, selectNodes, selectGroup, clearSelection,
  importParamsJSON,
} from '../store/treeStore.js'
import { SPECIES, GROWTH_STAGES, SEASONS } from './species.js'
import { LEAF_CARDS } from './leafCards.generated.js'
import { BARK_TEXTURES, BARK_SETS } from './barkTextures.js'
import { COMMAND_NAMES } from './apiRegistry.js'

const BRIDGE = 'http://127.0.0.1:5275'
const setAt = (obj, path, value) => {
  const parts = path.split('.')
  let o = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (o[k] == null) o[k] = {}
    o = o[k]
  }
  o[parts[parts.length - 1]] = value
}
const pickCard = (id, batch) => LEAF_CARDS.find((c) => c.id === id) || (batch ? LEAF_CARDS.find((c) => c.batch === batch) : null)

export const COMMAND_HANDLERS = {
  'app.help': () => ({ commands: COMMAND_NAMES }),
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
  'app.get_params': (a) => (a?.group ? state.params[a.group] ?? null : state.params),
  'app.set_params': (a) => {
    const patch = a?.patch || {}
    const keys = Object.keys(patch)
    for (const k of keys) setAt(state.params, k, patch[k])
    return { applied: keys.length, keys }
  },
  'app.export_params': () => ({ json: JSON.stringify(state.params) }),
  'app.import_params': (a) => {
    const ok = importParamsJSON(String(a?.json || ''))
    return { imported: !!ok }
  },
  'app.list_species': () => ({
    species: SPECIES.map((s) => ({ id: s.id, name: s.name })),
    stages: GROWTH_STAGES.map((s) => s.id || s),
    seasons: SEASONS.map((s) => s.id || s),
    combinations: SPECIES.length * GROWTH_STAGES.length * SEASONS.length,
  }),
  'app.apply_preset': (a) => {
    applyClassification(a.species, a.stage, a.season)
    return { species: a.species, stage: a.stage, season: a.season }
  },
  'app.set_species': (a) => {
    applyClassification(a.species, state.params.auto?.stage, state.params.auto?.season)
    return { species: a.species }
  },
  'app.set_stage': (a) => {
    applyClassification(state.archetype, a.stage, state.params.auto?.season)
    return { stage: a.stage }
  },
  'app.set_season': (a) => {
    applyClassification(state.archetype, state.params.auto?.stage, a.season)
    return { season: a.season }
  },
  'app.randomize': (a) => {
    if (a?.all) randomClassification()
    else randomizeSeed()
    return { species: state.archetype, seed: state.params.seed }
  },
  'app.set_seed': (a) => {
    setSeed(Math.round(Number(a.seed) || 0))
    return { seed: state.params.seed }
  },
  'app.rebuild': () => {
    sceneApi.rebuildNow(true)
    return { rebuilt: true }
  },
  'app.undo': () => { undo(); return { undone: true } },
  'app.redo': () => { redo(); return { redone: true } },
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
  'app.set_growth': (a) => {
    if (a?.value !== undefined) state.params.growth = Math.max(0, Math.min(1, a.value))
    if (a?.auto !== undefined) state.params.growthAuto = !!a.auto
    if (a?.speed !== undefined) state.params.growthSpeed = a.speed
    return { growth: state.params.growth, auto: state.params.growthAuto, speed: state.params.growthSpeed }
  },
  'app.set_lod': (a) => {
    if (a?.maxLeaves !== undefined) state.params.lod.maxLeaves = Math.max(0, Math.round(a.maxLeaves))
    return { maxLeaves: state.params.lod.maxLeaves }
  },
  'app.list_leaf_cards': (a) => {
    let list = LEAF_CARDS
    if (a?.batch) list = list.filter((c) => c.batch === a.batch)
    const limit = Math.max(1, Math.min(200, Math.round(a?.limit || 40)))
    return { total: list.length, batch: a?.batch || 'all', sample: list.slice(0, limit).map((c) => ({ id: c.id, url: c.url, batch: c.batch })) }
  },
  'app.apply_leaf_card': (a) => {
    const card = pickCard(a?.id, a?.batch)
    if (!card) return { error: '未找到卡片 (可先 app.list_leaf_cards)' }
    applyLeafCard(card.id)
    return { applied: card.id, url: card.url, target: 'leaf' }
  },
  'app.apply_flower_card': (a) => {
    const card = pickCard(a?.id, a?.batch)
    if (!card) return { error: '未找到卡片 (可先 app.list_leaf_cards)' }
    applyFlowerCard(card.id)
    return { applied: card.id, url: card.url, target: 'flower' }
  },
  'app.list_bark_textures': (a) => {
    let list = BARK_TEXTURES
    if (a?.batch) list = list.filter((t) => t.batch === a.batch)
    return {
      total: list.length,
      batches: BARK_SETS.map((s) => ({ id: s.id, name: s.name, rows: s.rows, cols: s.cols })),
      sample: list.slice(0, 40).map((t) => ({ id: t.id, url: t.url })),
    }
  },
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
  'app.set_material': (a) => {
    const map = { bark: 'bark', leaf: 'leafMat', flower: 'flower' }
    const group = map[a?.target]
    if (!group) return { error: 'target 必须是 bark/leaf/flower' }
    const props = a?.props || {}
    for (const [k, v] of Object.entries(props)) setAt(state.params[group], k, v)
    return { target: a.target, applied: Object.keys(props) }
  },
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
  'app.select_node': (a) => {
    if (a?.group) { selectGroup(a.group); return { selected: a.group } }
    if (a?.id !== undefined) { selectNodes([a.id]); return { selected: a.id } }
    clearSelection()
    return { selected: null }
  },
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
  'app.screenshot': () => {
    const sc = window.__fastTreeScene
    const canvas = sc && sc.renderer && sc.renderer.domElement
    if (!canvas) return { error: '渲染器不可用' }
    sc.renderer.render(sc.scene, sc.camera)
    const url = canvas.toDataURL('image/png')
    return { dataUrl: url, bytes: Math.round(url.length * 0.75) }
  },
  'app.impostor': (a) => {
    const res = doGenerateImpostor({ mode: a?.mode || 'atlas', views: a?.views, size: a?.size, elevations: a?.elevations })
    return { meta: res.meta, width: res.width, height: res.height, coverage: res.coverage, dataUrl: res.dataUrl }
  },
  'app.export_model': (a) => {
    const fmt = (a?.format || 'glb').toLowerCase()
    const name = a?.name || `tree-${Date.now()}`
    if (fmt === 'obj') sceneApi.exportOBJ(name)
    else sceneApi.exportGLB(name)
    return { format: fmt, name }
  },
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

let timer = null
let connected = false
let consumerId = ''
const COMMAND_LIST = Object.keys(COMMAND_HANDLERS)
export function bridgeStatus() {
  return { connected, url: BRIDGE }
}
export function startBridgeClient() {
  if (timer) return
  window.__fastTreeCommandApi = { run: runCommand, handlers: COMMAND_LIST }
  // 向桥注册本实例的能力 (多标签页时桥只把命令发给能力最全的实例)
  fetch(BRIDGE + '/bridge/hello', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands: COMMAND_LIST, path: location.pathname, version: COMMAND_LIST.length + '/33' }),
  })
    .then((r) => r.json())
    .then((j) => { if (j && j.consumerId) consumerId = j.consumerId })
    .catch(() => {})
  timer = setInterval(async () => {
    try {
      const res = await fetch(`${BRIDGE}/bridge/poll?id=${encodeURIComponent(consumerId)}`, { cache: 'no-store' })
      const json = await res.json()
      connected = true
      for (const c of json.commands || []) {
        const r = await runCommand(c.name, c.args)
        fetch(`${BRIDGE}/bridge/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: c.id, ...r }),
        }).catch(() => {})
      }
    } catch (e) {
      connected = false
    }
  }, 400)
}
export function stopBridgeClient() {
  if (timer) clearInterval(timer)
  timer = null
  connected = false
}
