import type { Page } from '@playwright/test'

/**
 * 播种一个绑定 mock-window 运行时的空白聊天线程并重载窗口。
 *
 * 存储契约（166995f 聊天单权威迁移后）：宿主元数据在 `montree-acp-metadata/v2`，
 * 消息与线程快照在包的 `montree-chat-session/v1`；旧键 `montree-acp-ui` 只在新键缺失时
 * 兜底读取，而应用启动后会立刻写入新键，所以只写旧键的种子会被整体忽略，
 * 面板退回默认运行时（Linux CI 上无可用 Agent，发送后什么都不会出现）。
 * 播种与 reload 同任务提交，避免启动期 persist 节流落盘覆盖种子。
 */
export async function seedMockChatThread(
  window: Page,
  thread: { id: string; title: string },
  options: { theme?: 'dark' | 'light' } = {},
): Promise<void> {
  // 静置：等启动期 persist 节流排空，否则播种会被应用落盘覆盖
  await window.waitForTimeout(3000)
  await window.evaluate(({ thread, theme }) => {
    const scopeId = (window as unknown as { electronAPI?: { windowScopeId?: string } }).electronAPI?.windowScopeId
    const scopeSuffix = scopeId && scopeId !== 'main' ? ':' + scopeId : ''
    if (theme) {
      const raw = JSON.parse(localStorage.getItem('markdown-editor-ui') ?? '{"state":{}}')
      raw.state = { ...(raw.state ?? {}), theme }
      localStorage.setItem('markdown-editor-ui', JSON.stringify(raw))
    }
    const meta = { panelOpen: true, hudDisplayMode: 'docked', selectedRuntimeId: 'mock-window', activeThreadId: thread.id }
    localStorage.setItem('montree-acp-ui' + scopeSuffix, JSON.stringify({ version: 0, state: meta }))
    localStorage.setItem('montree-acp-metadata/v2' + scopeSuffix, JSON.stringify({ state: meta }))
    localStorage.setItem('montree-chat-session/v1' + scopeSuffix, JSON.stringify({ version: 1, authorityVersion: 1, snapshot: {
      threads: [{ id: thread.id, hostThreadId: thread.id, runtimeId: 'mock-window', title: thread.title, feed: { messages: [], turnSettled: false } }],
      activeThreadId: thread.id,
      modelConfig: { runtimeId: 'mock-window' },
    } }))
    location.reload()
  }, { thread, theme: options.theme })
  await window.waitForLoadState('domcontentloaded')
}
