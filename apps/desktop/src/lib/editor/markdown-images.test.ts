import { describe, expect, it } from 'vitest'
import {
  buildImageReplacements,
  extractLocalImageRefsFromHtml,
  isExternalImageSrc,
  parseMarkdownImageSrc,
  replaceImageSrcInHtml,
  resolveLocalImagePath,
} from './markdown-images'

describe('markdown-images', () => {
  it('HTML 图片属性保留空格，并解码 Markdown 解析器编码的资源路径', () => {
    expect(resolveLocalImagePath('D:\\book\\note.md', './my image.png', true)).toBe('D:\\book\\my image.png')
    expect(resolveLocalImagePath('D:\\book\\note.md', './my%20image.png', true)).toBe('D:\\book\\my image.png')
    expect(resolveLocalImagePath('D:\\book\\note.md', 'https://example.com/a%20b.png', true)).toBeNull()
  })
  it('识别外部图片地址', () => {
    expect(isExternalImageSrc('https://example.com/a.png')).toBe(true)
    expect(isExternalImageSrc('data:image/png;base64,abc')).toBe(true)
    expect(isExternalImageSrc('./assets/a.png')).toBe(false)
    expect(isExternalImageSrc('../images/b.jpg')).toBe(false)
  })

  it('解析 Markdown 图片 src（忽略 title）', () => {
    expect(parseMarkdownImageSrc('./photo.png "示例图片"')).toBe('./photo.png')
    expect(parseMarkdownImageSrc('<./photo.png>')).toBe('./photo.png')
  })

  it('将相对路径解析为基于 Markdown 文件的绝对路径', () => {
    const markdownPath = 'D:\\docs\\notes\\readme.md'

    expect(resolveLocalImagePath(markdownPath, './images/pic.png')).toBe(
      'D:\\docs\\notes\\images\\pic.png',
    )
    expect(resolveLocalImagePath(markdownPath, '../cover.jpg')).toBe('D:\\docs\\cover.jpg')
  })

  it('在 Unix 风格路径下解析相对图片', () => {
    const markdownPath = '/home/user/docs/readme.md'

    expect(resolveLocalImagePath(markdownPath, './images/pic.png')).toBe(
      '/home/user/docs/images/pic.png',
    )
    expect(resolveLocalImagePath(markdownPath, '/var/shared/logo.png')).toBe(
      '/var/shared/logo.png',
    )
  })

  it('无文件路径或远程地址时不解析', () => {
    expect(resolveLocalImagePath(undefined, './a.png')).toBeNull()
    expect(resolveLocalImagePath('/tmp/readme.md', 'https://x.test/a.png')).toBeNull()
  })

  it('从 HTML 中提取需加载的本地图片引用', () => {
    const html =
      '<p><img src="./a.png" alt="a"><img src="https://cdn.test/b.png" alt="b"><img src="./a.png" alt="dup"></p>'

    expect(extractLocalImageRefsFromHtml(html, 'C:\\work\\doc.md')).toEqual([
      { src: './a.png', absolutePath: 'C:\\work\\a.png' },
    ])
  })

  it('替换 HTML 中的图片 src', () => {
    const html = '<img src="./a.png" alt="a">'
    const next = replaceImageSrcInHtml(html, {
      './a.png': 'data:image/png;base64,QUJD',
    })

    expect(next).toContain('src="data:image/png;base64,QUJD"')
    expect(next).not.toContain('./a.png')
  })

  it('根据绝对路径映射构建替换表', () => {
    const refs = [{ src: './a.png', absolutePath: 'C:\\work\\a.png' }]
    const replacements = buildImageReplacements(refs, {
      'C:\\work\\a.png': 'data:image/png;base64,QUJD',
    })

    expect(replacements).toEqual({
      './a.png': 'data:image/png;base64,QUJD',
    })
  })
})
