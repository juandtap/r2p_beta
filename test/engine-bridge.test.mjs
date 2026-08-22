import assert from 'node:assert/strict'
import test from 'node:test'
import { EngineBridge } from '../engine-bridge.mjs'

test('reads a JSONL event from an engine process', async () => {
  const errors = []

  const event = await new Promise((resolve, reject) => {
    const bridge = new EngineBridge({
      executable: '/bin/echo',
      args: ['{"type":"MOCK_READY"}'],
      onEvent: resolve,
      onExit: ({ code }) => {
        if (code !== 0) reject(new Error(`Mock engine exited with ${code}`))
      },
      onError: error => errors.push(error)
    })
  })

  assert.deepEqual(event, { type: 'MOCK_READY' })
  assert.deepEqual(errors, [])
})
