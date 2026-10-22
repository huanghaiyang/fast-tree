/**
 * 环境预设 (天空 / 光照 / 雾 / 地面 / 星空)
 * ------------------------------------------------------------
 * 只改 scene 参数, 不重建几何; 切换后仍可手动微调。
 * 每个预设只覆盖自己关心的字段, 其余保持用户当前设置。
 *
 * 作用: 提供一组"开箱即用"的场景光照方案 (白昼/黄昏/森林/雨林/沙漠/雪地/高原/黑夜/群星),
 *       用户点一下就得到一整套协调的天空色、太阳角度、雾、地面与曝光。
 * 输入 / 输出:
 *   - 本模块主体是**纯数据** (`ENVIRONMENTS` 数组);
 *   - `applyEnvironment(sceneParams, id)` 把某个预设 `Object.assign` 进 `state.params.scene` (原地修改)。
 * 与其他模块的关系:
 *   - 上游: `store/treeStore.js` 的 `state.params.scene` 是唯一落点; 面板
 *     `components/panels/ScenePanel.vue` 显示这些滑杆并调用 `applyEnvironment`;
 *   - 下游: `core/sceneManager.js` 的 `updateScene(sceneParams)` 按这些字段建天空盒/灯光/雾/地面;
 *   - 因此**字段名必须与 sceneManager 读取的字段名完全一致**, 拼错不会报错, 只会静默无效。
 * 关键约定 (改预设前必读):
 *   - 只写"这个预设关心的字段": 机制上 `applyEnvironment` 只 `Object.assign` 预设里写出的键,
 *     没写的键保持用户当前值 (注意: 当前 10 个预设基本覆盖了同一批键, 所以实际接近全量覆盖;
 *     新增预设时若只想改几项, 不写其余键即可保住用户的手工微调);
 *   - 颜色一律用 `'#rrggbb'` 字符串 (丢给 THREE.Color 解析);
 *   - `sunAzimuth` / `sunElevation` 单位是**度**: 方位角 0..360 绕 Y 轴,
 *     仰角 0=地平线, 90=正上方; `sunIntensity` / `ambient` 是无量纲强度倍率;
 *   - `stars` 是 0..1 的星空密度 (0 = 不画星空);
 */

/* ---------------- scene 字段图例 (每个预设里 scene 对象的键) ----------------
 *  渐变天空
 *   gradient      boolean  是否用竖直渐变天空 (false 时用纯色 background)
 *   background    string   纯色背景 / 渐变不可用时的兜底色 (#rrggbb)
 *   skyTop        string   渐变天空顶部颜色 (天顶)
 *   skyBottom     string   渐变天空底部颜色 (地平线)
 *  地面
 *   ground        boolean  是否显示地面平面
 *   groundColor   string   地面颜色
 *   grid          boolean  是否显示参考网格 (预设一般关掉, 网格属于调试辅助)
 *  雾
 *   fog           boolean  是否开启雾
 *   fogColor      string   雾色 (要与天空/远景协调, 否则地平线会出现色带)
 *   fogScale      number   雾浓度倍率: 越大雾越近越浓 (各预设 0.2~1.1)
 *  光照
 *   shadows       boolean  是否投影 (关闭可省大量渲染开销)
 *   sunColor      string   太阳(主平行光)颜色; 黄昏偏橙, 夜晚偏冷蓝
 *   sunAzimuth    number   太阳方位角 (度, 0..360, 绕 Y 轴)
 *   sunElevation  number   太阳仰角 (度, 0=地平线..90=正上方); 低仰角 = 长阴影 + 暖光
 *   sunIntensity  number   主光强度倍率 (白昼 ~3.6, 夜晚 0.12)
 *   ambient       number   环境光强度 (阴天/雪地需要更高, 否则暗部死黑)
 *   hemiSky       string   半球光天空色 (上方来的补光)
 *   hemiGround    string   半球光地面色 (地面反射上来的补光)
 *  后期
 *   exposure      number   色调映射曝光倍率 (整体亮度闸门)
 *  星空
 *   stars         number   星空密度 0..1 (0 = 无星, 1 = 满天星)
 * ------------------------------------------------------------------------ */


/**
 * 全部环境预设 (顺序 = UI 里按钮的顺序)。
 *
 * 每一项的结构:
 *   `{ id, name, icon, desc, scene }`
 *   - `id`   : 稳定标识符, 写进 `state.params.scene.env`, **改名会让旧参数文件失效**;
 *   - `name` : UI 显示名;
 *   - `icon` : emoji 图标 (只用于按钮, 不参与逻辑);
 *   - `desc` : 一句话说明 (悬停提示);
 *   - `scene`: 要覆盖到 `state.params.scene` 的字段 (键见上方图例, 未列出的保持用户当前值)。
 *
 * 预设一览 (定位 / 光比特点):
 *   daylight   白昼   高位暖白太阳 + 高环境光, 色彩最中性, 适合检查材质本色
 *   dusk       黄昏   仰角 10° 的橙色太阳 + 低环境光, 长阴影、强暖冷对比
 *   forest     森林   中等绿光 + 中等雾, 模拟树冠透下来的漫射光
 *   rainforest 雨林   极浓雾(fogScale 0.45=雾很近) + 深绿环境光, 空气感最强
 *   desert     沙漠   最高太阳强度之一 + 偏黄雾, 高对比、地面反光强
 *   snow       雪地   最高环境光(1.45) + 冷色天光, 压低阴影对比 (雪面本身是巨大反光板)
 *   plateau    高原   深蓝天顶 + 最强太阳(4.2) + 几乎无雾, 通透、紫外感强
 *   night      黑夜   弱冷月光 + 稀疏星空, 仅保留轮廓与少量反射
 *   starry     群星   近乎无光 (太阳 0.12) + 满天星, 纯剪影用途
 */
export const ENVIRONMENTS = [
  {
    id: 'daylight',
    name: '白昼',
    icon: '☀️',
    desc: '晴朗正午: 明亮蓝天 + 暖白太阳 + 草地',
    scene: {
      gradient: true,
      background: '#8fc0ea',
      skyTop: '#4f92d8',
      skyBottom: '#dcefff',
      ground: true,
      groundColor: '#5c7247',
      grid: false,
      fog: true,
      fogColor: '#cfe4f5',
      fogScale: 0.75,
      shadows: true,
      sunColor: '#fff6e6',
      sunAzimuth: 40,
      sunElevation: 52,
      sunIntensity: 3.6,
      ambient: 1.25,
      exposure: 1.12,
      hemiSky: '#d6eaff',
      hemiGround: '#4a3c2a',
      stars: 0,
    },
  },
  {
    id: 'dusk',
    name: '黄昏',
    icon: '🌇',
    desc: '低角度暖色太阳 + 橙紫渐变天空',
    scene: {
      gradient: true,
      background: '#c97a63',
      skyTop: '#5b4a8a',
      skyBottom: '#f2b06f',
      ground: true,
      groundColor: '#4b3b32',
      grid: false,
      fog: true,
      fogColor: '#d99a72',
      fogScale: 0.6,
      shadows: true,
      sunColor: '#ffb066',
      sunAzimuth: 265,
      sunElevation: 10,
      sunIntensity: 1.5,
      ambient: 0.75,
      exposure: 1.25,
      hemiSky: '#a58bd0',
      hemiGround: '#3a2a22',
      stars: 0,
    },
  },
  {
    id: 'forest',
    name: '森林',
    icon: '🌲',
    desc: '树冠绿光 + 薄雾 + 林地地面',
    scene: {
      gradient: true,
      background: '#1e2a24',
      skyTop: '#4a6b55',
      skyBottom: '#1a241f',
      ground: true,
      groundColor: '#2f3a24',
      grid: false,
      fog: true,
      fogColor: '#3a5040',
      fogScale: 0.8,
      shadows: true,
      sunColor: '#ffe9c0',
      sunAzimuth: 140,
      sunElevation: 38,
      sunIntensity: 2.2,
      ambient: 1.05,
      exposure: 1.05,
      hemiSky: '#9fc7a8',
      hemiGround: '#1f1a12',
      stars: 0,
    },
  },
  {
    id: 'rainforest',
    name: '雨林',
    icon: '🌴',
    desc: '高湿度浓雾 + 深绿环境光 + 顶部强光',
    scene: {
      gradient: true,
      background: '#13251c',
      skyTop: '#2f5c46',
      skyBottom: '#0d1712',
      ground: true,
      groundColor: '#26351f',
      grid: false,
      fog: true,
      fogColor: '#2f5947',
      fogScale: 0.45,
      shadows: true,
      sunColor: '#eaffd8',
      sunAzimuth: 200,
      sunElevation: 66,
      sunIntensity: 2.0,
      ambient: 1.15,
      exposure: 1.08,
      hemiSky: '#8fd6b0',
      hemiGround: '#14200f',
      stars: 0,
    },
  },
  {
    id: 'desert',
    name: '沙漠',
    icon: '🏜️',
    desc: '沙色天空 + 强阳光 + 沙地，雾偏黄',
    scene: {
      gradient: true,
      background: '#e7c58c',
      skyTop: '#e8b46a',
      skyBottom: '#f7e3b5',
      ground: true,
      groundColor: '#d9b06b',
      grid: false,
      fog: true,
      fogColor: '#e6c690',
      fogScale: 0.9,
      shadows: true,
      sunColor: '#fff0cf',
      sunAzimuth: 60,
      sunElevation: 58,
      sunIntensity: 4.1,
      ambient: 0.95,
      exposure: 1.0,
      hemiSky: '#ffe5b8',
      hemiGround: '#6b4e2e',
      stars: 0,
    },
  },
  {
    id: 'snow',
    name: '雪地',
    icon: '❄️',
    desc: '冷色天空 + 高环境光 + 雪地，低角度冬阳',
    scene: {
      gradient: true,
      background: '#cfe2f2',
      skyTop: '#9dbfe0',
      skyBottom: '#eef7ff',
      ground: true,
      groundColor: '#e6eef5',
      grid: false,
      fog: true,
      fogColor: '#dceaf5',
      fogScale: 1.1,
      shadows: true,
      sunColor: '#f2f8ff',
      sunAzimuth: 220,
      sunElevation: 28,
      sunIntensity: 2.4,
      ambient: 1.45,
      exposure: 1.02,
      hemiSky: '#e2f1ff',
      hemiGround: '#6c7480',
      stars: 0,
    },
  },
  {
    id: 'plateau',
    name: '高原',
    icon: '🏔️',
    desc: '高原深蓝天空 + 强紫外光 + 岩石草甸，几乎无雾',
    scene: {
      gradient: true,
      background: '#5d9bd6',
      skyTop: '#2867b8',
      skyBottom: '#c9def2',
      ground: true,
      groundColor: '#6d6952',
      grid: false,
      fog: false,
      fogColor: '#9ec4e6',
      fogScale: 0.3,
      shadows: true,
      sunColor: '#fff8e8',
      sunAzimuth: 150,
      sunElevation: 70,
      sunIntensity: 4.2,
      ambient: 1.5,
      exposure: 1.0,
      hemiSky: '#cfe8ff',
      hemiGround: '#4a4436',
      stars: 0,
    },
  },
  {
    id: 'night',
    name: '黑夜',
    icon: '🌙',
    desc: '冷色月光 + 稀疏星空 + 暗色地面',
    scene: {
      gradient: true,
      background: '#05070f',
      skyTop: '#0b1324',
      skyBottom: '#04060c',
      ground: true,
      groundColor: '#141821',
      grid: false,
      fog: true,
      fogColor: '#070b14',
      fogScale: 0.4,
      shadows: true,
      sunColor: '#9fb8ff',
      sunAzimuth: 310,
      sunElevation: 32,
      sunIntensity: 0.32,
      ambient: 0.35,
      exposure: 1.25,
      hemiSky: '#2a3a66',
      hemiGround: '#07090e',
      stars: 0.35,
    },
  },
  {
    id: 'starry',
    name: '群星',
    icon: '✨',
    desc: '深空背景 + 满天星斗 + 极弱月光',
    scene: {
      gradient: true,
      background: '#02030a',
      skyTop: '#050a18',
      skyBottom: '#010208',
      ground: true,
      groundColor: '#0b0d14',
      grid: false,
      fog: false,
      fogColor: '#02030a',
      fogScale: 0.2,
      shadows: true,
      sunColor: '#8fa9ff',
      sunAzimuth: 300,
      sunElevation: 40,
      sunIntensity: 0.12,
      ambient: 0.2,
      exposure: 1.15,
      hemiSky: '#1a2850',
      hemiGround: '#04050a',
      stars: 1,
    },
  },
]

/** 所有预设 id 的数组 (顺序与 UI 一致); 用于校验下拉值/生成预设列表 */
export const ENV_IDS = ENVIRONMENTS.map((e) => e.id)

/**
 * 按 id 查预设。
 * @param {string} id 预设 id (例如 'dusk')
 * @returns {object|null} 预设对象; **找不到返回 null**(而不是抛错/兜底到第一个) ——
 *   调用方据此判断"参数文件里的 env 已经不存在了", 可以显式提示而不是静默换风格
 */
export function envById(id) {
  return ENVIRONMENTS.find((e) => e.id === id) || null
}

/**
 * 把某个环境预设应用到 scene 参数 (原地修改, 不重建几何)。
 *
 * 只做两件事:
 *   1. 把 `env.scene` 里的字段 `Object.assign` 进 `sceneParams` (未列出的字段不动);
 *   2. 写入 `sceneParams.env = env.id`, 让 UI 知道当前选中的是哪个预设
 *      (但用户之后手动改滑杆时这个标记不会自动清除, 属于"最后应用的预设"语义)。
 * 不重建几何: 环境只影响渲染参数, 树本身与相机都不用动 —— 所以切换是即时的。
 *
 * @param {object} sceneParams state.params.scene (会被原地修改)
 * @param {string} id 预设 id
 * @returns {boolean} 是否找到并应用 (false = id 无效或参数对象缺失)
 */
export function applyEnvironment(sceneParams, id) {
  const env = envById(id)
  if (!env || !sceneParams) return false
  Object.assign(sceneParams, env.scene)
  sceneParams.env = env.id
  return true
}
