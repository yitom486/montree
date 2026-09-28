import type {
  InkdownSnapshotArgs,
  InkdownSnapshotResource,
} from "../contracts"

export interface InkdownMcpToolContext {
  /** 复用 ACP 快照回路：向渲染进程要内存快照 */
  readSnapshot: (
    resource: InkdownSnapshotResource,
    args?: InkdownSnapshotArgs,
  ) => Promise<string>
}

export interface InkdownMcpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** MCP tool annotations consumed by capable agents for safety/parallelism hints. */
  annotations?: InkdownMcpToolAnnotations
}

/** MCP ToolAnnotations (hints, not an authorization mechanism). */
export interface InkdownMcpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

const READER_FORMATS =
  'EPUB/PDF/MOBI/AZW3 与在线文档（web URL，阅读模式抓取的正文）'

export type InkdownReadScope = 'toc' | 'viewport' | 'current' | 'chapter' | 'search'

export type InkdownMarkListFilter = 'all' | 'highlights' | 'bookmarks'

const READ_SCOPE_ENUM = ['toc', 'viewport', 'current', 'chapter', 'search'] as const

const MARK_LIST_FILTER_ENUM = ['all', 'highlights', 'bookmarks'] as const

export const INKDOWN_MCP_TOOLS: InkdownMcpToolDefinition[] = [
  {
    name: 'inkdown_read',
    annotations: {
      title: 'Read Inkdown document',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      `读取当前打开的 ${READER_FORMATS} 内容（不含用户选区；选区用 inkdown_get_selection）。` +
      'scope 含义：toc=目录结构；viewport=当前视口约一屏（优先于整章）；current=当前章/页全文；' +
      'chapter=指定 TOC 章/页（需 flatIndex 或 title，不跳转）；search=全书关键词检索（需 query）。' +
      '正文 escalation：viewport → current → chapter；结构用 toc；「哪里提到 X」用 search；' +
      '「这页/这章」不要直接用 current，先看线程里是否已有内容。' +
      'scope=search 的 JSON 含 source=memory|index，以及 preciseTotal=false' +
      '（精确 corpus total 只用 inkdown_inspect_content）。\n' +
      '已入库 PDF（罗盘索引已建）：所有读取只读索引；缺页返回 error（不是空成功）——' +
      '告知用户，不要重试指望 OCR 补上，也不要凭记忆编造该页内容；请用户重建索引。\n' +
      '未入库扫描/混合 PDF：search / inspect_content 会报错而不整书 OCR；' +
      'viewport/current/chapter 可按需单页 OCR（首次 10–30 秒，缓存后即时）。\n' +
      '正文前缀【PDF 第 N/M 页】标识真实读到的页——永远信任该页头，' +
      '不要用其他页或记忆的内容替代；OCR 失败返回 error，提示用户「识别本页」或重建索引。',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: READ_SCOPE_ENUM,
          description: '读取范围',
        },
        flatIndex: {
          type: 'number',
          description: 'scope=chapter 时：目录 flatIndex（与 toc.entries[].index 一致）',
        },
        title: {
          type: 'string',
          description: 'scope=chapter 时：章节标题（可与 flatIndex 二选一，支持包含匹配）',
        },
        query: {
          type: 'string',
          description: 'scope=search 时：检索关键词（取自原文用词）',
        },
      },
      required: ['scope'],
      additionalProperties: false,
    },
  },
  {
    name: 'inkdown_inspect_content',
    annotations: {
      title: 'Inspect indexed content',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      '块级取证：按字面关键词返回至多 10 条内容证据（原文、命中位置 start/end/middle/multiple、精确总数与截断标记）。' +
      '覆盖：当前打开且已入库的 PDF（book-index：PDF 页码、章节标题、block id）、' +
      '当前 md（editor-buffer：行号，有文件夹时兼 workspace-file 相对路径）、' +
      '当前 EPUB/MOBI（ebook-section：章节标题定位）。' +
      '专供审计残留命中（如清洗后是否还有「王道计」、命中是正文还是水印碎片）；章节级阅读仍用 inkdown_read。' +
      '只读，不建库、不 OCR；已入库 PDF 仅读罗盘索引，缺索引直接报错（不要重试指望 OCR），未入库或参数错误也会报错。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '字面检索词，至少 3 个字符',
        },
        limit: {
          type: 'number',
          description: '展示条数 1–10，默认 10（只截断展示，不影响总数）',
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'inkdown_get_selection',
    annotations: {
      title: 'Get current selection',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      '获取用户当前选中的文本（高频独立工具）。若选区较短（≤30 字），仅向前后各补约 30 字作为 excerpt。' +
      '仅当 turn-context 出现 hasSelection=true（本轮新划选）时几乎必调；无此标记时不要调。' +
      '用户划选即优先分析该段；选区通知只生效一轮；无选区时会报错。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'inkdown_list_marks',
    annotations: {
      title: 'List reading marks',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      '列出当前打开文档的阅读标记。filter=all（默认）=书签+高亮+批注；highlights=仅划重点（高亮与带摘录批注，含 passages）；' +
      'bookmarks=仅书签。用于 EPUB/PDF/MOBI/在线文档。',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: MARK_LIST_FILTER_ENUM,
          description: 'all | highlights | bookmarks；默认 all',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'inkdown_suggest_chapters',
    annotations: {
      title: 'Suggest chapters to mark',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      '提交章级划重点建议供用户点选（不写 marks、不调 propose_mark）。' +
      '先 inkdown_read(scope=toc)；再提交 2～5 章，每章含 flatIndex、title、reason。' +
      '用户点选一章后，再 read(scope=chapter) + inkdown_propose_mark(marks)，单批≤10。' +
      '禁止：跳过用户点选、整书范围内提建议、一次批量超限。',
    inputSchema: {
      type: 'object',
      properties: {
        chapters: {
          type: 'array',
          description: '建议划重点的章节（2～5 条为宜）',
          minItems: 1,
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              flatIndex: { type: 'number', description: '与 toc.entries[].index 一致' },
              title: { type: 'string', description: '章节标题' },
              reason: { type: 'string', description: '一句推荐理由' },
            },
            required: ['flatIndex', 'title', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['chapters'],
      additionalProperties: false,
    },
  },
  {
    name: 'inkdown_create_bookmark',
    annotations: {
      title: 'Create bookmark',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      '在当前阅读位置创建书签（不跳转）。用户明确要求「加个书签」时调用；仅 EPUB/PDF/MOBI。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'inkdown_propose_mark',
    annotations: {
      title: 'Propose highlight or note',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      '唯一标记提议工具（高亮 / 批注 / 批量，不入库；用户「采用」后才写入）。' +
      '单条：excerpt（原句或口述关键词）+ 可选 note（空=仅高亮）+ 可选 kind=highlight|note|auto + 可选 flatIndex。' +
      '有 fresh 选区时也可只传 note（用当前选区定位）。' +
      '批量：marks 数组（每项同单条字段，单批≤10，客户端截断超出部分）。' +
      '客户端读正文并模糊匹配原句；建议先 inkdown_read(scope=viewport) 或 scope=chapter。' +
      '仅在用户明确要求保存高亮/批注时调用；不要未经提示发明标记，也不要整书到处提议。',
    inputSchema: {
      type: 'object',
      properties: {
        excerpt: {
          type: 'string',
          description: '单条：要高亮/批注的原文或口述片段',
        },
        note: {
          type: 'string',
          description: '批注正文；省略或空字符串则仅高亮',
        },
        kind: {
          type: 'string',
          enum: ['highlight', 'note', 'auto'],
          description: 'highlight=仅高亮；note=批注；auto=由 note 是否为空推断（默认）',
        },
        flatIndex: {
          type: 'number',
          description: '可选：目录 flatIndex',
        },
        marks: {
          type: 'array',
          description: '批量提议（≤10）；与 excerpt 二选一，优先 marks',
          items: {
            type: 'object',
            properties: {
              excerpt: { type: 'string' },
              note: { type: 'string' },
              kind: { type: 'string', enum: ['highlight', 'note', 'auto'] },
              flatIndex: { type: 'number' },
            },
            required: ['excerpt'],
            additionalProperties: false,
          },
          maxItems: 10,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'inkdown_generate_diagram',
    annotations: {
      title: 'Generate visualization diagram',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      '生成 Mermaid 可视化图解（时序图、流程图、状态机、实体关系网络或章节思维导图）。' +
      '当读者询问复杂交互时序（如握手协议流程）、概念实体网络、算法状态机或全章宏观导图时调用。' +
      '客户端将渲染悬浮卡片并支持双向高亮与「钉入正文」。' +
      'mermaidCode 仅提供图表纯语法，不要包含 ```mermaid 围栏标记。',
    inputSchema: {
      type: 'object',
      properties: {
        diagramType: {
          type: 'string',
          enum: ['sequence', 'flowchart', 'mindmap', 'stateDiagram', 'classDiagram', 'erDiagram'],
          description:
            '图表类型：sequence=时序交互；flowchart=流程决策；mindmap=思维导图；stateDiagram=状态机；classDiagram=类关系；erDiagram=实体网络',
        },
        title: {
          type: 'string',
          description: '图表标题（如：ACP 握手与能力协商时序图）',
        },
        mermaidCode: {
          type: 'string',
          description: '标准 Mermaid 语法图表代码（不要加 ``` 围栏）',
        },
        anchorExcerpt: {
          type: 'string',
          description: '可选：该图表所对应的正文关键原文片段（用于点击穿透高亮）',
        },
        summary: {
          type: 'string',
          description: '可选：该图表的核心要点解读（1–2 句话）',
        },
        visualSteps: {
          type: 'array',
          description:
            '可选：结构化交互式卡片步骤流（提供更现代、可展开参数、可点击正文穿透高亮的卡片视觉）',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: '发起方角色（如：client, agent, user, server）' },
              to: { type: 'string', description: '接收方角色（如：agent, client, database）' },
              action: { type: 'string', description: '动作或方法名（如：1. initialize）' },
              desc: { type: 'string', description: '该步骤的关键说明' },
              payload: { type: 'string', description: '可选：该步骤传输的代码或 JSON 参数详情' },
              anchorExcerpt: {
                type: 'string',
                description: '可选：该步骤对应的正文片段（用于点击穿透高亮）',
              },
            },
            required: ['from', 'to', 'action'],
            additionalProperties: false,
          },
        },
      },
      required: ['diagramType', 'title', 'mermaidCode'],
      additionalProperties: false,
    },
  },
  {
    name: 'inkdown_cross_reference',
    annotations: {
      title: 'Cross reference entity tracker',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      '全书跨章节实体/概念流转脉络追踪。检索关键技术变量、哲学概念或历史人物在本书各章节的提及分布与上下文证据链。' +
      '返回按章节组织的证据列表，用于梳理脉络或进行跨章比对。',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: {
          type: 'string',
          description: '追踪的目标实体或概念名称（至少 2 字符，取自原文）',
        },
        maxPerChapter: {
          type: 'number',
          description: '每章最多展示的引用片段数（1–5，默认 3）',
          minimum: 1,
          maximum: 5,
        },
      },
      required: ['entityName'],
      additionalProperties: false,
    },
  },
]

export interface InkdownMcpToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function parseReadScope(value: unknown): InkdownReadScope | null {
  if (typeof value !== 'string') return null
  return READ_SCOPE_ENUM.includes(value as InkdownReadScope)
    ? (value as InkdownReadScope)
    : null
}

function parseMarkListFilter(value: unknown): InkdownMarkListFilter {
  if (value === 'highlights' || value === 'bookmarks') return value
  return 'all'
}

async function callInkdownRead(
  context: InkdownMcpToolContext,
  scope: InkdownReadScope,
  args?: Record<string, unknown>,
): Promise<InkdownMcpToolResult> {
  switch (scope) {
    case 'toc': {
      const text = await context.readSnapshot('toc.json')
      return { content: [{ type: 'text', text }] }
    }
    case 'viewport': {
      const text = await context.readSnapshot('viewport.txt')
      return { content: [{ type: 'text', text }] }
    }
    case 'current': {
      const text = await context.readSnapshot('chapter.txt')
      return { content: [{ type: 'text', text }] }
    }
    case 'chapter': {
      const flatIndex = args?.flatIndex
      const title = args?.title
      if (
        (typeof flatIndex !== 'number' || !Number.isFinite(flatIndex)) &&
        (typeof title !== 'string' || !title.trim())
      ) {
        return {
          content: [
            {
              type: 'text',
              text: 'inkdown_read(scope=chapter) 需要 flatIndex 或 title 之一',
            },
          ],
          isError: true,
        }
      }
      const text = await context.readSnapshot('chapter', {
        ...(typeof flatIndex === 'number' ? { flatIndex } : {}),
        ...(typeof title === 'string' ? { title } : {}),
      })
      return { content: [{ type: 'text', text }] }
    }
    case 'search': {
      const query = args?.query
      if (typeof query !== 'string' || !query.trim()) {
        return {
          content: [
            { type: 'text', text: 'inkdown_read(scope=search) 需要非空的 query 参数' },
          ],
          isError: true,
        }
      }
      const text = await context.readSnapshot('search', { query })
      return { content: [{ type: 'text', text }] }
    }
  }
}

export async function callInkdownMcpTool(
  name: string,
  context: InkdownMcpToolContext,
  args?: Record<string, unknown>,
): Promise<InkdownMcpToolResult> {
  switch (name) {
    case 'inkdown_read': {
      const scope = parseReadScope(args?.scope)
      if (!scope) {
        return {
          content: [
            {
              type: 'text',
              text: 'inkdown_read 需要 scope: toc | viewport | current | chapter | search',
            },
          ],
          isError: true,
        }
      }
      return callInkdownRead(context, scope, args)
    }
    case 'inkdown_get_toc':
      return callInkdownRead(context, 'toc', args)
    case 'inkdown_get_viewport':
      return callInkdownRead(context, 'viewport', args)
    case 'inkdown_get_current_text':
      return callInkdownRead(context, 'current', args)
    case 'inkdown_get_chapter':
      return callInkdownRead(context, 'chapter', args)
    case 'inkdown_search':
      return callInkdownRead(context, 'search', args)
    case 'inkdown_inspect_content': {
      const query = args?.query
      if (typeof query !== 'string' || !query.trim()) {
        return {
          content: [{ type: 'text', text: 'inkdown_inspect_content 需要非空的 query 参数' }],
          isError: true,
        }
      }
      const limit = args?.limit
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit))) {
        return {
          content: [{ type: 'text', text: 'inkdown_inspect_content 的 limit 须为数字（1–10）' }],
          isError: true,
        }
      }
      // 隔离：只透传 query/limit；即使模型附带 fingerprint/路径/SQL 也一律丢弃，
      // 查询绑定由渲染端快照侧完成
      const text = await context.readSnapshot('content-audit', {
        query,
        ...(limit === undefined ? {} : { limit }),
      })
      return { content: [{ type: 'text', text }] }
    }
    case 'inkdown_get_selection': {
      const text = await context.readSnapshot('selection')
      return { content: [{ type: 'text', text }] }
    }
    case 'inkdown_list_marks': {
      const filter = parseMarkListFilter(args?.filter)
      const text = await context.readSnapshot('marks', { filter })
      return { content: [{ type: 'text', text }] }
    }
    case 'inkdown_list_highlights': {
      const text = await context.readSnapshot('marks', { filter: 'highlights' })
      return { content: [{ type: 'text', text }] }
    }
    case 'inkdown_create_bookmark': {
      const text = await context.readSnapshot('create-bookmark')
      return { content: [{ type: 'text', text }] }
    }
    case 'inkdown_create_note':
    case 'inkdown_propose_note': {
      const note = typeof args?.note === 'string' ? args.note : ''
      const text = await context.readSnapshot('propose-mark', { note })
      return { content: [{ type: 'text', text }] }
    }
    case 'inkdown_suggest_chapters': {
      const chapters = args?.chapters
      if (!Array.isArray(chapters) || chapters.length === 0) {
        return {
          content: [{ type: 'text', text: 'inkdown_suggest_chapters 需要非空 chapters 数组' }],
          isError: true,
        }
      }
      const text = await context.readSnapshot('suggest-chapters', { chapters })
      return { content: [{ type: 'text', text }] }
    }
    case 'inkdown_propose_mark': {
      const marks = args?.marks
      const excerpt = args?.excerpt
      const noteOnly = typeof args?.note === 'string' && args.note.trim()
      if (
        (!Array.isArray(marks) || marks.length === 0) &&
        (typeof excerpt !== 'string' || !excerpt.trim()) &&
        !noteOnly
      ) {
        return {
          content: [
            {
              type: 'text',
              text: 'inkdown_propose_mark 需要 excerpt、marks 之一，或有选区时仅传 note',
            },
          ],
          isError: true,
        }
      }
      const note = typeof args?.note === 'string' ? args.note : ''
      const flatIndex = args?.flatIndex
      const kind = args?.kind
      const text = await context.readSnapshot('propose-mark', {
        ...(typeof excerpt === 'string' ? { excerpt } : {}),
        note,
        kind: kind === 'highlight' || kind === 'note' || kind === 'auto' ? kind : undefined,
        ...(typeof flatIndex === 'number' && Number.isFinite(flatIndex) ? { flatIndex } : {}),
        ...(Array.isArray(marks) ? { marks } : {}),
      })
      return { content: [{ type: 'text', text }] }
    }
    case 'inkdown_generate_diagram': {
      const diagramType = args?.diagramType
      const title = args?.title
      const mermaidCode = args?.mermaidCode
      const anchorExcerpt =
        typeof args?.anchorExcerpt === 'string' ? args.anchorExcerpt.trim() : undefined
      const summary = typeof args?.summary === 'string' ? args.summary.trim() : undefined

      const validTypes = [
        'sequence',
        'flowchart',
        'mindmap',
        'stateDiagram',
        'classDiagram',
        'erDiagram',
      ]
      if (typeof diagramType !== 'string' || !validTypes.includes(diagramType)) {
        return {
          content: [
            {
              type: 'text',
              text: `inkdown_generate_diagram 需要有效的 diagramType: ${validTypes.join(', ')}`,
            },
          ],
          isError: true,
        }
      }
      if (typeof title !== 'string' || !title.trim()) {
        return {
          content: [
            {
              type: 'text',
              text: 'inkdown_generate_diagram 需要非空的 title 参数',
            },
          ],
          isError: true,
        }
      }
      if (typeof mermaidCode !== 'string' || !mermaidCode.trim()) {
        return {
          content: [
            {
              type: 'text',
              text: 'inkdown_generate_diagram 需要非空的 mermaidCode 参数',
            },
          ],
          isError: true,
        }
      }

      // 清洗可能意外包含的 ```mermaid 围栏、首行纯 mermaid\n 以及包裹的反引号
      const cleanedCode = mermaidCode
        .replace(/^```(?:mermaid)?[\r\n]*/i, '')
        .replace(/^mermaid[\r\n]+/i, '')
        .replace(/[\r\n]*```\s*$/i, '')
        .trim()

      const visualSteps = Array.isArray(args?.visualSteps) ? args.visualSteps : undefined

      const payload = {
        diagramId: `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        diagramType,
        title: title.trim(),
        mermaidCode: cleanedCode,
        ...(anchorExcerpt ? { anchorExcerpt } : {}),
        ...(summary ? { summary } : {}),
        ...(visualSteps ? { visualSteps } : {}),
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      }
    }
    case 'inkdown_cross_reference': {
      const entityName = args?.entityName
      if (typeof entityName !== 'string' || entityName.trim().length < 2) {
        return {
          content: [
            {
              type: 'text',
              text: 'inkdown_cross_reference 需要至少 2 个字符的 entityName 参数',
            },
          ],
          isError: true,
        }
      }
      const rawText = await context.readSnapshot('search', { query: entityName.trim() })
      try {
        const parsed = JSON.parse(rawText)
        const maxPerChapter =
          typeof args?.maxPerChapter === 'number' &&
          args.maxPerChapter >= 1 &&
          args.maxPerChapter <= 5
            ? Math.floor(args.maxPerChapter)
            : 3

        interface RawHit {
          title?: string
          flatIndex?: number
          snippet?: string
          count?: number
        }

        const hits: RawHit[] = Array.isArray(parsed.hits) ? parsed.hits : []

        interface AggregatedChapter {
          chapter: string
          flatIndex?: number
          occurrences: number
          excerpt: string
          excerpts: string[]
        }

        const chapterMap = new Map<string | number, AggregatedChapter>()

        for (const hit of hits) {
          const key = hit.flatIndex != null ? hit.flatIndex : (hit.title ?? '未知章节')
          const hitCount = typeof hit.count === 'number' && hit.count > 0 ? hit.count : 1
          const snippet = hit.snippet?.trim() || ''

          const existing = chapterMap.get(key)
          if (!existing) {
            chapterMap.set(key, {
              chapter: hit.title ?? '未知章节',
              ...(hit.flatIndex != null ? { flatIndex: hit.flatIndex } : {}),
              occurrences: hitCount,
              excerpt: snippet,
              excerpts: snippet ? [snippet] : [],
            })
          } else {
            existing.occurrences += hitCount
            if (snippet && existing.excerpts.length < maxPerChapter && !existing.excerpts.includes(snippet)) {
              existing.excerpts.push(snippet)
            }
            if (!existing.excerpt && snippet) {
              existing.excerpt = snippet
            }
          }
        }

        const chapterDistribution = Array.from(chapterMap.values()).slice(0, 15)
        const totalOccurrences =
          typeof parsed.totalMatches === 'number'
            ? parsed.totalMatches
            : chapterDistribution.reduce((acc, c) => acc + c.occurrences, 0)

        const result = {
          entity: entityName.trim(),
          totalOccurrences,
          chapterDistribution,
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch {
        return { content: [{ type: 'text', text: rawText }] }
      }
    }
    default:
      return {
        content: [{ type: 'text', text: `未知工具: ${name}` }],
        isError: true,
      }
  }
}
