<template>
  <Section title="花朵" hint="Flower">
    <ToggleRow label="启用花朵" v-model="f.enabled" hint="与树叶可同时开启 (独立网格, 材质继承树叶)" />
    <SelectRow label="花朵十字交叉" v-model="f.cross" :options="crossOptions"
      hint="两片/三片花卡交叉摆放, 让花朵从侧面看也有立体感" />
    <ToggleRow label="用叶形轮廓" v-model="f.useShape" hint="开: 用程序化叶形(含圆叶)代替照片花卡" />
    <SelectRow v-if="f.useShape" label="花朵叶形" v-model="f.shape" :options="shapeOptions" />
    <SliderRow label="花朵尺寸" v-model="f.size" :min="0.1" :max="1.2" :step="0.02" />
    <SliderRow label="花朵大小随机" v-model="f.sizeVariance" :min="0" :max="0.8" :step="0.01" />
    <SliderRow label="花朵宽度" v-model="f.width" :min="0.5" :max="1.6" :step="0.02" />
    <SliderRow label="花朵朝向俯仰角" v-model="f.pitch" :min="0" :max="180" :step="1" unit="°" />
    <SliderRow label="朝向随机" v-model="f.pitchVariance" :min="0" :max="90" :step="1" unit="°" />
    <SliderRow label="花朵下垂" v-model="f.droop" :min="-1" :max="1" :step="0.02" />
    <SliderRow label="朝向离散" v-model="f.rollVariance" :min="0" :max="1" :step="0.01" />
    <ToggleRow label="花朵尽量朝上" v-model="f.faceUp" hint="花朵法线尽量朝向天空 (真实花多向上开)" />
    <SliderRow label="花朵模型旋转" v-model="f.modelRotation" :min="-180" :max="180" :step="1" unit="°"
      hint="绕花面法线旋转整张花卡; 贴图偏移导致花梗方向相反时用 180° 校正" />
    <SliderRow label="花朵分段" v-model="f.segments" :min="2" :max="12" :step="1" />
    <SliderRow label="花朵纵向弯曲" v-model="f.curl" :min="-0.6" :max="0.6" :step="0.01" />
    <SliderRow label="花朵横向折叠" v-model="f.fold" :min="-0.4" :max="0.8" :step="0.01" />
    <SliderRow label="花朵柄长比例" v-model="f.petiole" :min="0" :max="0.4" :step="0.01" />
    <SliderRow label="卡片卷曲" v-model="f.cardCurl" :min="-0.6" :max="0.6" :step="0.01" />
    <SliderRow label="卡片折叠" v-model="f.cardFold" :min="-0.4" :max="0.8" :step="0.01" />
    <SliderRow label="花朵簇半径" v-model="f.clusterRadius" :min="0" :max="0.8" :step="0.01" unit="m" />
    <div class="row-head"><label>生长在哪几层枝条上</label></div>
    <div class="chips">
      <label v-for="(on, i) in f.levels" :key="i" class="chip" :class="{ active: on }">
        <input type="checkbox" v-model="f.levels[i]" style="display:none" />L{{ i + 1 }}
      </label>
    </div>
    <SliderRow label="每枝花朵数" v-model="f.perBranch" :min="0" :max="24" :step="1" />
    <SliderRow label="每簇花朵数" v-model="f.clusterCount" :min="1" :max="12" :step="1" />
    <SliderRow label="分布起始位置" v-model="f.startT" :min="0" :max="1" :step="0.01" />
    <SliderRow label="分布结束位置" v-model="f.endT" :min="0" :max="1" :step="0.01" />
    <ToggleRow label="树干环绕生长" v-model="f.trunkWrap"
      hint="沿树干螺旋分布花朵，不依赖枝条；可单独开启" />
    <template v-if="f.trunkWrap">
      <SliderRow label="树干起始高度" v-model="f.trunkStartT" :min="0.02" :max="0.98" :step="0.01" />
      <SliderRow label="树干结束高度" v-model="f.trunkEndT" :min="0.02" :max="0.99" :step="0.01" />
      <SliderRow label="环绕花朵点数" v-model="f.trunkCount" :min="3" :max="100" :step="1" />
    </template>
    <SliderRow label="花朵密度" v-model="f.density" :min="0.05" :max="1" :step="0.05" />
    <ColorRow label="花色 A" v-model="f.color" />
    <ColorRow label="花色 B" v-model="f.colorTip" />
    <SliderRow label="花色差异" v-model="f.colorVariance" :min="0" :max="1" :step="0.01" />
    <SliderRow label="花朵透光" v-model="f.translucency" :min="0" :max="1" :step="0.01" />
    <SliderRow label="卡片比例 (宽/高)" v-model="f.cardAspect" :min="0.3" :max="2.5" :step="0.02" />
    <div class="fte-open">
      <button class="btn small" @click="onFitTexture">📐 适配贴图尺寸</button>
      <span class="fte-open-hint">把卡片宽高比设为当前贴图的真实比例</span>
    </div>
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
    <TextureRow label="花朵贴图" v-model="f.texture" />
    <SelectRow label="花朵贴图染色" v-model="f.tintMode" :options="tintOptions" />
    <SliderRow v-if="f.tintMode === 'custom'" label="花朵染色强度" v-model="f.vertexColorMix" :min="0" :max="1" :step="0.01" />
    <div class="pad-row">
      <div class="pad-box">
        <div class="pick-label">贴图偏移（二维拖动）</div>
        <TexturePad v-model="texOffset" :min="-1" :max="1" />
        <button class="btn small" style="margin-top: 6px" @click="resetTexOffset">↺ 一键复位偏移</button>
      </div>
      <div class="pad-side">
        <SliderRow label="贴图横向平铺" v-model="f.textureRepeatU" :min="0.1" :max="8" :step="0.05" />
        <SliderRow label="贴图纵向平铺" v-model="f.textureRepeatV" :min="0.1" :max="8" :step="0.05" />
      </div>
    </div>
    <div class="fte-open">
      <button class="btn small primary" @click="texOpen = true">🎯 可视化调整贴图位置</button>
      <span class="fte-open-hint">弹出 3D 面板, 拖动/滚轮/Shift 拖动 调贴图</span>
    </div>
    <SliderRow label="花朵贴图裁切" v-model="f.alphaTest" :min="0.05" :max="0.9" :step="0.01" />
    <SliderRow label="花朵自动法线" v-model="f.normalFromAlbedo" :min="0" :max="3" :step="0.05"
      hint="从花朵贴图明暗生成法线; 默认 1.5, 花瓣轮廓/褶皱会有真实光照细节" />
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
  <FlowerTextureEditor v-model="texOpen" />
</template>

<script setup>
import { computed, ref } from 'vue'
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import ColorRow from '../ui/ColorRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import TextureRow from '../ui/TextureRow.vue'
import TexturePad from '../ui/TexturePad.vue'
import FlowerTextureEditor from './FlowerTextureEditor.vue'
import { state, randomFlowerCard, fitFlowerCardToTexture } from '../../store/treeStore.js'
import { LEAF_CARDS, LEAF_CARD_BATCHES, LEAF_CARD_BATCH_NAMES, leafCardRows, leafCardsFor } from '../../core/leafCards.generated.js'
import { LEAF_SHAPE_KEYS } from '../../core/leaf.js'

const f = computed(() => state.params.flower)
const ff = computed(() => state.params.flowerFall)
const fl = computed(() => state.params.flowerLitter)
const cardBatches = Object.keys(LEAF_CARD_BATCHES)
const texOpen = ref(false)
// 二维偏移手柄 <-> params.flower.textureU/textureV
const texOffset = computed({
  get: () => [f.value.textureU || 0, f.value.textureV || 0],
  set: (v) => { f.value.textureU = v[0]; f.value.textureV = v[1] },
})
function resetTexOffset() {
  f.value.textureU = 0
  f.value.textureV = 0
}
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
async function onFitTexture() {
  const a = await fitFlowerCardToTexture()
  if (!a) console.warn('适配贴图尺寸失败: 没有可用贴图')
}
// 十字交叉: 取值范围见 params.flower.cross (none | v | h | both), 对应 treeBuilder 里的模板合并
const crossOptions = [
  { value: 'none', label: '不交叉' },
  { value: 'v', label: '竖向交叉 ×2' },
  { value: 'h', label: '横向交叉 ×2' },
  { value: 'both', label: '双向交叉 ×3' },
]
// 花朵叶形: 选项直接取自渲染器支持的 LEAF_OUTLINES 键, 面板与核心表不会再脱节,
// 也不会出现"当前值没有对应 option"导致下拉框显示空白的情况
const SHAPE_LABELS = {
  oval: '椭圆', round: '圆叶', cordate: '心形', lance: '披针', birch: '桦叶',
  maple: '枫叶', oak: '橡叶', palmate: '掌状', needle: '针叶', needleLong: '长针叶', litter: '枯叶',
}
const shapeOptions = LEAF_SHAPE_KEYS.map((k) => ({ value: k, label: `${SHAPE_LABELS[k] || k} ${k}` }))
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
.pad-row { display: flex; gap: 12px; align-items: flex-start; margin: 6px 0 6px; }
.pad-box { width: 132px; }
.pad-side { flex: 1; min-width: 0; }
.fte-open { display: flex; align-items: center; gap: 8px; margin: 6px 0 4px; flex-wrap: wrap; }
.fte-open-hint { font-size: 10.5px; color: var(--text-2); }
.pick-label { font-size: 11px; color: var(--text-2); margin: 6px 0 3px; }
.muted { color: var(--text-2); font-size: 11px; }

</style>
