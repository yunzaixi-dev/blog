import { parsePreviewArgs } from './preview-static/args.mjs'
import { run, supervise } from './lib/processes.mjs'

const { port, skipBuild } = parsePreviewArgs(process.argv.slice(2))
if (!skipBuild) await run('pnpm', ['build'])
console.log(`Preview: http://127.0.0.1:${port}/zh/`)
await supervise([
  {
    command: './dist/blog',
    args: [
      '--addr',
      `127.0.0.1:${port}`,
      '--static',
      'out',
      '--content',
      process.env.CONTENT_DIR || 'content',
      '--media',
      process.env.MEDIA_DIR || 'public',
    ],
  },
])
