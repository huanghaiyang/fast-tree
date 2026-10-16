/**
 * 自动风场: 由种子推导"说得通"的一套风参数
 * ------------------------------------------------------------
 * 量级约定: strength 是"树梢顺风偏移"的米数量级。
 * 默认档位 (k≈0.3) 只有十几厘米 —— 目的是"树叶在动、树干基本不动";
 * 大风档 (k=1) 到 ~0.35m, 需要狂风再往上推。
 * 单独成模块是为了让 species.js 与 presets.js 都能用而不产生循环依赖。
 */
import { makeRng } from './rng.js'

export function autoWind(seed, intensity = 0.5) {
  const rng = makeRng(seed, 'auto-wind')
  const k = Math.max(0, Math.min(1, intensity))
  return {
    enabled: true,
    auto: true,
    intensity: k,
    direction: Math.round(rng.range(0, 360)),
    strength: +(0.03 + k * 0.3 * rng.range(0.75, 1.25)).toFixed(3),
    speed: +(0.45 + k * 0.95 * rng.range(0.85, 1.15)).toFixed(3),
    frequency: +(0.6 + k * 0.9 * rng.range(0.85, 1.15)).toFixed(3),
    gust: +Math.min(1, 0.15 + k * 0.5 * rng.range(0.85, 1.15)).toFixed(3),
    gustSpeed: +(0.06 + k * 0.22 * rng.range(0.8, 1.2)).toFixed(3),
    turbulence: +(0.03 + k * 0.22 * rng.range(0.8, 1.2)).toFixed(3),
    spatialScale: +(0.1 + k * 0.35 * rng.range(0.85, 1.15)).toFixed(3),
    bias: +(0.2 + k * 0.25).toFixed(3),
    flexFalloff: +(1.9 - k * 0.5).toFixed(3),
    barkSway: +(0.4 + k * 0.5).toFixed(3),
    leafFlutter: +(0.25 + k * 0.75 * rng.range(0.85, 1.2)).toFixed(3),
    leafTwist: +(0.15 + k * 0.7 * rng.range(0.85, 1.2)).toFixed(3),
    timeScale: 1.0,
  }
}
