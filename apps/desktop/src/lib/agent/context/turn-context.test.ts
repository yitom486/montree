import { describe, expect, it } from 'vitest'
import { MONTREE_STATIC_SKILL } from './montree-static-skill'
import {
  documentKey,
  formatTurnContextBlock,
  TURN_CONTEXT_MAX_CHARS,
  type MontreeTurnContext,
} from './turn-context'

const sample: MontreeTurnContext = {
  documentChanged: true,
  activeDocument: { path: '/books/dune.epub', kind: 'epub', name: 'dune.epub' },
  reading: { percent: 42, current: '第七章', previous: '第六章', next: '第八章', unitCount: 30 },
}

describe('formatTurnContextBlock', () => {
  it('输出可解析的 JSON 并带标签包裹', () => {
    const text = formatTurnContextBlock(sample)
    expect(text.startsWith('<montree-turn-context>')).toBe(true)
    expect(text.endsWith('</montree-turn-context>')).toBe(true)

    const json = text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n'))
    expect(JSON.parse(json)).toMatchObject({
      documentChanged: true,
      activeDocument: { kind: 'epub' },
      reading: { percent: 42, current: '第七章' },
    })
  })

  it('丢弃 undefined 的阅读字段', () => {
    const text = formatTurnContextBlock({
      documentChanged: false,
      activeDocument: { path: '/a.md', kind: 'markdown', name: 'a.md' },
      reading: { percent: undefined, current: undefined },
    })
    expect(text).not.toContain('reading')
  })

  it('超长时逐级退化到体积上限内', () => {
    const long = 'x'.repeat(5000)
    const text = formatTurnContextBlock({
      documentChanged: true,
      activeDocument: { path: `/books/${long}.epub`, kind: 'epub', name: `${long}.epub` },
      reading: { percent: 10, current: long, previous: long, next: long },
    })
    expect(text.length).toBeLessThanOrEqual(TURN_CONTEXT_MAX_CHARS)
  })

  it('含 tocTopLevel 时仍可解析，超长时优先丢掉该字段', () => {
    const titles = Array.from({ length: 10 }, (_, i) => `很长的章名${'字'.repeat(40)}${i}`)
    const text = formatTurnContextBlock({
      ...sample,
      tocTopLevel: titles,
    })
    expect(text.length).toBeLessThanOrEqual(TURN_CONTEXT_MAX_CHARS)
    const json = JSON.parse(text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n'))) as {
      tocTopLevel?: string[]
    }
    // 10 条超长标题会超限，应退化掉 tocTopLevel 仍保留文件信息
    expect(json).toMatchObject({ activeDocument: { kind: 'epub' } })
  })

  it('T1：JSON 含 reading.page；退化档在体积允许时保留页码', () => {
    const text = formatTurnContextBlock({
      documentChanged: false,
      activeDocument: { path: '/book/a.pdf', kind: 'pdf', name: 'a.pdf' },
      reading: { percent: 10, current: '第一章', page: 36 },
    })
    const json = JSON.parse(text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n'))) as {
      reading?: { page?: number }
    }
    expect(json.reading?.page).toBe(36)

    // 强行压体积：退化到只剩进度+当前位置+页码，页码不丢
    //（previous/next 各 200 字把 level-1 撑爆，level-2 恰好装下）
    const squeezed = formatTurnContextBlock(
      {
        documentChanged: false,
        activeDocument: { path: '/book/a.pdf', kind: 'pdf', name: 'a.pdf' },
        reading: {
          percent: 10,
          current: '第一章',
          previous: '前'.repeat(200),
          next: '后'.repeat(200),
          page: 36,
        },
      },
      400,
    )
    expect(squeezed.length).toBeLessThanOrEqual(400)
    expect(squeezed).toContain('"page":36')
    expect(squeezed).not.toContain('前前')
  })
})

describe('documentKey', () => {
  it('区分路径与格式，未打开为 null', () => {
    expect(documentKey(null)).toBeNull()
    expect(documentKey({ path: '/a.md', kind: 'markdown', name: 'a.md' })).toBe(
      'markdown:/a.md',
    )
  })
})

describe('MONTREE_STATIC_SKILL', () => {
  it('保持全静态：不含路径、时间戳等动态占位', () => {
    expect(MONTREE_STATIC_SKILL).not.toMatch(/\{\{|\$\{|%s/)
    expect(MONTREE_STATIC_SKILL).toBe(MONTREE_STATIC_SKILL.trim())
  })

  it('明确禁止 Agent 自行解析电子书，并区分纯文本走原生读', () => {
    expect(MONTREE_STATIC_SKILL).toContain('.epub')
    expect(MONTREE_STATIC_SKILL).toContain('turn-context')
    expect(MONTREE_STATIC_SKILL).toContain('Soft cues')
    expect(MONTREE_STATIC_SKILL).toContain('normal workspace file read/write')
    expect(MONTREE_STATIC_SKILL).toContain('No user workspace folder')
    expect(MONTREE_STATIC_SKILL).toContain('Do **not** call tools only to "prove"')
    expect(MONTREE_STATIC_SKILL).toContain('montree_read')
    expect(MONTREE_STATIC_SKILL).toContain('montree_list_marks')
    expect(MONTREE_STATIC_SKILL).toContain('montree_suggest_chapters')
    expect(MONTREE_STATIC_SKILL).toContain('Chapter-level highlighting')
    expect(MONTREE_STATIC_SKILL).toContain('tocTopLevel')
    expect(MONTREE_STATIC_SKILL).toContain('「选区」')
    expect(MONTREE_STATIC_SKILL).toContain('Match the **language of the user')
    expect(MONTREE_STATIC_SKILL).not.toContain('默认使用简体中文')
  })

  it('T1：turn-context 节说明 reading.page 的用法与边界', () => {
    expect(MONTREE_STATIC_SKILL).toContain('reading.page')
    expect(MONTREE_STATIC_SKILL).toContain('montree_read(scope=viewport)')
  })

  it('T2：位置变化重贴，滞后句已删除', () => {
    expect(MONTREE_STATIC_SKILL).toContain('PDF page / reader location change')
    expect(MONTREE_STATIC_SKILL).not.toContain('not re-attached on every page turn')
    expect(MONTREE_STATIC_SKILL).toContain('reading.page')
    expect(MONTREE_STATIC_SKILL).toContain('montree_read(scope=viewport)')
  })

  it('S1.3：已入库只读库口径与代码一致，不再教整书 OCR', () => {
    expect(MONTREE_STATIC_SKILL).toContain('Indexed PDFs')
    expect(MONTREE_STATIC_SKILL).toContain('compass index already built')
    expect(MONTREE_STATIC_SKILL).toContain('all read **only** the compass index')
    expect(MONTREE_STATIC_SKILL).toContain('do NOT retry the same tool hoping OCR will fill it in')
    expect(MONTREE_STATIC_SKILL).toContain('do NOT invent that page')
    // 旧句必须消失：已入库 viewport/current/chapter 不再 OCR
    expect(MONTREE_STATIC_SKILL).not.toContain('viewport/current/chapter may still OCR one page')
  })

  it('S1.3：未入库口径保留（search 不整书 OCR，页眉可信）', () => {
    expect(MONTREE_STATIC_SKILL).toContain('instead of OCRing the whole book')
    expect(MONTREE_STATIC_SKILL).toContain('【PDF 第 N/M 页】')
  })
})
