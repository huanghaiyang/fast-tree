<template>
  <Section title="树种 · 生长阶段 · 季节" hint="Species / Stage / Season">
    <div class="axis">
      <div class="row-head"><label>树种</label></div>
      <div class="chips">
        <button v-for="sp in SPECIES" :key="sp.id" class="chip" :class="{ active: cur.species === sp.id }"
          :title="sp.desc" @click="pick('species', sp.id)">
          <span>{{ sp.icon }}</span>{{ sp.name }}
        </button>
      </div>
    </div>

    <div class="axis">
      <div class="row-head"><label>生长阶段</label></div>
      <div class="chips">
        <button v-for="st in GROWTH_STAGES" :key="st.id" class="chip" :class="{ active: cur.stage === st.id }"
          :title="`${st.years} — ${st.desc}`" @click="pick('stage', st.id)">
          <span>{{ st.icon }}</span>{{ st.name }}
        </button>
      </div>
    </div>

    <div class="axis">
      <div class="row-head"><label>季节</label></div>
      <div class="chips">
        <button v-for="se in SEASONS" :key="se.id" class="chip" :class="{ active: cur.season === se.id }"
          :title="seasonTitle(se)" @click="pick('season', se.id)">
          <span>{{ (seasonProfile(speciesObj, se.id) || se).icon }}</span>{{ (seasonProfile(speciesObj, se.id) || se).name }}
        </button>
      </div>
    </div>

    <div class="inline">
      <span class="tag on">{{ classificationName(cur.species, cur.stage, cur.season) }}</span>
      <button class="btn small" @click="onRandomCombo" title="随机换一组树种/阶段/季节组合">🎲 随机组合</button>
    </div>
    <p class="muted" style="margin: 0">{{ classificationDesc(cur.species, cur.stage, cur.season) }}</p>
    <p class="muted" style="margin: 0">
      同一组合换种子 = 同一个种群里的不同个体 (形态、大小、枝角都会变)。
    </p>
  </Section>

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
import { SPECIES, GROWTH_STAGES, SEASONS, seasonProfile, classificationName, classificationDesc, speciesById } from '../../core/species.js'
import { PRESETS } from '../../core/presets.js'
import { defaultParams } from '../../core/params.js'
import {
  state, doAutoGenerate, randomizeSeed, setSeed, applyClassification, randomClassification,
  undo, redo, canUndo, canRedo, pushUndo, archetypeLabel,
} from '../../store/treeStore.js'

const p = state.params

const cur = computed(() => {
  const c = state.params.classify || { species: 'oak', stage: 'mature', season: 'summer' }
  return { species: c.species || 'oak', stage: c.stage || 'mature', season: c.season || 'summer' }
})
const speciesObj = computed(() => speciesById(cur.value.species))

const typeOptions = [
  { value: '', label: '随机 (按权重)' },
  ...PRESETS.map((x) => ({ value: x.id, label: `${x.icon} ${x.name}` })),
]

function seasonTitle(se) {
  const prof = seasonProfile(speciesObj.value, se.id) || se
  return prof.desc || se.desc
}

const autoTypeModel = computed({
  get: () => state.autoType || '',
  set: (v) => { state.autoType = v || null },
})

/** 点选任一维度: 立即用三维组合重新生成 */
function pick(axis, id) {
  const next = { ...cur.value, [axis]: id }
  applyClassification(next.species, next.stage, next.season)
  state.frameVersion++
}

function onRandomCombo() {
  randomClassification()
  state.frameVersion++
}

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

function onResetAll() {
  pushUndo()
  state.params = defaultParams()
  state.frameVersion++
}
</script>

<style scoped>
.axis { margin-bottom: 6px; }
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 7px;
  font-size: 11px;
  color: var(--text-2);
  background: var(--bg-3);
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
}
.chip:hover { border-color: var(--line-2); color: var(--text); }
.chip.active {
  border-color: var(--accent);
  color: #eafff7;
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-3));
}
</style>
