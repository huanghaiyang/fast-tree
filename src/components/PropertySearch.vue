<template>
  <div class="prop-search">
    <input
      ref="inputEl"
      v-model="query"
      class="prop-search-input"
      type="text"
      placeholder="🔍 搜索属性 (如：反光 / 落叶 / 果实大小)"
      @focus="open = true"
      @keydown.esc="reset"
      @keydown.enter="pickFirst"
    />
    <button v-if="query" class="prop-search-clear" @click="reset">✕</button>
    <div v-if="open && query.trim()" class="prop-search-results">
      <div v-if="!results.length" class="prop-search-empty">没有匹配的属性</div>
      <div
        v-for="(r, i) in results"
        :key="r.label + r.tab"
        class="prop-search-item"
        :class="{ active: i === activeIndex }"
        @mousedown.prevent="pick(r)"
        @mouseenter="activeIndex = i"
      >
        <span class="ps-label">{{ r.label }}</span>
        <span class="ps-tab">{{ r.tabName }}</span>
        <div v-if="r.doc" class="ps-doc">{{ r.doc }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { state, setActiveTab } from '../store/treeStore.js'
import { searchLabels } from '../core/propertySearch.js'

const query = ref('')
const open = ref(false)
const activeIndex = ref(0)
const inputEl = ref(null)

const results = computed(() => searchLabels(query.value, 24))

function pick(r) {
  if (!r) return
  setActiveTab(r.tab)
  // 等面板渲染出来后再滚动 + 高亮
  const tryScroll = (attempt = 0) => {
    const rows = [...document.querySelectorAll('.section-body label, .section-body .row-head label')]
    const hit = rows.find((el) => el.textContent.trim() === r.label)
    if (hit) {
      const box = hit.closest('.section-body') || hit
      box.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const row = hit.closest('.row') || hit.parentElement
      row.classList.add('prop-flash')
      setTimeout(() => row.classList.remove('prop-flash'), 1600)
      open.value = false
    } else if (attempt < 6) {
      requestAnimationFrame(() => tryScroll(attempt + 1))
    }
  }
  requestAnimationFrame(() => tryScroll())
}

function pickFirst() {
  if (results.value.length) pick(results.value[0])
}

function reset() {
  query.value = ''
  open.value = false
  inputEl.value?.blur()
}

/* 全局快捷键: Ctrl/Cmd+F 聚焦搜索 */
function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    open.value = true
    inputEl.value?.focus()
    inputEl.value?.select()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.prop-search { position: relative; padding: 8px 8px 0; }
.prop-search-input {
  width: 100%; box-sizing: border-box; padding: 6px 26px 6px 9px;
  background: #0c1016; color: var(--fg); border: 1px solid var(--line-2);
  border-radius: 7px; font-size: 11.5px; outline: none;
}
.prop-search-input:focus { border-color: var(--accent); }
.prop-search-clear {
  position: absolute; right: 14px; top: 50%; transform: translateY(-40%);
  background: none; border: 0; color: var(--fg-dim); cursor: pointer; font-size: 11px;
}
.prop-search-results {
  position: absolute; left: 8px; right: 8px; top: calc(100% + 4px); z-index: 40;
  max-height: 320px; overflow: auto; background: #12161d;
  border: 1px solid var(--line-2); border-radius: 8px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
}
.prop-search-item { padding: 6px 9px; cursor: pointer; border-bottom: 1px solid var(--line); }
.prop-search-item:last-child { border-bottom: 0; }
.prop-search-item.active, .prop-search-item:hover { background: #1a2430; }
.ps-label { font-size: 11.5px; color: var(--fg); }
.ps-tab { float: right; font-size: 10.5px; color: var(--accent); }
.ps-doc { font-size: 10.5px; color: var(--fg-dim); margin-top: 2px; line-height: 1.35; }
.prop-search-empty { padding: 10px; font-size: 11px; color: var(--fg-dim); }
</style>
