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

test('maps SERVER_CREATE with a safe template', () => {
  assert.deepEqual(actionArguments({
    action: 'SERVER_CREATE',
    serverId: 'server01',
    payload: { template: 'minecraft-1.21.1.jar' }
  }), ['crear_servidor', 'server01', 'minecraft-1.21.1.jar'])
})

test('maps friendly template aliases', () => {
  assert.deepEqual(actionArguments({
    action: 'SERVER_CREATE',
    serverId: 'server01',
    payload: { template: 'minecraft' }
  }), ['crear_servidor', 'server01', 'minecraft-1.21.1.jar'])

  assert.deepEqual(actionArguments({
    action: 'SERVER_CREATE',
    serverId: 'forge01',
    payload: { template: 'forge' }
  }), ['crear_servidor', 'forge01', 'forge-1.21.1-52.1.0-installer.jar'])
})

test('maps lifecycle actions to fixed script arguments', () => {
  const expected = {
    SERVER_START: 'iniciar',
    SERVER_STOP: 'detener',
    SERVER_RESTART: 'reiniciar',
    SERVER_STATUS: 'status'
  }

  for (const [action, command] of Object.entries(expected)) {
    assert.deepEqual(actionArguments({ action, serverId: 'server01', payload: {} }), [command, 'server01'])
  }
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

test('rejects template paths and non-jar templates', () => {
  for (const template of ['../minecraft.jar', '/tmp/server.jar', 'server.sh']) {
    assert.throws(() => validateActionRequest({
      action: 'SERVER_CREATE',
      serverId: 'server01',
      payload: { template }
    }), /template/)
  }
})

test('maps list, config, delete, command and healthcheck actions', () => {
  assert.deepEqual(actionArguments({ action: 'SERVER_LIST', payload: {} }), ['listar_servidor'])
  assert.deepEqual(actionArguments({ action: 'HEALTHCHECK', payload: {} }), ['healthcheck'])
  assert.deepEqual(actionArguments({
    action: 'SERVER_UPDATE_CONFIG', serverId: 'server01',
    payload: { key: 'motd', value: 'My home server' }
  }), ['administrar_servidor', 'server01', 'motd', 'My home server'])
  assert.deepEqual(actionArguments({
    action: 'SERVER_DELETE', serverId: 'server01', payload: {}
  }), ['borrar_servidor', 'server01', '--force'])
  assert.deepEqual(actionArguments({
    action: 'SERVER_COMMAND', serverId: 'server01', payload: { command: 'say hello' }
  }), ['command', 'server01', 'say hello'])
})

test('rejects unsafe config and console commands', () => {
  assert.throws(() => validateActionRequest({
    action: 'SERVER_UPDATE_CONFIG', serverId: 'server01',
    payload: { key: '../motd', value: 'x' }
  }), /property key/)
  assert.throws(() => validateActionRequest({
    action: 'SERVER_COMMAND', serverId: 'server01',
    payload: { command: 'stop' }
  }), /not allowed/)
})
