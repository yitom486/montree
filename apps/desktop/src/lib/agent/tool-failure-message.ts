/**
 * 将工具失败的原始文案译成聊天气泡内可读的业务说明。
 * 原始报错留给主进程日志；UI 默认只展示人话。
 */

export interface ToolFailureExplanation {
  /** 标题行短后缀（折叠可见） */
  headline: string
  /** 展开区正文 */
  body: string
}

interface Rule {
  test: (raw: string, title: string) => boolean
  headline: string
  body: string
}

const RULES: Rule[] = [
  {
    test: (raw) => /快照桥未就绪|稍后重试/.test(raw),
    headline: '阅读上下文未就绪',
    body: '暂时还连不上当前阅读内容，请稍等片刻后再问，或重新打开一下文档。',
  },
  {
    test: (raw) => /没有可用窗口|快照请求超时|超时：|timeout/i.test(raw),
    headline: '未能取到当前页内容',
    body: '没能及时从当前窗口读到正文。请确认已打开电子书或在线文档，并让阅读区保持在前台后再试。',
  },
  {
    test: (raw) => /scope=chapter|flatIndex 或 title|需要 flatIndex/.test(raw),
    headline: '未指定要读的章节',
    body: '这次读取需要明确章节（目录序号或标题）。可先打开目录所在章节，或换种方式提问。',
  },
  {
    test: (raw) => /先建立罗盘索引|手动单页识别/.test(raw),
    headline: '全书检索需要罗盘索引',
    body: '这本书还没有建立罗盘索引，全书检索不会擅自整书识别。可先建立罗盘索引，或在工具栏点「识别本页」逐页识别后再问。',
  },
  {
    test: (raw) => /scope=search|需要非空的 query|query 参数/.test(raw),
    headline: '缺少搜索关键词',
    body: '全文检索需要具体关键词。请换一句带关键词的问题，或先划选原文再提问。',
  },
  {
    test: (raw) => /需要 scope:|scope: toc/.test(raw),
    headline: '读取方式不完整',
    body: '这次没有说明要读目录、当前页还是某一章。直接描述你想了解的部分即可，助手会再试一次。',
  },
  {
    test: (raw) => /suggest_chapters|需要非空 chapters/.test(raw),
    headline: '章节建议参数不完整',
    body: '批量划重点需要先给出候选章节列表。可先让助手浏览目录，再指定章节。',
  },
  {
    test: (raw) => /propose_mark|需要 excerpt|marks 之一|仅传 note/.test(raw),
    headline: '标记提议缺少原文',
    body: '添加批注或高亮需要对应的原文摘录，或先在书中划选一段文字。',
  },
  {
    test: (raw) => /未就绪|未打开|没有打开|请先打开/.test(raw),
    headline: '还没有打开可读文档',
    body: '当前没有可供助手读取的电子书或在线文档。请先打开文件或网页，再继续提问。',
  },
  {
    test: (raw) => /未知工具/.test(raw),
    headline: '工具不可用',
    body: '助手调用了当前版本不支持的能力。可换一种问法，或更新到新版本后再试。',
  },
  {
    test: (raw) => /ENOENT|spawn/i.test(raw),
    headline: '本机运行环境有问题',
    body: '启动或访问本机组件失败。请确认 Agent 相关依赖已安装，然后重新连接后再试。',
  },
  {
    test: (raw, title) => /montree_read|mcp\.montree\.montree_read/i.test(title) || /montree_read/.test(raw),
    headline: '未能读取阅读内容',
    body: '这次没能从当前阅读内容取到数据。请确认文档已打开且页面已加载完成，然后再问一次。',
  },
]

const FALLBACK: ToolFailureExplanation = {
  headline: '操作未成功',
  body: '这次工具调用没有完成。你可以换个说法再试，或先确认当前打开的是电子书 / 在线文档。',
}

/** 去掉过长、过「工程师味」的原文，仅作规则匹配输入。 */
export function normalizeToolFailureRaw(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * @param raw 工具返回或 status=failed 时携带的原文（可空）
 * @param toolTitle 气泡标题，如 mcp.montree.montree_read
 */
export function explainToolFailure(raw: string, toolTitle?: string): ToolFailureExplanation {
  const text = normalizeToolFailureRaw(raw)
  const title = (toolTitle ?? '').trim()
  if (!text && !title) return FALLBACK

  for (const rule of RULES) {
    if (rule.test(text, title)) {
      return { headline: rule.headline, body: rule.body }
    }
  }

  // 有原文但未命中：给通用业务句，不把堆栈/协议原文甩给用户
  if (text) {
    return {
      headline: FALLBACK.headline,
      body: '这次没能完成该步骤。若刚打开文档，可稍等加载后再问；仍不行可换种问法。',
    }
  }
  return FALLBACK
}
