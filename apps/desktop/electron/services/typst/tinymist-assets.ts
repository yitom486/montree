/** Pinned upstream Tinymist archives (shared by prepare-typst, packaging checks and on-demand download). */
export const TINYMIST_VERSION = '0.15.8'
export const TINYMIST_LICENSE_SHA256 = 'a9f29769fd3a7ee2976e6e161a93e16461fa305c088c4806242e50ec8ef86bce'
export const TINYMIST_RELEASE_BASE = `https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}`

export const TINYMIST_ASSETS = {
  'win32-x64': { name: 'tinymist-x86_64-pc-windows-msvc.zip', sha256: 'b36c3e2926b2fe870e377b27aeebcb6265dd6a19fdca148a9a3ac4fdf57ee8a5', executable: 'tinymist.exe' },
  'darwin-arm64': { name: 'tinymist-aarch64-apple-darwin.tar.gz', sha256: 'c3e8673fe4b7d8d21ad6d90e3c0684317191e1350758f7eaa02b5bde84339885', executable: 'tinymist' },
  'linux-x64': { name: 'tinymist-x86_64-unknown-linux-gnu.tar.gz', sha256: '2428932e8d8b593ebc1ac4eed41fb9d3584166e1044bbcdef740b7296c348295', executable: 'tinymist' },
} as const

export type TinymistAsset = (typeof TINYMIST_ASSETS)[keyof typeof TINYMIST_ASSETS]

export function getTypstAsset(platform: string, arch: string): TinymistAsset {
  const key = `${platform}-${arch}` as keyof typeof TINYMIST_ASSETS
  const asset = TINYMIST_ASSETS[key]
  if (!asset) throw new Error(`未提供 Tinymist ${platform}/${arch} 的已验证构建资源`)
  return asset
}

export function isSafeArchiveMember(name: string): boolean {
  return !!name && !name.startsWith('/') && !name.includes('\\') && !name.includes(':') && !name.split('/').includes('..')
}
