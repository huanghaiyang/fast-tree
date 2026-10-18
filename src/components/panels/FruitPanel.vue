<template>
  <Section title="果实 / 种子" hint="Fruit">
    <ToggleRow label="启用果实" v-model="f.enabled" />
    <template v-if="f.enabled">
      <SelectRow label="果实类型" v-model="f.type" :options="typeOptions" />
      <SliderRow label="果实大小" v-model="f.size" :min="0.03" :max="0.5" :step="0.005" unit="m" />
      <SliderRow label="大小随机" v-model="f.sizeVariance" :min="0" :max="0.6" :step="0.02" />
      <SliderRow label="每条枝条果实簇数" v-model="f.perBranch" :min="1" :max="6" :step="1" />
      <SliderRow label="每簇果实数" v-model="f.clusterCount" :min="1" :max="5" :step="1"
        hint="参考图: 橡果 2~3 个一簇" />
      <SliderRow label="果簇半径" v-model="f.clusterRadius" :min="0.01" :max="0.4" :step="0.005" unit="m" />
      <SliderRow label="下垂程度" v-model="f.droop" :min="0" :max="1.2" :step="0.02"
        hint="橡果挂在枝条下方" />
      <SliderRow label="结果概率 (逐枝)" v-model="f.chance" :min="0.05" :max="1" :step="0.05" />
      <SliderRow label="整树数量上限" v-model="f.maxCount" :min="20" :max="1500" :step="10"
        hint="控制面数: 每个果实约 300 面" />
      <div class="grid-2">
        <ColorRow label="坚果色" v-model="f.color" />
        <ColorRow label="壳斗帽色" v-model="f.capColor" />
      </div>
      <SliderRow label="颜色随机" v-model="f.colorVariance" :min="0" :max="0.6" :step="0.02" />
      <SliderRow label="周向分段" v-model="f.radial" :min="5" :max="16" :step="1" hint="越大越圆, 面数越高" />
      <p class="muted" style="margin: 0">
        果实用旋转体建模 (坚果 + 粗糙壳斗帽 + 果柄), 顶点色区分坚果/壳斗, 与树皮共用材质。
      </p>
      <div class="chips">
        <span class="muted">挂果层级</span>
        <button v-for="(on, i) in f.levels" :key="i" class="chip" :class="{ active: on }"
          @click="f.levels[i] = !on">L{{ i + 1 }}</button>
      </div>
    </template>
  </Section>
</template>

<script setup>
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import ColorRow from '../ui/ColorRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import { state } from '../../store/treeStore.js'

const f = state.params.fruit
const typeOptions = [
  { value: 'acorn', label: '🌰 橡果 (坚果 + 壳斗帽)' },
  { value: 'nut', label: '🥜 坚果' },
  { value: 'berry', label: '🫐 浆果' },
  { value: 'cone', label: '🌲 球果' },
]
</script>

<style scoped>
:deep(.inline), :deep(.chips) { flex-wrap: wrap; }
:deep(.row), :deep(.grid-2) { min-width: 0; }
:deep(select), :deep(input), :deep(textarea) { max-width: 100%; }
:deep(.row-head label) { overflow: hidden; text-overflow: ellipsis; }

.chips { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.chip {
  padding: 2px 8px; font-size: 11px; color: var(--text-2);
  background: var(--bg-3); border: 1px solid var(--line); border-radius: 6px; cursor: pointer;
}
.chip.active { border-color: var(--accent); color: #eafff7; }
</style>
