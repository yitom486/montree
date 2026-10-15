import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeAgentResources, montreeAgentResourceDir } from './agent-resources'
import { prepareNativeBinding } from './native-binding'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'montree-user-resources-')); roots.push(root)
  const templates = join(root, 'installed', 'agent'), home = join(root, 'user')
  mkdirSync(join(templates, 'skills', 'render'), { recursive: true })
  writeFileSync(join(templates, 'AGENTS.md'), 'DEFAULT_RULES')
  writeFileSync(join(templates, 'skills', 'render', 'SKILL.md'), '---\nname: render\ndescription: Render widgets.\n---\nDEFAULT_SKILL')
  return { templates, home }
}
describe('用户 .montree 规则与 Skills', () => {
  it('首次初始化并把用户目录交给真实 SDK 准备钩，不使用安装目录运行', async () => {
    const { templates, home } = fixture()
    const directory = await initializeAgentResources(templates, home)
    expect(directory).toBe(join(home, '.montree'))
    expect(directory).toBe(montreeAgentResourceDir(home))
    expect(readFileSync(join(directory, 'AGENTS.md'), 'utf8')).toBe('DEFAULT_RULES')
    expect(readdirSync(home)).toEqual(['.montree'])
    const prep = await prepareNativeBinding({ runtimeId: 'agy', resourceDir: directory, cwd: home, env: {} })
    expect(prep.eligible).toBe(true)
    expect(prep.sessionMeta).toEqual({ appResources: { directory } })
    expect(prep.profileTag).toContain('agy:rules@')
    expect(readFileSync(join(templates, 'AGENTS.md'), 'utf8')).toBe('DEFAULT_RULES')
  })
  it('升级和并发初始化保留用户规则、自定义技能及已有空文件，只补缺失文件', async () => {
    const { templates, home } = fixture()
    const directory = await initializeAgentResources(templates, home)
    writeFileSync(join(directory, 'AGENTS.md'), 'USER_RULES')
    writeFileSync(join(directory, 'skills', 'render', 'SKILL.md'), '')
    mkdirSync(join(directory, 'skills', 'custom'))
    writeFileSync(join(directory, 'skills', 'custom', 'SKILL.md'), 'USER_SKILL')
    writeFileSync(join(templates, 'AGENTS.md'), 'NEW_DEFAULT_RULES')
    writeFileSync(join(templates, 'skills', 'render', 'reference.md'), 'NEW_REFERENCE')
    await Promise.all([initializeAgentResources(templates, home), initializeAgentResources(templates, home)])
    expect(readFileSync(join(directory, 'AGENTS.md'), 'utf8')).toBe('USER_RULES')
    expect(readFileSync(join(directory, 'skills', 'render', 'SKILL.md'), 'utf8')).toBe('')
    expect(readFileSync(join(directory, 'skills', 'custom', 'SKILL.md'), 'utf8')).toBe('USER_SKILL')
    expect(readFileSync(join(directory, 'skills', 'render', 'reference.md'), 'utf8')).toBe('NEW_REFERENCE')
  })
  it('已有用户规则可以在缺少安装模板时继续使用', async () => {
    const { templates, home } = fixture()
    const directory = await initializeAgentResources(templates, home)
    rmSync(templates, { recursive: true })
    expect(await initializeAgentResources(templates, home)).toBe(directory)
    expect(readFileSync(join(directory, 'AGENTS.md'), 'utf8')).toBe('DEFAULT_RULES')
  })
})
