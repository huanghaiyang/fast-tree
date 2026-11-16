<template>
  <Section title="竹子特有参数" hint="Bamboo" :default-collapsed="false">
    <SliderRow label="竿数" v-model="B.culms" :min="1" :max="12" :step="1"
      hint="一丛里几根竹竿 (1 = 单竿)" />
    <SliderRow label="竹高 (m)" v-model="B.height" :min="0.6" :max="20" :step="0.1" unit="m"
      hint="成熟株的竿高; 生长阶段会再按年龄缩放" />
    <SliderRow label="竿基半径 (m)" v-model="B.culmRadius" :min="0.01" :max="0.12" :step="0.002" unit="m" />
    <SliderRow label="丛基高度 (m)" v-model="B.baseHeight" :min="0.1" :max="1.2" :step="0.05" unit="m"
      hint="地下根茎堆（根盘）的高度；整块埋在地面以下，只决定竿基的出土深度" />
    <SliderRow label="根盘半径 (m)" v-model="B.rootSpread" :min="0" :max="2" :step="0.05" unit="m"
      hint="竿基在地下按这个半径散开、各自破土：0 = 全部抱在一点（旧行为）" />
    <SliderRow label="竿基离散" v-model="B.rootScatter" :min="0" :max="1" :step="0.01"
      hint="让竿基的半径/方位不再是一个规整圆环（根盘锥度 + 椭圆度 + 方位散布）" />
    <SliderRow label="竿基错落 (m)" v-model="B.rootStagger" :min="0" :max="0.6" :step="0.02" unit="m"
      hint="每根竿出土的高低差：越错落，竿基半径差越大（贴在不同深度的根盘上）" />
    <SliderRow label="竹竿外倾角" v-model="B.tilt" :min="0" :max="30" :step="0.5" unit="°"
      hint="竹竿离竖直方向的角度；越大竹丛越开张" />
    <SliderRow label="每竿节数" v-model="B.nodeCount" :min="4" :max="40" :step="1"
      hint="只用树皮贴图表达（竹节环不生成几何）；改它会重建贴图的平铺密度" />
    <SliderRow label="侧枝起点" v-model="B.branchStart" :min="0.05" :max="0.95" :step="0.01"
      hint="竿的下段光竿、上段才出侧枝——竹林最容易被认出的剪影" />
    <SliderRow label="每竿侧枝数" v-model="B.twigs" :min="0" :max="6" :step="1" />
    <SliderRow label="侧枝长度 (m)" v-model="B.twigLength" :min="0.2" :max="2" :step="0.05" unit="m" />
    <SliderRow label="每枝叶数" v-model="B.leafPerTwig" :min="1" :max="20" :step="1" />
    <SliderRow label="竹叶长度 (m)" v-model="B.leafSize" :min="0.05" :max="0.6" :step="0.01" unit="m" />
    <SliderRow label="竹叶宽长比" v-model="B.leafWidth" :min="0.04" :max="0.4" :step="0.01" />
    <SliderRow label="竹叶下垂" v-model="B.leafDroop" :min="0" :max="1" :step="0.01" />
    <p class="muted" style="margin: 0">
      竹子和其它树种结构不同：这里是"一块低矮根盘 + 一丛近乎平行的细竿 + 上段侧枝"，不是"主干 + 逐层分枝"。
      竿数/竹高/竿径/节数/根盘离散等由 <code>core/bamboo.js</code> 在生成前展开成通用结构，
      所以风场、LOD、节点树、导出都照常可用。
      <br />竹节环是<b>贴图级</b>效果（树皮按「每竿节数」平铺竹节图案），不是实体几何。
    </p>
  </Section>
</template>

<script setup>
import { computed } from 'vue'
import Section from './ui/Section.vue'
import SliderRow from './ui/SliderRow.vue'
import { state } from '../store/treeStore.js'

// 用 computed 而不是 `state.params.bamboo`: 撤销/导入参数时会整体替换 state.params,
// 持有旧对象引用会让滑杆写到一棵已经被丢弃的参数树上。
const B = computed(() => state.params.bamboo)
</script>
