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
    <SliderRow label="叶柄扭转" v-model="L.twist" :min="0" :max="1.5" :step="0.01" />
    <SliderRow label="对齐枝条程度" v-model="L.orientToBranch" :min="0" :max="1" :step="0.01" />
  </Section>

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

const shapes = [
  { value: 'oval', label: '椭圆 oval' },
  { value: 'birch', label: '桦叶 birch' },
  { value: 'maple', label: '枫叶 maple' },
  { value: 'lance', label: '披针 lance' },
  { value: 'needle', label: '针叶 needle' },
]
</script>
