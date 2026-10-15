import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildProfileTag,
  digestNativeRules,
  isSupportedBridgeVersion,
  mergeCodexConfigToml,
  readNativeRulesText,
  resolvePromptMode,
  resolveRuntimeEligibility,
  shortProfileHash,
  prepareNativeBinding,
  agentResourceTemplateDir,
} from './native-binding'

describe('native-binding 原生规则绑定', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
  })

  function makeResourceDir(withRules: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'montree-agent-res-'))
    dirs.push(dir)
    if (withRules) writeFileSync(join(dir, 'AGENTS.md'), '# Runtime: Montree\nnative rules\n', 'utf8')
    return dir
  }

  it('运行时资格：资格委托 SDK，未知运行时保持兼容', () => {
    expect(resolveRuntimeEligibility('codex-acp')).toEqual({ eligible: true })
    expect(resolveRuntimeEligibility('opencode')).toEqual({ eligible: true })
    expect(resolveRuntimeEligibility('cursor-cli')).toEqual({ eligible: false, reason: 'runtime-not-verified' })
    expect(resolveRuntimeEligibility('')).toEqual({ eligible: false, reason: 'runtime-not-verified' })
  })

  it('桥版本门：只放行核对过的精确版本', () => {
    expect(isSupportedBridgeVersion('codex-acp', '2.2.2')).toEqual({ eligible: true })
    expect(isSupportedBridgeVersion('codex-acp', 'v2.9.0')).toEqual({ eligible: false, reason: 'unsupported-bridge-version' })
    expect(isSupportedBridgeVersion('codex-acp', undefined)).toEqual({ eligible: false, reason: 'unknown-bridge-version' })
    expect(isSupportedBridgeVersion('codex-acp', '')).toEqual({ eligible: false, reason: 'unknown-bridge-version' })
    expect(isSupportedBridgeVersion('codex-acp', '3.0.0')).toEqual({ eligible: false, reason: 'unsupported-bridge-version' })
    expect(isSupportedBridgeVersion('opencode', '2.0.6')).toEqual({ eligible: false, reason: 'unsupported-bridge-version' })
  })

  it('config.toml 手术合并：用户键保留，只替换管理键', () => {
    const existing = [
      '# user comment stays',
      'model = "user-model"',
      'developer_instructions = "Be concise."',
      '',
      '[model_providers.other]',
      'name = "other"',
      'model = "other-model"',
      '',
      '[model_providers.inkdown-custom]',
      'name = "stale"',
      '',
      '[misc]',
      'model_provider = "not-top-level-keeps"',
    ].join('\n')
    const providerBlock = 'model_provider = "inkdown-custom"\nmodel = "prov-model"\n\n[model_providers.inkdown-custom]\nname = "fresh"\n'
    const merged = mergeCodexConfigToml(existing, providerBlock)
    // 用户内容保留
    expect(merged).toContain('# user comment stays')
    expect(merged).toContain('developer_instructions = "Be concise."')
    expect(merged).toContain('[model_providers.other]')
    expect(merged).toContain('model = "other-model"')
    expect(merged).toContain('model_provider = "not-top-level-keeps"')
    // 管理键被替换而非重复（[misc] 表内的同名键非顶层，原样保留）
    expect(merged.match(/^model_provider = /gm)).toHaveLength(2)
    expect(merged).toContain('model_provider = "not-top-level-keeps"')
    expect(merged).toContain('model_provider = "inkdown-custom"')
    expect(merged.match(/^model = /gm)).toHaveLength(2)
    expect(merged).toContain('model = "other-model"')
    expect(merged).toContain('model = "prov-model"')
    expect(merged).not.toContain('model = "user-model"')
    expect(merged.indexOf('model_provider = "inkdown-custom"')).toBeLessThan(merged.indexOf('[model_providers.other]'))
    expect(merged).toContain('[model_providers.inkdown-custom]')
    expect(merged).toContain('name = "fresh"')
    expect(merged).not.toContain('name = "stale"')
    expect(merged).not.toContain('model = "user-model"')
  })

  it('config.toml 合并：空文件直接落管理块', () => {
    expect(mergeCodexConfigToml(null, 'model = "x"\n')).toBe('model = "x"\n')
    expect(mergeCodexConfigToml('  \n', 'model = "x"\n')).toBe('model = "x"\n')
  })

  it('复杂 TOML 不作字符串手术，避免破坏多行用户规则', () => {
    expect(() => mergeCodexConfigToml('developer_instructions = """\n[misc]\n"""', 'model = "x"')).toThrow()
  })

  it('已有磁盘用户配置或未验证执行环境时不注入原生覆盖', async () => {
    const resourceDir = makeResourceDir(true)
    const home = makeResourceDir(false)
    const input = { runtimeId: 'codex-acp', resourceDir, env: { CODEX_HOME: home } }
    expect((await prepareNativeBinding({ ...input, executionVerified: false })).reason).toBe('execution-not-verified')
    writeFileSync(join(home, 'config.toml'), 'developer_instructions = "Keep me"\n')
    const result = await prepareNativeBinding(input)
    expect(result.reason).toBe('effective-config-not-verified')
    expect(result.resourceEnv?.CODEX_CONFIG).toBeUndefined()
  })

  it('温绑定包含有效环境配置变化，项目配置同样回退', async () => {
    const resourceDir = makeResourceDir(true)
    const home = makeResourceDir(false)
    const input = { runtimeId: 'codex-acp', resourceDir, env: { CODEX_HOME: home } }
    const first = await prepareNativeBinding(input)
    const changed = await prepareNativeBinding({ ...input, env: { ...input.env, CODEX_CONFIG: '{"developer_instructions":"User rules"}' } })
    expect(first.eligible).toBe(true)
    expect(first.profileTag).not.toBe(changed.profileTag)
    const cwd = makeResourceDir(false)
    mkdirSync(join(cwd, '.codex'))
    writeFileSync(join(cwd, '.codex/config.toml'), 'developer_instructions = "Project rules"')
    expect((await prepareNativeBinding({ ...input, cwd })).reason).toBe('effective-config-not-verified')
  })

  it('摘要：内容变则变，目录名不参与', () => {
    const a = digestNativeRules('rules v1')
    const b = digestNativeRules('rules v2')
    expect(a).not.toBe(b)
    expect(a).toHaveLength(64)
    expect(shortProfileHash(a)).toHaveLength(16)
    expect(buildProfileTag('codex-acp', shortProfileHash(a))).toContain('codex-acp:rules@')
  })

  it('资源读取：缺失返回 null（调用方降级）', async () => {
    expect(await readNativeRulesText({ resourceDir: makeResourceDir(true) })).toContain('Montree')
    expect(await readNativeRulesText({ resourceDir: makeResourceDir(false) })).toBeNull()
    expect(await readNativeRulesText({ resourceDir: join(tmpdir(), 'montree-agent-nope-missing') })).toBeNull()
  })

  it('打包资源从 resourcesPath 实际读取，缺失时不回退到工作目录', async () => {
    const packaged = makeResourceDir(false)
    mkdirSync(join(packaged, 'agent'))
    writeFileSync(join(packaged, 'agent/AGENTS.md'), 'PACKAGED_RULES')
    const previous = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: packaged })
    try {
      const dir = agentResourceTemplateDir(process.cwd(), true)
      expect(await readNativeRulesText({ resourceDir: dir })).toBe('PACKAGED_RULES')
      const missing = join(packaged, 'missing')
      Object.defineProperty(process, 'resourcesPath', { configurable: true, value: missing })
      expect(agentResourceTemplateDir(process.cwd(), true)).toBe(join(missing, 'agent'))
      expect(await readNativeRulesText({ resourceDir: agentResourceTemplateDir(process.cwd(), true) })).toBeNull()
    } finally {
      if (previous) Object.defineProperty(process, 'resourcesPath', previous)
      else Reflect.deleteProperty(process, 'resourcesPath')
    }
  })

  it('prompt 模式裁决：仅新会话 native，恢复一律兼容', () => {
    const ready = { eligible: true, versionSupported: true, bindingReady: true }
    expect(resolvePromptMode({ ...ready, restoreMethod: 'new' })).toEqual({ mode: 'native' })
    expect(resolvePromptMode({ ...ready, restoreMethod: null })).toEqual({ mode: 'compatibility', reason: 'session-restored' })
    expect(resolvePromptMode({ ...ready, restoreMethod: 'resume' })).toEqual({ mode: 'compatibility', reason: 'session-restored' })
    expect(resolvePromptMode({ ...ready, restoreMethod: 'load' })).toEqual({ mode: 'compatibility', reason: 'session-restored' })
    expect(resolvePromptMode({ ...ready, restoreMethod: 'new', bindingReady: false })).toEqual({
      mode: 'compatibility',
      reason: 'binding-not-ready',
    })
    expect(resolvePromptMode({ eligible: false, versionSupported: true, bindingReady: true, restoreMethod: 'new' })).toEqual({
      mode: 'compatibility',
      reason: 'runtime-not-verified',
    })
    expect(resolvePromptMode({ eligible: true, versionSupported: false, bindingReady: true, restoreMethod: 'new' })).toEqual({
      mode: 'compatibility',
      reason: 'unsupported-bridge-version',
    })
  })

  it('资源锚点：AGENTS.md 与渲染端静态 Skill 关键语义同源（防漂移）', async () => {
    const { readFileSync } = await import('node:fs')
    const md = readFileSync(join(process.cwd(), 'apps/desktop/resources/agent/AGENTS.md'), 'utf8')
    const ts = readFileSync(
      join(process.cwd(), 'apps/desktop/src/lib/agent/context/montree-static-skill.ts'),
      'utf8',
    )
    const anchors = [
      'montree_present',
      'montree_diagram_guide',
      'montree_markdown_guide',
      'turn-context',
      'hasSelection',
      'KaTeX',
      'Mermaid',
      'montree_get_selection',
    ]
    expect(anchors.length).toBeGreaterThanOrEqual(8)
    for (const a of anchors) {
      expect(md, `AGENTS.md 缺锚点: ${a}`).toContain(a)
      expect(ts, `static-skill 缺锚点: ${a}`).toContain(a)
    }
  })
  it('agy 资源接线委托 SDK，不改 cwd 或用户全局目录', async () => {
    const resourceDir = makeResourceDir(true)
    const result = await prepareNativeBinding({runtimeId:'agy',resourceDir,cwd:resourceDir,env:{}})
    expect(result.eligible).toBe(true)
    expect(result.resourceEnv).toBeUndefined()
    expect(result.sessionMeta).toEqual({appResources:{directory:resourceDir}})
    expect(result.resourceEnv?.CODEX_CONFIG).toBeUndefined()
    expect(result.profileTag).toContain('agy:rules@')
    expect(isSupportedBridgeVersion('agy','0.1.24').eligible).toBe(true)
    expect(isSupportedBridgeVersion('agy','0.1.23').eligible).toBe(false)
  })

})
