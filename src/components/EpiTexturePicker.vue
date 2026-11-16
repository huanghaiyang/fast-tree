<template>
  <div class="row">
    <div class="row-head">
      <label title="附生贴图库：从内置叶片卡片里挑一张给蕨类/垂藤用；也可以自己上传">内置附生贴图</label>
      <span class="tag" :class="{ on: !!E.texture }">{{ E.texture ? '已选贴图' : '跟随树叶' }}</span>
    </div>

    <div class="chips">
      <span class="muted">批次</span>
      <button v-for="bt in batches" :key="bt" class="chip" :class="{ active: batch === bt }"
        @click="batch = bt; row = leafCardRows(bt)[0]">{{ batchLabel(bt) }}</button>
    </div>
    <div class="chips">
      <span class="muted">叶形</span>
      <button v-for="r in leafCardRows(batch)" :key="r" class="chip" :class="{ active: row === r }"
        @click="row = r">#{{ r }}</button>
    </div>
    <div class="tex-cards">
      <span class="muted">颜色变体</span>
      <TextureCard v-for="cd in variantCards" :key="cd.id" :src="cd.url"
        :active="E.texture === cd.url" :title="cd.id" @pick="use(cd)" />
      <span v-if="!variantCards.length" class="muted">正在检测可用贴图…</span>
    </div>
    <div class="inline">
      <button class="btn small ghost" :disabled="!E.texture" @click="E.texture = ''">跟随树叶贴图</button>
      <span class="muted">点缩略图即把这个贴图交给附生卡片（只作用于蕨类/垂藤）</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import TextureCard from './ui/TextureCard.vue'
import { state } from '../store/treeStore.js'
import { LEAF_CARDS, LEAF_CARD_BATCHES, LEAF_CARD_BATCH_NAMES, leafCardsFor, leafCardRows } from '../core/leafCards.generated.js'

/* 附生贴图选择：复用"内置叶片卡片"这套资源，但写进 params.epiphyte.texture。
 * 为什么是 URL 而不是卡片 id: 材质侧 (materials.js 的 uEpiphyteMap) 只认"贴图地址",
 * dataURL(自己上传) 与卡片相对路径走同一条 loadTexture 通路, 不需要为两种来源写分支。
 * 空串 = 跟随树叶贴图/程序化叶形 (原行为)。 */
const E = computed(() => state.params.epiphyte)

const missing = ref({})
const exists = ref({})
async function probe(urls) {
  const todo = urls.filter((x) => exists.value[x] === undefined && missing.value[x] !== true)
  if (!todo.length) return
  await Promise.all(todo.map(async (url) => {
    try {
      const r = await fetch(url, { method: 'HEAD' })
      // dev server 对缺失文件会 SPA 回退成 200 + index.html -> 必须核对 content-type
      const ct = (r.headers.get('content-type') || '').toLowerCase()
      if (r.ok && ct.startsWith('image/')) exists.value = { ...exists.value, [url]: true }
      else missing.value = { ...missing.value, [url]: true }
    } catch {
      missing.value = { ...missing.value, [url]: true }
    }
  }))
}

const batches = Object.keys(LEAF_CARD_BATCHES)
const batchLabel = (bt) => LEAF_CARD_BATCH_NAMES[bt] || bt
const batch = ref('batch1')
const row = ref(1)
const cardsOfShape = computed(() => leafCardsFor(batch.value, row.value))
// 只展示 HEAD 探测确认存在的卡片，避免 404 缩略图
const variantCards = computed(() => cardsOfShape.value.filter((c) =>
  exists.value[c.url] === true && missing.value[c.url] !== true))

function use(card) {
  if (!card) return
  E.value.texture = card.url
}

watch([batch, row], () => probe(cardsOfShape.value.map((c) => c.url)), { immediate: true })

// 首屏把第 1 批全部探一遍：用户切叶形时缩略图立刻可用
onMounted(async () => {
  const urls = LEAF_CARDS.filter((c) => c.batch === 'batch1').map((c) => c.url)
  for (let i = 0; i < urls.length; i += 16) await probe(urls.slice(i, i + 16))
})
</script>

<style scoped>
.chip {
  padding: 2px 7px; font-size: 11px; color: var(--text-2);
  background: var(--bg-3); border: 1px solid var(--line); border-radius: 6px; cursor: pointer;
}
.chip.active { border-color: var(--accent); color: #eafff7; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.chips .chip { white-space: nowrap; }
</style>
