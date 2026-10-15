// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildMontreePromptPrefix } from './build-prompt-prefix'
import {
  MONTREE_INTERACTIVE_GUIDANCE,
  MONTREE_STATIC_SKILL,
  MONTREE_TOOL_OVERVIEW,
} from './montree-static-skill'
import { takeTurnContextDecision } from './should-attach-turn-context'

function joined(blocks: { type: string; text?: string }[]): string {
  return blocks.map((b) => b.text ?? '').join('\n')
}

describe('buildMontreePromptPrefix 会话模式', () => {
  it('compatibility 缺省：首轮静态 Skill 与每轮工具概览都在', () => {
    const blocks = buildMontreePromptPrefix('prefix-compat-default')
    const text = joined(blocks)
    expect(text).toContain(MONTREE_STATIC_SKILL.slice(0, 60))
    expect(text).toContain(MONTREE_TOOL_OVERVIEW.slice(0, 60))
    expect(text).toContain(MONTREE_INTERACTIVE_GUIDANCE.slice(0, 60))
  })

  it('compatibility 显式：行为与缺省一致', () => {
    const blocks = buildMontreePromptPrefix('prefix-compat-explicit', { mode: 'compatibility' })
    expect(joined(blocks)).toContain(MONTREE_STATIC_SKILL.slice(0, 60))
  })

  it('native：静态三块全省，只可能剩动态 turn-context', () => {
    const blocks = buildMontreePromptPrefix('prefix-native-quiet', { mode: 'native' })
    const text = joined(blocks)
    expect(text).not.toContain(MONTREE_STATIC_SKILL.slice(0, 60))
    expect(text).not.toContain(MONTREE_TOOL_OVERVIEW.slice(0, 60))
    expect(text).not.toContain(MONTREE_INTERACTIVE_GUIDANCE.slice(0, 60))
    expect(text).not.toContain('<montree-bootstrap>')
  })

  it('native：动态 turn-context 照常附加（只减静态，不减动态）', () => {
    const tid = 'prefix-native-dynamic'
    // 先种一次文档状态，使本轮判定为 documentChanged → attach
    takeTurnContextDecision(tid, 'doc-a')
    const blocks = buildMontreePromptPrefix(tid, { mode: 'native' })
    const text = joined(blocks)
    expect(text).toContain('<montree-turn-context>')
    expect(text).not.toContain(MONTREE_STATIC_SKILL.slice(0, 60))
    expect(text).not.toContain(MONTREE_TOOL_OVERVIEW.slice(0, 60))
  })

  it('includeBootstrap=false 仍保留每轮工具概览（旧语义锁死）', () => {
    const blocks = buildMontreePromptPrefix('prefix-no-bootstrap', { includeBootstrap: false })
    const text = joined(blocks)
    expect(text).not.toContain(MONTREE_STATIC_SKILL.slice(0, 60))
    expect(text).toContain(MONTREE_TOOL_OVERVIEW.slice(0, 60))
  })
})
