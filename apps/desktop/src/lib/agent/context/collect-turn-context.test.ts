import { describe, expect, it } from 'vitest'
import {
  collectReadingState,
  collectTocTopLevel,
  resolveReaderLocationKey,
  TOC_TOP_LEVEL_LIMIT,
} from './collect-turn-context'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { registerDocumentTools } from './document-tool-registry'
import { registerReaderContent } from './reader-content-registry'
import { useActiveDocumentStore } from '@/stores/active-document-store'
import { buildMontreePromptPrefix } from './build-prompt-prefix'
import { resetTurnContextTracker } from './should-attach-turn-context'

describe('collectTocTopLevel', () => {
  it('取最小 level 的条目并去重、截断条数', () => {
    const labels = collectTocTopLevel([
      { label: '导言', level: 0 },
      { label: '第一节', level: 1 },
      { label: '第一章', level: 0 },
      { label: '第二章', level: 0 },
      { label: '第一章', level: 0 },
    ])
    expect(labels).toEqual(['导言', '第一章', '第二章'])
  })

  it('扁平目录取前 N 条', () => {
    const units = Array.from({ length: 15 }, (_, i) => ({
      label: `第${i + 1}章`,
      level: 1,
    }))
    const labels = collectTocTopLevel(units)
    expect(labels).toHaveLength(TOC_TOP_LEVEL_LIMIT)
    expect(labels?.[0]).toBe('第1章')
    expect(labels?.[9]).toBe('第10章')
  })

  it('空目录返回 undefined', () => {
    expect(collectTocTopLevel([])).toBeUndefined()
  })
})

describe('collectReadingState', () => {
  it('PPT发送当前可见页与独立选区页，滚动换页触发下一轮位置更新且不复用旧阅读器', () => {
    let slide = 1
    const disposeTools = registerDocumentTools({ filePath: '/slides.pptx', kind: 'slide', isDirty: () => false, read: () => ({}), edit: () => ({}), save: async () => {}, undo: () => {},
      getSlideView: () => ({ visibleSlide: slide, visibleSlides: [slide], navigationSlide: 1, selectionSlide: 1 }) })
    const disposeContent = registerReaderContent({ filePath: '/slides.pptx', getCurrentText: () => '', getCurrentUnitIndex: () => slide - 1,
      getUnits: () => [{ label: '幻灯片 1' }, { label: '幻灯片 2' }] })
    const previousPath = useActiveDocumentStore.getState().filePath
    useActiveDocumentStore.setState({ filePath: '/slides.pptx' })
    try {
      resetTurnContextTracker('ppt-context-test')
      const first = buildMontreePromptPrefix('ppt-context-test', { includeBootstrap: false })
      expect(first.map((block) => block.type === 'text' ? block.text : '').join('')).toContain('"slide":1')
      const second = buildMontreePromptPrefix('ppt-context-test', { includeBootstrap: false })
      expect(second.map((block) => block.type === 'text' ? block.text : '').join('')).not.toContain('<montree-turn-context>')
      slide = 2
      const changed = buildMontreePromptPrefix('ppt-context-test', { includeBootstrap: false }).map((block) => block.type === 'text' ? block.text : '').join('')
      expect(changed).toContain('"slide":2'); expect(changed).toContain('"selectionSlide":1'); expect(changed).toContain('"navigationSlide":1')
      expect(changed).toContain('"documentChanged":false')
      expect(collectReadingState({ path: '/other.pptx', kind: 'pptx', name: 'other' })).toBeUndefined()
    } finally { disposeTools(); disposeContent(); useActiveDocumentStore.setState({ filePath: previousPath }); resetTurnContextTracker('ppt-context-test') }
  })
  function setupPdf(pageNum: number | null) {
    useReaderNavigationStore.setState({
      filePath: '/book/a.pdf',
      format: 'pdf',
      ready: true,
      units: [{ label: '第一章', href: '1', level: 0 }],
      nav: {
        current: { label: '第一章', href: '1', level: 0 },
        previous: null,
        next: null,
        currentIndex: 0,
        previousIndex: -1,
        nextIndex: -1,
        flatIndex: 0,
      },
      pageNum,
    })
  }

  it('T1：PDF 产出 page，EPUB 不填页码', () => {
    setupPdf(36)
    const pdf = collectReadingState({ path: '/book/a.pdf', kind: 'pdf', name: 'a.pdf' })
    expect(pdf?.page).toBe(36)
    expect(pdf?.current).toBe('第一章')

    useReaderNavigationStore.setState({ filePath: '/book/b.epub', format: 'epub', pageNum: null })
    const epub = collectReadingState({ path: '/book/b.epub', kind: 'epub', name: 'b.epub' })
    expect(epub).not.toHaveProperty('page')
  })

  it('未就绪或无页码时无 page', () => {
    setupPdf(null)
    expect(
      collectReadingState({ path: '/book/a.pdf', kind: 'pdf', name: 'a.pdf' })?.page,
    ).toBeUndefined()
    useReaderNavigationStore.setState({ ready: false })
    expect(
      collectReadingState({ path: '/book/a.pdf', kind: 'pdf', name: 'a.pdf' }),
    ).toBeUndefined()
    useReaderNavigationStore.setState({ ready: true })
  })
})

describe('resolveReaderLocationKey', () => {
  it('PDF 用页码不用 flatIndex（同章 19→20 变键）', () => {
    expect(resolveReaderLocationKey('pdf', 19, 3)).toBe('pdf:19')
    expect(resolveReaderLocationKey('pdf', 20, 3)).toBe('pdf:20')
    expect(resolveReaderLocationKey('pdf', 0, 0)).toBeNull()
    expect(resolveReaderLocationKey('pdf', null, 0)).toBeNull()
  })

  it('EPUB/web 用 flatIndex，无 pageNum 也可定位', () => {
    expect(resolveReaderLocationKey('epub', null, 0)).toBe('epub:0')
    expect(resolveReaderLocationKey('epub', null, 1)).toBe('epub:1')
    expect(resolveReaderLocationKey('web', null, 2)).toBe('web:2')
    expect(resolveReaderLocationKey('epub', null, -1)).toBeNull()
  })

  it('未就绪为 null，不含路径文件名', () => {
    expect(resolveReaderLocationKey(null, 36, 0)).toBeNull()
    expect(resolveReaderLocationKey('mobi', null, 0)).toBeNull()
    expect(resolveReaderLocationKey('pdf', 36, 0)).not.toContain('/book')
  })
})
