<template>
  <Section title="场景" hint="Scene">
    <ToggleRow label="渐变天空" v-model="s.gradient" />
    <ColorRow label="背景色" v-model="s.background" />
    <template v-if="s.gradient">
      <ColorRow label="天空顶部" v-model="s.skyTop" />
      <ColorRow label="天空底部" v-model="s.skyBottom" />
    </template>
    <SliderRow label="曝光" v-model="s.exposure" :min="0.2" :max="2.5" :step="0.01" />
    <SliderRow label="太阳强度" v-model="s.sunIntensity" :min="0" :max="6" :step="0.05" />
    <SliderRow label="环境光强度" v-model="s.ambient" :min="0" :max="2" :step="0.02" />
    <SliderRow label="太阳方位角" v-model="s.sunAzimuth" :min="0" :max="360" :step="1" unit="°" />
    <SliderRow label="太阳高度角" v-model="s.sunElevation" :min="-5" :max="88" :step="1" unit="°" />
    <ToggleRow label="阴影" v-model="s.shadows" />
    <ToggleRow label="地面" v-model="s.ground" />
    <ToggleRow label="网格" v-model="s.grid" />
    <SelectRow label="线框展示 (三角面)" v-model="s.wireframe" :options="wireOptions" />
    <ToggleRow label="雾" v-model="s.fog" />
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
import { state, sceneApi } from '../../store/treeStore.js'
import { computed } from 'vue'

const s = state.params.scene
const wireOptions = [
  { value: 'off', label: '关闭' },
  { value: 'overlay', label: '实体 + 线框' },
  { value: 'only', label: '仅线框 (看三角面)' },
]
const playing = computed(() => state.playing)

function frame() {
  state.frameVersion++
}

function togglePlay() {
  state.playing = !state.playing
}
</script>
