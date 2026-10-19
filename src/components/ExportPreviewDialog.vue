<template>
  <Teleport to="body">
    <div v-if="open" class="epd-mask" @click.self="$emit('cancel')">
      <div class="epd-panel" role="dialog" aria-modal="true">
        <header class="epd-head">
          <div>
            <b>{{ title || '导出预览' }}</b>
            <span class="epd-file">{{ filename }}</span>
          </div>
          <button class="epd-x" title="取消" @click="$emit('cancel')">✕</button>
        </header>

        <div class="epd-body">
          <section class="epd-section">
            <div class="epd-section-head">
              <b>导出产物</b>
              <span class="epd-muted">{{ artifacts.length }} 项</span>
            </div>
            <div class="epd-artifacts">
              <button v-for="(a, i) in artifacts" :key="a.name + '-' + i" class="epd-art" :class="{ img: !!a.imageUrl }"
                @click="a.imageUrl && (zoom = a.imageUrl)">
                <img v-if="a.imageUrl" :src="a.imageUrl" :alt="a.name" />
                <span v-else class="epd-fileicon">{{ a.kind === 'file' ? '📦' : '📄' }}</span>
                <span class="epd-art-meta">
                  <b>{{ a.name }}</b>
                  <small>{{ a.detail }}<template v-if="a.size"> · {{ fmt(a.size) }}</template></small>
                </span>
                <span v-if="a.imageUrl" class="epd-zoom">🔍</span>
              </button>
            </div>
          </section>

          <section v-if="nodes.length" class="epd-section">
            <div class="epd-section-head">
              <b>节点列表</b>
              <span class="epd-muted">{{ nodes.length }} 个 mesh</span>
            </div>
            <div class="epd-nodes">
              <table>
                <thead><tr><th>节点</th><th>三角面</th><th>顶点</th></tr></thead>
                <tbody>
                  <tr v-for="(n, i) in nodes" :key="n.name + '-' + i">
                    <td class="epd-node-name">{{ n.name }}</td>
                    <td>{{ n.triangles.toLocaleString() }}</td>
                    <td>{{ n.vertices.toLocaleString() }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer class="epd-foot">
          <span class="epd-muted">确认后才会开始下载；取消不会保存任何文件。</span>
          <div class="epd-actions">
            <button class="btn" @click="$emit('cancel')">取消</button>
            <button class="btn primary" data-testid="export-confirm" @click="$emit('confirm')">确定导出</button>
          </div>
        </footer>

        <div v-if="zoom" class="epd-zoom-mask" @click.self="zoom = ''">
          <img :src="zoom" alt="preview" />
          <button class="epd-x" @click="zoom = ''">✕</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  filename: { type: String, default: '' },
  artifacts: { type: Array, default: () => [] },
  nodes: { type: Array, default: () => [] },
})
defineEmits(['confirm', 'cancel'])
const zoom = ref('')
watch(() => props.open, (v) => { if (!v) zoom.value = '' })

function fmt(n) {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / 1024 / 1024).toFixed(2) + ' MB'
}
</script>

<style scoped>
.epd-mask {
  position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.62); backdrop-filter: blur(2px);
}
.epd-panel {
  position: relative;
  width: min(920px, calc(100vw - 48px)); max-height: calc(100vh - 56px); display: flex; flex-direction: column;
  background: var(--bg-2, #161b22); color: var(--fg, #d7dde5); border: 1px solid var(--line-2, #34404d);
  border-radius: 10px; box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55); overflow: hidden;
}
.epd-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line, #2a3541); }
.epd-head b { font-size: 14px; }
.epd-file { margin-left: 10px; color: var(--text-2, #8b98a7); font-size: 11.5px; }
.epd-x { border: 0; background: transparent; color: var(--text-2, #8b98a7); font-size: 18px; cursor: pointer; line-height: 1; }
.epd-body { overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 14px; }
.epd-section { display: flex; flex-direction: column; gap: 8px; }
.epd-section-head { display: flex; align-items: baseline; gap: 8px; }
.epd-section-head b { font-size: 12px; }
.epd-muted { color: var(--text-2, #8b98a7); font-size: 11px; }
.epd-artifacts { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.epd-art {
  position: relative; display: flex; align-items: center; gap: 8px; text-align: left; cursor: default;
  padding: 7px 8px; border: 1px solid var(--line, #2a3541); border-radius: 6px; background: var(--bg-3, #1d242d);
  color: inherit;
}
.epd-art.img { cursor: zoom-in; }
.epd-art.img:hover { border-color: var(--accent, #4fd1b0); }
.epd-art img { width: 44px; height: 44px; object-fit: cover; border-radius: 4px; flex: none; background: #0b0e13; }
.epd-fileicon { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; font-size: 22px; background: #0b0e13; border-radius: 4px; flex: none; }
.epd-art-meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.epd-art-meta b { font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.epd-art-meta small { color: var(--text-2, #8b98a7); font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.epd-zoom { position: absolute; right: 8px; top: 6px; opacity: 0.45; font-size: 12px; }
.epd-nodes { max-height: 260px; overflow: auto; border: 1px solid var(--line, #2a3541); border-radius: 6px; }
.epd-nodes table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.epd-nodes th, .epd-nodes td { text-align: left; padding: 5px 9px; border-bottom: 1px solid var(--line, #2a3541); }
.epd-nodes th { position: sticky; top: 0; background: var(--bg-2, #161b22); color: var(--text-2, #8b98a7); font-weight: 500; }
.epd-nodes td:nth-child(2), .epd-nodes th:nth-child(2), .epd-nodes td:nth-child(3), .epd-nodes th:nth-child(3) { text-align: right; }
.epd-node-name { font-weight: 600; }
.epd-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--line, #2a3541); }
.epd-actions { display: flex; gap: 8px; }
.epd-zoom-mask {
  position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.8); cursor: zoom-out;
}
.epd-zoom-mask img { max-width: 92%; max-height: 92%; border-radius: 6px; box-shadow: 0 10px 40px #000; cursor: default; }
.epd-zoom-mask .epd-x { position: absolute; right: 14px; top: 10px; font-size: 24px; color: #fff; }
</style>
