# FastTree WebGPU 渲染后端 · 技术文档与后续计划

> 范围：three r187 升级、WebGPU 默认渲染、WebGL 自动回退，以及在 Node/TSL 路径下尚未补齐的能力与后续实现方案。
> 相关代码：`src/core/rendererBackend.js`、`src/core/materialsGPU.js`、`src/core/sceneManager.js`、`src/components/Viewport.vue`、`src/core/exportSplit.js`。
> 适用版本：`three@0.187.0`、Vue 3.5。

---

## 摘要

渲染后端从"固定 WebGLRenderer"改成**双轨制**：

1. 默认 `auto`：先创建 `WebGPURenderer` 并 `await init()`；成功即走 WebGPU（底层不支持时 three 会自动落到 WebGL 2 后端，仍是 Node 渲染路径）。
2. WebGPU 创建/初始化失败：自动回退经典 `WebGLRenderer`，功能与改造前完全一致。
3. 材质体系按渲染路径二选一：
   - **Node 路径**（WebGPU / WebGL 2 Node）：`materialsGPU.js` 的 `MeshStandardNodeMaterial` + TSL；
   - **经典路径**（WebGL）：`materials.js` 的 PBR + `onBeforeCompile` 注入。

切换入口：`场景 → 渲染后端`（`auto | webgpu | webgl`），写入 `params.scene.renderer`，**刷新页面后生效**。

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
| 后处理 | `EffectComposer` + Bokeh/Bloom + OutputPass | `_ensureComposer()` 返回 `null`，直出 |
| 阴影刷新 | 动态阴影每帧 / 静态按需 | `shadowMap.needsUpdate` 按需，动态阴影关闭 |
| 季节特效 | 粒子 / 落叶 / 落花 / 堆积 | `rebuild*/update*` 直接 return |
| 伪装卡 | 离屏渲染 + `readRenderTargetPixels` | `makeImpostor` 抛错提示；预览直接跳过 |
| 自定义 GLSL | `onBeforeCompile` | `onShaderError` 提示一次后跳过 |
| 导出 | 直接使用当前材质 | `buildExportGroup` 使用临时经典材质 |

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
| 动态风场阴影 | ✅ | ❌ 降级为静态阴影 |
| Bloom / DOF | ✅ | ❌ 直出 |
| 落叶 / 落花 / 叶片粒子 / 堆积 | ✅ | ❌ 跳过 |
| 自定义 GLSL | ✅ | ❌ 提示后跳过 |
| 伪装卡生成 / 预览 | ✅ | ❌ 提示后跳过 |
| GLB / OBJ / JSON / PNG 导出 | ✅ | ✅（导出用临时经典材质） |

---

## 4. 后续计划（待补齐项）

以下按"收益 / 成本"排序。每项都给出落点、关键 API 与注意事项，避免下次从零调研。

### P1 · TSL 后处理：Bloom + DOF

**落点**：`sceneManager._ensureComposer()` / `_renderFrame()`；可在 `materialsGPU.js` 旁新增 `postGPU.js`。

**three r187 可用 API**（已在本仓库 `node_modules/three` 中确认）：

- `PostProcessing`（来自 `three/webgpu`）
- `pass`（来自 `three/tsl`）
- `bloom`（`three/addons/tsl/display/BloomNode.js`）
- `dof`（`three/addons/tsl/display/DepthOfFieldNode.js`）

**实现骨架**：

```js
const post = new PostProcessing(renderer)
const scenePass = pass(scene, camera)
const color = scenePass.getTextureNode('output')
const depth = scenePass.getTextureNode('depth')

let out = color
if (dofEnabled) out = dof(out, depth, focus, aperture, maxBlur)
if (bloomEnabled) out = out.add(bloom(out, strength, radius, threshold))

post.outputNode = out
// resize 时 post.setSize(w, h)
// 渲染时 post.render() 替代 renderer.render(...)
```

**注意**：

- 参数映射与现有 `_post`（`bloomStrength/bloomRadius/bloomThreshold`、`dofFocus/dofAperture/dofMaxBlur`）对齐，避免 UI 两套语义。
- `_ensureComposer()` 目前是同步返回；Node 路径需要单独持有 `PostProcessing` 实例并处理 resize。
- 截图路径（`exportScreenshot` 走 `canvas.toBlob`）在 `post.render()` 后取样，需要确认时序（见 P2 截图项）。
- 关闭 Bloom/DOF 时必须回到 `renderer.render()`，不能留下空 pass。

### P1 · 季节特效 NodeMaterial 化

**现状**：`particles.js`、`fallingLeaves.js`、`litter.js` 全部是 `ShaderMaterial`，Node 路径直接 return。

**方案**：逐套改成 `PointsNodeMaterial`（粒子）或 `MeshBasicNodeMaterial`（落叶/落花/堆积），
用 TSL 重写顶点位移与片元取色；每帧通过 `syncGpuUniforms` 同款机制同步 `uTime/uFall/...`。

**建议顺序**：

1. `particles.js`（结构最简单：单点 + 尺寸 + 透明度）；
2. `fallingLeaves.js`（需要贴图卡 + 翻转）；
3. `litter.js`（地面贴片 + 继承叶/花材质光照）。

**验收**：同一 `seed` 下粒子/落叶位置序列与 WebGL 路径一致（可复用 `windModel.js` 的确定性断言思路）。

### P1 · 动态风场阴影（替代 `customDepthMaterial`）

**现状**：WebGL 用 `createTreeDepthMaterial()`（`customDepthMaterial`）让阴影跟着风摆；
Node 路径不支持 `customDepthMaterial`，动态阴影被整体关闭。

**方案**：Node 材质支持 `material.castShadowPositionNode`（three r187 已确认存在），
在 `materialsGPU.js` 里把**同一套风场顶点节点图**挂到该槽位：

```js
mat.castShadowPositionNode = buildWindPositionNode(U)  // 与 positionNode 共用节点图
```

**注意**：

- 必须使用与主渲染一致的 `uTime/uWind*/uGrow*`，否则阴影与树体错位；
- 阴影 pass 也要访问 `aWind/aPhase/aOrigin/aGrow`（交错后仍在同一 buffer，无需额外处理）；
- 性能：动态阴影每帧重绘阴影贴图，建议保留现有"关闭后冻结"的策略，并在面板标注开销；
- 恢复后需要重新允许 `shadowMap.autoUpdate` 在 Node 路径开启（目前被强制 false）。

### P2 · 伪装卡读取回（Impostor）

**现状**：`makeImpostor` 依赖 WebGL 的 `readRenderTargetPixels` 同步读回；Node 路径直接抛错。

**方案**：使用 WebGPU 通用异步读回：

```js
const pixels = await renderer.readRenderTargetPixelsAsync(renderTarget, x, y, w, h)
```

（已确认 `three/src/renderers/common/Renderer.js` 提供该 API，内部走 `backend.copyTextureToBuffer`。）

**注意**：

- 返回 `Promise<TypedArray>`，`makeImpostor` 需要改成 `async`，上层 `Viewport.vue` 的调用同步调整；
- WebGPU 行对齐要求（bytesPerRow 需 256 字节对齐）由 three 处理后仍建议实测；
- 读回数据的通道顺序/预乘 alpha 与 WebGL 路径不同，拼图集前统一转换成 RGBA8；
- 预览面片是 `ShaderMaterial`（按方位角选图集格），Node 路径需要改成 NodeMaterial 或保留"仅 WebGL 预览"。

### P2 · 自定义 GLSL 的替代入口

**现状**：Node 路径无法嵌入 GLSL（`onBeforeCompile` 不生效），当前在 UI 上提示后跳过。

**三个可选方向**（按成本从低到高）：

1. **明确限定**：保留现状，在材质面板把"自定义 GLSL"标记为"仅 WebGL"，并在切换后端时提示；
2. **自定义 TSL 片段**：提供一个受控的 TSL 代码输入（`Fn` 包裹），保证可编译；
3. **GLSL → WGSL 转译**：引入转译器（成本高、覆盖不全），不建议在当前阶段做。

建议先做 1，等 P1 全部落地后再评估 2。

### P2 · 截图 / PNG 导出在 WebGPU 下的稳定性

**现状**：`exportScreenshot` 用 `canvas.toBlob`，依赖 WebGL 的 `preserveDrawingBuffer`。
WebGPU 的 canvas 捕获时序与 WebGL 不完全一致，可能出现空白帧。

**方案**：Node 路径改为渲染到 `RenderTarget` → `readRenderTargetPixelsAsync` → 手动写 PNG（复用现有 PNG 编码），
与伪装卡共用同一套读回工具，避免两条路径。

### P3 · 真正的 WebGL 回退回归测试

**现状**：开发机支持 WebGPU，`auto` 总是走 WebGPU；"切到 WebGL"刷新后参数回到 `auto` 并实际仍走 WebGPU。

**待办**：

- 用 `params.scene.renderer = 'webgl'` 做一次强制回归（页面参数持久化后验证经典材质、Bloom/DOF、季节特效、伪装卡、自定义 GLSL 全部正常）；
- 同时覆盖 `WebGL 2 (Node)` 分支（禁用 `navigator.gpu` 或使用不支持 WebGPU 的浏览器），确认它走 Node 材质且 UI 提示正确；
- 建议把这三条写入 `dev/` 下的自检页面（例如 `dev/renderer-backend-check.html`），断言 `state.renderBackend` 与能力提示。

### P3 · 能力探测与降级提示的可观测性

- `renderer.backend` 上可读取 `maxVertexBuffers` 等 limit，用于在几何属性继续增长时提前告警；
- 建议在状态栏/场景面板显示后端名称之外，再显示 `backendName + isWebGPU`，方便用户上报问题；
- 属性交错阈值（当前 6 个自定义属性、stride 9）应写成常量并在新增顶点属性时校验总数 ≤ 8。

---

## 5. 已知坑（踩过的记录）

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| `Vertex buffer count (9) exceeds the maximum ... (8)` | WebGPU 每个 attribute 一个 buffer | `interleaveGpuAttributes` 打包 6 个自定义属性 |
| `AttributeNode: Vertex attribute "aEpiphyte" not found on geometry` | 花朵几何没有该属性 | 交错时为缺失属性补 0 |
| `not compatible` / 满屏材质报错 | `ShaderMaterial` 不在 NodeLibrary | Node 路径改用 NodeMaterial / TSL |
| 树叶/树皮变黑，无任何报错 | `onBeforeCompile` 在 Node 路径被忽略 | 材质必须走 `materialsGPU.js` |
| 截图/伪装卡空白 | `readRenderTargetPixels` 是 WebGL 专用 | 改用 `readRenderTargetPixelsAsync`（待做） |
| 导出 GLB 材质丢失 | GLTFExporter 不识别 NodeMaterial | 导出时临时使用经典材质（`_exportMaterials`） |
| 拆分导出崩溃 | `InterleavedBufferAttribute` 没有 `.array` | `exportSplit.attrView()` 兼容 stride/offset |

---

## 6. 验收与回归清单

每次改动 WebGPU/Node 路径后至少跑一遍：

```bash
node scripts/selftest.mjs        # 383 项: 确定性/参数隔离/几何合法性/导出格式
node scripts/audit-params.mjs    # 参数有效性审计
npm run build                    # 确认 materialsGPU / three.webgpu 正常分包
```

浏览器（WebGPU）：

- [ ] 树正常显示，`FPS ≈ 60`，无 `GPUValidationError` / TSL 编译错误；
- [ ] 切换树种 / 生长阶段 / 季节 / 种子后重建正常；
- [ ] 节点选中（高亮 / 仅显示选中 / 其余变暗）正常；
- [ ] 风场 / 生长动画正常；
- [ ] GLB / OBJ / JSON 导出可打开且节点结构正确；
- [ ] 面板「场景 → 渲染后端」显示当前后端；Bloom/DOF 提示可见。

浏览器（强制 `webgl`）：

- [ ] 经典材质、Bloom/DOF、季节特效、伪装卡、自定义 GLSL 全部正常；
- [ ] 导出与 WebGPU 路径结果一致（顶点/面数守恒）。
