<template>
  <Section title="随机种子 · 自动生成" hint="Seed / Auto">
    <div class="seed-box">
      <span class="muted">种子</span>
      <input type="number" min="1" :value="p.seed" @change="onSeedChange($event.target.value)" />
      <button class="btn small" @click="onRandomSeed" title="换一个随机种子并同步刷新风场">🎲 换种子</button>
    </div>

    <SliderRow label="混乱度 (个体差异)" v-model="p.auto.chaos" :min="0" :max="1" :step="0.05"
      hint="0 = 规整, 1 = 狂野。只影响自动生成" />

    <SelectRow label="指定树种" v-model="autoTypeModel" :options="typeOptions"
      hint="留空 = 按权重随机挑树种" />

    <div class="inline">
      <button class="btn primary" @click="onAuto">✨ 自动生成一棵树</button>
      <span class="tag on">{{ archetypeLabel }}</span>
    </div>

    <div class="presets">
      <div v-for="pr in PRESETS" :key="pr.id" class="preset" :class="{ active: archetypeId === pr.id }"
        @click="onPreset(pr.id)">
        <span class="ico">{{ pr.icon }}</span>
        <span>{{ pr.name }}</span>
      </div>
    </div>

    <div class="inline">
      <button class="btn small" :disabled="!canUndo.value" @click="undo">↶ 撤销</button>
      <button class="btn small" :disabled="!canRedo.value" @click="redo">↷ 重做</button>
      <button class="btn small ghost" @click="onResetAll">恢复默认</button>
    </div>
    <p class="muted" style="margin: 0">
      同一组参数 + 同一个种子 = 完全一致的一棵树。可在「导出」页保存参数 JSON 复现。
    </p>
  </Section>
</template>

<script setup>
import { computed } from 'vue'
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import { PRESETS } from '../../core/presets.js'
import { defaultParams } from '../../core/params.js'
import {
  state, doAutoGenerate, doApplyPreset, randomizeSeed, setSeed,
  undo, redo, canUndo, canRedo, pushUndo, archetypeLabel,
} from '../../store/treeStore.js'

const p = state.params
const archetypeId = computed(() => state.archetype)

const typeOptions = [
  { value: '', label: '随机 (按权重)' },
  ...PRESETS.map((x) => ({ value: x.id, label: `${x.icon} ${x.name}` })),
]

const autoTypeModel = computed({
  get: () => state.autoType || '',
  set: (v) => { state.autoType = v || null },
})

function onSeedChange(v) {
  pushUndo()
  setSeed(Number(v))
}

function onRandomSeed() {
  randomizeSeed()
  state.frameVersion++
}

function onAuto() {
  doAutoGenerate({})
  state.frameVersion++
}

function onPreset(id) {
  doApplyPreset(id)
  state.frameVersion++
}

function onResetAll() {
  pushUndo()
  state.params = defaultParams()
  state.frameVersion++
}
</script>

<style scoped>
.preset.active { border-color: var(--accent); color: #eafff7; }
</style>
