import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'montree-docs-'))
  roots.push(root)
  for (const [file, content] of Object.entries(files)) {
    const full = join(root, file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}
function lint(root: string) {
  return spawnSync('bun', [resolve('scripts/lint-docs.ts'), root], { encoding: 'utf-8' })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('architecture package references', () => {
  it('accepts existing workspace packages and published packages', () => {
    const result = lint(fixture({
      'README.md': '`@yitom/contracts` 与 `@montree/pdf`，见 `packages/pdf/`。',
      'packages/pdf/package.json': '{"name":"@montree/pdf"}',
    }))
    expect(result.status, result.stderr).toBe(0)
  })

  it.each(['AGENTS.md', 'apps/desktop/src/README.md', 'packages/pdf/README.md'])(
    'rejects removed package paths and names in %s', (file) => {
      const result = lint(fixture({ [file]: '`packages/contracts/` 与 `@montree/reader-core`。' }))
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('packages/contracts')
      expect(result.stderr).toContain('packages/reader-core')
    },
  )

  it('leaves historical migration records outside the current architecture check', () => {
    const result = lint(fixture({ 'docs/migration.md': '`packages/contracts/` 与 `@montree/chat-ui`。' }))
    expect(result.status, result.stderr).toBe(0)
  })
})
