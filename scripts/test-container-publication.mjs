import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const image = process.argv[2]
assert.ok(image, 'Pass the built image')
const environment = [
  'DATABASE_URL',
  'TYPESENSE_URL',
  'TYPESENSE_API_KEY',
  'R2_BUCKET',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
  'MEDIA_BASE_URL',
].flatMap((key) => {
  assert.ok(process.env[key], `Missing ${key}`)
  return ['--env', key]
})
const network = process.env.TEST_DOCKER_NETWORK || 'host'
// git-sync invokes exechook from a checkout, not /app. Preserve that actual cwd.
execFileSync(
  'docker',
  [
    'run',
    '--rm',
    '--network',
    network,
    ...environment,
    '--mount',
    `type=bind,src=${path.resolve('.')},dst=/data/git/current,readonly`,
    '--workdir',
    '/data/git/current',
    '--entrypoint',
    '/app/scripts/import-current.sh',
    image,
  ],
  { stdio: 'inherit', timeout: 300_000 }
)
let container
try {
  // A deliberately nonexistent worker proves production PG serve never starts it.
  container = execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--network',
      network,
      ...environment,
      '--entrypoint',
      '/app/dist/blog',
      image,
      '--addr=0.0.0.0:45142',
      '--worker=/does-not-exist/worker.mjs',
    ],
    { encoding: 'utf8' }
  ).trim()
  execFileSync(
    'docker',
    [
      'exec',
      container,
      'node',
      '--input-type=module',
      '-e',
      'const r=await fetch("http://127.0.0.1:45142/api/page?path=/zh/"); if(r.status!==200||!r.headers.get("x-content-revision"))throw Error(String(r.status)); console.log("PG image revision",r.headers.get("x-content-revision"));',
    ],
    { stdio: 'inherit', timeout: 30_000 }
  )
  const processes = execFileSync('docker', ['top', container, '-eo', 'pid,args'], {
    encoding: 'utf8',
  })
  assert.ok(!processes.includes('content-worker') && !processes.includes('node '), processes)
  console.log('Production image passed: Git-worktree hook cwd, actual PG API, no parser process')
} finally {
  if (container) execFileSync('docker', ['rm', '--force', container], { stdio: 'inherit' })
}
