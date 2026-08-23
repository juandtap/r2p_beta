import assert from 'node:assert/strict'
import test from 'node:test'
import { GRID_HEIGHT, GRID_WIDTH, createRooms } from '../game/layout.mjs'
import { RogueGame } from '../game/rogue-game.mjs'

test('creates two deterministic rooms with exits on the boundary', () => {
  const first = createRooms('same-seed')
  const second = createRooms('same-seed')

  assert.deepEqual(first, second)
  assert.equal(first.length, 2)

  for (const room of first) {
    const { x, y } = room.exit
    assert.equal(x === 0 || x === GRID_WIDTH - 1 || y === 0 || y === GRID_HEIGHT - 1, true)
  }
})

test('emits valid state while moving and attacking', () => {
  const events = []
  const game = new RogueGame({ sendGameEvent: event => events.push(event) })
  game.start({ selfId: 'player-a', seed: 'test', players: ['player-a'] })
  game.move('right')
  game.attack()

  assert.deepEqual(events.map(event => event.payload.action), [
    'idle',
    'movement',
    'attacking'
  ])
  assert.deepEqual(events.map(event => event.payload.seq), [1, 2, 3])
})

test('generates the full dungeon and assigns different starting rooms', () => {
  const players = ['player-b', 'player-a', 'player-c']
  const first = new RogueGame()
  const second = new RogueGame()

  first.start({ selfId: 'player-a', seed: 'shared', players })
  second.start({ selfId: 'player-b', seed: 'shared', players })

  assert.deepEqual(first.rooms, second.rooms)
  assert.equal(first.rooms.length, 3)
  assert.notEqual(first.currentRoom.roomId, second.currentRoom.roomId)
})

test('crosses exits without ending the battle royale', () => {
  const game = new RogueGame()
  game.start({ seed: 'exit-test' })

  const firstRoom = game.currentRoom.roomId
  walkIntoCurrentExit(game)
  assert.equal(game.roomIndex, 1)
  assert.equal(game.phase, 'PLAYING')

  walkIntoCurrentExit(game)
  assert.equal(game.currentRoom.roomId, firstRoom)
  assert.equal(game.phase, 'PLAYING')
})

function walkIntoCurrentExit (game) {
  const { x, y, side } = game.currentRoom.exit

  if (side === 'top') {
    game.player.x = x
    game.player.y = 1
    game.move('up')
  } else if (side === 'right') {
    game.player.x = GRID_WIDTH - 2
    game.player.y = y
    game.move('right')
  } else if (side === 'bottom') {
    game.player.x = x
    game.player.y = GRID_HEIGHT - 2
    game.move('down')
  } else {
    game.player.x = 1
    game.player.y = y
    game.move('left')
  }
}
