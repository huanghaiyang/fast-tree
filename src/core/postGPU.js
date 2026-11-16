/**
 * Node 渲染路径的后处理 (Bloom 泛光 + DOF 景深)
 * ------------------------------------------------------------
 * 为什么需要这个文件:
 *   `sceneManager._ensureComposer()` 用的是 EffectComposer / UnrealBloomPass / BokehPass,
 *   它们全都是 WebGL 专用 (内部是 ShaderMaterial + readRenderTargetPixels 风格的 GL pass)。
 *   在 WebGPU / WebGL 2 (Node) 路径下既不能创建也不能渲染, 于是之前干脆跳过,
 *   面板上直接提示"WebGPU 暂不支持 Bloom / DOF"。
 *   three 的 Node 渲染链有自己的后处理设施 —— 这里就是把同一组 UI 参数接线过去。
 *
 * three r187 的关键事实 (与旧文档写的骨架有出入, 实测后更正):
 *   - `PostProcessing` 在 r183 已改名为 `RenderPipeline`, 继续用旧名会打 deprecation warning;
 *   - `pass(scene, camera)` 来自 `three/tsl`, 内部按 renderer 的 drawing buffer 尺寸自动
 *     setSize（每帧在 updateBefore 里做), 所以**不需要**手工处理 resize;
 *   - `bloom(node, strength, radius, threshold)` 的强度/半径/阈值可以传 UniformNode,
 *     于是拖动滑块只改 `.value`, 不触发管线重编译;
 *   - `dof(node, viewZNode, focusDistance, focalLength, bokehScale)` 的第二个参数是
 *     **viewZ 节点**（不是深度纹理), 用 `scenePass.getViewZNode()` 取;
 *     focalLength 是"焦平面两侧完全失焦所需的距离", bokehScale 是视野归一化的散景半径。
 *
 * 与 WebGL 路径的对应关系（参数语义必须对齐, 否则同一个滑块两种后端观感差太远):
 *   bloomStrength  → BloomNode.strength      (直接透传)
 *   bloomRadius    → BloomNode.radius        (直接透传, 0..1)
 *   bloomThreshold → BloomNode.threshold     (直接透传, 0..1)
 *   dofFocus       → focusDistance           (米, 沿相机视线方向)
 *   dofAperture    → focalLength             (见 dofMapping: maxblur/aperture, 米)
 *   dofMaxBlur     → bokehScale              (见 dofMapping: maxblur × 画面高, 像素)
 *
 * 关闭 Bloom/DOF 时**不走**这条管线, 回到 renderer.render(scene, camera) 直出 ——
 * 保证"关掉后处理和没做后处理"完全同一条路径, 不多付一次全屏 quad。
 */

import { RenderPipeline } from 'three/webgpu'
import { pass, uniform } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { Vector2 } from 'three'

/**
 * 把 UI 的 `dofAperture / dofMaxBlur` 换算成 DOF 节点的 `focalLength / bokehScale`。
 *
 * 两个后端的散景公式 (都是线性 CoC, 只差单位):
 *   WebGL  BokehShader: `dofblur = clamp((focus + viewZ) * aperture, ±maxblur)`  —— 单位是 **UV**;
 *   Node   DepthOfFieldNode: `CoC = smoothstep(0, focalLength, |viewZ + focus|)`,
 *                           `sampleStep = invSize * bokehScale * CoC`           —— bokehScale 单位是 **像素**。
 * 所以等价映射是"按几何关系反推", 不是拍脑袋的系数:
 *   ① 到达最大模糊所需的距离 = maxblur / aperture  ->  focalLength(米);
 *   ② 最大模糊半径的 UV 值 = maxblur  ->  bokehScale = maxblur × 画面高(px)。
 * 早先用过 `1.2e-4/aperture` 这种反比启发式: 阈值全错, aperture=1e-4 时 focalLength 只有 1.2 米,
 * 整棵树都落在"完全失焦"区, 画面糊成一团 —— 而 WebGL 同参数下几乎看不出变化。
 *
 * @param {number} aperture UI 光圈 (0 ~ 2e-4; 越大越浅景深)
 * @param {number} maxblur UI 最大虚化 (归一化的画面高度比例, 0 ~ 0.03)
 * @param {number} viewportHeight 当前 drawing buffer 高度 (px)
 * @returns {{focalLength:number, bokehScale:number}}
 */
export function dofMapping(aperture, maxblur, viewportHeight) {
  const a = Math.max(0, Number(aperture) || 0)
  const mb = Math.max(0, Number(maxblur) || 0)
  const h = Math.max(1, Number(viewportHeight) || 1)
  // aperture = 0 表示"不要景深": 给一个远超场景尺度的焦深, CoC 恒为 0
  const focalLength = a > 0 ? mb / a : 1e4
  // bokehScale 下限 0.5 防止"打开了但完全没有虚化"看不出差别; 上限 40 防止极端参数下采样半径爆掉
  const bokehScale = Math.min(40, Math.max(0.5, mb * h))
  return { focalLength: Math.max(0.2, focalLength), bokehScale }
}

/**
 * Node 后处理管线。
 *
 * 生命周期: 一个 TreeScene 一个实例; 第一次真正需要后处理时才创建 RenderPipeline
 * (创建会带一组 RT, 对"只看结构"的用户是纯开销)。场景/相机变化时重建。
 */
export class GpuPostFX {
  /**
   * @param {import('three/webgpu').WebGPURenderer} renderer Node 渲染器
   */
  constructor(renderer) {
    this.renderer = renderer
    this.pipeline = null
    this.scenePass = null
    this.scene = null
    this.camera = null
    // 'none' | 'bloom' | 'dof' | 'both' —— 只有这个键变化时才重建输出节点
    this.chainKey = ''
    this.bloomNode = null
    this.dofNode = null

    /* ---- 参数 uniform: 都是节点, 每帧只改 value, 不重建节点图 ---- */
    this._size = new Vector2()
    this.uStrength = uniform(0.55)
    this.uRadius = uniform(0.4)
    this.uThreshold = uniform(0.82)
    this.uFocus = uniform(12)
    this.uFocal = uniform(4)
    this.uBokeh = uniform(4.8)
  }

  /** 后处理是否真正生效 (false 时调用方必须走直出渲染)。 */
  get active() {
    return this.chainKey !== 'none' && !!this.pipeline
  }

  /**
   * 每帧入口。内部按需懒建管线、按需重建输出节点。
   *
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {Object} post sceneManager 的 _post 参数表
   * @returns {boolean} true = 本次已经由后处理管线画完, 调用方不要再 renderer.render()
   */
  render(scene, camera, post) {
    const p = post || {}
    const bloomOn = !!p.bloomEnabled
    const dofOn = !!p.dofEnabled
    const key = bloomOn && dofOn ? 'both' : bloomOn ? 'bloom' : dofOn ? 'dof' : 'none'
    if (key === 'none') {
      // 关掉后处理: 释放链但保留 pipeline/scenePass (下次开启不用再分配 RT)
      if (this.chainKey !== 'none') this._rebuildChain('none')
      return false
    }
    if (!this.pipeline || this.scene !== scene || this.camera !== camera) {
      this._build(scene, camera)
    }
    // 参数同步 (滑块拖动时每帧都会走到, 只是几次赋值)
    this.uStrength.value = p.bloomStrength === undefined ? 0.55 : p.bloomStrength
    this.uRadius.value = p.bloomRadius === undefined ? 0.4 : p.bloomRadius
    this.uThreshold.value = p.bloomThreshold === undefined ? 0.82 : p.bloomThreshold
    this.uFocus.value = Math.max(0.1, p.dofFocus === undefined ? 12 : p.dofFocus)
    // DOF 的 bokehScale 单位是像素 -> 需要当前画面高度 (复用同一个 Vector2, 避免每帧分配)
    this.renderer.getDrawingBufferSize(this._size)
    const m = dofMapping(p.dofAperture, p.dofMaxBlur, this._size.y)
    this.uFocal.value = m.focalLength
    this.uBokeh.value = m.bokehScale
    if (key !== this.chainKey) this._rebuildChain(key)
    this.pipeline.render()
    return true
  }

  /**
   * 建 RenderPipeline + scenePass。scene/camera 变了会先释放旧资源。
   * @private
   */
  _build(scene, camera) {
    this.dispose()
    this.scene = scene
    this.camera = camera
    this.pipeline = new RenderPipeline(this.renderer)
    this.scenePass = pass(scene, camera)
    this.chainKey = ''
    this._rebuildChain('none')
  }

  /**
   * 重建输出节点链 (只在开关组合变化时调用)。
   *
   * 顺序与 WebGL 的 composer 一致: **先 DOF 后 Bloom**。
   * 反过来(先泛光再虚化)会把泛光的边缘也虚掉, 高光不"渗"出来, 观感偏闷。
   *
   * @param {'none'|'bloom'|'dof'|'both'} key
   * @private
   */
  _rebuildChain(key) {
    this._disposeChain()
    this.chainKey = key
    if (!this.pipeline || key === 'none') {
      if (this.pipeline) {
        // 空 pass 会让管线全屏画一遍黑图, 所以回到一个"什么都不做"的直出节点。
        // 注意这里不 dispose pipeline: 关掉再打开要能秒回。
        this.pipeline.outputNode = this.scenePass.getTextureNode('output')
        this.pipeline.needsUpdate = true
      }
      return
    }
    const color = this.scenePass.getTextureNode('output')
    let out = color
    if (key === 'dof' || key === 'both') {
      this.dofNode = dof(color, this.scenePass.getViewZNode(), this.uFocus, this.uFocal, this.uBokeh)
      out = this.dofNode
    }
    if (key === 'bloom' || key === 'both') {
      // 泛光输入取"已经虚化过的画面": 与 composer 里 Bokeh -> Bloom 的顺序对齐。
      this.bloomNode = bloom(out, this.uStrength, this.uRadius, this.uThreshold)
      out = out.add(this.bloomNode)
    }
    this.pipeline.outputNode = out
    // outputNode 变了必须显式置位, RenderPipeline 不会自动发现
    this.pipeline.needsUpdate = true
  }

  /** @private 释放 bloom/dof 节点自带的 RT 与材质 */
  _disposeChain() {
    if (this.bloomNode) {
      this.bloomNode.dispose()
      this.bloomNode = null
    }
    if (this.dofNode) {
      this.dofNode.dispose()
      this.dofNode = null
    }
  }

  /** 释放全部 GPU 资源 (TreeScene.dispose 调用)。 */
  dispose() {
    this._disposeChain()
    if (this.scenePass && this.scenePass.renderTarget) this.scenePass.renderTarget.dispose()
    if (this.pipeline) this.pipeline.dispose()
    this.scenePass = null
    this.pipeline = null
    this.scene = null
    this.camera = null
    this.chainKey = ''
  }
}
