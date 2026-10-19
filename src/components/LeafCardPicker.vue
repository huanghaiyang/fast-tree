<template>
  <Section title="内置叶片卡片" hint="Leaf Cards" :default-collapsed="true">
    <ToggleRow label="贴图卡片模式" v-model="lv.cardMode"
      hint="叶形轮廓直接用贴图 alpha (照片级); 关闭则用程序化叶形轮廓" />
    <div class="chips">
      <span class="muted">批次</span>
      <button v-for="bt in batches" :key="bt" class="chip" :class="{ active: batch === bt }"
        @click="batch = bt; row = leafCardRows(bt)[0]">{{ batchLabel(bt) }} · {{ batchRealCount(bt) === null ? batchCount(bt) + '…' : batchRealCount(bt) }}</button>
    </div>
    <div class="chips">
      <span class="muted">叶形</span>
      <button v-for="r in leafCardRows(batch)" :key="r" class="chip" :class="{ active: row === r }"
        @click="row = r">#{{ r }}</button>
    </div>
    <div class="chips">
      <span class="muted">颜色变体</span>
      <button v-for="cd in variantCards" :key="cd.id" class="chip dot"
        :class="{ active: lm.texture === cd.url }" :style="{ background: 'transparent' }"
        @click="use(cd)" :title="cd.id + ' (' + cd.w + '×' + cd.h + ')'">
        <img :src="cd.url" alt="" />
      </button>
      <span v-if="!variantCards.length" class="muted">正在检测可用贴图…</span>
    </div>
    <div class="inline">
      <button class="btn small primary" @click="use(current)">应用这张叶子</button>
      <button class="btn small" @click="rand">🎲 随机叶片</button>
      <span class="tag" :class="{ on: lv.cardMode }">{{ lv.cardMode ? '卡片模式' : '程序化叶形' }}</span>
      <button class="btn small" @click="onFitLeafTexture">📐 适配贴图尺寸</button>
    </div>
    <p class="muted" style="margin: 0">
      内置 {{ total }} 张已按 alpha 裁边的叶片卡片；
      点缩略图即刻换上：叶形与贴图完全一致，并自动把"顶点色混合"设为 0（免得季节调色板把照片颜色染偏）。
    </p>
  </Section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import Section from './ui/Section.vue'
import ToggleRow from './ui/ToggleRow.vue'
import { state, applyLeafCard, fitLeafCardToTexture } from '../store/treeStore.js'
import { LEAF_CARDS, LEAF_CARD_BATCHES, LEAF_CARD_BATCH_NAMES, leafCardsFor, leafCardRows } from '../core/leafCards.generated.js'

const lv = state.params.leaves
const lm = state.params.leafMat

/* ---------------- 缩略图存在性校验 (路径枚举会碰上空号) ---------------- */
const missing = ref({})
const exists = ref({})
async function probe(urls) {
  const todo = urls.filter((x) => exists.value[x] === undefined && missing.value[x] !== true)
  if (!todo.length) return
  await Promise.all(todo.map(async (url) => {
    try {
      const r = await fetch(url, { method: 'HEAD' })
      // dev server 对缺失文件会 SPA 回退成 200 + index.html -> 必须看 content-type
      const ct = (r.headers.get('content-type') || '').toLowerCase()
      const ok = r.ok && ct.startsWith('image/')
      if (ok) exists.value = { ...exists.value, [url]: true }
      else missing.value = { ...missing.value, [url]: true }
    } catch {
      missing.value = { ...missing.value, [url]: true }
    }
  }))
}

/* ---------------- 卡片库 ---------------- */
const batches = Object.keys(LEAF_CARD_BATCHES)
const batchLabel = (bt) => LEAF_CARD_BATCH_NAMES[bt] || bt
const batchCount = (bt) => (LEAF_CARD_BATCHES[bt] ? Object.values(LEAF_CARD_BATCHES[bt]).reduce((a, b) => a + b, 0) : 0)
const total = LEAF_CARDS.length
const batch = ref('batch1')
const row = ref(1)
const cardsOfShape = computed(() => leafCardsFor(batch.value, row.value))
// 只展示 HEAD 探测确认存在的卡片, 避免 404 缩略图/空图标
const variantCards = computed(() => cardsOfShape.value.filter((c) =>
  exists.value[c.url] === true && missing.value[c.url] !== true))
const current = computed(() => variantCards.value[0] || null)

function use(card) {
  if (!card) return
  // 只换贴图/叶形, 不动相机
  applyLeafCard(card.id)
}

function rand() {
  // 随机叶片: 从已探测存在的卡片里随机挑一张并立即应用
  // (以前只改批次/叶形、不应用, 且探测未完成时 variantCards 为空 -> 看起来"失效")
  const valid = LEAF_CARDS.filter((c) => exists.value[c.url] === true && missing.value[c.url] !== true)
  const pool = valid.length ? valid : variantCards.value
  if (!pool.length) return
  const card = pool[Math.floor(Math.random() * pool.length)]
  if (!card) return
  batch.value = card.batch
  row.value = card.row
  applyLeafCard(card.id)
}

async function onFitLeafTexture() {
  const a = await fitLeafCardToTexture()
  if (!a) console.warn('适配贴图尺寸失败: 没有可用树叶贴图')
}

/* ---- 断档校验: 所有定义就绪后再探测 ---- */
watch([batch, row], () => probe(cardsOfShape.value.map((c) => c.url)), { immediate: true })

const probedBatches = ref({})
const realCount = (bt) => LEAF_CARDS.filter((c) => c.batch === bt && exists.value[c.url] === true).length
const batchRealCount = (bt) => (probedBatches.value[bt] ? realCount(bt) : null)
async function probeBatch(bt) {
  if (probedBatches.value[bt]) return
  const urls = LEAF_CARDS.filter((c) => c.batch === bt).map((c) => c.url)
  for (let i = 0; i < urls.length; i += 16) await probe(urls.slice(i, i + 16))
  probedBatches.value = { ...probedBatches.value, [bt]: true }
}
onMounted(() => {
  for (const bt of batches) probeBatch(bt)
})
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


