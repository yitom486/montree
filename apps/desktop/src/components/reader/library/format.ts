/** 把 HN 的 Unix 秒时间转成列表里读得懂的相对时间 */
export function formatRelativeTime(unixSeconds: number, now = Date.now()): string {
  if (!unixSeconds) return ''
  const diffMs = Math.max(0, now - unixSeconds * 1000)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const date = new Date(unixSeconds * 1000)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 「更新于 14:05」里的钟点 */
export function formatClock(timestampMs: number): string {
  const date = new Date(timestampMs)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function getFileName(fullPath: string): string {
  const parts = fullPath.split(/[/\\]/)
  return parts[parts.length - 1] || fullPath
}

export function getFileExt(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts[parts.length - 1]!.toUpperCase() : 'FILE'
}

export function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '')
  } catch {
    return rawUrl
  }
}
