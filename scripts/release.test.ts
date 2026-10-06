import { describe, expect, it } from 'vitest'
import {
  bumpVersion,
  extractUnreleasedBody,
  parseArgs,
  updateChangelog,
} from './release'

describe('release bumpVersion', () => {
  it('默认 patch 递增', () => {
    expect(bumpVersion('0.2.5', 'patch')).toBe('0.2.6')
  })

  it('minor / major 清零低位', () => {
    expect(bumpVersion('0.2.5', 'minor')).toBe('0.3.0')
    expect(bumpVersion('0.2.5', 'major')).toBe('1.0.0')
  })
})

describe('release parseArgs', () => {
  it('默认为 patch，可组合 --push', () => {
    expect(parseArgs([])).toEqual({ bump: 'patch', bumpExplicit: false, push: false, dryRun: false })
    expect(parseArgs(['minor', '--push'])).toEqual({
      bump: 'minor',
      bumpExplicit: true,
      push: true,
      dryRun: false,
    })
  })

  it('单 --push 不点名 bump（只推不断版，供 release:push 用）', () => {
    expect(parseArgs(['--push'])).toEqual({
      bump: 'patch',
      bumpExplicit: false,
      push: true,
      dryRun: false,
    })
  })
})

describe('release changelog', () => {
  const sample = `# 更新日志

## [未发布]

### 新功能

- 示例要点

---

## [0.2.5] - 2026-09-01

- 旧版

---

[未发布]: https://github.com/yitom486/montree/compare/v0.2.5...HEAD
[0.2.5]: https://github.com/yitom486/montree/compare/v0.2.3...v0.2.5
`

  it('提取未发布正文并去掉节末 ---', () => {
    expect(extractUnreleasedBody(sample)).toBe('### 新功能\n\n- 示例要点')
  })

  it('空未发布会失败', () => {
    const empty = sample.replace('### 新功能\n\n- 示例要点\n\n', '')
    expect(() => extractUnreleasedBody(empty)).toThrow(/没有要点/)
  })

  it('收成正式版本节并更新链接', () => {
    const body = extractUnreleasedBody(sample)
    const next = updateChangelog(sample, '0.2.6', '2026-09-01', body)
    expect(next).toContain('## [0.2.6] - 2026-09-01')
    expect(next).toContain('- 示例要点')
    expect(next).toContain('## [0.2.5] - 2026-09-01')
    expect(next).toContain(
      '[未发布]: https://github.com/yitom486/montree/compare/v0.2.6...HEAD',
    )
    expect(next).toContain(
      '[0.2.6]: https://github.com/yitom486/montree/compare/v0.2.5...v0.2.6',
    )
  })
})
