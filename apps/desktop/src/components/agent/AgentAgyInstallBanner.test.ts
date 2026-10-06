// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentAgyInstallBanner } from './AgentAgyInstallBanner'
import { acpApi } from '@/api/acp-api'
import { ok } from '@montree/contracts'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('AgentAgyInstallBanner', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('渲染文案与安装按钮', async () => {
    await act(async () => {
      root.render(createElement(AgentAgyInstallBanner))
    })

    expect(container.textContent).toContain('需要安装 Antigravity CLI (agy)')
    expect(container.textContent).toContain('一键安装 agy')
    expect(container.textContent).toContain('复制终端命令')
  })

  it('点击一键安装调用 acpApi.installAgyCli 并在成功后回调 onInstalled', async () => {
    const onInstalled = vi.fn()
    const installSpy = vi.spyOn(acpApi, 'installAgyCli').mockResolvedValue(
      ok({ installed: true, version: '1.2.13', path: 'C:\\agy\\bin\\agy.exe' })
    )

    await act(async () => {
      root.render(createElement(AgentAgyInstallBanner, { onInstalled }))
    })

    const buttons = container.querySelectorAll('button')
    const installButton = Array.from(buttons).find((b) => b.textContent?.includes('一键安装 agy'))
    expect(installButton).toBeDefined()

    await act(async () => {
      installButton?.click()
    })

    expect(installSpy).toHaveBeenCalled()
    expect(onInstalled).toHaveBeenCalled()
  })
})
