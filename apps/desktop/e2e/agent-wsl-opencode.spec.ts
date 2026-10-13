import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

// Opt-in: uses installed Windows/Ubuntu OpenCode credentials, but never sends a model prompt.
test('switching native OpenCode to WSL loads the Ubuntu login shell and registers stdio tools', async () => {
  test.skip(process.platform !== 'win32' || !process.env.E2E_WSL_OPENCODE_CWD, 'Requires configured Windows and WSL OpenCode')
  test.setTimeout(120_000)
  const app = await launchBuiltApp()
  const stderr: string[] = []
  app.process().stderr?.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (/mcp|error|fail/i.test(line) && !/token|secret|api.?key|Bearer|MONTREE_MCP|environment/i.test(line)) stderr.push(line.slice(0, 800))
    }
  })
  try {
    await app.evaluate(() => { process.env.NODE_ENV = 'development' })
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean((window as any).electronAPI))
    const native = await page.evaluate(() => (window as any).electronAPI.acpConnect({ runtimeId: 'opencode' }))
    expect(native.ok, JSON.stringify(native)).toBe(true)
    expect(native.value.phase).toBe('ready')
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    const log = join(userData, 'logs', 'acp-mcp.log')
    const toolLists = async () => (await readFile(log, 'utf8')).split('\n').filter((line) => line.includes('"method":"tools/list"') && line.includes('"failed":false')).length
    await expect.poll(toolLists).toBeGreaterThan(0)
    const before = await toolLists()
    const wsl = await page.evaluate((cwd) => (window as any).electronAPI.acpConnect({ runtimeId: 'opencode', cwd }), process.env.E2E_WSL_OPENCODE_CWD!)
    expect(wsl.ok, JSON.stringify(wsl)).toBe(true)
    expect(wsl.value.phase).toBe('ready')
    await expect.poll(toolLists, { timeout: 30000 }).toBeGreaterThan(before)
  } finally {
    const userData = await app.evaluate(({ app }) => app.getPath('userData')).catch(() => '')
    if (userData) {
      const trace = await readFile(join(userData, 'logs', 'acp-mcp.log'), 'utf8').catch(() => '')
      await test.info().attach('acp-mcp', { body: trace, contentType: 'text/plain' })
    }
    await test.info().attach('mcp-errors', { body: stderr.join('\n'), contentType: 'text/plain' })
    await app.close()
  }
})
