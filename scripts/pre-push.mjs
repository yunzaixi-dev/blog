import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { run } from './lib/processes.mjs'
import { contentOnly } from './lib/local-verification.mjs'

const refs = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)
let application = refs.length === 0
for (const ref of refs) {
  const [, local, , remote] = ref.split(/\s+/)
  if (/^0+$/.test(local)) continue
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const args = /^0+$/.test(remote)
    ? ['ls-tree', '-r', '--name-only', local]
    : ['diff', '--name-only', remote, local]
  const files = execFileSync('git', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  if (files.length && !contentOnly(files)) {
    if (local !== head)
      throw new Error('Check out the application commit being pushed before verification')
    if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
      throw new Error(
        'Commit application changes before push so verification matches the pushed source'
      )
    application = true
  }
}
if (application) await run('pnpm', ['verify:local'])
else console.log('Content-only push: independent importer publishes content; no application build')
