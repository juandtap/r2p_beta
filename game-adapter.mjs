import { validateGameEvent } from './game-protocol.mjs'

export class GameAdapter {
  constructor ({ sendEvent, onError = () => {} }) {
    this.game = null
    this.sendEvent = sendEvent
    this.onError = onError
    this.lastPlayerStateSeq = new Map()
  }

  attach (game) {
    if (!game || typeof game.start !== 'function') {
      throw new Error('Game must implement start(context)')
    }

    if (typeof game.handleRemoteEvent !== 'function') {
      throw new Error('Game must implement handleRemoteEvent(message)')
    }

    this.game = game
  }

  send (event) {
    try {
      this.sendEvent(validateGameEvent(event))
      return true
    } catch (error) {
      this.onError(error)
      return false
    }
  }

  start (context) {
    if (!this.game) return false
    this.game.start(context)
    return true
  }

  receive (message) {
    try {
      validateGameEvent(message.event)

      if (message.event.type === 'PLAYER_STATE') {
        const previous = this.lastPlayerStateSeq.get(message.playerId) ?? -1
        if (message.event.payload.seq <= previous) return true
        this.lastPlayerStateSeq.set(message.playerId, message.event.payload.seq)
      }

      if (!this.game) return false
      this.game.handleRemoteEvent(message)
      return true
    } catch (error) {
      this.onError(error)
      return false
    }
  }
}
