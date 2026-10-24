import { mkdir, copyFile } from 'node:fs/promises'
import { run } from './lib/processes.mjs'
import { buildEnvironment } from './lib/build-budget.mjs'

await run('pnpm', ['clean'])
await run('pnpm', ['icons:generate'])
await mkdir('dist', { recursive: true })
const env = buildEnvironment()
const results = await Promise.allSettled([
  run('node', ['scripts/build-assets.mjs']),
  run('go', ['build', '-trimpath', '-o', 'dist/blog', './cmd/blog'], env),
])
for (const result of results) if (result.status === 'rejected') throw result.reason
await copyFile('public/_redirects', 'out/_redirects')
