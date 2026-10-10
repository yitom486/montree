// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { collectDomImages, collectMarkdownImages, readReaderVisualContext } from './reader-visual-context'
import { readCurrentDocumentText, registerReaderContent } from './reader-content-registry'

describe('reader visual context', () => {
  it('Markdown 内联、引用式图片解析相对路径，代码块里的示例不算图片', () => {
    const images = collectMarkdownImages('![架构](./images/arch.png)\n![图二][diagram]\n\n[diagram]: https://example.com/plot.svg\n\n```md\n![示例](fake.png)\n```', 'D:\\books\\Paper Notes\\article.md')
    expect(images).toHaveLength(2)
    expect(images[0]).toMatchObject({ alt: '架构', src: 'file:///D:/books/Paper%20Notes/images/arch.png' })
    expect(images[1].src).toBe('https://example.com/plot.svg')
  })

  it('DOM 图片带图注与加载状态，视口范围排除屏幕外和隐藏图片', () => {
    document.body.innerHTML = '<figure><img src="https://example.com/visible.png" alt="Architecture"><figcaption>Figure 1</figcaption></figure><img src="https://example.com/offscreen.png"><img style="display:none" src="https://example.com/hidden.png">'
    const elements = document.querySelectorAll('img')
    elements.forEach((image, index) => {
      image.getBoundingClientRect = () => ({ x: 0, y: index === 1 ? 5000 : 30, left: 0, right: 300, top: index === 1 ? 5000 : 30, bottom: index === 1 ? 5200 : 230, width: 300, height: 200, toJSON: () => ({}) })
    })
    expect(collectDomImages([document], 'current')).toHaveLength(3)
    const visible = collectDomImages([document], 'viewport')
    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({ alt: 'Architecture', caption: 'Figure 1', visible: true, loaded: false })
    document.body.innerHTML = ''
  })

  it('正文附带图片提示，列表最多20项且明确截断', async () => {
    const dispose = registerReaderContent({ filePath: '/books/a.md', getCurrentText: () => '正文',
      getImages: () => Array.from({ length: 25 }, (_, i) => ({ id: `image-${i}`, kind: 'image' as const, src: `https://example.com/${i}.png` })) })
    try {
      const text = await readCurrentDocumentText()
      expect(text).toContain('文档图片：25 项')
      expect(text).toContain('https://example.com/0.png')
      const result = await readReaderVisualContext()
      expect(result.total).toBe(25)
      expect(result.images).toHaveLength(20)
      expect(result.truncated).toBe(true)
    } finally { dispose() }
  })

  it('图片信息异步获取期间切换文档会拒绝返回旧文档', async () => {
    let release!: (images: []) => void
    const dispose = registerReaderContent({ filePath: '/a', getCurrentText: () => 'a', getImages: () => new Promise((resolve) => { release = resolve }) })
    const pending = readReaderVisualContext()
    const disposeNext = registerReaderContent({ filePath: '/b', getCurrentText: () => 'b' })
    release([])
    await expect(pending).rejects.toThrow('文档刚刚切换')
    disposeNext(); dispose()
  })

  it('不能筛选视口的图片列表明确标为当前单元，避免误称全部可见', async () => {
    const dispose = registerReaderContent({ filePath: '/a.md', imageScope: 'current',
      getCurrentText: () => '', getImages: () => [{ id: 'image-1', kind: 'image' }] })
    try {
      const result = await readReaderVisualContext('viewport')
      expect(result.scope).toBe('current')
      expect(result.note).toContain('无法精确筛选视口')
      expect(result.images[0].visible).toBeUndefined()
    } finally { dispose() }
  })
})
