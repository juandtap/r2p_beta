export class Session {
  constructor ({ selfId, selfName }) {
    this.selfId = selfId
    this.players = new Map()
    this.addPlayer(selfId, selfName)
  }

  addPlayer (playerId, name = defaultName(playerId)) {
    const current = this.players.get(playerId)
    const player = {
      playerId,
      name,
      ready: current?.ready || false
    }

    this.players.set(playerId, player)
    return player
  }

  removePlayer (playerId) {
    if (playerId === this.selfId) return false
    return this.players.delete(playerId)
  }

  setReady (playerId, ready = true) {
    const player = this.players.get(playerId)
    if (!player) return false

    player.ready = ready
    return true
  }

  get coordinatorId () {
    return [...this.players.keys()].sort()[0]
  }

  get isCoordinator () {
    return this.coordinatorId === this.selfId
  }

  get orderedPlayers () {
    return [...this.players.values()]
      .sort((a, b) => a.playerId.localeCompare(b.playerId))
  }

  canStart () {
    if (!this.isCoordinator) {
      return { ok: false, reason: 'Only the coordinator can start the match' }
    }

    if (this.players.size < 2) {
      return { ok: false, reason: 'At least 2 players are required' }
    }

    const waiting = this.orderedPlayers.filter(player => !player.ready)
    if (waiting.length > 0) {
      return {
        ok: false,
        reason: `Waiting for: ${waiting.map(player => player.name).join(', ')}`
      }
    }

    return { ok: true }
  }
}

export function defaultName (playerId) {
  return `Player-${playerId.slice(0, 8)}`
}
