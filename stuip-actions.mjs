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

export const MINECRAFT_COMMANDS = new Set([
  'ban', 'ban-ip', 'banlist', 'deop', 'difficulty', 'gamemode', 'gamerule',
  'kick', 'list', 'op', 'pardon', 'pardon-ip', 'save-all', 'save-off',
  'save-on', 'say', 'seed', 'time', 'weather', 'whitelist'
])

export const ACTIONS = Object.freeze({
  SERVER_LIST: () => ['listar_servidor'],
  SERVER_STATUS: ({ serverId }) => ['status', serverId],
  SERVER_START: ({ serverId }) => ['iniciar', serverId],
  SERVER_STOP: ({ serverId }) => ['detener', serverId],
  SERVER_RESTART: ({ serverId }) => ['reiniciar', serverId],
  SERVER_CREATE: ({ serverId, payload }) => ['crear_servidor', serverId, payload.template],
  SERVER_UPDATE_CONFIG: ({ serverId, payload }) => [
    'administrar_servidor', serverId, payload.key, payload.value
  ],
  SERVER_DELETE: ({ serverId }) => ['borrar_servidor', serverId, '--force'],
  SERVER_COMMAND: ({ serverId, payload }) => ['command', serverId, payload.command],
  HEALTHCHECK: () => ['healthcheck']
})

export function validateActionRequest (request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('Action request must be an object')
  }

  const { action, serverId, payload = {} } = request

  if (typeof action !== 'string' || !Object.hasOwn(ACTIONS, action)) {
    throw new TypeError(`Unknown action: ${String(action)}`)
  }

  const requiresServer = !['SERVER_LIST', 'HEALTHCHECK'].includes(action)
  if (requiresServer && (typeof serverId !== 'string' || !SERVER_ID_PATTERN.test(serverId))) {
    throw new TypeError('serverId may only contain letters, numbers, _ and -')
  }
  if (!requiresServer && serverId !== undefined) {
    throw new TypeError(`${action} does not accept serverId`)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('payload must be an object')
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
  } else if (action === 'SERVER_UPDATE_CONFIG') {
    if (typeof payload.key !== 'string' || !/^[A-Za-z0-9._-]+$/.test(payload.key)) {
      throw new TypeError('SERVER_UPDATE_CONFIG requires a safe property key')
    }
    if (
      typeof payload.value !== 'string' || payload.value.length > 500 ||
      /[\r\n\0|\\&]/.test(payload.value)
    ) {
      throw new TypeError('SERVER_UPDATE_CONFIG requires a safe property value')
    }
    if (Object.keys(payload).some(key => !['key', 'value'].includes(key))) {
      throw new TypeError('SERVER_UPDATE_CONFIG only accepts key and value')
    }
  } else if (action === 'SERVER_COMMAND') {
    if (
      typeof payload.command !== 'string' || payload.command.length > 500 ||
      /[\r\n\0]/.test(payload.command)
    ) {
      throw new TypeError('SERVER_COMMAND requires a safe console command')
    }
    const commandName = payload.command.trim().split(/\s+/, 1)[0].toLowerCase()
    if (!MINECRAFT_COMMANDS.has(commandName)) {
      throw new TypeError(`Minecraft command is not allowed: ${commandName}`)
    }
    if (Object.keys(payload).some(key => key !== 'command')) {
      throw new TypeError('SERVER_COMMAND only accepts payload.command')
    }
  } else if (Object.keys(payload).length > 0) {
    throw new TypeError(`${action} does not accept payload fields`)
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
