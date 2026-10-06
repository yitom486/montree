import { describe, expect, it } from 'vitest'
import type { FileTreeNode } from '@montree/contracts'
import { resolveWikilinkTarget } from './resolve-wikilink'

describe('resolveWikilinkTarget', () => {
  const tree: FileTreeNode[] = [
    {
      name: 'notes',
      path: 'd:/workspace/notes',
      type: 'directory',
      children: [
        {
          name: 'React.md',
          path: 'd:/workspace/notes/React.md',
          type: 'file',
        },
        {
          name: 'Vue.md',
          path: 'd:/workspace/notes/Vue.md',
          type: 'file',
        },
      ],
    },
    {
      name: 'books',
      path: 'd:/workspace/books',
      type: 'directory',
      children: [
        {
          name: 'Java.pdf',
          path: 'd:/workspace/books/Java.pdf',
          type: 'file',
        },
      ],
    },
  ]

  const root = 'd:/workspace'

  it('matches exact note without extension', () => {
    const res = resolveWikilinkTarget('React', tree, root)
    expect(res.status).toBe('found')
    expect(res.filePath).toBe('d:/workspace/notes/React.md')
  })

  it('matches relative path with extension and anchor', () => {
    const res = resolveWikilinkTarget('books/Java.pdf#page=12', tree, root)
    expect(res.status).toBe('found')
    expect(res.filePath).toBe('d:/workspace/books/Java.pdf')
    expect(res.anchor).toBe('page=12')
    expect(res.kind).toBe('pdf')
  })

  it('returns missing-note when target note does not exist', () => {
    const res = resolveWikilinkTarget('未写的思考', tree, root)
    expect(res.status).toBe('missing-note')
    expect(res.targetName).toBe('未写的思考.md')
  })

  it('returns missing-book when target ebook does not exist', () => {
    const res = resolveWikilinkTarget('不存在的书.epub', tree, root)
    expect(res.status).toBe('missing-book')
    expect(res.targetName).toBe('不存在的书.epub')
  })
})
