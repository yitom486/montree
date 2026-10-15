// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from './StatusBar'
import { TooltipProvider } from '@/components/ui/tooltip'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mockUseGitStatus = vi.fn()
vi.mock('@/hooks/workspace/useGitStatus', () => ({
  useGitStatus: (workspaceRoot?: string) => mockUseGitStatus(workspaceRoot),
}))

vi.mock('@/api/remote-api', () => ({
  remoteApi: {
    listWslDistros: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    getWslHome: vi.fn().mockResolvedValue({ ok: true, value: '/home' }),
    connectWsl: vi.fn().mockResolvedValue({ ok: true, value: { state: 'connected', distro: 'Ubuntu' } }),
    disconnectWsl: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    wslStatus: vi.fn().mockResolvedValue({ ok: true, value: { state: 'disconnected' } }),
    browseWsl: vi.fn().mockResolvedValue({
      ok: true,
      value: { distro: 'Ubuntu', currentPath: '/', parentPath: null, entries: [] },
    }),
    statWsl: vi.fn().mockResolvedValue({ ok: false, error: { code: 'REMOTE_NOT_CONNECTED', message: '未连接' } }),
    openWslWorkspace: vi.fn().mockResolvedValue({ ok: false, error: { code: 'REMOTE_NOT_CONNECTED', message: '未连接' } }),
    listSshConfigHosts: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  },
}))

describe('StatusBar', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  function renderBar(props: Record<string, unknown>) {
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(TooltipProvider, null, createElement(StatusBar, props)),
        ),
      )
    })
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mockUseGitStatus.mockReturnValue({
      status: null,
      isLoading: false,
      isPushing: false,
      push: vi.fn(),
      refetch: vi.fn(),
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
  })

  it('渲染默认 UTF-8 与文档类型', () => {
    renderBar({ activeFilePath: 'D:/notes/post.md' })

    expect(container.textContent).toContain('UTF-8')
    expect(container.textContent).toContain('markdown')
  })

  it('识别 WSL 路径并展示 WSL: <distro> 徽章', () => {
    renderBar({ workspaceRoot: '\\\\wsl.localhost\\Ubuntu\\home\\tomy\\blog' })

    expect(container.textContent).toContain('WSL: Ubuntu')
  })

  it('展示 Git 分支与推送状态', () => {
    mockUseGitStatus.mockReturnValue({
      status: {
        isRepo: true,
        branch: 'main',
        ahead: 2,
        behind: 0,
        files: [],
        totalChanges: 3,
      },
      isLoading: false,
      isPushing: false,
      push: vi.fn(),
      refetch: vi.fn(),
    })

    renderBar({ workspaceRoot: 'D:/my-blog' })

    expect(container.textContent).toContain('main')
    expect(container.textContent).toContain('*3')
    expect(container.textContent).toContain('↑2')
    expect(container.textContent).toContain('推送 (↑2)')
  })

  it('无工作区时不渲染 Git 区（有目录才查状态）', () => {
    mockUseGitStatus.mockClear()
    renderBar({})

    expect(mockUseGitStatus).toHaveBeenLastCalledWith(undefined)
    expect(container.textContent).toContain('UTF-8')
    expect(container.textContent).not.toContain('推送')
    expect(container.querySelector('[aria-label="一键推送"]')).toBeNull()
  })

  it('无上游时显示发布分支，点击带 setUpstream 发布', () => {
    const pushMock = vi.fn()
    mockUseGitStatus.mockReturnValue({
      status: {
        isRepo: true,
        branch: 'feature-x',
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        files: [],
        totalChanges: 0,
      },
      isLoading: false,
      isPushing: false,
      push: pushMock,
      refetch: vi.fn(),
    })

    renderBar({ workspaceRoot: 'D:/my-blog' })

    const btn = container.querySelector('[aria-label="发布分支"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.disabled).toBe(false)
    expect(container.textContent).toContain('发布分支')

    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith({ remote: 'origin', branch: 'feature-x', setUpstream: true })
  })

  it('有上游且已同步时推送按钮禁用（不空转报成功）', () => {
    mockUseGitStatus.mockReturnValue({
      status: {
        isRepo: true,
        branch: 'main',
        ahead: 0,
        behind: 0,
        hasUpstream: true,
        files: [],
        totalChanges: 0,
      },
      isLoading: false,
      isPushing: false,
      push: vi.fn(),
      refetch: vi.fn(),
    })

    renderBar({ workspaceRoot: 'D:/my-blog' })

    const btn = container.querySelector('[aria-label="一键推送"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.disabled).toBe(true)
    expect(container.textContent).not.toContain('发布分支')
  })

  it('游离 HEAD 无上游时不可发布（无分支名可发）', () => {
    mockUseGitStatus.mockReturnValue({
      status: {
        isRepo: true,
        branch: '(a1b2c3d)',
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        files: [],
        totalChanges: 0,
      },
      isLoading: false,
      isPushing: false,
      push: vi.fn(),
      refetch: vi.fn(),
    })

    renderBar({ workspaceRoot: 'D:/my-blog' })

    expect(container.querySelector('[aria-label="发布分支"]')).toBeNull()
    const btn = container.querySelector('[aria-label="一键推送"]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
