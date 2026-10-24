import { mkdir, copyFile } from 'node:fs/promises'
import { run } from './lib/processes.mjs'

await run('pnpm', ['clean'])
await run('pnpm', ['icons:generate'])
await run('pnpm', ['exec', 'vite', 'build'])
await run('node', ['scripts/check-build.mjs'])
await run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.worker.config.ts'])
await mkdir('dist', { recursive: true })
await run('go', ['build', '-trimpath', '-o', 'dist/blog', './cmd/blog'])
await copyFile('public/_redirects', 'out/_redirects')
