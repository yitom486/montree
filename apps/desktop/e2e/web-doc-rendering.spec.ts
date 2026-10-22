import { createServer } from 'node:http'
import { expect, test, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import { welcomeWebDocUrlField } from './helpers/web-doc-fixture'

const markdown = [
  '# Diagrams and Math', '', 'Inline formula: $E=mc^2$.', '',
  '$$', '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', '$$', '',
  '$$', '\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}', '$$', '',
  '```mermaid', 'flowchart LR', '  A[Markdown] --> B[Pele]', '```', '',
  '```mermaid', 'sequenceDiagram', '  Alice->>Bob: Hello', '```', '',
  '```python', 'literal = "$$x^2$$"', '```',
].join('\n')

function frame(page: Page) { return page.frameLocator('.web-doc-viewer-host iframe') }

async function expectLocalMathFonts(page: Page) {
  const loaded = await frame(page).locator('body').evaluate(async (body) => {
    const doc = body.ownerDocument
    await doc.fonts.load('16px KaTeX_Main')
    await doc.fonts.ready
    return [...doc.fonts].some((font) => font.family.replaceAll('"', '') === 'KaTeX_Main' && font.status === 'loaded')
  })
  expect(loaded, '随应用打包的 KaTeX 字体应实际加载').toBe(true)
}

test('在线 Markdown：Pele 图表、源码复制、公式字体与亮暗主题', async ({}, info) => {
  const server = createServer((req, res) => {
    if (req.url === '/docs/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
        '<!doctype html><html><head><link rel="alternate" type="text/markdown" href="/docs/page.md"></head><body><article><h1>HTML fallback</h1></article></body></html>',
      )
    } else if (req.url === '/docs/page.md') {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' }).end(markdown)
    } else res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server not listening')
  const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: '' })
  try {
    const page = await app.firstWindow()
    const remoteAssets: string[] = []
    await page.route('https://**/*', (route) => {
      remoteAssets.push(route.request().url())
      return route.abort()
    })
    await welcomeWebDocUrlField(page).fill(`http://localhost:${address.port}/docs/page`)
    await welcomeWebDocUrlField(page).press('Enter')
    const reader = frame(page)
    await expect(reader.getByRole('heading', { name: 'Diagrams and Math', exact: true })).toBeVisible()
    await expect(reader.locator('.web-doc-mermaid svg[data-montree-renderer="pele"]')).toHaveCount(2)
    await expect(reader.locator('.katex')).toHaveCount(3)
    await expect(reader.locator('.katex-display')).toHaveCount(2)
    await expect(reader.locator('.katex-error')).toHaveCount(0)
    const radical = reader.locator('.katex .sqrt svg').first()
    await expect(radical).toBeVisible()
    expect((await radical.boundingBox())!.height).toBeGreaterThan(5)
    expect(await reader.locator('.katex .sizing').first().evaluate((node) => {
      const view = node.ownerDocument.defaultView!
      return parseFloat(view.getComputedStyle(node).fontSize) < parseFloat(view.getComputedStyle(node.closest('.katex')!).fontSize)
    }), '上下标应小于公式正文字号').toBe(true)
    await expect(reader.locator('code.language-python')).toContainText('$$x^2$$')
    await expectLocalMathFonts(page)
    for (const theme of ['light', 'dark']) {
      for (let i = 0; i < 3 && !(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme); i++) {
        const before = await page.locator('html').getAttribute('class')
        await page.getByRole('button', { name: '切换主题', exact: true }).click()
        await expect.poll(() => page.locator('html').getAttribute('class')).not.toBe(before)
      }
      await expect(page.locator('html')).toHaveClass(new RegExp(`(?:^| )${theme}(?: |$)`))
      const svg = reader.locator('.web-doc-mermaid svg[data-montree-renderer="pele"]').first()
      await expect(svg).toBeVisible()
      await expect(svg).toHaveAttribute('style', new RegExp(`--pele-bg:\\s*${theme === 'dark' ? '#0f172a' : '#ffffff'}`))
      await expectLocalMathFonts(page)
      await page.locator('.web-doc-viewer-host').screenshot({ path: info.outputPath(`online-rendering-${theme}.png`) })
    }
    const source = reader.locator('.web-doc-mermaid details').first()
    await source.locator('summary').click()
    await expect(source.locator('pre')).toContainText('A[Markdown] --> B[Pele]')
    await source.getByRole('button', { name: /复制/ }).click()
    await expect.poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n'))
      .toBe('flowchart LR\n  A[Markdown] --> B[Pele]')
    expect(remoteAssets.filter((url) => /katex|\.woff/.test(url))).toEqual([])
  } finally {
    await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

for (const [name, url] of [
  ['MkDocs Math', 'https://squidfunk.github.io/mkdocs-material/reference/math/'],
  ['D2L Linear Algebra', 'https://d2l.ai/chapter_preliminaries/linear-algebra.html'],
]) {
  test(`真实在线公式：${name}`, async ({}, info) => {
    test.skip(process.env.E2E_WEB_DOC_RENDERING_LIVE !== '1', '显式开启联网实测')
    test.setTimeout(120_000)
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: '' })
    try {
      const page = await app.firstWindow()
      await welcomeWebDocUrlField(page).fill(url)
      await welcomeWebDocUrlField(page).press('Enter')
      const reader = frame(page)
      await expect(reader.locator('.katex').first()).toBeVisible({ timeout: 60_000 })
      await expect(reader.locator('.katex-display').first()).toBeVisible()
      await expect(reader.locator('.katex-error')).toHaveCount(0)
      await expectLocalMathFonts(page)
      const count = await reader.locator('.katex').count()
      await info.attach('formula-count', { body: JSON.stringify({ url, count }), contentType: 'application/json' })
      await reader.locator('.katex-display').first().scrollIntoViewIfNeeded()
      await page.locator('.web-doc-viewer-host').screenshot({ path: info.outputPath('live-math.png') })
      console.log(`${name}: ${count} formulas rendered`)
    } finally { await app.close() }
  })
}
