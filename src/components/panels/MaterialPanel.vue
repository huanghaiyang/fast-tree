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
    <SliderRow label="凹凸强度 (bump)" v-model="b.bump" :min="0" :max="2" :step="0.05" />
    <SliderRow label="顶点色混合" v-model="b.vertexColorMix" :min="0" :max="1" :step="0.01"
      hint="顶点色里烘焙了根部变暗 / 嫩枝偏绿" />
    <div class="grid-2">
      <SliderRow label="UV 横向重复" v-model="b.uvScaleU" :min="0.2" :max="6" :step="0.1" />
      <SliderRow label="UV 纵向重复" v-model="b.uvScaleV" :min="0.2" :max="6" :step="0.1" />
    </div>
    <TextureRow label="自定义树皮贴图" v-model="b.texture" />
    <TextureRow label="自定义法线贴图" v-model="b.normalTexture" />
  </Section>

  <Section title="树叶材质" hint="Leaf" :default-collapsed="true">
    <ColorRow label="色调 (tint)" v-model="lm.tint" />
    <SliderRow label="顶点色混合" v-model="lm.vertexColorMix" :min="0" :max="1" :step="0.01"
      hint="1 = 完全使用叶片本身的颜色" />
    <SliderRow label="粗糙度" v-model="lm.roughness" :min="0" :max="1" :step="0.01" />
    <SliderRow label="金属度" v-model="lm.metalness" :min="0" :max="1" :step="0.01" />
    <SliderRow label="自发光强度" v-model="lm.emissive" :min="0" :max="1" :step="0.01"
      hint="用叶色做底的自发光: 让背光/阴影里的叶片不发黑" />
    <SliderRow label="Alpha 裁剪" v-model="lm.alphaTest" :min="0" :max="1" :step="0.01" />
    <SliderRow label="透光度 (背光)" v-model="lm.translucency" :min="0" :max="1.5" :step="0.01"
      hint="树叶逆光时的半透效果" />
    <ToggleRow label="双面渲染" v-model="lm.doubleSided" />
    <TextureRow label="自定义叶片贴图 (含 alpha)" v-model="lm.texture" />
    <TextureRow label="自定义法线贴图" v-model="lm.normalTexture" />
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
import { computed, ref } from 'vue'

const b = state.params.bark
const lm = state.params.leafMat
const lv = state.params.leaves
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
.chip.dot { padding: 0; width: 30px; height: 30px; overflow: hidden; display: inline-flex; }
.chip.dot img { width: 100%; height: 100%; object-fit: contain; }
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
