import { encodeMessage, MAX_MESSAGE_BYTES } from './protocol.mjs'

export function validateGameEvent (event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('Game event must be an object')
  }

  if (typeof event.type !== 'string' || event.type.length === 0) {
    throw new Error('Game event type is required')
  }

  if (event.type.length > 64) {
    throw new Error('Game event type exceeds 64 characters')
  }

  if (event.type === 'PLAYER_STATE') validatePlayerState(event.payload)
  if (event.type === 'GAME_OVER') validateGameOver(event.payload)

  let encoded
  try {
    encoded = encodeMessage(event)
  } catch (error) {
    throw new Error(`Game event is not JSON serializable: ${error.message}`)
  }

  if (encoded.byteLength > MAX_MESSAGE_BYTES) {
    throw new Error('Game event exceeds maximum size')
  }

  return event
}

function validatePlayerState (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('PLAYER_STATE payload must be an object')
  }

  if (typeof payload.roomId !== 'string' || payload.roomId.length === 0) {
    throw new Error('PLAYER_STATE roomId is required')
  }

  if (!['ALIVE', 'DEAD'].includes(payload.state)) {
    throw new Error('PLAYER_STATE state must be ALIVE or DEAD')
  }

  if (!['idle', 'movement', 'attacking'].includes(payload.action)) {
    throw new Error('PLAYER_STATE action must be idle, movement or attacking')
  }

  if (!Number.isInteger(payload.x) || !Number.isInteger(payload.y)) {
    throw new Error('PLAYER_STATE x and y must be integers')
  }

  if (!Number.isSafeInteger(payload.seq) || payload.seq < 0) {
    throw new Error('PLAYER_STATE seq must be a non-negative integer')
  }
}

function validateGameOver (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('GAME_OVER payload must be an object')
  }

  if (payload.winnerId !== null && typeof payload.winnerId !== 'string') {
    throw new Error('GAME_OVER winnerId must be a string or null')
  }

  if (!['LAST_PLAYER_ALIVE', 'DRAW', 'ABORTED'].includes(payload.reason)) {
    throw new Error('Invalid GAME_OVER reason')
  }

  if (payload.reason === 'LAST_PLAYER_ALIVE' && !payload.winnerId) {
    throw new Error('LAST_PLAYER_ALIVE requires winnerId')
  }

  if (payload.reason !== 'LAST_PLAYER_ALIVE' && payload.winnerId !== null) {
    throw new Error('DRAW and ABORTED require a null winnerId')
  }
}
