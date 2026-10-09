/**
 * JSON 树状模型与结构化操作核心
 * 支持深度树状解析、类型识别、JSONPath 寻址、节点层级折叠展开、
 * 以及对键值对与数组元素的完整增删改查（CRUD）与格式化序列化回写。
 */

export type JsonValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export interface JsonTreeNode {
  id: string
  key: string | number
  path: (string | number)[]
  pathString: string
  type: JsonValueType
  value: unknown
  childCount?: number
  children?: JsonTreeNode[]
}

export interface JsonSearchMatch {
  nodeId: string
  pathString: string
  matchedKey?: boolean
  matchedValue?: boolean
  snippet: string
}

export class JsonTreeModel {
  private _root: unknown
  private _treeRoot: JsonTreeNode | null = null

  constructor(initialData: unknown = {}) {
    this._root = initialData
    this._rebuildTree()
  }

  get root(): unknown {
    return this._root
  }

  get tree(): JsonTreeNode | null {
    return this._treeRoot
  }

  // ---- 查 (Query & Path Resolution) ----

  /**
   * 将字符串或数组路径规范化为数组路径
   * 支持形式：'$.users[0].name' 或 'users.0.name' 或 ['users', 0, 'name']
   */
  static normalizePath(pathInput: string | (string | number)[]): (string | number)[] {
    if (Array.isArray(pathInput)) return [...pathInput]
    let normalized = pathInput.trim()
    if (normalized.startsWith('$')) normalized = normalized.slice(1)
    if (normalized.startsWith('.')) normalized = normalized.slice(1)
    if (!normalized) return []

    const segments: (string | number)[] = []
    const regex = /\[(\d+)\]|([^.[\]]+)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(normalized)) !== null) {
      if (match[1] !== undefined) {
        segments.push(Number.parseInt(match[1], 10))
      } else if (match[2] !== undefined) {
        segments.push(match[2])
      }
    }
    return segments
  }

  static pathToString(path: (string | number)[]): string {
    if (path.length === 0) return '$'
    let str = '$'
    for (const segment of path) {
      if (typeof segment === 'number') {
        str += `[${segment}]`
      } else {
        str += `.${segment}`
      }
    }
    return str
  }

  getValueByPath(pathInput: string | (string | number)[]): unknown {
    const path = JsonTreeModel.normalizePath(pathInput)
    let current: any = this._root
    for (const seg of path) {
      if (current === null || current === undefined) return undefined
      current = current[seg]
    }
    return current
  }

  search(query: string, options: { caseSensitive?: boolean } = {}): JsonSearchMatch[] {
    const q = options.caseSensitive ? query : query.toLowerCase()
    if (!q) return []
    const results: JsonSearchMatch[] = []

    const walk = (node: JsonTreeNode) => {
      const keyStr = String(node.key)
      const targetKey = options.caseSensitive ? keyStr : keyStr.toLowerCase()
      const matchedKey = targetKey.includes(q)

      let matchedValue = false
      let snippet = ''
      if (node.type !== 'object' && node.type !== 'array') {
        const valStr = String(node.value)
        const targetVal = options.caseSensitive ? valStr : valStr.toLowerCase()
        if (targetVal.includes(q)) {
          matchedValue = true
          snippet = valStr
        }
      }

      if (matchedKey || matchedValue) {
        results.push({
          nodeId: node.id,
          pathString: node.pathString,
          matchedKey,
          matchedValue,
          snippet: snippet || keyStr,
        })
      }

      if (node.children) {
        for (const child of node.children) {
          walk(child)
        }
      }
    }

    if (this._treeRoot) walk(this._treeRoot)
    return results
  }

  // ---- 改 (Update) ----

  updateValueByPath(pathInput: string | (string | number)[], newValue: unknown): boolean {
    const path = JsonTreeModel.normalizePath(pathInput)
    if (path.length === 0) {
      this._root = newValue
      this._rebuildTree()
      return true
    }

    let current: any = this._root
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i]
      if (current === null || typeof current !== 'object') return false
      current = current[seg]
    }

    const lastSeg = path[path.length - 1]
    if (current === null || typeof current !== 'object') return false

    current[lastSeg] = newValue
    this._rebuildTree()
    return true
  }

  renameKey(parentPathInput: string | (string | number)[], oldKey: string, newKey: string): boolean {
    const parentPath = JsonTreeModel.normalizePath(parentPathInput)
    const target = parentPath.length === 0 ? this._root : this.getValueByPath(parentPath)
    if (target === null || typeof target !== 'object' || Array.isArray(target)) return false

    const obj = target as Record<string, unknown>
    if (!(oldKey in obj)) return false
    if (newKey === oldKey) return true

    const val = obj[oldKey]
    delete obj[oldKey]
    obj[newKey] = val
    this._rebuildTree()
    return true
  }

  // ---- 增 (Create) ----

  insertProperty(parentPathInput: string | (string | number)[], key: string, value: unknown): boolean {
    const parentPath = JsonTreeModel.normalizePath(parentPathInput)
    const target = parentPath.length === 0 ? this._root : this.getValueByPath(parentPath)
    if (target === null || typeof target !== 'object' || Array.isArray(target)) return false

    const obj = target as Record<string, unknown>
    obj[key] = value
    this._rebuildTree()
    return true
  }

  appendItem(parentPathInput: string | (string | number)[], value: unknown): boolean {
    const parentPath = JsonTreeModel.normalizePath(parentPathInput)
    const target = parentPath.length === 0 ? this._root : this.getValueByPath(parentPath)
    if (!Array.isArray(target)) return false

    target.push(value)
    this._rebuildTree()
    return true
  }

  // ---- 删 (Delete) ----

  deleteByPath(pathInput: string | (string | number)[]): boolean {
    const path = JsonTreeModel.normalizePath(pathInput)
    if (path.length === 0) {
      this._root = {}
      this._rebuildTree()
      return true
    }

    let current: any = this._root
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i]
      if (current === null || typeof current !== 'object') return false
      current = current[seg]
    }

    const lastSeg = path[path.length - 1]
    if (current === null || typeof current !== 'object') return false

    if (Array.isArray(current)) {
      if (typeof lastSeg !== 'number' || lastSeg < 0 || lastSeg >= current.length) return false
      current.splice(lastSeg, 1)
    } else {
      delete current[lastSeg]
    }

    this._rebuildTree()
    return true
  }

  // ---- 内部树构建 ----

  private _rebuildTree(): void {
    const buildNode = (val: unknown, key: string | number, path: (string | number)[]): JsonTreeNode => {
      const pathString = JsonTreeModel.pathToString(path)
      const id = pathString

      if (val === null) {
        return { id, key, path, pathString, type: 'null', value: null }
      }
      if (Array.isArray(val)) {
        const children = val.map((item, idx) => buildNode(item, idx, [...path, idx]))
        return {
          id,
          key,
          path,
          pathString,
          type: 'array',
          value: `[${val.length}]`,
          childCount: val.length,
          children,
        }
      }
      if (typeof val === 'object') {
        const entries = Object.entries(val as Record<string, unknown>)
        const children = entries.map(([k, v]) => buildNode(v, k, [...path, k]))
        return {
          id,
          key,
          path,
          pathString,
          type: 'object',
          value: `{${entries.length}}`,
          childCount: entries.length,
          children,
        }
      }
      return {
        id,
        key,
        path,
        pathString,
        type: typeof val as JsonValueType,
        value: val,
      }
    }

    this._treeRoot = buildNode(this._root, '$', [])
  }

  // ---- 解析与序列化 (Parse & Serialize) ----

  /**
   * 容错解析 JSON（支持处理末尾逗号与单引号容错）
   */
  static parse(text: string): JsonTreeModel {
    const trimmed = text.trim()
    if (!trimmed) {
      return new JsonTreeModel({})
    }
    try {
      return new JsonTreeModel(JSON.parse(trimmed))
    } catch {
      // 容错处理：替换单引号、移除末尾逗号
      try {
        const sanitized = trimmed
          .replace(/,\s*([}\]])/g, '$1') // 移除尾随逗号
          .replace(/'/g, '"') // 容错单引号
        return new JsonTreeModel(JSON.parse(sanitized))
      } catch (finalError) {
        throw new Error(`JSON 解析失败: ${(finalError as Error).message}`)
      }
    }
  }

  serialize(indent = 2): string {
    return JSON.stringify(this._root, null, indent)
  }

  toMinifiedString(): string {
    return JSON.stringify(this._root)
  }
}
