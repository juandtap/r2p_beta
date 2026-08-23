export const SERVER_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export const ACTIONS = Object.freeze({
  SERVER_STATUS: ({ serverId }) => ['status', serverId]
})

export function validateActionRequest (request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('Action request must be an object')
  }

  const { action, serverId, payload = {} } = request

  if (typeof action !== 'string' || !Object.hasOwn(ACTIONS, action)) {
    throw new TypeError(`Unknown action: ${String(action)}`)
  }

  if (typeof serverId !== 'string' || !SERVER_ID_PATTERN.test(serverId)) {
    throw new TypeError('serverId may only contain letters, numbers, _ and -')
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('payload must be an object')
  }

  if (Object.keys(payload).length > 0) {
    throw new TypeError(`${action} does not accept payload fields`)
  }

  return { action, serverId, payload }
}

export function actionArguments (request) {
  const validated = validateActionRequest(request)
  return ACTIONS[validated.action](validated)
}
