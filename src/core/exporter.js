/**
 * 导出: GLB / OBJ / 参数 JSON / 截图
 * ------------------------------------------------------------
 * 作用: 把"场景里那棵树"变成可下载的文件 —— 三个导出器 (GLB/OBJ) 都通过
 *       three 官方 addons 完成序列化, 本模块负责"导出前后的准备与收尾"和"下载动作"。
 * 输入 / 输出:
 *   - 入参 root: 一个**只含 Bark / Leaves / Flowers 三个节点的导出组**
 *     (由 sceneManager 组装, 不带地面/天空/网格/伪装卡等装饰);
 *   - 输出: GLB 返回 `Promise<Blob>`, OBJ 返回字符串, 参数 JSON 返回 payload 对象,
 *     截图返回 `Promise<Blob|null>`; `opts.download === false` 时不触发浏览器下载
 *     (导出预览 exportPreview.js 就是这么用的)。
 * 与其他模块的关系:
 *   - 上游调用方: `sceneApi.exportGLB / exportOBJ / screenshot` (由 Viewport.vue 注入),
 *     面板层 (ExportPanel.vue) 与 `core/exportPreview.js` 的预览流程;
 *   - 贴图侧: 全部委托给 `core/textureNaming.js` 的四个 ensure/apply 函数;
 *   - 参数文件格式与 `store/treeStore.js` 的 `importParamsJSON()` 对应 (见 buildParamsJSON)。
 * 关键约定:
 *   - 导出的几何/贴图是**渲染用资源的临时改写**: 为让 GLB 在别的 DCC 里"开箱可用"
 *     (normal/roughness 齐全、贴图同尺寸同朝向、命名规范), 导出期间会临时改材质,
 *     完成后必须恢复 —— 详见 `exportGLB` 的注释;
 *   - 单位/坐标系: 几何已是米制世界坐标, 不做单位换算; glTF 的 +Y 向上与 Three 一致;
 *   - 本模块是纯前端: 全部依赖 DOM (`document`/`URL`/`FileReader`), 不能在 Node 侧调用
 *     (除 `buildParamsJSON` / `expandExponentialNumbers` 这两个纯函数外)。
 */
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js'
import { applyExportTextureNames, patchGlbTextureNames, ensureExportMaterialMaps, ensureExportRoughnessGrayscale, ensureExportTextureAlignment } from './textureNaming.js'

/**
 * 触发浏览器下载一个 Blob。
 *
 * 实现是经典的"临时 `<a download>` + objectURL": 部分浏览器要求 `<a>` 在文档里才会响应
 * 程序化 click, 所以先 append 再 remove。
 * 4 秒后才 `revokeObjectURL`: 立即释放会让部分浏览器(尤其 Safari/移动端)
 * 在下载真正开始前就拿到失效 URL, 表现为"点导出没反应"。
 *
 * @param {Blob} blob 要下载的内容
 * @param {string} filename 下载文件名 (含扩展名)
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/**
 * 下载纯文本 (内部先包成 Blob)。
 * @param {string} text 文本内容
 * @param {string} filename 文件名
 * @param {string} [mime='text/plain'] MIME 类型 (JSON 用 `application/json`)
 */
export function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

/**
 * 导出 GLB（glTF 二进制，内嵌贴图）。
 *
 * 导出不是"直接 parse 一下"，而是先把材质临时补成一套完整资源再写文件，
 * 结束后**必须**恢复原材质（否则视口材质会被临时贴图污染，临时贴图也会泄漏显存）：
 *
 *   1. `ensureExportMaterialMaps`     补全缺失的 normalMap / roughnessMap
 *   2. `ensureExportTextureAlignment` 叶/花/果四张图对齐（同尺寸 + 同朝向 + 同 UV）
 *   3. `ensureExportRoughnessGrayscale` metalness=0 时让 `_rough` 保持灰白
 *   4. `applyExportTextureNames`      写入 `leaf_diff_1k` 这类资源名，收集 alpha 资源
 *   5. `GLTFExporter.parse`           真正写 GLB
 *   6. `patchGlbTextureNames`         字节层补 `images[].name` 与 `<kind>_alpha` 图
 *
 * 顺序约束（改动前先读这段）：
 *   - 对齐必须在"补槽"之后：补槽会新建 normal/rough，对齐要基于它们的最终尺寸；
 *   - 对齐必须在"命名"之前：命名按贴图尺寸决定 `_xk` 后缀，尺寸没对齐后缀就会错；
 *   - grayscale 必须在"对齐"之后：它复用 roughnessMap，若之后对齐再换图就会指向旧图；
 *   - 恢复必须**逆序**（3 → 2 → 1），否则 metalnessMap 可能指回一张已 dispose 的图。
 *
 * 失败路径（parse 报错 / 同步异常）同样执行 `restoreAll()`，保证异常时材质干净。
 *
 * 实现细节:
 *   - `GLTFExporter.parse` 是"回调 + 同步抛错"双风格: 参数非法/不支持的节点会在调用点
 *     直接 throw, 真正的序列化则在回调里返回 —— 所以既要 try/catch, 也要走 error 回调;
 *   - 选项 `binary: true` 产出 GLB (ArrayBuffer); `onlyVisible: true` 会跳过 visible=false
 *     的节点 (这正是渲染分块里用 layer 而不是 visible 隐藏源网格的原因);
 *     `truncateDrawRange: false` 让导出始终输出完整几何, 不跟随渲染用的 drawRange 截断。
 *
 * @param {THREE.Object3D} root 导出组（只含 Bark / Leaves / Flowers）
 * @param {string} [filename]   下载文件名
 * @param {{download?: boolean}} [opts] `download: false` 时只返回 Blob（导出预览用）
 * @returns {Promise<Blob>} 生成的 GLB
 */
export function exportGLB(root, filename = 'fasttree.glb', opts = {}) {
  return new Promise((resolve, reject) => {
    // 各阶段返回自己的 restore()；这些临时贴图只在本次导出期间存在
    const restoreMaps = ensureExportMaterialMaps(root)
    const restoreAlign = ensureExportTextureAlignment(root)
    const restoreGrayscale = ensureExportRoughnessGrayscale(root)
    const naming = applyExportTextureNames(root)
    // 逆序恢复：先撤销 grayscale 借用的 metalnessMap，再撤销对齐的贴图替换，
    // 最后撤销补槽（此时补槽产生的临时贴图已经没有人引用）
    const restoreAll = () => {
      restoreGrayscale()
      restoreAlign()
      restoreMaps()
    }
    const exporter = new GLTFExporter()
    try {
      exporter.parse(
        root,
        (result) => {
          let data = result
          // binary: true 时 result 是 ArrayBuffer -> 需要做字节层的贴图名补写 (GLTFExporter 不写 images[].name)
          if (result instanceof ArrayBuffer) data = patchGlbTextureNames(result, naming.alphaAliases)
          // 极少数情况下 (binary 被关掉) 返回的是 glTF JSON, 这里一并兼容成 .gltf 内容
          const blob = data instanceof ArrayBuffer
            ? new Blob([data], { type: 'model/gltf-binary' })
            : new Blob([JSON.stringify(data)], { type: 'model/gltf+json' })
          // 先恢复材质再 resolve: 保证调用方拿到 Blob 时视口已经是干净状态
          restoreAll()
          if (opts.download !== false) downloadBlob(blob, filename)
          resolve(blob)
        },
        (err) => {
          // 序列化过程中失败: 同样要恢复, 否则材质会永久停在"导出用"状态
          restoreAll()
          reject(err)
        },
        { binary: true, onlyVisible: true, truncateDrawRange: false },
      )
    } catch (err) {
      // parse 同步抛错 (参数非法等): 恢复后向上抛, 让 UI 显示错误而不是静默失败
      restoreAll()
      reject(err)
    }
  })
}

/**
 * Wavefront OBJ 的浮点文法没有科学计数法; three 的 OBJExporter 直接输出 JS 数字,
 * 极小的坐标/法线分量会写成 "1e-7" 这种形式, 部分老 DCC/解析器不接受。
 * 这里把指数形式展开成纯小数 (只影响极小的数值, 几何精度损失可忽略)。
 *
 * 小数位数规则: |v| >= 1e-6 时固定 9 位 (足够表达 Float32 的有效位);
 * 更小的值按 `-log10(|v|) + 3` 加位 (上限 24 位), 保证展开后仍有 3 位有效数字;
 * 末尾去掉多余的 0 与孤立小数点, 避免把文件撑大。
 * 正则里的前后 `(?<![\w.])` / `(?![\w.])` 用于避免把标识符或已展开数字的一部分当指数匹配。
 *
 * @param {string} text OBJ 文本
 * @returns {string} 展开后的文本; 不含 `e/E` 时原样返回 (快速路径)
 */
export function expandExponentialNumbers(text) {
  if (!/[eE]/.test(text)) return text
  return text.replace(/(?<![\w.])-?\d+(?:\.\d+)?[eE][+-]?\d+(?![\w.])/g, (m) => {
    const v = Number(m)
    // 非有限值 (理论上不会出现) 保持原样, 宁可留一个指数写法也不要把几何写成 NaN
    if (!Number.isFinite(v)) return m
    if (v === 0) return '0'
    const abs = Math.abs(v)
    const decimals = abs >= 1e-6 ? 9 : Math.min(24, Math.max(9, Math.ceil(-Math.log10(abs)) + 3))
    const s = v.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')
    // 负数在 toFixed 后可能变成 "-0" (例如 -1e-9), 统一成 "0"
    return s === '-0' ? '0' : s
  })
}

/**
 * 导出 Wavefront OBJ (单文件纯几何, 不含贴图 — 与 GLB 的差别就在这)。
 * @param {THREE.Object3D} root 导出组
 * @param {string} [filename='fasttree.obj'] 下载文件名
 * @param {{download?: boolean}} [opts] `download: false` 时只返回文本
 * @returns {string} OBJ 文本 (已做指数展开处理)
 */
export function exportOBJ(root, filename = 'fasttree.obj', opts = {}) {
  const text = expandExponentialNumbers(new OBJExporter().parse(root))
  if (opts.download !== false) downloadText(text, filename, 'text/plain')
  return text
}

/**
 * 构建参数文件 payload (供下载与"另存为"用)。
 *
 * 文件格式约定 (与 `store/treeStore.js` 的 `importParamsJSON()` 配套):
 *   `{format: 'fast-tree/params', version: 1, seed, params}`
 *   - `format` 用于导入时识别"这是不是我们的文件";
 *   - `version` 是**格式**版本, 目前只有 1; 将来参数结构不兼容变更时递增;
 *   - `seed` 单独提出来是为了让外部工具不必翻 params 就能复现随机结果;
 *   - `params` 是完整参数快照 (含 scene/material/wind/leaves…)。
 * 注意导入侧刻意宽松: `data.params` 存在就取它, 否则把整个对象当参数 (兼容手写 JSON)。
 *
 * @param {object} params `state.params` 快照
 * @returns {{payload: {format: string, version: number, seed: (number|undefined), params: object}, text: string}}
 *   `payload` 结构体, `text` 是缩进 2 格的 JSON 文本 (给人看/直接落盘)
 */
export function buildParamsJSON(params) {
  const payload = {
    format: 'fast-tree/params',
    version: 1,
    seed: params.seed,
    params,
  }
  return { payload, text: JSON.stringify(payload, null, 2) }
}

/**
 * 导出参数 JSON 并直接下载。
 * @param {object} params `state.params` 快照
 * @param {string} [filename='fasttree-params.json'] 下载文件名
 * @returns {{format: string, version: number, seed: (number|undefined), params: object}} 已下载的 payload
 */
export function exportParamsJSON(params, filename = 'fasttree-params.json') {
  const { payload, text } = buildParamsJSON(params)
  downloadText(text, filename, 'application/json')
  return payload
}

/**
 * 截图当前画面并下载 PNG。
 * 用 `canvas.toBlob` 而不是 `toDataURL` 的原因: Blob 不经过 base64, 大分辨率下内存占用低一半。
 * @param {THREE.WebGLRenderer} renderer 渲染器 (用法: 取 domElement)
 * @param {string} [filename='fasttree.png'] 下载文件名
 * @returns {Promise<Blob|null>} 截图 Blob; 浏览器拒绝编码时为 null
 * 注意: 需要在渲染完一帧之后调用, 且 renderer 的 preserveDrawingBuffer 必须开启,
 *       否则读到的可能是已被清空的缓冲。
 */
export function exportScreenshot(renderer, filename = 'fasttree.png') {
  return new Promise((resolve) => {
    renderer.domElement.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename)
      resolve(blob)
    }, 'image/png')
  })
}

/** 读取本地文件为文本 */
export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    // String(...) 包一层: readAsText 的 result 类型在 lib.dom 里是 string | ArrayBuffer | null
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = reject
    fr.readAsText(file)
  })
}

/** 读取本地图片为 dataURL (供材质贴图使用) */
export function readImageAsDataURL(file) {
  // 返回 dataURL 而不是 Blob URL: 贴图会被序列化进 GLB, 只有 dataURL/Texture 才便于复用与保存
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = reject
    fr.readAsDataURL(file)
  })
}
