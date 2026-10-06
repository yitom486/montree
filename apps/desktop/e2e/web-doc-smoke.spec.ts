import { test, expect } from '@playwright/test'
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
