// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileExplorerOverflowMenu } from './FileExplorerOverflowMenu'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 资源管理器 ⋯ 菜单：TitleBar 删除后唯一的功能入口家。
 * 锁定四组齐全、快捷键标注、只读门控、点击直达回调。
 */
describe('FileExplorerOverflowMenu', () => {
  let container: HTMLDivElement
  let root: Root

  const handlers = () => ({
    onNewFile: vi.fn(),
    onNewFolder: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenFolder: vi.fn(),
    onRescanWorkspace: vi.fn(),
    onNewWindow: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onExportHtml: vi.fn(),
    onExportPdf: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenErrorLog: vi.fn(),
    onOpenDevTools: vi.fn(),
    onAbout: vi.fn(),
    onQuit: vi.fn(),
  })

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
    document.body.innerHTML = ''
  })

  async function openMenu(props: Record<string, unknown>) {
    await act(async () => {
      root.render(createElement(FileExplorerOverflowMenu, props as never))
    })
    await reopenMenu()
  }

  async function ensureOpen() {
    if (menuItems().length > 0) return
    await reopenMenu()
  }

  async function reopenMenu() {
    const trigger = container.querySelector('button[aria-label="更多操作"]') as HTMLElement | null
    expect(trigger).not.toBeNull()
    // Radix Menu 在 happy-dom 下靠 pointerdown + click 打开
    try {
      trigger!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    } catch {
      // 无 PointerEvent 实现时回落纯 click
    }
    trigger!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    trigger!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await act(async () => {})
  }

  function menuItems(): HTMLElement[] {
    return Array.from(document.body.querySelectorAll('[role="menuitem"]')) as HTMLElement[]
  }

  function itemNames(): string[] {
    return menuItems().map((el) => (el.textContent ?? '').replace(/\s+/g, ''))
  }

  it('四组入口齐全且带快捷键标注', async () => {
    await openMenu({ ...handlers(), canWrite: true })
    const names = itemNames()
    for (const expected of [
      '新建文件',
      '新建文件夹',
      '打开文件',
      '打开文件夹',
      '重新扫描工作区',
      '新建窗口',
      '保存',
      '另存为',
      '导出HTML',
      '导出PDF',
      '设置',
      '错误日志',
      '开发者工具',
      '关于',
      '退出',
    ]) {
      expect(names.some((name) => name.includes(expected.replace(/\s+/g, '')))).toBe(true)
    }
    const menuText = document.body.textContent ?? ''
    for (const shortcut of ['Ctrl+Shift+N', 'Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+,']) {
      expect(menuText).toContain(shortcut)
    }
  })

  it('Typst keeps save actions, offers a dedicated new file entry and hides Markdown exporters', async () => {
    const onNewTypstFile = vi.fn()
    await openMenu({ ...handlers(), canWrite: true, markdownExport: false, onNewTypstFile })
    const names = itemNames()
    expect(names.some((name) => name.startsWith('保存'))).toBe(true)
    expect(names.some((name) => name.startsWith('另存为'))).toBe(true)
    expect(names.some((name) => name.includes('导出HTML') || name.includes('导出PDF'))).toBe(false)
    const item = menuItems().find((element) => element.textContent?.includes('新建 Typst 文档'))!
    expect(item).toBeDefined()
    await act(async () => { item.click() })
    expect(onNewTypstFile).toHaveBeenCalledOnce()
  })

  it('只读模式隐藏文档组', async () => {
    await openMenu({ ...handlers(), canWrite: true, readOnly: true })
    const names = itemNames()
    expect(names.some((name) => name.includes('保存'))).toBe(false)
    expect(names.some((name) => name.includes('导出HTML'))).toBe(false)
    // 其余组仍在
    expect(names.some((name) => name.includes('新建窗口'))).toBe(true)
    expect(names.some((name) => name.includes('设置'))).toBe(true)
  })

  it('无工作区时新建/重扫致灰，打开可用', async () => {
    await openMenu({ ...handlers(), canWrite: false })
    const byName = (text: string) =>
      menuItems().find((el) => (el.textContent ?? '').includes(text)) as HTMLElement
    expect(byName('新建文件').getAttribute('aria-disabled')).toBe('true')
    expect(byName('新建文件夹').getAttribute('aria-disabled')).toBe('true')
    expect(byName('打开文件夹').getAttribute('aria-disabled')).not.toBe('true')
  })

  it('点击直达回调：打开文件夹 / 新建窗口 / 设置 / 退出', async () => {
    const h = handlers()
    await openMenu({ ...h, canWrite: true })
    const click = async (text: string) => {
      // 点一项菜单即关闭，按需重开
      await ensureOpen()
      const el = menuItems().find((item) => (item.textContent ?? '').includes(text)) as HTMLElement
      expect(el).not.toBeUndefined()
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await act(async () => {})
    }
    await click('打开文件夹')
    expect(h.onOpenFolder).toHaveBeenCalledTimes(1)
    await click('新建窗口')
    expect(h.onNewWindow).toHaveBeenCalledTimes(1)
    await click('设置')
    expect(h.onOpenSettings).toHaveBeenCalledTimes(1)
    await click('退出')
    expect(h.onQuit).toHaveBeenCalledTimes(1)
  })
})
