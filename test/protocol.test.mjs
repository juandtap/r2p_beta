import assert from 'node:assert/strict'
import test from 'node:test'
import b4a from 'b4a'
import {
  PROTOCOL_VERSION,
  createMessageDecoder,
  encodeMessage
} from '../protocol.mjs'

function decoderFor (messages, errors) {
  return createMessageDecoder({
    onMessage: message => messages.push(message),
    onError: error => errors.push(error)
  })
}

test('decodes a message split across chunks', () => {
  const messages = []
  const errors = []
  const decode = decoderFor(messages, errors)
  const encoded = encodeMessage({
    v: PROTOCOL_VERSION,
    type: 'CHAT',
    payload: { text: 'hello' }
  })

  decode(encoded.subarray(0, 7))
  decode(encoded.subarray(7))

  assert.equal(errors.length, 0)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].payload.text, 'hello')
})

test('decodes multiple messages from one chunk', () => {
  const messages = []
  const errors = []
  const decode = decoderFor(messages, errors)
  const first = encodeMessage({ v: PROTOCOL_VERSION, type: 'READY' })
  const second = encodeMessage({ v: PROTOCOL_VERSION, type: 'START' })

  decode(b4a.concat([first, second]))

  assert.equal(errors.length, 0)
  assert.deepEqual(messages.map(message => message.type), ['READY', 'START'])
})

test('rejects invalid JSON and continues with the next line', () => {
  const messages = []
  const errors = []
  const decode = decoderFor(messages, errors)

  decode(b4a.from('{invalid}\n{"v":1,"type":"READY"}\n'))

  assert.equal(errors.length, 1)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].type, 'READY')
})
