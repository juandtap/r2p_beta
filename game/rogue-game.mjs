import {
  GRID_HEIGHT,
  GRID_WIDTH,
  createRooms
} from './layout.mjs'

const DIRECTIONS = {
  up: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 }
}

export class RogueGame {
  constructor ({ sendGameEvent = () => {}, onChange = () => {} } = {}) {
    this.sendGameEvent = sendGameEvent
    this.onChange = onChange
    this.phase = 'MENU'
    this.menuIndex = 0
    this.selfId = 'local-player'
    this.rooms = []
    this.roomIndex = 0
    this.player = null
    this.remotePlayers = new Map()
    this.seq = 0
  }

  start ({ selfId = 'local-player', seed = String(Date.now()), players = [selfId] } = {}) {
    this.selfId = selfId
    this.players = [...players].sort()
    this.rooms = createRooms(seed, this.players.length)
    const playerIndex = this.players.indexOf(selfId)
    this.roomIndex = playerIndex === -1 ? 0 : playerIndex
    this.seq = 0
    this.remotePlayers.clear()
    this.player = {
      x: Math.floor(GRID_WIDTH / 2),
      y: Math.floor(GRID_HEIGHT / 2),
      state: 'ALIVE',
      action: 'idle',
      facing: 'down'
    }
    this.phase = 'PLAYING'
    this.emitState()
    this.onChange()
  }

  move (direction) {
    if (this.phase !== 'PLAYING') return false
    const delta = DIRECTIONS[direction]
    if (!delta) return false

    this.player.facing = direction
    const next = {
      x: this.player.x + delta.dx,
      y: this.player.y + delta.dy
    }
    const exit = this.currentRoom.exit

    if (next.x === exit.x && next.y === exit.y) {
      this.enterExit()
      return true
    }

    if (!isInterior(next.x, next.y)) {
      this.player.action = 'idle'
      this.onChange()
      return false
    }

    this.player.x = next.x
    this.player.y = next.y
    this.player.action = 'movement'
    this.emitState()
    this.onChange()
    return true
  }

  attack () {
    if (this.phase !== 'PLAYING') return false
    this.player.action = 'attacking'
    this.emitState()
    this.onChange()
    return true
  }

  idle () {
    if (this.phase !== 'PLAYING' || this.player.action === 'idle') return
    this.player.action = 'idle'
    this.emitState()
    this.onChange()
  }

  handleRemoteEvent ({ playerId, event }) {
    if (event.type === 'GAME_OVER') {
      this.phase = 'GAME_OVER'
      this.gameOver = event.payload
      this.onChange()
      return
    }

    if (event.type !== 'PLAYER_STATE') return
    this.remotePlayers.set(playerId, { ...event.payload })
    this.onChange()
  }

  selectMenu (delta) {
    if (this.phase !== 'MENU') return
    this.menuIndex = (this.menuIndex + delta + 2) % 2
    this.onChange()
  }

  get currentRoom () {
    return this.rooms[this.roomIndex]
  }

  get attackPosition () {
    if (!this.player || this.player.action !== 'attacking') return null
    const delta = DIRECTIONS[this.player.facing]
    return {
      x: this.player.x + delta.dx,
      y: this.player.y + delta.dy
    }
  }

  emitState () {
    this.seq += 1
    this.sendGameEvent({
      type: 'PLAYER_STATE',
      payload: {
        roomId: this.currentRoom.roomId,
        state: this.player.state,
        action: this.player.action,
        x: this.player.x,
        y: this.player.y,
        seq: this.seq
      }
    })
  }

  enterExit () {
    const nextRoomId = this.currentRoom.nextRoomId
    this.roomIndex = this.rooms.findIndex(room => room.roomId === nextRoomId)
    this.player.x = Math.floor(GRID_WIDTH / 2)
    this.player.y = Math.floor(GRID_HEIGHT / 2)
    this.player.action = 'movement'
    this.emitState()
    this.onChange()
  }
}

function isInterior (x, y) {
  return x > 0 && x < GRID_WIDTH - 1 && y > 0 && y < GRID_HEIGHT - 1
}
