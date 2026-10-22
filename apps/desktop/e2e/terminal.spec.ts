import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchBuiltApp } from './helpers/launch-app'

test('真实 PTY：输入、Git、创建文件、隐藏保留与关闭释放', async ({}, info) => {
  // Windows 的 %TEMP% 可能是 8.3 短路径（RUNNER~1），PTY 报告长路径：统一用 native realpath 展开
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), 'montree-terminal-e2e-')))
  await writeFile(join(root, 'ready.md'), '# Ready\n')
  const app = await launchBuiltApp({ E2E_AUTO_OPEN_PATH: root })
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /打开文件夹/ }).click()
    await expect(page.getByText('ready.md', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '切换终端', exact: true }).click()
    const panel = page.getByRole('region', { name: '工作区终端' })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '新建终端', exact: true }).first().click()
    await expect(panel.getByRole('tab')).toHaveCount(1)
    const terminal = await page.evaluate(async () => { const result = await window.montreeTerminal!.list(); if (!result.ok) throw new Error(result.error.message); return result.value[0] })
    expect(terminal.cwd.toLowerCase()).toBe(root.toLowerCase())
    const terminalId = terminal.id
    await panel.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type(process.platform === 'win32' ? "Write-Output ('PTY_' + 'READY')" : "printf 'PTY_%s\\n' READY")
    await page.keyboard.press('Enter')
    const output = () => page.evaluate(async id => { const result = await window.montreeTerminal!.read(id); return result.ok ? result.value.output : result.error.message }, terminalId)
    await expect.poll(output).toContain('PTY_READY')
    await page.keyboard.type('node -e "require(\'fs\').writeFileSync(\'terminal-created.md\',\'# Terminal\\n\')"')
    await page.keyboard.press('Enter')
    await expect.poll(() => readFile(join(root, 'terminal-created.md'), 'utf8').catch(() => '')).toBe('# Terminal\n').catch(async error => {
      throw new Error(String(error) + '\nTerminal: ' + (await output()).slice(-4000))
    })
    await page.keyboard.type('git --version'); await page.keyboard.press('Enter')
    await expect.poll(output).toContain('git version')
    await page.screenshot({ path: info.outputPath('terminal.png') })
    await panel.getByRole('button', { name: '隐藏终端', exact: true }).click(); await expect(panel).toBeHidden()
    await page.getByRole('button', { name: '切换终端', exact: true }).click(); await expect(panel.getByRole('tab')).toHaveCount(1)
    await panel.getByRole('button', { name: '新建终端', exact: true }).first().click(); await expect(panel.getByRole('tab')).toHaveCount(2)
    await panel.getByRole('tab').first().click()
    await page.keyboard.type(process.platform === 'win32' ? "Write-Output ('TAB_' + 'RESTORED')" : "printf 'TAB_%s\\n' RESTORED")
    await page.keyboard.press('Enter'); await expect.poll(output).toContain('TAB_RESTORED')
    await panel.getByRole('button', { name: '结束并关闭终端', exact: true }).click(); await expect(panel.getByRole('tab')).toHaveCount(1)
    await panel.getByRole('button', { name: '结束并关闭终端', exact: true }).click(); await expect(panel.getByRole('tab')).toHaveCount(0)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

