import Hyperswarm from 'hyperswarm'
import crypto from 'bare-crypto'
import process from 'bare-process'
import Readline from 'bare-readline'
import { createServer, connect as tcpConnect } from 'bare-tcp'
import b4a from 'b4a'
import path from 'bare-path'
import fs from 'bare-fs'
import { fileURLToPath } from 'bare-url'
import {
  PROTOCOL_VERSION,
  createMessageDecoder,
  encodeMessage
} from './protocol.mjs'
import { Session, defaultName } from './session.mjs'
import { GameAdapter } from './game-adapter.mjs'
import { createRandomGame } from './examples/random-game.mjs'
import { executeMinecraftAction } from './minecraft-executor.mjs'
import { StuipId } from './stuip-id.mjs'

// Tunneling state
const activeTunnels = new Map() // localPort -> { server, peerId, serverId }
const localStreams = new Map() // streamId -> { socket, peerId }
const remoteStreams = new Map() // streamId -> { socket, peerId }

function getServerPort(serverId) {
  try {
    const serversDir = fileURLToPath(new URL('./servers', import.meta.url))
    const propertiesPath = path.join(serversDir, serverId, 'server.properties')
    const content = fs.readFileSync(propertiesPath, 'utf8')
    const match = content.match(/^server-port=(\d+)/m)
    if (match) {
      return parseInt(match[1], 10)
    }
  } catch {
    // Ignore and fallback
  }
  return 25565
}

const room = process.argv[2]
const randomGameEnabled = process.argv.includes('--random-game')

if (!room) {
  console.error('Usage: bare peer.mjs <room-name>')
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
const connectionsByPeerId = new Map()
const peerAliases = new Map()
let shuttingDown = false
const stuip = new StuipId({
  connections: connectionsByPeerId,
  send,
  executeAction: executeMinecraftAction
})
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

function send(conn, message) {
  conn.write(encodeMessage({
    v: PROTOCOL_VERSION,
    ...message
  }))
}

function broadcast(message) {
  for (const conn of connections) send(conn, message)
}

async function broadcastAndFlush(message) {
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

function showPlayers() {
  console.log('\nPlayers:')

  for (const player of session.orderedPlayers) {
    const state = player.ready ? 'READY' : 'WAITING'
    const coordinator = player.playerId === session.coordinatorId
      ? ' [COORDINATOR]'
      : ''
    const you = player.playerId === selfId ? ' [YOU]' : ''

    const alias = [...peerAliases].find(([, peerId]) => peerId === player.playerId)?.[0]
    console.log(`- ${alias ? `${alias} → ` : ''}${player.name} [${state}]${coordinator}${you}`)
  }

  console.log()
}

function addPeerAlias(peerId) {
  if ([...peerAliases.values()].includes(peerId)) return
  let number = 1
  while (peerAliases.has(`peer${number}`)) number++
  peerAliases.set(`peer${number}`, peerId)
}

function resolvePeer(nameOrPrefix) {
  if (!nameOrPrefix) return { error: 'Peer is required' }
  const aliased = peerAliases.get(nameOrPrefix.toLowerCase())
  if (aliased && connectionsByPeerId.has(aliased)) return { peerId: aliased }

  const matches = [...connectionsByPeerId.keys()]
    .filter(peerId => peerId.startsWith(nameOrPrefix))
  if (matches.length !== 1) {
    return { error: `Peer must match one connection (matches: ${matches.length})` }
  }
  return { peerId: matches[0] }
}

function handleStart(message, peerId) {
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
console.log('=== STUIP-ID P2P SERVER MANAGER ===')
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
  connectionsByPeerId.set(peerId, conn)
  addPeerAlias(peerId)
  const peerAlias = [...peerAliases].find(([, id]) => id === peerId)?.[0]
  session.addPlayer(peerId)

  console.log(`[PEER] ${shortPeerId} discovered`)
  console.log(`[ALIAS] ${peerAlias}`)
  console.log(`[DIRECTION] ${info.client ? 'outgoing' : 'incoming'}`)
  console.log(`[CONNECTION] Successful ✓`)
  console.log(`[NETWORK] ${connections.size} peer(s) connected`)
  console.log()

  const decode = createMessageDecoder({
    onMessage: message => {
      if (message.type === 'EXEC_ACTION' || message.type === 'ACTION_RESULT') {
        stuip.handleMessage(message, peerId, conn).catch(error => {
          console.error(`[ACTION ERROR] ${error.message}`)
        })
      } else if (message.type === 'HELLO') {
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
      } else if (message.type === 'TUNNEL_OPEN') {
        const { streamId, serverId } = message
        if (typeof streamId !== 'string' || typeof serverId !== 'string') {
          console.log(`[TUNNEL ERROR] Invalid TUNNEL_OPEN message from ${shortPeerId}`)
          return
        }

        const port = getServerPort(serverId)
        console.log(`\n[TUNNEL] Peer ${shortPeerId} requested tunnel connection to Minecraft server ${serverId} (port ${port})`)
        process.stdout.write('> ')

        const socket = tcpConnect(port, '127.0.0.1', () => {
          remoteStreams.set(streamId, { socket, peerId })

          socket.on('data', chunk => {
            const peerConn = connectionsByPeerId.get(peerId)
            if (peerConn) {
              send(peerConn, {
                type: 'TUNNEL_DATA',
                streamId,
                data: b4a.toString(chunk, 'base64')
              })
            }
          })

          socket.on('close', () => {
            remoteStreams.delete(streamId)
            const peerConn = connectionsByPeerId.get(peerId)
            if (peerConn) {
              send(peerConn, {
                type: 'TUNNEL_CLOSE',
                streamId
              })
            }
          })

          socket.on('error', err => {
            console.error(`[TUNNEL Remote Socket Error] ${err.message}`)
            socket.destroy()
          })
        })

        socket.on('error', err => {
          console.error(`\n[TUNNEL ERROR] Failed to connect to local Minecraft server ${serverId} (port ${port}): ${err.message}`)
          process.stdout.write('> ')
          const peerConn = connectionsByPeerId.get(peerId)
          if (peerConn) {
            send(peerConn, {
              type: 'TUNNEL_CLOSE',
              streamId
            })
          }
        })
      } else if (message.type === 'TUNNEL_DATA') {
        const { streamId, data } = message
        if (typeof streamId !== 'string' || typeof data !== 'string') {
          return
        }

        const localStream = localStreams.get(streamId)
        if (localStream) {
          localStream.socket.write(b4a.from(data, 'base64'))
        } else {
          const remoteStream = remoteStreams.get(streamId)
          if (remoteStream) {
            remoteStream.socket.write(b4a.from(data, 'base64'))
          }
        }
      } else if (message.type === 'TUNNEL_CLOSE') {
        const { streamId } = message
        if (typeof streamId !== 'string') {
          return
        }

        const localStream = localStreams.get(streamId)
        if (localStream) {
          localStream.socket.destroy()
          localStreams.delete(streamId)
        } else {
          const remoteStream = remoteStreams.get(streamId)
          if (remoteStream) {
            remoteStream.socket.destroy()
            remoteStreams.delete(streamId)
          }
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
    if (connectionsByPeerId.get(peerId) === conn) connectionsByPeerId.delete(peerId)
    for (const [alias, id] of peerAliases) {
      if (id === peerId) peerAliases.delete(alias)
    }
    stuip.peerDisconnected(peerId)
    const player = session.players.get(peerId)
    session.removePlayer(peerId)

    // Close local streams and servers for this peerId
    for (const [streamId, info] of localStreams) {
      if (info.peerId === peerId) {
        info.socket.destroy()
        localStreams.delete(streamId)
      }
    }
    for (const [port, info] of activeTunnels) {
      if (info.peerId === peerId) {
        info.server.close()
        activeTunnels.delete(port)
        console.log(`[TUNNEL] Closed tunnel on port ${port} because peer disconnected`)
      }
    }
    // Close remote streams for this peerId
    for (const [streamId, info] of remoteStreams) {
      if (info.peerId === peerId) {
        info.socket.destroy()
        remoteStreams.delete(streamId)
      }
    }

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
console.log('[INPUT] /status|/start|/stop|/restart <peer> <server>')
console.log('[INPUT] /create <peer> <server> <template.jar>')
console.log('[INPUT] /list <peer> | /delete <peer> <server>')
console.log('[INPUT] /config <peer> <server> <key> <value>')
console.log('[INPUT] /command <peer> <server> <minecraft-command>')
console.log('[INPUT] /tunnel <peer> <server> [localPort] (Default: 25565)')
console.log('[INPUT] /tunnels (List tunnels) | /untunnel <port>')
console.log()

function startTunnel(peerId, serverId, localPort) {
  if (activeTunnels.has(localPort)) {
    console.log(`[TUNNEL] Port ${localPort} is already being used for a tunnel.`)
    return
  }

  const server = createServer(socket => {
    const streamId = crypto.randomBytes(16).toString('hex')
    localStreams.set(streamId, { socket, peerId })

    const peerConn = connectionsByPeerId.get(peerId)
    if (!peerConn) {
      console.log(`[TUNNEL] Peer ${peerId.slice(0, 8)} disconnected. Closing tunnel stream.`)
      socket.destroy()
      localStreams.delete(streamId)
      return
    }

    // Request the remote peer to open a tunnel connection
    send(peerConn, {
      type: 'TUNNEL_OPEN',
      streamId,
      serverId
    })

    socket.on('data', chunk => {
      const peerConn = connectionsByPeerId.get(peerId)
      if (peerConn) {
        send(peerConn, {
          type: 'TUNNEL_DATA',
          streamId,
          data: b4a.toString(chunk, 'base64')
        })
      }
    })

    socket.on('close', () => {
      localStreams.delete(streamId)
      const peerConn = connectionsByPeerId.get(peerId)
      if (peerConn) {
        send(peerConn, {
          type: 'TUNNEL_CLOSE',
          streamId
        })
      }
    })

    socket.on('error', err => {
      console.error(`[TUNNEL Socket Error] ${err.message}`)
      socket.destroy()
    })
  })

  server.listen(localPort, '127.0.0.1', () => {
    console.log(`\n[TUNNEL] Direct connection tunnel established!`)
    console.log(`[TUNNEL] You can now connect your Minecraft client to: localhost:${localPort}`)
    activeTunnels.set(localPort, { server, peerId, serverId })
    rl.prompt()
  })

  server.on('error', err => {
    console.error(`\n[TUNNEL Error] Failed to start local server on port ${localPort}: ${err.message}`)
    activeTunnels.delete(localPort)
    rl.prompt()
  })
}

const rl = new Readline({
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
  } else if (message === '/tunnels') {
    if (activeTunnels.size === 0) {
      console.log('[TUNNEL] No active tunnels')
    } else {
      console.log('[TUNNEL] Active tunnels:')
      for (const [port, info] of activeTunnels) {
        const alias = [...peerAliases].find(([, peerId]) => peerId === info.peerId)?.[0] || info.peerId.slice(0, 8)
        console.log(`- localhost:${port} -> ${alias}:${info.serverId}`)
      }
    }
  } else if (message.startsWith('/untunnel ')) {
    const [, portStr] = message.split(/\s+/)
    const port = parseInt(portStr, 10)
    if (isNaN(port)) {
      console.log('[TUNNEL] Usage: /untunnel <port>')
    } else if (!activeTunnels.has(port)) {
      console.log(`[TUNNEL] No active tunnel on port ${port}`)
    } else {
      const { server, peerId } = activeTunnels.get(port)
      server.close()
      activeTunnels.delete(port)
      console.log(`[TUNNEL] Closed tunnel on port ${port}`)

      // Close all local streams for this peerId
      for (const [streamId, info] of localStreams) {
        if (info.peerId === peerId) {
          info.socket.destroy()
          localStreams.delete(streamId)
        }
      }
    }
  } else if (message.startsWith('/tunnel ')) {
    const [, peerPrefix, serverId, localPortStr] = message.split(/\s+/)
    const resolved = resolvePeer(peerPrefix)
    const localPort = localPortStr ? parseInt(localPortStr, 10) : 25565

    if (!peerPrefix || !serverId) {
      console.log('[TUNNEL] Usage: /tunnel <peer> <server> [localPort]')
    } else if (resolved.error) {
      console.log(`[TUNNEL] ${resolved.error}`)
    } else if (isNaN(localPort) || localPort <= 0 || localPort > 65535) {
      console.log('[TUNNEL] Invalid local port')
    } else {
      startTunnel(resolved.peerId, serverId, localPort)
    }
  } else if (message.startsWith('/command ')) {
    const parts = message.split(/\s+/)
    const peerPrefix = parts[1]
    const serverId = parts[2]
    const commandText = parts.slice(3).join(' ')
    const resolved = resolvePeer(peerPrefix)

    if (!peerPrefix || !serverId || !commandText) {
      console.log('[ACTION] Usage: /command <peer> <server-id> <minecraft-command>')
    } else if (resolved.error) {
      console.log(`[ACTION] ${resolved.error}`)
    } else {
      console.log(`[ACTION] Sending command to ${serverId} on ${peerPrefix}...`)
      stuip.sendAction(resolved.peerId, {
        action: 'SERVER_COMMAND',
        serverId,
        payload: { command: commandText }
      }).then(showActionResult).catch(showActionError)
    }
  } else if (message.startsWith('/delete ')) {
    const [, peerPrefix, serverId] = message.split(/\s+/)
    const resolved = resolvePeer(peerPrefix)

    if (!peerPrefix || !serverId) {
      console.log('[ACTION] Usage: /delete <peer> <server-id>')
    } else if (resolved.error) {
      console.log(`[ACTION] ${resolved.error}`)
    } else {
      console.log(`[ACTION] Deleting server ${serverId} on ${peerPrefix}...`)
      stuip.sendAction(resolved.peerId, {
        action: 'SERVER_DELETE',
        serverId
      }).then(showActionResult).catch(showActionError)
    }
  } else if (message.startsWith('/config ')) {
    const [, peerPrefix, serverId, key, value] = message.split(/\s+/)
    const resolved = resolvePeer(peerPrefix)

    if (!peerPrefix || !serverId || !key || !value) {
      console.log('[ACTION] Usage: /config <peer> <server-id> <key> <value>')
    } else if (resolved.error) {
      console.log(`[ACTION] ${resolved.error}`)
    } else {
      console.log(`[ACTION] Setting config ${key}=${value} on ${serverId} at ${peerPrefix}...`)
      stuip.sendAction(resolved.peerId, {
        action: 'SERVER_UPDATE_CONFIG',
        serverId,
        payload: { key, value }
      }).then(showActionResult).catch(showActionError)
    }
  } else if (message.startsWith('/list ')) {
    const [, peerPrefix] = message.split(/\s+/)
    const resolved = resolvePeer(peerPrefix)

    if (!peerPrefix) {
      console.log('[ACTION] Usage: /list <peer>')
    } else if (resolved.error) {
      console.log(`[ACTION] ${resolved.error}`)
    } else {
      console.log(`[ACTION] Listing servers on ${peerPrefix}...`)
      stuip.sendAction(resolved.peerId, {
        action: 'SERVER_LIST'
      }).then(showActionResult).catch(showActionError)
    }
  } else if (message.startsWith('/create ')) {
    const [, peerPrefix, serverId, template] = message.split(/\s+/)
    const resolved = resolvePeer(peerPrefix)

    if (!peerPrefix || !serverId || !template) {
      console.log('[ACTION] Usage: /create <peer-or-alias> <server-id> <template-or-alias>')
    } else if (resolved.error) {
      console.log(`[ACTION] ${resolved.error}`)
    } else {
      console.log(`[ACTION] Creating ${serverId} on ${peerPrefix} from ${template}...`)
      stuip.sendAction(resolved.peerId, {
        action: 'SERVER_CREATE',
        serverId,
        payload: { template }
      }).then(showActionResult).catch(showActionError)
    }
  } else if (/^\/(status|start|stop|restart)\s/.test(message)) {
    const [command, peerPrefix, serverId] = message.split(/\s+/)
    const resolved = resolvePeer(peerPrefix)

    if (!peerPrefix || !serverId) {
      console.log(`[ACTION] Usage: ${command} <peer-id-or-prefix> <server-id>`)
    } else if (resolved.error) {
      console.log(`[ACTION] ${resolved.error}`)
    } else {
      const action = {
        '/status': 'SERVER_STATUS',
        '/start': 'SERVER_START',
        '/stop': 'SERVER_STOP',
        '/restart': 'SERVER_RESTART'
      }[command]

      stuip.sendAction(resolved.peerId, {
        action,
        serverId,
        payload: {}
      }).then(showActionResult).catch(showActionError)
    }
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

function showActionResult(result) {
  console.log(`\n[ACTION RESULT] ${result.success ? 'SUCCESS' : 'FAILED'} (exit ${result.exitCode})`)
  if (result.stdout) process.stdout.write(`${result.stdout}\n`)
  if (result.stderr) process.stderr.write(`${result.stderr}\n`)
  rl.prompt()
}

function showActionError(error) {
  console.error(`[ACTION ERROR] ${error.message}`)
  rl.prompt()
}

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true

  // Close all active local tunnel servers
  for (const [port, info] of activeTunnels) {
    info.server.close()
  }
  activeTunnels.clear()

  // Destroy all active client/server stream sockets
  for (const [, info] of localStreams) {
    info.socket.destroy()
  }
  localStreams.clear()

  for (const [, info] of remoteStreams) {
    info.socket.destroy()
  }
  remoteStreams.clear()

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
