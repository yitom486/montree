import { createHash } from 'node:crypto'
import { readdir, realpath, stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { INKDOWN_MCP_TOOLS, INKDOWN_TOC_MCP_TOOLS, parseSkillFrontmatter } from '@yitom/acp-client'
import type { AgentInspection, InspectedSkill, SkillDetail } from '../../../contracts/agent-inspection'
import { acpState } from './acp-state'
import { getSessionMcpBinding } from './mcp-session-recovery'
import { adaptMontreeTools } from './mcp/montree-mcp-server'
import { READER_VISUAL_TOOLS } from './mcp/reader-visual-tools'
import { DOCUMENT_TOOLS } from './mcp/document-tools'
import { montreeAgentResourceDir } from './agent-resources'

const MAX_SKILL_BYTES = 512 * 1024
const MAX_SKILLS = 1000
export interface SkillRoot { directory: string; source: string }

export function skillRoots(runtimeId: string | null, cwd: string | null, home = homedir()): SkillRoot[] {
  const roots: SkillRoot[] = [{ directory: join(montreeAgentResourceDir(home), 'skills'), source: 'Montree 应用技能' }]
  const add = (base: string, folder: string, source: string) => roots.push({ directory: join(base, folder, 'skills'), source })
  if (runtimeId === 'codex-acp') {
    roots.push({ directory: join(process.env.CODEX_HOME || join(home, '.codex'), 'skills'), source: 'Codex 用户技能' })
    add(home, '.agents', '用户共享技能')
    if (cwd) { add(cwd, '.agents', '工作区共享技能'); add(cwd, '.codex', 'Codex 工作区技能') }
  } else if (runtimeId === 'claude') {
    add(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), '.', 'Claude 用户技能')
    if (cwd) add(cwd, '.claude', 'Claude 工作区技能')
  } else if (runtimeId?.startsWith('opencode')) {
    roots.push({ directory: join(process.env.OPENCODE_CONFIG_DIR || join(home, '.config', 'opencode'), 'skills'), source: 'OpenCode 用户技能' })
    if (cwd) { add(cwd, '.opencode', 'OpenCode 工作区技能'); add(cwd, '.agents', '工作区共享技能') }
  }
  return roots
}

/** 仅扫描已知技能根目录；完整正文按需读取，不扫描认证/运行时配置文件。 */
export async function discoverSkills(roots: SkillRoot[]): Promise<{ skills: InspectedSkill[]; warnings: string[] }> {
  const skills: InspectedSkill[] = []
  const warnings: string[] = []
  const visited = new Set<string>()
  const walk = async (directory: string, source: string, depth: number): Promise<void> => {
    if (depth > 4 || skills.length >= MAX_SKILLS || visited.size >= 4096) return
    let canonical: string
    try { canonical = await realpath(directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`无法读取技能目录：${directory}`)
      return
    }
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical
    if (visited.has(key)) return
    visited.add(key)
    const path = join(canonical, 'SKILL.md')
    try {
      const info = await stat(path)
      if (info.isFile()) {
        if (info.size > MAX_SKILL_BYTES) { warnings.push(`技能文件超过 512 KiB：${path}`); return }
        const text = await readFile(path, 'utf8')
        const metadata = parseSkillFrontmatter(text)
        skills.push({ id: createHash('sha256').update(path).digest('hex'), name: metadata.name || canonical.split(/[\\/]/).pop() || 'Skill', description: metadata.description || '', source, path, bytes: info.size, modifiedAt: info.mtime.toISOString() })
        return
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { warnings.push(`无法读取技能：${path}`); return }
    }
    try {
      for (const entry of await readdir(canonical, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        if (entry.isDirectory() || entry.isSymbolicLink()) await walk(join(canonical, entry.name), source, depth + 1)
      }
    } catch { warnings.push(`无法枚举技能目录：${canonical}`) }
  }
  for (const root of roots) await walk(resolve(root.directory), root.source, 0)
  if (skills.length >= MAX_SKILLS) warnings.push('已达到 1000 个技能的扫描上限')
  if (visited.size >= 4096) warnings.push('已达到 4096 个技能目录的扫描上限')
  return { skills: skills.sort((a, b) => a.name.localeCompare(b.name)), warnings }
}

export async function readSkillDetail(roots: SkillRoot[], id: string): Promise<SkillDetail> {
  const { skills } = await discoverSkills(roots)
  const skill = skills.find((entry) => entry.id === id)
  if (!skill) throw new Error('技能不属于当前窗口可发现的目录，或文件已被移动')
  const info = await stat(skill.path)
  if (info.size > MAX_SKILL_BYTES) throw new Error('技能文件超过 512 KiB，无法在弹窗中完整显示')
  return { ...skill, content: await readFile(skill.path, 'utf8') }
}

export async function inspectAgentSession(sessionId: string | null, runtimeId: string | null, cwd: string | null, includeSkills = true): Promise<AgentInspection> {
  const binding = sessionId ? getSessionMcpBinding(sessionId) : undefined
  const handle = binding?.handle ?? acpState.montreeMcp
  const health = handle?.health
  const attached = Boolean(binding)
  const connected = attached && acpState.status === 'connected'
  const { skills, warnings } = includeSkills ? await discoverSkills(skillRoots(runtimeId, cwd)) : { skills: [], warnings: [] }
  const toc = binding?.name === 'montree-toc'
  return {
    sessionId, runtimeId, workspace: cwd,
    connectionStatus: acpState.status,
    agentName: acpState.cachedAgentName ?? null, agentVersion: acpState.cachedAgentVersion ?? null,
    observedAt: new Date().toISOString(), skills, warnings,
    mcpCoverage: '显示 Montree 为此窗口提供的 MCP，以及服务端实际观察到的工具发现与连接状态。Agent 自行配置的其他 MCP 未通过 ACP 报告，无法在此确认。',
    skillsCoverage: '列表来自此运行时的本地技能目录。发现文件不等于 Agent 已加载或使用；当前 ACP 连接没有报告逐项技能启用和使用记录。',
    mcps: handle ? [{
      id: toc ? 'montree-toc' : 'montree', name: toc ? 'Montree 目录工具' : 'Montree 文档与阅读工具', transport: 'stdio', endpoint: handle.url,
      attached, status: !connected ? 'inactive' : health?.hasDiscoveredClient ? 'connected' : health?.discoveries ? 'discovered' : 'waiting',
      activeClients: health?.activeClients ?? 0, discoveries: health?.discoveries ?? 0, disconnects: health?.disconnects ?? 0,
      lastDiscoveredAt: health?.lastDiscoveredAt ?? null,
      tools: toc ? INKDOWN_TOC_MCP_TOOLS : [...adaptMontreeTools(INKDOWN_MCP_TOOLS), ...READER_VISUAL_TOOLS, ...DOCUMENT_TOOLS],
    }] : [],
  }
}
