import { spawn } from 'child_process'
import { createJsonlDecoder, encodeMessage } from './protocol.mjs'

export class EngineBridge {
  constructor ({ executable, args = [], onEvent, onExit, onError }) {
    this.onError = onError
    this.child = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'inherit']
    })

    const decode = createJsonlDecoder({
      onValue: event => {
        if (typeof event.type !== 'string' || event.type.length === 0) {
          onError(new Error('Engine event type is required'))
          return
        }

        onEvent(event)
      },
      onError
    })

    this.child.stdout.on('data', decode)
    this.child.stdin.on('error', onError)
    this.child.stdout.on('error', onError)
    this.child.on('error', onError)
    this.child.on('exit', (code, signal) => onExit({ code, signal }))
  }

  send (event) {
    if (this.child.stdin.destroyed) return false
    return this.child.stdin.write(encodeMessage(event))
  }

  close () {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    this.child.kill('SIGTERM')
  }
}
