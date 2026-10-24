import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { run } from './lib/processes.mjs'

await run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.worker.config.ts'])
const directory = process.env.CONTENT_DIR || 'content'
const files = []
for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
  if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) continue
  const file = path.join(entry.parentPath, entry.name)
  files.push({ path: path.relative(directory, file), data: await readFile(file, 'utf8') })
}
const child = spawn('node', ['dist/worker/content-worker.mjs'], {
  stdio: ['pipe', 'pipe', 'inherit'],
})
child.stdin.end(`${JSON.stringify({ files })}\n`)
let response = ''
for await (const chunk of child.stdout) response += chunk
const result = JSON.parse(response)
if (result.error) throw new Error(result.error)
console.log(`Validated ${files.length} content files; no publication or frontend rebuild required`)
