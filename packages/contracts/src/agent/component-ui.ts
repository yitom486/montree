/**
 * `montree_present(kind=component-ui)` 生成式 UI 组件树契约（G1）。
 *
 * 模型经 MCP 工具提交 JSON 界面描述，宿主用官方 `GenerativeUIRender`
 *（`@assistant-ui/react@0.15.27` 已含，无需新增依赖/替换运行时）渲染。
 * 树形状与官方 `GenerativeUISpec` 同形：
 * `{ component, props?, children?, key? }`，仅白名单组件可渲染。
 * 校验与渲染共用同一入口，两端行为一致；未知组件/动作与超限一律
 * 返回可读错误，不执行、不截断后运行。不传函数/JSX/任意 IPC 名。
 */

export const COMPONENT_UI_SCHEMA_VERSION = 1 as const
/** 模型输入整体 UTF-8 上限（MCP 请求体 256KiB，留封装余量） */
export const COMPONENT_UI_MAX_BYTES = 96 * 1024
/** 树深度上限（官方渲染器内部为 64，此处更严，防模型失控） */
export const COMPONENT_UI_MAX_DEPTH = 12
/** 元素总数上限（含文本叶） */
export const COMPONENT_UI_MAX_NODES = 200
/** 单文本上限（字符） */
export const COMPONENT_UI_MAX_TEXT_CHARS = 4000
/** 可提交表单值总量上限（UTF-8 字节） */
export const COMPONENT_UI_MAX_SUBMIT_BYTES = 8 * 1024

/** 首批白名单组件（G2 按官方包实际能力命名，复用 shadcn/主题） */
export const COMPONENT_UI_COMPONENTS = [
  'Card',
  'Row',
  'Column',
  'Text',
  'Select',
  'Button',
  'Evidence',
] as const
export type ComponentUiComponentName = (typeof COMPONENT_UI_COMPONENTS)[number]

/** 首批白名单动作：本地选择提交与原文定位，不含写入/删除/任意 IPC */
export const COMPONENT_UI_ACTIONS = ['submit-selection', 'locate'] as const
export type ComponentUiAction = (typeof COMPONENT_UI_ACTIONS)[number]

export interface ComponentUiNode {
  component: ComponentUiComponentName
  props?: Record<string, unknown>
  children?: ComponentUiNode[] | ComponentUiNode | string | number
  key?: string
}

export interface ComponentUiSpec {
  root: ComponentUiNode | ComponentUiNode[] | string | number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTrimmedString(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxChars) return null
  return trimmed
}

function countNodes(node: unknown, depth: number): { count: number; maxDepth: number } | null {
  if (depth > COMPONENT_UI_MAX_DEPTH) return null
  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node)
    if (text.length > COMPONENT_UI_MAX_TEXT_CHARS) return null
    return { count: 1, maxDepth: depth }
  }
  if (Array.isArray(node)) {
    let count = 0
    let max = depth
    for (const child of node) {
      const sub = countNodes(child, depth + 1)
      if (!sub) return null
      count += sub.count
      max = Math.max(max, sub.maxDepth)
      if (count > COMPONENT_UI_MAX_NODES) return null
    }
    return { count, maxDepth: max }
  }
  if (!isRecord(node)) return null
  const { component, props, children, key } = node as {
    component?: unknown
    props?: unknown
    children?: unknown
    key?: unknown
  }
  if (typeof component !== 'string') return null
  if (!(COMPONENT_UI_COMPONENTS as readonly string[]).includes(component)) return null
  if (key !== undefined && (typeof key !== 'string' || !key.trim() || key.length > 120)) return null
  if (props !== undefined && !isRecord(props)) return null
  const propError = validateComponentProps(component as ComponentUiComponentName, props)
  if (propError) return null
  let count = 1
  let max = depth
  if (children !== undefined) {
    const list = Array.isArray(children) ? children : [children]
    for (const child of list) {
      const sub = countNodes(child, depth + 1)
      if (!sub) return null
      count += sub.count
      max = Math.max(max, sub.maxDepth)
      if (count > COMPONENT_UI_MAX_NODES) return null
    }
  }
  if (count > COMPONENT_UI_MAX_NODES) return null
  return { count, maxDepth: max }
}

function validateSelectOptions(options: unknown): string | null {
  if (!Array.isArray(options) || options.length < 1 || options.length > 20) {
    return 'Select.options 须为 1–20 项'
  }
  const seen = new Set<string>()
  for (const row of options) {
    if (!isRecord(row)) return 'Select.options 项须为对象'
    const value = asTrimmedString(row.value, 120)
    const label = asTrimmedString(row.label, 200)
    if (!value || !label) return 'Select.options 项须含 value/label 非空文本'
    if (seen.has(value)) return `Select.options value 重复：${value}`
    seen.add(value)
    if (row.description !== undefined) {
      if (typeof row.description !== 'string' || row.description.trim().length > 500) {
        return 'Select.options description 须为 ≤500 字文本'
      }
    }
  }
  return null
}

/**
 * 组件属性白名单校验；失败返回中文原因，成功返回 null。
 * 仅校验形状与上限，不校验业务语义（如章节归属由 builder 验证摘录）。
 */
export function validateComponentProps(
  component: ComponentUiComponentName,
  props: unknown,
): string | null {
  if (props === undefined || props === null) {
    return component === 'Text' || component === 'Select' || component === 'Button' || component === 'Evidence'
      ? `${component} 需要 props`
      : null
  }
  if (!isRecord(props)) return `${component}.props 须为对象`
  const allowed: Record<ComponentUiComponentName, string[]> = {
    Card: ['title', 'description'], Row: ['gap'], Column: ['gap'], Text: ['text', 'variant'],
    Select: ['id', 'label', 'options', 'multi', 'defaultValue'],
    Button: ['label', 'action', 'variant', 'chapterKey', 'excerpt'],
    Evidence: ['excerpt', 'chapterKey', 'chapterLabel'],
  }
  if (Object.keys(props).some(key => !allowed[component].includes(key))) return `${component} 包含未知属性`
  switch (component) {
    case 'Card': {
      if (props.title !== undefined && asTrimmedString(props.title, 200) === null) {
        return 'Card.title 须为 1–200 字文本'
      }
      if (props.description !== undefined) {
        if (typeof props.description !== 'string' || !props.description.trim() || props.description.trim().length > 2000) {
          return 'Card.description 须为 1–2000 字文本'
        }
      }
      return null
    }
    case 'Row':
    case 'Column': {
      if (props.gap !== undefined && props.gap !== 'sm' && props.gap !== 'md' && props.gap !== 'lg') {
        return `${component}.gap 须为 sm/md/lg`
      }
      return null
    }
    case 'Text': {
      if (asTrimmedString(props.text, COMPONENT_UI_MAX_TEXT_CHARS) === null) {
        return `Text.text 须为 1–${COMPONENT_UI_MAX_TEXT_CHARS} 字文本`
      }
      if (props.variant !== undefined && props.variant !== 'title' && props.variant !== 'body' && props.variant !== 'caption' && props.variant !== 'muted') {
        return 'Text.variant 须为 title/body/caption/muted'
      }
      return null
    }
    case 'Select': {
      if (asTrimmedString(props.id, 120) === null) return 'Select.id 须为非空文本'
      if (['__proto__', 'constructor', 'prototype'].includes(String(props.id))) return 'Select.id 不允许保留字段名'
      if (props.label !== undefined && asTrimmedString(props.label, 200) === null) {
        return 'Select.label 须为 1–200 字文本'
      }
      const optError = validateSelectOptions(props.options)
      if (optError) return optError
      if (props.multi !== undefined && typeof props.multi !== 'boolean') return 'Select.multi 须为布尔'
      if (props.defaultValue !== undefined) {
        const values = props.multi === true ? props.defaultValue : [props.defaultValue]
        if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !(props.options as Array<{ value: string }>).some(option => option.value === value))) return 'Select.defaultValue 须匹配 options'
      }
      return null
    }
    case 'Button': {
      if (asTrimmedString(props.label, 200) === null) return 'Button.label 须为 1–200 字文本'
      if (typeof props.action !== 'string' || !(COMPONENT_UI_ACTIONS as readonly string[]).includes(props.action)) {
        return 'Button.action 须为 submit-selection/locate'
      }
      if (props.variant !== undefined && props.variant !== 'default' && props.variant !== 'secondary' && props.variant !== 'outline') {
        return 'Button.variant 须为 default/secondary/outline'
      }
      if (props.action === 'locate') {
        if (asTrimmedString(props.chapterKey, 120) === null) return 'locate Button 需要 chapterKey'
        if (asTrimmedString(props.excerpt, 2000) === null) return 'locate Button 需要 excerpt 原文'
      }
      return null
    }
    case 'Evidence': {
      if (asTrimmedString(props.excerpt, 2000) === null) return 'Evidence.excerpt 须为 1–2000 字原文'
      if (asTrimmedString(props.chapterKey, 120) === null) return 'Evidence.chapterKey 须为非空文本'
      if (props.chapterLabel !== undefined && asTrimmedString(props.chapterLabel, 200) === null) {
        return 'Evidence.chapterLabel 须为 1–200 字文本'
      }
      return null
    }
    default:
      return `未知组件：${component}`
  }
}

/** 树整体校验；失败返回中文原因，成功返回 null */
export function validateComponentUiSpec(spec: unknown): string | null {
  if (!isRecord(spec)) return 'ui 须为对象（含 root）'
  const root = (spec as { root?: unknown }).root
  if (root === undefined) return 'ui.root 缺失'
  const counted = countNodes(root, 0)
  if (!counted) {
    return `ui 树非法：未知组件、属性越界、单文本超 ${COMPONENT_UI_MAX_TEXT_CHARS} 字、深度超 ${COMPONENT_UI_MAX_DEPTH} 或节点超 ${COMPONENT_UI_MAX_NODES}`
  }
  const selectError = collectSelectIds(root).error
  if (selectError) return selectError
  return null
}

/** 收集所有 Select.id（提交字段名），重复即非法 */
export function collectSelectIds(root: unknown): { ids: string[]; error?: string } {
  const ids: string[] = []
  const seen = new Set<string>()
  const visit = (node: unknown): string | null => {
    if (typeof node === 'string' || typeof node === 'number' || node == null) return null
    if (Array.isArray(node)) {
      for (const child of node) {
        const err = visit(child)
        if (err) return err
      }
      return null
    }
    if (!isRecord(node)) return '树节点须为对象/数组/文本'
    const { component, props, children } = node as { component?: unknown; props?: unknown; children?: unknown }
    if (component === 'Select') {
      const id = isRecord(props) && typeof props.id === 'string' ? props.id.trim() : ''
      if (!id) return 'Select.id 缺失'
      if (seen.has(id)) return `Select.id 重复：${id}`
      seen.add(id)
      ids.push(id)
    }
    if (children !== undefined) {
      const list = Array.isArray(children) ? children : [children]
      for (const child of list) {
        const err = visit(child)
        if (err) return err
      }
    }
    return null
  }
  const error = visit(root)
  return error ? { ids: [], error } : { ids }
}

/** 收集所有 Evidence 引用与 locate Button 引用（builder 逐条验摘录） */
export function collectEvidenceRefs(root: unknown): Array<{ excerpt: string; chapterKey: string }> {
  const refs: Array<{ excerpt: string; chapterKey: string }> = []
  const visit = (node: unknown): void => {
    if (typeof node === 'string' || typeof node === 'number' || node == null) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (!isRecord(node)) return
    const { component, props, children } = node as { component?: unknown; props?: unknown; children?: unknown }
    if (component === 'Evidence' && isRecord(props)) {
      const excerpt = typeof props.excerpt === 'string' ? props.excerpt : ''
      const chapterKey = typeof props.chapterKey === 'string' ? props.chapterKey : ''
      if (excerpt && chapterKey) refs.push({ excerpt, chapterKey })
    }
    if (component === 'Button' && isRecord(props) && props.action === 'locate') {
      const excerpt = typeof props.excerpt === 'string' ? props.excerpt : ''
      const chapterKey = typeof props.chapterKey === 'string' ? props.chapterKey : ''
      if (excerpt && chapterKey) refs.push({ excerpt, chapterKey })
    }
    if (children !== undefined) {
      const list = Array.isArray(children) ? children : [children]
      for (const child of list) visit(child)
    }
  }
  visit(root)
  return refs
}

export function componentUiUtf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}
