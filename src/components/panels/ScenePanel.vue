<template>
  <Section title="环境预设" hint="Environment">
    <div class="env-grid">
      <button
        v-for="e in envs" :key="e.id"
        class="btn small env-chip" :class="{ active: s.env === e.id }"
        :title="e.desc" @click="useEnv(e.id)"
      >{{ e.icon }} {{ e.name }}</button>
    </div>
    <p class="muted" style="margin: 0">一键切换天空/光照/雾/地面/星空，之后仍可手动微调。</p>
  </Section>

  <Section title="场景" hint="Scene">
    <ToggleRow label="渐变天空" v-model="s.gradient" />
    <ColorRow label="背景色" v-model="s.background" />
    <template v-if="s.gradient">
      <ColorRow label="天空顶部" v-model="s.skyTop" />
      <ColorRow label="天空底部" v-model="s.skyBottom" />
    </template>
    <SliderRow label="曝光" v-model="s.exposure" :min="0.2" :max="2.5" :step="0.01" />
    <ColorRow label="太阳颜色" v-model="s.sunColor" />
    <SliderRow label="太阳强度" v-model="s.sunIntensity" :min="0" :max="6" :step="0.05" />
    <ColorRow label="天空环境光" v-model="s.hemiSky" />
    <ColorRow label="地面环境光" v-model="s.hemiGround" />
    <SliderRow label="环境光强度" v-model="s.ambient" :min="0" :max="2" :step="0.02" />
    <SliderRow label="太阳方位角" v-model="s.sunAzimuth" :min="0" :max="360" :step="1" unit="°" />
    <SliderRow label="太阳高度角" v-model="s.sunElevation" :min="-5" :max="88" :step="1" unit="°" />
    <ToggleRow label="阴影" v-model="s.shadows" />
    <ToggleRow v-if="s.shadows" label="动态阴影" v-model="s.dynamicShadows" />
    <ToggleRow label="地面" v-model="s.ground" />
    <ToggleRow label="网格" v-model="s.grid" />
    <SelectRow label="线框展示 (三角面)" v-model="s.wireframe" :options="wireOptions" />
    <ToggleRow label="雾" v-model="s.fog" />
    <template v-if="s.fog">
      <ColorRow label="雾颜色" v-model="s.fogColor" />
      <SliderRow label="雾距离倍率" v-model="s.fogScale" :min="0.2" :max="1.6" :step="0.05" />
    </template>
    <SliderRow label="星空强度" v-model="s.stars" :min="0" :max="1" :step="0.01" />
    <ToggleRow label="相机自动旋转" v-model="s.autoRotate" />
    <div class="inline">
      <button class="btn small" @click="frame">重新取景</button>
      <button class="btn small" @click="togglePlay">{{ playing ? '⏸ 暂停风' : '▶ 播放风' }}</button>
    </div>
  </Section>
</template>

<script setup>
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import ColorRow from '../ui/ColorRow.vue'
import { state } from '../../store/treeStore.js'
import { computed } from 'vue'
import { ENVIRONMENTS, applyEnvironment } from '../../core/environments.js'

const s = state.params.scene
const envs = ENVIRONMENTS
const wireOptions = [
  { value: 'off', label: '关闭' },
  { value: 'overlay', label: '实体 + 线框' },
  { value: 'only', label: '仅线框 (看三角面)' },
]
const playing = computed(() => state.playing)

function useEnv(id) {
  applyEnvironment(s, id)
}

function frame() {
  state.frameVersion++
}

function togglePlay() {
  state.playing = !state.playing
}
</script>

<style scoped>
.env-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.env-chip {
  padding: 5px 4px;
  font-size: 12px;
  white-space: nowrap;
}
.env-chip.active {
  border-color: var(--accent, #ffd166);
  color: var(--accent, #ffd166);
  background: rgba(255, 209, 102, 0.12);
}
</style>
