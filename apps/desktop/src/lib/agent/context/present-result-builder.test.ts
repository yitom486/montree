import { afterEach, describe, expect, it } from 'vitest'
import { registerReaderContent } from './reader-content-registry'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { EMPTY_READER_NAV } from '@montree/reader-core'
import { buildPresentResult, stripHostileHtmlHead } from './present-result-builder'
import { parsePresentResult } from '@montree/contracts'

function setupBook() {
  useReaderNavigationStore.setState({
    ready: true,
    filePath: '/b.epub',
    format: 'epub',
    units: [
      { label: '第一章', href: '1', level: 0 },
      { label: '第二章', href: '2', level: 0 },
    ],
  })
  return registerReaderContent({
    filePath: '/b.epub',
    getCurrentText: () => '',
    getUnitByIndex: async (index: number) => ({
      label: ['第一章', '第二章'][index]!,
      text: ['一章正文含论点甲', '二章正文含论点乙'][index]!,
    }),
  })
}

afterEach(() => {
  useReaderNavigationStore.setState({
    ready: false,
    filePath: null,
    format: null,
    units: [],
    nav: EMPTY_READER_NAV,
    navIntent: null,
  })
})

describe('内置 present presets', () => {
  const chapters = [{ key: 'c1', label: '第一章', flatIndex: 0 }]
  it('单章引用导航验证原文、生成定位入口及稳定 id', async () => {
    const dispose = setupBook()
    try {
      const args = { kind: 'preset', preset: 'citation-guide', title: '关键引用', chapters, citations: [{ label: '论点甲', chapterKey: 'c1', excerpt: '论点甲' }] }
      const result = await buildPresentResult(args)
      expect(result).toBe(await buildPresentResult(args))
      const parsed = parsePresentResult(result)
      expect(parsed?.kind).toBe('component-ui')
      expect(result).toContain('Evidence')
      await expect(buildPresentResult({ ...args, citations: [{ label: '伪引用', chapterKey: 'c1', excerpt: '不存在的原文' }] })).rejects.toThrow('原文')
    } finally { dispose() }
  })
  it('阅读测验生成选择及真实提交动作，拒绝重复选项与混入任意 ui', async () => {
    const dispose = setupBook()
    try {
      const args = { kind: 'preset', preset: 'reading-quiz', title: '理解检查', chapters, questions: [{ question: '第一章提出什么？', options: ['论点甲', '论点乙'] }] }
      const json = await buildPresentResult(args)
      expect(parsePresentResult(json)?.kind).toBe('component-ui')
      expect(json).toContain('submit-selection')
      expect(json).toContain('不会在本地自动判分')
      await expect(buildPresentResult({ ...args, questions: [{ question: '问题', options: ['甲', '甲'] }] })).rejects.toThrow('重复')
      await expect(buildPresentResult({ ...args, ui: { root: {} } })).rejects.toThrow('不接受 ui')
    } finally { dispose() }
  })
  it('章节对比模板复用比较卡，仍要求至少两章', async () => {
    const dispose = setupBook()
    try {
      const args = { kind: 'preset', preset: 'chapter-comparison', title: '比较', chapters, items: [] }
      await expect(buildPresentResult(args)).rejects.toThrow('2')
      const json = await buildPresentResult({ ...args, chapters: [...chapters, { key: 'c2', label: '第二章', flatIndex: 1 }] })
      expect(parsePresentResult(json)?.kind).toBe('chapter-comparison')
    } finally { dispose() }
  })
})

describe('内置 SVG 参数模板', () => {
  const nodes = [{ id: 'client', label: '读者', details: '</script><script>window.injected=1</script>' }, { id: 'server', label: '文档服务' }]
  const er = { kind: 'preset', preset: 'diagram', diagramType: 'er', title: '书籍与批注', nodes: [
    { id: 'book', label: '书籍', fields: [{ name: 'id', type: 'UUID', key: 'PK', details: '书籍主键' }, { name: 'name', type: 'TEXT' }] },
    { id: 'note', label: '批注', fields: [{ name: 'id', type: 'UUID', key: 'PK' }, { name: 'book_id', type: 'UUID', key: 'FK' }] },
  ], edges: [{ from: 'book', to: 'note', label: '拥有', fromCardinality: '1', toCardinality: '0..*', fromField: 'id', toField: 'book_id' }] }
  it('ER 展示字段、键、关系基数与字段说明，同样输出可重放的离线信封', async () => {
    const json = await buildPresentResult(er)
    expect(await buildPresentResult(er)).toBe(json)
    const result = parsePresentResult(json)
    if (result?.kind !== 'html-artifact') throw new Error('缺少 ER 图信封')
    expect(result.inline).toBe(true)
    for (const text of ['entity-field', 'book_id', 'PK', 'FK', '0..*', '书籍主键']) expect(result.html).toContain(text)
    expect(result.html).not.toMatch(/NaN|Infinity/)
  })
  it('ER 拒绝重复字段、非法键/基数、悬空字段引用与不支持的自关联', async () => {
    await expect(buildPresentResult({ ...er, nodes: [{ ...er.nodes[0], fields: [] }, er.nodes[1]] })).rejects.toThrow('fields')
    await expect(buildPresentResult({ ...er, nodes: [{ ...er.nodes[0], fields: [er.nodes[0].fields[0], er.nodes[0].fields[0]] }, er.nodes[1]] })).rejects.toThrow('字段名不得重复')
    await expect(buildPresentResult({ ...er, nodes: [{ ...er.nodes[0], fields: [{ name: 'id', type: 'UUID', key: 'PRIMARY' }] }, er.nodes[1]] })).rejects.toThrow('field.key')
    await expect(buildPresentResult({ ...er, edges: [{ ...er.edges[0], toCardinality: '*' }] })).rejects.toThrow('合法基数')
    await expect(buildPresentResult({ ...er, edges: [{ ...er.edges[0], fromCardinality: 1 }] })).rejects.toThrow('合法基数')
    await expect(buildPresentResult({ ...er, edges: [{ ...er.edges[0], toField: 'missing' }] })).rejects.toThrow('不存在的字段')
    await expect(buildPresentResult({ ...er, edges: [{ ...er.edges[0], fromField: undefined }] })).rejects.toThrow('同时提供')
    await expect(buildPresentResult({ ...er, edges: [{ ...er.edges[0], to: 'book' }] })).rejects.toThrow('自关联')
    await expect(buildPresentResult({ ...er, edges: [er.edges[0], er.edges[0]] })).rejects.toThrow('一条关系')
  })
  it.each(['timeline', 'fishbone', 'cycle'])('%s 参数生成稳定的隔离 SVG 信封', async (diagramType) => {
    const args = { kind: 'preset', preset: 'diagram', diagramType, title: '知识图解', nodes: [...nodes, { id: 'result', label: '学习成果' }], edges: diagramType === 'fishbone' ? [{ from: 'client', to: 'result' }, { from: 'server', to: 'result' }] : [{ from: 'client', to: 'server' }, { from: 'server', to: 'result' }, ...(diagramType === 'cycle' ? [{ from: 'result', to: 'client' }] : [])] }
    const json = await buildPresentResult(args)
    expect(json).toBe(await buildPresentResult(args))
    const result = parsePresentResult(json)
    if (result?.kind !== 'html-artifact') throw new Error('缺少图解信封')
    expect(result.inline).toBe(true)
    expect(result.html).toContain('<svg')
    expect(result.html).not.toContain('</script><script>window.injected')
    expect(result.html).not.toMatch(/NaN|Infinity/)
    if (diagramType === 'timeline') expect(result.html).toContain('不代表实际时间间隔')
  })
  it('时间线拒绝跳跃，循环图拒绝未闭合或多个环，鱼骨图拒绝多归属及过深原因', async () => {
    const graphNodes = [...nodes, { id: 'result', label: '结果' }, { id: 'extra', label: '额外原因' }]
    const base = { kind: 'preset', preset: 'diagram', title: '非法结构', nodes: graphNodes }
    await expect(buildPresentResult({ ...base, diagramType: 'timeline', edges: [{ from: 'client', to: 'result' }, { from: 'result', to: 'extra' }, { from: 'extra', to: 'server' }] })).rejects.toThrow('nodes 顺序')
    await expect(buildPresentResult({ ...base, diagramType: 'cycle', edges: [{ from: 'client', to: 'server' }, { from: 'server', to: 'client' }, { from: 'result', to: 'extra' }, { from: 'extra', to: 'result' }] })).rejects.toThrow('nodes 顺序')
    await expect(buildPresentResult({ ...base, diagramType: 'cycle', nodes, edges: [{ from: 'client', to: 'server' }] })).rejects.toThrow('3–8')
    await expect(buildPresentResult({ ...base, diagramType: 'fishbone', edges: [{ from: 'client', to: 'result' }, { from: 'server', to: 'result' }, { from: 'extra', to: 'client' }, { from: 'extra', to: 'server' }] })).rejects.toThrow('一个结果')
    await expect(buildPresentResult({ ...base, diagramType: 'fishbone', nodes: [...graphNodes, { id: 'deep', label: '过深' }], edges: [{ from: 'client', to: 'result' }, { from: 'server', to: 'result' }, { from: 'extra', to: 'client' }, { from: 'deep', to: 'extra' }] })).rejects.toThrow('最多两级')
  })
  it.each(['flowchart', 'sequence', 'architecture', 'mindmap'])('%s 生成可直接展示的离线 SVG，不需要文档或 JSX', async (diagramType) => {
    const args = { kind: 'preset', preset: 'diagram', diagramType, title: '中文图解', nodes, edges: [{ from: 'client', to: 'server', label: '读取' }] }
    const json = await buildPresentResult(args)
    expect(json).toBe(await buildPresentResult(args))
    const result = parsePresentResult(json)
    expect(result?.kind).toBe('html-artifact')
    if (result?.kind !== 'html-artifact') throw new Error('缺少 HTML 信封')
    expect(result.inline).toBe(true)
    expect(result.html).toContain('<svg')
    expect(result.html).not.toContain('</script><script>window.injected')
    expect(result.html).not.toMatch(/fonts.googleapis|https:\/\//)
    expect(result.html).toContain('查看详情')
  })
  it('未知端点、无标签决策、超限与未支持分组整单拒绝', async () => {
    const base = { kind: 'preset', preset: 'diagram', diagramType: 'flowchart', title: '测试', nodes, edges: [{ from: 'client', to: 'server', label: '读取' }] }
    await expect(buildPresentResult({ ...base, edges: [{ from: 'missing', to: 'server' }] })).rejects.toThrow('不存在')
    await expect(buildPresentResult({ ...base, nodes: [{ ...nodes[0], kind: 'decision' }, nodes[1]], edges: [{ from: 'client', to: 'server' }] })).rejects.toThrow('label')
    await expect(buildPresentResult({ ...base, nodes: Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, label: '节点' })) })).rejects.toThrow('拆分')
    await expect(buildPresentResult({ ...base, nodes: [{ ...nodes[0], group: '未知分组' }, nodes[1]] })).rejects.toThrow('未支持')
  })
  it('思维导图拒绝多父节点、循环、孤立节点及手动层级', async () => {
    const base = { kind: 'preset', preset: 'diagram', diagramType: 'mindmap', title: '主题', nodes: [...nodes, { id: 'other', label: '分支' }], edges: [{ from: 'client', to: 'server' }, { from: 'client', to: 'other' }] }
    expect(parsePresentResult(await buildPresentResult(base))?.kind).toBe('html-artifact')
    await expect(buildPresentResult({ ...base, edges: [{ from: 'client', to: 'other' }, { from: 'server', to: 'other' }] })).rejects.toThrow('连通树')
    await expect(buildPresentResult({ ...base, edges: [{ from: 'server', to: 'other' }, { from: 'other', to: 'server' }] })).rejects.toThrow('循环或孤立')
    await expect(buildPresentResult({ ...base, edges: [{ from: 'client', to: 'server' }] })).rejects.toThrow('连通树')
    await expect(buildPresentResult({ ...base, nodes: [{ ...nodes[0], layer: 0 }, nodes[1]] })).rejects.toThrow('layer/kind')
  })
  it('泳道图验证角色和阶段，拒绝重叠与未知泳道', async () => {
    const base = { kind: 'preset', preset: 'diagram', diagramType: 'swimlane', title: '协作', lanes: [{ id: 'user', label: '用户' }, { id: 'app', label: '软件' }], nodes: [{ ...nodes[0], lane: 'user', layer: 0 }, { ...nodes[1], lane: 'app', layer: 1 }], edges: [{ from: 'client', to: 'server', label: '读取' }] }
    const result = parsePresentResult(await buildPresentResult(base))
    if (result?.kind !== 'html-artifact') throw new Error('缺少泳道图信封')
    expect(result.html).toContain('aria-label="软件"')
    await expect(buildPresentResult({ ...base, nodes: [base.nodes[0], { ...base.nodes[1], lane: 'unknown' }] })).rejects.toThrow('有效 lane')
    await expect(buildPresentResult({ ...base, nodes: [base.nodes[0], { ...base.nodes[1], lane: 'user', layer: 0 }] })).rejects.toThrow('只能一个节点')
    await expect(buildPresentResult({ ...base, lanes: [base.lanes[0], base.lanes[0]] })).rejects.toThrow('不得重复')
    await expect(buildPresentResult({ ...base, nodes: [nodes[0], base.nodes[1]] })).rejects.toThrow('lane 与 layer')
  })
})

describe('buildPresentResult chapter-comparison', () => {
  it('验证摘录并组装稳定信封', async () => {
    const dispose = setupBook()
    try {
      const json = await buildPresentResult({
        kind: 'chapter-comparison',
        title: '两章比较',
        chapters: [
          { key: 'c1', label: '第一章', flatIndex: 0 },
          { key: 'c2', label: '第二章', flatIndex: 1 },
        ],
        items: [
          { dimension: '论点', chapterKey: 'c1', excerpt: '论点甲' },
          { dimension: '论点', chapterKey: 'c2', excerpt: '查无此句' },
        ],
      })
      const parsed = parsePresentResult(json)
      expect(parsed?.kind).toBe('chapter-comparison')
      if (parsed?.kind !== 'chapter-comparison') return
      expect(parsed.items[0]?.verified).toBe(true)
      expect(parsed.items[0]?.flatIndex).toBe(0)
      expect(parsed.items[1]?.verified).toBe(false)
      expect(parsed.items[1]?.flatIndex).toBeUndefined()
      // 同一输入重放得同一 id
      const again = await buildPresentResult({
        kind: 'chapter-comparison',
        title: '两章比较',
        chapters: [
          { key: 'c1', label: '第一章', flatIndex: 0 },
          { key: 'c2', label: '第二章', flatIndex: 1 },
        ],
        items: [
          { dimension: '论点', chapterKey: 'c1', excerpt: '论点甲' },
          { dimension: '论点', chapterKey: 'c2', excerpt: '查无此句' },
        ],
      })
      expect(JSON.parse(again).id).toBe(parsed.id)
    } finally {
      dispose()
    }
  })

  it('未知章节与野指针整单拒绝，不伪造', async () => {
    const dispose = setupBook()
    try {
      await expect(
        buildPresentResult({
          kind: 'chapter-comparison',
          title: 't',
          chapters: [
            { key: 'c1', label: '第一章', flatIndex: 0 },
            { key: 'gx', label: '鬼章', flatIndex: 9 },
          ],
          items: [],
        }),
      ).rejects.toThrow()
      await expect(
        buildPresentResult({
          kind: 'chapter-comparison',
          title: 't',
          chapters: [
            { key: 'c1', label: '第一章', flatIndex: 0 },
            { key: 'c2', label: '第二章', flatIndex: 1 },
          ],
          items: [{ dimension: 'd', chapterKey: 'ghost' }],
        }),
      ).rejects.toThrow()
      await expect(
        buildPresentResult({ kind: 'chapter-comparison', title: 't', chapters: [{ key: 'c1', label: '第一章' }], items: [] }),
      ).rejects.toThrow()
    } finally {
      dispose()
    }
  })

  it('无文档时报错而不编造章节', async () => {
    await expect(
      buildPresentResult({
        kind: 'chapter-comparison',
        title: 't',
        chapters: [
          { key: 'c1', label: '第一章', flatIndex: 0 },
          { key: 'c2', label: '第二章', flatIndex: 1 },
        ],
        items: [],
      }),
    ).rejects.toThrow()
  })

  it('构建中切换文档拒绝混合结果（P1：来源调用开始固定）', async () => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const entered = new Promise<void>((r) => { started = r })
    const units = [{ label: 'One' }, { label: 'Two' }]
    const disposeA = registerReaderContent({
      filePath: '/A.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: async (i) => {
        started()
        await pending
        return { label: units[i]!.label, text: 'excerpt from A' }
      },
    })
    const job = buildPresentResult({
      kind: 'chapter-comparison',
      title: 'mixed',
      chapters: [
        { key: 'a', flatIndex: 0 },
        { key: 'b', flatIndex: 1 },
      ],
      items: [
        { dimension: 'D', chapterKey: 'a', excerpt: 'excerpt from A' },
        { dimension: 'D', chapterKey: 'b', excerpt: 'excerpt from B' },
      ],
    })
    await entered
    const disposeB = registerReaderContent({
      filePath: '/B.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: async (i) => ({ label: units[i]!.label, text: 'excerpt from B' }),
    })
    try {
      release()
      await expect(job).rejects.toThrow(/切换|来源|文档/)
    } finally {
      disposeB()
      disposeA()
    }
  })

  it('同路径重注册新 provider 也拒绝旧任务（U0：对象身份非路径）', async () => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const entered = new Promise<void>((r) => { started = r })
    const units = [{ label: 'One' }, { label: 'Two' }]
    const disposeA = registerReaderContent({
      filePath: '/A.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: async (i) => {
        started()
        await pending
        return { label: units[i]!.label, text: 'original' }
      },
    })
    const job = buildPresentResult({
      kind: 'chapter-comparison',
      title: 'review',
      chapters: [
        { key: 'a', flatIndex: 0 },
        { key: 'b', flatIndex: 1 },
      ],
      items: [{ dimension: 'D', chapterKey: 'a', excerpt: 'original' }],
    })
    await entered
    const disposeB = registerReaderContent({
      filePath: '/A.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: async (i) => ({ label: units[i]!.label, text: 'new document content' }),
    })
    try {
      release()
      await expect(job).rejects.toThrow(/切换|来源|文档/)
    } finally {
      disposeB()
      disposeA()
    }
  })

  it('A→B→A 回到原路径仍拒绝旧任务（U0）', async () => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const entered = new Promise<void>((r) => { started = r })
    const units = [{ label: 'One' }, { label: 'Two' }]
    const textOf = (tag: string) => async (i: number) => ({ label: units[i]!.label, text: tag })
    const disposeA1 = registerReaderContent({
      filePath: '/A.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: async (i) => {
        started()
        await pending
        return textOf('a1')(i)
      },
    })
    const job = buildPresentResult({
      kind: 'chapter-comparison',
      title: 'review',
      chapters: [
        { key: 'a', flatIndex: 0 },
        { key: 'b', flatIndex: 1 },
      ],
      items: [{ dimension: 'D', chapterKey: 'a', excerpt: 'a1' }],
    })
    await entered
    const disposeB = registerReaderContent({
      filePath: '/B.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: textOf('b'),
    })
    const disposeA2 = registerReaderContent({
      filePath: '/A.epub',
      getUnits: () => units,
      getCurrentText: () => '',
      getUnitByIndex: textOf('a2'),
    })
    try {
      release()
      await expect(job).rejects.toThrow(/切换|来源|文档/)
    } finally {
      disposeA2()
      disposeB()
      disposeA1()
    }
  })

  it.each([
    ['目录换序', () => {
      useReaderNavigationStore.setState({
        filePath: '/A.epub',
        format: 'epub',
        units: [
          { label: 'Two', href: 'two', level: 0 },
          { label: 'One', href: 'one', level: 0 },
        ],
      })
    }],
    ['ready 失效', () => {
      useReaderNavigationStore.setState({ ready: false })
    }],
  ])('无 getUnits 时%s拒绝旧任务（U0：同一目录规则）', async (_name, mutate) => {
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const entered = new Promise<void>((r) => { started = r })
    const nav = useReaderNavigationStore.getState()
    nav.beginSession('/A.epub', 'epub')
    nav.setUnits([
      { label: 'One', href: 'one', level: 0 },
      { label: 'Two', href: 'two', level: 0 },
    ])
    nav.setReady(true)
    const disposeA = registerReaderContent({
      filePath: '/A.epub',
      getCurrentText: () => '',
      getUnitByIndex: async (i: number) => {
        started()
        await pending
        return { label: ['One', 'Two'][i]!, text: 'original' }
      },
    })
    const job = buildPresentResult({
      kind: 'chapter-comparison',
      title: 'review',
      chapters: [
        { key: 'a', flatIndex: 0 },
        { key: 'b', flatIndex: 1 },
      ],
      items: [{ dimension: 'D', chapterKey: 'a', excerpt: 'original' }],
    })
    await entered
    mutate()
    try {
      release()
      await expect(job).rejects.toThrow(/切换|来源|目录|文档/)
    } finally {
      disposeA()
      useReaderNavigationStore.setState({ filePath: null, units: [], ready: false })
    }
  })
})

describe('buildPresentResult html-artifact', () => {
  it('组装并剥离 base 与模型 CSP', async () => {
    const json = await buildPresentResult({
      kind: 'html-artifact',
      title: '计数器',
      html: '<base href="https://evil.test/"><meta http-equiv="Content-Security-Policy" content="script-src *"><button>按</button>',
    })
    const parsed = parsePresentResult(json)
    expect(parsed?.kind).toBe('html-artifact')
    if (parsed?.kind !== 'html-artifact') return
    expect(parsed.html).not.toContain('<base')
    expect(parsed.html).not.toContain('Content-Security-Policy')
    expect(parsed.html).toContain('<button>按</button>')
  })

  it('超限与空源码拒绝', async () => {
    await expect(buildPresentResult({ kind: 'html-artifact', title: 't', html: '   ' })).rejects.toThrow()
    await expect(
      buildPresentResult({ kind: 'html-artifact', title: 't', html: 'x'.repeat(97 * 1024) }),
    ).rejects.toThrow('96KiB')
  })

  it('未知 kind 拒绝', async () => {
    await expect(buildPresentResult({ kind: 'json-render', title: 't' })).rejects.toThrow()
  })
})

describe('buildPresentResult component-ui', () => {
  const uiOf = (root: unknown) => ({
    kind: 'component-ui',
    title: '两章对比选择',
    chapters: [
      { key: 'c1', label: '第一章', flatIndex: 0 },
      { key: 'c2', label: '第二章', flatIndex: 1 },
    ],
    ui: { root },
  })

  it('合法树组装稳定信封并验摘录', async () => {
    const dispose = setupBook()
    try {
      const json = await buildPresentResult(
        uiOf([
          { component: 'Text', props: { text: '选维度', variant: 'title' } },
          {
            component: 'Select',
            props: { id: 'dim', options: [{ value: 'm', label: '论证方法' }] },
          },
          { component: 'Evidence', props: { excerpt: '论点甲', chapterKey: 'c1' } },
          { component: 'Button', props: { label: '继续分析', action: 'submit-selection' } },
        ]),
      )
      const parsed = parsePresentResult(json)
      expect(parsed?.kind).toBe('component-ui')
      const again = await buildPresentResult(
        uiOf([
          { component: 'Text', props: { text: '选维度', variant: 'title' } },
          {
            component: 'Select',
            props: { id: 'dim', options: [{ value: 'm', label: '论证方法' }] },
          },
          { component: 'Evidence', props: { excerpt: '论点甲', chapterKey: 'c1' } },
          { component: 'Button', props: { label: '继续分析', action: 'submit-selection' } },
        ]),
      )
      expect(JSON.parse(again).id).toBe(JSON.parse(json).id)
    } finally {
      dispose()
    }
  })

  it('无 Select/伪造摘录/未知组件整单拒绝', async () => {
    const dispose = setupBook()
    try {
      await expect(
        buildPresentResult(uiOf([{ component: 'Text', props: { text: '纯展示' } }])),
      ).rejects.toThrow(/Select/)
      await expect(
        buildPresentResult(
          uiOf([
            {
              component: 'Select',
              props: { id: 's', options: [{ value: 'a', label: 'A' }] },
            },
            { component: 'Evidence', props: { excerpt: '根本不在原文', chapterKey: 'c1' } },
            { component: 'Button', props: { label: '提交', action: 'submit-selection' } },
          ]),
        ),
      ).rejects.toThrow(/原文/)
      await expect(
        buildPresentResult(
          uiOf([
            {
              component: 'Select',
              props: { id: 's', options: [{ value: 'a', label: 'A' }] },
            },
            { component: 'Map', props: {} },
          ]),
        ),
      ).rejects.toThrow()
    } finally {
      dispose()
    }
  })
})

describe('stripHostileHtmlHead', () => {
  it('大小写与引号变体均剥离，正文保留', () => {
    expect(stripHostileHtmlHead('<BASE HREF="/">ok')).toBe('ok')
    expect(stripHostileHtmlHead("<meta http-equiv='content-security-policy' content='x'>ok")).toBe('ok')
    expect(stripHostileHtmlHead('<meta http-equiv="refresh" content="0;url=data:text/html,hi">ok')).toBe('ok')
    expect(stripHostileHtmlHead('<meta name="viewport" content="width=1">ok')).toBe('ok')
  })
})
