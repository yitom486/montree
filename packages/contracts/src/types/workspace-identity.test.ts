import { describe, expect, it } from 'vitest'
import {
  LOCAL_WORKSPACE_ID,
  documentRefKey,
  isLocalWorkspaceId,
  isSameDocumentRef,
  makeDocumentRef,
  makeLocalWorkspaceDescriptor,
  makeWslWorkspaceDescriptor,
  normalizeWorkspaceRelativePath,
  parseDocumentRefKey,
  scopeDocumentKey,
} from './workspace-identity'

describe('workspace-identity（A1 本机宿主身份）', () => {
  it('本机描述符 id 固定为 local，target 置空', () => {
    const descriptor = makeLocalWorkspaceDescriptor('C:\\notes\\blog')
    expect(descriptor.id).toBe(LOCAL_WORKSPACE_ID)
    expect(descriptor.kind).toBe('local')
    expect(descriptor.target).toBe('')
    expect(descriptor.rootLabel).toBe('C:\\notes\\blog')
    expect(descriptor.displayName).toBe('blog')
  })

  it('相对路径归一化为 POSIX（去 ./、前导斜杠与反斜杠）', () => {
    expect(normalizeWorkspaceRelativePath('.\\posts\\a.md')).toBe('posts/a.md')
    expect(normalizeWorkspaceRelativePath('//posts//a.md')).toBe('posts/a.md')
    expect(normalizeWorkspaceRelativePath('./a.md')).toBe('a.md')
    expect(normalizeWorkspaceRelativePath('')).toBe('')
  })

  it('local 文档键沿用裸路径（回归零变化），远端加命名空间', () => {
    expect(documentRefKey(makeDocumentRef('local', 'posts/a.md'))).toBe('posts/a.md')
    expect(documentRefKey(makeDocumentRef('', 'posts/a.md'))).toBe('posts/a.md')
    expect(documentRefKey(makeDocumentRef('wsl:Ubuntu:/home/u/blog', 'posts/a.md'))).toBe(
      'wsl:Ubuntu:/home/u/blog::posts/a.md',
    )
  })

  it('parseDocumentRefKey 与 documentRefKey 互逆；空串返回 null', () => {
    expect(parseDocumentRefKey('')).toBeNull()
    expect(parseDocumentRefKey('posts/a.md')).toEqual({
      workspaceId: 'local',
      relativePath: 'posts/a.md',
    })
    const ref = makeDocumentRef('wsl:Ubuntu:/home/u/blog', 'posts/a.md')
    expect(parseDocumentRefKey(documentRefKey(ref))).toEqual(ref)
  })

  it('isSameDocumentRef 按 workspaceId + 路径判定（T7 同名隔离）', () => {
    const a = makeDocumentRef('ws-a', 'a.md')
    const b = makeDocumentRef('ws-b', 'a.md')
    expect(isSameDocumentRef(a, { ...a })).toBe(true)
    expect(isSameDocumentRef(a, b)).toBe(false)
  })

  it('scopeDocumentKey：local 沿用裸键，其余加前缀', () => {
    expect(scopeDocumentKey('C:\\a\\b.md', 'local')).toBe('C:\\a\\b.md')
    expect(scopeDocumentKey('C:\\a\\b.md')).toBe('C:\\a\\b.md')
    expect(scopeDocumentKey('__untitled__', 'wsl:x')).toBe('wsl:x::__untitled__')
    expect(isLocalWorkspaceId('')).toBe(true)
    expect(isLocalWorkspaceId('wsl:x')).toBe(false)
  })

  it('makeWslWorkspaceDescriptor：id 形如 wsl:发行版:远端根（P1 会话键）', () => {
    const descriptor = makeWslWorkspaceDescriptor('Ubuntu', '/home/u/blog/')
    expect(descriptor).toEqual({
      id: 'wsl:Ubuntu:/home/u/blog',
      kind: 'wsl',
      target: 'Ubuntu',
      rootLabel: '/home/u/blog',
      displayName: 'blog',
    })
    expect(makeWslWorkspaceDescriptor('Ubuntu', '/').rootLabel).toBe('/')
  })
})
