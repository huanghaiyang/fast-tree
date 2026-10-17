<template>
  <Section title="树皮材质" hint="Bark">
    <SelectRow label="程序化花纹" v-model="b.procedural.style" :options="barkStyles" />
    <SliderRow label="花纹缩放" v-model="b.procedural.scale" :min="0.3" :max="3" :step="0.05" />
    <SliderRow label="花纹对比" v-model="b.procedural.contrast" :min="0" :max="1" :step="0.01" />
    <ColorRow label="花纹颜色 A" v-model="b.color" />
    <ColorRow label="花纹颜色 B" v-model="b.color2" />
    <ColorRow label="色调 (整体 tint)" v-model="b.tint" />
    <SliderRow label="粗糙度" v-model="b.roughness" :min="0" :max="1" :step="0.01" />
    <SliderRow label="金属度" v-model="b.metalness" :min="0" :max="1" :step="0.01" />
    <SliderRow label="法线强度" v-model="b.normalScale" :min="0" :max="3" :step="0.05" />
    <SliderRow label="自动生成法线" v-model="b.normalFromAlbedo" :min="0" :max="3" :step="0.05"
      hint="照片树皮专用: 0 = 关闭。从颜色贴图的裂纹/凹凸自动生成法线贴图 (程序化花纹本身已带法线)" />
    <SliderRow label="凹凸强度 (bump)" v-model="b.bump" :min="0" :max="2" :step="0.05" />
    <SliderRow label="顶点色混合" v-model="b.vertexColorMix" :min="0" :max="1" :step="0.01"
      hint="顶点色里烘焙了根部变暗 / 嫩枝偏绿" />
    <div class="grid-2">
      <SliderRow label="UV 横向重复" v-model="b.uvScaleU" :min="0.2" :max="6" :step="0.1" />
      <SliderRow label="UV 纵向重复" v-model="b.uvScaleV" :min="0.2" :max="6" :step="0.1" />
    </div>
    <TextureRow label="自定义树皮贴图" v-model="b.texture" />
    <TextureRow label="自定义法线贴图" v-model="b.normalTexture" />

    <!-- 内置树皮贴图库 (来自 bark_batch1 / bark_batch2) -->
    <div class="pick-label">内置树皮贴图 ({{ BARK_TEXTURES.length }} 张)</div>
    <div class="chips">
      <button class="chip nowrap" :class="{ active: !b.texture }" @click="b.texture = ''">程序化花纹</button>
      <button v-for="bt in BARK_BATCHES" :key="bt.id" class="chip nowrap"
        :class="{ active: barkBatch === bt.id }" @click="barkBatch = bt.id; barkRow = barkTextureRows(bt.id)[0]">{{ bt.name }}</button>
    </div>
    <div class="chips">
      <span class="muted">款式</span>
      <button v-for="r in barkTextureRows(barkBatch)" :key="r" class="chip" :class="{ active: barkRow === r }"
        @click="barkRow = r">#{{ r }}</button>
    </div>
    <div class="chips">
      <button v-for="bt in barkTexturesFor(barkBatch, barkRow)" :key="bt.id" class="chip dot"
        :class="{ active: b.texture === bt.url }" :title="bt.name" @click="useBark(bt)">
        <img :src="bt.url" alt="" />
      </button>
      <button class="btn small" title="随机一张树皮" @click="useBark(randomBarkTexture())">🎲</button>
    </div>
  </Section>

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
    <TextureRow label="自定义叶片贴图 (含 alpha)" v-model="lm.texture" />
    <TextureRow label="自定义法线贴图" v-model="lm.normalTexture" />
  </Section>

  <Section title="落叶堆积" hint="Leaf Litter" :default-collapsed="true">
    <ToggleRow label="启用落叶堆积" v-model="lt.enabled"
      hint="地面上铺一层落叶: 随机朝向/倾斜/层叠, UV 翻转旋转制造多形态; 合批 1 个 draw call" />
    <template v-if="lt.enabled">

      <div class="pick-label">{{ '堆积贴图' }}</div>
      <div class="chips">
        <button class="chip nowrap" :class="{ active: !lt.cardId }" @click="lt.cardId = ''">跟随树叶</button>
        <button v-for="c in cardChoices" :key="'lt-' + c.id" class="chip dot"
          :class="{ active: lt.cardId === c.id }" @click="lt.cardId = c.id" :title="c.id + ' (' + c.w + '×' + c.h + ')'">
          <img :src="c.url" alt="" />
        </button>
        <button class="btn small" title="随机一张" @click="lt.cardId = randomCardId()">🎲</button>
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
    <template v-if="fl.enabled">

      <div class="pick-label">{{ '落叶贴图' }}</div>
      <div class="chips">
        <button class="chip nowrap" :class="{ active: !fl.cardId }" @click="fl.cardId = ''">跟随树叶</button>
        <button v-for="c in cardChoices" :key="'fl-' + c.id" class="chip dot"
          :class="{ active: fl.cardId === c.id }" @click="fl.cardId = c.id" :title="c.id + ' (' + c.w + '×' + c.h + ')'">
          <img :src="c.url" alt="" />
        </button>
        <button class="btn small" title="随机一张" @click="fl.cardId = randomCardId()">🎲</button>
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

  <Section title="内置叶片卡片" hint="Leaf Cards" :default-collapsed="true">
    <ToggleRow label="贴图卡片模式" v-model="lv.cardMode"
      hint="叶形轮廓直接用贴图 alpha (照片级); 关闭则用程序化叶形轮廓" />
    <div class="inline">
      <span class="muted">批次</span>
      <button v-for="bt in batches" :key="bt" class="chip" :class="{ active: batch === bt }"
        @click="batch = bt; row = leafCardRows(bt)[0]; col = 1">{{ bt === 'batch1' ? '① 秋色系' : '② 绿色系' }} · {{ LEAF_CARD_BATCHES[bt] ? Object.values(LEAF_CARD_BATCHES[bt]).reduce((a, b) => a + b, 0) : 0 }}</button>
    </div>
    <div class="inline">
      <span class="muted">叶形</span>
      <button v-for="r in leafCardRows(batch)" :key="r" class="chip" :class="{ active: row === r }"
        @click="row = r; col = 1">#{{ r }}</button>
    </div>
    <div class="inline">
      <span class="muted">颜色变体</span>
      <button v-for="cd in cardsOfShape" :key="cd.id" class="chip dot"
        :class="{ active: lm.texture === cd.url }" :style="{ background: 'transparent' }"
        @click="use(cd)" :title="cd.id + ' (' + cd.w + '×' + cd.h + ')'">
        <img :src="cd.url" alt="" />
      </button>
    </div>
    <div class="inline">
      <button class="btn small primary" @click="use(current)">应用这张叶子</button>
      <button class="btn small" @click="rand">🎲 随机叶片</button>
      <span class="tag" :class="{ on: lv.cardMode }">{{ lv.cardMode ? '卡片模式' : '程序化叶形' }}</span>
    </div>
    <p class="muted" style="margin: 0">
      内置 {{ total }} 张已按 alpha 裁边的叶片卡片 (来自你的 leaves_v2_batch1/2)；
      点缩略图即刻换上：叶形与贴图完全一致，并自动把"顶点色混合"设为 0（免得季节调色板把照片颜色染偏）。
    </p>
  </Section>

  <Section title="自定义 GLSL" hint="Custom Shader" :default-collapsed="true">
    <ToggleRow label="启用自己的 GLSL 片段" v-model="c.enabled" />
    <div class="row-head"><label>顶点片段 (在 begin_vertex + 风场之后执行)</label></div>
    <textarea class="input" rows="5" v-model="c.vertex" spellcheck="false"></textarea>
    <div class="row-head"><label>片元片段 (在 color_fragment 之后执行)</label></div>
    <textarea class="input" rows="5" v-model="c.fragment" spellcheck="false"></textarea>
    <div class="inline">
      <button class="btn small primary" @click="applyCustom">应用 GLSL</button>
      <span class="muted">可用: transformed / position / normal / uv / uTime / uSeed / aWind / diffuseColor / vTreeUv / vColor(vec4, 用 .rgb)</span>
    </div>
    <div v-if="shaderError" class="error-inline">
      <b>着色器编译失败</b>
      <pre>{{ shaderError }}</pre>
    </div>
  </Section>
</template>

<script setup>
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import ColorRow from '../ui/ColorRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import TextureRow from '../ui/TextureRow.vue'
import { state, applyLeafCard, randomLeafCard } from '../../store/treeStore.js'
import { LEAF_CARDS, LEAF_CARD_BATCHES, leafCardsFor, leafCardRows } from '../../core/leafCards.generated.js'
import {
  BARK_TEXTURES, BARK_BATCHES, barkTexturesFor, barkTextureRows,
} from '../../core/barkTextures.js'
import { computed, ref } from 'vue'

/* ---------------- 内置树皮贴图 ---------------- */
const barkBatch = ref('batch1')
const barkRow = ref(1)
function useBark(bt) {
  if (!bt) return
  // 只改材质贴图: 属于 material 变更组 -> 由材质 watcher 更新 map, 不重建树、不重新取景
  b.texture = bt.url
  // 照片树皮是 1m 左右的局部采样, 直接贴到几十米高的树干上会严重拉伸
  // -> 给一组"接近真实树皮尺度"的平铺默认值 (之后可用 UV 重复滑杆微调)
  if (b.uvScaleU === 1 && b.uvScaleV === 1) {
    b.uvScaleU = 3
    b.uvScaleV = 12
  }
}
function randomBarkTexture() {
  const pool = barkTexturesFor(barkBatch.value, barkRow.value)
  const list = pool.length ? pool : BARK_TEXTURES
  return list[Math.floor(Math.random() * list.length)]
}

const tintOptions = [
  { value: 'texture', label: '原色 (贴图不变色)' },
  { value: 'season', label: '跟随季节叶色' },
  { value: 'custom', label: '自定义强度' },
]
const b = state.params.bark
const lm = state.params.leafMat
const lv = state.params.leaves
const pt = state.params.particles
// 落叶/堆积可独立选贴图: 候选 = 当前批次每个叶形的第一张 + 当前叶形全部变体
const cardChoices = computed(() => {
  const out = []
  const seen = new Set()
  for (const r of leafCardRows(batch.value)) {
    const list = leafCardsFor(batch.value, r)
    if (list[0] && !seen.has(list[0].id)) { seen.add(list[0].id); out.push(list[0]) }
  }
  for (const c of cardsOfShape.value) if (!seen.has(c.id)) { seen.add(c.id); out.push(c) }
  return out.slice(0, 12)
})
function randomCardId() {
  const pool = LEAF_CARDS
  return pool[Math.floor(Math.random() * pool.length)].id
}
const fl = state.params.fall
const lt = state.params.litter
const c = state.params.custom
const shaderError = computed(() => state.shaderError)

/* ---------------- 内置叶片卡片 ---------------- */
const batches = ['batch1', 'batch2']
const total = LEAF_CARDS.length
const batch = ref('batch1')
const row = ref(1)
const col = ref(1)
const cardsOfShape = computed(() => leafCardsFor(batch.value, row.value))
const current = computed(() => cardsOfShape.value[Math.min(col.value - 1, cardsOfShape.value.length - 1)] || cardsOfShape.value[0] || LEAF_CARDS[0])

function use(card) {
  if (!card) return
  // 只换贴图/叶形, 不动相机: 保持当前观察视角 (换卡片不该把视角拉回去)
  applyLeafCard(card.id)
}

function rand() {
  const card = randomLeafCard(batch.value, row.value) || randomLeafCard()
  if (card) {
    const b2 = card.batch
    const r2 = card.row
    batch.value = b2
    row.value = r2
    col.value = Math.max(1, leafCardsFor(b2, r2).findIndex((x) => x.id === card.id) + 1)
  }
}

const barkStyles = [
  { value: 'rough', label: '粗糙 rough' },
  { value: 'birch', label: '白桦 birch' },
  { value: 'pine', label: '松鳞 pine' },
  { value: 'smooth', label: '光滑 smooth' },
]

function applyCustom() {
  state.materialVersion++
}
</script>

<style scoped>
.chip {
  padding: 2px 7px; font-size: 11px; color: var(--text-2);
  background: var(--bg-3); border: 1px solid var(--line); border-radius: 6px; cursor: pointer;
}
.chip.active { border-color: var(--accent); color: #eafff7; }
.chip.dot { padding: 0; width: 34px; height: 34px; overflow: hidden; display: inline-flex; border-radius: 3px; }
/* 缩略图只显示贴图**中间部分**并裁掉圆角: object-fit: cover 会居中裁剪填满方块 */
.chip.dot img { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
.pick-label { font-size: 11px; color: var(--text-2); margin: 6px 0 3px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.chips .chip { white-space: nowrap; }
.chip.nowrap { padding: 4px 8px; }
</style>

<style scoped>
.error-inline {
  background: #3a1515;
  border: 1px solid #7a3030;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 11px;
  color: #ffc9c9;
  max-height: 190px;
  overflow: auto;
}
.error-inline pre { margin: 4px 0 0; white-space: pre-wrap; }
</style>
