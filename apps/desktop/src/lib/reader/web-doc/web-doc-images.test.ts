// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ok, err } from '@yitom/contracts'
import { webDocApi } from '@/api/web-doc-api'
import { bindWebDocImageRecovery } from './web-doc-images'
vi.mock('@/api/web-doc-api', () => ({ webDocApi: { fetchImage: vi.fn() } }))
afterEach(() => { vi.clearAllMocks(); document.body.replaceChildren() })
const url = 'https://claude.dev/media/overview.png'
const dataUrl = 'data:image/png;base64,iVBORw=='
function image() {
  document.body.innerHTML = `<picture><source srcset="${url} 2x"><img src="${url}" srcset="${url} 1x" alt="Architecture"></picture>`
  const node = document.querySelector('img')!
  Object.defineProperty(node, 'complete', { configurable: true, value: true })
  return node
}
describe('reader image recovery', () => {
  it('restores images that failed before iframe load and removes rejected picture/srcset candidates', async () => {
    const node = image()
    vi.mocked(webDocApi.fetchImage).mockResolvedValue(ok({ url, dataUrl }))
    const cleanup = bindWebDocImageRecovery(document, 'https://claude.dev/blog/post/')
    await vi.waitFor(() => expect(node.src).toBe(dataUrl))
    expect(node.getAttribute('alt')).toBe('Architecture')
    expect(node.getAttribute('data-montree-image-source')).toBe(url)
    expect(node.hasAttribute('srcset')).toBe(false)
    expect(document.querySelector('source')!.hasAttribute('srcset')).toBe(false)
    node.dispatchEvent(new Event('error'))
    expect(webDocApi.fetchImage).toHaveBeenCalledOnce()
    cleanup()
  })
  it('does not rewrite the new page after navigation while a resource read is pending', async () => {
    const node = image()
    let resolve!: (value: ReturnType<typeof ok<{ url: string; dataUrl: string }>>) => void
    vi.mocked(webDocApi.fetchImage).mockReturnValue(new Promise(done => { resolve = done }))
    const cleanup = bindWebDocImageRecovery(document, 'https://claude.dev/')
    cleanup()
    resolve(ok({ url, dataUrl }))
    await new Promise(done => setTimeout(done, 0))
    expect(node.src).toBe(url)
  })
  it('leaves alt text on failure and never loops resource requests', async () => {
    const node = image()
    vi.mocked(webDocApi.fetchImage).mockResolvedValue(err({ code: 'FILE_READ_ERROR', message: 'unavailable' }))
    const cleanup = bindWebDocImageRecovery(document, 'https://claude.dev/')
    await new Promise(done => setTimeout(done, 0))
    node.dispatchEvent(new Event('error'))
    expect(webDocApi.fetchImage).toHaveBeenCalledOnce()
    expect(node.alt).toBe('Architecture')
    expect(node.src).toBe(url)
    cleanup()
  })
})
