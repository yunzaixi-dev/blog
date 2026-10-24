import { mkdir } from 'node:fs/promises'
import { run, supervise } from './lib/processes.mjs'
import { portNumber } from './lib/ports.mjs'

const port = portNumber(process.env.DEV_PORT, 45100)
const apiPort = portNumber(process.env.API_PORT, port + 1)
if (apiPort !== port + 1) throw new Error('API_PORT must follow DEV_PORT')
process.env.DEV_PORT = String(port)
process.env.API_PORT = String(apiPort)
const staticDirectory = '.cache/dev-out'

await mkdir('dist', { recursive: true })
await run('pnpm', ['exec', 'vite', 'build', '--outDir', staticDirectory])
await run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.worker.config.ts'])
await run('go', ['build', '-o', 'dist/blog', './cmd/blog'])
await supervise([
  {
    command: './dist/blog',
    args: [
      '--addr',
      `127.0.0.1:${apiPort}`,
      '--static',
      staticDirectory,
      '--content',
      process.env.CONTENT_DIR || 'content',
      '--media',
      process.env.MEDIA_DIR || 'public',
    ],
  },
  {
    command: 'pnpm',
    args: ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  },
])
