import type { AppError, Result } from '@yitom/contracts'

export const ACP_ELICITATION_IPC = {
  event: 'acp:elicitation-event',
  respond: 'acp:elicitation-respond',
} as const

export interface ElicitationOption { const: string; title: string; description?: string | null }
export interface ElicitationField {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  title?: string | null
  description?: string | null
  default?: string | number | boolean | string[] | null
  enum?: string[] | null
  oneOf?: ElicitationOption[] | null
  items?: { type?: 'string'; enum?: string[]; anyOf?: ElicitationOption[] }
  minLength?: number | null
  maxLength?: number | null
  pattern?: string | null
  format?: string | null
  minimum?: number | null
  maximum?: number | null
  minItems?: number | null
  maxItems?: number | null
}
export interface ElicitationSchema {
  type?: 'object'
  title?: string | null
  description?: string | null
  properties?: Record<string, ElicitationField>
  required?: string[] | null
}
export type ElicitationContent = Record<string, string | number | boolean | string[]>
export type ElicitationResponse = { action: 'accept'; content: ElicitationContent } | { action: 'decline' | 'cancel' }
export interface ElicitationRequest {
  id: string
  sessionId?: string
  toolCallId?: string
  parentRequestId?: string | number
  message: string
  schema: ElicitationSchema
}
export type ElicitationEvent = { kind: 'request'; request: ElicitationRequest } | { kind: 'closed'; id: string }
export interface ElicitationReply { id: string; response: ElicitationResponse }
export interface AcpElicitationAPI {
  subscribe: (callback: (event: ElicitationEvent) => void) => () => void
  respond: (reply: ElicitationReply) => Promise<Result<void, AppError>>
}

export function elicitationOptions(field: ElicitationField): ElicitationOption[] | undefined {
  if (field.type === 'array') return field.items?.anyOf ?? field.items?.enum?.map(value => ({ const: value, title: value }))
  return field.oneOf ?? field.enum?.map(value => ({ const: value, title: value }))
}

/** Shared by the host and renderer: never acknowledge a form the UI cannot represent. */
export function validateElicitationSchema(schema: ElicitationSchema): string | undefined {
  if (!schema || typeof schema !== 'object' || (schema.type != null && schema.type !== 'object')) return '不支持的表单结构'
  const fields = schema.properties ?? {}
  if (typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length > 40) return '表单字段过多或格式无效'
  if (schema.required != null && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(fields, key)))) return '必填字段无效'
  for (const field of Object.values(fields)) {
    if (!field || !['string', 'number', 'integer', 'boolean', 'array'].includes(field.type)) return '不支持的表单字段类型'
    const options = elicitationOptions(field)
    if (field.type === 'array' && !options) return '多选字段缺少选项'
    if (options && (!Array.isArray(options) || options.length > 100 || options.some(option => typeof option.const !== 'string' || typeof option.title !== 'string') || new Set(options.map(option => option.const)).size !== options.length)) return '选项格式无效'
    if (field.format && !['email', 'uri', 'date', 'date-time'].includes(field.format)) return '不支持的输入格式'
    if ([field.title, field.description, field.pattern, field.format].some(value => value != null && typeof value !== 'string')) return '字段说明格式无效'
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
      const value = field[key]
      if (value != null && (!Number.isSafeInteger(value) || value < 0)) return '字段限制无效'
    }
    if ([field.minimum, field.maximum].some(value => value != null && (typeof value !== 'number' || !Number.isFinite(value)))) return '数值范围无效'
    for (const [minimum, maximum] of [[field.minLength, field.maxLength], [field.minItems, field.maxItems], [field.minimum, field.maximum]]) {
      if (minimum != null && maximum != null && minimum > maximum) return '字段范围无效'
    }
    if (field.pattern) { try { new RegExp(field.pattern, 'u') } catch { return '输入校验规则无效' } }
    if (field.default != null && validateElicitationContent({ properties: { value: field } }, { value: field.default })) return '字段默认值无效'
  }
}

export function validateElicitationContent(schema: ElicitationSchema, content: ElicitationContent): string | undefined {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return '答案格式无效'
  const fields = schema.properties ?? {}
  if (Object.keys(content).some(key => !Object.hasOwn(fields, key))) return '答案含未知字段'
  for (const [key, field] of Object.entries(fields)) {
    const value = Object.hasOwn(content, key) ? content[key] : undefined
    const label = field.title || key
    if (value === undefined) {
      if (schema.required?.includes(key)) return `请填写${label}`
      continue
    }
    const options = elicitationOptions(field)
    if (field.type === 'string') {
      if (typeof value !== 'string') return `${label}需要文字`
      const length = [...value].length
      if ((field.minLength != null && length < field.minLength) || (field.maxLength != null && length > field.maxLength)) return `${label}长度不符合要求`
      if (options && !options.some(option => option.const === value)) return `${label}选项无效`
      if (field.pattern && !new RegExp(field.pattern, 'u').test(value)) return `${label}格式不符合要求`
      if (field.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `${label}需要有效邮箱`
      if (field.format === 'uri') { try { new URL(value) } catch { return `${label}需要有效 URL` } }
      if (field.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return `${label}需要有效日期`
      if (field.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value)))) return `${label}需要含时区的日期时间`
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') return `${label}需要是或否`
    } else if (field.type === 'array') {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !options?.some(option => option.const === item)) || new Set(value).size !== value.length) return `${label}多选答案无效`
      if ((field.minItems != null && value.length < field.minItems) || (field.maxItems != null && value.length > field.maxItems)) return `${label}选择数量不符合要求`
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) return `${label}需要有效${field.type === 'integer' ? '整数' : '数字'}`
      if ((field.minimum != null && value < field.minimum) || (field.maximum != null && value > field.maximum)) return `${label}超出允许范围`
    }
  }
}
