/**
 * Agent 正文 URL 策略（Streamdown `urlTransform` 用）。
 * 与既有 DOMPurify `ALLOWED_URI_REGEXP` 同向收紧：只放行 http/https、
 * mailto/tel 系与相对路径；图片额外允许 data:image。javascript: 等一律落到 '#'，
 * 调用方在 <a> 点击时再 preventDefault，保证 Electron 下无导航。
 */
export function sanitizeAgentUrl(url: string, key?: string): string {
  const trimmed = url.trim()
  if (!trimmed) return '#'
  if (trimmed.startsWith('#')) return trimmed
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(trimmed)?.[0].toLowerCase()
  if (!scheme) return trimmed
  const protocol = scheme.slice(0, -1)
  if (protocol === 'http' || protocol === 'https' || protocol === 'mailto' ||
    protocol === 'tel' || protocol === 'callto' || protocol === 'sms') {
    return trimmed
  }
  if (key === 'src' && protocol === 'data' && /^data:image\//i.test(trimmed)) {
    return trimmed
  }
  return '#'
}
