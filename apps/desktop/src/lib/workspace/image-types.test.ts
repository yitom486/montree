import { describe, expect, it } from 'vitest'
import {
  getImageFormatLabel,
  getImageMimeType,
  isImagePath,
} from './image-types'

describe('image-types', () => {
  it('识别常见位图与 SVG/AVIF', () => {
    for (const name of [
      'cover.png',
      'photo.JPG',
      'anim.gif',
      'logo.svg',
      'next.webp',
      'scan.avif',
      'icon.ico',
      'page.tif',
    ]) {
      expect(isImagePath(name), name).toBe(true)
    }
    expect(isImagePath('notes.md')).toBe(false)
    expect(isImagePath(undefined)).toBe(false)
  })

  it('返回 MIME 与显示标签', () => {
    expect(getImageMimeType('a.svg')).toBe('image/svg+xml')
    expect(getImageMimeType('a.jpeg')).toBe('image/jpeg')
    expect(getImageMimeType('a.unknown')).toBeUndefined()
    expect(getImageFormatLabel('a.webp')).toBe('WEBP')
  })
})
