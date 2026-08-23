import { AnsiTui } from './game/ansi-tui.mjs'
import { RogueGame } from './game/rogue-game.mjs'

let closed = false
let tui

function close () {
  if (closed) return
  closed = true
  tui?.close()
  process.exit(0)
}

const game = new RogueGame({
  sendGameEvent: () => {},
  onChange: () => tui?.render()
})

tui = new AnsiTui({ game, onExit: close })
tui.open()

process.on('SIGINT', close)
process.on('SIGTERM', close)
