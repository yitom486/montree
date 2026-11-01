import { describe, expect, it } from 'vitest'
import { HTML_PREVIEW_FRAME_NAME_PREFIX } from '../../contracts/html-preview'
import { createHtmlPreviewFrameGuard, type HtmlPreviewFrame } from './html-preview-navigation-guard'

const token = 'a'.repeat(32)
const url = 'montree-html://workspace/page.html?t=' + token
function frame(overrides: Partial<HtmlPreviewFrame> = {}): HtmlPreviewFrame {
  return { frameTreeNodeId: 2, name: HTML_PREVIEW_FRAME_NAME_PREFIX + token, ancestorIds: [1], detached: false, ...overrides }
}
function setup() {
  return createHtmlPreviewFrameGuard({ mainFrameId: 1, isRegisteredUrl: (t, target) => t === token && target.startsWith(url), listLiveFrameIds: () => [1, 2, 3] })
}
describe('HTML preview navigation guard', () => {
  it('宿主可以设置预览 src，页面自己不能导航或重载', () => {
    const guard = setup()
    guard.handleFrameCreated(frame())
    expect(guard.shouldBlockNavigation(frame(), url, 1)).toBe(false)
    expect(guard.shouldBlockNavigation(frame(), url + '&v=2', null)).toBe(false)
    expect(guard.shouldBlockNavigation(frame(), url, 2)).toBe(true)
    expect(guard.shouldBlockNavigation(frame(), 'data:text/html,other', 2)).toBe(true)
    expect(guard.shouldBlockNavigation(frame(), 'about:blank', 2)).toBe(true)
    expect(guard.shouldBlockNavigation(frame(), 'montree-html://other/else.html', 1)).toBe(true)
  })
  it('更改 window.name 后仍保护原 frame，后代 frame 也不能导航', () => {
    const guard = setup()
    guard.handleFrameCreated(frame())
    expect(guard.shouldBlockNavigation(frame({ name: 'renamed' }), 'https://example.com', 2)).toBe(true)
    expect(guard.shouldBlockNavigation(frame({ frameTreeNodeId: 3, name: '', ancestorIds: [2, 1] }), 'https://example.com', 3)).toBe(true)
  })
  it('不拦截其他阅读器或主窗口，也不按后代伪造的名称授权', () => {
    const guard = setup()
    expect(guard.shouldBlockNavigation(frame({ name: '' }), 'blob:file:///reader', 1)).toBe(false)
    const forged = frame({ frameTreeNodeId: 3, ancestorIds: [9, 1] })
    guard.handleFrameCreated(forged)
    expect(guard.isPreviewFrame(forged)).toBe(false)
    expect(guard.isPreviewFrame(null)).toBe(false)
  })
})
