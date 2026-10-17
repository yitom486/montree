// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStatus } from './useGitStatus'
import { gitApi } from '@/api/git-api'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/api/git-api', () => ({
  gitApi: {
    getStatus: vi.fn(),
    push: vi.fn(),
    commit: vi.fn(),
    getDiff: vi.fn(),
    listBranches: vi.fn(),
  },
}))

const mockedGetStatus = vi.mocked(gitApi.getStatus)

function renderHook(root: Root, container: HTMLDivElement, workspaceRoot?: string) {
  let latest: ReturnType<typeof useGitStatus> | undefined
  function Harness() {
    latest = useGitStatus(workspaceRoot)
    return null
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => {
    root.render(
      createElement(QueryClientProvider, { client }, createElement(Harness)),
    )
  })
  return {
    get current() {
      return latest!
    },
    cleanup: () => client.clear(),
  }
}

describe('useGitStatus 无工作区语义', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockedGetStatus.mockReset()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('未绑定目录时不发起任何查询，status 为空（状态栏无 Git 可渲染）', async () => {
    const hook = renderHook(root, container, undefined)
    await act(async () => {})
    expect(hook.current.status).toBeFalsy()
    expect(mockedGetStatus).not.toHaveBeenCalled()
    hook.cleanup()
  })

  it('空字符串同样视为未绑定', async () => {
    const hook = renderHook(root, container, '   ')
    await act(async () => {})
    expect(hook.current.status).toBeFalsy()
    expect(mockedGetStatus).not.toHaveBeenCalled()
    hook.cleanup()
  })

  it('绑定目录后透传仓库状态（cwd 即查询目录）', async () => {
    mockedGetStatus.mockResolvedValue({
      ok: true,
      value: { isRepo: true, branch: 'master', ahead: 2, behind: 0, files: [], totalChanges: 78 },
    } as never)
    const hook = renderHook(root, container, 'D:/work/main')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(mockedGetStatus).toHaveBeenCalledTimes(1)
    expect(mockedGetStatus).toHaveBeenCalledWith('D:/work/main')
    expect(hook.current.status?.branch).toBe('master')
    expect(hook.current.status?.totalChanges).toBe(78)
    hook.cleanup()
  })

  it('仓库查询失败时 status 为空（不抛、不渲染旧数据）', async () => {
    mockedGetStatus.mockResolvedValue({
      ok: false,
      error: { code: 'GIT_STATUS_FAILED', message: 'bad' },
    } as never)
    const hook = renderHook(root, container, 'D:/work/main')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(hook.current.status).toBeNull()
    hook.cleanup()
  })
})
