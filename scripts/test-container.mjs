import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const image = process.argv[2]
assert.ok(image, 'Pass the built Docker image as the first argument')
const directory = await mkdtemp(path.join(os.tmpdir(), 'blog-container-'))
const content = path.join(directory, 'content')
const media = path.join(directory, 'public')
await mkdir(path.join(content, 'blog', 'zh'), { recursive: true })
await mkdir(path.join(media, 'static'), { recursive: true })
const article = path.join(content, 'blog', 'zh', 'container.md')
/** @param {string} body */
const source = (body) => `---\ntitle: Container smoke\ndate: 2026-10-24\n---\n${body}\n`
await writeFile(article, source('MountedFirstRelease'))
await writeFile(path.join(media, 'static', 'smoke.txt'), 'IndependentMedia')
let container
/** @type {import('node:child_process').ChildProcessByStdio<null, import('node:stream').Readable, import('node:stream').Readable> | undefined} */
let logs
try {
  container = execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--publish',
      '127.0.0.1::45101',
      '--mount',
      `type=bind,src=${content},dst=/content,readonly`,
      '--mount',
      `type=bind,src=${media},dst=/media,readonly`,
      image,
    ],
    { encoding: 'utf8' }
  ).trim()
  const logStream = spawn('docker', ['logs', '--follow', container], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  logs = logStream
  const startupDeadline = AbortSignal.timeout(30_000)
  await new Promise((resolve, reject) => {
    let output = ''
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      output += String(chunk)
      if (output.includes('Blog listening')) resolve(undefined)
    }
    logStream.stdout.on('data', onData)
    logStream.stderr.on('data', onData)
    logStream.once('error', reject)
    logStream.once('exit', (code) =>
      reject(new Error(`Container exited before ready (${code}): ${output}`))
    )
    startupDeadline.addEventListener(
      'abort',
      () => reject(new Error(`Container did not become ready within 30 seconds: ${output}`)),
      { once: true }
    )
  })
  const port = execFileSync('docker', ['port', container, '45101/tcp'], { encoding: 'utf8' }).trim()
  const base = `http://${port}`
  /** @param {string} url */
  const get = (url) => fetch(`${base}${url}`, { signal: AbortSignal.timeout(15_000) })
  /** @param {string} word */
  const page = async (word) => {
    const response = await get('/api/page?path=/zh/container/')
    assert.equal(response.status, 200)
    assert.ok((await response.text()).includes(word))
  }
  assert.equal((await get('/zh/')).status, 200)
  await page('MountedFirstRelease')
  const asset = await get('/static/smoke.txt')
  assert.equal(asset.status, 200)
  assert.equal(await asset.text(), 'IndependentMedia')
  await writeFile(article, source('MountedSecondRelease'))
  await page('MountedSecondRelease')
  await rm(article)
  assert.equal((await get('/api/page?path=/zh/container/')).status, 404)
  execFileSync('docker', ['stop', '--timeout', '15', container], { stdio: 'inherit' })
  const state = JSON.parse(
    execFileSync('docker', ['inspect', '--format', '{{json .State}}', container], {
      encoding: 'utf8',
    })
  )
  assert.equal(state.ExitCode, 0, 'The real Go process and private worker must stop cleanly')
  console.log(
    'Container passed: shell, Go API, private worker, mounted content update/delete, media, SIGTERM'
  )
} finally {
  if (container) execFileSync('docker', ['rm', '--force', container], { stdio: 'inherit' })
  if (logs && logs.exitCode === null) {
    const exited = once(logs, 'exit')
    logs.kill('SIGTERM')
    await exited
  }
  await rm(directory, { recursive: true, force: true })
}
