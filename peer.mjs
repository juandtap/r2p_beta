import Hyperswarm from 'hyperswarm'
import crypto from 'crypto'
import readline from 'readline'

const room = process.argv[2]

if (!room) {
  console.error('Usage: node peer.mjs <room-name>')
  process.exit(1)
}

// Same room name => same 32-byte topic
const topic = crypto
  .createHash('sha256')
  .update(room)
  .digest()

const swarm = new Hyperswarm()

const connections = new Set()

console.log()
console.log('=== P2P ROGUE NETWORK ===')
console.log()
console.log(`[ROOM] ${room}`)
console.log('[SWARM] Joining game room...')
console.log('[DISCOVERY] Searching for peers...')
console.log()

swarm.on('connection', (conn, info) => {
  const peerId = conn.remotePublicKey
    .toString('hex')
    .slice(0, 8)

  connections.add(conn)

  console.log(`[PEER] ${peerId} discovered`)
  console.log(`[CONNECTION] Successful ✓`)
  console.log(`[NETWORK] ${connections.size} peer(s) connected`)
  console.log()

  conn.on('data', data => {
    console.log(`\n[${peerId}] ${data.toString()}`)
    process.stdout.write('> ')
  })

  conn.on('close', () => {
    connections.delete(conn)

    console.log()
    console.log(`[DISCONNECT] ${peerId}`)
    console.log(`[NETWORK] ${connections.size} peer(s) connected`)
    console.log()
  })

  conn.on('error', err => {
    console.log(`[ERROR] ${peerId}: ${err.message}`)
  })
})

const discovery = swarm.join(topic, {
  client: true,
  server: true
})

await discovery.flushed()

console.log('[SWARM] Ready ✓')
console.log('[INPUT] Type a message and press ENTER')
console.log()

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
})

rl.prompt()

rl.on('line', line => {
  const message = line.trim()

  if (!message) {
    rl.prompt()
    return
  }

  for (const conn of connections) {
    conn.write(message)
  }

  console.log(`[YOU] ${message}`)

  rl.prompt()
})

process.on('SIGINT', async () => {
  console.log()
  console.log('[SWARM] Leaving network...')

  rl.close()

  await swarm.destroy()

  process.exit(0)
})