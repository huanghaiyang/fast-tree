<template>
  <Section title="附属物 · 挂件" hint="Attachments: 鸟巢 / 槲寄生 / 彩带 (全树种通用)" :default-collapsed="false"
    @pointerdown="onDown" @input="onInput">
    <ToggleRow label="启用附属物（鸟巢 / 槲寄生 / 彩带）" v-model="A.enabled"
      hint="总开关：关掉后鸟巢/槲寄生/彩带全部不生成（竹笋在「种子 → 竹子特有参数」里单独控制）" />
    <SliderRow label="鸟巢数量" v-model="A.nest" :min="0" :max="3" :step="1" unit="个"
      hint="编织碗形巢：实体碗壁 + 内壁 + 巢口一圈厚度，表面缠 30+ 根交叉巢枝；所有树种通用" />
    <SliderRow label="槲寄生数量" v-model="A.mistletoe" :min="0" :max="4" :step="1" unit="团"
      hint="木质梢 + 对生肥厚叶 + 珍珠色浆果；挂在枝条下方" />
    <SliderRow label="彩带数量" v-model="A.ribbons" :min="0" :max="6" :step="1" unit="条"
      hint="布料彩带（Verlet 质点网格），顶边钉在枝上，重力 + 风逐帧求解，下垂/扭转是算出来的" />
    <ColorRow label="彩带颜色" v-model="A.ribbonColor" />
    <SliderRow label="彩带长度" v-model="A.ribbonLength" :min="0.15" :max="2" :step="0.01" unit="m"
      hint="随机散布的彩带会在此基础上 ±18% 抖动；手工件可在下方逐条覆盖" />
    <SliderRow label="彩带柔软度" v-model="A.ribbonSoftness" :min="0" :max="1" :step="0.01"
      hint="0 = 硬挺绸带（保留剪切约束、松弛轮数多、吃风少）；1 = 软塌缎带（能沿宽度折起来、摆幅更大）" />

    <p class="muted" style="margin: 6px 0 2px">
      上面的数量是"随机散布"；下面这一组是<b>逐件手工摆放</b>：点「＋ 点选摆放」后在视口里点一根树干或枝条，
      挂件就落在点击的位置（按分支下标 + 沿枝比例记录）。两者同时生成，互不影响。
    </p>
    <div class="inline" style="margin-top: 4px">
      <select v-model="state.attachmentType" class="input" style="width: 108px">
        <option value="nest">鸟巢</option>
        <option value="mistletoe">槲寄生</option>
        <option value="ribbon">彩带</option>
      </select>
      <button class="btn small" :class="{ active: state.attachmentPicking }" @click="togglePicking">
        {{ state.attachmentPicking
          ? (state.attachmentPickMode === 'move' ? '点选新位置…' : '点选视口中的枝条…')
          : '＋ 点选摆放' }}
      </button>
      <span class="muted" v-if="items.length">{{ items.length }} 件</span>
    </div>

    <div v-if="items.length" class="row-head" style="margin-top: 6px">
      <label>编辑挂件</label>
      <select class="input" style="width: 150px" :value="activeId" @change="activeId = $event.target.value">
        <option v-for="(it, i) in items" :key="it.id" :value="it.id">
          {{ i + 1 }}. {{ TYPE_LABEL[it.type] || '挂件' }}
        </option>
      </select>
    </div>

    <template v-if="active">
      <SelectRow label="挂件类型" :model-value="active.type" :options="typeOptions"
        @update:model-value="changeType" />
      <SliderRow label="枝条位置" v-model="active.t" :min="0" :max="1" :step="0.01"
        hint="沿宿主枝条的位置：0 = 枝基（靠近主干），1 = 枝梢；拖动时树形暂停重建，松手统一刷新" />
      <SliderRow label="挂件尺寸" v-model="active.size" :min="0.2" :max="2.5" :step="0.05"
        hint="相对默认尺寸的倍率 (1 = 默认)；鸟巢/槲寄生/彩带共用这一个倍率" />
      <template v-if="active.type === 'ribbon'">
        <ColorRow label="彩带颜色（本条）" v-model="active.color" />
        <SliderRow label="彩带长度（本条）" v-model="active.length" :min="0.15" :max="2.5" :step="0.01" unit="m"
          hint="只影响这一条彩带，单位是米（还与上面的「挂件尺寸」相乘）" />
        <SliderRow label="彩带柔软度（本条）" v-model="active.softness" :min="0" :max="1" :step="0.01"
          hint="只影响这一条彩带：硬挺（剪切约束保留）/ 软塌（能折起来、摆幅大）；拖动时暂停重建，松手刷新" />
      </template>
      <p class="muted" style="margin: 2px 0 4px">
        宿主：第 {{ active.node + 1 }} 根枝 · 位置 {{ Math.round((active.t || 0) * 100) }}%
      </p>
      <div class="inline">
        <button class="btn small" @click="moveActive">重新点选位置</button>
        <button class="btn small" @click="removeActive">删除当前挂件</button>
        <button class="btn small" @click="clearAll">清空全部手工挂件</button>
      </div>
    </template>
    <p v-else-if="!items.length" class="muted" style="margin: 6px 0 0">
      还没有手工挂件。点「＋ 点选摆放」，然后在视口里点一下树干或枝条即可（所有树种通用）。
    </p>
  </Section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import Section from './ui/Section.vue'
import SliderRow from './ui/SliderRow.vue'
import ToggleRow from './ui/ToggleRow.vue'
import ColorRow from './ui/ColorRow.vue'
import SelectRow from './ui/SelectRow.vue'
import {
  state, sceneApi, pushUndo, removeAttachment, clearAttachments, setAttachmentPicking,
} from '../store/treeStore.js'

// 用 computed 而不是 `state.params.attachments`: 撤销/导入参数时会整体替换 state.params,
// 持有旧对象引用会让滑杆写到一棵已经被丢弃的参数树上。
const A = computed(() => state.params.attachments)
const items = computed(() => (A.value && Array.isArray(A.value.items) ? A.value.items : []))
const activeId = computed({
  get: () => state.activeAttachmentId || '',
  set: (v) => { state.activeAttachmentId = v },
})
const active = computed(() => items.value.find((it) => it.id === state.activeAttachmentId) || null)

const TYPE_LABEL = { nest: '鸟巢', mistletoe: '槲寄生', ribbon: '彩带' }
const typeOptions = [
  { value: 'nest', label: '鸟巢 (编织碗形)' },
  { value: 'mistletoe', label: '槲寄生 (叶+浆果)' },
  { value: 'ribbon', label: '彩带 (布料下垂)' },
]

/** 切换类型算一次可撤销编辑 (类型决定几何形态, 属于离散改动) */
function changeType(v) {
  if (!active.value || active.value.type === v) return
  pushUndo()
  active.value.type = v
  // 旧存档/别处新建的实例可能没有彩带三个字段: 切到彩带时补上, 滑杆才有抓手
  if (v === 'ribbon') {
    if (!active.value.color) active.value.color = A.value.ribbonColor || '#c81f1f'
    if (!Number.isFinite(Number(active.value.length)) || !active.value.length) {
      active.value.length = A.value.ribbonLength || 0.75
    }
    if (active.value.softness === undefined || active.value.softness === null) {
      active.value.softness = A.value.ribbonSoftness === undefined ? 0.55 : A.value.ribbonSoftness
    }
  }
}

/** 开/关点选摆放模式; 视口层监听窗口 Escape 时也会自己退出 */
function togglePicking() {
  if (state.attachmentPicking) setAttachmentPicking(false)
  else setAttachmentPicking(true, 'new')
}

/** 把当前选中的挂件挪到视口里新点的位置 (类型/尺寸不变, 只换宿主) */
function moveActive() {
  if (!active.value) return
  setAttachmentPicking(true, 'move')
}

/** 删除当前挂件, 选中项自动移到相邻一件 (store 里处理) */
function removeActive() {
  if (active.value) removeAttachment(active.value.id)
}

function clearAll() {
  clearAttachments()
}

/* ---------------- 性能: 拖动位置/尺寸时暂停重建 ----------------
 * 挂件属于几何参数, 每改一次都重建整树; 连续拖滑杆会把主线程占满。
 * 与 ForcesPanel 共用 state.previewHold 计数, 松手后 Viewport 统一补一次重建。 */
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
function onDown(e) {
  // 按钮/下拉会立即改变列表, 不进入 hold, 让重建马上发生。
  if (e.target.closest('button, select')) return
  beginHold()
}
function onInput() {
  beginHold()
  endHoldSoon()
}
function onWindowPointerUp() { endHold() }
function onKeyDown(e) {
  if (e.key === 'Escape' && state.attachmentPicking) setAttachmentPicking(false)
}

// 选中项被删除/撤销/重新导入后, 保证 activeAttachmentId 始终指向存在的挂件
watch(() => items.value.map((it) => it.id).join('|'), () => {
  if (!items.value.some((it) => it.id === state.activeAttachmentId)) {
    state.activeAttachmentId = items.value.length ? items.value[0].id : ''
  }
}, { immediate: true })

// 场景重建 (切后端/首帧) 后重新接管点选开关; 面板可能比 Viewport 先挂载
watch([() => state.attachmentPicking, () => state.ready], () => {
  if (sceneApi.setAttachmentPicking) sceneApi.setAttachmentPicking(state.attachmentPicking)
}, { immediate: true })

onMounted(() => {
  window.addEventListener('pointerup', onWindowPointerUp, true)
  window.addEventListener('pointercancel', onWindowPointerUp, true)
  window.addEventListener('keydown', onKeyDown)
  if (sceneApi.setAttachmentPicking) sceneApi.setAttachmentPicking(state.attachmentPicking)
  requestAnimationFrame(() => {
    if (sceneApi.setAttachmentPicking) sceneApi.setAttachmentPicking(state.attachmentPicking)
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', onWindowPointerUp, true)
  window.removeEventListener('pointercancel', onWindowPointerUp, true)
  window.removeEventListener('keydown', onKeyDown)
  endHold()
  setAttachmentPicking(false)
  if (sceneApi.setAttachmentPicking) sceneApi.setAttachmentPicking(false)
})
</script>
