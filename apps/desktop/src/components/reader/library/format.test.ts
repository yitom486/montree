import { describe, expect, it } from 'vitest'
import { extractDomain, formatClock, formatRelativeTime, getFileExt, getFileName } from './format'

const NOW = new Date('2026-11-04T12:00:00+08:00').getTime()

function secondsAgo(minutes: number): number {
  return Math.floor((NOW - minutes * 60_000) / 1000)
}

describe('library format', () => {
  it('相对时间覆盖分钟/小时/天与远期日期', () => {
    expect(formatRelativeTime(secondsAgo(0), NOW)).toBe('刚刚')
    expect(formatRelativeTime(secondsAgo(12), NOW)).toBe('12 分钟前')
    expect(formatRelativeTime(secondsAgo(60 * 5), NOW)).toBe('5 小时前')
    expect(formatRelativeTime(secondsAgo(60 * 24 * 3), NOW)).toBe('3 天前')
    expect(formatRelativeTime(0, NOW)).toBe('')
  })

  it('钟点补零', () => {
    expect(formatClock(new Date('2026-11-04T09:05:00').getTime())).toBe('09:05')
  })

  it('文件名与扩展名兼容 Windows 路径', () => {
    expect(getFileName('D:\\Books\\SICP.pdf')).toBe('SICP.pdf')
    expect(getFileExt('SICP.pdf')).toBe('PDF')
    expect(getFileExt('README')).toBe('FILE')
  })

  it('域名去掉 www', () => {
    expect(extractDomain('https://www.example.com/a')).toBe('example.com')
    expect(extractDomain('nonsense')).toBe('nonsense')
  })
})
