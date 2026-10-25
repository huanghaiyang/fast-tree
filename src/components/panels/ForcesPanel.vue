<template>
  <Section title="空间引导力" hint="Space Forces"
    @pointerdown="onPanelDown" @input="onPanelInput" @change="onPanelInput">
    <ToggleRow label="启用空间引导力" v-model="forces.enabled" />
    <p class="muted" style="margin: 2px 0 6px">
      吸引子让枝条主动靠近，排斥子（障碍物）让枝条绕开生长。位置单位为米，改完会重新生长整棵树。
    </p>
    <div class="inline">
      <button class="btn small" @click="add('attractor')">＋ 吸引子</button>
      <button class="btn small" @click="add('repulsor')">＋ 排斥子</button>
    </div>

    <div v-if="forces.items.length" class="row-head" style="margin-top: 6px">
      <label>编辑对象</label>
      <select class="input" style="width: 132px" :value="activeId" @change="activeId = $event.target.value">
        <option v-for="(it, i) in forces.items" :key="it.id" :value="it.id">
          {{ i + 1 }}. {{ it.type === 'attractor' ? '吸引子' : '排斥子' }} · {{ it.shape === 'sphere' ? '球' : '立方体' }}
        </option>
      </select>
    </div>

    <template v-if="active">
      <div class="level-tabs" style="margin: 4px 0 6px">
        <div class="level-tab" :class="{ active: gizmoMode === 'translate' }" @click="setMode('translate')">移动</div>
        <div class="level-tab" :class="{ active: gizmoMode === 'scale' }" @click="setMode('scale')">缩放</div>
        <div class="level-tab" :class="{ active: gizmoMode === 'rotate', disabled: !canRotate }"
          @click="setMode('rotate')">旋转</div>
      </div>
      <p class="muted" style="margin: 0 0 6px">
        在视口直接拖动 XYZ 轴，或点击力场球/方块切换对象。拖动期间树形暂停重建，松手后统一更新。
      </p>

      <SelectRow label="力场类型" v-model="active.type" :options="typeOptions" />
      <SelectRow v-if="active.type === 'repulsor'" label="力场形状" v-model="active.shape" :options="shapeOptions" />
      <SliderRow label="位置 X" v-model="active.x" :min="-20" :max="20" :step="0.1" unit="m" />
      <SliderRow label="位置 Y" v-model="active.y" :min="0" :max="20" :step="0.1" unit="m" />
      <SliderRow label="位置 Z" v-model="active.z" :min="-20" :max="20" :step="0.1" unit="m" />
      <SliderRow label="影响半径" v-model="active.radius" :min="0.2" :max="20" :step="0.1" unit="m" />
      <SliderRow label="力场强度" v-model="active.strength" :min="0" :max="2" :step="0.05" />
      <SliderRow label="衰减指数" v-model="active.falloff" :min="0.2" :max="4" :step="0.1" />
      <SliderRow label="实体尺寸" v-model="active.size" :min="0.05" :max="5" :step="0.05" unit="m" />
      <SliderRow v-if="canRotate" label="立方体高度" v-model="active.sizeY" :min="0.05" :max="10" :step="0.05" unit="m" />
      <template v-if="canRotate">
        <SliderRow label="旋转 X" v-model="active.rotX" :min="-180" :max="180" :step="1" unit="°" />
        <SliderRow label="旋转 Y" v-model="active.rotY" :min="-180" :max="180" :step="1" unit="°" />
        <SliderRow label="旋转 Z" v-model="active.rotZ" :min="-180" :max="180" :step="1" unit="°" />
      </template>
      <div class="inline" style="margin-top: 6px">
        <button class="btn small" @click="removeActive">删除当前对象</button>
      </div>
    </template>
    <p v-else-if="!forces.items.length" class="muted" style="margin: 6px 0 0">
      还没有力场对象，用上面的按钮添加一个。
    </p>
  </Section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import { state, sceneApi } from '../../store/treeStore.js'
import { defaultForceItem } from '../../core/forceField.js'

const forces = computed(() => state.params.forces)
const activeId = computed({
  get: () => state.activeForceId || '',
  set: (v) => { state.activeForceId = v },
})
const active = computed(() => {
  const list = forces.value && Array.isArray(forces.value.items) ? forces.value.items : []
  return list.find((it) => it.id === state.activeForceId) || null
})
const canRotate = computed(() => !!active.value && active.value.type === 'repulsor' && active.value.shape === 'cube')
const gizmoMode = ref('translate')

const typeOptions = [
  { value: 'attractor', label: '吸引子 (靠近)' },
  { value: 'repulsor', label: '排斥子 (绕开)' },
]
const shapeOptions = [
  { value: 'sphere', label: '球体' },
  { value: 'cube', label: '立方体' },
]

/* ---------------- 性能: 交互期间暂停重建 ----------------
 * 力场属于几何参数, 每次改动都会触发整棵树重建。滑块连续拖动时如果每帧重建,
 * 主线程会被长时间占满 (用户反馈的"特别卡")。
 * 做法: 指针按下/输入时 previewHold+1, 松手 (或输入停止 220ms) 后 -1;
 * 松手那一下 Viewport 的 watcher 会统一补一次重建。
 * previewHold 与贴图位置编辑器共用, 因此用计数而非布尔值。
 */
let holdActive = false
let idleTimer = 0
function beginHold() {
  if (holdActive) return
  holdActive = true
  state.previewHold = (state.previewHold || 0) + 1
}
function endHold() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0 }
  if (!holdActive) return
  holdActive = false
  state.previewHold = Math.max(0, (state.previewHold || 0) - 1)
}
function endHoldSoon() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(endHold, 220)
}
function onPanelDown(e) {
  // 按钮会立即改变对象列表, 不进入 hold, 让重建马上发生。
  if (e.target.closest('button, select')) return
  beginHold()
}
function onPanelInput() {
  beginHold()
  endHoldSoon()
}
function onWindowPointerUp() {
  endHold()
}

/** 把当前选中对象与模式同步给视口变换轴 */
function syncGizmo() {
  if (!sceneApi.setForceTransformGizmo) return
  const it = active.value
  if (!it) {
    sceneApi.setForceTransformGizmo({ show: false })
    return
  }
  sceneApi.setForceTransformGizmo({ show: true, id: it.id, mode: gizmoMode.value })
}
function setMode(m) {
  if (m === 'rotate' && !canRotate.value) return
  gizmoMode.value = m
}

/** 添加一个力场对象并选中它 */
function add(type) {
  const item = defaultForceItem(type, forces.value.items.length)
  forces.value.items.push(item)
  state.activeForceId = item.id
}

/** 删除当前选中的力场对象，并把选择移到相邻项 */
function removeActive() {
  const list = forces.value.items
  const i = list.findIndex((it) => it.id === activeId.value)
  if (i < 0) return
  list.splice(i, 1)
  const next = list[Math.min(i, list.length - 1)]
  state.activeForceId = next ? next.id : ''
}

// 对象被删除/重新载入后, 保证 activeForceId 始终指向一个存在的对象
watch(() => (forces.value && Array.isArray(forces.value.items) ? forces.value.items.map((it) => it.id).join('|') : ''), () => {
  const list = forces.value && Array.isArray(forces.value.items) ? forces.value.items : []
  if (!list.some((it) => it.id === state.activeForceId)) {
    state.activeForceId = list.length ? list[0].id : ''
  }
}, { immediate: true })

watch([() => active.value && active.value.id, gizmoMode], syncGizmo)

// 球体/吸引子没有可旋转的朝向: 切回移动模式, 避免轴看起来"转了但没变化"
watch(canRotate, (ok) => {
  if (!ok && gizmoMode.value === 'rotate') gizmoMode.value = 'translate'
})

// 场景就绪后再接管 XYZ 轴; ready 变化时补一次 (面板可能早于 Viewport 挂载)
watch(() => state.ready, () => {
  if (sceneApi.setForcePicking) sceneApi.setForcePicking(true)
  syncGizmo()
}, { immediate: true })

onMounted(() => {
  window.addEventListener('pointerup', onWindowPointerUp, true)
  window.addEventListener('pointercancel', onWindowPointerUp, true)
  if (sceneApi.setForcePicking) sceneApi.setForcePicking(true)
  syncGizmo()
  // 面板可能比 Viewport 的 sceneApi 先挂载: 下一帧再补一次接管
  requestAnimationFrame(() => {
    if (sceneApi.setForcePicking) sceneApi.setForcePicking(true)
    syncGizmo()
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', onWindowPointerUp, true)
  window.removeEventListener('pointercancel', onWindowPointerUp, true)
  endHold()
  if (sceneApi.setForcePicking) sceneApi.setForcePicking(false)
  if (sceneApi.setForceTransformGizmo) sceneApi.setForceTransformGizmo({ show: false })
})
</script>
