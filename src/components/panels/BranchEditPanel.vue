<template>
  <Section title="单枝编辑" hint="Branch Edit" :default-collapsed="false">
    <div class="muted" style="margin: 0 0 6px">
      选中 {{ branchName || `分支 #${branchIndex}` }}（骨架分支 #{{ branchIndex }}）
    </div>
    <SliderRow label="半径倍率" :model-value="val('radiusScale', 1)"
      @update:model-value="setVal('radiusScale', $event)"
      :min="0.2" :max="3" :step="0.01"
      hint="只影响这根枝条及其子枝的半径；1 = 原始" />
    <div class="row-head"><label>移动 (m)</label></div>
    <SliderRow label="X" :model-value="val('moveX', 0)" @update:model-value="setVal('moveX', $event)" :min="-2" :max="2" :step="0.01" />
    <SliderRow label="Y" :model-value="val('moveY', 0)" @update:model-value="setVal('moveY', $event)" :min="-2" :max="2" :step="0.01" />
    <SliderRow label="Z" :model-value="val('moveZ', 0)" @update:model-value="setVal('moveZ', $event)" :min="-2" :max="2" :step="0.01" />
    <div class="row-head"><label>旋转 (°，以枝基为轴)</label></div>
    <SliderRow label="X" :model-value="val('rotX', 0)" @update:model-value="setVal('rotX', $event)" :min="-180" :max="180" :step="1" />
    <SliderRow label="Y" :model-value="val('rotY', 0)" @update:model-value="setVal('rotY', $event)" :min="-180" :max="180" :step="1" />
    <SliderRow label="Z" :model-value="val('rotZ', 0)" @update:model-value="setVal('rotZ', $event)" :min="-180" :max="180" :step="1" />
    <SliderRow label="扭曲" :model-value="val('twist', 0)" @update:model-value="setVal('twist', $event)"
      :min="-360" :max="360" :step="1" unit="°"
      hint="沿枝条长度逐渐扭转截面；枝基 0°，枝梢最大" />
    <div class="row-head">
      <span class="muted">编辑只作用于当前骨架分支；平移/旋转后枝基会离开原父枝位置。</span>
      <button class="btn small" @click="reset">↺ 重置该枝</button>
    </div>
  </Section>
</template>

<script setup>
import { computed } from 'vue'
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import { state } from '../../store/treeStore.js'

const props = defineProps({
  branchIndex: { type: Number, default: null },
  branchName: { type: String, default: '' },
})

const key = computed(() => String(props.branchIndex))
const edit = computed(() => {
  const all = state.params.branchEdits
  return (all && all[key.value]) || {}
})

function val (name, fallback) {
  const v = edit.value[name]
  return Number.isFinite(Number(v)) ? Number(v) : fallback
}

function setVal (name, value) {
  if (props.branchIndex === null) return
  const all = state.params.branchEdits || (state.params.branchEdits = {})
  all[key.value] = { ...(all[key.value] || {}), [name]: Number(value) }
}

function reset () {
  if (props.branchIndex === null) return
  const all = state.params.branchEdits
  if (all) delete all[key.value]
}
</script>
