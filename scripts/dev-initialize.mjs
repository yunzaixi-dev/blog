import { run } from './lib/processes.mjs'
import path from 'node:path'

await run('pnpm', ['build'])
const binary = path.resolve('dist', 'blog')
await run(binary, ['--mode=migrate'])
await run(binary, ['--mode=init-local-media'])
await run(binary, ['--mode=import', '--checkout-root=.'])
console.log('Local database initialized and current Git checkout imported')
