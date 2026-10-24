import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { run } from './lib/processes.mjs'
import path from 'node:path'

await run('pnpm', ['exec', 'vite', 'build'])
await run(path.resolve('dist', 'blog'), ['--mode=import', '--checkout-root=.'])
process.env.API_BASE_URL = 'http://127.0.0.1:45141'
await run('pnpm', ['exec', 'vite', 'build'])
const api = spawn(path.resolve('dist', 'blog'), ['--addr=127.0.0.1:45141'], {
  env: { ...process.env, CORS_ORIGINS: 'http://127.0.0.1:45140' },
  stdio: ['ignore', 'ignore', 'pipe'],
})
try {
  await new Promise((resolve, reject) => {
    api.once('error', reject)
    api.once('exit', (code) => reject(new Error(`API exited ${code}`)))
    api.stderr.on('data', (data) => {
      if (String(data).includes('Blog listening')) resolve(undefined)
    })
    AbortSignal.timeout(30_000).addEventListener(
      'abort',
      () => reject(new Error('API startup deadline')),
      { once: true }
    )
  })
  await run('node', ['scripts/test-pages.mjs'])
} finally {
  if (api.exitCode === null && api.signalCode === null) {
    const exited = once(api, 'exit')
    api.kill('SIGTERM')
    await exited
  }
  delete process.env.API_BASE_URL
  await run('pnpm', ['exec', 'vite', 'build'])
}
