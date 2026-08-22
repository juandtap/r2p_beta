import assert from 'node:assert/strict'
import test from 'node:test'
import { GameAdapter } from '../game-adapter.mjs'

test('connects a game without exposing networking details', () => {
  const sent = []
  const starts = []
  const received = []
  const adapter = new GameAdapter({ sendEvent: event => sent.push(event) })

  adapter.attach({
    start: context => starts.push(context),
    handleRemoteEvent: message => received.push(message)
  })

  adapter.start({ selfId: 'a', seed: 'seed', players: ['a', 'b'] })
  adapter.send({
    type: 'PLAYER_STATE',
    payload: { roomId: 'room-1', state: 'ALIVE', x: 1, y: 0, seq: 1 }
  })
  adapter.receive({
    playerId: 'b',
    event: {
      type: 'PLAYER_STATE',
      payload: { roomId: 'room-2', state: 'ALIVE', x: 0, y: 1, seq: 1 }
    }
  })

  assert.equal(starts.length, 1)
  assert.equal(sent[0].type, 'PLAYER_STATE')
  assert.equal(received[0].playerId, 'b')
})

test('rejects invalid game events', () => {
  const errors = []
  const adapter = new GameAdapter({
    sendEvent: () => assert.fail('invalid event must not be sent'),
    onError: error => errors.push(error)
  })

  assert.equal(adapter.send({ payload: {} }), false)
  assert.equal(errors.length, 1)
})

test('discards stale player state snapshots', () => {
  const received = []
  const adapter = new GameAdapter({ sendEvent: () => {} })
  adapter.attach({
    start: () => {},
    handleRemoteEvent: message => received.push(message)
  })

  const state = seq => ({
    playerId: 'peer-b',
    event: {
      type: 'PLAYER_STATE',
      payload: { roomId: 'room-1', state: 'ALIVE', x: seq, y: 0, seq }
    }
  })

  adapter.receive(state(2))
  adapter.receive(state(1))
  adapter.receive(state(2))

  assert.equal(received.length, 1)
  assert.equal(received[0].event.payload.seq, 2)
})
