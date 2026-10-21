<template>
  <MaterialPreview />

  <Section title="树皮材质" hint="Bark">
    <SelectRow label="树皮管线" v-model="b.pipeline" :options="barkPipelines"
      hint="默认 SpeedTree 分枝管+领口（无窗口偏移，多个闭合分量）；可切回旧单张连续蒙皮" />
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
    <SliderRow label="贴图扭曲" v-model="b.uvWarp" :min="0" :max="0.3" :step="0.005"
      hint="让贴图 UV 做低频扭曲, 打散平铺重复感 (树皮/树皮纹理更自然); 0 = 关闭" />
    <SliderRow v-if="b.uvWarp > 0" label="扭曲频率" v-model="b.uvWarpScale" :min="1" :max="40" :step="0.5" />
    <SliderRow label="顶点色混合" v-model="b.vertexColorMix" :min="0" :max="1" :step="0.01"
      hint="顶点色里烘焙了根部变暗 / 嫩枝偏绿" />
    <div class="grid-2">
      <SliderRow label="UV 横向重复" v-model="b.uvScaleU" :min="0.2" :max="6" :step="0.1" />
      <SliderRow label="UV 纵向重复" v-model="b.uvScaleV" :min="0.2" :max="6" :step="0.1" />
    </div>
    <TextureRow label="自定义树皮贴图" v-model="b.texture" />
    <TextureRow label="自定义法线贴图" v-model="b.normalTexture" />

    <!-- 内置树皮贴图库 (来自 bark_batch1 / bark_batch2) -->
    <div class="pick-label">内置树皮贴图 ({{ barkTotalReal === null ? BARK_TEXTURES.length + '…' : barkTotalReal }} 张)</div>
    <div class="chips">
      <button class="chip nowrap" :class="{ active: !b.texture }" @click="b.texture = ''">程序化花纹</button>
      <button v-for="bt in BARK_BATCHES" :key="bt.id" class="chip nowrap"
        :class="{ active: barkBatch === bt.id }" @click="barkBatch = bt.id; barkRow = barkTextureRows(bt.id)[0]">{{ bt.name }}<template v-if="barkRealCount(bt.id) !== null"> · {{ barkRealCount(bt.id) }}</template></button>
    </div>
    <div class="chips">
      <span class="muted">款式</span>
      <button v-for="r in barkTextureRows(barkBatch)" :key="r" class="chip" :class="{ active: barkRow === r }"
        @click="barkRow = r">#{{ r }}</button>
    </div>
    <div class="chips">
      <button v-for="bt in barkChoices" :key="bt.id" class="chip dot"
        :class="{ active: b.texture === bt.url }" :title="bt.name" @click="useBark(bt)">
        <img :src="bt.url" alt="" @error="onThumbError(e)" />
      </button>
      <button class="btn small" title="随机一张树皮" @click="useBark(randomBarkTexture())">🎲</button>
    </div>
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
import MaterialPreview from './MaterialPreview.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import ColorRow from '../ui/ColorRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import TextureRow from '../ui/TextureRow.vue'
import { state } from '../../store/treeStore.js'
import {
  BARK_TEXTURES, BARK_BATCHES, barkTexturesFor, barkTextureRows,
} from '../../core/barkTextures.js'
import { computed, ref, watch, onMounted } from 'vue'

/* ---------------- 缩略图存在性校验 (路径枚举会碰上空号) ---------------- */
const missing = ref({})            // url -> true 表示 404
const exists = ref({})             // url -> true 表示探测到存在 (HEAD 200)
async function probe(urls) {
  const todo = urls.filter((x) => exists.value[x] === undefined && missing.value[x] !== true)
  if (!todo.length) return
  await Promise.all(todo.map(async (url) => {
    try {
      const r = await fetch(url, { method: 'HEAD' })
      // 注意: dev server 对缺失文件会 SPA 回退成 200 + index.html,
      // 所以必须看 content-type 是不是图片, 否则会把"缺图"当成"存在"
      const ct = (r.headers.get('content-type') || '').toLowerCase()
      const ok = r.ok && ct.startsWith('image/')
      if (ok) exists.value = { ...exists.value, [url]: true }
      else missing.value = { ...missing.value, [url]: true }
    } catch (e) {
      missing.value = { ...missing.value, [url]: true }
    }
  }))
}
function onThumbError(e) {
  const img = e && e.target
  if (!img) return
  const url = img.getAttribute('src') || ''
  if (url) missing.value = { ...missing.value, [url]: true }
  // 整个按钮一起隐藏, 避免留下"空方块"
  const btn = img.parentElement
  if (btn) btn.style.display = 'none'
}
const alive = (list) => (list || []).filter((x) => !missing.value[x.url])

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
    b.uvScaleV = 1.5
  }
}
const barkChoices = computed(() => alive(barkTexturesFor(barkBatch.value, barkRow.value)))
function randomBarkTexture() {
  const pool = barkChoices.value.length ? barkChoices.value : BARK_TEXTURES
  return pool[Math.floor(Math.random() * pool.length)]
}

const barkPipelines = [
  { value: 'speedtree', label: 'SpeedTree 分枝管 + 领口（默认）' },
  { value: 'skin', label: '单张连续蒙皮（旧）' },
]

const barkStyles = [
  { value: 'rough', label: '粗糙 rough' },
  { value: 'birch', label: '白桦 birch' },
  { value: 'pine', label: '松鳞 pine' },
  { value: 'smooth', label: '光滑 smooth' },
]

const b = computed(() => state.params.bark)
const c = computed(() => state.params.custom)
const shaderError = computed(() => state.shaderError)

function applyCustom() {
  state.materialVersion++
}

/* ---- 断档校验: 所有定义就绪后再探测 ---- */
watch([barkBatch, barkRow], () => probe(barkTexturesFor(barkBatch.value, barkRow.value).map((t) => t.url)), { immediate: true })

/* ---------------- 批次真实张数 (整批探测一次, 结果缓存) ---------------- */
const probedBarkBatches = ref({})
const barkTotalReal = computed(() => {
  const ids = Object.keys(probedBarkBatches.value)
  if (ids.length < BARK_BATCHES.length) return null
  return ids.reduce((sum, id) => sum + (barkRealCount(id) || 0), 0)
})
const barkRealCount = (bt) => (probedBarkBatches.value[bt] ? BARK_TEXTURES.filter((t) => t.batch === bt && exists.value[t.url] === true).length : null)
async function probeBarkBatch(bt) {
  if (probedBarkBatches.value[bt]) return
  const urls = BARK_TEXTURES.filter((t) => t.batch === bt).map((t) => t.url)
  for (let i = 0; i < urls.length; i += 16) await probe(urls.slice(i, i + 16))
  probedBarkBatches.value = { ...probedBarkBatches.value, [bt]: true }
}
onMounted(() => {
  for (const bt of BARK_BATCHES) probeBarkBatch(bt.id)
})
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

