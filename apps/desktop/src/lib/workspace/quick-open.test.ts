import { describe, expect, it } from 'vitest'
import type { FileTreeNode } from '@montree/contracts'
import {
  flattenFileTree,
  scoreFuzzyMatch,
  searchQuickOpenFiles,
  type QuickOpenFileItem,
} from './quick-open'

describe('quick-open', () => {
  describe('flattenFileTree', () => {
    it('flattens nested file trees and calculates relative paths correctly', () => {
      const tree: FileTreeNode[] = [
        {
          name: 'notes',
          path: '/workspace/notes',
          type: 'directory',
          children: [
            {
              name: 'react.md',
              path: '/workspace/notes/react.md',
              type: 'file',
              documentKind: 'markdown',
            },
          ],
        },
        {
          name: 'books',
          path: '/workspace/books',
          type: 'directory',
          children: [
            {
              name: 'algorithms.pdf',
              path: '/workspace/books/algorithms.pdf',
              type: 'file',
              documentKind: 'pdf',
            },
          ],
        },
        {
          name: 'README.md',
          path: '/workspace/README.md',
          type: 'file',
          documentKind: 'markdown',
        },
      ]

      const items = flattenFileTree(tree, '/workspace', ['/workspace/notes/react.md'])
      expect(items).toHaveLength(3)

      const reactItem = items.find((i) => i.name === 'react.md')
      expect(reactItem).toBeDefined()
      expect(reactItem?.relativePath).toBe('notes/react.md')
      expect(reactItem?.folderPath).toBe('notes')
      expect(reactItem?.documentKind).toBe('markdown')
      expect(reactItem?.isRecent).toBe(true)

      const readmeItem = items.find((i) => i.name === 'README.md')
      expect(readmeItem).toBeDefined()
      expect(readmeItem?.relativePath).toBe('README.md')
      expect(readmeItem?.folderPath).toBe('')
      expect(readmeItem?.isRecent).toBe(false)
    })
  })

  describe('scoreFuzzyMatch', () => {
    it('matches empty query with 0 score', () => {
      const res = scoreFuzzyMatch('', 'anything.md')
      expect(res.match).toBe(true)
      expect(res.score).toBe(0)
    })

    it('gives higher score to word-start exact matches', () => {
      const startMatch = scoreFuzzyMatch('react', 'react-router.md')
      const middleMatch = scoreFuzzyMatch('react', 'my-react.md')

      expect(startMatch.match).toBe(true)
      expect(middleMatch.match).toBe(true)
      expect(startMatch.score).toBeGreaterThan(middleMatch.score)
    })

    it('handles subsequence fuzzy matching', () => {
      const res = scoreFuzzyMatch('alg', 'algorithms.pdf')
      expect(res.match).toBe(true)
      expect(res.indices).toEqual([0, 1, 2])

      const subseq = scoreFuzzyMatch('rct', 'react.md')
      expect(subseq.match).toBe(true)
      expect(subseq.indices).toEqual([0, 3, 4])
    })

    it('returns match: false if query is not a subsequence', () => {
      const res = scoreFuzzyMatch('xyz', 'algorithms.pdf')
      expect(res.match).toBe(false)
      expect(res.score).toBe(0)
    })
  })

  describe('searchQuickOpenFiles', () => {
    const items: QuickOpenFileItem[] = [
      {
        name: 'JavaScript-Guide.epub',
        path: '/workspace/books/JavaScript-Guide.epub',
        relativePath: 'books/JavaScript-Guide.epub',
        folderPath: 'books',
        extension: '.epub',
        documentKind: 'epub',
      },
      {
        name: 'Java-Core.pdf',
        path: '/workspace/books/Java-Core.pdf',
        relativePath: 'books/Java-Core.pdf',
        folderPath: 'books',
        extension: '.pdf',
        documentKind: 'pdf',
      },
      {
        name: 'reading-notes.md',
        path: '/workspace/notes/reading-notes.md',
        relativePath: 'notes/reading-notes.md',
        folderPath: 'notes',
        extension: '.md',
        documentKind: 'markdown',
      },
    ]

    it('returns recent files first when query is empty', () => {
      const recent = ['/workspace/notes/reading-notes.md']
      const results = searchQuickOpenFiles(items, '', recent)

      expect(results[0]?.item.name).toBe('reading-notes.md')
      expect(results).toHaveLength(3)
    })

    it('ranks exact and prefix matches higher', () => {
      const results = searchQuickOpenFiles(items, 'java')
      expect(results.length).toBeGreaterThanOrEqual(2)
      // Both Java-Core.pdf and JavaScript-Guide.epub match 'java'
      expect(results[0]?.item.name.toLowerCase()).toContain('java')
    })

    it('can match by folder name in relativePath', () => {
      const results = searchQuickOpenFiles(items, 'notes')
      expect(results.length).toBe(1)
      expect(results[0]?.item.name).toBe('reading-notes.md')
    })
  })
})
