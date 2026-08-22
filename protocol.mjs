import b4a from 'b4a'

export const PROTOCOL_VERSION = 1
export const MAX_MESSAGE_BYTES = 64 * 1024

export function encodeMessage (message) {
  return b4a.from(`${JSON.stringify(message)}\n`)
}

export function createJsonlDecoder ({ onValue, onError }) {
  let pending = b4a.alloc(0)

  return chunk => {
    pending = b4a.concat([pending, chunk])

    while (true) {
      const newline = pending.indexOf(10)

      if (newline === -1) {
        if (pending.byteLength > MAX_MESSAGE_BYTES) {
          pending = b4a.alloc(0)
          onError(new Error('Message exceeds maximum size'))
        }
        return
      }

      let line = pending.subarray(0, newline)
      pending = pending.subarray(newline + 1)

      if (line.byteLength > 0 && line[line.byteLength - 1] === 13) {
        line = line.subarray(0, line.byteLength - 1)
      }

      if (line.byteLength === 0) continue
      if (line.byteLength > MAX_MESSAGE_BYTES) {
        onError(new Error('Message exceeds maximum size'))
        continue
      }

      try {
        const value = JSON.parse(b4a.toString(line))

        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Message must be a JSON object')
        }

        onValue(value)
      } catch (error) {
        onError(error)
      }
    }
  }
}

export function createMessageDecoder ({ onMessage, onError }) {
  return createJsonlDecoder({
    onValue: message => {
      if (message.v !== PROTOCOL_VERSION) {
        onError(new Error(`Unsupported protocol version: ${message.v}`))
        return
      }

      if (typeof message.type !== 'string' || message.type.length === 0) {
        onError(new Error('Message type is required'))
        return
      }

      onMessage(message)
    },
    onError
  })
}
