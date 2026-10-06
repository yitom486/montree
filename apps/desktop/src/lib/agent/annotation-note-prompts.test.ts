import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_DIRECTION_ASK,
  ANNOTATION_DIRECTION_CHIPS,
  buildAnnotationChatPrompt,
  buildAnnotationComposePrompt,
  buildAnnotationPolishPrompt,
  buildAskComposeDirectionPrompt,
  detectAnnotationWriteIntent,
  buildAnnotationRefinePrompt,
  extractAnnotationDraft,
} from './annotation-note-prompts'

describe('annotation-note-prompts', () => {
  it('聊天意图不要求只输出批注，并禁止擅自 propose', () => {
    const built = buildAnnotationChatPrompt({
      excerpt: '天下大势分久必合',
      intent: 'explain',
    })
    expect(built.displayText).toBe('解释这段')
    expect(built.promptText).toContain('天下大势分久必合')
    expect(built.promptText).toContain('普通聊天')
    expect(built.promptText).toContain('不要调用 montree_propose_mark')
    expect(built.promptText).toContain('禁止输出 English:')
  })

  it('写成批注才允许 propose，且禁止英译杂质', () => {
    const built = buildAnnotationComposePrompt({
      excerpt: '选区',
      hint: '写批注：侧重作者语气',
    })
    expect(built.displayText).toContain('写批注')
    expect(built.promptText).toContain('montree_propose_mark')
    expect(built.promptText).toContain('只输出批注正文')
    expect(built.promptText).toContain('Natural English:')
  })

  it('按钮追问方向文案固定可本地展示', () => {
    expect(ANNOTATION_DIRECTION_ASK).toContain('可选')
    expect(ANNOTATION_DIRECTION_CHIPS.some((c) => c.id === 'direct')).toBe(true)
    const built = buildAskComposeDirectionPrompt({ excerpt: '选区' })
    expect(built.displayText).toBe('写成批注')
    expect(built.promptText).toContain('追问')
  })

  it('detectAnnotationWriteIntent 识别带方向的命令', () => {
    expect(detectAnnotationWriteIntent('这段很好玩')).toEqual({
      write: false,
      hasDirection: false,
      direction: '',
    })
    expect(detectAnnotationWriteIntent('写一下批注')).toMatchObject({
      write: true,
      hasDirection: false,
    })
    expect(
      detectAnnotationWriteIntent('写批注：用口语记下我对这段的疑问'),
    ).toMatchObject({
      write: true,
      hasDirection: true,
    })
  })

  it('自定义聊天使用用户原文', () => {
    const built = buildAnnotationChatPrompt({
      excerpt: '选区',
      intent: 'custom',
      customText: '联系后文矛盾',
    })
    expect(built.displayText).toBe('联系后文矛盾')
    expect(built.promptText).toContain('联系后文矛盾')
  })

  it('改写 prompt 带上当前草稿', () => {
    const built = buildAnnotationRefinePrompt({
      excerpt: '原文',
      draft: '旧草稿',
      refine: 'shorter',
    })
    expect(built.displayText).toBe('更短')
    expect(built.promptText).toContain('旧草稿')
  })

  it('润色 prompt 带上用户原文', () => {
    const built = buildAnnotationPolishPrompt({
      excerpt: '选区',
      draft: '我的手写批注',
    })
    expect(built.displayText).toBe('润色批注')
    expect(built.promptText).toContain('我的手写批注')
    expect(built.promptText).toContain('只输出润色后的批注正文')
  })

  it('extractAnnotationDraft 去掉围栏、前缀与英译行', () => {
    expect(extractAnnotationDraft('```\n批注正文\n```')).toBe('批注正文')
    expect(extractAnnotationDraft('批注：这里有观点')).toBe('这里有观点')
    expect(
      extractAnnotationDraft('这段很尖锐。\nEnglish: This is sharp.'),
    ).toBe('这段很尖锐。')
    expect(extractAnnotationDraft('Natural English: Hello\n中文批注')).toBe(
      '中文批注',
    )
  })
})
