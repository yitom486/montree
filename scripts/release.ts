/**
 * 发版助手：默认 patch 递增版本号，把 CHANGELOG「未发布」收成正式节，commit + 打 tag。
 *
 * 用法：
 *   bun run release              # 0.2.5 → 0.2.6，仅本地 commit/tag
 *   bun run release:push         # 只推当前版（HEAD + 当前 version 的 tag），不递增版本
 *   bun run release -- minor
 *   bun run release -- patch --push   # 递增 patch 并 push（想连发必须点名 bump）
 *   bun run release -- major --push
 *   bun run release -- --dry-run
 *
 * 约定：日常把要点写在 CHANGELOG「未发布」；发版时不必手算下一个版本号。
 *
 * OCR 运行时（PDFium/ORT/模型）由应用首次识别时按需下载，无需随包发布。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export type BumpKind = 'patch' | 'minor' | 'major'

const ROOT = join(import.meta.dirname, '..')
const PACKAGE_JSON = join(ROOT, 'package.json')
const CHANGELOG = join(ROOT, 'CHANGELOG.md')
const REPO = 'yitom486/montree'

const AUTHOR_NAME = 'yitom486'
const AUTHOR_EMAIL = 'yitom486@gmail.com'

export function fail(message: string): never {
  throw new Error(`release: ${message}`)
}

export function parseArgs(argv: string[]): {
  bump: BumpKind
  bumpExplicit: boolean
  push: boolean
  dryRun: boolean
} {
  let bump: BumpKind = 'patch'
  let bumpExplicit = false
  let push = false
  let dryRun = false
  for (const arg of argv) {
    if (arg === '--push') push = true
    else if (arg === '--dry-run') dryRun = true
    else if (arg === 'patch' || arg === 'minor' || arg === 'major') {
      bump = arg
      bumpExplicit = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`用法: bun run scripts/release.ts [patch|minor|major] [--push] [--dry-run]`)
      process.exit(0)
    } else {
      fail(`未知参数：${arg}（支持 patch|minor|major、--push、--dry-run）`)
    }
  }
  return { bump, bumpExplicit, push, dryRun }
}

export function parseSemver(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) fail(`package.json version 不是 x.y.z：${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function bumpVersion(version: string, kind: BumpKind): string {
  let [major, minor, patch] = parseSemver(version)
  if (kind === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (kind === 'minor') {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }
  return `${major}.${minor}.${patch}`
}

function todayLocalIsoDate(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function git(args: string[]): string {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
  }
  delete env.GIT_AUTHOR_DATE
  delete env.GIT_COMMITTER_DATE

  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf-8',
    env,
  })
  if (result.status !== 0) {
    fail(`git ${args.join(' ')} 失败：${result.stderr || result.stdout || result.status}`)
  }
  return (result.stdout ?? '').trim()
}

function assertCleanTree(): void {
  const status = git(['status', '--porcelain'])
  if (status.length > 0) {
    fail(`工作区不干净，请先提交或暂存后再发版：\n${status}`)
  }
}

function assertTagAbsent(tag: string): void {
  const existing = git(['tag', '-l', tag])
  if (existing === tag) fail(`本地已存在 tag ${tag}`)
}

/** 「未发布」正文须至少有一条以 - 开头的要点；去掉节末装饰性 --- */
export function extractUnreleasedBody(changelog: string): string {
  const match = /^## \[未发布\]\s*\n([\s\S]*?)(?=\n## \[|\n\[未发布\]:)/m.exec(changelog)
  if (!match) fail('CHANGELOG.md 找不到「## [未发布]」节')
  const body = match[1]
    .replace(/^\n+/, '')
    .replace(/\n---\s*$/m, '')
    .replace(/\n+$/, '')
    .trim()
  const hasBullet = /^- /m.test(body)
  if (!hasBullet) {
    fail('「未发布」节没有要点（需至少一条「- …」）。请先写好本版主要更新再发版。')
  }
  return body
}

export function updateChangelog(
  changelog: string,
  nextVersion: string,
  date: string,
  body: string,
  repo = REPO,
): string {
  const previousVersionMatch = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)
  if (!previousVersionMatch) fail('CHANGELOG.md 找不到上一版「## [x.y.z]」')
  const previousVersion = previousVersionMatch[1]

  const unreleasedBlock = /^## \[未发布\]\s*\n[\s\S]*?(?=\n## \[)/m
  if (!unreleasedBlock.test(changelog)) fail('无法定位「未发布」块以便替换')

  const replacement =
    `## [未发布]\n\n---\n\n## [${nextVersion}] - ${date}\n\n${body}\n\n---\n`

  let next = changelog.replace(unreleasedBlock, replacement)

  next = next.replace(
    /^\[未发布\]: https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/compare\/v[\w.-]+\.\.\.HEAD$/m,
    `[未发布]: https://github.com/${repo}/compare/v${nextVersion}...HEAD`,
  )

  if (next.includes(`[${nextVersion}]:`)) {
    fail(`CHANGELOG 已存在 [${nextVersion}] 链接`)
  }
  const linkInsert = `[${nextVersion}]: https://github.com/${repo}/compare/v${previousVersion}...v${nextVersion}`
  next = next.replace(/^\[未发布\]: .+$/m, (line) => `${line}\n${linkInsert}`)

  next = next.replace(/\n{3,}/g, '\n\n')
  return next
}

function main(): void {
  const { bump, bumpExplicit, push, dryRun } = parseArgs(process.argv.slice(2))
  assertCleanTree()

  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8')) as { version: string }
  const current = pkg.version

  // 只推不断版：release:push 场景。未点名 bump 时 --push 不再隐式递增版本，
  // 否则发版后空[未发布]节必拦、白白连发一版。
  if (push && !bumpExplicit && !dryRun) {
    const pushTag = `v${current}`
    const existing = git(['tag', '-l', pushTag])
    if (existing !== pushTag) {
      fail(`本地无 tag ${pushTag}，请先 bun run release 发版后再 push`)
    }
    git(['push', 'origin', 'HEAD'])
    git(['push', 'origin', pushTag])
    console.log(`release: 已推送 ${pushTag}；GitHub Actions 将打包 Release：https://github.com/${REPO}/actions`)
    return
  }

  const nextVersion = bumpVersion(current, bump)
  const tag = `v${nextVersion}`
  assertTagAbsent(tag)

  const changelogRaw = readFileSync(CHANGELOG, 'utf-8')
  const unreleasedBody = extractUnreleasedBody(changelogRaw)
  const date = todayLocalIsoDate()
  const nextChangelog = updateChangelog(changelogRaw, nextVersion, date, unreleasedBody)

  console.log(`release: ${current} → ${nextVersion} (${bump})`)
  console.log(`release: tag ${tag}${push ? ' + push' : '（仅本地）'}${dryRun ? ' [dry-run]' : ''}`)

  if (dryRun) {
    console.log('--- CHANGELOG 预览（节选）---')
    const preview = nextChangelog.match(/^## \[未发布\][\s\S]*?\n## \[\d+\.\d+\.\d+\].*?(?=\n## \[)/)
    console.log(preview?.[0]?.trim() ?? '(无法预览)')
    return
  }

  pkg.version = nextVersion
  writeFileSync(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8')
  writeFileSync(CHANGELOG, nextChangelog.endsWith('\n') ? nextChangelog : `${nextChangelog}\n`, 'utf-8')

  git(['add', 'package.json', 'CHANGELOG.md'])
  git(['commit', '-m', `chore: 发布 ${tag}`])
  git(['tag', '-a', tag, '-m', tag])

  if (push) {
    git(['push', 'origin', 'HEAD'])
    git(['push', 'origin', tag])
    console.log(`release: 已推送；GitHub Actions 将打包 Release：https://github.com/${REPO}/actions`)
  } else {
    console.log('release: 本地已 commit + tag。确认后执行：')
    console.log(`  git push origin HEAD && git push origin ${tag}`)
    console.log('或：bun run release:push')
  }
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
