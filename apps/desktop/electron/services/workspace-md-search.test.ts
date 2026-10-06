import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  searchWorkspaceMarkdown,
  WORKSPACE_MD_MAX_FILES,
} from './workspace-md-search'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop() as string
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'montree-ws-'))
  dirs.push(dir)
  return dir
}

function write(root: string, rel: string, content: string): void {
  const parts = rel.split('/')
  const file = parts.pop() as string
  if (parts.length > 0) mkdirSync(join(root, ...parts), { recursive: true })
  writeFileSync(join(root, ...parts, file), content, 'utf8')
}

describe('searchWorkspaceMarkdown', () => {
  it('a.md 命中，相对路径为 posix 且行号 1-based', () => {
    const root = makeRoot()
    write(root, 'a.md', '# 标题\n本行有王道计三字\n尾行')
    write(root, 'note.txt', '王道计不在 md 里')
    const result = searchWorkspaceMarkdown({ root, query: '王道计' })
    expect(result.total).toBe(1)
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]).toMatchObject({ filePath: 'a.md', lineStart: 2 })
    expect(result.hits[0]?.filePath).not.toMatch(/^[A-Za-z]:|^\//)
    expect(result.hits[0]?.line).toContain('王道计')
  })

  it('当前打开文件的磁盘稿被排除（内存已覆盖）', () => {
    const root = makeRoot()
    write(root, 'a.md', '王道计在别处')
    write(root, 'b.md', '磁盘旧稿王道计')
    const openAbs = join(root, 'b.md')
    const result = searchWorkspaceMarkdown({ root, query: '王道计', excludePath: openAbs })
    expect(result.total).toBe(1)
    expect(result.hits[0]?.filePath).toBe('a.md')
  })

  it('.git/secret.md、点文件、node_modules、根外文件一律不进', () => {
    const root = makeRoot()
    const outside = makeRoot()
    write(root, '.git/secret.md', '王道计秘密')
    write(root, '.hidden.md', '王道计隐藏')
    write(root, 'node_modules/pkg/readme.md', '王道计依赖')
    write(root, 'dist/out.md', '王道计构建')
    write(root, 'sub/ok.MD', '王道计大写扩展名')
    write(outside, 'evil.md', '王道计根外')
    const result = searchWorkspaceMarkdown({ root, query: '王道计' })
    expect(result.total).toBe(1)
    expect(result.hits[0]?.filePath).toBe('sub/ok.MD')
  })

  it('symlink 一律跳过（含逃逸与根内链接）', () => {
    const root = makeRoot()
    const outside = makeRoot()
    write(outside, 'evil.md', '王道计逃逸')
    let linked = false
    try {
      symlinkSync(join(outside, 'evil.md'), join(root, 'link.md'))
      linked = true
    } catch {
      linked = false
    }
    if (!linked) return
    write(root, 'a.md', '王道计正常')
    const result = searchWorkspaceMarkdown({ root, query: '王道计' })
    expect(result.total).toBe(1)
    expect(result.hits[0]?.filePath).toBe('a.md')
  })

  it('超大文件跳过、空 query 零命中', () => {
    const root = makeRoot()
    // O(n) 构造超 256KB 文件（逐次 join 会 O(n²) 拖慢用例）
    const big = `王道计开头\n${'填充行\n'.repeat(30000)}`
    expect(Buffer.byteLength(big, 'utf8')).toBeGreaterThan(256 * 1024)
    write(root, 'big.md', big)
    write(root, 'a.md', '王道计正常')
    const result = searchWorkspaceMarkdown({ root, query: '王道计' })
    expect(result.total).toBe(1)
    expect(result.hits[0]?.filePath).toBe('a.md')
    expect(searchWorkspaceMarkdown({ root, query: '  ' }).total).toBe(0)
  })

  it('大小写不敏感的字面匹配，无正则语义', () => {
    const root = makeRoot()
    write(root, 'a.md', 'BILIBILI 大写命中')
    const lower = searchWorkspaceMarkdown({ root, query: 'bilibili' })
    expect(lower.total).toBe(1)
    // 正则元字符按字面处理，不炸不误杀
    const meta = searchWorkspaceMarkdown({ root, query: '.*+' })
    expect(meta.total).toBe(0)
  })

  it('文件数量有上限且结果确定有序', () => {
    const root = makeRoot()
    for (let i = 0; i < 5; i += 1) write(root, `f${i}.md`, '王道计')
    const first = searchWorkspaceMarkdown({ root, query: '王道计' })
    const second = searchWorkspaceMarkdown({ root, query: '王道计' })
    expect(first.total).toBe(5)
    expect(first).toEqual(second)
    expect(WORKSPACE_MD_MAX_FILES).toBe(200)
  })
})
