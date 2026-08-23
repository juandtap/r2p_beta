import fs from 'bare-fs'
import { fileURLToPath } from 'bare-url'
import { spawn } from 'bare-subprocess'
import { actionArguments, validateActionRequest } from './stuip-actions.mjs'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_OUTPUT_BYTES = 48 * 1024
const DEFAULT_SCRIPT_PATH = fileURLToPath(new URL('./mc-manager.sh', import.meta.url))

function appendLimited (current, chunk, remainingBytes) {
  if (remainingBytes <= 0) return current
  return current + chunk.toString().slice(0, remainingBytes)
}

export async function executeMinecraftAction (request, options = {}) {
  const validated = validateActionRequest(request)
  const scriptPath = options.scriptPath || DEFAULT_SCRIPT_PATH
  const timeoutMs = options.timeoutMs || actionTimeout(validated.action)
  const maxOutputBytes = options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES

  let stat
  try {
    stat = fs.statSync(scriptPath)
  } catch {
    throw new Error(`Minecraft manager script not found: ${scriptPath}`)
  }

  if (!stat.isFile()) throw new Error(`Minecraft manager is not a file: ${scriptPath}`)
  if ((stat.mode & 0o111) === 0) throw new Error(`Minecraft manager is not executable: ${scriptPath}`)

  const child = spawn(scriptPath, actionArguments(validated), {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  let remainingOutputBytes = maxOutputBytes
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, timeoutMs)

  child.stdout.on('data', chunk => {
    const text = chunk.toString()
    stdout = appendLimited(stdout, text, remainingOutputBytes)
    remainingOutputBytes -= Math.min(text.length, remainingOutputBytes)
  })
  child.stderr.on('data', chunk => {
    const text = chunk.toString()
    stderr = appendLimited(stderr, text, remainingOutputBytes)
    remainingOutputBytes -= Math.min(text.length, remainingOutputBytes)
  })

  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (exitCode, signalCode) => {
      clearTimeout(timer)
      const code = Number.isInteger(exitCode) ? exitCode : 1
      resolve({
        success: !timedOut && code === 0,
        exitCode: code,
        signal: signalCode || null,
        stdout,
        stderr: timedOut ? `${stderr}${stderr ? '\n' : ''}Action timed out` : stderr
      })
    })
  })
}

function actionTimeout (action) {
  if (action === 'SERVER_CREATE') return 10 * 60_000
  if (action === 'SERVER_RESTART') return 60_000
  if (action === 'SERVER_STOP') return 30_000
  return DEFAULT_TIMEOUT_MS
}
