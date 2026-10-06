import { describe, expect, it } from 'vitest'
import { assertWebDocHostAllowed, assertWebDocUrlAllowed } from './url-policy'

describe('url-policy SSRF 防护', () => {
  it('放行正常公网文档站', () => {
    expect(() => assertWebDocUrlAllowed('https://react.dev/learn')).not.toThrow()
    expect(() => assertWebDocUrlAllowed('https://v2.cn.vuejs.org/guide/')).not.toThrow()
    expect(() => assertWebDocUrlAllowed('https://e2e.montree.test/fixture')).not.toThrow()
  })

  it('拦截回环与本地主机名', () => {
    for (const raw of [
      'http://localhost/docs',
      'http://LOCALHOST:3000/',
      'http://localhost./x',
      'http://myapp.localhost/y',
      'http://printer.local/z',
    ]) {
      expect(() => assertWebDocUrlAllowed(raw)).toThrow()
    }
  })

  it('拦截 IPv4 私有/回环/链路本地段', () => {
    for (const raw of [
      'http://127.0.0.1/admin',
      'http://10.0.0.5/',
      'http://172.16.4.2/',
      'http://172.31.255.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/',
    ]) {
      expect(() => assertWebDocUrlAllowed(raw)).toThrow()
    }
    // 边界：172.15/172.32 为公网，不应误伤
    expect(() => assertWebDocHostAllowed('172.15.0.1')).not.toThrow()
    expect(() => assertWebDocHostAllowed('172.32.0.1')).not.toThrow()
  })

  it('拦截十进制/十六进制/八进制/简写 IP 变体', () => {
    // 127.0.0.1 的各类写法
    for (const host of ['2130706433', '0x7f000001', '017700000001', '0x7f.0.0.1', '0177.0.0.1', '127.1']) {
      expect(() => assertWebDocHostAllowed(host)).toThrow()
    }
  })

  it('拦截 IPv6 回环/未指定/链路本地/映射地址', () => {
    for (const host of ['[::1]', '[::]', '[fe80::1]', '[fc00::1]', '[ff02::1]', '[::ffff:127.0.0.1]']) {
      expect(() => assertWebDocHostAllowed(host)).toThrow()
    }
    expect(() => assertWebDocHostAllowed('[2001:db8::1]')).not.toThrow()
  })
})
