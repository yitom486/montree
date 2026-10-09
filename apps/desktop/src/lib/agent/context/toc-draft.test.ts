import { describe, expect, it } from 'vitest'
import {
  clearTocDraft,
  decideTocAiPromptOutcome,
  deleteTocDraftEntry,
  peekTocDraftSeq,
  readTocDraft,
  sanitizeTocDraftEntry,
  takeTocDraft,
  takeTocDraftSince,
  upsertTocDraftEntry,
  waitForTocDraft,
  writeTocDraft,
  type TocDraftEntry,
} from './toc-draft'

describe('toc-draft', () => {
  it('sanitize 与 toc-ai 解析同口径（工具 1-based 转存 0-based）', () => {
    expect(sanitizeTocDraftEntry({ title: ' 3.1 组成 ', printedPage: '31', level: '2' })).toEqual({
      title: '3.1 组成',
      printedPage: 31,
      level: 1,
      source: 'ai',
    })
    expect(sanitizeTocDraftEntry({ title: '', printedPage: 1 })).toBeNull()
    expect(sanitizeTocDraftEntry({ title: '正文', printedPage: 0 })).toBeNull()
    expect(sanitizeTocDraftEntry({ title: '87929797王道计', printedPage: 149 })).toBeNull()
    expect(sanitizeTocDraftEntry({ title: '深层', printedPage: 3, level: 99 })?.level).toBe(6)
  })

  it('整单替换幂等并计丢弃', () => {
    clearTocDraft()
    const result = writeTocDraft('fp-1', [
      { title: '第1章', printedPage: 1, level: 1 },
      { title: '', printedPage: 2 },
      { title: '87929797王道计', printedPage: 3 },
    ])
    expect(result).toEqual({ count: 1, dropped: 2 })
    expect(readTocDraft()?.entries).toHaveLength(1)
  })

  it('缺页码节父项跟随后继、无号章行丢弃', () => {
    clearTocDraft()
    const result = writeTocDraft('fp-1', [
      { title: '第3章 存储系统', level: 1 },
      { title: '3.1 主存储器', level: 1 },
      { title: '3.1.1 概述', printedPage: 45, level: 2 },
    ])
    expect(result).toEqual({ count: 2, dropped: 1 })
    expect(readTocDraft()?.entries).toEqual([
      { title: '3.1 主存储器', printedPage: 45, endPage: 45, level: 0, source: 'ai' },
      { title: '3.1.1 概述', printedPage: 45, endPage: undefined, level: 1, source: 'ai' },
    ])
  })

  it('同级兄弟缺页不回填（防涂抹），仅父子继承', () => {
    clearTocDraft()
    const siblings = writeTocDraft('fp-1', [
      { title: '3.1 父项', level: 1 },
      { title: '3.2 父项', level: 1 },
      { title: '3.3 父项', level: 1 },
      { title: '3.4 父项', level: 1 },
      { title: '3.5 落点', printedPage: 45, level: 1 },
    ])
    // 同级不同页：继承必错位，只留落点
    expect(siblings.count).toBe(1)
    expect(siblings.dropped).toBe(4)
    clearTocDraft()
    const parent = writeTocDraft('fp-1', [
      { title: '3.1 父项', level: 1 },
      { title: '3.1.1 落点', printedPage: 45, level: 2 },
    ])
    expect(parent.count).toBe(2)
  })

  it('upsert 同标题更新、异标题追加', () => {
    clearTocDraft()
    writeTocDraft('fp-1', [{ title: '第1章', printedPage: 1, level: 1 }])
    expect(upsertTocDraftEntry('fp-1', { title: '第1章', printedPage: 2, level: 1 })).toMatchObject({
      action: 'updated',
      count: 1,
    })
    expect(upsertTocDraftEntry('fp-1', { title: '1.1', printedPage: 2, level: 2 })).toMatchObject({
      action: 'added',
      count: 2,
    })
    expect(readTocDraft()?.entries[0]).toMatchObject({ printedPage: 2 })
    expect(upsertTocDraftEntry('fp-1', { title: '', printedPage: 1 })).toHaveProperty('error')
  })

  it('按序号/标题删除', () => {
    clearTocDraft()
    writeTocDraft('fp-1', [
      { title: 'A', printedPage: 1, level: 1 },
      { title: 'B', printedPage: 2, level: 1 },
    ])
    expect(deleteTocDraftEntry('fp-1', { index: 5 })).toEqual({ removed: 0, count: 2 })
    expect(deleteTocDraftEntry('fp-1', { title: 'A' })).toEqual({ removed: 1, count: 1 })
    expect(deleteTocDraftEntry('other-fp', { index: 0 })).toEqual({ removed: 0, count: 1 })
  })

  it('工具草稿 + 空文字回复 => 用工具草稿（零正文 agent 不丢稿）', () => {
    clearTocDraft()
    writeTocDraft('fp-1', [{ title: '1.2.3软件', printedPage: 4, level: 2 }])
    const drafted = takeTocDraft('fp-1')
    expect(
      decideTocAiPromptOutcome(drafted !== null, false),
    ).toEqual({ action: 'apply-draft', source: 'tool' })
  })

  it('无工具草稿 + 空文字回复 => AI 无回复', () => {
    clearTocDraft()
    const drafted = takeTocDraft('fp-1')
    expect(decideTocAiPromptOutcome(drafted !== null, false)).toEqual({ action: 'no-reply' })
  })

  it('工具草稿 + 有文字回复 => 工具草稿优先（不双算）', () => {
    clearTocDraft()
    writeTocDraft('fp-1', [{ title: '1.2.3软件', printedPage: 4, level: 2 }])
    const drafted = takeTocDraft('fp-1')
    expect(decideTocAiPromptOutcome(drafted !== null, true)).toEqual({
      action: 'apply-draft',
      source: 'tool',
    })
    // 取即清空：同一份草稿不会被 JSON 回退再消费一次
    expect(takeTocDraft('fp-1')).toBeNull()
  })

  it('指纹不符草稿不被消费（保留给对的书）', () => {
    clearTocDraft()
    writeTocDraft('fp-1', [{ title: '1.2.3软件', printedPage: 4, level: 2 }])
    expect(takeTocDraft('other-fp')).toBeNull()
    expect(
      decideTocAiPromptOutcome(takeTocDraft('other-fp') !== null, false),
    ).toEqual({ action: 'no-reply' })
    expect(readTocDraft()?.entries).toHaveLength(1)
  })

  it('waitForTocDraft：已有草稿命中即返（不睡觉）', async () => {
    const row: TocDraftEntry = { title: '1.2.3软件', printedPage: 4, level: 1 }
    const takes: string[] = []
    const result = await waitForTocDraft('fp-1', {
      take: (fp) => {
        takes.push(fp)
        return [row]
      },
      sleep: () => {
        throw new Error('must not sleep on instant hit')
      },
      now: () => 1000,
    })
    expect(result).toEqual({ entries: [row], waitedMs: 0, outcome: 'hit' })
    expect(takes).toEqual(['fp-1'])
  })

  it('waitForTocDraft：延迟写入落袋（send 超时后工具后完成）', async () => {
    const row: TocDraftEntry = { title: '1.2.3软件', printedPage: 4, level: 1 }
    let now = 0
    const sleeps: number[] = []
    let calls = 0
    const result = await waitForTocDraft('fp-1', {
      take: () => {
        calls += 1
        return calls >= 3 ? [row] : null
      },
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        now += ms
      },
      intervalMs: 2000,
      deadlineMs: 9000,
    })
    expect(result.outcome).toBe('hit')
    expect(result.entries).toEqual([row])
    expect(result.waitedMs).toBe(4000)
    expect(sleeps).toEqual([2000, 2000])
  })

  it('waitForTocDraft：到期无稿返回 timeout（调用方显示 AI 无回复）', async () => {
    let now = 0
    const result = await waitForTocDraft('fp-1', {
      take: () => null,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms
      },
      intervalMs: 2000,
      deadlineMs: 5000,
    })
    expect(result).toEqual({ entries: null, waitedMs: 5000, outcome: 'timeout' })
  })

  it('waitForTocDraft：取消即停（切文件/新一轮/卸载）', async () => {
    let checks = 0
    const result = await waitForTocDraft('fp-1', {
      take: () => null,
      isCancelled: () => {
        checks += 1
        return checks >= 2
      },
      now: () => 0,
      sleep: async () => {},
    })
    expect(result.outcome).toBe('cancelled')
    expect(result.entries).toBeNull()
  })

  it('waitForTocDraft：旧指纹草稿不被新指纹消费', async () => {
    const row: TocDraftEntry = { title: 'a', printedPage: 1, level: 0 }
    const store = new Map<string, TocDraftEntry[]>([['fp-old', [row]]])
    const result = await waitForTocDraft('fp-new', {
      take: (fp) => store.get(fp) ?? null,
      now: () => 0,
      sleep: async () => {},
      deadlineMs: 0,
    })
    expect(result.outcome).toBe('timeout')
  })

  it('同指纹旧草稿不被新轮次门控消费（只认本轮之后落袋）', () => {
    clearTocDraft()
    writeTocDraft('fp-1', [{ title: '旧轮次', printedPage: 1, level: 1 }])
    const baseline = peekTocDraftSeq('fp-1')
    expect(baseline).toBeGreaterThan(0)
    // 旧草稿：seq 不大于基线，不消费也不清除
    expect(takeTocDraftSince('fp-1', baseline)).toBeNull()
    expect(readTocDraft()?.entries).toHaveLength(1)
    // 本轮之后落袋（旧超时操作随后写完）：seq 推进，可消费
    writeTocDraft('fp-1', [{ title: '迟到但有效', printedPage: 2, level: 1 }])
    const got = takeTocDraftSince('fp-1', baseline)
    expect(got?.map((e) => e.title)).toEqual(['迟到但有效'])
    expect(readTocDraft()).toBeNull()
  })

  it('世代单调：clear 不回退，upsert 推进', () => {
    clearTocDraft()
    expect(peekTocDraftSeq('fp-1')).toBe(0)
    writeTocDraft('fp-1', [{ title: 'a', printedPage: 1, level: 1 }])
    const s1 = peekTocDraftSeq('fp-1')
    clearTocDraft()
    expect(peekTocDraftSeq('fp-1')).toBe(0)
    writeTocDraft('fp-1', [{ title: 'b', printedPage: 2, level: 1 }])
    const s2 = peekTocDraftSeq('fp-1')
    expect(s2).toBeGreaterThan(s1)
    upsertTocDraftEntry('fp-1', { title: 'c', printedPage: 3, level: 1 })
    expect(peekTocDraftSeq('fp-1')).toBeGreaterThan(s2)
  })

  it('wait 的 minSeq：旧草稿直接超时不等，迟到写入落袋', async () => {
    clearTocDraft()
    writeTocDraft('fp-1', [{ title: '旧轮次', printedPage: 1, level: 1 }])
    const baseline = peekTocDraftSeq('fp-1')
    // 旧草稿在门限内：不等，直接超时，且不消费旧草稿
    const missed = await waitForTocDraft('fp-1', {
      minSeq: baseline,
      deadlineMs: 0,
      now: () => 0,
      sleep: async () => {},
    })
    expect(missed.outcome).toBe('timeout')
    expect(readTocDraft()?.entries).toHaveLength(1)
    // 睡眠中旧超时操作写完：seq 推进，命中
    let now = 0
    const hit = await waitForTocDraft('fp-1', {
      minSeq: baseline,
      deadlineMs: 90000,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms
        writeTocDraft('fp-1', [{ title: '迟到但有效', printedPage: 2, level: 1 }])
      },
    })
    expect(hit.outcome).toBe('hit')
    expect(hit.entries?.map((e) => e.title)).toEqual(['迟到但有效'])
  })

  it('take 指纹一致才给且取即清空，不符保留', () => {
    clearTocDraft()
    expect(takeTocDraft('fp-1')).toBeNull()
    writeTocDraft('fp-1', [{ title: 'A', printedPage: 1, level: 1 }])
    expect(takeTocDraft('other-fp')).toBeNull()
    expect(readTocDraft()?.entries).toHaveLength(1)
    expect(takeTocDraft('fp-1')).toHaveLength(1)
    expect(readTocDraft()).toBeNull()
  })
})
