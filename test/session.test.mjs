import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from '../session.mjs'

test('elects the lowest player id as coordinator', () => {
  const session = new Session({ selfId: 'bbbb', selfName: 'B' })
  session.addPlayer('cccc', 'C')
  session.addPlayer('aaaa', 'A')

  assert.equal(session.coordinatorId, 'aaaa')
  assert.equal(session.isCoordinator, false)
})

test('starts only when coordinator has at least two ready players', () => {
  const session = new Session({ selfId: 'aaaa', selfName: 'A' })
  session.addPlayer('bbbb', 'B')

  assert.equal(session.canStart().ok, false)

  session.setReady('aaaa')
  session.setReady('bbbb')

  assert.deepEqual(session.canStart(), { ok: true })
})

test('removes disconnected peers without limiting session size', () => {
  const session = new Session({ selfId: '0000', selfName: 'Local' })

  for (let index = 1; index <= 100; index++) {
    session.addPlayer(String(index).padStart(4, '0'))
  }

  assert.equal(session.players.size, 101)
  assert.equal(session.removePlayer('0050'), true)
  assert.equal(session.players.size, 100)
})
