// Deterministic ACP peer. No model/network calls except this window's local MCP endpoint.
const readline = require('node:readline')
const { spawn } = require('node:child_process')
async function mcpRequest(mcp, method, params) {
  if (mcp.type === 'http') {
    const response = await fetch(mcp.url, { method: 'POST', headers: Object.fromEntries([...mcp.headers.map((header) => [header.name, header.value]), ['Content-Type', 'application/json']]), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    return response.json()
  }
  return new Promise((resolve, reject) => {
    const child = spawn(mcp.command, mcp.args, { env: { ...process.env, ...Object.fromEntries(mcp.env.map((entry) => [entry.name, entry.value])) }, stdio: 'pipe', windowsHide: true })
    const timer = setTimeout(() => { child.kill(); reject(new Error('MCP stdio timeout')) }, 10000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); if (code) reject(new Error('MCP child exited')) })
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      clearTimeout(timer)
      child.stdin.end()
      resolve(JSON.parse(line))
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n')
  })
}
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
    // 产品 sendPrompt 会在用户块前拼接 bootstrap/turn-context 块（真实模型透明）；
    // mock 取最后一个非空文本块作命令，避免前缀污染精确匹配。
    const blocks = Array.isArray(params.prompt) ? params.prompt : []
    let command = ''
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const text = blocks[i] && blocks[i].text
      if (typeof text === 'string' && text.trim()) {
        command = text.trim()
        break
      }
    }
    if (!command) command = blocks.map((block) => block.text || '').join('') || ''
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
      const rpc = await mcpRequest(mcp, 'tools/list')
      output = `TOOLS:${sessionId}|${rpc.result.tools.map((tool) => tool.name).join(',')}`
    } else if (command === 'read') {
      const { mcp, cwd } = sessions.get(sessionId)
      const rpc = await mcpRequest(mcp, 'tools/call', { name: 'montree_read', arguments: { scope: 'viewport' } })
      output = `READ:${sessionId}|${cwd}|${rpc.result?.content?.[0]?.text}`
    } else if (command === 'permission') {
      const answer = await request('session/request_permission', { sessionId, toolCall: { toolCallId: `tool-${sessionId}`, title: `Permission ${sessionId}` }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] })
      output = `PERMISSION:${sessionId}|${answer.outcome.outcome}|${answer.outcome.optionId || ''}`
    } else if (command.startsWith('present-echo:')) {
      // 回放一次真实工具结果（由测试经 MCP tools/call 取得）：只做透传，不编造。
      const payload = JSON.parse(command.slice('present-echo:'.length))
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId: `present-${sessionId}`, title: 'montree_present', kind: 'other', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: JSON.stringify(payload) } }] } } })
      output = `ECHO:${sessionId}|${payload.id}`
    } else if (command === 'worklog') {
      // U5：两个常驻流式工具调用（不主动完成），覆盖运行中默认收起与手动展开
      for (const [toolCallId, title, kind] of [['worklog-a', 'read_text_file', 'read'], ['worklog-b', 'search', 'search']]) {
        send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId, title, kind, status: 'in_progress' } } })
      }
      output = `WORKLOG:${sessionId}|started`
    } else if (command === 'worklog-done') {
      // 同一 toolCallId 落定：用户已展开的工作记录不得被收起
      // （SDK tool_call schema 要求带 title，缺省会被校验丢弃）
      for (const [toolCallId, title, kind] of [['worklog-a', 'read_text_file', 'read'], ['worklog-b', 'search', 'search']]) {
        send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId, title, kind, status: 'completed' } } })
      }
      output = `WORKLOG:${sessionId}|done`
    } else if (command === 'stream') {      const parts = ['# 流式报告\n\n首段中文正文。\n\n', '表格如下：\n\n| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n\n', '```ts\nconst answer = 42\n```\n\n', '公式 $2x+1$ 与 [链接](https://example.com/a)。\n\n', '```mermaid\ngraph TD; A-->B\n```\n\n尾段收束。脚注[^1]\n\n[^1]: 脚注证据内容']
      for (const part of parts) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        text(sessionId, part)
      }
      output = `STREAM:${sessionId}|done`
    } else if (command === 'rich-check') {
      // 富文本核验单：高亮/上标/脚注/公式/折叠/任务列表/kbd，一次回放，不编造。
      text(sessionId, '高亮 ==标记== 与 ^上标^。\n\n注脚[^7]\n\n[^7]: 注脚正文\n\n行内公式 $E=mc^2$。\n\n<details><summary>点我展开</summary>里面是细节</details>\n\n- [x] 已做\n- [ ] 待做\n\n按 <kbd>Ctrl</kbd>+<kbd>K</kbd>')
      output = `RICH:${sessionId}|done`
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
