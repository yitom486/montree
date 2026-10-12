// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
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
    browseWsl: vi.fn().mockResolvedValue({
      ok: true,
      value: { distro: 'Ubuntu', currentPath: '/', parentPath: null, entries: [] },
    }),
    listSshConfigHosts: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  },
}))

describe('StatusBar', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
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
  })

  it('渲染默认 UTF-8 与文档类型', () => {
    act(() => {
      root.render(
        createElement(TooltipProvider, null,
          createElement(StatusBar, {
            activeFilePath: 'D:/notes/post.md',
          })
        ),
      )
    })

    expect(container.textContent).toContain('UTF-8')
    expect(container.textContent).toContain('markdown')
  })

  it('识别 WSL 路径并展示 WSL: <distro> 徽章', () => {
    act(() => {
      root.render(
        createElement(TooltipProvider, null,
          createElement(StatusBar, {
            workspaceRoot: '\\\\wsl.localhost\\Ubuntu\\home\\tomy\\blog',
          })
        ),
      )
    })

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

    act(() => {
      root.render(
        createElement(TooltipProvider, null,
          createElement(StatusBar, {
            workspaceRoot: 'D:/my-blog',
          })
        ),
      )
    })

    expect(container.textContent).toContain('main')
    expect(container.textContent).toContain('*3')
    expect(container.textContent).toContain('↑2')
    expect(container.textContent).toContain('推送 (↑2)')
  })
})
