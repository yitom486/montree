import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchBuiltApp } from './helpers/launch-app'
import {
  E2E_WEB_DOC_CARD_URL,
  E2E_WEB_DOC_INSTALL_URL,
  E2E_WEB_DOC_START_URL,
  webDocFixtureDir,
  welcomeWebDocUrlField,
} from './helpers/web-doc-fixture'

function webDocFrame(window: Awaited<ReturnType<Awaited<ReturnType<typeof launchBuiltApp>>['firstWindow']>>) {
  return window.frameLocator('.web-doc-viewer-host iframe')
}

function mainPanel(window: Awaited<ReturnType<Awaited<ReturnType<typeof launchBuiltApp>>['firstWindow']>>) {
  return window.locator('#main')
}

test.describe('在线文档阅读', () => {
  test('在线批注：正文划选、保存并在重载后恢复', async () => {
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await welcomeWebDocUrlField(window).fill('https://e2e.montree.test/book/primitives.html')
      await welcomeWebDocUrlField(window).press('Enter')
      const frame = webDocFrame(window)
      const paragraph = frame.getByText('A chapter about primitive types in Rust.', { exact: true })
      await expect(paragraph).toBeVisible()
      await expect(window.locator('iframe[data-web-doc-interactive="true"]')).toHaveCount(1)
      await paragraph.click({ clickCount: 3 })
      expect(await paragraph.evaluate(el => el.ownerDocument.getSelection()?.toString())).toContain('primitive types')
      const toolbar = window.getByRole('toolbar', { name: '选区操作' })
      await expect(toolbar).toBeVisible()
      await toolbar.getByRole('button', { name: '批注', exact: true }).click()
      const dialog = window.getByRole('dialog', { name: '添加批注' })
      await dialog.getByPlaceholder('写下你的想法…').fill('网页批注持久化验证')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(window.getByText('已保存批注', { exact: true })).toBeVisible()
      await window.reload()
      await expect(webDocFrame(window).getByRole('heading', { name: 'Primitives', exact: true })).toBeVisible()
      await mainPanel(window).getByRole('button', { name: '批注簿', exact: true }).click()
      await expect(window.getByText('网页批注持久化验证', { exact: true }).first()).toBeVisible()
    } finally { await app.close() }
  })

  test('优先渲染站点声明的 Markdown 源，失败才回退 HTML', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/docs/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html>
          <html><head><link rel="alternate" type="text/markdown" href="/docs/page.md"></head>
          <body><article><h1>HTML Fallback</h1><p>这段 HTML 不应成为正文。</p></article></body></html>`)
        return
      }
      if (req.url === '/docs/page.md') {
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' }).end(
          '# Markdown Source\n\n这段正文来自 Markdown 源。\n\n```ts\nconst fromMarkdown = true\n```',
        )
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>(resolve => server.listen(0, 'localhost', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('本机测试服务未监听')
    const origin = `http://localhost:${address.port}`
    try {
      const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: '' })
      try {
        const window = await app.firstWindow()
        await window.waitForLoadState('domcontentloaded')
        await welcomeWebDocUrlField(window).fill(`${origin}/docs/page`)
        await welcomeWebDocUrlField(window).press('Enter')
        const frame = webDocFrame(window)
        await expect(frame.getByRole('heading', { name: 'Markdown Source', exact: true })).toBeVisible()
        await expect(frame.getByText('这段正文来自 Markdown 源。')).toBeVisible()
        await expect(frame.getByText('const fromMarkdown = true')).toBeVisible()
        await expect(frame.locator('.code-block-lines')).toHaveCount(0)
        await expect(frame.getByText('HTML Fallback')).toHaveCount(0)
      } finally {
        await app.close()
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  test('本地mdBook：真实HTTP读取、目录跳转与Rust高亮', async () => {
    const files: Record<string, string> = {
      '/book/primitives.html': 'mdbook-primitives.html',
      '/book/toc.html': 'mdbook-toc.html',
      '/book/primitives/literals.html': 'mdbook-literals.html',
    }
    const requests: string[] = []
    const server = createServer((req, res) => {
      const path = req.url ?? '/'
      requests.push(path)
      const file = files[path]
      if (!file) { res.writeHead(404).end(); return }
      void readFile(join(webDocFixtureDir(), file)).then(body => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body)
      }).catch(() => res.writeHead(500).end())
    })
    await new Promise<void>(resolve => server.listen(0, 'localhost', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('本机测试服务未监听')
    const origin = `http://localhost:${address.port}`
    let app: Awaited<ReturnType<typeof launchBuiltApp>> | undefined
    try {
      app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: '' })
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await welcomeWebDocUrlField(window).fill(`${origin}/book/primitives.html`)
      await welcomeWebDocUrlField(window).press('Enter')
      const frame = webDocFrame(window)
      await expect(frame.getByRole('heading', { name: 'Primitives', exact: true })).toBeVisible()
      await expect(frame.locator('code.hljs.language-rust .hljs-keyword').first()).toHaveText('fn')
      await mainPanel(window).getByRole('button', { name: '目录', exact: true }).click()
      await mainPanel(window).getByRole('button', { name: '2.1. Literals and operators', exact: true }).click()
      await expect(frame.getByRole('heading', { name: 'Literals and operators', exact: true })).toBeVisible()
      await expect(mainPanel(window).locator('input[placeholder="https://"]')).toHaveValue(`${origin}/book/primitives/literals.html`)
      expect(requests).toContain('/book/toc.html')
      expect(requests).toContain('/book/primitives/literals.html')
    } finally {
      await app?.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
  test('mdBook：独立toc章节树替代正文参考链接，点击子章与底栏返回保持一致', async ({}, info) => {
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await welcomeWebDocUrlField(window).fill('https://e2e.montree.test/book/primitives.html')
      await welcomeWebDocUrlField(window).press('Enter')
      const panel = mainPanel(window)
      await expect(webDocFrame(window).getByRole('heading', { name: 'Primitives', exact: true })).toBeVisible()
      const toc = panel.getByRole('button', { name: '目录', exact: true })
      await expect(toc).toBeEnabled()
      await toc.click()
      await expect(panel.getByRole('button', { name: 'Introduction', exact: true })).toBeVisible()
      await expect(panel.getByRole('button', { name: '1. Hello World', exact: true })).toBeVisible()
      const child = panel.getByRole('button', { name: '2.1. Literals and operators', exact: true })
      await expect(child).toBeVisible()
      await expect(panel.getByRole('button', { name: 'mut', exact: true })).toHaveCount(0)
      await child.click()
      await expect(webDocFrame(window).getByRole('heading', { name: 'Literals and operators', exact: true })).toBeVisible()
      await expect(panel.locator('input[placeholder="https://"]')).toHaveValue('https://e2e.montree.test/book/primitives/literals.html')
      const footer = panel.locator('footer', { hasText: '当前单元' })
      await footer.getByRole('button', { name: /上一单元/ }).click()
      await expect(webDocFrame(window).getByRole('heading', { name: 'Primitives', exact: true })).toBeVisible()
      await expect(panel.locator('input[placeholder="https://"]')).toHaveValue('https://e2e.montree.test/book/primitives.html')
      // Development Electron may initially treat its main.js argument as an external file.
      await expect(window.getByText('不支持的文件格式', { exact: true })).toBeHidden()
      await panel.screenshot({ path: info.outputPath('mdbook-toc.png') })
    } finally { await app.close() }
  })

  test('在线代码高亮：Rust语法着色、亮暗主题与原文复制', async () => {
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await window.emulateMedia({ reducedMotion: 'reduce' })
      await welcomeWebDocUrlField(window).fill('https://e2e.montree.test/book/primitives.html')
      await welcomeWebDocUrlField(window).press('Enter')
      const frame = webDocFrame(window)
      const code = frame.locator('code.hljs.language-rust')
      const source = 'fn main() {\n    // A Rust example\n    let answer: u32 = 42;\n    println!("Hello {}", answer);\n}\n'
      await expect(code).toBeVisible()
      await expect(code).toHaveText(source, { useInnerText: false })
      await expect(code.locator('.hljs-keyword').first()).toHaveText('fn')
      await expect(code.locator('.hljs-comment')).toHaveText('// A Rust example')
      for (const theme of ['light', 'dark']) {
        for (let i = 0; i < 3 && !(await window.locator('html').getAttribute('class'))?.split(' ').includes(theme); i++) {
          await window.getByRole('button', { name: '切换主题', exact: true }).click()
        }
        await expect(window.locator('html')).toHaveClass(new RegExp('(?:^| )' + theme + '(?: |$)'))
        await expect(code.locator('.hljs-keyword').first()).toHaveCSS('color', theme === 'dark' ? 'rgb(255, 123, 114)' : 'rgb(215, 58, 73)')
        const colors = await code.evaluate(el => ({ base: getComputedStyle(el).color, keyword: getComputedStyle(el.querySelector('.hljs-keyword')!).color, comment: getComputedStyle(el.querySelector('.hljs-comment')!).color, string: getComputedStyle(el.querySelector('.hljs-string')!).color }))
        expect(colors.keyword).not.toBe(colors.base)
        expect(colors.comment).not.toBe(colors.keyword)
        expect(colors.string).not.toBe(colors.keyword)
      }
      await frame.getByRole('button', { name: '复制代码', exact: true }).click()
      await expect.poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(source)
      expect(await code.evaluate(el => el.textContent)).toBe(source)
    } finally { await app.close() }
  })

  test('论文 SVG 插图可加载，表格保留对齐和合并，宽表只在自身横向滚动', async () => {
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })
    try {
      const window = await app.firstWindow()
      await window.route('https://e2e.montree.test/docs/academic/architecture.svg', (route) => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="476" height="291"><rect width="476" height="291" fill="white"/><text x="24" y="50">Sandbox architecture</text></svg>',
      }))
      await window.waitForLoadState('domcontentloaded')
      await welcomeWebDocUrlField(window).fill('https://e2e.montree.test/docs/academic')
      await welcomeWebDocUrlField(window).press('Enter')
      const frame = webDocFrame(window)
      const image = frame.locator('img.web-doc-object-image')
      await expect(image).toBeVisible()
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(476)
      await expect(image).toHaveAttribute('src', 'https://e2e.montree.test/docs/academic/architecture.svg')
      await expect(frame.locator('object')).toHaveCount(0)
      expect(await image.evaluate(() => (window as Window & { __objectExecuted?: boolean }).__objectExecuted)).toBeUndefined()
      const tables = frame.locator('.web-doc-table-scroll')
      await expect(tables).toHaveCount(2)
      await expect(tables.first().locator('td').first()).toHaveCSS('text-align', 'center')
      await expect(tables.first().locator('th').first()).toHaveCSS('border-top-width', '2px')
      await expect(tables.first().locator('th').first()).toHaveCSS('border-top-style', 'solid')
      await expect(tables.first().locator('th[rowspan]')).toHaveAttribute('rowspan', '2')
      await expect(tables.first().locator('td[colspan]')).toHaveAttribute('colspan', '4')
      await expect(tables.last()).toHaveCSS('overflow-x', 'auto')
      expect(await tables.last().evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
      expect(await tables.last().evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('欢迎页打开 fixture 文档并显示正文', async () => {
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await welcomeWebDocUrlField(window).fill(E2E_WEB_DOC_START_URL)
      await welcomeWebDocUrlField(window).press('Enter')

      // 侧栏 / 主区 / Agent 横幅都可能含「在线文档」，须限定主区且 exact
      const panel = mainPanel(window)
      await expect(panel.getByText('在线文档', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(panel.locator('input[placeholder="https://"]')).toHaveValue(E2E_WEB_DOC_START_URL)

      const frame = webDocFrame(window)
      await expect(frame.getByRole('heading', { name: 'Quick Start' })).toBeVisible({ timeout: 15_000 })
      await expect(frame.getByText('Montree E2E fixture paragraph for online document smoke tests.')).toBeVisible()
      await expect(frame.getByRole('heading', { name: 'Authentication Capabilities' })).toBeVisible()
      await expect(frame.locator('[data-component-part="field-name"]')).toHaveText('logout')
      await expect(frame.locator('[data-component-part="field-info-pill"]')).toHaveText('LogoutCapabilities Object')
      // The pointer may still be over the welcome-page input after navigation;
      // move it outside the iframe before asserting the default hidden state.
      await window.mouse.move(1, 1)
      await expect(frame.locator('.web-doc-heading-anchor-wrap')).toHaveCSS('opacity', '0')
      await expect(frame.locator('.web-doc-field-anchor-wrap')).toHaveCSS('opacity', '0')
      await expect(frame.locator('.web-doc-card-arrow')).toHaveCSS('opacity', '0')
      const divider = frame.locator('.web-doc-divider-block.web-doc-divider-after')
      await expect(divider).toHaveCount(1)
      await expect(divider).toHaveCSS('border-bottom-style', 'solid')
      await expect
        .poll(() =>
          divider.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderBottomWidth)),
        )
        .toBeGreaterThan(0)
      await expect
        .poll(() => divider.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom)))
        .toBeGreaterThan(0)
      await frame.locator('.web-doc-heading-with-anchor').hover()
      await expect(frame.locator('.web-doc-heading-anchor-wrap')).toHaveCSS('opacity', '1')
      const fieldAnchor = frame.locator('.web-doc-field-anchor')
      await fieldAnchor.hover()
      await expect(frame.locator('.web-doc-field-anchor-wrap')).toHaveCSS('opacity', '1')
      await fieldAnchor.click()
      await expect(panel.locator('input[placeholder="https://"]')).toHaveValue(
        `${E2E_WEB_DOC_START_URL}#param-logout`,
      )
      await frame.locator('.web-doc-card').hover()
      await expect(frame.locator('.web-doc-card-arrow')).toHaveCSS('opacity', '1')
      await expect(frame.locator('.web-doc-card')).toHaveCSS('position', 'relative')
      await expect(frame.locator('.web-doc-card')).toHaveCSS('display', 'block')
      await expect(frame.locator('.web-doc-card-content-container')).toHaveCSS('display', 'flex')
      await expect(frame.getByRole('button', { name: '复制代码' })).toBeVisible()
      await frame.locator('.web-doc-card').click()
      await expect(panel.locator('input[placeholder="https://"]')).toHaveValue(E2E_WEB_DOC_CARD_URL)
      await expect(frame.getByRole('heading', { name: 'Installation' })).toBeVisible({ timeout: 15_000 })
    } finally {
      await app.close()
    }
  })

  test('地址栏可切换到 fixture 第二页', async () => {
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await welcomeWebDocUrlField(window).fill(E2E_WEB_DOC_START_URL)
      await welcomeWebDocUrlField(window).press('Enter')

      const panel = mainPanel(window)
      const addressBar = panel.locator('input[placeholder="https://"]')
      await expect(addressBar).toBeVisible({ timeout: 15_000 })
      await addressBar.fill(E2E_WEB_DOC_INSTALL_URL)
      await panel.getByRole('button', { name: '前往', exact: true }).click()

      const frame = webDocFrame(window)
      await expect(frame.getByRole('heading', { name: 'Installation' })).toBeVisible({ timeout: 15_000 })
      await expect(frame.getByText('Montree E2E fixture second page content.')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('正文同源链接在应用内打开目标文档且不会逃逸到 Electron 页面', async () => {
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await welcomeWebDocUrlField(window).fill(E2E_WEB_DOC_START_URL)
      await welcomeWebDocUrlField(window).press('Enter')

      const panel = mainPanel(window)
      const frame = webDocFrame(window)
      await expect(frame.getByRole('heading', { name: 'Quick Start' })).toBeVisible({ timeout: 15_000 })

      await frame.getByRole('link', { name: 'Installation guide' }).click()

      await expect(panel.locator('input[placeholder="https://"]')).toHaveValue(E2E_WEB_DOC_INSTALL_URL)
      await expect(frame.getByRole('heading', { name: 'Installation' })).toBeVisible({ timeout: 15_000 })
      await expect(frame.getByText('Montree E2E fixture second page content.')).toBeVisible()

      const readerFrame = window.frames().find((candidate) => candidate.url() === 'about:srcdoc')
      expect(readerFrame).toBeDefined()
      await expect(readerFrame!.getByText(/preload 未成功注入 API/)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('正文 fragment 链接保留锚点并定位当前页面', async () => {
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await welcomeWebDocUrlField(window).fill(E2E_WEB_DOC_START_URL)
      await welcomeWebDocUrlField(window).press('Enter')

      const panel = mainPanel(window)
      const frame = webDocFrame(window)
      await expect(frame.getByRole('heading', { name: 'Quick Start' })).toBeVisible({ timeout: 15_000 })

      await frame.getByRole('link', { name: 'Jump to fragment target' }).click()

      await expect(panel.locator('input[placeholder="https://"]')).toHaveValue(
        `${E2E_WEB_DOC_START_URL}#fixture-fragment-target`,
      )
      const target = frame.locator('#fixture-fragment-target')
      await expect(target.getByRole('heading', { name: 'Fragment Target' })).toBeVisible()
      await expect
        .poll(() => target.evaluate((element) => element.getBoundingClientRect().top))
        .toBeLessThan(200)
    } finally {
      await app.close()
    }
  })

  test('fixture 文档可打开目录并步进', async () => {
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await welcomeWebDocUrlField(window).fill(E2E_WEB_DOC_START_URL)
      await welcomeWebDocUrlField(window).press('Enter')

      const panel = mainPanel(window)
      const tocButton = panel.getByRole('button', { name: '目录' })
      await expect(tocButton).toBeEnabled({ timeout: 15_000 })
      await tocButton.click()
      await expect(panel.getByRole('button', { name: 'Installation guide' })).toBeVisible({
        timeout: 10_000,
      })

      await panel.getByRole('button', { name: 'Installation guide' }).click()

      const frame = webDocFrame(window)
      await expect(frame.getByRole('heading', { name: 'Installation' })).toBeVisible({ timeout: 15_000 })
    } finally {
      await app.close()
    }
  })
})
