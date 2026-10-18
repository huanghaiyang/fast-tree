<template>
  <div class="chat-fab">
    <button class="chat-toggle" :class="{ open: open }" @click="open = !open" title="大模型助手">
      {{ open ? '✕' : '🤖' }}
    </button>
    <div v-if="open" class="chat-panel">
      <div class="chat-head">
        <b>🤖 大模型助手</b>
        <select v-model="model" class="chat-model">
          <option value="deepseek-chat">DeepSeek Chat</option>
          <option value="deepseek-reasoner">DeepSeek Reasoner</option>
        </select>
        <span class="chat-status" :class="{ ok: bridgeOk }">{{ bridgeOk ? '已连接' : '未连接' }}</span>
      </div>
      <div ref="listEl" class="chat-list">
        <div v-if="!messages.length" class="chat-tip">
          用自然语言操作应用，例如：<br />
          · 把叶子调大一点，加一些花<br />
          · 换成樱花树，春天，开满花<br />
          · 打开线框模式看看拓扑
        </div>
        <div v-for="(m, i) in messages" :key="i" class="chat-msg" :class="m.role">
          <div class="bubble">{{ m.content }}</div>
          <div v-if="m.tools && m.tools.length" class="chat-tools">工具: {{ m.tools.join(', ') }}</div>
        </div>
        <div v-if="busy" class="chat-msg assistant"><div class="bubble">思考中…</div></div>
      </div>
      <div class="chat-input">
        <textarea v-model="input" rows="2" placeholder="描述你想要的树… (Enter 发送, Shift+Enter 换行)"
          @keydown.enter.exact.prevent="send"></textarea>
        <button class="btn small primary" :disabled="busy || !input.trim()" @click="send">发送</button>
      </div>
      <div class="chat-foot">
        <button class="btn small" @click="selfcheck">MCP 自检</button>
        <span v-if="checkText" class="chat-check">{{ checkText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue'

const BRIDGE = 'http://127.0.0.1:5275'
const open = ref(false)
const busy = ref(false)
const input = ref('')
const model = ref('deepseek-chat')
const messages = ref([])
const listEl = ref(null)
const bridgeOk = ref(false)
const checkText = ref('')

async function ping() {
  try {
    const r = await fetch(BRIDGE + '/health', { cache: 'no-store' })
    bridgeOk.value = r.ok
  } catch (e) { bridgeOk.value = false }
}
onMounted(() => { ping(); setInterval(ping, 5000) })

async function send() {
  const text = input.value.trim()
  if (!text || busy.value) return
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  busy.value = true
  try {
    const res = await fetch(BRIDGE + '/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.value,
        messages: messages.value.map((m) => ({ role: m.role, content: m.content })),
      }),
    })
    const json = await res.json()
    if (!json.ok) {
      messages.value.push({ role: 'assistant', content: '⚠️ ' + (json.error || '请求失败') })
    } else {
      messages.value.push({ role: 'assistant', content: json.reply || '(已完成)', tools: (json.executed || []).map((e) => e.name + (e.ok ? '✓' : '✗')) })
    }
  } catch (e) {
    messages.value.push({ role: 'assistant', content: '⚠️ 无法连接本地桥服务 (先运行 npm run dev 或 npm run mcp)' })
  } finally {
    busy.value = false
    await nextTick()
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  }
}

async function selfcheck() {
  checkText.value = '检查中…'
  try {
    const r = await fetch(BRIDGE + '/api/selfcheck', { cache: 'no-store' })
    const j = await r.json()
    const failed = (j.checks || []).filter((c) => !c.ok)
    checkText.value = failed.length ? `失败 ${failed.length}: ${failed.map((f) => f.name).join(', ')}` : `全部通过 (${j.checks.length} 项)`
  } catch (e) {
    checkText.value = '桥服务未运行'
  }
}
</script>

<style scoped>
.chat-fab { position: fixed; right: 18px; bottom: 18px; z-index: 60; }
.chat-toggle { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line-2);
  background: #16202b; color: #e8f5ef; font-size: 18px; cursor: pointer; }
.chat-toggle.open { background: var(--accent); color: #06120e; }
.chat-panel { position: absolute; right: 0; bottom: 54px; width: 360px; max-height: 540px;
  display: flex; flex-direction: column; background: #11161d; border: 1px solid var(--line-2);
  border-radius: 10px; box-shadow: 0 16px 40px rgba(0,0,0,0.6); overflow: hidden; }
.chat-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.chat-model { background: #0c1016; color: var(--fg); border: 1px solid var(--line-2); border-radius: 5px; font-size: 11px; padding: 2px 4px; }
.chat-status { margin-left: auto; font-size: 10.5px; color: #e06c6c; }
.chat-status.ok { color: var(--accent); }
.chat-list { flex: 1; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.chat-tip { font-size: 11px; color: var(--text-2); line-height: 1.6; }
.chat-msg .bubble { font-size: 12px; line-height: 1.5; padding: 6px 8px; border-radius: 8px; background: #1a2430; white-space: pre-wrap; }
.chat-msg.user .bubble { background: #223b31; }
.chat-tools { font-size: 10px; color: var(--text-2); margin-top: 3px; }
.chat-input { border-top: 1px solid var(--line); padding: 8px; display: flex; gap: 6px; }
.chat-input textarea { flex: 1; resize: none; background: #0c1016; color: var(--fg); border: 1px solid var(--line-2);
  border-radius: 6px; font-size: 11.5px; padding: 5px 7px; }
.chat-foot { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-top: 1px solid var(--line); }
.chat-check { font-size: 10.5px; color: var(--text-2); }
</style>
