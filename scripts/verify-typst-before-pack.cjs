const { createHash } = require('node:crypto')
const { readFileSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

function verifyTypstResource(resourceDir, platform, arch) {
  let manifest
  try { manifest = JSON.parse(readFileSync(join(resourceDir, 'manifest.json'), 'utf8')) }
  catch { throw new Error('缺少 Typst 运行时清单；请先执行 bun run prepare:typst') }
  const executable = platform === 'win32' ? 'tinymist.exe' : 'tinymist'
  if (manifest.version !== '0.15.8' || manifest.platform !== platform || manifest.arch !== arch || manifest.executable !== executable) {
    throw new Error(`Typst 运行时与打包目标 ${platform}/${arch} 不匹配；请在对应平台执行 prepare:typst`)
  }
  const file = join(resourceDir, executable)
  const bytes = readFileSync(file)
  if (bytes.length !== manifest.size || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) {
    throw new Error('Typst 运行时校验失败；请重新执行 prepare:typst')
  }
  if (bytes.length > 180 * 1024 * 1024) throw new Error('Typst 运行时超过 180 MiB 资源预算')
  if (platform !== 'win32' && (statSync(file).mode & 0o111) === 0) throw new Error('Typst 运行时缺少执行权限')
  const license = readFileSync(join(resourceDir, 'LICENSE'))
  if (createHash('sha256').update(license).digest('hex') !== 'a9f29769fd3a7ee2976e6e161a93e16461fa305c088c4806242e50ec8ef86bce') throw new Error('Typst 许可证缺失或校验失败')
  return manifest
}

/** Tinymist 改为首次使用时下载：打包只校验随包许可证。 */
function verifyTypstLicense(resourceDir) {
  let license
  try { license = readFileSync(join(resourceDir, 'LICENSE')) }
  catch { throw new Error('缺少 Typst 许可证；请先执行 bun run prepare:typst') }
  if (createHash('sha256').update(license).digest('hex') !== 'a9f29769fd3a7ee2976e6e161a93e16461fa305c088c4806242e50ec8ef86bce') throw new Error('Typst 许可证缺失或校验失败')
}

module.exports = async function beforePack(context) {
  verifyTypstLicense(resolve(context.packager.projectDir, 'apps/desktop/resources/typst'))
}
module.exports.verifyTypstResource = verifyTypstResource
module.exports.verifyTypstLicense = verifyTypstLicense
