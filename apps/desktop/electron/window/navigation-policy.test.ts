import { describe, expect, it } from 'vitest'
import { decideNavigation, isExternalOpenable } from './navigation-policy'

const entry = 'file:///opt/Montree/resources/app.asar/out/renderer/index.html'

describe('decideNavigation', () => {
  it('应用入口与 dev server 允许', () => {
    expect(decideNavigation(entry + '#/x', entry)).toBe('allow')
    expect(decideNavigation('http://localhost:5173/a', entry, 'http://localhost:5173')).toBe('allow')
  })
  it('其他本地文件不进应用窗口', () => {
    expect(decideNavigation('file:///home/u/evil.html', entry)).toBe('block')
  })
  it('http(s)/mailto 交系统，其他协议丢弃', () => {
    expect(decideNavigation('https://react.dev', entry)).toBe('external')
    expect(decideNavigation('mailto:a@b.c', entry)).toBe('external')
    expect(decideNavigation('smb://host/share', entry)).toBe('block')
    expect(decideNavigation('javascript:alert(1)', entry)).toBe('block')
    expect(decideNavigation('not a url', entry)).toBe('block')
  })
  it('isExternalOpenable', () => {
    expect(isExternalOpenable('https://x.y')).toBe(true)
    expect(isExternalOpenable('vscode://x')).toBe(false)
  })
})
