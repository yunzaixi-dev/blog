import { appendFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { formatBytes } from './lib/file-utils.mjs'

const directory = path.join('public', 'static', 'images')
const checkOnly = process.argv.includes('--check')
const extensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif'])
const failures = []
for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue
  const file = path.join(entry.parentPath, entry.name)
  try {
    const metadata = await sharp(file).metadata()
    if (!metadata.width || !metadata.height) throw new Error('Missing image dimensions')
    if (checkOnly) await sharp(file).stats()
    if (checkOnly || !['.png', '.jpg', '.jpeg'].includes(path.extname(file).toLowerCase())) continue
    const before = (await stat(file)).size
    const output = `${file}.optimizing`
    // Preserve chart label resolution; photos/illustrations can shrink modestly.
    const chart = file.includes('nodeseek')
    let pipeline = sharp(file).rotate()
    if (!chart) pipeline = pipeline.resize({ width: 1400, withoutEnlargement: true })
    pipeline = pipeline.webp({ quality: chart ? 90 : 80, effort: 6, alphaQuality: 100 })
    await pipeline.toFile(output)
    const after = (await stat(output)).size
    if (after < before) {
      const target =
        path.extname(file).toLowerCase() === '.webp'
          ? file
          : `${file.slice(0, -path.extname(file).length)}.webp`
      await rename(output, target)
      if (target !== file) {
        const oldURL = `/${path.relative('public', file).split(path.sep).join('/')}`
        const newURL = `/${path.relative('public', target).split(path.sep).join('/')}`
        await appendFile('public/_redirects', `\n${oldURL} ${newURL} 301\n`)
        await rm(file)
        console.log(`Use ${newURL} in article references; ${oldURL} redirects permanently`)
      }
      console.log(`${file}: ${formatBytes(before)} -> ${formatBytes(after)}`)
    } else await rm(output)
  } catch (error) {
    failures.push(file)
    console.error(file, error)
  }
}
if (failures.length) process.exitCode = 1
else
  console.log(
    checkOnly
      ? 'Image files decode with valid dimensions'
      : 'Image optimization complete; runtime uses native image URLs'
  )
