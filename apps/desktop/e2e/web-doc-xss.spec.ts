import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'
import {
  E2E_WEB_DOC_XSS_URL,
  webDocFixtureDir,
  welcomeWebDocUrlField,
} from './helpers/web-doc-fixture'

/**
 * 真浏览器 XSS 回归：happy-dom 下 DOMPurify 属性级行为失真，属性级断言只在
 * 真实 Chromium 中有效。fixture 在线文档携带 script / javascript: / 事件处理器，
 * 断言渲染后无任何执行且正文完好。
 */
test.describe('在线文档 XSS 防护（真浏览器）', () => {
  test('恶意载荷不执行，正文与正常链接完好', async () => {
    const app = await launchBuiltApp({ E2E_WEB_DOC_FIXTURE_DIR: webDocFixtureDir() })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await welcomeWebDocUrlField(window).fill(E2E_WEB_DOC_XSS_URL)
      await welcomeWebDocUrlField(window).press('Enter')

      const frameLoc = window.frameLocator('.web-doc-viewer-host iframe')
      await expect(frameLoc.getByRole('heading', { name: 'XSS Probe' })).toBeVisible({
        timeout: 15_000,
      })
      await expect(frameLoc.getByText('Benign paragraph that must survive sanitization.')).toBeVisible()
      await expect(frameLoc.getByRole('link', { name: 'Benign link back to start' })).toBeVisible()

      const frame = window.frames().find((candidate) => candidate.url() === 'about:srcdoc')
      expect(frame).toBeDefined()

      // script / 事件处理器未执行
      const flagOf = 'window.__montreeXssFired'
      expect(
        await frame!.evaluate((flag) => (window as unknown as Record<string, unknown>)[flag], flagOf),
      ).toBeUndefined()

      // 点击可疑链接（若 href 被剥离则只是文本点击），仍无执行
      await frameLoc.getByText('suspicious link').click()
      await frameLoc.getByText('clickable div').click()
      expect(
        await frame!.evaluate((flag) => (window as unknown as Record<string, unknown>)[flag], flagOf),
      ).toBeUndefined()

      // DOM 中不存在 javascript: 链接与事件处理器属性
      expect(await frameLoc.locator('a[href^="javascript:"]').count()).toBe(0)
      expect(await frameLoc.locator('[onclick]').count()).toBe(0)
      expect(await frameLoc.locator('[onerror]').count()).toBe(0)
      // 注：Playwright 的 CSS 引擎在 srcdoc 帧内对 [onload] 有误报（整文档序列化无
      // 该子串），以帧内权威扫描为准；script 仅允许应用自带的多语言 Tab 脚本
      const domScan = await frame!.evaluate(() => {
        const html = document.documentElement.outerHTML.toLowerCase()
        return {
          hasOnloadString: html.includes('onload'),
          untrustedScripts: Array.from(document.scripts).filter(
            (script) => !(script.textContent ?? '').includes('web-doc-tabs'),
          ).length,
        }
      })
      expect(domScan.hasOnloadString).toBe(false)
      expect(domScan.untrustedScripts).toBe(0)
    } finally {
      await app.close()
    }
  })
})
