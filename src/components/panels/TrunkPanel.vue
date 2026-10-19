<template>
  <Section title="扭曲句柄" hint="Twist Handles" :default-collapsed="true">
    <ToggleRow label="显示扭曲句柄" v-model="state.twistEdit"
      hint="在视口中显示 5 个可拖拽句柄, 直接编辑树干/树枝的扭转曲线" />
    <template v-if="state.twistEdit">
      <SelectRow label="编辑对象" v-model="state.twistTarget" :options="twistTargets" />
      <SelectRow v-if="state.twistTarget === 'branches'" label="树枝层级" v-model="state.twistLevel" :options="twistLevels" />
      <div class="inline">
        <button class="btn small" @click="resetTwist">重置扭转曲线</button>
      </div>
      <p class="muted" style="margin: 0">
        视口里的青色圆点 = 扭转控制点 (t=0/25/50/75/100%)；左右拖拽改变该处的累计扭转角，
        正负决定旋向。树干与树枝共用 5 点曲线，范围 ±720°。
      </p>
    </template>
  </Section>

  <Section title="树干" hint="Trunk">
    <SliderRow label="树干高度" v-model="t.height" :min="0.5" :max="30" :step="0.1" unit="m" />
    <SliderRow label="底部半径" v-model="t.baseRadius" :min="0.02" :max="1.5" :step="0.01" unit="m" />
    <SliderRow label="顶部/底部半径比" v-model="t.taper" :min="0.005" :max="1" :step="0.005" hint="锥度" />
    <SliderRow label="锥度曲线" v-model="t.radiusCurve" :min="0.4" :max="3" :step="0.05" hint=">1 根部更粗壮" />
    <div class="grid-2">
      <SliderRow label="纵向分段" v-model="t.segments" :min="3" :max="40" :step="1" />
      <SliderRow label="周向分段" v-model="t.radialSegments" :min="4" :max="24" :step="1" />
    </div>
    <SliderRow label="弯曲" v-model="t.curve" :min="0" :max="1.6" :step="0.01" hint="整根树干的总弯曲弧度" />
    <SliderRow label="弯曲随机" v-model="t.curveVariance" :min="0" :max="1" :step="0.02" />
    <SliderRow label="倾斜" v-model="t.lean" :min="-0.6" :max="0.6" :step="0.005" />
    <SliderRow label="倾斜方向" v-model="t.leanDirection" :min="0" :max="360" :step="1" unit="°" />
    <SliderRow label="扭转" v-model="t.twist" :min="-1" :max="1" :step="0.01" hint="沿高度的截面螺旋" />
    <SliderRow label="不规则生长 (gnarl)" v-model="t.gnarl" :min="0" :max="1.5" :step="0.01" />
    <SliderRow label="椭圆化" v-model="t.squash" :min="0.4" :max="2" :step="0.02" hint="1 = 正圆截面" />
    <ToggleRow label="树干树枝树根一体建模" v-model="t.onePiece"
      hint="开启 = 树干/树枝/树根作为同一棵树体建模，分支基部领口更融合，导出合并为单个 Bark mesh；关闭 = 分开建模并保留 Bark_Trunk/Branch/Roots 节点。注意：这是对象/节点级合并，不是实体布尔并集。端盖始终保留，几何保持封闭。" />
    <SelectRow label="枝干穿插处理" v-model="t.junctionMode" :options="junctionModes"
      hint="不处理 = 基础管状相交；视觉遮挡 = 加大分支领口遮住接缝（非并集）；布尔并集 = 用 CSG 真正裁掉内部重叠面；隐式重建 = CSG 并集后平滑重建（实验性，面数与细节会变化）" />
  </Section>

  <Section title="主干分叉 (多主枝)" hint="Fork / Leaders" :default-collapsed="true">
    <ToggleRow label="启用主干分叉" v-model="f.enabled"
      hint="乔木常见形态: 主干在 1/3 高度处分成 2~4 条主枝 (参考橡树)" />
    <template v-if="f.enabled">
      <SliderRow label="分叉主枝数" v-model="f.count" :min="2" :max="6" :step="1" />
      <SliderRow label="分叉高度" v-model="f.height" :min="0.1" :max="0.65" :step="0.01" hint="占树干高度的比例" />
      <SliderRow label="主枝夹角" v-model="f.angle" :min="5" :max="60" :step="1" unit="°" />
      <SliderRow label="方位离散" v-model="f.spread" :min="0" :max="1.5" :step="0.05" hint="0 = 完全均匀分布" />
      <SliderRow label="主枝半径比" v-model="f.radiusScale" :min="0.3" :max="0.95" :step="0.01"
        hint="主枝基部半径 ÷ 分叉处主干半径" />
      <SliderRow label="主枝长度倍率" v-model="f.lengthScale" :min="0.5" :max="1.6" :step="0.02" />
      <div class="grid-2">
        <SliderRow label="主枝锥度" v-model="f.taper" :min="0.05" :max="0.8" :step="0.01" />
        <SliderRow label="主枝弯曲" v-model="f.curve" :min="0" :max="1.2" :step="0.02" />
      </div>
      <SliderRow label="主枝重力" v-model="f.gravity" :min="-0.5" :max="0.5" :step="0.01" />
    </template>
  </Section>

  <Section title="根部外扩 / 节瘤" hint="Flare & Knots" :default-collapsed="true">
    <SliderRow label="根部外扩强度" v-model="t.flare" :min="0" :max="3" :step="0.05" />
    <SliderRow label="外扩高度比例" v-model="t.flareHeight" :min="0.02" :max="0.6" :step="0.01" />
    <SliderRow label="节瘤数量" v-model="t.knots" :min="0" :max="12" :step="1" />
    <SliderRow label="节瘤大小" v-model="t.knotSize" :min="0" :max="1.2" :step="0.02" />
  </Section>

  <Section title="树根" hint="Roots" :default-collapsed="true">
    <ToggleRow label="启用树根" v-model="r.enabled" />
    <template v-if="r.enabled">
      <SliderRow label="数量" v-model="r.count" :min="1" :max="16" :step="1" />
      <SliderRow label="长度 (相对树高)" v-model="r.length" :min="0.02" :max="0.6" :step="0.01" />
      <SliderRow label="长度随机" v-model="r.lengthVariance" :min="0" :max="0.8" :step="0.02" />
      <SliderRow label="半径比" v-model="r.radiusRatio" :min="0.1" :max="0.9" :step="0.02" />
      <SliderRow label="辐射范围" v-model="r.spread" :min="0.1" :max="1" :step="0.02" hint="1 = 绕树干一整圈" />
      <SliderRow label="与树干夹角" v-model="r.pitch" :min="70" :max="160" :step="1" unit="°" hint=">90° 向下" />
      <SliderRow label="弯曲" v-model="r.curve" :min="0" :max="1.5" :step="0.02" />
      <SliderRow label="下扎强度" v-model="r.sink" :min="0" :max="1.5" :step="0.02" />
      <div class="grid-2">
        <SliderRow label="分段" v-model="r.segments" :min="2" :max="14" :step="1" />
        <SliderRow label="周向分段" v-model="r.radialSegments" :min="3" :max="10" :step="1" />
      </div>
    </template>
  </Section>
</template>

<script setup>
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import { state } from '../../store/treeStore.js'
import { normalizeTwistProfile } from '../../core/twist.js'
import { watch } from 'vue'

const t = state.params.trunk
const r = state.params.roots
const f = state.params.trunk.fork
const junctionModes = [
  { value: 'none', label: '不处理（基础管状相交）' },
  { value: 'extrude', label: '挤出式一体建模（表面贴合，不加大领口）' },
  { value: 'collar', label: '视觉遮挡（加大领口，非并集）' },
  { value: 'csg', label: '布尔并集（CSG，消除内部重叠）' },
  { value: 'implicit', label: '隐式平滑重建（CSG + 平滑，实验性）' },
]
watch(() => t.junctionMode, (v) => {
  // 挤出/布尔/隐式模式本身就是一个连续模型, 自动打开一体建模导出
  if (v === 'extrude' || v === 'csg' || v === 'implicit') t.onePiece = true
})
const twistTargets = [
  { value: 'trunk', label: '树干' },
  { value: 'branches', label: '树枝' },
]
const twistLevels = [1, 2, 3, 4, 5].map((v) => ({ value: String(v), label: `L${v}` }))

function resetTwist() {
  const arr = state.twistTarget === 'trunk' ? state.params.trunk.twistProfile : state.params.branches.twistProfile
  arr.splice(0, arr.length, ...normalizeTwistProfile(null))
}
</script>
