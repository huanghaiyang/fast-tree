/**
 * 模板库存储 (IndexedDB)
 * ------------------------------------------------------------
 * 每条模板 = 一份完整的 .ftree 压缩包字节 + 元信息:
 *   { id, name, seed, textureCount, size, bytes, createdAt, updatedAt }
 *
 * 为什么用 IndexedDB 而不是 localStorage:
 *   - 模板里可能带用户上传的外部贴图 (2K PNG 的 dataURL 动辄几 MB),
 *     localStorage 只有 ~5MB 且只能存字符串, 两三个带贴图的模板就会写爆;
 *   - IndexedDB 可以直接存 ArrayBuffer/Uint8Array, 容量按配额走 (通常几百 MB)。
 *
 * 为什么存压缩后的 .ftree 字节而不是参数对象:
 *   - 与「导出 .ftree」共用同一套打包/解析逻辑, 模板可以一键下载成 .ftree,
 *     外部 .ftree 也可以直接当模板用; 数据只有一种格式, 不会出现两套编码。
 *
 * Node 环境 (selftest/audit 会在 Node 里 import 本模块) 没有 indexedDB:
 * 所有函数都做能力检测并返回空结果, 不抛错, 保证只做数据审计的脚本能跑。
 */

const DB_NAME = 'fasttree-templates'
const DB_VERSION = 1
const STORE = 'templates'

/** 当前环境是否支持 IndexedDB */
export function templatesSupported() {
  return typeof indexedDB !== 'undefined'
}

/** 打开数据库 (首次创建 objectStore); 失败时 reject */
function openDb() {
  return new Promise((resolve, reject) => {
    if (!templatesSupported()) {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('打开模板库失败'))
  })
}

/** 通用事务包装: fn(store) 里发起写操作, 事务完成后 resolve */
async function withStore(mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    try {
      fn(tx.objectStore(STORE))
    } catch (e) {
      db.close()
      reject(e)
      return
    }
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

/**
 * 列出全部模板 (按更新时间倒序)。
 * bytes 字段会被剥掉, 只返回元信息, 避免列表渲染时把几 MB 的 blob 带进 Vue 响应式。
 * @returns {Promise<Array<{id,name,seed,textureCount,size,createdAt,updatedAt}>>}
 */
export async function listTemplates() {
  if (!templatesSupported()) return []
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      db.close()
      const list = (req.result || []).map((r) => ({
        id: r.id,
        name: r.name,
        seed: r.seed,
        textureCount: r.textureCount || 0,
        size: r.size || (r.bytes ? r.bytes.length : 0),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
      list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      resolve(list)
    }
    req.onerror = () => {
      db.close()
      reject(req.error)
    }
  })
}

/**
 * 读取一条完整模板 (含 bytes)。
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getTemplate(id) {
  if (!templatesSupported()) return null
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => {
      db.close()
      resolve(req.result || null)
    }
    req.onerror = () => {
      db.close()
      reject(req.error)
    }
  })
}

/**
 * 写入/覆盖一条模板。
 * @param {{id:string,name:string,seed:number,textureCount:number,bytes:Uint8Array,createdAt?:string}} record
 * @returns {Promise<object>} 实际写入的记录
 */
export async function putTemplate(record) {
  if (!templatesSupported()) throw new Error('当前环境不支持 IndexedDB')
  const now = new Date().toISOString()
  const rec = {
    ...record,
    size: record.bytes ? record.bytes.length : 0,
    createdAt: record.createdAt || now,
    updatedAt: now,
  }
  await withStore('readwrite', (store) => store.put(rec))
  return rec
}

/**
 * 删除一条模板。
 * @param {string} id
 */
export async function deleteTemplate(id) {
  if (!templatesSupported()) return
  await withStore('readwrite', (store) => store.delete(id))
}

/**
 * 清空模板库 (调试/重置用)。
 */
export async function clearTemplates() {
  if (!templatesSupported()) return
  await withStore('readwrite', (store) => store.clear())
}
