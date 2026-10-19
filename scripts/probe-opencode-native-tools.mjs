/** Optional live probe: real OpenCode ACP, isolated configuration, local mock model, no paid API calls. */
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectSdkClient, sdkRequest } from '@yitom/acp-client'

const executable = process.argv[2]
if (!executable) throw new Error('Usage: node scripts/probe-opencode-native-tools.mjs <opencode executable>')
const root = await mkdtemp(join(tmpdir(), 'montree-native-tools-'))
const workspace = join(root, 'workspace')
await mkdir(workspace)
const target = join(workspace, 'native-created.md')
const marker = '# Native ACP file\n'
const delegated = { fs: 0, terminal: 0 }
const schemas = new Map(), names = new Set()
let action = 'catalog', issued = false, results = '', connection, child, timer
const server = createServer(async (req, res) => {
  if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[{"id":"native"}]}'); return }
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  for (const tool of body.tools ?? []) { const fn = tool.function ?? tool; names.add(fn.name); schemas.set(fn.name, fn.parameters) }
  results += JSON.stringify((body.messages ?? []).filter(message => message.role === 'tool'))
  let delta = { role: 'assistant', content: 'PROBE_OK' }, finish = 'stop'
  if (action !== 'catalog' && !issued) {
    issued = true
    const schema = schemas.get(action)
    if (!schema) { res.writeHead(400).end(JSON.stringify({ error: { message: `Missing native tool ${action}` } })); return }
    const pathKey = ['path', 'filePath', 'file_path'].find(key => key in (schema.properties ?? {}))
    const args = action === 'shell' ? { command: 'git --version', workdir: workspace, timeout: 10000 }
      : { [pathKey ?? 'path']: target, ...(action === 'write' ? { content: marker } : {}) }
    delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'native_' + action, type: 'function', function: { name: action, arguments: JSON.stringify(args) } }] }
    finish = 'tool_calls'
  }
  const common = { id: 'local-native-probe', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'native' }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: finish }]) res.write('data: ' + JSON.stringify({ ...common, choices: [{ index: 0, ...choice }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\n')
  res.end('data: [DONE]\n\n')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const env = { ...process.env }
for (const kind of ['CONFIG', 'DATA', 'CACHE', 'STATE']) { env[`XDG_${kind}_HOME`] = join(root, kind.toLowerCase()); await mkdir(env[`XDG_${kind}_HOME`]) }
delete env.OPENCODE_CONFIG; delete env.OPENCODE_CONFIG_DIR; delete env.OPENCODE_CONFIG_CONTENT
const config = { model: 'local-probe/native', providers: { 'local-probe': { package: '@opencode/ai/providers/openai-compatible',
  settings: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-test-only' }, models: { native: { capabilities: { tools: true, input: ['text'], output: ['text'] } } } } } }
await mkdir(join(env.XDG_CONFIG_HOME, 'opencode'))
await writeFile(join(env.XDG_CONFIG_HOME, 'opencode', 'opencode.jsonc'), JSON.stringify(config))
await writeFile(join(workspace, 'opencode.jsonc'), JSON.stringify(config))
try {
  child = spawn(executable, ['acp'], { cwd: workspace, env, windowsHide: true, stdio: 'pipe' })
  let stderr = ''; child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000) })
  child.on('error', error => process.stderr.write(error.message + '\n'))
  const connected = connectSdkClient(child, app => {
    app.onRequest('session/request_permission', async ctx => {
      const option = ctx.params.options.find(option => option.kind === 'allow_once')
      return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } }
    })
    for (const method of ['fs/read_text_file', 'fs/write_text_file', 'terminal/create']) app.onRequest(method, async () => {
      ++delegated[method.startsWith('fs/') ? 'fs' : 'terminal']; throw new Error('Probe forbids client execution')
    })
    app.onNotification('session/update', async () => {})
  }, 'opencode')
  connection = connected.connection
  const run = async () => {
    const init = await sdkRequest(connection.agent, 'initialize', { protocolVersion: 1, clientInfo: { name: 'montree-native-probe' },
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true } }, 10000)
    console.log('Agent:', JSON.stringify(init.agentInfo))
    const session = await sdkRequest(connection.agent, 'session/new', { cwd: workspace, mcpServers: [] }, 15000)
    await sdkRequest(connection.agent, 'session/set_config_option', { sessionId: session.sessionId, configId: 'model', value: 'local-probe/native' }, 10000)
    for (const step of ['catalog', 'write', 'read', 'shell']) {
      action = step; issued = false; results = ''
      await sdkRequest(connection.agent, 'session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: `Local native ${step} probe only.` }] }, 15000)
      if (step === 'write' && await readFile(target, 'utf8') !== marker) throw new Error('Native write did not create the expected file')
      if (step === 'read' && !results.includes('Native ACP file')) throw new Error('Native read did not return the file content')
      if (step === 'shell' && !results.includes('git version')) throw new Error('Native shell did not return Git output')
      console.log('PASS', step)
    }
    if (delegated.fs || delegated.terminal) throw new Error('Native operations delegated to client execution')
    console.log(JSON.stringify({ nativeTools: [...names].sort(), clientDelegation: delegated, fileCreated: true, fileRead: true, gitExecuted: true }))
  }
  await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Probe exceeded 45 seconds')), 45000) })])
} finally {
  clearTimeout(timer)
  try { connection?.close() } catch {}
  if (child?.pid) {
    const stopped = child.exitCode !== null || child.signalCode !== null ? Promise.resolve()
      : new Promise(resolve => child.once('close', resolve))
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 3000, stdio: 'ignore' })
    else child.kill('SIGKILL')
    let closingTimer
    await Promise.race([stopped, new Promise(resolve => { closingTimer = setTimeout(resolve, 3000) })])
    clearTimeout(closingTimer)
  }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
