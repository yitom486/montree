// Deterministic ACP peer. No model/network calls except this window's local MCP endpoint.
const readline = require('node:readline')
const sessions = new Map()
const permissions = new Map()
const waiting = new Map()
let sequence = 0, requestSequence = 1000
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const result = (id, value) => send({ id, result: value })
const text = (sessionId, value) => send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } } } })
const config = (value = 'default') => [{ id: 'mode', name: 'Mode', type: 'select', currentValue: value, options: [{ value: 'default', name: 'Default' }, { value: 'alternate', name: 'Alternate' }] }]
const request = (method, params) => new Promise((resolve) => {
  const id = ++requestSequence
  permissions.set(id, resolve)
  send({ id, method, params })
})
async function handle(message) {
  const { id, method, params = {} } = message
  if (!method) { permissions.get(id)?.(message.result); permissions.delete(id); return }
  if (method === 'initialize') {
    result(id, { protocolVersion: 1, agentInfo: { name: 'mock-window', version: '1' }, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true }, promptCapabilities: { image: true } }, authMethods: [] })
  } else if (method === 'session/new' || method === 'session/load' || method === 'session/resume') {
    const sessionId = params.sessionId || `mock-${process.pid}-${++sequence}`
    sessions.set(sessionId, { cwd: params.cwd, mcp: params.mcpServers?.[0] })
    result(id, { sessionId, configOptions: config() })
  } else if (method === 'session/prompt') {
    const sessionId = params.sessionId
    const command = params.prompt?.map((block) => block.text || '').join('') || ''
    if (command === 'wait') {
      waiting.set(sessionId, id)
      text(sessionId, `WAIT:${sessionId}`)
      return
    }
    let output = command
    if (command === 'identity') {
      output = `IDENTITY:${sessionId}|${sessions.get(sessionId).cwd}`
    } else if (command === 'tools') {
      const { mcp } = sessions.get(sessionId)
      const response = await fetch(mcp.url, { method: 'POST', headers: Object.fromEntries([...mcp.headers.map((header) => [header.name, header.value]), ['Content-Type', 'application/json']]), body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) })
      const rpc = await response.json()
      output = `TOOLS:${sessionId}|${rpc.result.tools.map((tool) => tool.name).join(',')}`
    } else if (command === 'read') {
      const { mcp, cwd } = sessions.get(sessionId)
      const response = await fetch(mcp.url, { method: 'POST', headers: Object.fromEntries([...mcp.headers.map((header) => [header.name, header.value]), ['Content-Type', 'application/json']]), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'montree_read', arguments: { scope: 'viewport' } } }) })
      const rpc = await response.json()
      output = `READ:${sessionId}|${cwd}|${rpc.result?.content?.[0]?.text}`
    } else if (command === 'permission') {
      const answer = await request('session/request_permission', { sessionId, toolCall: { toolCallId: `tool-${sessionId}`, title: `Permission ${sessionId}` }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] })
      output = `PERMISSION:${sessionId}|${answer.outcome.outcome}|${answer.outcome.optionId || ''}`
    }
    text(sessionId, output)
    result(id, { stopReason: 'end_turn' })
  } else if (method === 'session/cancel') {
    const pending = waiting.get(params.sessionId)
    if (pending != null) { waiting.delete(params.sessionId); result(pending, { stopReason: 'cancelled' }) }
  } else if (method === 'session/set_config_option') {
    result(id, { configOptions: config(params.value) })
  } else if (id != null) {
    send({ id, error: { code: -32601, message: method } })
  }
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  try { void handle(JSON.parse(line)).catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1 }) }
  catch (error) { process.stderr.write(error.stack + '\n') }
})
