import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

export const E2E_WEB_DOC_START_URL = 'https://e2e.montree.test/docs/start'
export const E2E_WEB_DOC_INSTALL_URL = 'https://e2e.montree.test/docs/installation'
export const E2E_WEB_DOC_CARD_URL = 'https://e2e.montree.test/docs/card'
export const E2E_WEB_DOC_XSS_URL = 'https://e2e.montree.test/docs/xss'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function webDocFixtureDir(): string {
  return path.join(__dirname, '../fixtures/web-doc')
}

/** 欢迎页与侧栏共用同一 placeholder，必须限定主区。 */
export function welcomeWebDocUrlField(window: Page) {
  return window.locator('#main').getByPlaceholder('https://react.dev/learn')
}
