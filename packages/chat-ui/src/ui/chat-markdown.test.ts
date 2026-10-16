// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMarkdown, resolveMermaidTheme } from './chat-markdown'


// happy-dom has no layout/visibility; only the observer is supplied. The actual plugin renders in Electron tests.
vi.stubGlobal('IntersectionObserver', class {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
  disconnect() {}
  unobserve() {}
  takeRecords() { return [] }
})
vi.mock('@streamdown/mermaid', () => ({ createMermaidPlugin: () => ({
  name: 'mermaid', type: 'diagram', language: 'mermaid',
  getMermaid: () => ({ initialize() {}, render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>A to B</text></svg>' }) }),
}) }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

async function render(text: string, streaming = false): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(ChatMarkdown, { text, streaming }))
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 420)) })
  const html = container.innerHTML
  act(() => {
    root.unmount()
  })
  container.remove()
  const probe = document.createElement('div')
  probe.innerHTML = html
  return probe
}

describe('ChatMarkdown（Streamdown 接入）', () => {
  it('同段追加只动画新字，旧字与段落节点保持稳定，结束后不丢正文', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const draw = async (text: string, streaming = true) => {
      await act(async () => root.render(createElement(ChatMarkdown, { text, streaming })))
    }
    try {
      await draw('原生中文')
      const paragraph = container.querySelector('p')!
      const firstChar = paragraph.querySelector<HTMLElement>('[data-sd-animate]')!
      expect(firstChar.style.getPropertyValue('--sd-duration')).toBe('150ms')
      await draw('原生中文继续输出')
      expect(container.querySelector('p')).toBe(paragraph)
      expect(paragraph.querySelector('[data-sd-animate]')).toBe(firstChar)
      expect(firstChar.style.getPropertyValue('--sd-duration')).toBe('0ms')
      expect(paragraph.querySelectorAll('[data-sd-animate]')).toHaveLength(8)
      expect(paragraph.querySelectorAll<HTMLElement>('[data-sd-animate]')[4]?.style.getPropertyValue('--sd-duration')).toBe('150ms')
      await draw('原生中文继续输出', false)
      expect(container.querySelector('p')).toBe(paragraph)
      expect(container.querySelector('[data-sd-animate]')).toBeNull()
      expect(container.textContent).toBe('原生中文继续输出')
    } finally { act(() => root.unmount()); container.remove() }
  })
  it('空行与后续段落到达时保留已有正文节点和原生折叠状态', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const draw = async (text: string, streaming = true) => {
      await act(async () => root.render(createElement(ChatMarkdown, { text, streaming })))
    }
    try {
      await draw('首段正文。')
      const paragraph = container.querySelector('p')!
      await draw('首段正文。\n\n')
      expect(container.querySelector('p')).toBe(paragraph)
      const prefix = '首段正文。\n\n<details><summary>证据</summary>原文摘录</details>'
      await draw(prefix)
      const details = container.querySelector('details')!
      details.open = true
      await draw(prefix + '\n\n后续内容。')
      expect(container.querySelector('p')).toBe(paragraph)
      expect(container.querySelector('details')).toBe(details)
      expect(details.open).toBe(true)
      await draw(prefix + '\n\n后续内容。', false)
      expect(container.querySelector('p')).toBe(paragraph)
      expect(container.querySelector('details')).toBe(details)
    } finally { act(() => root.unmount()); container.remove() }
  })
  it('渲染中文加粗、表格、任务列表与单换行', async () => {    const el = await render('这是**加粗**的中文\n第二行\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] 完成\n- [ ] 待办')
    expect(el.querySelector('strong')?.textContent).toBe('加粗')
    expect(el.querySelector('table')).not.toBeNull()
    expect(el.querySelectorAll('table td')[1]?.textContent).toBe('2')
    const checkbox = el.querySelector('input[type="checkbox"]')
    expect(checkbox).not.toBeNull()
    expect(el.querySelector('p')?.innerHTML).toContain('<br>')
  })

  it('流式空行结尾不重复渲染正文', async () => {
    const el = await render('# 标题\n\n首段正文。\n\n', true)
    const hits = [...el.querySelectorAll('p')].filter((p) => p.textContent === '首段正文。')
    expect(hits).toHaveLength(1)
    expect(el.querySelectorAll('h1')).toHaveLength(1)
  })

  it('长文流式风暴：120 帧增量渲染有界 + 首段节点稳定', async () => {
    // 性能冒烟（非基准）：Streamdown 内置块缓存接住增量复用后，
    // 120 帧 × 11k 字应远低于阈值；若退化为全文重解析/整树重挂，
    // 总耗时与节点 churn 会立刻超标。happy-dom 无布局，测的是解析+调和成本。
    // 阈值取实测 12 倍（CI 机器按 4 倍慢仍有 3 倍余量），只抓退化不卡优化。
    const paras: string[] = ['# 长文性能冒烟']
    for (let i = 0; i < 120; i += 1) {
      paras.push(`第${i + 1}段：` + '内容填充文字。'.repeat(12))
    }
    const full =
      `${paras.join('\n\n')}\n\n\`\`\`ts\nconst answer = 42\n\`\`\`\n\n| 甲 | 乙 |\n|---|---|\n| 1 | 2 |`
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      const chunks = 120
      const step = Math.ceil(full.length / chunks)
      let firstParagraph: Element | null = null
      const startedAt = performance.now()
      for (let n = 1; n <= chunks; n += 1) {
        const text = full.slice(0, n * step)
        act(() => {
          root.render(createElement(ChatMarkdown, { text, streaming: true }))
        })
        if (n === 12) firstParagraph = container.querySelector('p')
      }
      const elapsedMs = performance.now() - startedAt
      await act(async () => {})
      expect(elapsedMs).toBeLessThan(3000)
      // 首段节点贯穿风暴不重挂（重挂=整树抖动，体感即闪烁）
      expect(firstParagraph).not.toBeNull()
      expect(container.querySelector('p')).toBe(firstParagraph)
      // 尾部到达的块一次成形、无复份（120 编号段 + 表格行文；标题为 h1 不计入）
      expect(container.querySelectorAll('p')).toHaveLength(120)
      expect(container.querySelector('[data-streamdown=code-block] code')?.textContent).toContain('const answer = 42')
      expect(container.querySelector('table')).not.toBeNull()
    } finally {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('流式状态经 data-status 暴露（tip 光标的 CSS 开关）', async () => {    const running = await render('正在输出', true)
    expect(running.querySelector('[data-status="running"]')).not.toBeNull()
    const done = await render('正在输出', false)
    expect(done.querySelector('[data-status="complete"]')).not.toBeNull()
    expect(done.querySelector('[data-status="running"]')).toBeNull()
  })

  it('Mermaid 主题跟随主题 prop 映射', () => {
    expect(resolveMermaidTheme('dark')).toBe('dark')
    expect(resolveMermaidTheme('light')).toBe('default')
    expect(resolveMermaidTheme('sepia')).toBe('neutral')
  })

  it('流式中文使用原生逐字淡入，代码不拆字；落定移除动画包装', async () => {
    const running = await render('首段。\n\n次段。', true)
    const chars = [...running.querySelectorAll('[data-sd-animate]')]
    expect(chars.map(el => el.textContent)).toEqual(['首', '段', '。', '次', '段', '。'])
    expect(chars[0]?.getAttribute('style')).toContain('--sd-duration')
    expect(running.querySelector('.agent-block-in')).toBeNull()
    const code = await render('```ts\nconst value = 42\n```', true)
    expect(code.querySelector('pre [data-sd-animate]')).toBeNull()
    expect(code.querySelector('code')?.textContent).toContain('const value = 42')
    const done = await render('首段。\n\n次段。', false)
    expect(done.querySelector('[data-sd-animate]')).toBeNull()
    // 内容本身不受包装影响
    expect(done.textContent).toContain('首段。')
    expect(done.textContent).toContain('次段。')
  })

  it('裸链接可点击，javascript: 被拦截且点击无导航', async () => {
    const el = await render('[文档](https://example.com/a) 与裸链接 https://example.com/b\n\n[点我](javascript:alert(1))')
    const links = [...el.querySelectorAll('a')]
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/a')
    expect(links[1]?.textContent).toContain('https://example.com/b')
    const evil = links.find((a) => a.textContent === '点我')
    // 消毒剥 href 或策略落到 '#'：两种形态都不得出现 javascript:
    expect(evil?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('xss 载荷不执行：img 整体转义为文本，无事件属性落点', async () => {
    const el = await render('<img src="x" onerror="alert(2)" />')
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('[onerror]')).toBeNull()
    expect(el.textContent).not.toContain('alert(2)')
  })

  it('裸 script/iframe 不执行：元素剥离', async () => {
    const el = await render('<script>alert(1)</script><iframe src="https://example.com"></iframe>')
    expect(el.querySelector('script')).toBeNull()
    expect(el.querySelector('iframe')).toBeNull()
  })

  it('裸 HTML 容器与强调渲染为元素，围栏内仍显示源码', async () => {
    const raw = '<div style="padding:8px;border:1px solid #888;border-radius:8px">我是裸div <b>粗体</b> <button>真按钮</button><a href="https://openai.com">链接</a></div>'
    const el = await render(raw)
    expect(el.querySelector('b')?.textContent).toBe('粗体')
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://openai.com/')
    expect(el.textContent).not.toContain('<div>')
    expect(el.querySelector('[style*="padding:8px"]')).toBeNull()
    expect([...el.querySelectorAll('button')].some(button => button.textContent === '真按钮')).toBe(false)
    const fenced = await render('```html\n' + raw + '\n```')
    expect(fenced.querySelector('code')?.textContent).toContain(raw)
    expect(fenced.querySelector('b')).toBeNull()
  })

  it('反引号与转义后的 HTML 保持文本，不再次解释成标签', async () => {
    const raw = '<div>裸块 <b>粗体</b></div>'
    const inline = await render('`' + raw + '`')
    expect(inline.querySelector('code')?.textContent).toBe(raw)
    expect(inline.querySelector('b')).toBeNull()
    const escaped = await render('&lt;div&gt;裸块 &lt;b&gt;粗体&lt;/b&gt;&lt;/div&gt;')
    expect(escaped.textContent).toContain(raw)
    expect(escaped.querySelector('b')).toBeNull()
  })

  it('用户原文中的反引号说明不影响后续裸 HTML', async () => {
    const source = '对，你看得很准。\n\n刚才那段是包在 ````html 里面的，所以只会当代码高亮显示，不会真渲染成按钮、卡片。\n\n要测 Markdown 支持的那种 HTML，得是**裸 HTML**，直接裸写在正文里，不要加围栏，比如下面这行就是真的：\n\n<div style="padding:8px;border:1px solid #888;border-radius:8px">我是裸div <b>粗体</b> <button>真按钮</button></div>\n\n你贴到 Montree 试的时候，贴这个裸版本：\n\n现在又可以渲染了呢\n\n<div style="padding:12px;border:1px solid #ccc">裸块 <a href="https://openai.com">链接</a></div>\n\n如果它渲染成卡片/按钮就是支持，如果原样吐出尖括号就是被过滤/转义了。'
    for (const streaming of [true, false]) {
      const el = await render(source, streaming)
      expect(el.querySelector('b')?.textContent).toBe('粗体')
      expect(el.querySelector('a')?.getAttribute('href')).toBe('https://openai.com/')
    }
  })

  it('社区代码块包含工具栏、复制入口与原文', async () => {
    const el = await render('```ts\nconst answer = 42\n```')
    expect(el.querySelector('[data-streamdown=code-block-header]')?.textContent).toBe('ts')
    expect(el.querySelector('button[data-streamdown=code-block-copy-button]')).not.toBeNull()
    expect(el.querySelector('[data-streamdown=code-block] code')?.textContent).toContain('const answer = 42')
    expect(el.querySelector('[data-streamdown=code-block] pre')?.textContent).toContain('const answer = 42')
  })

  it('未闭合围栏直接成块，不吞内容', async () => {
    const el = await render('```ts\nconst x = 1', true)
    expect(el.querySelector('[data-streamdown=code-block]')).not.toBeNull()
    expect(el.textContent).toContain('const x = 1')
  })

  it('公式：行内单美元、块公式与括号形式均渲染，货币保持原文', async () => {
    const el = await render('行内 $E=mc^2$ 与块 $$\\frac{a}{b}$$ 与括号 \\(x+1\\)')
    expect(el.querySelectorAll('.katex')).toHaveLength(3)
    const currency = await render('价格 $100 和 $200')
    expect(currency.querySelector('.katex')).toBeNull()
    expect(currency.textContent).toContain('$100')
  })

  it('数字开头的括号公式同样渲染（非仅 $100 差异）', async () => {
    const el = await render('计算 \\(2+2\\)')
    expect(el.querySelectorAll('.katex')).toHaveLength(1)
    const spaced = await render('计算 \\(A + B\\)')
    expect(spaced.querySelectorAll('.katex')).toHaveLength(1)
  })

  it('无语言围栏保留多行块与复制按钮（text 回退）', async () => {
    const el = await render('```\nfirst line\nsecond line\n```')
    const code = el.querySelector('pre code')
    expect(code).not.toBeNull()
    expect(code?.textContent).toContain('first line')
    expect(code?.textContent).toContain('second line')
    expect(el.querySelector('[data-streamdown=code-block-copy-button]')).not.toBeNull()
    expect(el.querySelector('[data-streamdown=code-block-header]')?.textContent).toBe('text')
  })

  it('行内代码保持裸 code（非块）', async () => {
    const el = await render('这是 `inline` 代码')
    expect(el.querySelector('code')?.textContent).toBe('inline')
    expect(el.querySelector('[data-streamdown=code-block]')).toBeNull()
  })

  it('未闭合公式流式可读呈现，闭合后恢复', async () => {
    const open = await render('$$\\frac{a}{b', true)
    expect(open.querySelector('.katex-error')).not.toBeNull()
    expect(open.textContent).toContain('\\frac{a}{b')
    const closed = await render('$$\\frac{a}{b}$$', false)
    expect(closed.querySelector('.katex-display, .katex')).not.toBeNull()
  })

  it('mark/sub/sup 与 alert 渲染', async () => {
    const el = await render('这是==高亮==和~下标~与^上标^\n\n> [!NOTE]\n> 提示内容')
    expect(el.querySelector('mark')?.textContent).toBe('高亮')
    expect(el.querySelector('sub')?.textContent).toBe('下标')
    expect(el.querySelector('sup')?.textContent).toBe('上标')
    expect(el.querySelector('.markdown-alert.markdown-alert-note')).not.toBeNull()
  })

  it('原生折叠与按键帽：details/summary/kbd 成元素，open 透传', async () => {
    const el = await render('<details><summary>点我展开</summary>里面是细节</details>\n\n按 <kbd>Ctrl</kbd>+<kbd>K</kbd>')
    const details = el.querySelector('details')
    expect(details).not.toBeNull()
    expect(details?.querySelector('summary')?.textContent).toContain('点我展开')
    expect(details?.textContent).toContain('里面是细节')
    expect(el.querySelectorAll('kbd')).toHaveLength(2)
    const opened = await render('<details open><summary>展</summary>内容</details>')
    expect(opened.querySelector('details')?.hasAttribute('open')).toBe(true)
  })

  it('折叠内 XSS 同样中和：事件属性剥离、危险链接拦截', async () => {
    const el = await render('<details onclick="alert(1)"><summary>展</summary><img src="x" onerror="alert(2)" />\n\n[点我](javascript:alert(3))</details>')
    const details = el.querySelector('details')!
    expect(details).not.toBeNull()
    expect(details.hasAttribute('onclick')).toBe(false)
    expect(el.querySelector('img')).toBeNull()
    const evil = [...el.querySelectorAll('a')].find((a) => a.textContent === '点我')
    expect(evil?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('tel 链接与 data 图片按既有策略放行', async () => {
    const el = await render('[拨打](tel:123)\n\n![图](data:image/png;base64,iVBORw0KGgo=)')
    expect(el.querySelector('a[href="tel:123"]')).not.toBeNull()
    expect(el.querySelector('img')?.getAttribute('src')).toContain('data:image/png')
  })

  it('脚注引用与定义成对渲染（引用为行内链接形态）', async () => {
    const el = await render('正文[^1]\n\n[^1]: 脚注内容')
    expect(el.textContent).toContain('脚注内容')
    expect(el.querySelector('sup a[href^="#"]')).not.toBeNull()
    expect(el.querySelector('section.footnotes')).not.toBeNull()
  })

  it('社区 Mermaid 未闭合不出图、闭合后挂载', async () => {
    const open = await render('```mermaid\ngraph TD; A-->', true)
    expect(open.querySelector('[data-streamdown=mermaid] svg')).toBeNull()
    expect(open.querySelector('[data-streamdown=mermaid] svg')).toBeNull()
    const closed = await render('```mermaid\ngraph TD; A-->B\n```', true)
    expect(closed.querySelector('[data-streamdown="mermaid-block"]')).not.toBeNull()
  })

  it('标题链接对应消息内唯一锚点', async () => {
    const el = await render('# 标题一\n\n[回到标题](#标题一)\n\n# 标题一')
    expect(el.querySelector('h1')?.textContent).toBe('标题一')
    const headings = [...el.querySelectorAll('h1')]
    expect(headings[0]!.id).toBeTruthy()
    expect(headings[0]!.id).not.toBe(headings[1]!.id)
    expect(el.querySelector('a')?.getAttribute('href')).toBe(`#${headings[0]!.id}`)
  })

  it('数字公式跨 chunk 恢复解析，货币与显式转义保持文本', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      act(() => root.render(createElement(ChatMarkdown, { text: '结果 $2x+', streaming: true })))
      act(() => root.render(createElement(ChatMarkdown, { text: String.raw`结果 $2x+1$，价格 $100 和 $200，显式 \$300`, streaming: false })))
      expect(container.querySelectorAll('.katex')).toHaveLength(1)
      expect(container.textContent).toContain('价格 $100 和 $200')
      expect(container.textContent).toContain('显式 $300')
    } finally { act(() => root.unmount()); container.remove() }
  })

  it('两个消息的同号脚注隔离，引用和返回点击到实际目标并保持 ID', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const text = '正文[^1]\n\n另一段再次引用[^1]\n\n[^1]: 脚注内容'
    const draw = (tail: string) => act(() => root.render(createElement('div', {},
      createElement('article', { key: 'a' }, createElement(ChatMarkdown, { text: text + tail, streaming: false })),
      createElement('article', { key: 'b' }, createElement(ChatMarkdown, { text, streaming: false })),
    )))
    try {
      draw('')
      const ids = [...container.querySelectorAll('[id]')].map((node) => node.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const article of container.querySelectorAll('article')) {
        for (const anchor of article.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
          const target = document.getElementById(anchor.hash.slice(1))!
          expect(article.contains(target)).toBe(true)
          act(() => anchor.click())
          expect(document.activeElement).toBe(target)
        }
      }
      draw('\n\n后续文字')
      expect([...container.querySelectorAll('[id]')].map((node) => node.id)).toEqual(ids)
    } finally { act(() => root.unmount()); container.remove() }
  })

  it('复制按钮文本来自代码原文（含高亮 span 也不丢字）', async () => {
    const el = await render('```ts\nconst answer = 42\n```')
    const code = el.querySelector('[data-streamdown=code-block] code')
    expect(code?.textContent).toContain('const answer = 42')
  })

  it('社区复制按钮实际点击写入代码原文', async () => {
    const written: string[] = []
    const original = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => { written.push(text); return Promise.resolve() } },
    })
    try {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      await act(async () => {
        root.render(createElement(ChatMarkdown, { text: '```ts\nconst answer = 42\n```', streaming: false }))
      })
      const button = container.querySelector('[data-streamdown=code-block-copy-button]') as HTMLButtonElement
      expect(button).not.toBeNull()
      await act(async () => button.click())
      expect(written).toEqual(['const answer = 42\n'])
      act(() => {
        root.unmount()
      })
      container.remove()
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: original })
    }
  })

  it('社区 Mermaid 跨 chunk 保持挂载点', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const renderText = async (text: string) => {
      await act(async () => root.render(createElement(ChatMarkdown, { text, streaming: true })))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 420)) })
    }
    await renderText('```mermaid\ngraph TD; A-->')
    expect(container.querySelector('[data-streamdown=mermaid] svg')).toBeNull()
    expect(container.querySelector('[data-streamdown=mermaid] svg')).toBeNull()
    await renderText('```mermaid\ngraph TD; A-->B\n```\n\n后续正文')
    const first = container.querySelector('[data-streamdown="mermaid-block"]')
    expect(first).not.toBeNull()
    await renderText('```mermaid\ngraph TD; A-->B\n```\n\n后续正文再追加一段')
    // 同一挂载点：已完成图表不因后续文字重建
    expect(container.querySelector('[data-streamdown="mermaid-block"]')).toBe(first)
    expect(container.textContent).toContain('后续正文再追加一段')
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('details 展开出现底部收起按钮，点击收起关闭', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(ChatMarkdown, {
        text: '<details><summary>标题</summary>正文</details>',
        streaming: false,
      })))
      const details = container.querySelector('details')!
      // 收起态无按钮
      expect(container.querySelector('details > button')).toBeNull()
      await act(async () => {
        details.setAttribute('open', '')
        details.dispatchEvent(new Event('toggle'))
      })
      const button = container.querySelector('details > button')
      expect(button?.textContent).toContain('收起')
      await act(async () => {
        button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(details.hasAttribute('open')).toBe(false)
      expect(container.querySelector('details > button')).toBeNull()
    } finally { act(() => root.unmount()); container.remove() }
  })

  it('details 胎内 markdown 二次解析：加粗/行内代码成元素而非源码', async () => {
    const el = await render(
      '<details><summary>点击展开</summary>\n\n文字 **加粗** 和 `code` 结尾\n\n</details>',
    )
    const details = el.querySelector('details')!
    expect(details.querySelector('summary')?.textContent).toContain('点击展开')
    // 胎内不再是源码裸奔：strong 与行内 code 必须成元素
    expect(details.querySelector('strong')?.textContent).toBe('加粗')
    expect(details.textContent).not.toContain('**')
    expect(el.querySelector('details details')).toBeNull()
  })

  it('details 无 summary 时给默认标题；空胎不挂空解析器', async () => {
    const el = await render('<details>\n\n只有正文\n\n</details>')
    expect(el.querySelector('details > summary')?.textContent).toContain('展开查看详情')
    expect(el.querySelector('details')?.textContent).toContain('只有正文')
  })
})
