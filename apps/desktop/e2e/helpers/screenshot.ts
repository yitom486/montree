import type { Locator, Page } from '@playwright/test'

/**
 * 截图时隐藏 sonner toast。不要删除 toast DOM：React 仍持有这些节点，
 * 删除后再次更新会在 insertBefore/removeChild 上崩溃。
 */
export const HIDE_TOASTS_STYLE = '[data-sonner-toaster] { visibility: hidden !important; }'

export async function screenshotWithoutToasts(target: Page | Locator, path: string): Promise<void> {
  await target.screenshot({ path, style: HIDE_TOASTS_STYLE })
}
