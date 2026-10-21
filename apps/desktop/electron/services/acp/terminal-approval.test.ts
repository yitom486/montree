import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { TerminalApprovalPolicy, TERMINAL_OPTION_ALLOW_ONCE, TERMINAL_OPTION_REJECT, TERMINAL_OPTION_TRUST_WORKSPACE, formatCommandLine } from './terminal-approval'

async function setup(answer: (n: number) => any) {
  const dir = await mkdtemp(join(tmpdir(), 'term-approval-'))
  let n = 0
  const requestPermission = vi.fn(async () => answer(n++))
  const policy = new TerminalApprovalPolicy({ trustFile: join(dir, 'trust.json'), auditFile: join(dir, 'audit.jsonl'), requestPermission })
  const audit = async () => (await readFile(join(dir, 'audit.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
  return { policy, requestPermission, audit, dir }
}
const req = { sessionId: 's', command: 'git', args: ['status', '--short'], workspaceRoot: '/ws/a' }

describe('TerminalApprovalPolicy', () => {
  it('未信任：审批卡带命令行，允许一次后下次仍要审批', async () => {
    const { policy, requestPermission, audit } = await setup(() => ({ outcome: 'selected', optionId: TERMINAL_OPTION_ALLOW_ONCE }))
    expect(await policy.authorize(req)).toEqual({ allowed: true, decision: 'allowed-once' })
    await policy.authorize(req)
    expect(requestPermission).toHaveBeenCalledTimes(2)
    const params = (requestPermission.mock.calls[0] as unknown[])[1] as any
    expect(params.toolCall.title).toBe('运行命令：git status --short')
    expect(params.options.map((o: any) => o.kind)).toEqual(['allow_once', 'allow_always', 'reject_once'])
    expect((await audit()).map((e) => e.decision)).toEqual(['allowed-once', 'allowed-once'])
  })
  it('信任此工作区后免审（落盘共享），其他工作区仍审批', async () => {
    const { policy, requestPermission, audit } = await setup(() => ({ outcome: 'selected', optionId: TERMINAL_OPTION_TRUST_WORKSPACE }))
    await policy.authorize(req)
    expect(await policy.authorize(req)).toEqual({ allowed: true, decision: 'trusted' })
    expect(requestPermission).toHaveBeenCalledTimes(1)
    await policy.authorize({ ...req, workspaceRoot: '/ws/b' })
    expect(requestPermission).toHaveBeenCalledTimes(2)
    expect((await audit()).map((e) => e.decision)).toEqual(['trusted-now', 'trusted', 'trusted-now'])
  })
  it('拒绝与取消都不放行', async () => {
    const r = await setup(() => ({ outcome: 'selected', optionId: TERMINAL_OPTION_REJECT }))
    expect(await r.policy.authorize(req)).toEqual({ allowed: false, decision: 'rejected' })
    const c = await setup(() => ({ outcome: 'cancelled' }))
    expect(await c.policy.authorize(req)).toEqual({ allowed: false, decision: 'cancelled' })
  })
  it('formatCommandLine 对含空白/引号参数加引号', () => {
    expect(formatCommandLine('echo', ['a b', 'c'])).toBe('echo "a b" c')
  })
})
