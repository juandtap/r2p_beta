import Hyperswarm from 'hyperswarm'
import crypto from 'crypto'
import readline from 'readline'
import {
  PROTOCOL_VERSION,
  createMessageDecoder,
  encodeMessage
} from './protocol.mjs'
import { Session, defaultName } from './session.mjs'
import { GameAdapter } from './game-adapter.mjs'
import { createRandomGame } from './examples/random-game.mjs'

const room = process.argv[2]
const randomGameEnabled = process.argv.includes('--random-game')

if (!room) {
  console.error('Usage: node peer.mjs <room-name>')
  process.exit(1)
}

// Same room name => same 32-byte topic
const topic = crypto
  .createHash('sha256')
  .update(room)
  .digest()

const swarm = new Hyperswarm({ maxPeers: Infinity })
const selfId = swarm.keyPair.publicKey.toString('hex')
const shortSelfId = selfId.slice(0, 8)
const roomId = topic
  .toString('hex')
  .slice(0, 8)
const session = new Session({
  selfId,
  selfName: defaultName(selfId)
})

// Deliberately unlimited: a room may contain any number of peer connections.
const connections = new Set()
let shuttingDown = false
const game = new GameAdapter({
  sendEvent: event => {
    if (event.type === 'GAME_OVER' && !session.isCoordinator) {
      throw new Error('Only the coordinator can send GAME_OVER')
    }

    broadcast({
      type: 'GAME_EVENT',
      playerId: selfId,
      payload: { event }
    })
  },
  onError: error => {
    console.error(`[GAME ERROR] ${error.message}`)
  }
})
const randomGame = randomGameEnabled
  ? createRandomGame({ sendGameEvent: event => game.send(event) })
  : null

if (randomGame) game.attach(randomGame)

function send (conn, message) {
  conn.write(encodeMessage({
    v: PROTOCOL_VERSION,
    ...message
  }))
}

function broadcast (message) {
  for (const conn of connections) send(conn, message)
}

async function broadcastAndFlush (message) {
  const encoded = encodeMessage({
    v: PROTOCOL_VERSION,
    ...message
  })

  await Promise.allSettled([...connections].map(conn => new Promise(resolve => {
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(finish, 500)

    try {
      conn.write(encoded, finish)
    } catch {
      finish()
    }
  })))
}

function showPlayers () {
  console.log('\nPlayers:')

  for (const player of session.orderedPlayers) {
    const state = player.ready ? 'READY' : 'WAITING'
    const coordinator = player.playerId === session.coordinatorId
      ? ' [COORDINATOR]'
      : ''
    const you = player.playerId === selfId ? ' [YOU]' : ''

    console.log(`- ${player.name} [${state}]${coordinator}${you}`)
  }

  console.log()
}

function handleStart (message, peerId) {
  if (peerId !== session.coordinatorId) {
    console.log(`[SESSION] Rejected START from non-coordinator ${peerId.slice(0, 8)}`)
    return
  }

  const seed = message.payload?.seed
  const players = message.payload?.players
  if (typeof seed !== 'string' || !Array.isArray(players)) {
    console.log('[SESSION] Rejected malformed START message')
    return
  }

  console.log(`[SESSION] Match starting with ${players.length} player(s)`)
  console.log(`[SESSION] Dungeon seed: ${seed}`)

  game.start({
    selfId,
    seed,
    players
  })
}

console.log()
console.log('=== P2P ROGUE NETWORK ===')
console.log()
console.log(`[ROOM] ${room}`)
console.log(`[ROOM ID] ${roomId}`)
console.log(`[SELF] ${shortSelfId}`)
console.log(`[GAME] ${randomGame ? 'random-state test' : 'not attached'}`)
console.log('[SWARM] Joining game room...')
console.log('[DISCOVERY] Searching for peers...')
console.log()

swarm.on('connection', (conn, info) => {
  const peerId = conn.remotePublicKey.toString('hex')
  const shortPeerId = peerId.slice(0, 8)

  connections.add(conn)
  session.addPlayer(peerId)

  console.log(`[PEER] ${shortPeerId} discovered`)
  console.log(`[DIRECTION] ${info.client ? 'outgoing' : 'incoming'}`)
  console.log(`[CONNECTION] Successful ✓`)
  console.log(`[NETWORK] ${connections.size} peer(s) connected`)
  console.log()

  const decode = createMessageDecoder({
    onMessage: message => {
      if (message.type === 'HELLO') {
        console.log(`[PROTOCOL] ${shortPeerId} uses version ${message.v}`)
      } else if (message.type === 'JOIN') {
        if (message.playerId !== peerId) {
          console.log(`[PROTOCOL ERROR] ${shortPeerId}: invalid player identity`)
          conn.destroy()
          return
        }

        const name = message.payload?.name
        session.addPlayer(peerId, typeof name === 'string' ? name : undefined)
        console.log(`[SESSION] ${session.players.get(peerId).name} joined`)
      } else if (message.type === 'READY') {
        if (message.playerId !== peerId || typeof message.payload?.ready !== 'boolean') {
          console.log(`[PROTOCOL ERROR] ${shortPeerId}: invalid READY message`)
          conn.destroy()
          return
        }

        session.setReady(peerId, message.payload.ready)
        console.log(`[SESSION] ${session.players.get(peerId).name} is ${message.payload.ready ? 'ready' : 'not ready'}`)
      } else if (message.type === 'START') {
        handleStart(message, peerId)
      } else if (message.type === 'GAME_EVENT') {
        const event = message.payload?.event
        if (
          message.playerId !== peerId ||
          !event ||
          typeof event !== 'object' ||
          Array.isArray(event) ||
          typeof event.type !== 'string'
        ) {
          console.log(`[PROTOCOL ERROR] ${shortPeerId}: invalid GAME_EVENT message`)
          conn.destroy()
          return
        }

        if (event.type === 'GAME_OVER' && peerId !== session.coordinatorId) {
          console.log(`[PROTOCOL ERROR] ${shortPeerId}: only coordinator can send GAME_OVER`)
          conn.destroy()
          return
        }

        if (event.type === 'GAME_OVER') {
          const { winnerId, reason } = event.payload
          console.log('[SESSION] Game over')
          console.log(`[SESSION] Reason: ${reason}`)
          console.log(`[SESSION] Winner: ${winnerId ? winnerId.slice(0, 8) : 'none'}`)
          randomGame?.stop()
        }

        if (!game.receive({ playerId: peerId, event })) {
          console.log(`[GAME EVENT] ${shortPeerId}: ${JSON.stringify(event)}`)
        }
      } else if (message.type === 'CHAT') {
        const text = message.payload?.text

        if (typeof text !== 'string') {
          console.log(`[PROTOCOL ERROR] ${shortPeerId}: CHAT payload.text must be a string`)
          conn.destroy()
          return
        }

        console.log(`\n[${shortPeerId}] ${text}`)
        process.stdout.write('> ')
      } else {
        console.log(`[PROTOCOL] Ignoring unknown message type: ${message.type}`)
      }
    },
    onError: error => {
      console.log(`[PROTOCOL ERROR] ${shortPeerId}: ${error.message}`)
      conn.destroy()
    }
  })

  conn.on('data', decode)

  send(conn, {
    type: 'HELLO',
    payload: {
      role: 'player',
      peerId: selfId,
      roomId
    }
  })

  send(conn, {
    type: 'JOIN',
    playerId: selfId,
    payload: { name: session.players.get(selfId).name }
  })

  conn.on('close', () => {
    connections.delete(conn)
    const player = session.players.get(peerId)
    session.removePlayer(peerId)

    console.log()
    console.log(`[DISCONNECT] ${player?.name || shortPeerId}`)
    console.log(`[NETWORK] ${connections.size} peer(s) connected`)
    console.log()
  })

  conn.on('error', err => {
    console.log(`[ERROR] ${shortPeerId}: ${err.message}`)
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

  if (message === '/players') {
    showPlayers()
  } else if (message === '/ready') {
    session.setReady(selfId, true)
    broadcast({
      type: 'READY',
      playerId: selfId,
      payload: { ready: true }
    })
    console.log('[SESSION] You are ready')
  } else if (message === '/start') {
    const result = session.canStart()

    if (!result.ok) {
      console.log(`[SESSION] Cannot start: ${result.reason}`)
    } else {
      const start = {
        type: 'START',
        playerId: selfId,
        payload: {
          seed: crypto.randomBytes(16).toString('hex'),
          players: session.orderedPlayers.map(player => player.playerId)
        }
      }

      broadcast(start)
      handleStart(start, selfId)
    }
  } else if (message === '/quit') {
    process.emit('SIGINT')
    return
  } else {
    broadcast({
      type: 'CHAT',
      playerId: selfId,
      payload: { text: message }
    })

    console.log(`[YOU] ${message}`)
  }

  rl.prompt()
})

async function shutdown () {
  if (shuttingDown) return
  shuttingDown = true

  console.log()
  console.log('[SWARM] Leaving network...')

  if (session.isCoordinator && connections.size > 0) {
    const event = {
      type: 'GAME_OVER',
      payload: {
        winnerId: null,
        reason: 'ABORTED'
      }
    }

    console.log('[SESSION] Coordinator ended the game')
    await broadcastAndFlush({
      type: 'GAME_EVENT',
      playerId: selfId,
      payload: { event }
    })
  }

  rl.close()
  randomGame?.stop()

  await swarm.destroy()

  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTSTP', shutdown)
