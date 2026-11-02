// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderContentShell } from './ReaderContentShell'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 底栏布局契约：底栏翻页必须收进正文列（children 同列下方），
 * 不得横跨卡片轨（#marginalia-notes-stream）与目录列。
 *
 * TDD 红阶段：`footerNav` prop 尚未实现——此处用类型断言绕过，
 * 让测试先行锁定布局契约（运行时断言为红），实现后转绿。
 */
describe('ReaderContentShell footerNav', () => {
  let container: HTMLDivElement
  let root: Root

  type ShellProps = Parameters<typeof ReaderContentShell>[0]

  function shellProps(extra: Record<string, unknown>): ShellProps {
    return {
      marks: [],
      onSelectMark: vi.fn(),
      onDeleteMark: vi.fn(),
      tocOpen: false,
      units: [],
      onCloseToc: vi.fn(),
      onSelectUnit: vi.fn(),
      ...extra,
    } as unknown as ShellProps
  }

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

  async function renderShell(extra: Record<string, unknown>) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ReaderContentShell, shellProps(extra)),
        ),
      )
    })
  }

  it('传入 footerNav 即渲染', async () => {
    await renderShell({
      children: createElement('div', { id: 'text-host' }, '正文'),
      footerNav: createElement('footer', { id: 'reader-footer' }, '底栏'),
    })
    expect(container.querySelector('footer')).not.toBeNull()
  })

  it('底栏与正文同列且位于正文之后', async () => {
    await renderShell({
      children: createElement('div', { id: 'text-host' }, '正文'),
      footerNav: createElement('footer', { id: 'reader-footer' }, '底栏'),
    })
    const footer = container.querySelector('footer') as HTMLElement | null
    const textHost = container.querySelector('#text-host') as HTMLElement | null
    expect(footer).not.toBeNull()
    expect(textHost).not.toBeNull()
    // 同一纵向列容器（正文 wrapper 与底栏的父级即正文列）
    const column = footer!.parentElement as HTMLElement
    expect(column.querySelector('#text-host')).toBe(textHost)
    expect(column.className).toContain('flex-col')
    // 正文之后
    expect(textHost!.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('底栏不在卡片轨与目录列内', async () => {
    await renderShell({
      children: createElement('div', { id: 'text-host' }, '正文'),
      footerNav: createElement('footer', { id: 'reader-footer' }, '底栏'),
    })
    const footer = container.querySelector('footer') as HTMLElement | null
    expect(footer).not.toBeNull()
    expect(footer!.closest('#marginalia-notes-stream')).toBeNull()
    // 底栏列不是 Shell 根行的直接子行（根行只装 目录/正文列/卡轨）
    const column = footer!.parentElement as HTMLElement
    expect(column.parentElement!.tagName).not.toBe('FOOTER')
  })

  it('不传 footerNav 时无底栏（旧调用方不受影响）', async () => {
    await renderShell({
      children: createElement('div', { id: 'text-host' }, '正文'),
    })
    expect(container.querySelector('footer')).toBeNull()
    expect(container.querySelector('#text-host')).not.toBeNull()
  })
})
