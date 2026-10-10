import type { InkdownMcpToolDefinition } from '@yitom/acp-client'
import type { MontreeSnapshotResource } from '@montree/contracts'
import type { ReaderVisualToolContext } from './reader-visual-tools'

const documentPath = { type: 'string', description: '当前文档完整路径，必须与读取结果一致' }
const revision = { type: 'integer', minimum: 0, description: '最近读取返回的文档版本；版本过期则拒绝修改' }
const target = { type: 'object', properties: {
  range: { type: 'string', description: 'A1 或 B2:D3，表头同样是普通单元格' },
  ranges: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
  selectionId: { type: 'string', description: 'montree_get_selection 返回的 target.selectionId' },
  row: { type: 'integer', minimum: 1 }, column: { type: 'string', description: 'A、B、AA 等列名' },
  start: { type: 'integer', minimum: 1 }, count: { type: 'integer', minimum: 1 },
}, additionalProperties: false, description: '仅指定range/ranges/selectionId/row/column之一；row或column必须提供start和count（均从1开始）' }
const value = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' },
  { type: 'object', properties: { formula: { type: 'string', description: 'Excel公式；CSV/TSV不支持' } }, required: ['formula'], additionalProperties: false }] }
const elementIds = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 }
const writeAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }

export const DOCUMENT_TOOLS: readonly InkdownMcpToolDefinition[] = [
  { name: 'montree_table_read', description: '读取当前CSV/TSV/XLSX的内存数据（含未保存修改）。不传sheet返回工作表目录与revision；传sheet和target返回地址、原值、显示值与公式，每次最多5000格。公式需在Excel中重算。', inputSchema: { type: 'object', properties: { documentPath, sheet: { type: 'string' }, target }, required: ['documentPath'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'montree_table_edit', description: '按精确地址或用户选区编辑当前表格，不自行解析文件。set需单个矩形和完全匹配的二维values；fill以value明确填充；clear清空内容。expectedCount必须等于目标格数（最多5000），重叠/过期/合并/数组公式目标拒绝。整批校验后一次修改，可撤销；不会自动保存。', inputSchema: { type: 'object', properties: { documentPath, revision, sheet: { type: 'string' }, target, operation: { type: 'string', enum: ['set', 'fill', 'clear'] }, values: { type: 'array', items: { type: 'array', items: value } }, value, expectedCount: { type: 'integer', minimum: 1, maximum: 5000 } }, required: ['documentPath', 'revision', 'sheet', 'target', 'operation', 'expectedCount'], additionalProperties: false }, annotations: writeAnnotations },
  { name: 'montree_ppt_read', description: '查询当前PPTX的幻灯片目录或指定slide（从1开始）的元素。返回原文件元素ID、类型、文字、位置/尺寸（磅）、支持的编辑操作及revision。只操作顶层元素；母版、主题、动画、组合内部和图表编辑尚不支持。', inputSchema: { type: 'object', properties: { documentPath, slide: { type: 'integer', minimum: 1 } }, required: ['documentPath'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'montree_ppt_edit', description: '按原始元素ID或selectionId修改当前PPTX元素。patch支持text、x/y/width/height（磅）、fontSize（磅）、color（#RRGGBB）。text替换文本体并沿用首段/首文字样式；图片仅支持位置尺寸。expectedCount须与唯一元素数一致。修改留在内存，可撤销，需显式保存。', inputSchema: { type: 'object', properties: { documentPath, revision, slide: { type: 'integer', minimum: 1 }, elementIds, selectionId: { type: 'string' }, expectedCount: { type: 'integer', minimum: 1, maximum: 100 }, patch: { type: 'object', properties: { text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 }, fontSize: { type: 'number', exclusiveMinimum: 0 }, color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' } }, additionalProperties: false } }, required: ['documentPath', 'revision', 'slide', 'expectedCount', 'patch'], additionalProperties: false }, annotations: writeAnnotations },
  { name: 'montree_ppt_delete', description: '删除当前PPTX中明确指定的顶层元素（elementIds或selectionId二选一），唯一匹配数量须等于expectedCount。被动画或连接线引用的元素拒绝删除。保留其他文件部件，可撤销，不自动保存。', inputSchema: { type: 'object', properties: { documentPath, revision, slide: { type: 'integer', minimum: 1 }, elementIds, selectionId: { type: 'string' }, expectedCount: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['documentPath', 'revision', 'slide', 'expectedCount'], additionalProperties: false }, annotations: writeAnnotations },
  { name: 'montree_document_undo', description: '撤销当前表格或PPT最近一次修改，返回新revision。不自动保存；仅在用户要求撤销或修正本次编辑时使用。', inputSchema: { type: 'object', properties: { documentPath, revision }, required: ['documentPath', 'revision'], additionalProperties: false }, annotations: writeAnnotations },
  { name: 'montree_document_save', description: '保存当前表格或PPT的内存修改到当前文件，不接受任意输出路径。Office保存前检查磁盘摘要，外部修改则拒绝覆盖。仅在用户要求修改/保存该文档时使用。', inputSchema: { type: 'object', properties: { documentPath, revision }, required: ['documentPath', 'revision'], additionalProperties: false }, annotations: writeAnnotations },
]

export async function callDocumentTool(name: string, context: ReaderVisualToolContext, args?: Record<string, unknown>) {
  const resources: Record<string, MontreeSnapshotResource> = { montree_table_read: 'table-read', montree_table_edit: 'table-edit', montree_ppt_read: 'slide-read', montree_ppt_edit: 'slide-edit', montree_ppt_delete: 'slide-edit', montree_document_save: 'document-save', montree_document_undo: 'document-undo' }
  const resource = resources[name]
  if (!resource) throw new Error('未知文档工具')
  const values = { ...args, ...(name === 'montree_ppt_edit' ? { operation: 'update' } : name === 'montree_ppt_delete' ? { operation: 'delete' } : {}) }
  return { content: [{ type: 'text' as const, text: await context.readSnapshot(resource, values) }] }
}
