import { execFileSync, spawnSync } from 'node:child_process'
import { readFile, writeFile, access } from 'node:fs/promises'
import { assertReleaseCandidate } from './lib/local-release.mjs'

const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const changes = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
const report = JSON.parse(await readFile('.cache/local-verification.json', 'utf8'))
assertReleaseCandidate(report, source, changes)
await access(`${report.pagesDirectory}/index.html`)
const mode = process.argv[2] || 'image'
if (!['image', 'pages'].includes(mode)) throw new Error('Use release:local image|pages')
const remote = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], {
  encoding: 'utf8',
}).split(/\s+/)[0]
if (remote !== source)
  throw new Error('Release must use the current main SHA; verify main locally first')
if (mode === 'image') {
  const revision = execFileSync(
    'docker',
    [
      'image',
      'inspect',
      report.imageID,
      '--format',
      '{{index .Config.Labels "org.opencontainers.image.revision"}}',
    ],
    { encoding: 'utf8' }
  ).trim()
  if (revision !== source)
    throw new Error('Tested image revision does not match the verified source')
  const tag = `harbor.agentwego.com/zaixi/blog:${source}`
  execFileSync('docker', ['tag', report.imageID, tag], { stdio: 'inherit' })
  // Use the caller's approved Docker login/credential helper; never read or copy
  // another application's registry credentials. There is no rebuild here.
  execFileSync('docker', ['push', tag], { stdio: 'inherit' })
  const pin = execFileSync(
    'docker',
    ['image', 'inspect', tag, '--format', '{{index .RepoDigests 0}}'],
    { encoding: 'utf8' }
  ).trim()
  if (!/^harbor\.agentwego\.com\/zaixi\/blog@sha256:[0-9a-f]{64}$/.test(pin))
    throw new Error('Registry did not return a fixed blog image digest')
  await writeFile(
    '.cache/local-release.json',
    JSON.stringify(
      { source, imageID: report.imageID, image: pin, publishedAt: new Date().toISOString() },
      null,
      2
    ) + '\n'
  )
  console.log(`Published the tested image without rebuilding: ${pin}`)
} else {
  const release = JSON.parse(await readFile('.cache/local-release.json', 'utf8'))
  if (release.source !== source || release.imageID !== report.imageID)
    throw new Error('Publish this verified image before deploying its Pages artifact')
  const response = await fetch('https://api.zaixi.dev/api/page?path=/zh/', {
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status !== 200 || !response.headers.get('x-content-revision'))
    throw new Error(
      'Backend has no healthy committed publication; keep the existing Pages deployment'
    )
  const result = spawnSync(
    'python3',
    ['scripts/pages_deploy.py', report.pagesDirectory, 'zaixi-blog', 'main'],
    { stdio: 'inherit', env: { ...process.env, SOURCE_SHA: source } }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Pages deployment failed: ${result.status}`)
}
