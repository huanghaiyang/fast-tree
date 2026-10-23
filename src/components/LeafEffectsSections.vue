<template>
  <Section title="落叶堆积" hint="Leaf Litter" :default-collapsed="true">
    <ToggleRow label="启用落叶堆积" v-model="lt.enabled"
      hint="地面上铺一层落叶: 随机朝向/倾斜/层叠, UV 翻转旋转制造多形态; 合批 1 个 draw call" />
    <ToggleRow label="继承树叶光照" v-model="lt.inheritLeafMat"
      hint="落叶堆继承树叶的自发光/反光/散光 (默认开)" />
    <template v-if="lt.enabled">
      <div class="pick-label">堆积贴图</div>
      <div class="tex-cards">
        <button class="chip nowrap" :class="{ active: !lt.cardId }" @click="lt.cardId = ''">跟随树叶</button>
        <TextureCard v-for="c in cardChoices" :key="'lt-' + c.id" :src="c.url"
          :active="lt.cardId === c.id" :title="c.id" @pick="lt.cardId = c.id" />
        <button class="btn small" title="随机一张" @click="lt.cardId = randomCardId()">🎲</button>
        <span v-if="!cardChoices.length" class="muted">正在检测可用贴图…</span>
      </div>
      <SliderRow label="落叶数量 (堆积)" v-model="lt.count" :min="10" :max="2000" :step="10" />
      <SliderRow label="分布半径" v-model="lt.radius" :min="0.2" :max="3" :step="0.05"
        hint="相对树冠半径: 1 = 铺满树冠投影范围" />
      <SliderRow label="单片大小" v-model="lt.size" :min="0.1" :max="1.5" :step="0.01" />
      <SliderRow label="堆积厚度" v-model="lt.thickness" :min="0" :max="0.4" :step="0.005" unit="m" />
      <SliderRow label="枯叶色差" v-model="lt.colorVariance" :min="0" :max="1" :step="0.01"
        hint="单片落叶的颜色差异 (枯黄/褐/橙混杂)" />
      <ColorRow label="枯叶基色" v-model="lt.color" />
      <SliderRow label="Alpha 裁剪" v-model="lt.alphaTest" :min="0" :max="1" :step="0.01" />
      <p class="muted" style="margin: 0">
        使用当前选中的叶片卡片贴图; 中心区域更厚 (树下堆积更多)。
      </p>
    </template>
  </Section>

  <Section title="落叶" hint="Falling Leaves" :default-collapsed="true">
    <ToggleRow label="启用落叶" v-model="fl.enabled"
      hint="从树冠飘落的真实叶片卡片 (合批成一个 draw call, 翻滚/受风全在着色器里)" />
    <ToggleRow label="继承树叶光照" v-model="fl.inheritLeafMat"
      hint="落叶继承树叶的自发光/反光/散光 (默认开)" />
    <template v-if="fl.enabled">
      <div class="pick-label">落叶贴图</div>
      <div class="tex-cards">
        <button class="chip nowrap" :class="{ active: !fl.cardId }" @click="fl.cardId = ''">跟随树叶</button>
        <TextureCard v-for="c in cardChoices" :key="'fl-' + c.id" :src="c.url"
          :active="fl.cardId === c.id" :title="c.id" @pick="fl.cardId = c.id" />
        <button class="btn small" title="随机一张" @click="fl.cardId = randomCardId()">🎲</button>
        <span v-if="!cardChoices.length" class="muted">正在检测可用贴图…</span>
      </div>
      <SliderRow label="落叶数量" v-model="fl.count" :min="4" :max="600" :step="1" />
      <SliderRow label="落叶大小" v-model="fl.size" :min="0.05" :max="1.2" :step="0.01" />
      <SliderRow label="下落速度" v-model="fl.speed" :min="0.05" :max="3" :step="0.05" />
      <SliderRow label="翻滚自旋" v-model="fl.spinSpeed" :min="0" :max="6" :step="0.1" />
      <SliderRow label="打旋幅度" v-model="fl.swirl" :min="0" :max="3" :step="0.05" />
      <SliderRow label="横向错开" v-model="fl.stagger" :min="0" :max="2" :step="0.05" />
      <SliderRow label="受风影响" v-model="fl.windFollow" :min="0" :max="3" :step="0.05"
        hint="与树木/粒子共用同一套风向与阵风" />
      <SliderRow label="出生点范围" v-model="fl.spread" :min="0.3" :max="1.5" :step="0.01" />
      <SliderRow label="落地/透明度" v-model="fl.opacity" :min="0.1" :max="1" :step="0.01" />
      <ColorRow label="落叶颜色 (无贴图时)" v-model="fl.color" />
      <p class="muted" style="margin: 0">
        落叶沿用当前选中的叶片卡片贴图与宽高比; 没有贴图时用椭圆兜底。
      </p>
    </template>
  </Section>

  <Section title="叶片粒子发射" hint="Foliage Particles" :default-collapsed="true">
    <ToggleRow label="启用粒子" v-model="pt.enabled"
      hint="从叶片位置发射飘动的光点/花粉 (顶点着色器动画, CPU 零开销)" />
    <template v-if="pt.enabled">
      <SliderRow label="粒子数量" v-model="pt.count" :min="10" :max="2000" :step="10" />
      <SliderRow label="粒子大小" v-model="pt.size" :min="0.005" :max="0.3" :step="0.005" unit="m" />
      <SliderRow label="循环速度" v-model="pt.speed" :min="0.02" :max="2" :step="0.01" />
      <SliderRow label="下落距离" v-model="pt.fall" :min="0" :max="2" :step="0.05" />
      <SliderRow label="横向飘动" v-model="pt.sway" :min="0" :max="3" :step="0.05" />
      <SliderRow label="打旋" v-model="pt.swirl" :min="0" :max="3" :step="0.05" />
      <SliderRow label="受风影响" v-model="pt.windFollow" :min="0" :max="3" :step="0.05"
        hint="粒子被风带走的强度: 与树木共用同一套风向/强度/阵风 (0 = 不受风)" />
      <SliderRow label="采样范围" v-model="pt.spread" :min="0.2" :max="1.5" :step="0.01"
        hint="发射点取树冠的哪一部分 (1 = 整个树冠)" />
      <SliderRow label="粒子亮度" v-model="pt.glow" :min="0.1" :max="3" :step="0.05" />
      <SliderRow label="粒子不透明度" v-model="pt.opacity" :min="0.05" :max="1" :step="0.01" />
      <ColorRow label="粒子颜色" v-model="pt.color" />
      <p class="muted" style="margin: 0">
        发射点从叶片顶点采样, 粒子用叠加混合绘制 —— 适合做花粉、光尘、孢子飘散。
      </p>
    </template>
  </Section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Section from './ui/Section.vue'
import ToggleRow from './ui/ToggleRow.vue'
import SliderRow from './ui/SliderRow.vue'
import ColorRow from './ui/ColorRow.vue'
import TextureCard from './ui/TextureCard.vue'
import { state } from '../store/treeStore.js'
import { LEAF_CARDS } from '../core/leafCards.generated.js'

const fl = computed(() => state.params.fall)
const lt = computed(() => state.params.litter)
const pt = computed(() => state.params.particles)

/* 落叶/堆积的贴图候选: 每个批次/叶形取一张代表卡 (最多 12 张) */
const missing = ref({})
const exists = ref({})
async function probe(urls) {
  const todo = urls.filter((x) => exists.value[x] === undefined && missing.value[x] !== true)
  if (!todo.length) return
  await Promise.all(todo.map(async (url) => {
    try {
      const r = await fetch(url, { method: 'HEAD' })
      const ct = (r.headers.get('content-type') || '').toLowerCase()
      const ok = r.ok && ct.startsWith('image/')
      if (ok) exists.value = { ...exists.value, [url]: true }
      else missing.value = { ...missing.value, [url]: true }
    } catch {
      missing.value = { ...missing.value, [url]: true }
    }
  }))
}
const cardChoicesRaw = computed(() => {
  const out = []
  const seen = new Set()
  for (const c of LEAF_CARDS) {
    const key = c.batch + '|' + c.row
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
    if (out.length >= 12) break
  }
  return out
})
// 只展示 HEAD 探测确认存在的卡片, 过滤 404 贴图
const cardChoices = computed(() => cardChoicesRaw.value.filter((c) =>
  exists.value[c.url] === true && missing.value[c.url] !== true))
watch(cardChoicesRaw, (list) => probe(list.map((c) => c.url)), { immediate: true })
function randomCardId() {
  const pool = cardChoices.value.length ? cardChoices.value : LEAF_CARDS.filter((c) => exists.value[c.url] === true)
  if (!pool.length) return ''
  return pool[Math.floor(Math.random() * pool.length)].id
}
</script>

<style scoped>
.chip {
  padding: 2px 7px; font-size: 11px; color: var(--text-2);
  background: var(--bg-3); border: 1px solid var(--line); border-radius: 6px; cursor: pointer;
}
.chip.active { border-color: var(--accent); color: #eafff7; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.chips .chip { white-space: nowrap; }
.pick-label { font-size: 11px; color: var(--text-2); margin: 6px 0 3px; }
</style>
