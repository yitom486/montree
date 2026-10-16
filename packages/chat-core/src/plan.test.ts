import { describe, expect, it } from 'vitest'
import { parseAcpPlanEntries, summarizePlanProgress } from './plan'

describe('parseAcpPlanEntries', () => {
  it('parses v1 flat plan entries', () => {
    const entries = parseAcpPlanEntries({
      sessionUpdate: 'plan',
      entries: [
        { content: '分析代码', priority: 'high', status: 'in_progress' },
        { content: '写测试', priority: 'medium', status: 'pending' },
      ],
    })
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ content: '分析代码', status: 'in_progress' })
  })

  it('parses v2 plan_update nested plan.entries', () => {
    const entries = parseAcpPlanEntries({
      sessionUpdate: 'plan_update',
      plan: {
        type: 'items',
        planId: 'main',
        entries: [{ content: 'Step A', status: 'completed' }],
      },
    })
    expect(entries).toEqual([{ content: 'Step A', priority: undefined, status: 'completed' }])
  })

  it('ignores invalid rows', () => {
    expect(parseAcpPlanEntries({ entries: [{ content: '' }, null, 1] })).toEqual([])
  })
})

describe('summarizePlanProgress', () => {
  it('counts statuses', () => {
    const summary = summarizePlanProgress([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ])
    expect(summary).toEqual({ total: 3, completed: 1, inProgress: 1, active: true })
  })
})
