<template>
  <Section title="树叶材质" hint="Leaf" :default-collapsed="true">
    <ColorRow label="色调 (tint)" v-model="lm.tint" />
    <SelectRow label="贴图染色" v-model="lm.tintMode" :options="tintOptions"
      hint="原色 = 直接用贴图颜色 (适合全彩照片卡片, 无贴图时自动用季节色); 跟随季节 = 用季节叶色乘贴图" />
    <SliderRow v-if="lm.tintMode === 'custom'" label="染色强度" v-model="lm.vertexColorMix" :min="0" :max="1" :step="0.01"
      hint="0 = 贴图原色, 1 = 完全用季节叶色染色" />
    <SliderRow label="粗糙度" v-model="lm.roughness" :min="0" :max="1" :step="0.01" />
    <SliderRow label="金属度" v-model="lm.metalness" :min="0" :max="1" :step="0.01" />
    <SliderRow label="自动生成法线" v-model="lm.normalFromAlbedo" :min="0" :max="3" :step="0.05"
      hint="0 = 关闭。从颜色贴图的亮度起伏自动生成法线贴图 (叶脉/叶面起伏变成光照细节), 任何贴图都适用" />
    <SliderRow v-if="lm.normalFromAlbedo > 0" label="法线强度" v-model="lm.normalScale" :min="0" :max="3" :step="0.05" />
    <ColorRow label="自发光颜色" v-model="lm.emissiveColor" />
    <SliderRow label="自发光强度" v-model="lm.emissive" :min="0" :max="1" :step="0.01"
      hint="用叶色做底的自发光: 让背光/阴影里的叶片不发黑" />
    <SliderRow label="Alpha 裁剪" v-model="lm.alphaTest" :min="0" :max="1" :step="0.01" />
    <SliderRow label="透光度 (背光)" v-model="lm.translucency" :min="0" :max="1.5" :step="0.01"
      hint="树叶逆光时的半透效果" />
    <SliderRow label="反光强度" v-model="lm.specular" :min="0" :max="2" :step="0.01"
      hint="叶面高光 (湿叶/蜡质叶面那种反光)" />
    <SliderRow label="反光锐度" v-model="lm.specularShininess" :min="2" :max="120" :step="1"
      hint="越大高光越集中、越像镜面" />
    <ColorRow label="反光颜色" v-model="lm.specularColor" />
    <SliderRow label="散光强度" v-model="lm.scatter" :min="0" :max="1.5" :step="0.01"
      hint="叶肉透射散射: 叶缘/逆光处发亮 (0 = 关闭)" />
    <SliderRow label="散光边缘锐度" v-model="lm.scatterPower" :min="0.5" :max="8" :step="0.1"
      hint="越大散射越集中在叶缘" />
    <ToggleRow label="双面渲染" v-model="lm.doubleSided" />
    <ToggleRow label="双面独立颜色/贴图" v-model="lm.backEnabled"
      hint="开启后自动双面渲染: 正面用现有叶色/贴图, 背面用下面的独立颜色和贴图" />
    <template v-if="lm.backEnabled">
      <ColorRow label="背面颜色" v-model="lm.backColor" />
      <div class="pick-label">背面贴图库 (点击选择)</div>
      <div class="chips">
        <button class="chip nowrap back-follow" :class="{ active: !lm.backTexture }" @click="lm.backTexture = ''">
          跟随正面贴图
        </button>
      </div>
      <div class="chips">
        <span class="muted">批次</span>
        <button v-for="bt in batches" :key="'back-' + bt" class="chip"
          :class="{ active: backBatch === bt }"
          @click="backBatch = bt; backRow = leafCardRows(bt)[0]">{{ batchLabel(bt) }}</button>
      </div>
      <div class="chips">
        <span class="muted">叶形</span>
        <button v-for="r in leafCardRows(backBatch)" :key="'backrow-' + r" class="chip"
          :class="{ active: backRow === r }" @click="backRow = r">#{{ r }}</button>
      </div>
      <div class="chips">
        <button v-for="cd in backCards" :key="'backcard-' + cd.id" class="chip dot back-card"
          :class="{ active: lm.backTexture === cd.url }" :data-url="cd.url" :title="cd.id"
          @click="useBackCard(cd)">
          <img :src="cd.url" alt="" @error="onThumbError(e)" />
        </button>
        <button class="btn small" title="随机一张背面贴图" @click="randomBackCard">🎲</button>
      </div>
      <TextureRow label="背面贴图 (含 alpha)" v-model="lm.backTexture"
        hint="也可以直接从上面的贴图库选择; 留空 = 沿用正面贴图, 只应用背面颜色" />
      <p class="muted" style="margin: 0">
        背面颜色会与背面贴图相乘；背面不参与正面的季节顶点色染色。
      </p>
    </template>
    <TextureRow label="自定义叶片贴图 (含 alpha)" v-model="lm.texture" />
    <TextureRow label="自定义法线贴图" v-model="lm.normalTexture" />
  </Section>
</template>

<script setup>
import { computed, ref } from 'vue'
import Section from './ui/Section.vue'
import ColorRow from './ui/ColorRow.vue'
import SelectRow from './ui/SelectRow.vue'
import SliderRow from './ui/SliderRow.vue'
import ToggleRow from './ui/ToggleRow.vue'
import TextureRow from './ui/TextureRow.vue'
import { state } from '../store/treeStore.js'
import { LEAF_CARDS, LEAF_CARD_BATCHES, LEAF_CARD_BATCH_NAMES, leafCardsFor, leafCardRows } from '../core/leafCards.generated.js'

const lm = state.params.leafMat
const tintOptions = [
  { value: 'texture', label: '原色 (贴图不变色)' },
  { value: 'season', label: '跟随季节叶色' },
  { value: 'custom', label: '自定义强度' },
]

/* ---------------- 背面贴图库 ---------------- */
const missing = ref({})
function onThumbError(e) {
  const img = e && e.target
  if (!img) return
  const url = img.getAttribute('src') || ''
  if (url) missing.value = { ...missing.value, [url]: true }
  const btn = img.parentElement
  if (btn) btn.style.display = 'none'
}
const alive = (list) => (list || []).filter((x) => !missing.value[x.url])
const batches = Object.keys(LEAF_CARD_BATCHES)
const batchLabel = (bt) => LEAF_CARD_BATCH_NAMES[bt] || bt
const backBatch = ref('batch1')
const backRow = ref(1)
const backCards = computed(() => alive(leafCardsFor(backBatch.value, backRow.value)))
function useBackCard(card) {
  if (!card) return
  lm.backTexture = card.url
}
function randomBackCard() {
  const pool = backCards.value.length ? backCards.value : alive(LEAF_CARDS)
  const card = pool[Math.floor(Math.random() * pool.length)]
  if (card) lm.backTexture = card.url
}
</script>

<style scoped>
.chip {
  padding: 2px 7px; font-size: 11px; color: var(--text-2);
  background: var(--bg-3); border: 1px solid var(--line); border-radius: 6px; cursor: pointer;
}
.chip.active { border-color: var(--accent); color: #eafff7; }
.chip.dot { padding: 0; width: 34px; height: 34px; overflow: hidden; display: inline-flex; border-radius: 3px; }
.chip.dot img { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.chips .chip { white-space: nowrap; }
</style>
