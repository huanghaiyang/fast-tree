<template>
  <Section title="花朵" hint="Flower">
    <ToggleRow label="启用花朵" v-model="f.enabled" hint="与树叶可同时开启 (独立网格, 材质继承树叶)" />
    <ToggleRow label="继承树叶设置" v-model="f.inheritLeaves" hint="开: 未单独设置的字段沿用树叶 (叶形/密度等)" />
    <SliderRow label="花朵尺寸" v-model="f.size" :min="0.1" :max="1.2" :step="0.02" />
    <SliderRow label="花朵宽度" v-model="f.width" :min="0.5" :max="1.6" :step="0.02" />
    <SliderRow label="每枝花朵数" v-model="f.perBranch" :min="0" :max="24" :step="1" />
    <SliderRow label="花朵密度" v-model="f.density" :min="0.05" :max="1" :step="0.05"
      hint="按比例从树叶位置采样开花 (1 = 每个叶位都开)" />
    <SelectRow label="花朵形状" v-model="f.shape" :options="shapes" />
    <ToggleRow label="三维花冠" v-model="f.flower3d" hint="开 = 真三维漏斗 (双壳/花蕊/花瓣层); 关 = 平面卡片" />
    <SelectRow v-if="f.flower3d !== false" label="花冠质量" v-model="f.flowerQuality" :options="qualityOptions" />
    <SliderRow v-if="f.flower3d !== false" label="花瓣数" v-model="f.flowerLobes" :min="3" :max="8" :step="1" />
    <SliderRow v-if="f.flower3d !== false" label="花冠上仰" v-model="f.flowerTilt" :min="0" :max="90" :step="5" unit="°" />
    <SliderRow v-if="f.flower3d !== false" label="花冠壁厚" v-model="f.flowerThickness" :min="0" :max="0.15" :step="0.005" />
    <ToggleRow v-if="f.flower3d !== false" label="花瓣分层" v-model="f.flowerPetals" />
    <ToggleRow v-if="f.flower3d !== false" label="花蕊" v-model="f.flowerStamen" />
    <ColorRow v-if="f.flower3d !== false && f.flowerStamen !== false" label="花蕊颜色" v-model="f.flowerStamenColor" />
    <ColorRow label="花色 A" v-model="f.color" />
    <ColorRow label="花色 B" v-model="f.colorTip" />
    <SliderRow label="花色差异" v-model="f.colorVariance" :min="0" :max="1" :step="0.01" />
    <SliderRow label="花朵透光" v-model="f.translucency" :min="0" :max="1" :step="0.01" />
    <ToggleRow label="花朵卡片模式" v-model="f.cardMode" hint="用照片花朵卡片代替程序化花冠" />
    <div class="pick-label">内置花朵卡片（樱花 6 批 + 其他 · 点缩略图应用）</div>
    <div class="chips">
      <span class="muted">批次</span>
      <button v-for="bt in cardBatches" :key="bt" class="chip" :class="{ active: cardBatch === bt }"
        @click="cardBatch = bt; cardRow = leafCardRows(bt)[0]">{{ batchName(bt) }}</button>
    </div>
    <div class="chips">
      <span class="muted">叶形</span>
      <button v-for="r in leafCardRows(cardBatch)" :key="r" class="chip" :class="{ active: cardRow === r }"
        @click="cardRow = r">#{{ r }}</button>
    </div>
    <div class="chips">
      <button v-for="c in cardVariants" :key="c.id" class="chip dot" :class="{ active: f.cardId === c.id }"
        :title="c.id" @click="useCard(c)">
        <img :src="c.url" alt="" @error="(e) => (e.target.parentElement.style.display = 'none')" />
      </button>
      <button class="btn small" title="随机花朵卡片" @click="onRandomCard">🎲</button>
    </div>
    <TextureRow label="花朵贴图" v-model="f.texture"
      hint="花朵自己的贴图 (与树叶独立): 三维花冠会把它包裹成表面花纹; 平面花卡模式则按 alpha 裁形" />
    <SelectRow label="花朵贴图染色" v-model="f.tintMode" :options="tintOptions" />
    <SliderRow v-if="f.tintMode === 'custom'" label="花朵染色强度" v-model="f.vertexColorMix" :min="0" :max="1" :step="0.01" />
    <SliderRow label="花朵贴图裁切" v-model="f.alphaTest" :min="0" :max="0.9" :step="0.01"
      hint="平面花卡模式用来去掉贴图透明边; 三维花冠建议保持 0" />
    <SliderRow label="花朵自动法线" v-model="f.normalFromAlbedo" :min="0" :max="3" :step="0.05"
      hint="从花朵贴图生成法线 (0 = 关闭)" />
  </Section>

  <Section title="落花" hint="Falling">
    <ToggleRow label="启用落花" v-model="ff.enabled" hint="参照落叶: 从花冠飘落的花朵 (贴图跟随花朵)" />
    <SliderRow label="落花数量" v-model="ff.count" :min="10" :max="600" :step="10" />
    <SliderRow label="落花大小" v-model="ff.size" :min="0.1" :max="1.5" :step="0.05" />
    <SliderRow label="飘落速度" v-model="ff.speed" :min="0.1" :max="3" :step="0.05" />
    <SliderRow label="飘旋幅度" v-model="ff.swirl" :min="0" :max="2" :step="0.05" />
    <SliderRow label="受风程度" v-model="ff.windFollow" :min="0" :max="2" :step="0.05" />
    <ColorRow label="落花颜色 (无贴图时)" v-model="ff.color" />
  </Section>

  <Section title="落花堆积" hint="Litter" :default-collapsed="true">
    <ToggleRow label="启用落花堆积" v-model="fl.enabled" hint="地面上的落花 (参照落叶堆积)" />
    <SliderRow label="落花堆积数量" v-model="fl.count" :min="20" :max="1200" :step="20" />
    <SliderRow label="落花堆积范围" v-model="fl.radius" :min="0.2" :max="3" :step="0.05" />
    <SliderRow label="落花堆积大小" v-model="fl.size" :min="0.1" :max="1.2" :step="0.02" />
    <SliderRow label="落花堆积颜色差异" v-model="fl.colorVariance" :min="0" :max="1" :step="0.01" />
    <ColorRow label="落花堆积颜色" v-model="fl.color" />
  </Section>
</template>

<script setup>
import { computed, ref } from 'vue'
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import ColorRow from '../ui/ColorRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import TextureRow from '../ui/TextureRow.vue'
import { state, randomFlowerCard } from '../../store/treeStore.js'
import { LEAF_CARDS, LEAF_CARD_BATCHES, LEAF_CARD_BATCH_NAMES, leafCardRows, leafCardsFor } from '../../core/leafCards.generated.js'

const f = computed(() => state.params.flower)
const ff = computed(() => state.params.flowerFall)
const fl = computed(() => state.params.flowerLitter)
const cardBatches = Object.keys(LEAF_CARD_BATCHES)
const cardBatch = ref('fl_batch1')
const cardRow = ref(1)
const batchName = (bt) => LEAF_CARD_BATCH_NAMES[bt] || bt
const cardVariants = computed(() => leafCardsFor(cardBatch.value, cardRow.value))
function useCard(c) {
  f.value.texture = c.url
  f.value.cardId = c.id
  f.value.cardMode = true
  f.value.cardAspect = c.aspect || 1
  f.value.tintMode = 'texture'
  f.value.alphaTest = 0.35
  if (!f.value.enabled) f.value.enabled = true
}
function onRandomCard() { randomFlowerCard() }
const shapes = [
  { value: 'trumpet', label: '喇叭花 trumpet' },
  { value: 'bell', label: '钟形花 bell' },
  { value: 'oval', label: '椭圆 oval' },
  { value: 'cordate', label: '心形 cordate' },
]
const tintOptions = [
  { value: 'texture', label: '原色 (贴图不变色)' },
  { value: 'season', label: '跟随花色' },
  { value: 'custom', label: '自定义强度' },
]
const qualityOptions = [
  { value: 'high', label: '高 (双壳+花蕊+花瓣层)' },
  { value: 'medium', label: '中 (单壳+花蕊)' },
  { value: 'low', label: '低 (省面数)' },
]
</script>

<style scoped>

.chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.chips .chip { white-space: nowrap; }
.chip {
  padding: 2px 7px; font-size: 11px; color: var(--text-2);
  background: var(--bg-3); border: 1px solid var(--line); border-radius: 6px; cursor: pointer;
}
.chip.active { border-color: var(--accent); color: #eafff7; }
.chip.dot { padding: 0; width: 34px; height: 34px; overflow: hidden; display: inline-flex; border-radius: 3px; }
.chip.dot img { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
.pick-label { font-size: 11px; color: var(--text-2); margin: 6px 0 3px; }
.muted { color: var(--text-2); font-size: 11px; }

</style>
