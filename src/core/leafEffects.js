/**
 * 叶片/花朵材质光照参数的「继承投影器」
 * ------------------------------------------------------------
 * 作用: 把 state.params 里属于叶片材质 (leafMat) 或花朵材质 (flower) 的那一组
 *       光照参数, 归一化成一份**下游可直接消费的扁平对象**。
 * 输入: params —— 全量参数 (来自 treeStore, 见 state.params)
 *       source —— 'leaf' | 'flower', 决定从 params.leafMat 还是 params.flower 取源
 *       inherit —— 是否继承; 传 false 时输出「全关」的一组中性值
 * 输出: { inherit, emissive, emissiveColor, specular, specularShininess,
 *         specularColor, scatter, scatterPower }
 * 与其他模块的关系:
 *       叶/花本体用 MeshStandardMaterial, 这些参数由 sceneManager 直接映射到
 *       emissive / roughness 等标准通道; 但**掉落物 (fallingLeaves.js 的落叶、
 *       litter.js 的地面落叶堆积) 用的是自己手写的 ShaderMaterial**, 不会自动
 *       继承主材质的光照, 所以必须由本模块把这组值显式复制进它们的 uniform。
 * 关键约定:
 *       - 颜色一律是 CSS 十六进制字符串 (如 '#ffffff'), 由消费方自行 new THREE.Color
 *       - 数值范围按 UI 定义: emissive/specular/scatter 是 0..1 的强度,
 *         specularShininess 是「高光指数」(越大越锐, 不是 0..1),
 *         scatterPower 是「边缘散射的菲涅尔指数」(越大边缘越窄)
 * 注意: inherit=false 的分支不是「取默认值」, 而是「明确宣告不继承」(inherit:0),
 *       下游着色器看到 inherit=0 会整段跳过光照叠加, 所以这里返回的值只起占位作用。
 */

/**
 * 解析叶/花材质的可继承光照参数。
 *
 * 为什么需要它: 阴影接收体/地表落叶效果器不是 MeshStandardMaterial, 需要把这组值
 * 复制进自己的着色器; 本函数是唯一取值口径, 避免散落处各自读 params 导致不一致。
 *
 * @param {object} params 全量参数对象 (state.params)
 * @param {string} [source='leaf'] 'leaf' 取 params.leafMat; 'flower' 取 params.flower
 * @param {boolean} [inherit=true] 是否继承; 显式传 false 时返回全关值
 * @returns {{inherit:number, emissive:number, emissiveColor:string, specular:number,
 *            specularShininess:number, specularColor:string, scatter:number,
 *            scatterPower:number}} 扁平化的光照参数 (颜色为 CSS 十六进制字符串)
 */
export function resolveLeafEffects(params, source = 'leaf', inherit = true) {
  // 源对象可能不存在 (例如花朵参数还没初始化), 统一退化成空对象 -> 下面全部走默认值
  const m = source === 'flower' ? (params.flower || {}) : (params.leafMat || {})
  if (inherit === false) {
    // 不继承: 输出一组「零影响」值。inherit:0 是给着色器的硬开关,
    // 后面的数值只是占位, 保证消费方拿到的字段结构永远一致 (不必再判空)。
    return {
      inherit: 0,
      emissive: 0, emissiveColor: '#ffffff',
      specular: 0, specularShininess: 24, specularColor: '#ffffff',
      scatter: 0, scatterPower: 2,
    }
  }
  // 继承: 逐字段取值。
  // 注意这里用的是 `=== undefined` 而不是 `||` —— 0 是合法值 (表示「关掉」),
  // 用 `||` 会把用户明确设成 0 的参数悄悄替换成默认值。
  // specularShininess 默认 24、scatterPower 默认 2, 与 UI 滑块的出厂位置一致。
  return {
    inherit: 1,
    emissive: m.emissive === undefined ? 0 : m.emissive,
    emissiveColor: m.emissiveColor || '#ffffff',
    specular: m.specular === undefined ? 0 : m.specular,
    specularShininess: m.specularShininess === undefined ? 24 : m.specularShininess,
    specularColor: m.specularColor || '#ffffff',
    scatter: m.scatter === undefined ? 0 : m.scatter,
    scatterPower: m.scatterPower === undefined ? 2 : m.scatterPower,
  }
}
