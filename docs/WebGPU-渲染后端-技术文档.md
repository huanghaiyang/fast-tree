# FastTree WebGPU 渲染后端 · 技术文档

> 范围：three r187 升级、WebGPU 默认渲染、WebGL 自动回退，以及 Node/TSL 路径与经典路径的**能力对齐记录**
> （原"待补齐项"已全部落地；第 4 节按"原计划 → 实际实现"记录，并写明那些被实测推翻的旧结论 ——
> `PostProcessing` 已改名、`dof()` 第二个参数是 viewZ 节点、`castShadowPositionNode` 根本不需要）。
> 相关代码：`src/core/rendererBackend.js`、`src/core/materialsGPU.js`、`src/core/postGPU.js`、`src/core/sceneManager.js`、
> `src/core/particles.js`、`src/core/fallingLeaves.js`、`src/core/litter.js`、`src/core/impostor.js`、
> `src/components/Viewport.vue`、`src/core/exportSplit.js`、
> `dev/renderer-backend-check.html`（WebGPU vs 经典 WebGL 对照）、`dev/node-webgl2-check.html`（WebGL 2 (Node) 分支）。
> 适用版本：`three@0.187.0`、Vue 3.5。

---

## 摘要

渲染后端从"固定 WebGLRenderer"改成**双轨制**：

1. 默认 `auto`：先创建 `WebGPURenderer` 并 `await init()`；成功即走 WebGPU（底层不支持时 three 会自动落到 WebGL 2 后端，仍是 Node 渲染路径）。
2. WebGPU 创建/初始化失败：自动回退经典 `WebGLRenderer`，功能与改造前完全一致。
3. 材质体系按渲染路径二选一：
   - **Node 路径**（WebGPU / WebGL 2 Node）：`materialsGPU.js` 的 `MeshStandardNodeMaterial` + TSL；
   - **经典路径**（WebGL）：`materials.js` 的 PBR + `onBeforeCompile` 注入。

切换入口：左下角悬浮控件「引擎」（`auto | WebGPU | WebGL`，右侧徽标显示**实际**后端），
以及 `场景 → 渲染引擎` 下拉。两者共用 `sceneApi.switchBackend()`，**热切换**：
重建场景、保留当前视角与全部参数，不需要刷新页面（实现细节见 3.1）。

---

## 1. 三个容易混淆的概念

| 名称 | 含义 | 代码判定 |
| --- | --- | --- |
| `isNodeRenderer` | 是否是 `WebGPURenderer` 实例 → 决定**材质体系**（NodeMaterial/TSL） | `createRenderer()` 返回 |
| `isWebGPU` | 底层是否真的跑在 WebGPU 上 → 决定**能力提示**（读回/后处理） | `renderer.backend.isWebGPUBackend` |
| `backendName` | 面板/状态栏显示的名字 | `WebGPU` / `WebGL 2 (Node)` / `WebGL` |

注意：`WebGL 2 (Node)` 不是经典 WebGL —— 它仍然是 WebGPURenderer，只是底层用 WebGL 2 执行，
**同样不能使用 `ShaderMaterial` / `onBeforeCompile` / `EffectComposer`**。

---

## 2. 架构与代码地图

### 2.1 渲染器工厂 `src/core/rendererBackend.js`

```
createRenderer({ mode })                     mode: 'auto' | 'webgpu' | 'webgl'
   ├─ mode !== 'webgl'
   │    ├─ 动态 import('three/webgpu')        ← Vite 单独切块, WebGL 用户不下载
   │    ├─ new WebGPURenderer({...})
   │    ├─ await renderer.init()
   │    ├─ isWebGPU = renderer.backend.isWebGPUBackend
   │    └─ return { renderer, isNodeRenderer: true, isWebGPU, backendName }
   │         └─ 失败 → catch → console.warn → 继续往下
   └─ new THREE.WebGLRenderer({ preserveDrawingBuffer: true, ... })
        └─ return { renderer, isNodeRenderer: false, isWebGPU: false, backendName: 'WebGL' }
```

`applyRendererSettings()` 同时服务两种渲染器，保证换后端只换"怎么画"、不换"画出来是什么颜色"：

- `setPixelRatio(min(devicePixelRatio, 2))`
- `outputColorSpace = SRGBColorSpace`
- `toneMapping = ACESFilmicToneMapping`、`toneMappingExposure = 1.18`
- `shadowMap.enabled = true`、`shadowMap.type = PCFShadowMap`

### 2.2 材质双轨 `src/core/materialsGPU.js`

Node 材质**复用经典材质作为参数与贴图来源**，避免两套参数解释逻辑漂移：

```
createBarkMaterialGPU(params, shared)
   ├─ legacy = createBarkMaterial(params, shared)      // materials.js
   ├─ mat = new MeshStandardNodeMaterial()
   ├─ mat.userData.legacy = legacy                     // 贴图 / uniforms / 更新逻辑的来源
   └─ mat.userData.uniforms = legacy.userData.uniforms

每帧: syncGpuUniforms(mats, shared)
   └─ 把共享 uniform（时间/风场/生长/选中）与材质私有 uniform、
      mapMatrix（来自 legacy.map.matrix）拷进 TSL uniform 节点
```

TSL 复刻的着色内容：

- 顶点：生长收缩（`aOrigin` / `aGrow`）、风场主波/次波/阵风/湍流、叶片 Rodrigues 铰链旋转、叶片朝向；
- 片元：贴图 × 顶点色 × tint、正/背面颜色与贴图切换、苔藓双频噪声、附生层（`aEpiphyte`）、
  节点选中 8 段区间判定、选中辉光、叶片透光 / Blinn-Phong 反光 / 散光；
- `maskNode = 选中区间命中 or selectMode < 1.5`，实现"仅显示选中"的 `discard`。

天空穹顶在 Node 路径改用 `MeshBasicNodeMaterial`（`createSkyMaterialGPU`），
`sceneManager` 统一通过 `skyMat.userData.uniforms || skyMat.uniforms` 取 uTop/uBottom。

### 2.3 `sceneManager.js` 的分支点

| 关注点 | 经典 WebGL | Node 路径 |
| --- | --- | --- |
| 材质创建 | `materials.js` | `gpuMaterials.create*MaterialGPU` |
| 材质更新 | `updateMaterials` | `updateMaterialsGPU`（内部仍先更新 legacy） |
| 每帧 uniform | 不需要 | `syncGpuUniforms` |
| 天空 | `ShaderMaterial`（`SKY_VERT/SKY_FRAG`） | `createSkyMaterialGPU` |
| 后处理 | `EffectComposer` + Bokeh/Bloom + OutputPass | `postGPU.js` 的 `RenderPipeline` + `bloom()` + `dof()` |
| 阴影刷新 | 动态阴影每帧 / 静态按需 | 相同：`shadowMap.autoUpdate`（阴影像素跟随主材质 `positionNode`） |
| 季节特效 | 粒子 / 落叶 / 落花 / 堆积（`ShaderMaterial`） | `create*MaterialGPU`（TSL 版，网格结构与 legacy 同构） |
| 伪装卡 | 离屏渲染 + `readRenderTargetPixels` | 同一套离屏渲染 + `readRenderTargetPixelsAsync`；预览面片走 `MeshBasicNodeMaterial` |
| 自定义 GLSL | `onBeforeCompile` | `onShaderError` 提示一次后跳过（仅 WebGL 能力） |
| 导出 | 直接使用当前材质 | `buildExportGroup` 使用临时经典材质 |
| 截图 / PNG | `canvas.toDataURL/toBlob` | 渲染到 RT → 异步读回 → 临时 canvas 编码 |

### 2.4 几何准备：顶点属性交错打包

**根因**：WebGPU 的 `maxVertexBuffers = 8`，而 three 的 WebGPU 后端按"每个 `BufferAttribute` 一个 vertex buffer"布局。
树几何原本有 9–10 个属性（position / normal / uv / color / aWind / aPhase / aOrigin / aGrow / aNodeId / aEpiphyte），
管线创建直接失败：

```
Vertex buffer count (9) exceeds the maximum number of vertex buffers (8).
```

**解决**：`interleaveGpuAttributes(geometry)` 把 6 个自定义属性合并进一个 `InterleavedBuffer`：

| 属性 | 分量 |
| --- | --- |
| `aWind` | 1 |
| `aPhase` | 1 |
| `aOrigin` | 3 |
| `aGrow` | 2 |
| `aNodeId` | 1 |
| `aEpiphyte` | 1 |

- stride = 9 floats；缺失属性按 0 补齐（例如花朵几何没有 `aEpiphyte`）。
- 剩余 buffer：position / normal / uv / color / interleaved = **5 个**。
- 调用点：`build()` 与 `_ensureLod()` 里 `buildTree()` 之后（`_interleaveForGpu`）。
  渲染分块与 LOD 共享同一份源几何属性对象，因此只需处理一次。

**连带修复**：`exportSplit.js` 增加 `attrView()`，同时兼容 `BufferAttribute` 与
`InterleavedBufferAttribute`（后者没有 `.array`），并用 `stride/offset` 读取；重建时统一落回 `Float32Array`。

---

## 3. 当前能力矩阵

| 功能 | 经典 WebGL | Node 路径（WebGPU / WebGL 2 Node） |
| --- | --- | --- |
| 树皮 / 树叶 / 花朵 PBR + 贴图 | ✅ | ✅（TSL 复刻） |
| 风场 / 生长 / 叶片动力学 | ✅ | ✅ |
| 苔藓 / 附生层 / 双面叶片 | ✅ | ✅ |
| 节点选中高亮 / 隔离 / 变暗 | ✅ | ✅（`maskNode`） |
| 视锥分块 / 动态 LOD | ✅ | ✅ |
| 天空渐变 / 环境预设 / 星空 | ✅ | ✅ |
| 静态阴影 | ✅ | ✅ |
| 动态风场阴影 | ✅（`customDepthMaterial`） | ✅（阴影深度材质自动继承主材质 `positionNode`） |
| Bloom / DOF | ✅（`EffectComposer`） | ✅（`RenderPipeline` + TSL `bloom/dof`） |
| 落叶 / 落花 / 叶片粒子 / 堆积 | ✅（`ShaderMaterial`） | ✅（`MeshBasicNodeMaterial`，几何同构） |
| 自定义 GLSL | ✅ | ❌ 提示后跳过（产品能力边界，保留） |
| 伪装卡生成 / 预览 | ✅ | ✅（异步读回 + Node 版预览面片） |
| GLB / OBJ / JSON / PNG 导出 | ✅ | ✅（导出用临时经典材质；PNG 走 RT 读回） |

**唯一保留的差异**：自定义 GLSL（`onBeforeCompile` 在 Node 路径没有对应物，需要另行设计受控 TSL 入口）。
另有一处观感差异是叶片粒子的尺寸表达（见 4.2），不影响功能。

### 3.1 前端渲染引擎切换（热切换，✅ 已落地）

**控件位置**

- 视口左下角悬浮条：`引擎 [自动 ▾] ` + 实际后端徽标（`WebGPU` / `WebGL 2 (Node)` / `WebGL`，切换中显示"切换中…"）；
- 左侧面板 `场景 → 渲染引擎` 下拉（同一个入口）；
- 两处都通过 `state.params.scene.renderer`（意图）+ `state.renderBackend`（实际）两个值表达状态。

**为什么不放在顶栏**：顶栏在 ≈1150px 宽时已经排满（最后一个"暂停"徽标都被挤出右边界），
再塞一个控件它自己就会跑到屏幕外 —— 这是先放进顶栏、真机截图后才发现的。
右上角也被"播放生长 / 风向罗盘 / XYZ 指示器"占用，所以落在左下角、压在操作提示上方。

**为什么是"重建"而不是"原地换"**：两条路径的材质体系不同（NodeMaterial/TSL vs PBR + `onBeforeCompile`），
后处理管线、阴影深度材质、粒子材质都绑在 renderer 上，渲染器本身也没有"换类型"的 API。
于是 `switchBackend(mode)` 的顺序是：

```
保存相机位姿 (camera.position + controls.target)
  -> scene.dispose()          // 连 renderer 与 canvas 一起销毁
  -> mountScene({pose})       // 用同一条初始化路径建新后端
       -> createRenderer(mode) -> new TreeScene(...) -> 重新灌 state -> build(frameCamera:false)
  -> 还原位姿 + controls.update()
```

要点与坑：

- **视角必须还原**：`build()` 默认会 `frameCamera()`，直接重建会把用户摆好的机位冲掉；
  热切换走 `frameCamera: false` + 还原 `position/target`。实测切换前后位姿完全一致
  （`19.695, 8.816, 24.777` / target `0, 6.011, 0`）；
- **同一棵树**：几何只由参数与种子决定，换后端后 `tris/leaves/nodes` 完全不变
  （实测 `202736 / 11520 / 1508` 三次切换都一样）；
- **后处理/特效必须跟着重建**：切到经典 WebGL 后 `_postFX` 变 `null`、`_composer` 就位、
  特效材质 `MeshBasicNodeMaterial` -> `ShaderMaterial`、`particleVerts 960 -> 240`；切回来再反转。
  如果忘了这一步，会留下"另一个后端创建的 pipeline"，表现为后处理开关失灵或直接报错；
- **engineSwitching 互斥**：切换中禁用下拉并挂 `state.busy`，避免连点导致两个 renderer 同时初始化；
- **持久化**：引擎是"环境偏好"，写 `localStorage['fasttree.renderer']`，URL 没带 `?renderer=` 时启动读它 ——
  否则每次刷新都会悄悄回到 `auto`。手动切换后会清掉 URL 上的 `?renderer=`（那是给探针页固定后端用的，
  留着会让刷新又跳回旧后端）；
- **`drawAxes()` 等 rAF 循环**要能容忍 `scene` 为 null（切换窗口期），现有实现已做判空。

**已知代价**：一次切换 = 一次完整建树（默认参数约 0.5~0.8 s，含 `createRenderer` 的 `await init()`），
期间显示"切换渲染引擎中…"遮罩。不切换后端时没有任何额外开销。

---

## 4. 补齐项：原计划 → 实际实现

原计划里的 P1/P2 已全部落地，但**调研阶段写下的骨架有四处与 r187 实际 API 不符**，下面按"实际实现"记录，
并保留原来的坑点，避免下次照着旧骨架返工。

### 4.1 TSL 后处理：Bloom + DOF（✅ 已完成）

**落点**：新增 `src/core/postGPU.js`（`GpuPostFX` 类 + 参数映射 `dofMapping()`），
接线在 `sceneManager._renderFrame()` 与 `_ensureGpuPost()`。

**对旧骨架的四处更正**：

| 旧骨架写法 | r187 实际情况 |
| --- | --- |
| `new PostProcessing(renderer)` | 改名 `RenderPipeline`（`PostProcessing` 只是废弃包装，会打 deprecation warning） |
| `dof(out, depth, ...)` 传深度纹理 | 第二个参数是 **viewZ 节点**：`scenePass.getViewZNode()` |
| resize 时 `post.setSize(w,h)` | `RenderPipeline` 没有 `setSize`；`PassNode` 每帧按 renderer 的 drawing buffer 自动 setSize |
| `dof(out, ..., focus, aperture, maxBlur)` 直接透传 | 两个后端的参数语义不同，必须换算（见下表） |

**参数映射（UI 一套语义 → 两条后端各自实现）**：

| UI 参数 | WebGL（`UnrealBloomPass` / `BokehShader`） | Node（`BloomNode` / `DepthOfFieldNode`） |
| --- | --- | --- |
| `bloomStrength` | `strength` | `BloomNode.strength`（直接透传） |
| `bloomRadius` | `radius` | `BloomNode.radius`（直接透传，0..1） |
| `bloomThreshold` | `threshold` | `BloomNode.threshold`（直接透传） |
| `dofFocus` | `focus`（米） | `focusDistance`（米，直接透传） |
| `dofAperture` | `aperture`（乘在米制深度差上） | `focalLength`（米）= `dofMaxBlur / dofAperture` |
| `dofMaxBlur` | `maxblur`（UV 半径，即画面高度比例） | `bokehScale`（像素半径）= `dofMaxBlur × 画面高(px)` |

DOF 的换算是**按公式反推**出来的，不是凑系数（`postGPU.js` 的 `dofMapping()`）：

```
WebGL  BokehShader : dofblur(UV) = clamp((focus + viewZ) * aperture, ±maxblur)
Node   DOF node    : CoC = smoothstep(0, focalLength, |viewZ + focus|)
                     sampleStep(UV) = invSize * bokehScale * CoC
=> 到达"完全失焦"的距离 focalLength = maxblur / aperture
   最大模糊半径的 UV 值    bokehScale = maxblur * 画面高(px)
```

默认参数（`dofAperture=2e-5`、`dofMaxBlur=0.008`）算出 `focalLength=400m`、`bokehScale≈10.5px`：
焦深远超场景尺度 ⇒ 几乎不虚化，和 WebGL 同参数下的表现一致。
早期版本用过 `1.2e-4/aperture` 的反比启发式（`1e-4 → 1.2m`），实测**整棵树都被判成完全失焦**，
画面糊成一团而 WebGL 几乎无变化 —— 这是运行时对比才暴露出来的，纯看代码看不出来。

**实现要点**：

- 顺序与 composer 一致：**先 DOF 后 Bloom**（先泛光再虚化会把高光边缘一起糊掉）；
- 强度/半径/阈值/对焦都是 `uniform()` 节点，拖滑块只改 `.value`，不重建节点图、不触发重编译；
- 只有**开关组合**变化（`none/bloom/dof/both`）才重建 `outputNode` 并置 `pipeline.needsUpdate = true`；
- 关掉 Bloom+DOF 时直接 `renderer.render(scene, camera)` 直出，不留空 pass；
- `postGPU.js` 在 `_ensureGpuPost()` 里**动态 import**，WebGL 用户不会下载这个块（Vite 已切出 `postGPU-*.js`，约 16 kB）。

**已知代价 / 已知差异**：

- 首次开启（或开关组合切换）会编译一遍全屏 quad 着色器，可能有一帧卡顿；面板提示已写明；
- 同一组 UI 值下，Node 的泛光**略弱于** WebGL（`strength=0.9 / threshold=0.35` 实测亮像素占比 22% vs 32%）。
  两者不是同一个实现（`UnrealBloomPass` 5 级 mip 加权 + 自定义 interleaved 采样，`BloomNode` 固定权重 1.0/0.8/0.6/0.4/0.2），
  这里选择**保持 1:1 透传**而不是加一个魔法系数：UI 的"强度/半径/阈值"在两条后端含义相同，
  需要更亮就把滑块推高，而不是让同一个数字背后藏着不同的换算。

### 4.2 季节特效 NodeMaterial 化（✅ 已完成）

**落点**：`materialsGPU.js` 新增三个工厂
`createParticleMaterialGPU` / `createFallingLeavesMaterialGPU` / `createLitterMaterialGPU`，
以及 `syncEffectGpuUniforms()`；三个构建器各开一个 `materialFactory` 钩子。

**为什么不是"照抄顶点着色器"**：

- **几何完全复用**：`buildParticlePoints/Billboards`、`buildFallingLeaves`、`buildLeafLitter` 仍然负责
  采样出生点、生成 `aSeed/aLeafSeed`/uv/顶点色/法线。Node 版只换材质，**不重算任何顶点数据**，
  所以同一 `seed` 下两条后端的粒子/落叶分布逐字节一致；
- **uniform 键名对齐**：NodeMaterial 没有 `.uniforms`，参数放 `userData.uniforms`，但键名仍是
  `uSize/uSpeed/uFall/uSwirl/...`。三个 update 函数因此只需把取值改成
  `mesh.material.uniforms || mesh.material.userData.uniforms`，业务逻辑一行没改；
- **共享风场每帧同步**：`syncEffectGpuUniforms(this._gpuEffectMats, shared)` 在 `_renderFrame` 里调用，
  `_refreshEffectMaterials()` 每帧 O(5) 现算材质表（rebuild 会替换材质，缓存引用会指向已 dispose 的对象）。

**唯一必须改结构的地方：叶片粒子**

WGSL 没有 `gl_PointSize`，WebGPU 的 point primitive 恒为 1 像素；three 的 WebGL2(Node) 后端
也把 `gl_PointSize = 1.0` 写死（见 `three.webgpu.js` 的 `_getGLSLVertexCode`）。所以
**Node 路径下 `THREE.Points` 画出来只是一堆看不见的单像素点**。

实现改成"面向相机的小四边形"（`buildParticleBillboards`，每粒子 4 顶点 + 索引），顶点里：

```
halfSize = uSize * uGlow * 600 * tan(fov/2) / viewportSize.y
```
把 WebGL 的"像素尺寸"折回"世界单位"（推导里相机距离上下抵消，只剩常数项；
`tan(45°/2)=0.4142` 是按 TreeScene 固定 fov=45 写死的），于是缩放窗口时粒子占比与 WebGL 一致。
`updateParticles()` 里判断粒子数的分母也相应改成"Points 用 1、四边形用 4"。

**另一个坑：贴图不能放进 uniform**

`texture()` / `sampleTexture()` 需要一个真实的 `THREE.Texture`（内部要读 `uuid`、filter、colorSpace），
塞 `uniform(tex)` 会在绑定阶段炸掉。所以落叶/堆积的 `uMap` 直接给 `sampleTexture(map, uv())`，
贴图变化依赖 `fallRebuildKey` / `litterRebuildKey` 重建材质（与 legacy 的"贴图变更即重建"策略一致）。

### 4.3 动态风场阴影（✅ 已完成，且比原计划更简单）

原计划要挂 `material.castShadowPositionNode = 同一套风场节点图`。**实际不需要**：

`Renderer._getShadowNodes()` 在为主材质生成阴影深度材质时，会依次继承
`castShadowNode / maskShadowNode / colorNode / **positionNode** / castShadowPositionNode`，
并把 `material.alphaTest` 一起带过去（`overrideMaterial._alphaTest = material.alphaTest`）。
也就是说 Node 材质的风场 `positionNode` **本来就参与阴影 pass**，树叶 alpha 裁剪也在。

因此改动只有两处：

- `applyShadowFlags()`：Node 路径**不再**设置 `customDepthMaterial`（设了反而会丢掉风场位移），
  WebGL 路径保持原样（`createTreeDepthMaterial`）；
- `updateScene()`：`shadowMap.autoUpdate = shadowsEnabled && dynamicShadows`
  —— 两条后端统一，不再对 Node 强制 false。

`applyShadowFlags` 里"静态阴影只在标志变化时 `needsUpdate=true`"的策略保留（关掉动态阴影后
只在参数/几何变化时重算一次）。

**性能提示**：开动态阴影 = 每帧多跑一遍全树的深度绘制。这个开销在两条后端都存在，
面板的「动态阴影」开关就是给这个用的，建议在低端机默认关闭（产品层决定，代码层已支持）。

### 4.4 伪装卡 / 截图：异步读回（✅ 已完成）

**伪装卡**（`impostor.js` + `sceneManager`）：

- `renderView()` 改成 `async`，三条读回分支（都实测过）：
  1. 经典 WebGL + `readRenderTargetPixelsAsync`（three 也给 WebGLRenderer 提供了异步版）：
     **必须把 `pixels` 当第 6 个参数传进去** —— 它读进调用方的 buffer 再 resolve 同一个 buffer，
     不传就返回 `undefined`，后面取 `.byteLength` 直接炸（运行时实测报
     `Cannot read properties of undefined (reading 'byteLength')`）；
  2. Node/WebGPU：`await readRenderTargetPixelsAsync(rt, 0, 0, size, size)`，返回 TypedArray；
  3. 兜底同步 `readRenderTargetPixels`。
- **行序随后端不同**：`glReadPixels` 自下而上要翻转；WebGPU 的 `copyTextureToBuffer` 返回纹理行序
  （自上而下）**不能翻**。`pixelsToImageData(pixels, w, h, topDown)` 用参数区分；
- `generateImpostor()` → `async`，逐视角 `await`，其余流程（临时灯光/隐藏装饰/曝光恢复/拼图）不变；
- **async 边界一路传递**：`sceneManager.makeImpostor()` → `treeStore.doGenerateImpostor()` →
  `ExportPanel.onImpostor()` 与 `app.impostor`。漏掉任何一层 `await`，`impostorResult` 就会变成
  Promise（预览白屏）或异常无法被 catch；
- 预览面片：WebGL 用手写 `ShaderMaterial`；Node 用 `createImpostorPreviewMaterialGPU()`
  （同一套 `(uv + cell) / grid` 选格公式，`uCell` 是 uniform 节点；Node 侧不需要手动
  tonemapping/colorspace，由输出阶段统一处理）。

**截图 / PNG 导出**：

- `sceneManager._captureFrameDataUrl()`：WebGL 走 `canvas.toDataURL`；Node 走
  "渲染到临时 `WebGLRenderTarget` → `await readRenderTargetPixelsAsync` → 临时 canvas 编码"；
- **不要逐行翻转**：WebGPU 读回已是自上而下，照着 WebGL 习惯翻一次，截图整幅上下颠倒
  （树冠朝下、地面在上，但"看着还挺像一张图"，很容易被当成渲染 bug 去查材质）；
- **临时 RT 的 `colorSpace` 要跟着"谁来编码"走**：直出时编码（ACES + sRGB）由材质按目标纹理声明的
  colorSpace 完成，RT 必须声明 sRGB；走 `RenderPipeline` 时管线固定按 `renderer.outputColorSpace`
  编码、不看目标，此时 RT 必须给**线性**，否则编码两次（天空 `0x2a3c52` 从 42 提到 112 那一档，
  截图"比看到的亮一档"，而画布本身正常）；
- Node 路径的 canvas 后面是交换链，**帧外** `toDataURL`/`drawImage` 很可能拿到空白 ——
  这也是 `app.screenshot` 增加 Node 分支、`dev/renderer-backend-check.html` 的像素统计
  一律走 dataURL 解码而不是直接 `drawImage(canvas)` 的原因；
- `exporter.exportDataURLPNG()`：把 dataURL 直接还原成 Blob 下载（`atob` + `Uint8Array`），
  避免再让 canvas 编码一次；`app.screenshot` 的 Node 分支用 `finishShot()` 解码 → 缩放 → JPEG，
  与 WebGL 分支的 `max/quality` 语义保持一致。

### 4.5 回归入口：后端可固定 + 自检页（✅ 已完成）

- `Viewport.vue` 的 `onMounted` 接受 `?renderer=webgl|webgpu` 覆盖（只认这两个值）。
  原因：参数表每次刷新都回到 `auto`，没有 URL 入口就**没法在两次打开之间锁定后端**，
  "WebGL 回归"永远只能靠手工点选；
- `dev/renderer-backend-check.html`：同一棵树依次跑 `webgpu` 与 `webgl`，每个后端做同一组操作 ——
  基线 → Bloom → Bloom+DOF → 关后处理 → 开粒子/落叶/堆积 → 动态阴影开关 → PNG 截图 → 伪装卡；
  每步记录像素统计、关键对象状态（`_postFX.chainKey`、特效材质 `type`、`shadowMap.autoUpdate`、
  截图解码后的不透明占比、伪装卡覆盖率）、以及 `console.error`/`unhandledrejection`/`state.shaderError`。
  结果写进 `document.title`（沿用 `dev/*-check.html` 的既有约定），截图可选 POST 到 `127.0.0.1:5274`；
- `dev/node-webgl2-check.html`：**第三条路径** `WebGL 2 (Node)` 的独立探针（见 4.6）。
  做法是先在**同一个 document** 里把 `navigator.gpu` 置为 `undefined`（删掉 `Navigator.prototype` 上的
  可配置 getter，再定义实例属性），然后 `await import('/src/main.js')` 正常启动应用 ——
  不需要 iframe，也不需要在产品代码里留"测试开关"。探针只跑一份后端，项目同上（少一个对照）。

**判读方法**：

- `tris / leaves / nodes` 两条后端必须**完全相等**（几何与后端无关）；
- `rgb`（平均色）允许小差异（光栅化/抗锯齿），但主色调差太多就说明有一条后端的材质/色调映射跑偏；
- `lit`（非黑像素占比）两条后端应接近（当前基线 99.95 / 99.70）—— 这个指标最敏感，
  天空/背景的编码问题会立刻把它拉开（修 WebGL 天空之前是 99.96 vs **53.55**）；
- Node 侧 `particleMat/fallMat/litterMat` 应为 `MeshBasicNodeMaterial`，WebGL 侧应为 `ShaderMaterial`；
  Node 的 `particleVerts` 是 WebGL 的 4 倍（四边形 billboard，见 4.2）；
- 任何 `CERR` / `SHADER` / `GPUValidationError` 都算失败。

**`calls` 不做相等断言**：两条后端的 `renderer.info.render` 口径不同
（WebGL 会把阴影 pass 一起算，WebGPU 的 `info.render` 只统计部分 pass；同一场景实测 7 vs 171）。
它是"两条后端各跑各的"，不是能力差异，硬比只会得到一个假的失败。

### 4.6 运行时实测记录（2026-11-16，WebGPU + WebGL 双后端）

`dev/renderer-backend-check.html` 在真实浏览器里跑完整轮，**六个只有运行时才会暴露的问题**被修掉
（前五个来自 WebGPU vs 经典 WebGL 对照，第六个来自本节末尾的 `WebGL 2 (Node)` 探针）：

| 现象（实测） | 根因 | 修法 |
| --- | --- | --- |
| WebGPU 截图/伪装卡整幅**上下颠倒** | 照 GL 习惯做了逐行翻转，而 WebGPU 读回已是自上而下 | `_captureFrameDataUrl` 不翻转；`pixelsToImageData(..., topDown)` |
| 开 Bloom 后整幅**亮一档**（截图上亮，画布上正常） | 临时 RT 声明 sRGB，`RenderPipeline` 又按 `outputColorSpace` 编码一次 | 后处理生效时临时 RT 用线性 colorSpace |
| WebGL 伪装卡报 `Cannot read properties of undefined (reading 'byteLength')` | three 的 WebGL 异步读回要调用方传 buffer，不传返回 `undefined` | 传 `pixels` 并 `await` |
| Node 的 DOF 一开就**糊成一团**（WebGL 同参数几乎无变化） | `aperture→focalLength` 用了反比启发式，焦深被算成 1.2m | 按几何关系换成 `maxblur/aperture`（见 4.1） |
| WebGL 天空**纯黑**、WebGPU 是深蓝（`0x2a3c52` 的预设色） | 自定义 `ShaderMaterial` 没有 `tonemapping/colorspace` chunk，线性值原样写入帧缓冲 | `SKY_FRAG` 末尾补 `#include <tonemapping_fragment>` / `<colorspace_fragment>` |
| `WebGL 2 (Node)` 分支截图仍然上下颠倒 | 行序取决于**底层 backend** 而非"是不是 Node"：`Renderer.readRenderTargetPixelsAsync` 统一调到 `backend.copyTextureToBuffer`，WebGL backend 内部还是 `gl.readPixels`（自下而上） | 翻转条件改成 `!renderer.backend.isWebGPUBackend`，两处（截图 + 伪装卡） |

修完的基线（同一棵树、默认参数、`strength=0.9 / radius=0.6 / threshold=0.35`、
`focus=6 / aperture=1e-4 / maxblur=0.012`）：

| 探针 | WebGPU(Node) | WebGL | 说明 |
| --- | --- | --- | --- |
| base | bright 12.49 / lit 99.95 / rgb 47,55,69 | 5.21 / 99.70 / 37,48,67 | `bright` 差在天空渐变亮度带，`lit` 已对齐 |
| bloom | 22.05 / rgb 48,57,77 | 32.43 / 59,66,86 | Node 泛光略弱（见 4.1 已知差异） |
| bloom+dof | 27.45 / rgb 58,65,84 | 26.47 / 52,60,80 | 观感接近（主体清晰、边缘轻微虚化） |
| postOff | 18.51 / rgb 48,56,70 | 10.21 / 38,49,68 | 均回到无后处理的直出 |
| fx | 三个材质 `MeshBasicNodeMaterial`，`particleVerts=960` | `ShaderMaterial`，`particleVerts=240` | Node 粒子是四边形 |
| shadow | `autoUpdate` false→true 跟随参数 | 同 | 两条后端行为一致 |
| screenshot | 1645×1309，`lit 99.95` | 1645×1309，`lit 99.71` | 均非黑帧 |
| impostor | 1024×256，coverage 0.073，4 格 | 1024×256，coverage 0.072，4 格 | 两条后端都出图 |
| errs | 0 | 0 | 无 `CERR` / `SHADER` / 校验错误 |

**第三个后端：`WebGL 2 (Node)`**（`dev/node-webgl2-check.html`，禁用 `navigator.gpu`，窗口比例与上表不同，
所以数值不可逐格对比）：`backend=WebGL 2 (Node)`、`isNode=true`、`isWebGLRenderer=false`、
`backend=WebGLBackend`；几何 `202736 / 11520 / 1508` 与另两条一致；
三个特效材质都是 `MeshBasicNodeMaterial`、`particleVerts=960`；`chainKey` 依次为
`bloom → both → none`；阴影 `static=false → dynamic=true`；截图 `1410×1725 / lit 99.92` **方向正确**；
伪装卡 `1024×256 / coverage 0.072 / 4 格`，预览面片 `group+active` 正常；`errs=0`。
即：Node 材质体系在 GL 执行环境下全功能可用，唯一需要区分的是读回行序（上表最后一行）。

### 4.7 仍未做（明确的边界）

1. **自定义 GLSL 的替代入口**（原 P2 第 2/3 个方向）：目前仍是"提示后跳过"。
   要做得先设计受控的 TSL 片段输入（`Fn` 包裹 + 允许的节点白名单），属于产品能力设计，不是补丁级改动；
2. **能力探测告警**：`renderer.backend` 的 `maxVertexBuffers` 等 limit 还没有接到 UI；
   属性数上限（当前 6 个自定义属性、stride 9）仍是散落在 `interleaveGpuAttributes` 的实现细节，
   建议提成常量并在新增顶点属性时断言；
3. **WebGPU `bytesPerRow` 256 字节对齐**：目前完全依赖 three 的 `copyTextureToBuffer`；
   本仓库用的都是 256 的整数倍宽（512/256/1280…），尚未针对非对齐宽度单独压测；
4. **动态阴影的"影子确实在随风摆动"**：探针只验证了 `shadowMap.autoUpdate` 跟随参数，
   画面级对比（连拍两帧看影子位移）还没做，需要人工看一眼。

（原来列在这里的"`WebGL 2 (Node)` 分支未回归"已补掉：`dev/node-webgl2-check.html` 实测通过，
见 4.6 末尾。）

---

## 5. 已知坑（踩过的记录）

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| `Vertex buffer count (9) exceeds the maximum ... (8)` | WebGPU 每个 attribute 一个 buffer | `interleaveGpuAttributes` 打包 6 个自定义属性 |
| `AttributeNode: Vertex attribute "aEpiphyte" not found on geometry` | 花朵几何没有该属性 | 交错时为缺失属性补 0 |
| `not compatible` / 满屏材质报错 | `ShaderMaterial` 不在 NodeLibrary | Node 路径改用 NodeMaterial / TSL |
| 树叶/树皮变黑，无任何报错 | `onBeforeCompile` 在 Node 路径被忽略 | 材质必须走 `materialsGPU.js` |
| 截图/伪装卡空白 | `readRenderTargetPixels` 是 WebGL 专用；WebGPU canvas 帧外读不到内容 | Node 路径统一改走 `readRenderTargetPixelsAsync` + 临时 RT（`_captureFrameDataUrl`） |
| 粒子在 Node 路径完全看不见 | WGSL 没有 `gl_PointSize`，point 恒为 1 像素（three 的 GLSL 后端也写死 `gl_PointSize = 1.0`） | 改四边形 billboard（`buildParticleBillboards`） |
| `sampleTexture(uniform(map))` 绑定时炸掉 | 纹理节点要求真实 `Texture`（要读 `uuid`/filter/colorSpace） | 贴图直接传 `map`，变更靠 rebuild key 重建材质 |
| 动态阴影与树体错位 | 误以为要单独挂 `castShadowPositionNode` 而漏了风场 | 不需要单独挂：`Renderer._getShadowNodes()` 已继承 `positionNode` 与 `maskNode`、`colorNode.a`、`alphaTest` |
| DOF 滑块拖到哪都一样模糊 | `aperture→focalLength` 用了反比启发式，焦深被算成 1.2m，整棵树都在"完全失焦"区 | 按公式反推：`focalLength = maxblur/aperture`，`bokehScale = maxblur × 画面高`（`dofMapping()`） |
| 截图整幅上下颠倒（树冠朝下、地面在上） | 读回行序没按后端区分：WebGPU 的 `copyTextureToBuffer` 返回纹理行序（自上而下），WebGL 侧（经典与 `WebGLBackend`）内部仍是 `gl.readPixels`（自下而上） | 翻转条件用 `renderer.backend.isWebGPUBackend` 判断，截图与伪装卡两处一致 |
| 截图比画布亮一档 | 临时 RT 声明 sRGB，而 `RenderPipeline` 又按 `outputColorSpace` 编码一次 | 后处理生效时临时 RT 用线性 `colorSpace` |
| WebGL 伪装卡 `reading 'byteLength' of undefined` | three 的 WebGL 异步读回要求调用方传 buffer，不传就返回 `undefined` | `readRenderTargetPixelsAsync(rt, 0, 0, size, size, pixels)` 并 `await` |
| 经典 WebGL 天空几乎纯黑，Node 是深蓝 | 自定义 `ShaderMaterial` 不自动套 `tonemapping/colorspace` chunk，线性值直接写进帧缓冲（暗一整个 sRGB 编码） | `SKY_FRAG` 末尾补 `#include <tonemapping_fragment>` / `<colorspace_fragment>` |
| `PostProcessing is deprecated` 警告 | r183 起改名 `RenderPipeline` | 直接用 `new RenderPipeline(renderer)` + `.outputNode` + `.needsUpdate` |
| 导出 GLB 材质丢失 | GLTFExporter 不识别 NodeMaterial | 导出时临时使用经典材质（`_exportMaterials`） |
| 拆分导出崩溃 | `InterleavedBufferAttribute` 没有 `.array` | `exportSplit.attrView()` 兼容 stride/offset |

---

## 6. 验收与回归清单

每次改动 WebGPU/Node 路径后至少跑一遍：

```bash
node scripts/selftest.mjs        # 384 项: 确定性/参数隔离/几何合法性/导出格式
node scripts/audit-params.mjs    # 参数有效性审计
npm run build                    # 确认 postGPU / materialsGPU / three.webgpu 正常分包
```

### 6.1 自动探针 `dev/renderer-backend-check.html`

```bash
npm run dev                      # scripts/vite-sandbox.mjs，默认 5273 端口
node scripts/shot-receiver.mjs   # 可选: 5274 端口，把每步截图落到 .shots/
# 浏览器打开 http://127.0.0.1:5273/dev/renderer-backend-check.html
```

页面会自己把 `/?renderer=webgpu` 与 `/?renderer=webgl` 两个 iframe 依次加载（不需要手工切后端），
每组探针的结果都写进 `document.title`，`<pre>` 里有完整分行文本。判读标准与实测基线见 4.5 / 4.6。

要点：

- 后端靠 **URL 参数固定**（`?renderer=webgpu|webgl`），因为参数表每次刷新都会回到 `auto`；
- 像素统计一律走 `_captureFrameDataUrl()` → `Image` 解码，**不能**直接 `drawImage(canvas)`：
  WebGPU 的 canvas 是交换链，帧外读出来是空白，那样两条后端都测成"全黑"；
- 截图 POST 到 `127.0.0.1:5274/shot` 需要配套接收端（`scripts/shot-receiver.mjs`）才有落盘；
  没起接收端时探针照常跑完、只是不落盘（`fetch` 失败被吞掉）；
- 一轮耗时约 30 秒（两个后端各一次建树 + 8 组开关）。

### 6.1b 第三条路径 `dev/node-webgl2-check.html`

```bash
# 同 6.1 的 dev 服务器 / 截图接收端
# 浏览器打开 http://127.0.0.1:5273/dev/node-webgl2-check.html
```

它自己把 `navigator.gpu` 抹成 `undefined` 再启动应用，逼出 `WebGL 2 (Node)` 分支（Safari / 关 WebGPU 的 Chrome
走的也是这条）。判读：`backend=WebGL 2 (Node)`、`isNode=true`、`isWebGLRenderer=false`、
`backendObj=WebGLBackend`，且截图方向正确（天空在上）。

⚠️ 探针页**不能**把 `#app` 设成 `display:none`：容器尺寸为 0 时 drawing buffer 退化成 1×1，
拍出来是一张纯色平图（这个坑踩过一次，误以为是渲染坏了）。

### 6.2 手工回归（WebGPU / Node 路径）

- [ ] 树正常显示，`FPS ≈ 60`，无 `GPUValidationError` / TSL 编译错误；
- [ ] 切换树种 / 生长阶段 / 季节 / 种子后重建正常；
- [ ] 节点选中（高亮 / 仅显示选中 / 其余变暗）正常；
- [ ] 风场 / 生长动画正常；
- [ ] 开 Bloom（首次会编译一次，允许一帧卡顿）后画面有泛光，关闭后回到原观感；
- [ ] 开 DOF 后拖 `dofAperture`，景深范围随滑块变化（眼睛盯着"树的边缘是否变软"）；
- [ ] 开粒子 / 落叶 / 落花 / 堆积后能看到实例（粒子不能再是单像素点）；
- [ ] 开动态阴影后树影随风摆动（探针只验了开关，肉眼要再看一次），关掉后影子静止；
- [ ] 「导出 → 伪装卡」能出图集与预览面片（`makeImpostor`/`setImpostorPreview` 均为 async）；
- [ ] 「截图」按钮能出图、方向正确、不是黑帧（`app.screenshot` 为 async，调用方需 `await`）；
- [ ] GLB / OBJ / JSON 导出可打开且节点结构正确；
- [ ] 面板「场景 → 渲染引擎」显示当前后端；后处理区提示为 TSL 版文案；
- [ ] 左下角「引擎」切到 WebGL：立即生效、树不变、视角不跳、徽标变 `WebGL`；
- [ ] 开着 Bloom/DOF + 粒子/落叶时再切一次：泛光仍在、粒子可见、无报错（后处理随后端重建）；
- [ ] 切回 WebGPU 再刷新页面：仍是 WebGPU（引擎选择已持久化）。

### 6.3 手工回归（强制 `webgl`）

打开 `http://127.0.0.1:5273/?renderer=webgl`（或面板里把渲染后端切到 `webgl` 后刷新）：

- [ ] 天空是预设的深蓝渐变（不是纯黑），树/地面色调与 WebGPU 基本一致；
- [ ] 经典材质、Bloom/DOF、季节特效、伪装卡、自定义 GLSL 全部正常；
- [ ] 导出与 WebGPU 路径结果一致（顶点/面数守恒：用探针页的 `tris/leaves/nodes` 对照）。

### 6.4 仍待补的验证

- 动态阴影的"影子跟着风摆"只有参数级验证（`autoUpdate` 跟随开关），缺画面级对比；
- WebGPU `bytesPerRow` 在非 256 对齐宽度下的读回未压测（见 4.7）。
- 长时间稳定性（连续开关后处理/特效数十次是否漏纹理或膨胀）没有做过 soak 测试。

---

## 7. HUD「绘制调用」在 WebGPU 下持续增长 —— 是统计口径，不是渲染 bug

> 结论先行：**不是 bug，没有改任何代码**（按用户明确要求"如果不是 bug 就切勿修改"）。
> 现象只出现在 Node 后端（WebGPU / `WebGL 2 (Node)`）：HUD 上的「绘制调用」只增不减。
> 经典 WebGL 后端显示的是"每帧调用数"（本仓库实测 7），两者**不能逐值比较**。

### 7.1 现象

| 后端 | HUD「绘制调用」 | 含义 |
| --- | --- | --- |
| 经典 WebGL（`WebGLRenderer`） | 每帧重置，实测 7 | 上一帧的 draw call 数 |
| WebGPU（`WebGPURenderer`） | 从启动起单调累加（392 → 400+ …） | **进程启动以来的累计调用数** |

两者差三个数量级并不是"WebGPU 画得更多"，而是同一个字段在两种后端里语义不同。

### 7.2 源码证据（three r187，`node_modules/three/src/renderers/common/Info.js`）

| 位置 | 内容 | 含义 |
| --- | --- | --- |
| `L24-31` | `autoReset` 注释：由自管动画循环的应用设为 `false`，并**每帧手动** `renderer.info.reset()` | 自动重置只在 three 自己的循环里发生 |
| `L59` | `render.calls` 注释：*"The number of render calls **since the app has been started**"* | 这个字段从启动起累计 |
| `L60` | `render.frameCalls` 注释：*"of the current frame"* | 每帧口径在这里 |
| `L187-198` | `reset()` 只清 `render.drawCalls`、`render.frameCalls`、`compute.frameCalls`、`triangles/points/lines` | **不清 `render.calls`** |
| `L203-214` | `dispose()` 才把 `calls`、`render.calls`、`compute.calls` 归零 | 只有销毁时归零 |
| `renderers/common/Animation.js L83` | `if (this.info.autoReset === true) this.info.reset()` | 只存在于 three 的 `setAnimationLoop` 循环 |
| `renderers/WebGLRenderer.js L1744` | 每次 `render()` 前 `if (this.info.autoReset === true) this.info.reset()` | 经典 WebGL 是"每帧重置"的实现，且它的 `reset()` 会清 `calls` |

本仓库是**自管循环**：`src/core/sceneManager.js L554 / L3445` 用 `this._raf = requestAnimationFrame(this._loop)`，
从不调用 `renderer.setAnimationLoop()`，因此 Node 后端里 three 的自动重置一次也不会执行
→ `render.calls` 一路累加。HUD 读的正是这个字段：

```vue
<!-- src/components/Viewport.vue L18 -->
<div><span class="k">绘制调用</span> <b>{{ state.renderInfo.calls }}</b></div>
```

`sceneManager.js L3478` 把 `renderer.info.render` 原样交给 UI（`onFrame(frameInfo)`），
所以 UI 没有做错，是**字段选择**沿用了 WebGL 时代的写法。

### 7.3 如果要显示"每帧 draw call"

不用改渲染循环，只需换字段（本次**未实施**，仅记录改法）：

- 通用写法：`renderer.info.render.drawCalls`（WebGL 与 Node 后端都有，且每帧清零）；
- Node 后端更细的口径：`renderer.info.render.frameCalls`（含阴影 pass、后处理 pass）；
- 因此 WebGPU 侧的数值天然会比 WebGL 的 7 大（多了 shadow / post 的 pass），
  对照时应看"同一后端切换开关前后的差"，而不是跨后端比值。

### 7.4 为什么"不改"是对的

1. 没有资源泄漏：`render.calls` 只是个计数器，不持有 GPU 对象；
2. 没有重复绘制：真正每帧的调用数在 `drawCalls/frameCalls` 里，同一帧稳定；
3. 唯一"坏处"是 HUD 数字一直涨、看起来像漏了清理 —— 属于**展示口径**问题，
   一旦改成累计口径之外的字段，WebGL/WebGPU 的读数就会重新可比。