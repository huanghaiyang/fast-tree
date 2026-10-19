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
    <LeafShapeGallery
      v-model="L.shape"
      :shapes="shapes"
      :segments="L.segments"
      :curl="L.curl"
      :fold="L.fold"
      :petiole="L.petiole"
      :width="L.width"
    />
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

  <Section title="环境光遮蔽 (AO)" hint="Ambient Occlusion" :default-collapsed="true">
    <ToggleRow label="烘焙 AO 到顶点色" v-model="ao.enabled"
      hint="参考 SpeedTree 的顶点色 AO: 树冠内部/枝条根部更暗, 导出模型里也会带上" />
    <template v-if="ao.enabled">
      <SliderRow label="AO 强度" v-model="ao.strength" :min="0" :max="1" :step="0.01" />
      <SliderRow label="AO 半径 (米)" v-model="ao.radius" :min="0.2" :max="3" :step="0.05"
        hint="遮挡采样半径: 越大, 越远的叶片也会互相压暗" />
      <p class="muted" style="margin: 0">
        用叶片/花朵点云估算互相遮挡, 按几何体自身的 85 分位数归一化后乘进顶点色。
        不依赖渲染器, 规则/可复现; 关闭后恢复原始顶点色。
      </p>
    </template>
  </Section>

  <Section title="细节 / LOD" hint="LOD" :default-collapsed="true">
    <SliderRow label="树皮细节倍率" v-model="lod.barkDetail" :min="0.4" :max="2" :step="0.05"
      hint="1 = 按层级设定; 调低可提速" />
    <SliderRow label="叶片保留比例" v-model="lod.leafRatio" :min="0.05" :max="1" :step="0.05" />
    <SliderRow label="叶片数上限" v-model="lod.maxLeaves" :min="500" :max="200000" :step="500" />
    <ToggleRow label="动态 LOD (按距离降级)" v-model="lod.dynamic"
      hint="参考 SpeedTree: 相机远离时自动切到低模, 切近再切回全模" />
    <template v-if="lod.dynamic">
      <SliderRow label="LOD1 切换距离 (×树高)" v-model="lod.distance1" :min="0.6" :max="8" :step="0.1" />
      <SliderRow label="LOD2 切换距离 (×树高)" v-model="lod.distance2" :min="1.2" :max="20" :step="0.1" />
      <SliderRow label="LOD1 叶片保留" v-model="lod.keep1" :min="0.05" :max="1" :step="0.01" />
      <SliderRow label="LOD2 叶片保留" v-model="lod.keep2" :min="0.01" :max="0.5" :step="0.01" />
      <SelectRow label="LOD 档位" v-model="lod.force" :options="lodForceOptions" />
      <p class="muted" style="margin: 0">
        当前 <b>L{{ state.lodLevel }}</b>
        <span v-for="e in state.lodInfo" :key="e.level"> · L{{ e.level }} {{ e.triangles.toLocaleString() }} 面</span>
        <br />LOD1/2 首次需要时才构建并缓存; 选中高亮/线框模式会自动回到 LOD0。
      </p>
    </template>
  </Section>
</template>

<script setup>
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import ColorRow from '../ui/ColorRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import LeafShapeGallery from '../LeafShapeGallery.vue'
import { state } from '../../store/treeStore.js'

const L = state.params.leaves
const lod = state.params.lod
const ao = state.params.ao
const shapes = [
  { value: 'oval', label: '椭圆 oval' },
  { value: 'round', label: '圆叶 round' },
  { value: 'birch', label: '桦叶 birch' },
  { value: 'maple', label: '枫叶 maple' },
  { value: 'lance', label: '披针 lance' },
  { value: 'needle', label: '针叶 needle' },
  { value: 'oak', label: '橡叶 oak' },
  { value: 'palmate', label: '掌状 palmate' },
  { value: 'cordate', label: '心形 cordate' },
]
const lodForceOptions = [
  { value: 'auto', label: '自动 (按距离)' },
  { value: '0', label: '强制 LOD0 (全模)' },
  { value: '1', label: '强制 LOD1' },
  { value: '2', label: '强制 LOD2' },
]
</script>

