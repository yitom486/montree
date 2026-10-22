export { TINYMIST_VERSION, TINYMIST_LICENSE_SHA256, TINYMIST_ASSETS, TINYMIST_RELEASE_BASE, getTypstAsset, isSafeArchiveMember } from '../apps/desktop/electron/services/typst/tinymist-assets'

// Git on Windows may check out or archive text with CRLF; shipped bytes stay LF.
export function normalizeTinymistLicense(source: string): string {
  return source.replace(/\r\n/g, '\n')
}
