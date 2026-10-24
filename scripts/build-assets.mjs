import { buildEnvironment } from './lib/build-budget.mjs'
import { run } from './lib/processes.mjs'

const env = buildEnvironment()
const results = await Promise.allSettled([
  run('pnpm', ['exec', 'vite', 'build'], env).then(() =>
    run('node', ['scripts/check-build.mjs'], env)
  ),
  run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.worker.config.ts'], env),
])
for (const result of results) if (result.status === 'rejected') throw result.reason
