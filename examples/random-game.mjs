export function createRandomGame ({ sendGameEvent, log = console.log }) {
  let timer = null
  let seq = 0
  let x = 0
  let y = 0

  function sendState () {
    const directions = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0]
    ]
    const [dx, dy] = directions[Math.floor(Math.random() * directions.length)]

    x += dx
    y += dy
    seq += 1

    const event = {
      type: 'PLAYER_STATE',
      payload: {
        roomId: roomFor(x, y),
        state: 'ALIVE',
        action: 'movement',
        x,
        y,
        seq
      }
    }

    sendGameEvent(event)
    log(`[RANDOM GAME] Sent state seq=${seq} room=${event.payload.roomId} pos=(${x},${y})`)
  }

  return {
    start ({ selfId, seed, players }) {
      if (timer !== null) return

      log(`[RANDOM GAME] Started seed=${seed} self=${selfId.slice(0, 8)} players=${players.length}`)
      sendState()
      timer = setInterval(sendState, 500)
    },

    handleRemoteEvent ({ playerId, event }) {
      if (event.type === 'GAME_OVER') {
        log(`[RANDOM GAME] Game over: ${event.payload.reason}`)
        this.stop()
        return
      }

      if (event.type !== 'PLAYER_STATE') return

      const { roomId, state, x, y, seq } = event.payload
      log(`[RANDOM GAME] Remote ${playerId.slice(0, 8)} seq=${seq} room=${roomId} state=${state} pos=(${x},${y})`)
    },

    stop () {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }
  }
}

function roomFor (x, y) {
  const roomX = Math.floor(x / 5)
  const roomY = Math.floor(y / 5)
  return `room-${roomX}-${roomY}`
}
