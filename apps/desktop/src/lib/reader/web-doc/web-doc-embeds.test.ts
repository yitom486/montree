// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isAllowedWebDocEmbedUrl } from './web-doc-embeds'
import {
  buildWebDocPlaygroundRuntimeScript,
  buildWebDocReaderDocument,
  extractWebDocArticle,
  sanitizeWebDocBodyHtml,
} from './web-doc-html'

describe('web-doc embeds', () => {
  it('仅允许 https Python Tutor 域名', () => {
    expect(
      isAllowedWebDocEmbedUrl('https://pythontutor.com/iframe-embed.html#code=print(1)'),
    ).toBe(true)
    expect(isAllowedWebDocEmbedUrl('https://evil.com/x')).toBe(false)
    expect(isAllowedWebDocEmbedUrl('http://pythontutor.com/x')).toBe(false)
  })

  it('保留可视化运行 iframe，去掉任意第三方 iframe', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <details class="pythontutor">
        <summary>可视化运行</summary>
        <iframe class="pythontutor-iframe"
          src="https://pythontutor.com/iframe-embed.html#code=print(1)"></iframe>
      </details>
      <iframe src="https://evil.example/track"></iframe>
      <p>正文</p>
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://www.hello-algo.com/ch/', 'generic-ssr')
    expect(result.bodyHtml).toContain('可视化运行')
    expect(result.bodyHtml).toContain('pythontutor.com/iframe-embed.html')
    expect(result.bodyHtml).not.toContain('evil.example')
    expect(result.bodyHtml).toContain('正文')
  })

  it('sanitize 后仍拒绝非白名单 iframe', () => {
    const sanitized = sanitizeWebDocBodyHtml(
      `<p>x</p><iframe src="https://attacker.test/a"></iframe>`,
    )
    expect(sanitized).not.toContain('iframe')
    expect(sanitized).toContain('x')
  })

  describe('页面伪造 iframe 不得在阅读器同源下执行脚本', () => {
    const page = (body: string) => `<!DOCTYPE html><html><body><article><h1>Doc</h1><p>正文段落</p>${body}</article></body></html>`
    const iframesOf = (html: string) => Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('iframe'))

    it('伪造演示区类名的 iframe：srcdoc 被丢弃，沙箱被强制为仅脚本', () => {
      const result = extractWebDocArticle(
        page('<iframe class="web-doc-playground-iframe" srcdoc="<script>window.top.PWNED=1</script>"></iframe>'),
        'https://evil.example/doc',
        'generic-ssr',
      )
      const reader = buildWebDocReaderDocument({ ...result, baseUrl: 'https://evil.example/doc' }, 'light')
      for (const html of [result.bodyHtml, reader]) {
        expect(html).not.toContain('PWNED')
        for (const frame of iframesOf(html)) {
          expect(frame.hasAttribute('srcdoc')).toBe(false)
          expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
        }
      }
    })

    it('白名单 src 搭配 srcdoc（srcdoc 优先生效）：只保留 src', () => {
      const result = extractWebDocArticle(
        page('<iframe src="https://pythontutor.com/iframe-embed.html" srcdoc="<script>window.top.PWNED=1</script>" sandbox="allow-scripts allow-same-origin"></iframe>'),
        'https://evil.example/doc',
        'generic-ssr',
      )
      expect(result.bodyHtml).toContain('pythontutor.com/iframe-embed.html')
      expect(result.bodyHtml).not.toContain('PWNED')
      // 没有 srcdoc 时按 https src 跨源加载，页面自带的 sandbox 只会限制它自己
      for (const frame of iframesOf(result.bodyHtml)) expect(frame.hasAttribute('srcdoc')).toBe(false)
    })

    it('缓存中修复前生成的演示区（同源沙箱）在生成阅读文档时被收紧', () => {
      const stale = '<div class="web-doc-playground"><div class="web-doc-playground-source">x</div><iframe class="web-doc-playground-iframe" sandbox="allow-scripts allow-same-origin" srcdoc="<p>old</p>"></iframe></div>'
      const reader = buildWebDocReaderDocument({ title: 'T', bodyHtml: stale, baseUrl: 'https://react.dev/learn' }, 'dark')
      const [frame] = iframesOf(reader)
      expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
      expect(frame?.hasAttribute('srcdoc')).toBe(false)
    })

    it('Sandpack 演示区只在点击运行后执行，且沙箱不带同源', () => {
      const result = extractWebDocArticle(
        page('<div class="sandpack sandpack--playground"><div class="sp-code-editor"><pre>export default function App() { return null }</pre></div></div>'),
        'https://react.dev/learn',
      )
      const reader = buildWebDocReaderDocument({ ...result, baseUrl: 'https://react.dev/learn' }, 'light')
      const doc = new DOMParser().parseFromString(reader, 'text/html')
      expect(doc.querySelector('.web-doc-playground-run-btn')?.textContent).toContain('运行示例')
      expect(doc.querySelector('.web-doc-playground-placeholder')).not.toBeNull()

      const host = document.createElement('div')
      host.innerHTML = doc.querySelector('.web-doc-playground')!.outerHTML
      document.body.append(host)
      try {
        const runtime = buildWebDocPlaygroundRuntimeScript().replace(/^<script>/, '').replace(/<\/script>$/, '')
        new Function(runtime)()
        const frame = host.querySelector<HTMLIFrameElement>('.web-doc-playground-iframe')!
        expect(frame.hasAttribute('srcdoc')).toBe(false)

        host.querySelector<HTMLButtonElement>('.web-doc-playground-run-btn')!.click()
        expect(frame.getAttribute('srcdoc')).toContain('export default function App()')
        expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
        expect(host.querySelector('.web-doc-playground-run-btn')?.textContent).toContain('重新运行')
      } finally {
        host.remove()
      }
    })
  })
})
