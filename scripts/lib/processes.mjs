import { spawn } from 'node:child_process'

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
export function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    const stop = () => child.kill('SIGTERM')
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    const cleanup = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
    }
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      cleanup()
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${signal || code}`))
    })
  })
}

/**
 * Supervise only the process groups created here. A child exit stops its peers;
 * signal handlers remain installed until every owned child has exited.
 * @param {{command: string, args: string[], env?: NodeJS.ProcessEnv}[]} commands
 * @returns {Promise<void>}
 */
export async function supervise(commands) {
  let stopping = false
  let failure = false
  /** @type {import('node:child_process').ChildProcess[]} */
  const children = []
  const stop = () => {
    stopping = true
    for (const child of children) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch (error) {
          if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error
        }
      }
    }
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    await Promise.all(
      commands.map(
        ({ command, args, env }) =>
          new Promise((resolve) => {
            const child = spawn(command, args, {
              stdio: 'inherit',
              detached: true,
              env: env || process.env,
            })
            children.push(child)
            child.once('error', (error) => {
              console.error(error)
              failure = true
              stop()
              resolve(undefined)
            })
            child.once('exit', (code, signal) => {
              if (!stopping) {
                failure = code !== 0 || signal !== null
                console.error(`${command} exited ${signal || code}; stopping owned peers`)
                stop()
              }
              resolve(undefined)
            })
          })
      )
    )
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
  if (failure) throw new Error('A supervised process failed')
}
