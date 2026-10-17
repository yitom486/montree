// @vitest-environment happy-dom
/**
 * P1 冲突基线保护集成测试（useFileOperations + 内存远端盘）。
 *
 * 验收 §11-3：A 打开、B 外部改、A 连续两次普通保存，磁盘 B 内容不变；
 * 只有显式覆盖才允许写入；重载载入磁盘版。基线 docRevision 在冲突后
 * 绝不推进，第二次保存仍携带旧 revision 被拒。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = 'C:\\ws\\a.md'

const fakedisk = vi.hoisted(() => ({ content: 'A', revision: 'r1' }))
const writeCalls = vi.hoisted(() => [] as Array<{ content: string; expectedRevision?: string | null }>)
// provider 场景（markdown 真实路径）：可控模型与待存 buffer
const mockModel = vi.hoisted(() => ({ current: undefined as unknown }))
const pendingBuffer = vi.hoisted(() => ({ text: '' }))
const modelDisk = vi.hoisted(() => ({ text: 'A' }))
const providerDirty = vi.hoisted(() => ({ flag: false }))
let revSeq = 1

vi.mock('@/hooks/editor/useTextDocumentTools', () => ({
  // 缺省 undefined 走 workspaceApi revision 路径；provider 场景由用例注入模型。
  useTextDocumentTools: () => mockModel.current,
}))

vi.mock('@/api/workspace-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workspace-api')>()
  return {
    ...actual,
    workspaceApi: {
      readText: vi.fn(async (payload: { filePath?: string; workspaceId?: string; relativePath?: string }) => ({
        ok: true,
        value: {
          filePath: payload.relativePath ?? payload.filePath ?? PATH,
          content: fakedisk.content,
          revision: fakedisk.revision,
        },
      })),
      writeText: vi.fn(
        async (payload: { filePath?: string; relativePath?: string; content: string; expectedRevision?: string | null }) => {
          writeCalls.push({ content: payload.content, expectedRevision: payload.expectedRevision })
          if (payload.expectedRevision !== fakedisk.revision) {
            return { ok: false, error: { code: 'REVISION_CONFLICT', message: '外部已修改' } }
          }
          revSeq += 1
          fakedisk.content = payload.content
          fakedisk.revision = `r${revSeq}`
          return { ok: true, value: { filePath: payload.relativePath ?? payload.filePath ?? PATH, revision: fakedisk.revision } }
        },
      ),
      saveTextAs: vi.fn(async () => ({ ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'x' } })),
      readImage: vi.fn(async () => ({ ok: false, error: { code: 'UNSUPPORTED_FORMAT', message: 'x' } })),
      connect: vi.fn(async () => ({ ok: false, error: { code: 'UNSUPPORTED_FORMAT', message: 'x' } })),
      disconnect: vi.fn(async () => ({ ok: true, value: undefined })),
      getStatus: vi.fn(async () => ({
        ok: true,
        value: { workspaceId: 'local', kind: 'local', state: 'disconnected', generation: 0, rootLabel: '' },
      })),
      onStatusChanged: vi.fn(() => undefined),
      searchMarkdownAbortable: vi.fn(() => ({
        promise: Promise.resolve({ ok: true, value: { total: 0, hits: [], nextOffset: null } }),
        cancel: () => {},
      })),
    },
  }
})

vi.mock('@/api/file-api', () => ({
  fileApi: {
    openFile: vi.fn(),
    openFolder: vi.fn(),
    scanWorkspace: vi.fn(),
    readFile: vi.fn(async () => ({ ok: false, error: { code: 'FILE_NOT_FOUND', message: 'x' } })),
    // 模拟远端 saveFile 的 expectedContent 先读比对语义（provider 路径用）
    saveFile: vi.fn(async (payload: { filePath?: string; content: string; expectedContent?: string }) => {
      if (payload.expectedContent !== undefined && payload.expectedContent !== fakedisk.content) {
        return { ok: false, error: { code: 'REVISION_CONFLICT', message: '文件已被其他程序修改' } }
      }
      revSeq += 1
      fakedisk.content = payload.content
      fakedisk.revision = `r${revSeq}`
      return { ok: true, value: { filePath: payload.filePath } }
    }),
    saveFileAs: vi.fn(),
  },
  appApi: {
    getPlatform: () => ({ ok: true, value: 'win32' }),
    getVersion: vi.fn(async () => ({ ok: true, value: '0.0.0-test' })),
  },
}))

vi.mock('@/api/app-api', () => ({
  appApi: {
    updateTitle: vi.fn(),
    setDirty: vi.fn(),
    confirmClose: vi.fn(),
    quit: vi.fn(),
    newWindow: vi.fn(),
    toggleDevTools: vi.fn(),
    isFreshWindow: () => true,
    watchWorkspace: vi.fn(),
    unwatchWorkspace: vi.fn(),
    onWorkspaceChanged: vi.fn(() => undefined),
    onRequestClose: vi.fn(() => undefined),
  },
}))

import { useFileOperations } from './useFileOperations'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { isOk } from '@montree/contracts'
import { fileApi } from '@/api/file-api'
import { notifyDocumentTools, registerDocumentTools } from '@/lib/agent/context/document-tool-registry'

function renderFileOperations() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  let api: ReturnType<typeof useFileOperations> | undefined
  function Harness() {
    api = useFileOperations()
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)))
  })
  return {
    get current() {
      if (!api) throw new Error('hook 未挂载')
      return api
    },
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  fakedisk.content = 'A'
  fakedisk.revision = 'r1'
  revSeq = 1
  writeCalls.length = 0
  mockModel.current = undefined
  pendingBuffer.text = ''
  modelDisk.text = 'A'
  providerDirty.flag = false
  useWorkspaceStore.setState({ descriptor: null, status: null })
  vi.clearAllMocks()
})

describe('P1 冲突基线保护（§11-3）', () => {
  it.each([PATH, 'C:\\ws\\论文.typ'])('连续两次普通保存都不覆盖外部修改；显式覆盖后写入；重载载入磁盘版 (%s)', async (path) => {
    const hook = renderFileOperations()
    try {
      await act(async () => {
        await hook.current.openFileFromTree(path)
      })
      expect(hook.current.content).toBe('A')

      act(() => {
        hook.current.setContent('A-edited')
      })

      // B 在外部改写磁盘
      fakedisk.content = 'B'
      fakedisk.revision = 'r2'

      // 第一次保存：冲突，buffer 与基线保留，磁盘不动
      let first: Awaited<ReturnType<typeof hook.current.saveFile>> | undefined
      await act(async () => {
        first = await hook.current.saveFile()
      })
      expect(first && !first.ok && first.error.code).toBe('REVISION_CONFLICT')
      expect(hook.current.externalChange).toEqual({ diskContent: 'B' })
      expect(hook.current.content).toBe('A-edited')
      expect(fakedisk.content).toBe('B')

      // 第二次普通保存：仍携带旧基线 r1 被拒，绝不覆写 B
      writeCalls.length = 0
      await act(async () => {
        await hook.current.saveFile()
      })
      expect(writeCalls.length).toBe(1)
      expect(writeCalls[0].expectedRevision).toBe('r1')
      expect(fakedisk.content).toBe('B')
      expect(hook.current.externalChange).toEqual({ diskContent: 'B' })

      // 显式覆盖：携带重读磁盘版本写入成功，横幅清除
      await act(async () => {
        await hook.current.resolveExternalChange('overwrite')
      })
      expect(fakedisk.content).toBe('A-edited')
      expect(hook.current.externalChange).toBeNull()

      // 重载路径：再次弄脏 + 外部改 + 保存冲突 + 重载
      act(() => {
        hook.current.setContent('A-edited-2')
      })
      fakedisk.content = 'C'
      fakedisk.revision = 'r9'
      await act(async () => {
        await hook.current.saveFile()
      })
      expect(hook.current.externalChange).toEqual({ diskContent: 'C' })
      await act(async () => {
        await hook.current.resolveExternalChange('reload')
      })
      expect(hook.current.content).toBe('C')
      expect(hook.current.externalChange).toBeNull()
    } finally {
      hook.unmount()
    }
  })

  it('Typst save-as uses its own extension/filter and drops the old disk revision', async () => {
    const hook = renderFileOperations()
    try {
      await act(async () => { await hook.current.openFileFromTree('C:\\ws\\论文.typ') })
      expect(hook.current.documentKind).toBe('typst')
      expect(hook.current.isSourceDocument).toBe(true)
      act(() => { hook.current.setContent('#let x = "中文😀"') })
      vi.mocked(fileApi.saveFileAs).mockResolvedValueOnce({ ok: true, value: { filePath: 'C:\\ws\\副本.typ' } })
      await act(async () => { await hook.current.saveFileAs() })
      expect(fileApi.saveFileAs).toHaveBeenCalledWith(expect.objectContaining({
        documentKind: 'typst', defaultPath: expect.stringMatching(/论文\.typ$/), content: '#let x = "中文😀"',
      }))
      expect(hook.current.filePath).toBe('C:\\ws\\副本.typ')
      expect(hook.current.docRevision).toBeNull()
      expect(hook.current.isDirty).toBe(false)
      expect(hook.current.isMarkdownDocument).toBe(false)
    } finally { hook.unmount() }
  })

  it('静默自动保存遇冲突不抛错误打扰，只亮横幅', async () => {
    const errors: Array<{ code: string }> = []
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    let api: ReturnType<typeof useFileOperations> | undefined
    function Harness() {
      api = useFileOperations((error) => {
        errors.push({ code: error.code })
      })
      return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)))
    })
    try {
      await act(async () => {
        await api?.openFileFromTree(PATH)
      })
      act(() => {
        api?.setContent('edit')
      })
      fakedisk.content = 'B'
      fakedisk.revision = 'r2'
      await act(async () => {
        await api?.saveFile({ silent: true })
      })
      expect(errors).toEqual([])
      expect(api?.externalChange).toEqual({ diskContent: 'B' })
    } finally {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('provider 路径（markdown）：冲突亮横幅且重复拒绝；显式覆盖直写并同步模型', async () => {
    // 远端身份 + 远端树给出的相对路径：命中新的 provider 失败核对分支
    //（本机身份保持原行为；绝对路径在远端身份下仍走本机，不冒充远端）。
    const REL = 'notes/a.md'
    const descriptor = {
      id: 'wsl:Ubuntu:/home/u/blog',
      kind: 'wsl',
      target: 'Ubuntu',
      rootLabel: '/home/u/blog',
      displayName: 'blog',
    } as const
    useWorkspaceStore.setState({
      descriptor,
      status: { workspaceId: descriptor.id, kind: 'wsl', state: 'connected', generation: 1, rootLabel: descriptor.rootLabel },
    })
    const markSaved = vi.fn()
    mockModel.current = { filePath: REL, markSaved }
    const disposeProvider = registerDocumentTools({
      filePath: REL,
      kind: 'text',
      isDirty: () => providerDirty.flag,
      save: async () => {
        const result = await fileApi.saveFile({
          filePath: REL,
          content: pendingBuffer.text,
          expectedContent: modelDisk.text,
        })
        if (!isOk(result)) throw new Error(result.error.message)
        modelDisk.text = pendingBuffer.text
      },
      undo: () => {},
      read: () => null,
      edit: () => null,
    })
    const hook = renderFileOperations()
    try {
      await act(async () => {
        await hook.current.openFileFromTree(REL)
      })
      expect(hook.current.content).toBe('A')
      act(() => {
        hook.current.setContent('A-edited')
      })
      pendingBuffer.text = 'A-edited'
      providerDirty.flag = true
      act(() => {
        notifyDocumentTools()
      })

      // B 外部改写后保存：provider 抛错 → 核对磁盘 → 横幅 + 冲突码
      fakedisk.content = 'B'
      fakedisk.revision = 'r2'
      let first: Awaited<ReturnType<typeof hook.current.saveFile>> | undefined
      await act(async () => {
        first = await hook.current.saveFile()
      })
      expect(first && !first.ok && first.error.code).toBe('REVISION_CONFLICT')
      expect(hook.current.externalChange).toEqual({ diskContent: 'B' })
      expect(fakedisk.content).toBe('B')

      // 重复普通保存：模型基线仍是旧值，持续被拒，磁盘不动
      await act(async () => {
        await hook.current.saveFile()
      })
      expect(fakedisk.content).toBe('B')
      expect(hook.current.externalChange).toEqual({ diskContent: 'B' })

      // 显式覆盖：经宿主用磁盘版本直写，模型与基线同步，横幅清除
      await act(async () => {
        await hook.current.resolveExternalChange('overwrite')
      })
      expect(fakedisk.content).toBe('A-edited')
      expect(markSaved).toHaveBeenCalledWith('A-edited', 'A-edited')
      expect(hook.current.externalChange).toBeNull()
    } finally {
      disposeProvider()
      mockModel.current = undefined
      hook.unmount()
    }
  })
})
