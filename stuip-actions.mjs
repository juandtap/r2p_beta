export const SERVER_ID_PATTERN = /^[A-Za-z0-9_-]+$/
export const TEMPLATE_PATTERN = /^[A-Za-z0-9._-]+\.jar$/
export const TEMPLATE_ALIASES = Object.freeze({
  minecraft: 'minecraft-1.21.1.jar',
  vanilla: 'minecraft-1.21.1.jar',
  forge: 'forge-1.21.1-52.1.0-installer.jar',
  minecraft120: 'minecraft-1.20.1.jar',
  minecraft121: 'minecraft-1.21.1.jar',
  forge120: 'forge-1.20.1-47.4.10-installer.jar',
  forge121: 'forge-1.21.1-52.1.0-installer.jar'
})

export const ACTIONS = Object.freeze({
  SERVER_STATUS: ({ serverId }) => ['status', serverId],
  SERVER_START: ({ serverId }) => ['iniciar', serverId],
  SERVER_STOP: ({ serverId }) => ['detener', serverId],
  SERVER_RESTART: ({ serverId }) => ['reiniciar', serverId],
  SERVER_CREATE: ({ serverId, payload }) => ['crear_servidor', serverId, payload.template]
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

  if (action !== 'SERVER_CREATE' && Object.keys(payload).length > 0) {
    throw new TypeError(`${action} does not accept payload fields`)
  }

  if (action === 'SERVER_CREATE') {
    if (typeof payload.template !== 'string') {
      throw new TypeError('SERVER_CREATE requires a template name or alias')
    }
    const template = TEMPLATE_ALIASES[payload.template] || payload.template
    if (!TEMPLATE_PATTERN.test(template)) {
      throw new TypeError('SERVER_CREATE requires a safe .jar template name or known alias')
    }
    if (Object.keys(payload).some(key => key !== 'template')) {
      throw new TypeError('SERVER_CREATE only accepts payload.template')
    }
  }

  return {
    action,
    serverId,
    payload: action === 'SERVER_CREATE'
      ? { template: TEMPLATE_ALIASES[payload.template] || payload.template }
      : payload
  }
}

export function actionArguments (request) {
  const validated = validateActionRequest(request)
  return ACTIONS[validated.action](validated)
}
