import { spawnSync } from 'child_process'
import { existsSync, statSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const projectDir = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(projectDir, 'examples', 'mock-engine.c')
const output = path.join(projectDir, 'mock-engine.bin')

export function ensureMockEngine () {
  const mustBuild = !existsSync(output) ||
    statSync(source).mtimeMs > statSync(output).mtimeMs

  if (!mustBuild) return output

  console.log('[ENGINE] Compiling development C engine...')

  const result = spawnSync('cc', [
    '-std=c11',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-O2',
    source,
    '-o',
    output
  ], {
    encoding: 'utf8'
  })

  if (result.error) {
    throw new Error(`Could not run C compiler: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(`C compilation failed:\n${result.stderr.trim()}`)
  }

  console.log('[ENGINE] Development C engine compiled ✓')
  return output
}
