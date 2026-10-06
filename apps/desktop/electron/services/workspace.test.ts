import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { scanWorkspace } from './workspace'
import type { FileTreeNode } from '@montree/contracts'

describe('scanWorkspace', () => {
  it('发现 Markdown、PDF、EPUB 与 MOBI 文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-workspace-'))

    await writeFile(join(root, 'notes.md'), '# hi')
    await writeFile(join(root, 'book.pdf'), '%PDF')
    await writeFile(join(root, 'novel.epub'), 'PK')
    await writeFile(join(root, 'ignored.mobi'), 'MOBI')

    const nested = join(root, 'nested')
    await mkdir(nested)
    await writeFile(join(nested, 'chapter.txt'), 'text')

    const tree = await scanWorkspace(root)

    const fileNames = tree.flatMap(function collect(node: FileTreeNode): string[] {
      if (node.type === 'file') return [node.name]
      return (node.children ?? []).flatMap(collect)
    })

    expect(fileNames).toContain('notes.md')
    expect(fileNames).toContain('book.pdf')
    expect(fileNames).toContain('novel.epub')
    expect(fileNames).toContain('chapter.txt')
    expect(fileNames).toContain('ignored.mobi')
  })
})
