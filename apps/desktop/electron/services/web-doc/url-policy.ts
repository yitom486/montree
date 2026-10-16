const BLOCKED_PROTOCOLS = new Set(['file:', 'javascript:', 'data:', 'blob:'])

/** 本地/保留主机名（大小写不敏感，末尾点兼容） */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain'])

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local']

/** 将 IPv4 字面量（含十进制/八进制/十六进制、1～4 段简写）转为 32 位整数；非字面量返回 null */
function parseIPv4Literal(host: string): number | null {
  const parsePart = (part: string): number | null => {
    if (/^0x[0-9a-f]+$/i.test(part)) {
      const value = Number.parseInt(part, 16)
      return Number.isSafeInteger(value) ? value : null
    }
    if (/^0[0-7]+$/.test(part) && part.length > 1) {
      const value = Number.parseInt(part, 8)
      return Number.isSafeInteger(value) ? value : null
    }
    if (!/^\d+$/.test(part)) return null
    const value = Number.parseInt(part, 10)
    return Number.isSafeInteger(value) ? value : null
  }

  // 纯数字单段：十进制 / 0x 十六进制 / 前导 0 八进制
  if (/^[0-9a-fx]+$/i.test(host) && !host.includes('.') && !host.includes(':')) {
    if (/^0x[0-9a-f]+$/i.test(host)) {
      const value = Number.parseInt(host, 16)
      return value >= 0 && value <= 0xffffffff ? value >>> 0 : null
    }
    if (/^0[0-7]+$/.test(host) && host.length > 1) {
      const value = Number.parseInt(host, 8)
      return value >= 0 && value <= 0xffffffff ? value >>> 0 : null
    }
    if (/^\d+$/.test(host)) {
      const value = Number.parseInt(host, 10)
      return value >= 0 && value <= 0xffffffff ? value >>> 0 : null
    }
    return null
  }

  if (!/^[0-9a-fx.]+$/i.test(host) || !host.includes('.')) return null
  const rawParts = host.split('.')
  if (rawParts.length < 2 || rawParts.length > 4) return null
  const parts: number[] = []
  for (const raw of rawParts) {
    if (!raw) return null
    const value = parsePart(raw)
    if (value === null) return null
    parts.push(value)
  }

  // inet_aton 语义：n 段时末段占 8*(5-n) 位，其余各 8 位
  const lastBits = 8 * (5 - parts.length)
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i]! > 0xff) return null
  }
  if (parts[parts.length - 1]! >= 2 ** lastBits) return null
  let ip = 0
  for (let i = 0; i < parts.length - 1; i++) {
    ip = ip * 256 + parts[i]!
  }
  ip = ip * 2 ** lastBits + parts[parts.length - 1]!
  return ip >>> 0
}

function isBlockedIPv4(ip: number): boolean {
  const octet = (n: number) => (ip >>> (8 * (3 - n))) & 0xff
  const o0 = octet(0)
  const o1 = octet(1)
  // 回环 127/8、未指定 0/8、私有 10/8・172.16/12・192.168/16、链路本地 169.254/16、
  // 组播 224/4、保留 240/4、文档/测试网段
  if (o0 === 127 || o0 === 0) return true
  if (o0 === 10) return true
  if (o0 === 172 && o1 >= 16 && o1 <= 31) return true
  if (o0 === 192 && o1 === 168) return true
  if (o0 === 169 && o1 === 254) return true
  if (o0 >= 224) return true
  if (o0 === 192 && (o1 === 0 || o1 === 2)) return true
  if (o0 === 198 && (o1 === 18 || o1 === 19 || o1 === 51 || o1 === 100)) return true
  if (o0 === 203 && o1 === 0 && ((ip >>> 8) & 0xff) === 113) return true
  if (o0 === 100 && o1 >= 64 && o1 <= 127) return true
  return false
}

/** IPv6：回环/未指定/链路本地/唯一本地/组播/IPv4 映射（映射内嵌 v4 再判） */
function isBlockedIPv6(host: string): boolean {
  let inner = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  inner = inner.toLowerCase()
  if (!inner.includes(':')) return false
  if (inner === '::1' || inner === '::') return true
  if (inner.startsWith('fe80:') || inner.startsWith('fc') || inner.startsWith('fd') || inner.startsWith('ff')) {
    return true
  }
  const mapped = inner.match(/^::ffff:(.+)$/)
  if (mapped?.[1]) {
    const embedded = parseIPv4Literal(mapped[1])
    if (embedded !== null) return isBlockedIPv4(embedded)
    return true
  }
  return false
}

/** SSRF 防护：禁止抓取本地与内网字面量地址（含各类进制/简写变体） */
export function assertWebDocHostAllowed(hostname: string): void {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host) throw new Error('URL 缺少主机名')
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error('不允许访问本地地址')
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error('不允许访问本地地址')
  }

  const ipv4 = parseIPv4Literal(host)
  if (ipv4 !== null) {
    if (isBlockedIPv4(ipv4)) throw new Error('不允许访问内网或保留地址')
    return
  }
  if (isBlockedIPv6(hostname.trim())) {
    throw new Error('不允许访问内网或保留地址')
  }
}

/** 仅允许 http(s) 在线文档 URL */
export function getWebDocLoopbackOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (host === 'localhost' || host === '[::1]' || host === '127.0.0.1') return url.origin
  } catch { /* 非 URL 交给正式校验报告 */ }
  return undefined
}

export function assertWebDocUrlAllowed(raw: string, localOrigin?: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new Error('URL 格式无效')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('仅支持 http / https 链接')
  }
  if (BLOCKED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('不支持的 URL 协议')
  }
  if (!parsed.hostname) {
    throw new Error('URL 缺少主机名')
  }
  if (parsed.username || parsed.password) throw new Error('文档链接不支持内嵌用户名或密码')
  if (!localOrigin || parsed.origin !== localOrigin || getWebDocLoopbackOrigin(raw) !== localOrigin) {
    assertWebDocHostAllowed(parsed.hostname)
  }

  return parsed
}

export function normalizeWebDocUrl(raw: string, localOrigin?: string): string {
  const url = assertWebDocUrlAllowed(raw, localOrigin)
  url.hash = ''
  return url.toString()
}
