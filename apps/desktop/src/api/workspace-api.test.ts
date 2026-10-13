import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toHostTextRef, workspaceApi } from './workspace-api'

function mockElectronAPI(api: Record<string, unknown>): void {
  ;(globalThis as unknown as { window: unknown }).window = { electronAPI: api }
}

beforeEach(() => {
  mockElectronAPI({})
})

describe('workspace-api（B2/B3 宿主操作）', () => {
  it('缺新 IPC 时返回 API_UNAVAILABLE（旧构建兼容，不抛）', async () => {
    const read = await workspaceApi.readText({ filePath: 'C:\\a.md' })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error.code).toBe('API_UNAVAILABLE')
    const write = await workspaceApi.writeText({ filePath: 'C:\\a.md', content: 'x' })
    expect(write.ok).toBe(false)
  })

  it('读写透传 preload 结果（含 revision，不断线误报）', async () => {
    mockElectronAPI({
      workspaceReadText: vi.fn().mockResolvedValue({ ok: true, value: { filePath: 'C:\\a.md', content: 'hi', revision: 'rev-1' } }),
      workspaceWriteText: vi.fn().mockResolvedValue({ ok: true, value: { filePath: 'C:\\a.md', revision: 'rev-2' } }),
      workspaceSaveTextAs: vi.fn(),
      workspaceReadImage: vi.fn(),
    })
    const read = await workspaceApi.readText({ filePath: 'C:\\a.md' })
    expect(read.ok && read.value.revision).toBe('rev-1')
    const write = await workspaceApi.writeText({ filePath: 'C:\\a.md', content: 'hi2', expectedRevision: 'rev-1' })
    expect(write.ok && write.value.revision).toBe('rev-2')
  })

  it('B3 可取消搜索：已取消时不调 IPC，返回 CANCELLED', async () => {
    const search = vi.fn().mockResolvedValue({ ok: true, value: { total: 1, hits: [] } })
    mockElectronAPI({ searchWorkspaceMarkdown: search })
    const controller = new AbortController()
    controller.abort()
    const { promise } = workspaceApi.searchMarkdownAbortable(
      { workspaceRoot: 'C:\\ws', query: '王道计' },
      controller.signal,
    )
    const result = await promise
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    expect(search).not.toHaveBeenCalled()
  })

  it('B3 可取消搜索：未取消时透传分页结果', async () => {
    const search = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { total: 3, hits: [{ filePath: 'a.md', lineStart: 1, line: 'x' }], nextOffset: 1 } })
    mockElectronAPI({ searchWorkspaceMarkdown: search })
    const { promise } = workspaceApi.searchMarkdownAbortable({
      workspaceRoot: 'C:\\ws',
      query: '王道计',
      offset: 0,
      limit: 1,
    })
    const result = await promise
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.nextOffset).toBe(1)
    expect(search).toHaveBeenCalledOnce()
  })
})

describe('toHostTextRef（P1 裸路径→宿主引用）', () => {
  it('远端身份 + 相对路径走 workspaceId/relativePath', () => {
    expect(toHostTextRef('wsl:Ubuntu:/home/u/blog', 'notes/a.md')).toEqual({
      workspaceId: 'wsl:Ubuntu:/home/u/blog',
      relativePath: 'notes/a.md',
    })
  })

  it('远端身份 + 绝对/盘符/UNC 路径仍走本机 filePath（不冒充远端）', () => {
    expect(toHostTextRef('wsl:Ubuntu:/home/u/blog', 'C:\\ws\\a.md')).toEqual({ filePath: 'C:\\ws\\a.md' })
    expect(toHostTextRef('wsl:Ubuntu:/home/u/blog', '/home/u/a.md')).toEqual({ filePath: '/home/u/a.md' })
    expect(toHostTextRef('wsl:Ubuntu:/home/u/blog', '\\\\wsl.localhost\\Ubuntu\\a.md')).toEqual({
      filePath: '\\\\wsl.localhost\\Ubuntu\\a.md',
    })
  })

  it('本机身份一律走 filePath（零行为变化）', () => {
    expect(toHostTextRef('local', 'notes/a.md')).toEqual({ filePath: 'notes/a.md' })
    expect(toHostTextRef(undefined, 'notes/a.md')).toEqual({ filePath: 'notes/a.md' })
    expect(toHostTextRef('local', 'C:\\ws\\a.md')).toEqual({ filePath: 'C:\\ws\\a.md' })
  })
})
