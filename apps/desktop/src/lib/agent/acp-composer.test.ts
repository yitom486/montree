import { describe, expect, it } from 'vitest'
import {
  buildAcpPromptBlocks,
  canSendComposer,
  fileNameFromPath,
  MONTREE_WORKSPACE_PATHS_MIME,
  isPathInsideWorkspace,
  mimeFromFileName,
  readWorkspacePathsFromDataTransfer,
  toFileUri,
  writeWorkspacePathsToDataTransfer,
  type ComposerAttachment,
} from './acp-composer'

function fileAtt(partial: Partial<ComposerAttachment> & Pick<ComposerAttachment, 'id' | 'name'>): ComposerAttachment {
  return {
    kind: 'file',
    mimeType: 'text/markdown',
    absolutePath: 'D:/ws/a.md',
    ...partial,
  }
}

function imageAtt(partial: Partial<ComposerAttachment> & Pick<ComposerAttachment, 'id' | 'name'>): ComposerAttachment {
  return {
    kind: 'image',
    mimeType: 'image/png',
    ...partial,
  }
}

describe('acp-composer', () => {
  it('detects workspace path containment', () => {
    expect(isPathInsideWorkspace('D:\\ws\\src\\a.ts', 'D:\\ws')).toBe(true)
    expect(isPathInsideWorkspace('D:/ws', 'D:/ws')).toBe(true)
    expect(isPathInsideWorkspace('D:\\other\\a.ts', 'D:\\ws')).toBe(false)
  })

  it('builds file:// URIs for Windows paths', () => {
    expect(toFileUri('D:\\ws\\a.md')).toBe('file:///D:/ws/a.md')
  })

  it('maps common mime types', () => {
    expect(mimeFromFileName('x.png')).toBe('image/png')
    expect(mimeFromFileName('note.md')).toBe('text/markdown')
  })

  it('requires text or attachments to send', () => {
    expect(canSendComposer('', [])).toBe(false)
    expect(canSendComposer(' hi ', [])).toBe(true)
    expect(canSendComposer('', [fileAtt({ id: '1', name: 'a.md' })])).toBe(true)
  })

  it('sends resource_link for files', () => {
    const blocks = buildAcpPromptBlocks({
      text: '看看这个',
      attachments: [fileAtt({ id: '1', name: 'a.md', absolutePath: 'D:/ws/a.md', size: 12 })],
    })
    expect(blocks).toEqual([
      { type: 'text', text: '看看这个' },
      {
        type: 'resource_link',
        uri: 'file:///D:/ws/a.md',
        name: 'a.md',
        mimeType: 'text/markdown',
        size: 12,
      },
    ])
  })

  it('uses image block when capability is on', () => {
    const blocks = buildAcpPromptBlocks({
      text: '',
      attachments: [
        imageAtt({
          id: '1',
          name: 'shot.png',
          base64: 'abc',
          absolutePath: 'D:/ws/.montree/agent-pasted/x.png',
        }),
      ],
      promptCapabilities: { image: true },
    })
    expect(blocks).toEqual([
      {
        type: 'image',
        data: 'abc',
        mimeType: 'image/png',
        uri: 'file:///D:/ws/.montree/agent-pasted/x.png',
      },
    ])
  })

  it('falls back to resource_link when image capability is off', () => {
    const blocks = buildAcpPromptBlocks({
      text: '图',
      attachments: [
        imageAtt({
          id: '1',
          name: 'shot.png',
          base64: 'abc',
          absolutePath: 'D:/ws/.montree/agent-pasted/x.png',
        }),
      ],
      promptCapabilities: {},
    })
    expect(blocks[1]).toMatchObject({
      type: 'resource_link',
      name: 'shot.png',
      uri: 'file:///D:/ws/.montree/agent-pasted/x.png',
    })
  })

  it('skips image without path when capability is off', () => {
    const blocks = buildAcpPromptBlocks({
      text: 'x',
      attachments: [imageAtt({ id: '1', name: 'shot.png', base64: 'abc' })],
      promptCapabilities: {},
    })
    expect(blocks).toEqual([{ type: 'text', text: 'x' }])
  })

  it('round-trips workspace paths through DataTransfer MIME', () => {
    const store = new Map<string, string>()
    const dt = {
      effectAllowed: 'none' as string,
      setData(type: string, value: string) {
        store.set(type, value)
      },
      getData(type: string) {
        return store.get(type) ?? ''
      },
      types: [] as string[],
    }
    writeWorkspacePathsToDataTransfer(dt as unknown as DataTransfer, [
      'D:\\ws\\docs\\a.md',
      'D:\\ws\\docs\\a.md',
      '',
    ])
    expect(store.get(MONTREE_WORKSPACE_PATHS_MIME)).toContain('D:\\\\ws\\\\docs\\\\a.md')
    expect(readWorkspacePathsFromDataTransfer(dt as unknown as DataTransfer)).toEqual([
      'D:\\ws\\docs\\a.md',
    ])
    expect(fileNameFromPath('D:\\ws\\docs\\a.md')).toBe('a.md')
  })
})
