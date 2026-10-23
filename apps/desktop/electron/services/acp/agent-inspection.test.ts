import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverSkills, inspectAgentSession, readSkillDetail, skillRoots } from './agent-inspection'
import { getAcpContext, runInAcpContext, forgetAcpContext } from './acp-context'
import { acpState } from './acp-state'
import { McpConnectionHealth } from './mcp/connection-health'

const mocks = vi.hoisted(() => ({ binding: undefined as any }))
vi.mock('./mcp-session-recovery', () => ({ getSessionMcpBinding: () => mocks.binding }))

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'montree-inspection-')); mocks.binding = undefined })
afterEach(async () => { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs() })
async function skill(name: string, content: string) {
  const root = join(directory, name)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'SKILL.md'), content)
  return root
}

describe('local skill inspection', () => {
  it('discovers frontmatter and reads the full body only for a discovered ID', async () => {
    const content = '---\nname: diagram-helper\ndescription: Draw clear diagrams\n---\n# Usage\n\nFollow every step.\n'
    await skill('diagram', content)
    await mkdir(join(directory, 'not-a-skill'))
    await writeFile(join(directory, 'not-a-skill', 'auth.json'), 'not skill data')
    const roots = [{ directory, source: 'Workspace' }]
    const result = await discoverSkills(roots)
    expect(result.warnings).toEqual([])
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({ name: 'diagram-helper', description: 'Draw clear diagrams', source: 'Workspace', bytes: Buffer.byteLength(content) })
    expect(result.skills[0]).not.toHaveProperty('content')
    expect((await readSkillDetail(roots, result.skills[0].id)).content).toBe(content)
    await expect(readSkillDetail(roots, join(directory, 'not-a-skill', 'auth.json'))).rejects.toThrow('不属于')
  })

  it('deduplicates roots, bounds cyclic directory links, and warns about oversized skills', async () => {
    await skill('plain-name', '# Instructions without frontmatter')
    await skill('oversized', 'x'.repeat(512 * 1024 + 1))
    await symlink(directory, join(directory, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir')
    const result = await discoverSkills([{ directory, source: 'first' }, { directory, source: 'duplicate' }, { directory: join(directory, 'missing'), source: 'missing' }])
    expect(result.skills.map((item) => item.name)).toEqual(['plain-name'])
    expect(result.skills[0].source).toBe('first')
    expect(result.warnings).toEqual([expect.stringContaining('512 KiB')])
  })

  it('uses runtime-specific home and workspace roots, including a custom CODEX_HOME', () => {
    vi.stubEnv('CODEX_HOME', join(directory, 'custom-codex'))
    const paths = skillRoots('codex-acp', join(directory, 'workspace'), directory).map((root) => root.directory)
    expect(paths).toEqual([join(directory, '.montree', 'skills'), join(directory, 'custom-codex', 'skills'), join(directory, '.agents', 'skills'), join(directory, 'workspace', '.agents', 'skills'), join(directory, 'workspace', '.codex', 'skills')])
    expect(skillRoots('claude', null, directory).some((root) => root.source === 'Codex 用户技能')).toBe(false)
  })
})

describe('observed session MCP health', () => {
  it('distinguishes offered, discovered, connected and detached, without exposing credentials', async () => {
    const owner = getAcpContext('inspection-test')
    try { await runInAcpContext(owner, async () => {
      const health = new McpConnectionHealth()
      const handle = { url: 'window-pipe', authToken: 'PRIVATE_NEVER_EXPOSE', close: async () => {}, health }
      acpState.montreeMcp = handle
      acpState.status = 'connected'
      mocks.binding = { handle, name: 'montree' }
      const read = () => inspectAgentSession('session', 'mock', null, false)
      expect((await read()).mcps[0].status).toBe('waiting')
      const client = {}
      health.discovered(client)
      const active = await read()
      expect(active.mcps[0]).toMatchObject({ status: 'connected', activeClients: 1, discoveries: 1, lastDiscoveredAt: expect.any(String) })
      expect(active.mcps[0].tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['montree_read', 'montree_capture_viewport', 'montree_table_edit']))
      expect(JSON.stringify(active)).not.toContain('PRIVATE_NEVER_EXPOSE')
      health.closed(client)
      expect((await read()).mcps[0]).toMatchObject({ status: 'discovered', activeClients: 0, disconnects: 1 })
      acpState.status = 'disconnected'
      expect((await read()).mcps[0].status).toBe('inactive')
      mocks.binding = undefined
      expect((await read()).mcps[0].attached).toBe(false)
    }) } finally { forgetAcpContext(owner) }
  })
})
