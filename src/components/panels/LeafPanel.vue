<template>
  <Section title="树叶" hint="Foliage">
    <ToggleRow label="启用树叶" v-model="L.enabled" />
    <template v-if="L.enabled">
      <div class="row-head"><label>生长在哪几层枝条上</label></div>
      <div class="wrap">
        <label v-for="(on, i) in L.levels" :key="i" class="level-tab" :class="{ active: on }">
          <input type="checkbox" v-model="L.levels[i]" style="margin-right: 4px" />L{{ i + 1 }}
        </label>
      </div>
      <SliderRow label="每条枝条叶簇位置数" v-model="L.perBranch" :min="1" :max="30" :step="1" />
      <SliderRow label="每簇叶片数" v-model="L.clusterCount" :min="1" :max="12" :step="1" />
      <SliderRow label="叶簇半径" v-model="L.clusterRadius" :min="0" :max="1" :step="0.01" unit="m" />
      <SliderRow label="叶簇离散" v-model="L.clusterSpread" :min="0" :max="2" :step="0.02" />
      <SliderRow label="分布起始位置" v-model="L.startT" :min="0" :max="1" :step="0.01" />
      <SliderRow label="分布结束位置" v-model="L.endT" :min="0" :max="1" :step="0.01" />
    </template>
  </Section>

  <Section title="叶片形态" hint="Blade" :default-collapsed="true">
    <SliderRow label="叶片长度" v-model="L.size" :min="0.02" :max="1.5" :step="0.005" unit="m" />
    <SliderRow label="大小随机" v-model="L.sizeVariance" :min="0" :max="0.8" :step="0.01" />
    <SliderRow label="宽/长比" v-model="L.width" :min="0.05" :max="1.6" :step="0.01" />
    <SelectRow label="叶片形状" v-model="L.shape" :options="shapes" />
    <ToggleRow v-if="L.shape === 'trumpet' || L.shape === 'bell'" label="三维花冠" v-model="L.flower3d"
      hint="开 = 真三维漏斗网格 (双壳有厚度, 内外壁都可见); 关 = 平面卡片" />
    <SliderRow v-if="L.flower3d !== false && (L.shape === 'trumpet' || L.shape === 'bell')" label="花瓣数"
      v-model="L.flowerLobes" :min="3" :max="8" :step="1" />
    <SliderRow v-if="L.flower3d !== false && (L.shape === 'trumpet' || L.shape === 'bell')" label="花冠壁厚"
      v-model="L.flowerThickness" :min="0" :max="0.15" :step="0.005" hint="0 = 单层面 (省面数); 越大越有厚度感" />
    <SelectRow v-if="L.flower3d !== false && (L.shape === 'trumpet' || L.shape === 'bell')" label="花冠质量"
      v-model="L.flowerQuality" :options="flowerQualityOptions" />
    <ToggleRow v-if="L.flower3d !== false && (L.shape === 'trumpet' || L.shape === 'bell')" label="花瓣分层"
      v-model="L.flowerPetals" hint="花口向外翻出独立花瓣 (每片 2 三角形)" />
    <SliderRow v-if="L.flower3d !== false && (L.shape === 'trumpet' || L.shape === 'bell')" label="花簇数量"
      v-model="L.flowerCluster" :min="1" :max="5" :step="1" hint="一个叶片点位放几朵花 (簇状更自然, 面数按倍数增长)" />
    <ToggleRow v-if="L.flower3d !== false && (L.shape === 'trumpet' || L.shape === 'bell')" label="花蕊"
      v-model="L.flowerTilt" :min="0" :max="90" :step="5" unit="°" hint="花口朝向: 0 = 顺枝条朝外, 45 = 斜向上 (樱花多数如此), 90 = 正朝上" />
    <ToggleRow v-if="L.flower3d !== false && (L.shape === 'trumpet' || L.shape === 'bell')" label="花蕊"
      v-model="L.flowerStamen" hint="花冠中心加一小簇雄蕊" />
    <ColorRow v-if="L.flower3d !== false && L.flowerStamen !== false && (L.shape === 'trumpet' || L.shape === 'bell')" label="花蕊颜色"
      v-model="L.flowerStamenColor" />
    <SliderRow label="叶片分段" v-model="L.segments" :min="2" :max="12" :step="1" />
    <SliderRow label="纵向弯曲 (curl)" v-model="L.curl" :min="-0.6" :max="0.6" :step="0.01" />
    <SliderRow label="横向折叠 (fold)" v-model="L.fold" :min="-0.4" :max="0.8" :step="0.01" />
    <SliderRow label="叶柄长度比例" v-model="L.petiole" :min="0" :max="0.4" :step="0.01" />
  </Section>

  <Section title="叶片朝向" hint="Orientation" :default-collapsed="true">
    <SliderRow label="相对枝条俯仰" v-model="L.pitch" :min="-110" :max="110" :step="1" unit="°" />
    <SliderRow label="俯仰随机" v-model="L.pitchVariance" :min="0" :max="90" :step="1" unit="°" />
    <SliderRow label="自重下垂" v-model="L.droop" :min="0" :max="1.2" :step="0.01" />
    <SliderRow label="叶面朝上" v-model="L.faceUp" :min="0" :max="1" :step="0.01" />
    <SliderRow label="滚转随机" v-model="L.rollVariance" :min="0" :max="360" :step="1" unit="°" />
    <SliderRow label="叶柄扭转" v-model="L.twist" :min="0" :max="1.5" :step="0.01" />  </Section>

  <Section title="叶片颜色" hint="Color" :default-collapsed="true">
    <ColorRow label="叶基颜色" v-model="L.color" />
    <ColorRow label="叶尖颜色" v-model="L.colorTip" />
    <SliderRow label="颜色随机" v-model="L.colorVariance" :min="0" :max="0.6" :step="0.01" />
    <p class="muted" style="margin: 0">
      叶色烘焙在顶点色里 (改色会重建叶片几何, 约 50–200ms)。全局色调请用「材质 → 树叶 → 色调」。
    </p>
  </Section>

  <Section title="细节 / LOD" hint="LOD" :default-collapsed="true">
    <SliderRow label="树皮细节倍率" v-model="lod.barkDetail" :min="0.4" :max="2" :step="0.05"
      hint="1 = 按层级设定; 调低可提速" />
    <SliderRow label="叶片保留比例" v-model="lod.leafRatio" :min="0.05" :max="1" :step="0.05" />
    <SliderRow label="叶片数上限" v-model="lod.maxLeaves" :min="500" :max="200000" :step="500" />
  </Section>
</template>

<script setup>
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import ColorRow from '../ui/ColorRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import { state } from '../../store/treeStore.js'

const L = state.params.leaves
const lod = state.params.lod

const flowerQualityOptions = [
  { value: 'high', label: '高 (双壳+花蕊+花瓣层)' },
  { value: 'medium', label: '中 (单壳+花蕊)' },
  { value: 'low', label: '低 (单壳, 省面数)' },
]
const shapes = [
  { value: 'oval', label: '椭圆 oval' },
  { value: 'birch', label: '桦叶 birch' },
  { value: 'maple', label: '枫叶 maple' },
  { value: 'lance', label: '披针 lance' },
  { value: 'needle', label: '针叶 needle' },
  { value: 'trumpet', label: '喇叭花 trumpet' },
  { value: 'bell', label: '钟形花 bell' },
]
</script>

