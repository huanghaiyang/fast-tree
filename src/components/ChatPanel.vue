<template>
  <div class="chat-fab">
    <button class="chat-toggle" :class="{ open }" @click="open = !open" title="大模型助手">
      {{ open ? '✕' : '🤖' }}
    </button>

    <div v-if="open" class="chat-panel">
      <!-- 顶部 -->
      <div class="chat-head">
        <button class="icon-btn" :class="{ active: historyOpen }" title="历史记录" @click="historyOpen = !historyOpen">🗂</button>
        <b class="chat-name">大模型助手</b>
        <select v-model="model" class="chat-model" title="选择模型 (🖼 = 支持图片识别)" @change="onModelChange">
          <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
        <button class="icon-btn" title="新对话 (上下文完全独立)" @click="newConversation">＋</button>
        <button class="icon-btn" title="关闭" @click="open = false">✕</button>
        <span class="chat-status" :class="{ ok: bridgeOk }" :title="bridgeOk ? '本地桥已连接' : '本地桥未连接 (需要 npm run dev)'">{{ bridgeOk ? '●' : '●' }}</span>
      </div>

      <!-- 历史记录 -->
      <div v-if="historyOpen" class="hist">
        <div class="hist-top">
          <input v-model="histQuery" class="hist-search" placeholder="搜索对话内容…" />
        </div>
        <div class="hist-tabs">
          <button v-for="t in histTabs" :key="t.id" class="hist-tab" :class="{ active: histMode === t.id }" @click="histMode = t.id">
            {{ t.label }}<span class="n">{{ t.count }}</span>
          </button>
        </div>
        <div class="hist-list">
          <div v-if="!historyList.length" class="hist-empty">{{ histEmptyText }}</div>
          <div v-for="c in historyList" :key="c.id" class="hist-item" :class="{ active: c.id === activeId }" @click="switchConversation(c.id)">
            <div class="hist-main">
              <div class="hist-title">
                <span v-if="c.pinned" title="已置顶">📌</span>
                <span v-if="c.favorite" title="已收藏">⭐</span>
                <span v-if="c.archived" title="已归档">📦</span>
                <span class="hist-title-text">{{ c.title || '新对话' }}</span>
              </div>
              <div class="hist-meta">
                {{ fmtTime(c.updatedAt) }} · {{ c.messages.length }} 条
                <span v-if="c.id === activeId" class="tag-now">当前</span>
              </div>
            </div>
            <div class="hist-actions" @click.stop>
              <button class="mini" :class="{ on: c.pinned }" :title="c.pinned ? '取消置顶' : '置顶'" @click="togglePin(c)">📌</button>
              <button class="mini" :class="{ on: c.favorite }" :title="c.favorite ? '取消收藏' : '收藏'" @click="toggleFavorite(c)">⭐</button>
              <button class="mini" :class="{ on: c.archived }" :title="c.archived ? '取消归档' : '归档'" @click="toggleArchive(c)">📦</button>
              <button class="mini danger" :class="{ confirm: pendingDeleteId === c.id }"
                :title="pendingDeleteId === c.id ? '再次点击确认删除' : '删除对话'" @click.stop="onDeleteClick(c)">
                {{ pendingDeleteId === c.id ? '确认?' : '🗑' }}
              </button>
            </div>
          </div>
        </div>
        <div class="hist-foot">
          共 {{ conversations.length }} 个对话 · ⭐{{ favCount }} · 📦{{ archivedCount }} · 新对话与上下文互不影响
        </div>
      </div>

      <!-- 消息列表 -->
      <div v-else ref="listEl" class="chat-list" @scroll="onScroll">
        <div v-if="!messages.length" class="chat-tip">
          <div class="tip-title">用自然语言操作这棵树</div>
          <div class="tip-row">· 把叶子调大一点，加一些花</div>
          <div class="tip-row">· 换成樱花树，春天，开满花</div>
          <div class="tip-row">· 打开线框模式看看拓扑</div>
          <div class="tip-feats">
            支持：🖼 图片识别 · 🧠 思考过程 · 🌐 联网搜索 · ↻ 重新生成 · ❝ 引用 · 🗂 历史记录
          </div>
        </div>

        <div v-for="m in messages" :key="m.id" class="chat-msg" :class="m.role">
          <div class="msg-head">
            <span class="who">{{ m.role === 'user' ? '你' : '🤖' }}</span>
            <span class="msg-meta">
              {{ fmtTime(m.createdAt) }}<span v-if="m.model"> · {{ shortModel(m.model) }}</span>
              <span v-if="m.search" title="联网搜索已开启"> · 🌐</span>
            </span>
            <span class="msg-actions">
              <button v-if="m.role === 'assistant' && m.thinking" class="mini" title="显示/隐藏思考过程" @click="m.thinkingOpen = !m.thinkingOpen">🧠</button>
              <button class="mini" title="复制" @click="copyMessage(m)">⧉</button>
              <button class="mini" title="引用到输入框" @click="quoteMessage(m)">❝</button>
              <button v-if="canRegenerate(m)" class="mini" title="重新生成" @click="regenerate(m)">↻</button>
            </span>
          </div>

          <div v-if="m.images && m.images.length" class="msg-images">
            <img v-for="(im, k) in m.images" :key="k" :src="im.dataUrl" :alt="im.name" :title="im.name" @click="preview = im.dataUrl" />
          </div>

          <div v-if="m.thinking" class="thinking">
            <button class="think-head" @click="m.thinkingOpen = !m.thinkingOpen">
              <span>{{ m.thinkingOpen ? '▾' : '▸' }} 🧠 思考过程</span>
              <span class="think-count">{{ m.thinking.length }} 字</span>
            </button>
            <div v-if="m.thinkingOpen" class="think-body">{{ m.thinking }}<span v-if="m.streaming" class="caret">▌</span></div>
          </div>

          <div v-if="m.tools && m.tools.length" class="tool-row">
            <span v-for="(t, k) in m.tools" :key="k" class="tool-chip" :class="t.status">
              {{ t.status === 'running' ? '⏳' : t.ok ? '🔧' : '⚠' }} {{ t.brief || t.name }}
            </span>
          </div>

          <div v-if="m.content" class="bubble markdown" v-html="renderMarkdown(m.content)"></div>
          <div v-if="m.status && m.streaming" class="stream-status">{{ m.status }}</div>
          <div v-if="m.error" class="err">⚠️ {{ m.error }}</div>

          <div v-if="m.sources && m.sources.length" class="sources">
            <div class="sources-head">🌐 联网来源</div>
            <div v-for="(s, k) in m.sources" :key="k" class="source-item">
              <span class="src-idx">[{{ k + 1 }}]</span>
              <a :href="s.url" target="_blank" rel="noopener noreferrer" :title="s.snippet || s.title">{{ s.title || s.url }}</a>
              <button class="mini" title="引用到输入框" @click="quoteSource(m, s, k)">引用</button>
            </div>
          </div>
        </div>

        <div v-if="activeConv && activeConv.busy && !streamingAssistant" class="chat-msg assistant">
          <div class="bubble typing">思考中<span class="dots">…</span></div>
        </div>
      </div>

      <!-- 输入区 -->
      <div v-if="!historyOpen" class="chat-input-wrap">
        <div v-if="pendingImages.length" class="pending-images">
          <div v-for="(im, k) in pendingImages" :key="k" class="pending-img" :title="im.name">
            <img :src="im.dataUrl" :alt="im.name" />
            <button class="rm" @click="pendingImages.splice(k, 1)">✕</button>
          </div>
          <span class="pending-hint">{{ pendingImages.length }}/6 张图片待发送</span>
        </div>
        <div class="chat-input">
          <textarea ref="inputEl" v-model="input" rows="2"
            :placeholder="activeConv && activeConv.busy ? '正在生成… (可点停止)' : '描述你想要的树… (Enter 发送 / Shift+Enter 换行 / 可粘贴图片)'"
            @keydown.enter.exact="onEnterKey" @paste="onPaste"></textarea>
          <div class="input-side">
            <button class="icon-btn" title="上传图片 (可识别)" :disabled="!!(activeConv && activeConv.busy)" @click="imageInput?.click()">🖼</button>
            <button class="icon-btn" :class="{ on: searchOn }" title="联网搜索 (回答附带来源)" @click="toggleSearch">🌐</button>
            <button v-if="activeConv && activeConv.busy" class="btn small danger" @click="stopGeneration(activeConv)">■ 停止</button>
            <button v-else class="btn small primary" :disabled="!canSend" @click="send">发送</button>
          </div>
        </div>
        <input ref="imageInput" type="file" accept="image/*" multiple hidden @change="onPickImages" />
        <div class="chat-foot">
          <span class="foot-hint">{{ activeConv ? activeConv.messages.length + ' 条 · 本地保存' : '' }}</span>
          <span v-if="statusText" class="chat-check">{{ statusText }}</span>
          <button class="mini" @click="selfcheck" title="应用/MCP/大模型自检">MCP 自检</button>
        </div>
      </div>
    </div>

    <!-- 图片预览 -->
    <div v-if="preview" class="img-preview" @click="preview = ''">
      <img :src="preview" alt="preview" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'

/* ------------------------------------------------------------------ */
/* 常量 / 工具                                                         */
/* ------------------------------------------------------------------ */
const STORAGE_KEY = 'fasttree.chat.v1'
const DEFAULT_MODELS = [
  { id: 'deepseek-flash', label: 'DeepSeek Flash · 视觉+思考 🖼' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro · 文本' },
]
const MAX_IMAGES = 6
const MAX_EDIT_TEXT = 300

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }
function bridgeBase() {
  if (typeof window !== 'undefined' && window.__FAST_TREE_BRIDGE__) return window.__FAST_TREE_BRIDGE__
  const port = typeof __APP_BRIDGE_PORT__ !== 'undefined' ? __APP_BRIDGE_PORT__ : 5275
  return 'http://127.0.0.1:' + port
}
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前'
  if (diff < 24 * 3600e3) return Math.floor(diff / 3600e3) + ' 小时前'
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function shortModel(id) {
  if (!id) return ''
  if (id.includes('flash')) return 'Flash'
  if (id.includes('pro')) return 'Pro'
  return id.replace(/^deepseek-/, '')
}
function makeTitle(text, images) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (t) return t.slice(0, 22) + (t.length > 22 ? '…' : '')
  if (images && images.length) return `图片对话 (${images.length} 张)`
  return '新对话'
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = reject
    fr.readAsDataURL(file)
  })
}
/** 压缩到最长边 1024、JPEG 0.85 (识别够用, 同时控制 localStorage 体积) */
async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type)) return { error: '不是图片文件' }
  if (file.size > 15 * 1024 * 1024) return { error: '图片过大 (>15MB)' }
  const raw = await readFileAsDataUrl(file)
  const img = await loadImage(raw)
  const max = 1024
  const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1))
  const w = Math.max(1, Math.round((img.width || 1) * scale))
  const h = Math.max(1, Math.round((img.height || 1) * scale))
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  let dataUrl = cv.toDataURL('image/jpeg', 0.85)
  if (dataUrl.length > 1.6e6) dataUrl = cv.toDataURL('image/jpeg', 0.7)
  return { name: file.name || 'image.jpg', dataUrl, width: w, height: h }
}

/* ------------------------------------------------------------------ */
/* 响应式状态                                                          */
/* ------------------------------------------------------------------ */
const open = ref(false)
const historyOpen = ref(false)
const histQuery = ref('')
const histMode = ref('all')
const histTabs = computed(() => [
  { id: 'all', label: '全部', count: conversations.value.filter((c) => !c.archived).length },
  { id: 'fav', label: '收藏', count: favCount.value },
  { id: 'archive', label: '归档', count: archivedCount.value },
])
const conversations = ref([])
const activeId = ref('')
const model = ref('deepseek-flash')
const modelOptions = ref(DEFAULT_MODELS.slice())
const bridgeOk = ref(false)
const statusText = ref('')
const input = ref('')
const pendingImages = ref([])
const imageInput = ref(null)
const inputEl = ref(null)
const listEl = ref(null)
const preview = ref('')
const pendingDeleteId = ref('')
let pendingDeleteTimer = 0
const searchOn = ref(false)
const streamingAssistant = ref(null)
const abortMap = new Map() // conversation id -> AbortController
let autoScroll = true
let pingTimer = null
let saveTimer = null

const activeConv = computed(() => conversations.value.find((c) => c.id === activeId.value) || null)
const messages = computed(() => (activeConv.value ? activeConv.value.messages : []))
const canSend = computed(() => {
  if (!activeConv.value || activeConv.value.busy) return false
  return !!input.value.trim() || pendingImages.value.length > 0
})
const favCount = computed(() => conversations.value.filter((c) => c.favorite).length)
const archivedCount = computed(() => conversations.value.filter((c) => c.archived).length)
const historyList = computed(() => {
  const q = histQuery.value.trim().toLowerCase()
  const list = conversations.value.filter((c) => {
    if (histMode.value === 'archive') return c.archived
    if (histMode.value === 'fav') return c.favorite && !c.archived
    return !c.archived
  }).filter((c) => {
    if (!q) return true
    if (String(c.title || '').toLowerCase().includes(q)) return true
    return c.messages.some((m) => String(m.content || '').toLowerCase().includes(q))
  })
  return list.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt))
})
const histEmptyText = computed(() => {
  if (histQuery.value.trim()) return '没有匹配的对话'
  if (histMode.value === 'fav') return '还没有收藏的对话'
  if (histMode.value === 'archive') return '还没有归档的对话'
  return '还没有历史对话'
})

/* ------------------------------------------------------------------ */
/* 持久化                                                              */
/* ------------------------------------------------------------------ */
function serializeConversation(c) {
  return {
    id: c.id,
    title: c.title || '新对话',
    createdAt: c.createdAt || Date.now(),
    updatedAt: c.updatedAt || Date.now(),
    pinned: !!c.pinned,
    favorite: !!c.favorite,
    archived: !!c.archived,
    model: c.model || 'deepseek-flash',
    search: !!c.search,
    messages: c.messages.map((m) => ({
      id: m.id, role: m.role, content: m.content || '', thinking: m.thinking || '',
      images: (m.images || []).map((im) => ({ name: im.name, dataUrl: im.dataUrl, width: im.width, height: im.height })),
      tools: (m.tools || []).map((t) => ({ name: t.name, brief: t.brief, ok: !!t.ok })),
      sources: (m.sources || []).map((s) => ({ title: s.title, url: s.url, snippet: s.snippet, date: s.date })),
      model: m.model || '', search: !!m.search, error: m.error || '', createdAt: m.createdAt || Date.now(),
    })),
  }
}
function hydrateConversation(c) {
  return {
    id: c.id || uid(),
    title: c.title || '新对话',
    createdAt: c.createdAt || Date.now(),
    updatedAt: c.updatedAt || Date.now(),
    pinned: !!c.pinned,
    favorite: !!c.favorite,
    archived: !!c.archived,
    model: c.model || model.value,
    search: !!c.search,
    busy: false,
    messages: (Array.isArray(c.messages) ? c.messages : []).map((m) => ({
      id: m.id || uid(),
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || '',
      thinking: m.thinking || '',
      images: Array.isArray(m.images) ? m.images : [],
      tools: Array.isArray(m.tools) ? m.tools : [],
      sources: Array.isArray(m.sources) ? m.sources : [],
      model: m.model || '',
      search: !!m.search,
      error: m.error || '',
      createdAt: m.createdAt || Date.now(),
      streaming: false,
      thinkingOpen: false,
      status: '',
    })),
  }
}
function loadStore() {
  let data = null
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch (e) { data = null }
  if (data && Array.isArray(data.conversations) && data.conversations.length) {
    conversations.value = data.conversations.map(hydrateConversation)
    activeId.value = data.conversations.some((c) => c.id === data.activeId) ? data.activeId : conversations.value[0].id
    model.value = data.model || model.value
    searchOn.value = !!data.search
  } else {
    const c = hydrateConversation({ id: uid(), title: '新对话', messages: [] })
    conversations.value = [c]
    activeId.value = c.id
  }
  // 让会话记住自己的模型/搜索设置, 首次回填
  for (const c of conversations.value) {
    if (!c.model) c.model = model.value
    if (c.search === undefined) c.search = searchOn.value
  }
  applyActiveSettings()
}
function applyActiveSettings() {
  const c = activeConv.value
  if (!c) return
  if (c.model) model.value = c.model
  if (typeof c.search === 'boolean') searchOn.value = c.search
}
function saveStore() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  try {
    const payload = {
      version: 1,
      activeId: activeId.value,
      model: model.value,
      search: searchOn.value,
      savedAt: Date.now(),
      conversations: conversations.value.map(serializeConversation),
    }
    let text = JSON.stringify(payload)
    if (text.length > 3.5e6) text = JSON.stringify(trimForQuota(payload, 3.2e6))
    localStorage.setItem(STORAGE_KEY, text)
  } catch (e) {
    statusText.value = '本地存储空间不足，已省略部分旧图片'
    try {
      const payload = {
        version: 1, activeId: activeId.value, model: model.value, search: searchOn.value, savedAt: Date.now(),
        conversations: conversations.value.map(serializeConversation).map((c) => ({
          ...c,
          messages: c.messages.map((m) => ({ ...m, images: m.images.map((im) => ({ name: im.name, dataUrl: '', omitted: true })) })),
        })),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (e2) { /* 放弃本次保存, 不阻塞对话 */ }
  }
}
function trimForQuota(payload, limit) {
  const copy = JSON.parse(JSON.stringify(payload))
  const ordered = copy.conversations.slice().sort((a, b) => (a.favorite - b.favorite) || (a.updatedAt - b.updatedAt))
  for (const c of ordered) {
    if (c.id === copy.activeId) continue
    for (const m of c.messages) {
      if (m.images && m.images.length) {
        m.images = m.images.map((im) => ({ name: im.name, dataUrl: '', omitted: true }))
        if (JSON.stringify(copy).length < limit) return copy
      }
    }
  }
  return copy
}
function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = null; saveStore() }, 800)
}

/* ------------------------------------------------------------------ */
/* 会话管理                                                            */
/* ------------------------------------------------------------------ */
function createConversation() {
  const c = hydrateConversation({ id: uid(), title: '新对话', messages: [], model: model.value, search: searchOn.value })
  conversations.value.unshift(c)
  return c
}
function newConversation() {
  if (activeConv.value && activeConv.value.busy) stopGeneration(activeConv.value)
  const c = createConversation()
  activeId.value = c.id
  historyOpen.value = false
  histQuery.value = ''
  histMode.value = 'all'
  applyActiveSettings()
  input.value = ''
  pendingImages.value = []
  saveStore()
  nextTick(() => inputEl.value?.focus())
}
function switchConversation(id) {
  if (id === activeId.value) { historyOpen.value = false; return }
  if (activeConv.value && activeConv.value.busy) stopGeneration(activeConv.value)
  activeId.value = id
  historyOpen.value = false
  applyActiveSettings()
  pendingImages.value = []
  input.value = ''
  autoScroll = true
  saveStore()
  nextTick(() => scrollBottom(true))
}
function deleteConversation(c) {
  if (!c) return
  if (c.busy) stopGeneration(c)
  const idx = conversations.value.findIndex((x) => x.id === c.id)
  if (idx < 0) return
  conversations.value.splice(idx, 1)
  pendingDeleteId.value = ''
  if (!conversations.value.length) {
    const nc = createConversation()
    activeId.value = nc.id
  } else if (activeId.value === c.id) {
    activeId.value = conversations.value[0].id
    applyActiveSettings()
  }
  saveStore()
}
/** 两步确认删除: 第一次点击变成"确认?" 3 秒后复位 (避免误删, 也不依赖原生 confirm) */
function onDeleteClick(c) {
  if (pendingDeleteId.value === c.id) {
    clearTimeout(pendingDeleteTimer)
    deleteConversation(c)
    return
  }
  pendingDeleteId.value = c.id
  clearTimeout(pendingDeleteTimer)
  pendingDeleteTimer = setTimeout(() => { pendingDeleteId.value = '' }, 3000)
}
function togglePin(c) { c.pinned = !c.pinned; c.updatedAt = c.updatedAt || Date.now(); saveStore() }
function toggleFavorite(c) { c.favorite = !c.favorite; saveStore() }
function toggleArchive(c) {
  c.archived = !c.archived
  if (c.archived) c.pinned = false
  saveStore()
}
function onModelChange() {
  if (activeConv.value) activeConv.value.model = model.value
  saveStore()
}
function toggleSearch() {
  searchOn.value = !searchOn.value
  if (activeConv.value) activeConv.value.search = searchOn.value
  saveStore()
}

/* ------------------------------------------------------------------ */
/* 消息发送 / 流式接收                                                  */
/* ------------------------------------------------------------------ */
function toApiMessage(m) {
  if (m.role === 'user') {
    const imgs = (m.images || []).filter((im) => im.dataUrl)
    if (imgs.length) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content || '请识别这张图片的内容' },
          ...imgs.map((im) => ({ type: 'image_url', image_url: { url: im.dataUrl } })),
        ],
      }
    }
    return { role: 'user', content: m.content || '' }
  }
  return { role: 'assistant', content: m.content || '' }
}
function buildHistory(conv) {
  const out = []
  for (const m of conv.messages) {
    if (m.role === 'assistant' && !String(m.content || '').trim()) continue
    if (m.role === 'user' && !String(m.content || '').trim() && !(m.images || []).some((im) => im.dataUrl)) continue
    out.push(toApiMessage(m))
  }
  // 只带最近 24 条消息 (图片太大时再减半), 控制请求体积
  let trimmed = out.slice(-24)
  while (trimmed.length > 2 && JSON.stringify(trimmed).length > 9e6) trimmed = trimmed.slice(2)
  return trimmed
}
function onEnterKey(e) {
  if (e && e.isComposing) return
  e.preventDefault()
  send()
}
async function send() {
  const conv = activeConv.value
  if (!conv || conv.busy) return
  const text = input.value.trim()
  const imgs = pendingImages.value.slice()
  if (!text && !imgs.length) return
  input.value = ''
  pendingImages.value = []
  const um = { id: uid(), role: 'user', content: text, images: imgs, createdAt: Date.now(), thinking: '', tools: [], sources: [], streaming: false, status: '' }
  conv.messages.push(um)
  if (!conv.messages.some((m) => m.role === 'user' && m.id !== um.id)) conv.title = makeTitle(text, imgs)
  conv.updatedAt = Date.now()
  autoScroll = true
  await nextTick(); scrollBottom(true)
  saveStore()
  requestReply(conv)
}
async function requestReply(conv) {
  if (!conv || conv.busy) return
  const history = buildHistory(conv)
  const am = {
    id: uid(), role: 'assistant', content: '', thinking: '', images: [], tools: [], sources: [],
    model: conv.model || model.value, search: !!conv.search,
    createdAt: Date.now(), streaming: true, thinkingOpen: true, status: '正在连接…', error: '',
  }
  conv.messages.push(am)
  conv.busy = true
  conv.updatedAt = Date.now()
  streamingAssistant.value = am
  autoScroll = true
  await nextTick(); scrollBottom(true)
  try {
    await streamReply(conv, am, history)
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || (e.message || '').includes('aborted'))
    am.streaming = false
    if (aborted) {
      am.status = ''
      if (!am.content && !am.thinking) am.error = '已停止生成'
    } else {
      am.error = String((e && e.message) || e)
    }
  } finally {
    conv.busy = false
    am.streaming = false
    am.status = ''
    if (am.thinking) am.thinkingOpen = am.thinking.length < 500
    if (streamingAssistant.value === am) streamingAssistant.value = null
    conv.updatedAt = Date.now()
    saveStore()
    nextTick(() => scrollBottom())
  }
}
async function streamReply(conv, am, history) {
  const ctrl = new AbortController()
  abortMap.set(conv.id, ctrl)
  let res
  try {
    res = await fetch(bridgeBase() + '/api/llm/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: am.model, search: am.search, messages: history }),
      signal: ctrl.signal,
    })
  } catch (e) {
    abortMap.delete(conv.id)
    throw e
  }
  if (res.status === 404) {
    // 旧版桥服务没有流式接口 -> 回退到非流式
    try {
      await chatNonStream(conv, am, history, ctrl)
    } finally {
      abortMap.delete(conv.id)
    }
    return
  }
  if (!res.ok || !res.body) {
    abortMap.delete(conv.id)
    const txt = await res.text().catch(() => '')
    throw new Error(`桥服务错误 ${res.status}: ${txt.slice(0, 200)}`)
  }
  am.status = '正在思考…'
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let gotDone = false
  const handle = (ev) => {
    if (!ev || !ev.type) return
    if (ev.type === 'thinking') {
      am.thinking += ev.delta || ''
      am.status = '正在思考…'
      scrollPing()
    } else if (ev.type === 'content') {
      am.content += ev.delta || ''
      am.status = '正在回复…'
      scrollPing()
    } else if (ev.type === 'phase') {
      am.content = ''
      am.status = ev.message || '继续处理…'
    } else if (ev.type === 'tool') {
      const brief = ev.brief || ev.name
      if (ev.status === 'running') {
        am.tools.push({ name: ev.name, brief, status: 'running', ok: false })
        am.status = '正在执行：' + brief
      } else {
        let target = null
        for (let i = am.tools.length - 1; i >= 0; i--) {
          if (am.tools[i].name === ev.name && am.tools[i].status === 'running') { target = am.tools[i]; break }
        }
        if (!target) { target = { name: ev.name, brief, status: 'done' }; am.tools.push(target) }
        target.status = 'done'
        target.ok = ev.status !== 'error'
        am.status = ''
      }
      scrollPing()
    } else if (ev.type === 'sources') {
      am.sources = ev.items || []
      scrollPing()
    } else if (ev.type === 'done') {
      gotDone = true
      if (ev.reply) am.content = ev.reply
      if (ev.thinking) am.thinking = ev.thinking
      if (Array.isArray(ev.sources)) am.sources = ev.sources
      if (Array.isArray(ev.executed)) {
        am.tools = ev.executed.map((e) => ({ name: e.name, brief: e.brief || e.name, ok: !!e.ok, status: 'done' }))
      }
      if (ev.model) am.model = ev.model
      am.status = ''
    } else if (ev.type === 'error') {
      throw new Error(ev.error || '大模型返回错误')
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        let ev = null
        try { ev = JSON.parse(data) } catch (e) { continue }
        handle(ev)
      }
    }
  } finally {
    abortMap.delete(conv.id)
  }
  if (!gotDone && !am.content && !am.error) am.error = '连接中断，未收到完整回复'
  if (!am.content && !am.error) am.content = '(已完成)'
}
async function chatNonStream(conv, am, history, ctrl) {
  am.status = '正在生成…'
  const res = await fetch(bridgeBase() + '/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: am.model, search: am.search, messages: history }),
    signal: ctrl ? ctrl.signal : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!json.ok) throw new Error(json.error || ('桥服务错误 ' + res.status))
  am.content = json.reply || '(已完成)'
  am.thinking = json.thinking || ''
  am.sources = json.sources || []
  am.tools = (json.executed || []).map((e) => ({ name: e.name, brief: e.brief || e.name, ok: !!e.ok, status: 'done' }))
  if (json.model) am.model = json.model
  am.status = ''
  am.streaming = false
}
function stopGeneration(conv) {
  const ctrl = abortMap.get(conv.id)
  if (ctrl) ctrl.abort()
  conv.busy = false
  if (streamingAssistant.value) { streamingAssistant.value.streaming = false; streamingAssistant.value.status = '' }
  saveStore()
}
function regenerate(m) {
  const conv = activeConv.value
  if (!conv || conv.busy) return
  const idx = conv.messages.lastIndexOf(m)
  if (idx < 0) return
  // 只重新生成这一条 (通常是最后一条): 丢掉这条及之后的消息, 保留用户提问上下文
  conv.messages.splice(idx)
  conv.updatedAt = Date.now()
  saveStore()
  requestReply(conv)
}
function canRegenerate(m) {
  const conv = activeConv.value
  if (!conv || conv.busy || m.role !== 'assistant') return false
  return conv.messages[conv.messages.length - 1] === m
}

/* ------------------------------------------------------------------ */
/* 引用 / 复制 / 图片                                                  */
/* ------------------------------------------------------------------ */
function appendToInput(text) {
  input.value = (input.value ? input.value.replace(/\s*$/, '') + '\n\n' : '') + text
  nextTick(() => {
    inputEl.value?.focus()
    if (inputEl.value) inputEl.value.selectionStart = inputEl.value.selectionEnd = input.value.length
  })
}
function quoteMessage(m) {
  const text = String(m.content || '').trim()
  if (!text) return
  const snippet = text.length > MAX_EDIT_TEXT ? text.slice(0, MAX_EDIT_TEXT) + '…' : text
  const quoted = snippet.split('\n').map((l) => '> ' + l).join('\n')
  appendToInput(quoted + '\n\n')
  statusText.value = '已引用到输入框'
}
function quoteSource(m, s, idx) {
  appendToInput(`[${idx + 1}] ${s.title || s.url} — ${s.url}\n\n`)
  statusText.value = '已引用来源'
}
async function copyMessage(m) {
  const text = String(m.content || '')
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    statusText.value = '已复制'
  } catch (e) {
    statusText.value = '复制失败 (浏览器限制)'
  }
}
async function addImages(files) {
  const list = Array.from(files || [])
  for (const f of list) {
    if (pendingImages.value.length >= MAX_IMAGES) { statusText.value = `最多 ${MAX_IMAGES} 张图片`; break }
    try {
      const im = await prepareImage(f)
      if (im.error) { statusText.value = im.error; continue }
      pendingImages.value.push(im)
    } catch (e) { statusText.value = '图片读取失败: ' + ((e && e.message) || e) }
  }
}
function onPickImages(e) {
  addImages(e.target.files)
  e.target.value = ''
}
function onPaste(e) {
  const items = e.clipboardData?.items || []
  const files = []
  for (const it of items) {
    if (it.kind === 'file' && /^image\//.test(it.type)) {
      const f = it.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length) { e.preventDefault(); addImages(files) }
}

/* ------------------------------------------------------------------ */
/* 渲染 / 滚动 / 状态                                                  */
/* ------------------------------------------------------------------ */
function renderMarkdown(text) {
  let s = escHtml(text)
  const blocks = []
  const slot = (html) => { blocks.push(html); return `\u0001${blocks.length - 1}\u0001` }
  // 先抽出代码/链接, 避免后续加粗/自动链接把 HTML 属性里的内容再包一层
  s = s.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    slot(`<pre class="code"><code>${code.replace(/\n$/, '')}</code></pre>`))
  s = s.replace(/`([^`\n]+)`/g, (_, code) => slot(`<code>${code}</code>`))
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
    slot(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`))
  s = s.replace(/(https?:\/\/[^\s<>()]+)/g, (url) =>
    slot(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`))
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  const lines = s.split('\n')
  const out = []
  let list = null
  let quote = false
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  const closeQuote = () => { if (quote) { out.push('</blockquote>'); quote = false } }
  for (const line of lines) {
    const liM = line.match(/^\s*([-*])\s+(.*)$/)
    const olM = line.match(/^\s*(\d+)\.\s+(.*)$/)
    if (liM) {
      closeQuote()
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
      out.push('<li>' + liM[2] + '</li>')
    } else if (olM) {
      closeQuote()
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' }
      out.push('<li>' + olM[2] + '</li>')
    } else if (/^#{1,4}\s+/.test(line)) {
      closeList(); closeQuote()
      out.push('<div class="md-h">' + line.replace(/^#{1,4}\s+/, '') + '</div>')
    } else if (/^&gt;\s?/.test(line)) {
      closeList()
      if (!quote) { out.push('<blockquote>'); quote = true }
      out.push('<div>' + line.replace(/^&gt;\s?/, '') + '</div>')
    } else if (!line.trim()) {
      closeList(); closeQuote()
    } else {
      closeList(); closeQuote()
      out.push('<div>' + line + '</div>')
    }
  }
  closeList(); closeQuote()
  return out.join('').replace(/\u0001(\d+)\u0001/g, (_, i) => blocks[Number(i)] || '')
}
let scrollRaf = 0
function scrollPing() {
  if (!autoScroll) return
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; scrollBottom() })
}
function scrollBottom(force = false) {
  if (!force && !autoScroll) return
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
}
function onScroll() {
  const el = listEl.value
  if (!el) return
  autoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

/* ------------------------------------------------------------------ */
/* 桥健康 / 模型 / 自检                                                */
/* ------------------------------------------------------------------ */
async function ping() {
  try {
    const r = await fetch(bridgeBase() + '/health', { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    bridgeOk.value = r.ok && j.ok !== false
  } catch (e) { bridgeOk.value = false }
}
async function fetchModels() {
  try {
    const r = await fetch(bridgeBase() + '/api/llm/models', { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!j.ok || !Array.isArray(j.models) || !j.models.length) return
    modelOptions.value = j.models.map((m) => ({
      id: m.id,
      label: `${m.name || m.id}${m.vision ? ' · 视觉+思考 🖼' : ''}`,
    }))
    if (!modelOptions.value.some((m) => m.id === model.value)) {
      const vision = j.models.find((m) => m.vision)
      model.value = (vision || j.models[0]).id
      if (activeConv.value) activeConv.value.model = model.value
    }
  } catch (e) { /* 使用内置模型列表 */ }
}
async function selfcheck() {
  statusText.value = '检查中…'
  try {
    const r = await fetch(bridgeBase() + '/api/selfcheck', { cache: 'no-store' })
    const j = await r.json()
    const failed = (j.checks || []).filter((c) => !c.ok)
    statusText.value = failed.length ? `失败 ${failed.length}: ${failed.map((f) => f.name).join(', ')}` : `全部通过 (${j.checks.length} 项)`
  } catch (e) { statusText.value = '桥服务未运行' }
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */
onMounted(() => {
  loadStore()
  ping(); fetchModels()
  pingTimer = setInterval(ping, 5000)
  if (import.meta.env && import.meta.env.DEV) {
    window.__fastTreeChat = {
      get conversations() { return conversations.value },
      get activeId() { return activeId.value },
      get activeConversation() { return activeConv.value },
      get messages() { return messages.value },
      get pendingImages() { return pendingImages.value },
      get bridgeOk() { return bridgeOk.value },
      get stream() { return streamingAssistant.value },
      get historyList() { return historyList.value },
      send, newConversation, switchConversation, deleteConversation,
      togglePin, toggleFavorite, toggleArchive, regenerate, quoteMessage, quoteSource,
      addImages, prepareImage, stopGeneration, saveStore, loadStore,
      setModel: (id) => { model.value = id; onModelChange() },
      setSearch: (v) => { searchOn.value = !!v; if (activeConv.value) activeConv.value.search = !!v; saveStore() },
      setOpen: (v) => { open.value = !!v },
      setHistory: (v) => { historyOpen.value = !!v },
      setHistoryQuery: (q) => { histQuery.value = q },
      setHistoryMode: (m) => { histMode.value = m },
      setInput: (s) => { input.value = s },
      reloadFromStorage: () => loadStore(),
      reloadModels: () => fetchModels(),
      /** 测试用: 清空所有会话, 回到一个全新对话 */
      reset: () => {
        for (const c of conversations.value) if (c.busy) stopGeneration(c)
        abortMap.clear()
        const nc = hydrateConversation({ id: uid(), title: '新对话', messages: [], model: model.value, search: false })
        conversations.value = [nc]
        activeId.value = nc.id
        historyOpen.value = false
        histQuery.value = ''
        histMode.value = 'all'
        input.value = ''
        pendingImages.value = []
        searchOn.value = false
        saveStore()
        return nc
      },
    }
  }
})
onBeforeUnmount(() => {
  if (pingTimer) clearInterval(pingTimer)
  if (saveTimer) clearTimeout(saveTimer)
  for (const ctrl of abortMap.values()) { try { ctrl.abort() } catch (e) { /* ignore */ } }
  abortMap.clear()
})
</script>

<style scoped>
.chat-fab { position: fixed; right: 18px; bottom: 18px; z-index: 60; }
.chat-toggle { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line-2);
  background: #16202b; color: #e8f5ef; font-size: 18px; cursor: pointer; }
.chat-toggle.open { background: var(--accent); color: #06120e; }
.chat-panel { position: absolute; right: 0; bottom: 54px; width: min(460px, calc(100vw - 36px));
  height: min(680px, calc(100vh - 96px)); display: flex; flex-direction: column; background: #11161d;
  border: 1px solid var(--line-2); border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.6); overflow: hidden; }

.chat-head { display: flex; align-items: center; gap: 6px; padding: 7px 9px; border-bottom: 1px solid var(--line); }
.chat-name { font-size: 12px; white-space: nowrap; }
.chat-model { background: #0c1016; color: var(--fg); border: 1px solid var(--line-2); border-radius: 5px; font-size: 10.5px; padding: 2px 4px; max-width: 150px; }
.chat-status { font-size: 10px; color: #e06c6c; margin-left: auto; }
.chat-status.ok { color: var(--accent); }
.icon-btn { background: transparent; border: 1px solid transparent; color: var(--fg-dim); border-radius: 6px;
  font-size: 13px; padding: 2px 5px; cursor: pointer; line-height: 1.2; }
.icon-btn:hover { color: var(--fg); border-color: var(--line-2); }
.icon-btn.active { color: var(--accent); border-color: var(--accent); }
.icon-btn.on { color: var(--accent-2); border-color: var(--accent-2); }
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.mini { background: transparent; border: 1px solid transparent; color: var(--fg-dim); cursor: pointer;
  font-size: 10.5px; padding: 1px 4px; border-radius: 5px; white-space: nowrap; }
.mini:hover { color: var(--fg); border-color: var(--line-2); }
.mini.on { color: var(--warn); }
.mini.confirm { color: var(--danger); border-color: var(--danger); }
.mini.danger:hover { color: var(--danger); border-color: var(--danger); }

/* 历史记录 */
.hist { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.hist-top { padding: 8px 9px 4px; }
.hist-search { width: 100%; box-sizing: border-box; background: #0c1016; color: var(--fg); border: 1px solid var(--line-2);
  border-radius: 6px; font-size: 11.5px; padding: 5px 8px; }
.hist-tabs { display: flex; gap: 4px; padding: 4px 9px 6px; }
.hist-tab { flex: 1; background: #0c1016; border: 1px solid var(--line); color: var(--fg-dim); border-radius: 6px;
  font-size: 10.5px; padding: 3px 0; cursor: pointer; }
.hist-tab.active { border-color: var(--accent); color: #d8fff1; background: #16302a; }
.hist-tab .n { opacity: 0.7; margin-left: 3px; }
.hist-list { flex: 1; overflow: auto; padding: 2px 6px 6px; }
.hist-empty { color: var(--fg-dim); font-size: 11px; text-align: center; padding: 24px 0; }
.hist-item { display: flex; align-items: center; gap: 6px; padding: 6px 7px; border-radius: 7px; cursor: pointer;
  border: 1px solid transparent; }
.hist-item:hover { background: #17202b; }
.hist-item.active { background: #16302a; border-color: #275c4b; }
.hist-main { flex: 1; min-width: 0; }
.hist-title { font-size: 11.5px; color: var(--fg); display: flex; align-items: center; gap: 3px; }
.hist-title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-meta { font-size: 10px; color: var(--fg-dim); margin-top: 2px; }
.tag-now { color: var(--accent); margin-left: 5px; }
.hist-actions { display: flex; gap: 1px; opacity: 0.35; }
.hist-item:hover .hist-actions, .hist-item.active .hist-actions { opacity: 1; }
.hist-foot { border-top: 1px solid var(--line); padding: 5px 9px; font-size: 10px; color: var(--fg-dim); }

/* 消息 */
.chat-list { flex: 1; overflow: auto; padding: 10px 10px 4px; display: flex; flex-direction: column; gap: 10px; }
.chat-tip { font-size: 11px; color: var(--fg-dim); line-height: 1.7; }
.tip-title { color: var(--fg); font-weight: 600; margin-bottom: 3px; }
.tip-row { opacity: 0.9; }
.tip-feats { margin-top: 8px; font-size: 10.5px; line-height: 1.7; color: var(--accent); }
.chat-msg { display: flex; flex-direction: column; gap: 5px; }
.chat-msg.user { align-items: flex-end; }
.msg-head { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--fg-dim); width: 100%; }
.chat-msg.user .msg-head { flex-direction: row-reverse; }
.who { font-size: 10.5px; color: var(--fg-dim); }
.msg-meta { opacity: 0.8; }
.msg-actions { margin-left: auto; display: flex; gap: 0; opacity: 0; }
.chat-msg:hover .msg-actions { opacity: 1; }
.chat-msg.user .msg-actions { margin-left: 0; margin-right: auto; }
.bubble { font-size: 12px; line-height: 1.55; padding: 7px 10px; border-radius: 9px; background: #1a2430;
  white-space: pre-wrap; word-break: break-word; max-width: 94%; align-self: flex-start; }
.chat-msg.user .bubble { background: #223b31; }
.bubble.typing { color: var(--fg-dim); }
.dots { animation: blink 1.2s infinite; }
@keyframes blink { 0%, 100% { opacity: 0.25 } 50% { opacity: 1 } }
.stream-status { font-size: 10.5px; color: var(--fg-dim); }
.err { font-size: 11px; color: var(--danger); background: #2a1518; border: 1px solid #4a2428;
  padding: 5px 8px; border-radius: 7px; max-width: 94%; }
.msg-images { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
.msg-images img { width: 84px; height: 84px; object-fit: cover; border-radius: 6px; border: 1px solid var(--line-2); cursor: zoom-in; }
.thinking { width: 100%; border: 1px solid #263041; background: #131a23; border-radius: 8px; overflow: hidden; }
.think-head { display: flex; width: 100%; justify-content: space-between; background: transparent; border: 0;
  color: var(--accent-2); font-size: 10.5px; padding: 4px 8px; cursor: pointer; }
.think-count { color: var(--fg-dim); }
.think-body { padding: 0 9px 7px; font-size: 10.5px; line-height: 1.6; color: #9fb0c4; white-space: pre-wrap;
  max-height: 220px; overflow: auto; }
.caret { animation: blink 1s infinite; color: var(--accent); }
.tool-row { display: flex; flex-wrap: wrap; gap: 4px; }
.tool-chip { font-size: 10px; padding: 1px 6px; border-radius: 10px; background: #16202b; border: 1px solid var(--line-2); color: var(--fg-dim); }
.tool-chip.running { border-color: var(--accent-2); color: var(--accent-2); }
.tool-chip.done { border-color: #2a5446; color: #9ad9c0; }
.sources { border: 1px dashed var(--line-2); border-radius: 8px; padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; }
.sources-head { font-size: 10.5px; color: var(--accent); }
.source-item { display: flex; align-items: center; gap: 5px; font-size: 10.5px; min-width: 0; }
.src-idx { color: var(--fg-dim); }
.source-item a { color: var(--accent-2); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-item a:hover { text-decoration: underline; }
.source-item .mini { flex: none; }
.markdown :deep(ul), .markdown :deep(ol) { margin: 3px 0 3px 16px; padding: 0; }
.markdown :deep(div), .markdown :deep(li) { white-space: pre-wrap; }
.markdown :deep(code) { background: #0c1016; border: 1px solid var(--line); border-radius: 4px; padding: 0 3px; font-size: 11px; }
.markdown :deep(pre.code) { background: #0c1016; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px;
  overflow: auto; white-space: pre; margin: 5px 0; }
.markdown :deep(pre.code code) { background: none; border: 0; padding: 0; }
.markdown :deep(a) { color: var(--accent-2); }
.markdown :deep(blockquote) { border-left: 2px solid var(--line-2); margin: 3px 0; padding: 1px 8px; color: var(--fg-dim); }
.markdown :deep(.md-h) { font-weight: 600; color: var(--fg); margin: 4px 0 2px; }

/* 输入区 */
.chat-input-wrap { border-top: 1px solid var(--line); }
.pending-images { display: flex; align-items: center; gap: 5px; padding: 6px 8px 0; flex-wrap: wrap; }
.pending-img { position: relative; width: 46px; height: 46px; }
.pending-img img { width: 100%; height: 100%; object-fit: cover; border-radius: 5px; border: 1px solid var(--line-2); }
.pending-img .rm { position: absolute; top: -5px; right: -5px; width: 15px; height: 15px; border-radius: 50%;
  border: 1px solid var(--line-2); background: #0b0e13; color: var(--fg-dim); font-size: 9px; line-height: 1; cursor: pointer; }
.pending-hint { font-size: 10px; color: var(--fg-dim); }
.chat-input { padding: 7px 8px 5px; display: flex; gap: 6px; align-items: flex-end; }
.chat-input textarea { flex: 1; resize: none; background: #0c1016; color: var(--fg); border: 1px solid var(--line-2);
  border-radius: 7px; font-size: 11.5px; padding: 6px 8px; font-family: inherit; max-height: 96px; }
.input-side { display: flex; flex-direction: column; gap: 3px; align-items: stretch; }
.chat-foot { display: flex; align-items: center; gap: 8px; padding: 3px 8px 6px; }
.foot-hint { font-size: 10px; color: var(--fg-dim); }
.chat-check { font-size: 10px; color: var(--fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-foot .mini { margin-left: auto; }
.img-preview { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.85); display: flex;
  align-items: center; justify-content: center; cursor: zoom-out; }
.img-preview img { max-width: 92vw; max-height: 92vh; border-radius: 8px; }
</style>
