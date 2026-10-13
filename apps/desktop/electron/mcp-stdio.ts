import { createConnection } from 'node:net'

// This entry runs under Electron's Node mode; stdout is exclusively MCP JSON-RPC.
const endpoint = process.env.MONTREE_MCP_PIPE
const token = process.env.MONTREE_MCP_TOKEN
if (!endpoint || !token) {
  process.stderr.write('Montree MCP: missing window connection configuration\n')
  process.exit(1)
}
const socket = createConnection(endpoint)
const timer = setTimeout(() => socket.destroy(new Error('window handshake timeout')), 5000)
let handshake = ''
socket.once('connect', () => socket.write(JSON.stringify({ token }) + '\n'))
function ready(chunk: Buffer): void {
  handshake += chunk.toString('utf8')
  if (handshake.length > 1024) { socket.destroy(new Error('invalid window handshake')); return }
  const newline = handshake.indexOf('\n')
  if (newline < 0) return
  if (handshake.slice(0, newline) !== '{"ready":true}') { socket.destroy(new Error('window authentication failed')); return }
  clearTimeout(timer)
  socket.off('data', ready)
  const rest = handshake.slice(newline + 1)
  if (rest) process.stdout.write(rest)
  socket.pipe(process.stdout)
  process.stdin.pipe(socket)
  process.stdin.resume()
}
socket.on('data', ready)
socket.on('error', () => {
  // No raw errors: pipe names, tokens and request contents must not reach logs.
  process.stderr.write('Montree MCP: window connection failed\n')
  process.exitCode = 1
})
socket.once('close', () => { clearTimeout(timer); process.stdin.destroy() })
process.stdin.once('end', () => socket.end())
process.stdin.on('error', () => socket.destroy())
process.stdout.on('error', () => socket.destroy())
