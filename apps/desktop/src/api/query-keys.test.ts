import { describe, expect, it } from 'vitest'
import { makeDocumentRef } from '@yitom/contracts'
import { queryKeys } from './query-keys'

describe('query-keys（工作区身份隔离）', () => {
  it('workspaceOf 按身份隔离；历史 workspace 槽保留', () => {
    expect(queryKeys.workspace).toEqual(['workspace'])
    expect(queryKeys.workspaceOf('local')).toEqual(['workspace', 'local'])
    expect(queryKeys.workspaceOf('wsl:Ubuntu:/home/u/blog')).toEqual([
      'workspace',
      'wsl:Ubuntu:/home/u/blog',
    ])
  })

  it('同相对路径在不同工作区是不同 key（T7）', () => {
    const a = queryKeys.readBinary('C:\\a\\x.pdf', 'local')
    const b = queryKeys.readBinary('C:\\a\\x.pdf', 'wsl:Ubuntu:/home/u/blog')
    expect(a).not.toEqual(b)
    expect(queryKeys.gitStatus('C:\\a', 'local')).toEqual(['git-status', 'local', 'C:\\a'])
  })

  it('缺省 workspaceId 回落 local（既有单参调用零改动）', () => {
    expect(queryKeys.readingMarks('C:\\a\\x.md')).toEqual(['reading-marks', 'local', 'C:\\a\\x.md'])
    expect(queryKeys.quizSessions('C:\\a\\x.md')).toEqual(['quiz-sessions', 'local', 'C:\\a\\x.md'])
  })

  it('documentKey 复用 contracts 文档键规则', () => {
    expect(queryKeys.documentKey(makeDocumentRef('local', 'a.md'))).toEqual(['document', 'a.md'])
    expect(queryKeys.documentKey(makeDocumentRef('ws-b', 'a.md'))).toEqual([
      'document',
      'ws-b::a.md',
    ])
  })

  it('B3：diff/分支/检索分页 key 含工作区身份（T7 防串）', () => {
    expect(queryKeys.gitDiff('C:\\a', 'x.md', false, 'local')).toEqual([
      'git-diff',
      'local',
      'C:\\a',
      'x.md',
      false,
    ])
    expect(queryKeys.gitDiff('C:\\a')).not.toEqual(queryKeys.gitDiff('C:\\a', undefined, undefined, 'ws-b'))
    expect(queryKeys.gitBranches('C:\\a', 'local')).toEqual(['git-branches', 'local', 'C:\\a'])
    expect(queryKeys.workspaceSearch('ws-b', '王道计', 0)).toEqual([
      'workspace-search',
      'ws-b',
      '王道计',
      0,
    ])
  })
})
