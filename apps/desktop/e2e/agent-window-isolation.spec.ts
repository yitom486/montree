import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

async function observe(page: Page) {
  await page.waitForFunction(() => Boolean((window as any).electronAPI))
  await expect(page.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const api = (window as any).electronAPI
    const state = (window as any).__windowTest = { status: [], updates: [], permissions: [], snapshots: [], results: {} }
    api.onAcpStatusChanged((event: any) => state.status.push(event))
    api.onAcpSessionUpdate((event: any) => state.updates.push(event))
    api.onAcpPermissionRequest((event: any) => state.permissions.push(event))
    api.onAcpSnapshotRequest((event: any) => state.snapshots.push(event))
  })
}
async function chat(page: Page) {
  return page.evaluate(() => {
    const scope = (window as any).electronAPI.windowScopeId
    const key = scope === 'main' ? 'montree-acp-ui' : `montree-acp-ui:${scope}`
    return { scope, key, state: JSON.parse(localStorage.getItem(key) ?? '{}').state }
  })
}
async function packageChat(page: Page) {
  return page.evaluate(() => {
    const scope = (window as any).electronAPI.windowScopeId
    const key = scope === 'main' ? 'montree-chat-session/v1' : `montree-chat-session/v1:${scope}`
    return { key, snapshot: JSON.parse(localStorage.getItem(key) ?? '{}').snapshot }
  })
}
async function openDocument(page: Page, name: string) {
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: '快速打开文件' })
  await dialog.getByPlaceholder('搜索工作区文件或电子书...').fill(name)
  await dialog.getByRole('button').filter({ hasText: name }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.cm-editor')).toBeVisible()
}
async function connect(page: Page, cwd?: string, resumeSessionId?: string) {
  return page.evaluate((payload) => (window as any).electronAPI.acpConnect(payload), { runtimeId: 'mock-window', cwd, resumeSessionId })
}
async function startPrompt(page: Page, sessionId: string, command: string) {
  await page.evaluate(({ sessionId, command }) => {
    void (window as any).electronAPI.acpPrompt({ sessionId, prompt: [{ type: 'text', text: command }] }).then((result: any) => {
      (window as any).__windowTest.results[command] = result
    })
  }, { sessionId, command })
}
const diagnostics = (page: Page) => page.evaluate(() => (window as any).__windowTest)

test('windows without a workspace still mount MCP tools and use independent sandbox directories', async () => {
  const app = await launchBuiltApp({ E2E_ACP_WINDOW_TEST: '1', E2E_ACP_COMMAND: process.execPath, E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs') })
  try {
    const first = await app.firstWindow()
    await observe(first)
    await first.evaluate(() => (window as any).electronAPI.newWindow())
    await expect.poll(() => app.windows().length).toBe(2)
    const second = app.windows()[1]!
    await observe(second)
    const [a, b] = await Promise.all([connect(first), connect(second)])
    expect(a.ok, JSON.stringify(a)).toBe(true); expect(b.ok, JSON.stringify(b)).toBe(true)
    await Promise.all([startPrompt(first, a.value.sessionId, 'identity'), startPrompt(second, b.value.sessionId, 'identity')])
    await expect.poll(async () => (await diagnostics(first)).results.identity).toBeDefined()
    await expect.poll(async () => (await diagnostics(second)).results.identity).toBeDefined()
    const resultA = (await diagnostics(first)).results.identity, resultB = (await diagnostics(second)).results.identity
    expect(resultA.ok, JSON.stringify(resultA)).toBe(true); expect(resultB.ok, JSON.stringify(resultB)).toBe(true)
    const getText = (events: any[]) => events.map((event) => typeof event.update.content === 'object' ? event.update.content.text : '').join('')
    const cwdA = getText((await diagnostics(first)).updates).split('|')[1]
    const cwdB = getText((await diagnostics(second)).updates).split('|')[1]
    expect(cwdA).toContain('agent-sandbox'); expect(cwdB).toContain('agent-sandbox')
    expect(cwdA).not.toBe(cwdB)
    await Promise.all([startPrompt(first, a.value.sessionId, 'tools'), startPrompt(second, b.value.sessionId, 'tools')])
    await expect.poll(async () => (await diagnostics(first)).results.tools?.ok).toBe(true)
    await expect.poll(async () => (await diagnostics(second)).results.tools?.ok).toBe(true)
    for (const page of [first, second]) {
      const tools = JSON.stringify((await diagnostics(page)).updates)
      expect(tools).toContain('montree_read')
      expect(tools).toContain('montree_get_selection')
      expect(tools).toContain('montree_capture_viewport')
    }
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => {})
    await app.close()
  }
})

test('two real windows isolate persistence, ACP processes, streaming, permissions, cancellation and MCP documents', async ({}, info) => {
  test.setTimeout(120_000)
  const workspace = await mkdtemp(join(tmpdir(), 'montree-window-test-'))
  await writeFile(join(workspace, 'first.md'), '# First\n\nFIRST_WINDOW_DOCUMENT\n')
  await writeFile(join(workspace, 'second.md'), '# Second\n\nSECOND_WINDOW_DOCUMENT\n')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: workspace, E2E_ACP_WINDOW_TEST: '1', E2E_ACP_COMMAND: process.execPath, E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs') })
  try {
    const first = await app.firstWindow()
    await first.waitForFunction(() => Boolean((window as any).electronAPI))
    await first.evaluate(() => localStorage.setItem('montree-acp-ui', JSON.stringify({ version: 0, state: { selectedRuntimeId: 'opencode', activeThreadId: 'old-thread', threads: [{ id: 'old-thread', title: 'Old window', runtimeId: 'opencode', createdAt: 1, updatedAt: 1, agentSessionIds: { opencode: 'old-session' }, messages: [{ id: 'old-message', role: 'user', text: 'OLD_WINDOW_HISTORY', createdAt: 1 }] }] } })))
    await first.reload()
    await expect(first.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()
    await first.keyboard.press('Control+Shift+N')
    await expect.poll(() => app.windows().length).toBe(2)
    const second = app.windows()[1]!
    await observe(first); await observe(second)
    const firstInitial = await chat(first)
    expect(firstInitial.state.activeThreadId).toBe('old-thread')
    await expect.poll(async () => JSON.stringify((await packageChat(first)).snapshot)).toContain('OLD_WINDOW_HISTORY')
    const secondScope = (await chat(second)).scope
    expect(secondScope).not.toBe(firstInitial.scope)
    await second.getByRole('button', { name: 'AI 伴读', exact: true }).click()
    await expect.poll(async () => (await chat(second)).state?.selectedRuntimeId).toBe('opencode')
    const fresh = await chat(second)
    expect(fresh.state?.selectedRuntimeId).toBe('opencode')
    expect(fresh.state?.activeThreadId).not.toBe('old-thread')
    expect(JSON.stringify(fresh.state ?? {})).not.toContain('old-session')
    expect(JSON.stringify(fresh.state ?? {})).not.toContain('OLD_WINDOW_HISTORY')
    await expect.poll(async () => (await packageChat(second)).snapshot).toBeDefined()
    expect((await packageChat(second)).key).not.toBe((await packageChat(first)).key)
    expect(JSON.stringify((await packageChat(second)).snapshot)).not.toContain('OLD_WINDOW_HISTORY')

    await openDocument(first, 'first.md'); await openDocument(second, 'second.md')
    const [a, b] = await Promise.all([connect(first, workspace), connect(second, workspace)])
    expect(a.ok, JSON.stringify(a)).toBe(true); expect(b.ok, JSON.stringify(b)).toBe(true)
    const sidA = a.value.sessionId, sidB = b.value.sessionId
    expect(sidA).not.toBe(sidB)
    expect(sidA.split('-')[1]).not.toBe(sidB.split('-')[1]) // independent child processes even for identical cwd
    expect(a.value.sessionRestored).toBe(false); expect(b.value.sessionRestored).toBe(false)
    const cardKey = 'same-book-fingerprint'
    await first.evaluate(({ bookFingerprint, sessionId }) => (window as any).electronAPI.putAiSession({ bookFingerprint, sessionId, promptCount: 1, lastUsedAt: Date.now() }), { bookFingerprint: cardKey, sessionId: sidA })
    expect((await second.evaluate((bookFingerprint) => (window as any).electronAPI.getAiSession({ bookFingerprint }), cardKey)).value).toBeNull()
    await second.evaluate(({ bookFingerprint, sessionId }) => (window as any).electronAPI.putAiSession({ bookFingerprint, sessionId, promptCount: 1, lastUsedAt: Date.now() }), { bookFingerprint: cardKey, sessionId: sidB })
    expect((await first.evaluate((bookFingerprint) => (window as any).electronAPI.getAiSession({ bookFingerprint }), cardKey)).value.sessionId).toBe(sidA)
    await Promise.all([startPrompt(first, sidA, 'read'), startPrompt(second, sidB, 'read')])
    await expect.poll(async () => (await diagnostics(first)).results.read?.ok).toBe(true)
    await expect.poll(async () => (await diagnostics(second)).results.read?.ok).toBe(true)
    const da = await diagnostics(first), db = await diagnostics(second)
    expect(JSON.stringify(da.updates)).toContain('FIRST_WINDOW_DOCUMENT')
    expect(JSON.stringify(da.updates)).not.toContain('SECOND_WINDOW_DOCUMENT')
    expect(JSON.stringify(db.updates)).toContain('SECOND_WINDOW_DOCUMENT')
    expect(JSON.stringify(db.updates)).not.toContain('FIRST_WINDOW_DOCUMENT')
    expect(da.status.filter((event: any) => event.sessionId).every((event: any) => event.sessionId === sidA)).toBe(true)
    expect(db.status.filter((event: any) => event.sessionId).every((event: any) => event.sessionId === sidB)).toBe(true)
    expect(da.snapshots.length).toBeGreaterThan(0); expect(db.snapshots.length).toBeGreaterThan(0)
    const foreign = await first.evaluate((sessionId) => (window as any).electronAPI.acpPrompt({ sessionId, prompt: [{ type: 'text', text: 'foreign' }] }), sidB)
    expect(foreign.ok).toBe(false)
    const restoreForeign = await connect(second, workspace, sidA)
    expect(restoreForeign.ok).toBe(false)

    await Promise.all([startPrompt(first, sidA, 'permission'), startPrompt(second, sidB, 'permission')])
    await expect.poll(async () => (await diagnostics(first)).permissions.length).toBe(1)
    await expect.poll(async () => (await diagnostics(second)).permissions.length).toBe(1)
    const permissionA = (await diagnostics(first)).permissions[0], permissionB = (await diagnostics(second)).permissions[0]
    expect(permissionA.requestId).toBe(permissionB.requestId) // same numeric IDs must not cross windows
    expect(permissionA.sessionId).toBe(sidA); expect(permissionB.sessionId).toBe(sidB)
    await first.evaluate((requestId) => (window as any).electronAPI.acpRespondPermission({ requestId, outcome: { outcome: 'selected', optionId: 'allow' } }), permissionA.requestId)
    await expect.poll(async () => (await diagnostics(first)).results.permission?.ok).toBe(true)
    expect((await diagnostics(second)).results.permission).toBeUndefined()
    await second.evaluate((requestId) => (window as any).electronAPI.acpRespondPermission({ requestId, outcome: { outcome: 'selected', optionId: 'reject' } }), permissionB.requestId)
    await expect.poll(async () => (await diagnostics(second)).results.permission?.ok).toBe(true)

    await Promise.all([startPrompt(first, sidA, 'wait'), startPrompt(second, sidB, 'wait')])
    await expect.poll(async () => JSON.stringify((await diagnostics(first)).updates)).toContain(`WAIT:${sidA}`)
    await expect.poll(async () => JSON.stringify((await diagnostics(second)).updates)).toContain(`WAIT:${sidB}`)
    await first.evaluate((sessionId) => (window as any).electronAPI.acpCancel({ sessionId }), sidA)
    await expect.poll(async () => (await diagnostics(first)).results.wait?.value.stopReason).toBe('cancelled')
    expect((await diagnostics(second)).results.wait).toBeUndefined()
    await second.evaluate((sessionId) => (window as any).electronAPI.acpCancel({ sessionId }), sidB)
    await expect.poll(async () => (await diagnostics(second)).results.wait?.value.stopReason).toBe('cancelled')

    // Focus inside an iframe, matching the online-document shortcut failure.
    await second.evaluate(() => { const frame = document.createElement('iframe'); frame.id = 'shortcut-frame'; frame.srcdoc = '<input value="iframe focus">'; document.body.append(frame) })
    await second.frameLocator('#shortcut-frame').locator('input').click()
    const windowHandle = await app.browserWindow(second)
    await windowHandle.evaluate((window) => window.focus())
    // CDP dispatchKeyEvent bypasses before-input-event; sendInputEvent exercises Electron's native path.
    await windowHandle.evaluate((window) => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['control'] })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: ['control'] })
    })
    await expect(second.getByRole('dialog', { name: '设置' })).toBeVisible()
    await second.keyboard.press('Escape')
    await second.frameLocator('#shortcut-frame').locator('input').click()
    await windowHandle.evaluate((window) => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['control', 'shift'] })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers: ['control', 'shift'] })
    })
    await expect.poll(() => app.windows().length).toBe(3)
    const third = app.windows()[2]!
    await third.waitForFunction(() => Boolean((window as any).electronAPI))
    expect((await chat(third)).scope).not.toBe(secondScope)
    const thirdHandle = await app.browserWindow(third)
    await thirdHandle.evaluate((window) => window.destroy())

    // Connecting mock-window may create its own thread rather than activate seeded opencode history.
    const activeBeforeReconnect = (await chat(first)).state.activeThreadId
    const oldSid = sidA
    const reconnected = await connect(first, workspace, sidA)
    expect(reconnected.ok, JSON.stringify(reconnected)).toBe(true)
    expect(reconnected.value.sessionId).toBe(oldSid)
    await first.evaluate(() => { delete (window as any).__windowTest.results.read })
    await startPrompt(first, oldSid, 'read')
    await expect.poll(async () => (await diagnostics(first)).results.read?.ok).toBe(true)
    await second.evaluate(() => { delete (window as any).__windowTest.results.read })
    await startPrompt(second, sidB, 'read')
    await expect.poll(async () => (await diagnostics(second)).results.read?.ok).toBe(true)
    await first.waitForTimeout(1700)
    const afterA = await chat(first), afterB = await chat(second)
    expect(afterA.state.activeThreadId).toBe(activeBeforeReconnect)
    expect(JSON.stringify(afterA.state.threads)).toContain('OLD_WINDOW_HISTORY')
    expect(JSON.stringify(afterA.state.threads)).not.toContain(sidB)
    expect(JSON.stringify(afterB.state.threads)).not.toContain(sidA)
    const packageA = await packageChat(first), packageB = await packageChat(second)
    expect(JSON.stringify(packageA.snapshot)).toContain('OLD_WINDOW_HISTORY')
    expect(JSON.stringify(packageB.snapshot)).not.toContain('OLD_WINDOW_HISTORY')
    await info.attach('window-isolation-transcript', { body: JSON.stringify({ first: await diagnostics(first), second: await diagnostics(second) }, null, 2), contentType: 'application/json' })

    // Destroy the owner; another window's live Agent/MCP must remain usable.
    const firstId = await first.evaluate(() => (window as any).electronAPI.windowScopeId)
    expect(firstId).toBe('main')
    const firstHandle = await app.browserWindow(first)
    await firstHandle.evaluate((window) => window.destroy())
    await second.evaluate(() => { delete (window as any).__windowTest.results.read })
    await startPrompt(second, sidB, 'read')
    await expect.poll(async () => (await diagnostics(second)).results.read?.ok).toBe(true)
    await second.reload()
    await observe(second)
    expect((await chat(second)).scope).toBe(secondScope)
    expect(JSON.stringify((await chat(second)).state)).not.toContain('OLD_WINDOW_HISTORY')
    expect(JSON.stringify((await packageChat(second)).snapshot)).not.toContain('OLD_WINDOW_HISTORY')
    expect(await second.evaluate(() => localStorage.getItem('montree-chat-session/v1'))).toContain('OLD_WINDOW_HISTORY')
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => {})
    await app.close()
    await rm(workspace, { recursive: true, force: true })
  }
})
