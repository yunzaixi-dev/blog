import { execFileSync, spawn } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { verificationCompose } from './lib/local-verification.mjs'

// The host only schedules Docker and collects results. Application checks run
// in the devcontainer image; image checks exercise the actual runtime image.
const root = process.cwd()
const directory = await mkdtemp(path.join(os.tmpdir(), 'blog-verify-'))
const checkout = path.join(directory, 'checkout')
const project = path.basename(directory).toLowerCase()
const image = `${project}:local`
const configFile = path.join(directory, 'compose.json')
const compose = ['compose', '--project-name', project, '--file', configFile]
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const changes = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
/** @type {Map<string, Buffer | undefined>} */
const sources = new Map()

/** @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
async function run(command, args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: checkout, env, stdio: 'inherit' })
    const stop = () => child.kill('SIGTERM')
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      if (code === 0) resolve(undefined)
      else reject(new Error(`${command} exited ${signal || code}`))
    })
  })
}

/** @param {string[]} args */
const inApp = (args) => run('docker', [...compose, 'exec', '-T', '--user', 'node', 'app', ...args])
const fileMode = [
  'env',
  '-u',
  'DATABASE_URL',
  '-u',
  'API_BASE_URL',
  '-u',
  'MEDIA_BASE_URL',
  'CI=1',
  'CONTENT_DIR=/workspaces/blog/content',
  'MEDIA_DIR=/workspaces/blog/public',
]

let started = false
try {
  await mkdir(checkout)
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      encoding: 'utf8',
    }
  )
    .split('\0')
    .filter(Boolean)
  for (const file of new Set(files)) {
    const source = path.join(root, file)
    let data
    try {
      data = await readFile(source)
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
    }
    sources.set(file, data)
    if (data !== undefined)
      await cp(source, path.join(checkout, file), { recursive: true, dereference: false })
  }
  // Preserve real history for article metadata and ordering, but never copy
  // repository configuration, credentials or hooks into the test checkout.
  execFileSync('git', ['init', '--quiet', checkout])
  execFileSync('git', ['-C', checkout, 'fetch', '--quiet', '--no-tags', root, sha])
  execFileSync('git', ['-C', checkout, 'reset', '--mixed', '--quiet', sha])
  execFileSync('git', [
    '-C',
    checkout,
    'remote',
    'add',
    'origin',
    'https://github.com/yunzaixi-dev/blog.git',
  ])
  execFileSync('git', ['-C', checkout, 'add', '.'])
  if (changes)
    execFileSync('git', [
      '-C',
      checkout,
      '-c',
      'user.name=Local verification',
      '-c',
      'user.email=verification@localhost',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--quiet',
      '-m',
      `Verify candidate from ${sha}`,
    ])
  await chmod(path.join(checkout, '.devcontainer/s3-local.json'), 0o644)
  const config = JSON.parse(
    execFileSync(
      'docker',
      [
        'compose',
        '--file',
        path.join(checkout, '.devcontainer/compose.yaml'),
        'config',
        '--format',
        'json',
      ],
      {
        encoding: 'utf8',
      }
    )
  )
  if (process.platform !== 'linux')
    throw new Error('Local runtime image checks currently require Linux Docker host networking')
  await writeFile(configFile, JSON.stringify(verificationCompose(config, project)))
  console.log(
    `Local candidate: ${sha}${changes ? ' + working tree changes' : ''}; project: ${project}`
  )
  started = true
  await run('docker', [...compose, 'up', '--build', '-d', '--wait'])
  await run('docker', [
    ...compose,
    'exec',
    '-T',
    '--user',
    'root',
    'app',
    'chown',
    '-R',
    'node:node',
    '/workspaces/blog',
  ])
  await inApp(['pnpm', 'install', '--offline', '--frozen-lockfile'])
  await inApp([...fileMode, 'pnpm', 'check'])
  await inApp([...fileMode, 'pnpm', 'build'])
  await inApp(['pnpm', 'test:integration'])
  await inApp(['./dist/blog', '--mode=migrate'])
  await inApp(['./dist/blog', '--mode=init-local-media'])
  await inApp(['pnpm', 'test:split-release'])
  await inApp([...fileMode, 'pnpm', 'test:runtime'])
  await inApp([...fileMode, 'pnpm', 'test:e2e'])
  await inApp([...fileMode, 'pnpm', 'test:e2e:parity'])
  await inApp([...fileMode, 'pnpm', 'perf:check'])
  await run('docker', ['build', '--network=host', '--tag', image, '.'])
  await run('node', ['scripts/test-container.mjs', image])
  /** @param {string} service @param {number} port */
  const address = (service, port) =>
    execFileSync('docker', [...compose, 'port', service, String(port)], { encoding: 'utf8' }).trim()
  const media = `http://${address('minio', 9000)}`
  const env = {
    ...process.env,
    DATABASE_URL: `postgres://blog:blog-local-only@${address('postgres', 5432)}/blog?sslmode=disable`,
    TYPESENSE_URL: `http://${address('typesense', 8108)}`,
    TYPESENSE_API_KEY: 'blog-local-typesense-only',
    S3_ENDPOINT: media,
    S3_REGION: 'us-east-1',
    R2_BUCKET: 'blog-test-media',
    S3_ACCESS_KEY_ID: 'blog-local-only',
    S3_SECRET_ACCESS_KEY: 'blog-local-secret-only',
    S3_FORCE_PATH_STYLE: 'true',
    MEDIA_BASE_URL: `${media}/blog-test-media`,
    TEST_DOCKER_NETWORK: 'host',
  }
  await run('node', ['scripts/test-container-publication.mjs', image], env)
  await inApp([
    'env',
    'API_BASE_URL=https://api.zaixi.dev',
    'MEDIA_BASE_URL=https://blog-media.zaixi.dev',
    'SITE_URL=https://zaixi.dev',
    'pnpm',
    'exec',
    'vite',
    'build',
  ])
  await inApp([
    'env',
    'API_BASE_URL=https://api.zaixi.dev',
    'MEDIA_BASE_URL=https://blog-media.zaixi.dev',
    'node',
    'scripts/prepare-pages.mjs',
  ])
  await inApp(['node', 'scripts/test-pages-artifact.mjs'])
  if (
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== sha ||
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !==
      changes
  ) {
    throw new Error('Source changed during verification; verify the final candidate again')
  }
  for (const [file, original] of sources) {
    const current = await readFile(path.join(root, file)).catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    if (original === undefined ? current !== undefined : !current?.equals(original)) {
      throw new Error(`Source changed during verification: ${file}`)
    }
  }
  const imageID = execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], {
    encoding: 'utf8',
  }).trim()
  await mkdir(path.join(root, '.cache'), { recursive: true })
  await writeFile(
    path.join(root, '.cache/local-verification.json'),
    JSON.stringify(
      {
        source: sha,
        workingTreeChanges: changes,
        imageID,
        completedAt: new Date().toISOString(),
        environment: 'devcontainer; host Docker orchestrates runtime image checks',
      },
      null,
      2
    ) + '\n'
  )
  console.log(`Local verification passed: ${sha}; image ${imageID}`)
} catch (error) {
  await mkdir(path.join(root, '.cache'), { recursive: true })
  await cp(
    path.join(checkout, 'test-results'),
    path.join(root, '.cache', `${project}-test-results`),
    { recursive: true }
  ).catch((failure) => {
    if (failure.code !== 'ENOENT') console.error('Test artifacts could not be preserved:', failure)
  })
  if (started) {
    const diagnostics = await Promise.allSettled([
      run('docker', [...compose, 'ps', '--all']),
      run('docker', [
        ...compose,
        'logs',
        '--no-color',
        '--tail',
        '100',
        'postgres',
        'typesense',
        'minio',
      ]),
    ])
    for (const result of diagnostics)
      if (result.status === 'rejected')
        console.error('Dependency diagnostics failed:', result.reason)
  }
  throw error
} finally {
  if (started && process.getuid && process.getgid) {
    const restored = await Promise.allSettled([
      run('docker', [
        ...compose,
        'exec',
        '-T',
        '--user',
        'root',
        'app',
        'chown',
        '-R',
        `${process.getuid()}:${process.getgid()}`,
        '/workspaces/blog',
      ]),
    ])
    for (const result of restored)
      if (result.status === 'rejected')
        console.error('Test checkout ownership restoration failed:', result.reason)
  }
  if (started) await run('docker', [...compose, 'down', '--volumes', '--remove-orphans'])
  await rm(directory, { recursive: true, force: true })
}
