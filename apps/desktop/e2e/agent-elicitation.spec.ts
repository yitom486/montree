import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchBuiltApp } from './helpers/launch-app'
import { connectMockAgent, sendToAgent } from './helpers/mock-agent'

test('标准 ACP 表单经过真实主进程/preload/UI 回传，支持窄屏、键盘、多选和取消', async ({}, info) => {
  const app = await launchBuiltApp({ E2E_ACP_WINDOW_TEST: '1', E2E_ACP_COMMAND: process.execPath, E2E_ACP_FIXTURE: resolve('apps/desktop/e2e/fixtures/mock-window-agent.cjs') })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await connectMockAgent(page, 'elicitation-thread')
    await sendToAgent(page, 'elicit-form')
    const questions = page.getByRole('region', { name: '助手提问' })
    await expect(questions.getByText('请选择克隆方式并补充配置', { exact: true })).toBeVisible()
    const panel = page.getByRole('region', { name: 'Agent 聊天' })
    await panel.evaluate(element => { const host = element.closest('[data-panel]') as HTMLElement; if (host) host.style.flex = '0 0 320px' })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => { document.documentElement.classList.add('dark') })
    const contrast = async () => questions.evaluate(element => {
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
      canvas.width = canvas.height = 1
      const rgba = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data] }
      const luminance = (values: number[]) => values.slice(0, 3).map(value => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
      return [...element.querySelectorAll('[data-slot="card-title"], label, [data-slot="option-list"] span')].filter(node => node.textContent?.trim() && !node.children.length).map(node => {
        let parent: Element | null = node
        let background = [255, 255, 255, 255]
        const layers: number[][] = []
        while (parent) { layers.push(rgba(getComputedStyle(parent).backgroundColor)); parent = parent.parentElement }
        for (const layer of layers.reverse()) { const alpha = layer[3] / 255; background = background.map((value, index) => index < 3 ? layer[index] * alpha + value * (1 - alpha) : 255) }
        const foreground = rgba(getComputedStyle(node).color)
        const a = luminance(foreground), b = luminance(background)
        return { text: node.textContent, color: getComputedStyle(node).color, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
      })
    })
    const darkContrast = await contrast()
    expect(darkContrast.filter(item => item.ratio < 4.5)).toEqual([])
    expect(await questions.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await questions.screenshot({ path: info.outputPath('elicitation-320-dark.png') })
    await page.evaluate(() => { document.documentElement.classList.remove('dark') })
    expect((await contrast()).filter(item => item.ratio < 4.5)).toEqual([])
    await questions.screenshot({ path: info.outputPath('elicitation-320-light.png') })
    await panel.evaluate(element => { const host = element.closest('[data-panel]') as HTMLElement; if (host) host.style.flex = '0 0 480px' })
    expect(await questions.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await questions.screenshot({ path: info.outputPath('elicitation-480-light.png') })
    await questions.getByRole('button', { name: '提交回答', exact: true }).click()
    await expect(questions.getByRole('alert')).toContainText('克隆方式')
    const strategy = questions.getByRole('button', { name: /完整克隆/ })
    await strategy.focus()
    await page.keyboard.press('Enter')
    await questions.getByRole('checkbox', { name: '文档', exact: true }).click()
    await questions.getByRole('checkbox', { name: '测试', exact: true }).click()
    await questions.getByRole('button', { name: '确认选择', exact: true }).click()
    await questions.getByLabel('补充说明', { exact: true }).fill('保留历史')
    await questions.getByLabel('副本数量', { exact: true }).fill('2')
    await questions.getByRole('button', { name: '提交回答', exact: true }).click()
    await expect(panel.getByText(/ELICITATION:.*"strategy":"clone"/)).toBeVisible()
    await expect(panel.getByText(/ELICITATION:.*"extras":\["docs","tests"\]/)).toBeVisible()
    await expect(questions.getByRole('status')).toContainText('完整克隆')
    await page.evaluate(() => { document.documentElement.classList.remove('dark') })
    await questions.screenshot({ path: info.outputPath('elicitation-320-light-receipt.png') })
    await sendToAgent(page, 'elicit-form')
    await questions.getByRole('button', { name: '取消', exact: true }).click()
    await expect(panel.getByText('ELICITATION:{"action":"cancel"}', { exact: false })).toBeVisible()
    await expect(questions.getByRole('button', { name: '提交回答' })).toHaveCount(0)
    await sendToAgent(page, 'elicit-form')
    await questions.getByRole('button', { name: '拒绝回答', exact: true }).click()
    await expect(panel.getByText('ELICITATION:{"action":"decline"}', { exact: false })).toBeVisible()
    await sendToAgent(page, 'elicit-form')
    await expect(questions.getByRole('button', { name: '提交回答' })).toBeVisible()
    await page.evaluate(() => window.electronAPI!.acpDisconnect())
    await expect(questions.getByRole('button', { name: '提交回答' })).toHaveCount(0)
  } finally { await app.close() }
})
