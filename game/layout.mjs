export const SCREEN_WIDTH_PX = 1200
export const SCREEN_HEIGHT_PX = 800
export const CELL_WIDTH_PX = 10
export const CELL_HEIGHT_PX = 20
export const GRID_WIDTH = Math.floor(SCREEN_WIDTH_PX / CELL_WIDTH_PX)
export const SCREEN_ROWS = Math.floor(SCREEN_HEIGHT_PX / CELL_HEIGHT_PX)
export const HUD_ROWS = 4
export const GRID_HEIGHT = SCREEN_ROWS - HUD_ROWS
export const PLAYER_SPRITE_WIDTH = 8
export const PLAYER_SPRITE_HEIGHT = 6

export function createRooms (seed, roomCount = 2) {
  const random = createRandom(seed)
  const count = Math.max(2, roomCount)
  return Array.from({ length: count }, (_, index) => ({
    ...createRoom(`room-${index + 1}`, random),
    nextRoomId: `room-${(index + 1) % count + 1}`
  }))
}

function createRoom (roomId, random) {
  const sides = ['top', 'right', 'bottom', 'left']
  const side = sides[Math.floor(random() * sides.length)]
  let x
  let y

  if (side === 'top' || side === 'bottom') {
    x = 2 + Math.floor(random() * (GRID_WIDTH - 4))
    y = side === 'top' ? 0 : GRID_HEIGHT - 1
  } else {
    x = side === 'left' ? 0 : GRID_WIDTH - 1
    y = 2 + Math.floor(random() * (GRID_HEIGHT - 4))
  }

  return { roomId, exit: { x, y, side } }
}

export function entryForExit (exit) {
  if (exit.side === 'top') return { x: exit.x, y: 1 }
  if (exit.side === 'right') return { x: GRID_WIDTH - 2, y: exit.y }
  if (exit.side === 'bottom') return { x: exit.x, y: GRID_HEIGHT - 2 }
  return { x: 1, y: exit.y }
}

function createRandom (seed) {
  let state = hashSeed(seed)

  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

function hashSeed (seed) {
  let hash = 2166136261
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
