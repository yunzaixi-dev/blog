import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'

it('converts new PNG once, leaves existing WebP untouched, and checks actual decoding', async () => {
  const root = await mkdtemp('/tmp/opencode/images-idempotent-')
  const directory = path.join(root, 'public/static/images')
  const script = path.resolve('scripts/optimize-images.mjs')
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(root, 'public/_redirects'), '')
    const existing = path.join(directory, 'existing.webp')
    await sharp({ create: { width: 48, height: 48, channels: 4, background: '#68aacc' } })
      .webp()
      .toFile(existing)
    await sharp({ create: { width: 128, height: 128, channels: 4, background: '#ccbbaa' } })
      .png()
      .toFile(path.join(directory, 'new.png'))
    const before = await readFile(existing),
      timestamp = (await stat(existing)).mtimeMs
    execFileSync(process.execPath, [script], { cwd: root })
    const converted = await readFile(path.join(directory, 'new.webp'))
    const redirects = await readFile(path.join(root, 'public/_redirects'), 'utf8')
    execFileSync(process.execPath, [script], { cwd: root })
    expect(await readFile(existing)).toEqual(before)
    expect((await stat(existing)).mtimeMs).toBe(timestamp)
    expect(await readFile(path.join(directory, 'new.webp'))).toEqual(converted)
    expect(await readFile(path.join(root, 'public/_redirects'), 'utf8')).toBe(redirects)
    execFileSync(process.execPath, [script, '--check'], { cwd: root })
    await writeFile(path.join(directory, 'broken.webp'), 'invalid image')
    expect(spawnSync(process.execPath, [script, '--check'], { cwd: root }).status).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
