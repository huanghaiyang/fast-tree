/**
 * 叶/花材质光照参数 -> 落物/落花可继承的一组值。
 * 阴影/地表效果器不是 MeshStandardMaterial, 需要把这组值复制进自己的着色器。
 */
export function resolveLeafEffects(params, source = 'leaf', inherit = true) {
  const m = source === 'flower' ? (params.flower || {}) : (params.leafMat || {})
  if (inherit === false) {
    return {
      inherit: 0,
      emissive: 0, emissiveColor: '#ffffff',
      specular: 0, specularShininess: 24, specularColor: '#ffffff',
      scatter: 0, scatterPower: 2,
    }
  }
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
