import { ANSI_SPRITES } from './ansi-sprites.mjs'
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  PLAYER_SPRITE_HEIGHT,
  PLAYER_SPRITE_WIDTH
} from './layout.mjs'

const ANSI = {
  clear: '\x1b[2J\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  reset: '\x1b[0m',
  cyan: '\x1b[96m',
  green: '\x1b[92m',
  red: '\x1b[91m',
  yellow: '\x1b[93m',
  magenta: '\x1b[95m',
  dim: '\x1b[2m'
}

export class AnsiTui {
  constructor ({ game, input = process.stdin, output = process.stdout, onExit }) {
    this.game = game
    this.input = input
    this.output = output
    this.onExit = onExit
    this.attackTimer = null
    this.animationTimer = null
    this.animationFrame = 0
    this.onData = chunk => {
      for (const key of splitKeys(chunk.toString())) this.handleInput(key)
    }
  }

  open () {
    if (!this.input.isTTY || !this.output.isTTY) {
      throw new Error('The game requires an interactive terminal (TTY)')
    }

    this.input.setRawMode(true)
    this.input.resume()
    this.input.on('data', this.onData)
    this.output.write(ANSI.hideCursor)
    this.animationTimer = setInterval(() => {
      if (this.game.phase !== 'PLAYING') return
      this.animationFrame += 1
      this.render()
    }, 100)
    this.render()
  }

  close () {
    clearTimeout(this.attackTimer)
    clearInterval(this.animationTimer)
    this.input.off('data', this.onData)
    if (this.input.isTTY) this.input.setRawMode(false)
    this.output.write(`${ANSI.reset}${ANSI.showCursor}\n`)
  }

  handleInput (key) {
    if (key === '\u0003' || key === '\u001b') {
      this.onExit()
      return
    }

    if (this.game.phase === 'MENU') {
      if (['w', 'W', '\x1b[A'].includes(key)) this.game.selectMenu(-1)
      if (['s', 'S', '\x1b[B'].includes(key)) this.game.selectMenu(1)
      if (key === '\r' || key === '\n' || key === ' ') {
        if (this.game.menuIndex === 0) this.game.start()
        else this.onExit()
      }
      return
    }

    if (this.game.phase === 'GAME_OVER') {
      if (key === '\r' || key === '\n' || key === ' ') this.onExit()
      return
    }

    const direction = directionForKey(key)
    if (direction) this.game.move(direction)

    if (key === ' ') {
      this.game.attack()
      clearTimeout(this.attackTimer)
      this.attackTimer = setTimeout(() => this.game.idle(), 140)
    }
  }

  render () {
    if (this.game.phase === 'MENU') return this.renderMenu()
    if (this.game.phase === 'GAME_OVER') return this.renderEnd('GAME OVER', ANSI.red)

    const grid = Array.from({ length: GRID_HEIGHT }, (_, y) =>
      Array.from({ length: GRID_WIDTH }, (_, x) =>
        x === 0 || x === GRID_WIDTH - 1 || y === 0 || y === GRID_HEIGHT - 1
          ? '#'
          : '.'
      )
    )
    const { exit, roomId } = this.game.currentRoom
    placeExit(grid, exit)

    for (const remote of this.game.remotePlayers.values()) {
      if (remote.roomId !== roomId) continue
      placeSprite(grid, remote.x, remote.y, spriteFor(remote.state, remote.action, this.animationFrame))
    }

    placeSprite(
      grid,
      this.game.player.x,
      this.game.player.y,
      spriteFor(this.game.player.state, this.game.player.action, this.animationFrame)
    )

    const hud = `${ANSI.cyan}ALEPH ROGUE${ANSI.reset}  Room ${this.game.roomIndex + 1}/${this.game.rooms.length}  ` +
      `State ${this.game.player.state}  Action ${this.game.player.action}`
    const controls = `${ANSI.dim}WASD/Arrows move | Space attack | Esc exit | highlighted EXIT changes room${ANSI.reset}`
    const resolution = `${ANSI.dim}1200×800 logical | 120×40 cells | character sprite 8×6 cells${ANSI.reset}`
    this.output.write(
      ANSI.clear + hud + '\n' + controls + '\n' + resolution + '\n' +
      grid.map(row => row.join('')).join('\n')
    )
  }

  renderMenu () {
    const options = ['Start', 'Exit']
    const lines = [
      '',
      `${ANSI.cyan}          ALEPH ROGUE${ANSI.reset}`,
      '',
      '      P2P BATTLE ROYALE',
      '',
      ...options.map((option, index) =>
        `      ${index === this.game.menuIndex ? `${ANSI.yellow}> ${option}${ANSI.reset}` : `  ${option}`}`
      ),
      '',
      '  HOW TO PLAY',
      '  Move:   W A S D or Arrow Keys',
      '  Attack: Space (one hit eliminates)',
      '  Goal:   Use EXIT doors and be the last player alive',
      '  Exit:   Escape or Ctrl+C',
      '',
      `${ANSI.dim}  W/S or arrows, Enter or Space to select${ANSI.reset}`
    ]
    this.output.write(ANSI.clear + lines.join('\n'))
  }

  renderEnd (title, color) {
    this.output.write(
      ANSI.clear +
      `\n\n${color}          ${title}${ANSI.reset}\n\n` +
      '      Press Enter or Space to exit'
    )
  }
}

function directionForKey (key) {
  if (key === 'w' || key === 'W' || key === '\x1b[A') return 'up'
  if (key === 'd' || key === 'D' || key === '\x1b[C') return 'right'
  if (key === 's' || key === 'S' || key === '\x1b[B') return 'down'
  if (key === 'a' || key === 'A' || key === '\x1b[D') return 'left'
  return null
}

function splitKeys (input) {
  const keys = []

  for (let index = 0; index < input.length;) {
    if (input[index] === '\x1b' && input[index + 1] === '[' && index + 2 < input.length) {
      keys.push(input.slice(index, index + 3))
      index += 3
    } else {
      keys.push(input[index])
      index += 1
    }
  }

  return keys
}

function spriteFor (state, action, frame) {
  const name = state === 'DEAD'
    ? 'dead'
    : action === 'attacking'
      ? 'attack'
      : action === 'movement'
        ? 'walk'
        : 'idle'
  const frames = ANSI_SPRITES[name]
  return frames[frame % frames.length]
}

function placeSprite (grid, centerX, centerY, sprite) {
  const startX = clamp(
    centerX - Math.floor(PLAYER_SPRITE_WIDTH / 2),
    1,
    GRID_WIDTH - PLAYER_SPRITE_WIDTH - 1
  )
  const startY = clamp(
    centerY - Math.floor(PLAYER_SPRITE_HEIGHT / 2),
    1,
    GRID_HEIGHT - PLAYER_SPRITE_HEIGHT - 1
  )

  for (let row = 0; row < PLAYER_SPRITE_HEIGHT; row++) {
    grid[startY + row][startX] = sprite[row]
    for (let column = 1; column < PLAYER_SPRITE_WIDTH; column++) {
      grid[startY + row][startX + column] = ''
    }
  }
}

function clamp (value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function placeExit (grid, exit) {
  const label = exit.side === 'top' || exit.side === 'bottom'
    ? '[EXIT]'
    : 'EXIT'

  if (exit.side === 'top' || exit.side === 'bottom') {
    const start = clamp(exit.x - Math.floor(label.length / 2), 1, GRID_WIDTH - label.length - 1)
    for (let index = 0; index < label.length; index++) {
      grid[exit.y][start + index] = `${ANSI.magenta}${label[index]}${ANSI.reset}`
    }
    return
  }

  const start = clamp(exit.y - Math.floor(label.length / 2), 1, GRID_HEIGHT - label.length - 1)
  for (let index = 0; index < label.length; index++) {
    grid[start + index][exit.x] = `${ANSI.magenta}${label[index]}${ANSI.reset}`
  }
}
