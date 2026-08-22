import Hyperswarm from 'hyperswarm'
import crypto from 'crypto'
import readline from 'readline'
import {
  PROTOCOL_VERSION,
  createMessageDecoder,
  encodeMessage
} from './protocol.mjs'

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

// Deliberately unlimited: a room may contain any number of peer connections.
const connections = new Set()

function send (conn, message) {
  conn.write(encodeMessage({
    v: PROTOCOL_VERSION,
    ...message
  }))
}

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

  const decode = createMessageDecoder({
    onMessage: message => {
      if (message.type === 'HELLO') {
        console.log(`[PROTOCOL] ${peerId} uses version ${message.v}`)
      } else if (message.type === 'CHAT') {
        const text = message.payload?.text

        if (typeof text !== 'string') {
          console.log(`[PROTOCOL ERROR] ${peerId}: CHAT payload.text must be a string`)
          conn.destroy()
          return
        }

        console.log(`\n[${peerId}] ${text}`)
        process.stdout.write('> ')
      } else {
        console.log(`[PROTOCOL] Ignoring unknown message type: ${message.type}`)
      }
    },
    onError: error => {
      console.log(`[PROTOCOL ERROR] ${peerId}: ${error.message}`)
      conn.destroy()
    }
  })

  conn.on('data', decode)

  send(conn, {
    type: 'HELLO',
    payload: { role: 'player' }
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

swarm.on('error', error => {
  console.error(`[SWARM ERROR] ${error.message}`)
})

const discovery = swarm.join(topic, {
  client: true,
  server: true
})

discovery.flushed()
  .then(() => {
    console.log('[DISCOVERY] Room announced ✓')
  })
  .catch(error => {
    console.error(`[DISCOVERY ERROR] ${error.message}`)
  })

console.log('[SWARM] Started ✓')
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
    send(conn, {
      type: 'CHAT',
      payload: { text: message }
    })
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
