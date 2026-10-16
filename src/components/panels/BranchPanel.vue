<template>
  <Section title="树枝层级" hint="Branch Levels">
    <SliderRow label="有效层级数" v-model="b.levels" :min="1" :max="5" :step="1"
      hint="树干算第 0 层; 每层的计数是「每根父枝上长几根」" />
    <div class="level-tabs">
      <div v-for="(cfg, i) in b.level" :key="i" class="level-tab"
        :class="{ active: active === i, off: !cfg.enabled || i + 1 > b.levels }"
        @click="active = i">
        L{{ i + 1 }} · {{ cfg.count }}
      </div>
    </div>
    <div class="muted">
      当前编辑 L{{ active + 1 }} (第 {{ active + 1 }} 级枝条) · 层级启用:
      <label class="inline" style="display: inline-flex; gap: 4px; margin-left: 6px">
        <input type="checkbox" v-model="cfg.enabled" />
      </label>
    </div>
  </Section>

  <Section title="L{{ active + 1 }} 分布" hint="Distribution">
    <SliderRow label="每根父枝上的数量" v-model="cfg.count" :min="1" :max="24" :step="1" />
    <SliderRow label="起始位置" v-model="cfg.startT" :min="0" :max="1" :step="0.01" hint="父枝上的相对位置" />
    <SliderRow label="结束位置" v-model="cfg.endT" :min="0" :max="1" :step="0.01" />
    <SliderRow label="位置抖动" v-model="cfg.startJitter" :min="0" :max="0.3" :step="0.005" />
    <SliderRow label="叶序角" v-model="cfg.phyllotaxis" :min="0" :max="360" :step="0.5" unit="°"
      hint="137.5° 是自然界的黄金角" />
    <SliderRow label="方位离散" v-model="cfg.spread" :min="0" :max="1.5" :step="0.01" />
  </Section>

  <Section title="L{{ active + 1 }} 形态" hint="Shape" :default-collapsed="true">
    <SliderRow label="长度 (相对父枝)" v-model="cfg.lengthRatio" :min="0.05" :max="1.2" :step="0.01" />
    <SliderRow label="长度随机" v-model="cfg.lengthVariance" :min="0" :max="0.8" :step="0.01" />
    <SliderRow label="半径 (相对父枝)" v-model="cfg.radiusRatio" :min="0.1" :max="0.9" :step="0.01" />
    <SliderRow label="半径随机" v-model="cfg.radiusVariance" :min="0" :max="0.7" :step="0.01" />
    <SliderRow label="锥度 (梢/基半径)" v-model="cfg.taper" :min="0.05" :max="1" :step="0.01" />
    <SliderRow label="半径曲线" v-model="cfg.radiusCurve" :min="0.4" :max="3" :step="0.05" />
    <SliderRow label="与父枝夹角" v-model="cfg.pitch" :min="5" :max="150" :step="1" unit="°" />
    <SliderRow label="夹角随机" v-model="cfg.pitchVariance" :min="0" :max="60" :step="1" unit="°" />
    <SliderRow label="弯曲" v-model="cfg.curve" :min="0" :max="1.6" :step="0.01" />
    <SliderRow label="弯曲随机" v-model="cfg.curveVariance" :min="0" :max="1" :step="0.02" />
    <SliderRow label="重力 (负 = 下垂)" v-model="cfg.gravity" :min="-0.8" :max="0.6" :step="0.01" />
    <SliderRow label="向上偏置" v-model="cfg.upBias" :min="-0.5" :max="0.5" :step="0.01" />
    <SliderRow label="扭转" v-model="cfg.twist" :min="-1" :max="1" :step="0.01" />
    <div class="grid-2">
      <SliderRow label="纵向分段" v-model="cfg.segments" :min="2" :max="20" :step="1" />
      <SliderRow label="周向分段" v-model="cfg.radialSegments" :min="3" :max="12" :step="1" />
    </div>
    <SelectRow label="交叉截面" v-model="cfg.crossSection" :options="crossSections" />
    <SliderRow v-if="cfg.crossSection === 'star'" label="星形深度" v-model="cfg.starDepth" :min="0" :max="0.6" :step="0.01" />
    <SliderRow label="柔度增益 (随风摆动)" v-model="cfg.windGain" :min="0" :max="1.5" :step="0.01" />
  </Section>

  <Section title="全局修正" hint="Global" :default-collapsed="true">
    <SliderRow label="枝条长度倍率" v-model="b.lengthScale" :min="0.2" :max="2.5" :step="0.01" />
    <SliderRow label="枝条半径倍率" v-model="b.radiusScale" :min="0.2" :max="2.5" :step="0.01" />
    <SliderRow label="重力倍率" v-model="b.gravityScale" :min="0" :max="2.5" :step="0.01" />
    <SliderRow label="趋光性" v-model="b.phototropism" :min="-0.4" :max="0.5" :step="0.01"
      hint="正 = 枝条向上翘" />
    <SliderRow label="顶端优势" v-model="b.apicalDominance" :min="0" :max="0.95" :step="0.01"
      hint="越大, 越靠梢部的枝条越短" />
    <SliderRow label="起始位置整体偏移" v-model="b.startSpread" :min="-0.4" :max="0.4" :step="0.01" />
  </Section>
</template>

<script setup>
import { computed, ref } from 'vue'
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import { state } from '../../store/treeStore.js'

const b = state.params.branches
const active = ref(0)
const cfg = computed(() => b.level[Math.min(active.value, b.level.length - 1)])

const crossSections = [
  { value: 'round', label: '圆 (round)' },
  { value: 'star', label: '星形 (star)' },
  { value: 'square', label: '方 (square)' },
]
</script>
