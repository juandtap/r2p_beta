import crypto from 'bare-crypto'
import { validateActionRequest } from './stuip-actions.mjs'

const REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/

export class StuipId {
  constructor ({ connections, send, executeAction, timeoutMs = 20_000 }) {
    this.connections = connections
    this.send = send
    this.executeAction = executeAction
    this.timeoutMs = timeoutMs
    this.pending = new Map()
  }

  sendAction (peerId, request) {
    const action = validateActionRequest(request)
    const conn = this.connections.get(peerId)
    if (!conn) return Promise.reject(new Error(`Peer is not connected: ${peerId}`))

    const requestId = crypto.randomBytes(16).toString('hex')

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Action timed out: ${requestId}`))
      }, this.timeoutMs)

      this.pending.set(requestId, { peerId, action: action.action, resolve, reject, timeout })

      try {
        this.send(conn, { type: 'EXEC_ACTION', requestId, ...action })
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  async handleMessage (message, peerId, conn) {
    if (message.type === 'EXEC_ACTION') {
      await this.#handleRequest(message, conn)
      return true
    }

    if (message.type === 'ACTION_RESULT') {
      this.#handleResult(message, peerId)
      return true
    }

    return false
  }

  peerDisconnected (peerId) {
    for (const [requestId, pending] of this.pending) {
      if (pending.peerId !== peerId) continue
      clearTimeout(pending.timeout)
      this.pending.delete(requestId)
      pending.reject(new Error(`Peer disconnected: ${peerId}`))
    }
  }

  async #handleRequest (message, conn) {
    const requestId = message.requestId
    const action = message.action

    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
      return
    }

    let result
    try {
      const request = validateActionRequest(message)
      result = await this.executeAction(request)
    } catch (error) {
      result = {
        success: false,
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: error.message
      }
    }

    this.send(conn, { type: 'ACTION_RESULT', requestId, action, ...result })
  }

  #handleResult (message, peerId) {
    const pending = this.pending.get(message.requestId)
    if (!pending || pending.peerId !== peerId || pending.action !== message.action) return

    clearTimeout(pending.timeout)
    this.pending.delete(message.requestId)

    if (
      typeof message.success !== 'boolean' ||
      !Number.isInteger(message.exitCode) ||
      typeof message.stdout !== 'string' ||
      typeof message.stderr !== 'string'
    ) {
      pending.reject(new Error('Malformed ACTION_RESULT'))
      return
    }

    pending.resolve({
      requestId: message.requestId,
      action: message.action,
      success: message.success,
      exitCode: message.exitCode,
      signal: typeof message.signal === 'string' ? message.signal : null,
      stdout: message.stdout,
      stderr: message.stderr
    })
  }
}
