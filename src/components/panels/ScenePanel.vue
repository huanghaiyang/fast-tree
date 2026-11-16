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
    <SelectRow
      label="渲染引擎"
      hint="选择渲染路径: auto 优先 WebGPU, 不可用时自动回退 (WebGL 2 Node / 经典 WebGL)。切换后立即重建场景, 保留当前视角, 不需要刷新页面。"
      :model-value="s.renderer"
      :options="renderOptions"
      @update:model-value="onEngineChange"
    />
    <p class="muted" style="margin: 0 0 6px">
      当前: {{ state.renderBackend || '初始化中…' }}<span v-if="state.engineSwitching"> · 切换中…</span>。
      切换立即生效（销毁旧 renderer 后按同一套参数重建场景，视角保持不变）；auto 会优先 WebGPU，
      不可用时自动回退到 WebGL 2 (Node) 或经典 WebGL。
    </p>
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
    <ToggleRow label="仅显示骨架" v-model="s.skeletonOnly" />
    <p v-if="s.skeletonOnly" class="muted" style="margin: 0 0 6px">已隐藏树皮、叶片与花果，只显示骨架线段与节点。</p>
    <ToggleRow label="骨架按枝级着色" v-model="s.skeletonLevelColors" />
    <p v-if="s.skeletonLevelColors" class="muted" style="margin: 0 0 6px">骨架开启时，L1~L5 各级枝依次用红 / 橙 / 黄 / 绿 / 蓝区分层级。</p>
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

  <Section title="后处理" hint="Post FX" :default-collapsed="true">
    <p v-if="isNodeRenderer" class="muted" style="margin: 0 0 6px">
      当前 Node 后端由 TSL 管线（RenderPipeline）实现 Bloom / DOF，参数口径与 WebGL 对齐（DOF 按几何关系换算，同一光圈/最大虚化下观感接近）；首次开启会编译着色器，可能有一帧卡顿。
    </p>
    <ToggleRow label="泛光 (Bloom)" v-model="s.bloomEnabled"
      hint="让亮部渗出光晕, 逆光叶片/天空更通透" />
    <template v-if="s.bloomEnabled">
      <SliderRow label="泛光强度" v-model="s.bloomStrength" :min="0" :max="2" :step="0.01" />
      <SliderRow label="泛光半径" v-model="s.bloomRadius" :min="0" :max="1" :step="0.01" />
      <SliderRow label="泛光阈值" v-model="s.bloomThreshold" :min="0" :max="1" :step="0.01" />
    </template>
    <ToggleRow label="景深 (DOF)" v-model="s.dofEnabled"
      hint="焦外虚化, 让前景枝条与远景树冠有层次" />
    <template v-if="s.dofEnabled">
      <SliderRow label="对焦距离" v-model="s.dofFocus" :min="1" :max="60" :step="0.5" unit="m" />
      <SliderRow label="光圈 (aperture)" v-model="s.dofAperture" :min="0" :max="0.0002" :step="0.000005" />
      <SliderRow label="最大虚化" v-model="s.dofMaxBlur" :min="0" :max="0.03" :step="0.001" />
    </template>
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
import { ENVIRONMENTS, applyEnvironment } from '../../core/environments.js'

const s = state.params.scene
const envs = ENVIRONMENTS
const wireOptions = [
  { value: 'off', label: '关闭' },
  { value: 'overlay', label: '实体 + 线框' },
  { value: 'only', label: '仅线框 (看三角面)' },
]
const renderOptions = [
  { value: 'auto', label: '自动 (优先 WebGPU)' },
  { value: 'webgpu', label: 'WebGPU' },
  { value: 'webgl', label: 'WebGL' },
]
// 非经典 WebGL 后端 (WebGPU / WebGL2-Node) 不支持 EffectComposer 与自定义 GLSL
const isNodeRenderer = computed(() => !!state.renderBackend && state.renderBackend !== 'WebGL')
const playing = computed(() => state.playing)

function useEnv(id) {
  applyEnvironment(s, id)
}

/**
 * 切换渲染引擎: 先写参数 (下次启动/导入工程时沿用), 再让视口热切换。
 * 真正的重建在 Viewport 的 switchBackend 里 (保存相机位姿 -> dispose -> 新后端重建 -> 还原视角);
 * 这里不 await, 免得把面板操作卡住 —— 进度由 state.engineSwitching 反映。
 */
function onEngineChange(v) {
  if (v !== 'auto' && v !== 'webgpu' && v !== 'webgl') return
  s.renderer = v
  sceneApi.switchBackend?.(v)
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
