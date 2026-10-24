import { rm } from 'node:fs/promises'

const outputDirs = ['build', 'out', 'dist']

await Promise.all(outputDirs.map((dir) => rm(dir, { recursive: true, force: true })))
