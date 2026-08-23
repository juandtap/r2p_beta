import assert from 'node:assert/strict'
import test from 'node:test'
import { actionArguments, validateActionRequest } from '../stuip-actions.mjs'

test('maps SERVER_STATUS to fixed script arguments', () => {
  assert.deepEqual(actionArguments({
    action: 'SERVER_STATUS',
    serverId: 'server-01_test',
    payload: {}
  }), ['status', 'server-01_test'])
})

test('rejects unknown actions', () => {
  assert.throws(() => validateActionRequest({
    action: 'RUN_SHELL',
    serverId: 'server01',
    payload: {}
  }), /Unknown action/)
})

test('rejects server paths and unexpected payload', () => {
  assert.throws(() => validateActionRequest({
    action: 'SERVER_STATUS',
    serverId: '../server01',
    payload: {}
  }), /serverId/)

  assert.throws(() => validateActionRequest({
    action: 'SERVER_STATUS',
    serverId: 'server01',
    payload: { command: 'rm -rf /' }
  }), /does not accept payload/)
})
