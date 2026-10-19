<template>
  <Section title="生长动画" hint="Growth">
    <ToggleRow label="启用生长动画" v-model="g.enabled" />
    <SliderRow label="生长进度" v-model="g.value" :min="0" :max="1" :step="0.001" />
    <ToggleRow label="播放时自动生长" v-model="g.auto" />
    <SliderRow label="生长速度" v-model="g.speed" :min="0.05" :max="2" :step="0.01" />
    <div class="inline">
      <button class="btn small" @click="playGrowth">▶ 从 0 播放生长</button>
    </div>
  </Section>

  <Section title="风场" hint="Wind">
    <ToggleRow label="启用风" v-model="w.enabled" />
    <ToggleRow label="自动风场 (由种子推导)" v-model="autoModel"
      hint="打开后: 风向/强度/阵风/湍流由种子自动生成" />
    <SliderRow label="风力强度" v-model="intensityModel" :min="0" :max="1" :step="0.01"
      hint="自动模式下会同时重算风场各参数" />
    <div class="inline">
      <button class="btn small" @click="onRandomWind">🎲 重新随机风向/风场</button>
    </div>
    <SliderRow label="风向" v-model="w.direction" :min="0" :max="360" :step="1" unit="°" />
    <SliderRow label="基础位移 (树梢顺风偏移)" v-model="w.strength" :min="0" :max="1.5" :step="0.005" unit="m" />
    <SliderRow label="摆动速度" v-model="w.speed" :min="0" :max="3" :step="0.01" />
    <SliderRow label="高频分量密度" v-model="w.frequency" :min="0.2" :max="3" :step="0.01"
      hint="次波与叶片扇动的频率倍率" />
    <SliderRow label="阵风强度" v-model="w.gust" :min="0" :max="1" :step="0.01" />
    <SliderRow label="阵风速度" v-model="w.gustSpeed" :min="0.02" :max="1.5" :step="0.01" />
    <SliderRow label="湍流 (横向)" v-model="w.turbulence" :min="0" :max="0.8" :step="0.01" />
    <SliderRow label="顺风偏置" v-model="w.bias" :min="0" :max="1" :step="0.01"
      hint="风只推不拉; 0 = 完全对称往复 (会显得像在绕圈), 建议 ≥0.2" />
    <SliderRow label="相位空间尺度" v-model="w.spatialScale" :min="0" :max="1.5" :step="0.01"
      hint="越大, 相邻枝条越同步" />
    <SliderRow label="柔度衰减指数" v-model="w.flexFalloff" :min="0.3" :max="3" :step="0.05"
      hint="越大, 只有梢部在动" />
  </Section>

  <Section title="枝条 / 叶片 摆幅" hint="Sway" :default-collapsed="true">
    <SliderRow label="树干树枝摆幅" v-model="w.barkSway" :min="0" :max="2" :step="0.01" />
    <SliderRow label="叶片扇动" v-model="w.leafFlutter" :min="0" :max="3" :step="0.01" />
    <SliderRow label="叶片铰链俯仰" v-model="w.leafTwist" :min="0" :max="2" :step="0.01" />
    <SliderRow label="时间缩放" v-model="w.timeScale" :min="0" :max="4" :step="0.01" />
    <p class="muted" style="margin: 0">
      风由顶点着色器实时计算: 每根枝条有独立相位 (aPhase), 柔度 (aWind) 由层级累积,
      所以梢部摆得比根部大。所有参数实时生效, 不需要重建几何。
    </p>
    <p class="muted" style="margin: 0">
      <b>叶片动力学</b>: 叶柄固定不动, 叶片只做①沿"下风向 + 重力"的固定方向弯曲,
      ②绕固定水平轴 (垂直于风向) 的铰链式俯仰。全程没有绕垂直轴的自转,
      加上顺风偏置 (风只推不拉), 所以轨迹是来回的线段而不是圆圈。
    </p>
  </Section>
</template>

<script setup>
import { computed } from 'vue'
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import { state, setWindIntensity, setWindAuto, randomizeWind } from '../../store/treeStore.js'

const w = state.params.wind
const g = state.params.growth

const intensityModel = computed({
  get: () => w.intensity,
  set: (v) => setWindIntensity(v),
})

const autoModel = computed({
  get: () => w.auto,
  set: (v) => setWindAuto(v),
})

function onRandomWind() {
  randomizeWind()
}

function playGrowth() {
  g.value = 0
  g.auto = true
}
</script>
