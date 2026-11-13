<template>
  <Section title="分枝算法" hint="Algorithm">
    <SelectRow label="分枝模式" v-model="b.mode" :options="modes"
      hint="levels = 传统逐层递归; sca = 空间殖民宽冠 (榕树/古榕)" />
    <template v-if="b.mode === 'sca'">
      <SliderRow label="吸引点数量" v-model="s.attractors" :min="20" :max="420" :step="10" />
      <SliderRow label="冠幅倍率 (÷树高)" v-model="s.crownWidth" :min="0.5" :max="2.8" :step="0.05" />
      <SliderRow label="冠高倍率 (÷树高)" v-model="s.crownHeight" :min="0.2" :max="1.2" :step="0.02" />
      <SliderRow label="冠中心下移" v-model="s.crownDrop" :min="0" :max="0.5" :step="0.01" />
      <SliderRow label="生长步长 (÷树高)" v-model="s.step" :min="0.01" :max="0.12" :step="0.002" />
      <SliderRow label="吸引点消耗半径" v-model="s.killRadius" :min="0.04" :max="0.4" :step="0.005" />
      <SliderRow label="分叉概率" v-model="s.branchiness" :min="0" :max="0.9" :step="0.01" />
      <SliderRow label="最大枝条数" v-model="s.maxBranches" :min="10" :max="240" :step="2" />
      <SliderRow label="树干起始高度" v-model="s.startT" :min="0.2" :max="0.9" :step="0.01" />
      <SliderRow label="下垂偏置" v-model="s.droop" :min="0" :max="1" :step="0.01" />
      <SliderRow label="方向噪声" v-model="s.wander" :min="0" :max="1" :step="0.01" />
      <SliderRow label="碰撞避让距离" v-model="s.collision" :min="0" :max="0.4" :step="0.005" hint="0 = 允许自由穿插" />
      <SliderRow label="冠枝半径比" v-model="s.radiusScale" :min="0.1" :max="0.9" :step="0.01" />
      <SliderRow label="冠枝锥度" v-model="s.taper" :min="0.05" :max="0.8" :step="0.01" />
    </template>
  </Section>

  <Section title="气生根" hint="Aerial Roots" :default-collapsed="true">
    <ToggleRow label="启用气生根" v-model="ar.enabled" />
    <template v-if="ar.enabled">
      <SliderRow label="每枝概率" v-model="ar.chance" :min="0" :max="1" :step="0.01" />
      <SliderRow label="每枝数量上限" v-model="ar.count" :min="1" :max="6" :step="1" />
      <SliderRow label="基部粗细 (÷枝条)" v-model="ar.thickness" :min="0.05" :max="0.8" :step="0.01" />
      <SliderRow label="垂落长度比" v-model="ar.length" :min="0.1" :max="1.5" :step="0.01" hint="1 = 直接落地" />
      <SliderRow label="最大长度" v-model="ar.maxLength" :min="1" :max="24" :step="0.5" unit="m" />
      <SliderRow label="下垂强度" v-model="ar.droop" :min="0" :max="1" :step="0.01" />
      <SliderRow label="横向摆动" v-model="ar.wobble" :min="0" :max="1.5" :step="0.01" />
      <SliderRow label="纵向分段" v-model="ar.segments" :min="3" :max="20" :step="1" />
      <SliderRow label="梢部/基部半径比" v-model="ar.taper" :min="0.05" :max="1" :step="0.01" />
    </template>
  </Section>

  <Section title="断枝破损" hint="Broken Branches" :default-collapsed="true">
    <SliderRow label="断枝概率" v-model="old.deadChance" :min="0" :max="1" :step="0.01"
      hint="每根枝条被折断的概率; 断枝被截短、不长子枝/叶/果, 并在断口生成破损几何" />
    <div class="inline">
      <button class="btn small" @click="applyBrokenPreset" title="按古树枯梢的调子一键设置破损参数">⚡ 一键破损</button>
      <button class="btn small" @click="resetBroken" title="关闭断枝 (概率归 0), 断枝参数原样保留">关闭断枝</button>
    </div>
    <template v-if="old.deadChance > 0">
      <div class="row-head"><label>允许断枝的层级</label></div>
      <div class="wrap">
        <label v-for="(on, i) in old.deadLevels" :key="i" class="level-tab" :class="{ active: on }">
          <input type="checkbox" v-model="old.deadLevels[i]" style="margin-right: 4px" />L{{ i + 1 }}
        </label>
      </div>
      <SliderRow label="断枝保留长度" v-model="old.deadLength" :min="0.05" :max="0.95" :step="0.01"
        hint="断口位置: 0.45 = 保留原枝长的 45%, 剩下的部分被折断" />
      <SliderRow label="断口位置随机" v-model="old.deadLengthVariance" :min="0" :max="0.4" :step="0.01"
        hint="0 = 同层断枝断在同一比例处; 越大断口高低越参差" />
      <SliderRow label="断口下垂" v-model="old.deadDroop" :min="0" :max="1.2" :step="0.01"
        hint="残枝失去支撑后朝地面弯的强度 (弧度); 0 = 保持原生长方向" />
      <SliderRow label="断口锯齿" v-model="old.breakJagged" :min="0" :max="1" :step="0.01"
        hint="断口面/树皮唇的撕裂程度: 0 = 平截面, 1 = 碎成锯齿与斜面" />
      <SliderRow label="断口木刺数" v-model="old.breakSplinters" :min="0" :max="12" :step="1"
        hint="每处断口伸出的木刺数量 (0 = 不生成木刺)" />
      <SliderRow label="木刺长度 (÷断口半径)" v-model="old.splinterLength" :min="0" :max="6" :step="0.05"
        hint="木刺有多长; 相对断口半径, 所以粗枝上的木刺也更长" />
      <ColorRow label="断口木芯颜色" v-model="old.heartColor"
        hint="新劈开的木质部颜色 (断口面与木刺用它着色, 树皮唇会偏暗)" />
      <p class="muted" style="margin: 0">
        断枝按枯木着色; 断口几何是蒙皮之后叠上去的独立壳, 不影响树皮蒙皮拓扑, 导出 GLB 时归属对应枝条节点。
      </p>
    </template>
  </Section>

  <Section title="树洞" hint="Hollow" :default-collapsed="true">
    <SliderRow label="树洞深度" v-model="old.hollowDepth" :min="0" :max="0.9" :step="0.01" hint="0 = 关闭" />
    <SliderRow label="树洞高度" v-model="old.hollowHeight" :min="0" :max="1" :step="0.01" />
    <SliderRow label="树洞宽度" v-model="old.hollowSize" :min="0.1" :max="2" :step="0.01" />
  </Section>

  <Section title="树枝层级" hint="Branch Levels">
    <SliderRow label="有效层级数" v-model="b.levels" :min="1" :max="5" :step="1"
      hint="树干算第 0 层; 每层的计数是「每根父枝上长几根」" />
    <div class="level-tabs">
      <div v-for="(cfg, i) in b.level" :key="i" class="level-tab"
        :class="{ active: active === i, off: !cfg.enabled || i + 1 > b.levels }"
        @click="active = i">
        L{{ i + 1 }} · {{ cfg.count }}
      </div>
    </div>
    <div class="muted">
      当前编辑 L{{ active + 1 }} (第 {{ active + 1 }} 级枝条) · 层级启用:
      <label class="inline" style="display: inline-flex; gap: 4px; margin-left: 6px">
        <input type="checkbox" v-model="cfg.enabled" />
      </label>
    </div>
  </Section>

  <Section title="L{{ active + 1 }} 分布" hint="Distribution">
    <SliderRow label="每根父枝上的数量" v-model="cfg.count" :min="1" :max="24" :step="1" />
    <SliderRow label="起始位置" v-model="cfg.startT" :min="0" :max="1" :step="0.01" hint="父枝上的相对位置" />
    <SliderRow label="结束位置" v-model="cfg.endT" :min="0" :max="1" :step="0.01" />
    <SliderRow label="位置抖动" v-model="cfg.startJitter" :min="0" :max="0.3" :step="0.005" />
    <SliderRow label="叶序角" v-model="cfg.phyllotaxis" :min="0" :max="360" :step="0.5" unit="°"
      hint="137.5° 是自然界的黄金角" />
    <SliderRow label="方位离散" v-model="cfg.spread" :min="0" :max="1.5" :step="0.01" />
  </Section>

  <Section title="L{{ active + 1 }} 形态" hint="Shape" :default-collapsed="true">
    <SliderRow label="长度 (相对父枝)" v-model="cfg.lengthRatio" :min="0.05" :max="1.2" :step="0.01" />
    <SliderRow label="长度随机" v-model="cfg.lengthVariance" :min="0" :max="0.8" :step="0.01" />
    <SliderRow label="半径 (相对父枝)" v-model="cfg.radiusRatio" :min="0.1" :max="0.9" :step="0.01" />
    <SliderRow label="半径随机" v-model="cfg.radiusVariance" :min="0" :max="0.7" :step="0.01" />
    <SliderRow label="锥度 (梢/基半径)" v-model="cfg.taper" :min="0.05" :max="1" :step="0.01" />
    <SliderRow label="半径曲线" v-model="cfg.radiusCurve" :min="0.4" :max="3" :step="0.05" />
    <SliderRow label="与父枝夹角" v-model="cfg.pitch" :min="5" :max="150" :step="1" unit="°" />
    <SliderRow label="夹角随机" v-model="cfg.pitchVariance" :min="0" :max="60" :step="1" unit="°" />
    <SliderRow label="弯曲" v-model="cfg.curve" :min="0" :max="1.6" :step="0.01" />
    <SliderRow label="弯曲随机" v-model="cfg.curveVariance" :min="0" :max="1" :step="0.02" />
    <SliderRow label="重力 (负 = 下垂)" v-model="cfg.gravity" :min="-0.8" :max="0.6" :step="0.01" />
    <SliderRow label="向上偏置" v-model="cfg.upBias" :min="-0.5" :max="0.5" :step="0.01" />
    <SliderRow label="扭转" v-model="cfg.twist" :min="-1" :max="1" :step="0.01" />
    <div class="grid-2">
      <SliderRow label="纵向分段" v-model="cfg.segments" :min="2" :max="20" :step="1" />
      <SliderRow label="周向分段" v-model="cfg.radialSegments" :min="3" :max="12" :step="1" />
    </div>
    <SelectRow label="交叉截面" v-model="cfg.crossSection" :options="crossSections" />
    <SliderRow v-if="cfg.crossSection === 'star'" label="星形深度" v-model="cfg.starDepth" :min="0" :max="0.6" :step="0.01" />
    <SliderRow label="柔度增益 (随风摆动)" v-model="cfg.windGain" :min="0" :max="1.5" :step="0.01" />
  </Section>

  <Section title="L{{ active + 1 }} 节点随机" hint="Node Variance" :default-collapsed="true">
    <SliderRow label="节点 Roll 方差" v-model="cfg.nodeRoll" :min="0" :max="45" :step="1" unit="°"
      hint="每个节点绕枝轴随机旋转的幅度: 让截面与侧枝朝向不再整齐" />
    <SliderRow label="节点位置偏移" v-model="cfg.nodeOffset" :min="0" :max="0.6" :step="0.01"
      hint="横向随机位移 (相对该节点半径): 让枝干轮廓不规则" />
    <SliderRow label="节点方向抖动" v-model="cfg.nodeJumble" :min="0" :max="20" :step="1" unit="°"
      hint="每个节点随机偏转生长方向: 产生更自然、更随机的外观" />
    <SliderRow label="节点 Roll 偏置" v-model="cfg.nodeRollBias" :min="-90" :max="90" :step="1" unit="°"
      hint="有符号: 沿枝长按比例累积的固定 roll, 正负决定整体旋向" />
    <SliderRow label="节点方向偏置" v-model="cfg.nodeJumbleBias" :min="-30" :max="30" :step="1" unit="°"
      hint="有符号: 恒定朝枝干侧向偏转, 让随机抖动带固定漂移方向" />
    <SliderRow label="趋势线噪声" v-model="cfg.spineNoise" :min="0" :max="0.8" :step="0.01"
      hint="连续噪声驱动的横向摆动 (相对半径): 打破笔直枝干; 0 = 关闭" />
    <SliderRow label="横截面噪声" v-model="cfg.crossNoise" :min="0" :max="0.4" :step="0.01"
      hint="环向噪声扰动半径 (相对半径): 打破完美圆形截面; 0 = 关闭" />
  </Section>

  <Section title="全局修正" hint="Global" :default-collapsed="true">
    <SliderRow label="枝条长度倍率" v-model="b.lengthScale" :min="0.2" :max="2.5" :step="0.01" />
    <SliderRow label="枝条半径倍率" v-model="b.radiusScale" :min="0.2" :max="2.5" :step="0.01" />
    <SliderRow label="重力倍率" v-model="b.gravityScale" :min="0" :max="2.5" :step="0.01" />
    <SliderRow label="趋光性" v-model="b.phototropism" :min="-0.4" :max="0.5" :step="0.01"
      hint="正 = 枝条向上翘" />
    <SliderRow label="顶端优势" v-model="b.apicalDominance" :min="0" :max="0.95" :step="0.01"
      hint="越大, 越靠梢部的枝条越短" />
    <SliderRow label="起始位置整体偏移" v-model="b.startSpread" :min="-0.4" :max="0.4" :step="0.01" />
  </Section>
</template>

<script setup>
import { computed, ref } from 'vue'
import Section from '../ui/Section.vue'
import SliderRow from '../ui/SliderRow.vue'
import SelectRow from '../ui/SelectRow.vue'
import ToggleRow from '../ui/ToggleRow.vue'
import ColorRow from '../ui/ColorRow.vue'
import { state } from '../../store/treeStore.js'

const b = state.params.branches
const s = b.sca
const ar = state.params.aerialRoots
const old = state.params.oldTree
const active = ref(0)
const cfg = computed(() => b.level[Math.min(active.value, b.level.length - 1)])

/**
 * 一键破损: 按"古树枯梢"的调子把断枝参数配好 (断口在枝长 42% 附近、L1~L3 会断、木刺 6 根)。
 * 只改 oldTree 的断枝字段, 不动树洞/其它面板; 参数变化由 Viewport 的几何组 watcher 自动重建。
 */
function applyBrokenPreset() {
  old.deadChance = 0.35
  old.deadLength = 0.42
  old.deadLengthVariance = 0.18
  old.deadLevels = [true, true, true, false, false]
  old.deadDroop = 0.45
  old.breakJagged = 0.7
  old.breakSplinters = 6
  old.splinterLength = 1.8
  old.heartColor = '#cdb489'
}

/** 关闭断枝 (概率归 0): 断枝参数原样保留, 方便再打开。 */
function resetBroken() {
  old.deadChance = 0
}

const modes = [
  { value: 'levels', label: '逐层递归 (levels)' },
  { value: 'sca', label: '空间殖民宽冠 (sca)' },
]
const crossSections = [
  { value: 'round', label: '圆 (round)' },
  { value: 'star', label: '星形 (star)' },
  { value: 'square', label: '方 (square)' },
]
</script>
