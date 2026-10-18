import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Local integration without publishing. Tarballs exclude workspace node_modules and avoid
// Windows directory-copy recursion as well as duplicate branded contract instances.
const root = resolve(import.meta.dirname, '..')
const chatRoot = resolve(process.env.MONTREE_CHAT_ROOT || join(root, '../../montree-chat'))
const acpRoot = resolve(process.env.MONTREE_ACP_ROOT || join(root, '../../acp-client'))
const destination = join(root, 'vendor/chat-packages')
mkdirSync(destination, { recursive: true })

function run(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) throw new Error(`Local package command failed (${result.status}): ${args.join(' ')}`)
}

run(['run', 'build'], acpRoot)
run(['run', 'build'], chatRoot)
const manifestPath = join(root, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const names = ['contracts', 'reader-core', 'annotations', 'chat-core', 'chat-ui', 'chat-session']
const packages: Array<[string, string]> = [
  ...names.map((name): [string, string] => [name, join(chatRoot, 'packages', name)]),
  ['acp-client', acpRoot],
]
for (const [name, cwd] of packages) {
  const filename = `yitom-${name}.tgz`
  run(['pm', 'pack', '--ignore-scripts', '--filename', join(destination, filename), '--quiet'], cwd)
  const spec = `file:./vendor/chat-packages/${filename}`
  manifest.dependencies[`@yitom/${name}`] = spec
  if (name !== 'acp-client') manifest.overrides[`@yitom/${name}`] = spec
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
run(['install', '--ignore-scripts'], root)
