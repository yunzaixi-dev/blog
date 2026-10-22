// Builds the favicon set app/layout.tsx links to, from the author avatar.
import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const source = 'public/static/images/avatar.jpg'
const dir = 'public/static/favicons'
const png = (/** @type {number} */ size) => sharp(source).resize(size, size).png().toBuffer()
const sizes = {
  'favicon-16x16.png': 16,
  'favicon-32x32.png': 32,
  'apple-touch-icon.png': 180,
  'android-chrome-96x96.png': 96,
  'android-chrome-192x192.png': 192,
  'android-chrome-512x512.png': 512,
  'mstile-150x150.png': 150,
}
for (const [name, size] of Object.entries(sizes)) await writeFile(`${dir}/${name}`, await png(size))

// ICO holding PNG frames (supported by every current browser).
const frames = await Promise.all([16, 32].map(png))
const header = Buffer.alloc(6)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(frames.length, 4)
let offset = 6 + 16 * frames.length
const entries = frames.map((frame, i) => {
  const size = [16, 32][i]
  const entry = Buffer.alloc(16)
  entry[0] = size
  entry[1] = size
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(frame.length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += frame.length
  return entry
})
const ico = Buffer.concat([header, ...entries, ...frames])
await writeFile(`${dir}/favicon.ico`, ico)
await writeFile('public/favicon.ico', ico)

const embedded = (await png(64)).toString('base64')
await writeFile(
  `${dir}/favicon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><clipPath id="c"><circle cx="32" cy="32" r="32"/></clipPath><image href="data:image/png;base64,${embedded}" width="64" height="64" clip-path="url(#c)"/></svg>\n`
)
// Safari's pinned-tab icon is a single-colour mask.
await writeFile(
  `${dir}/safari-pinned-tab.svg`,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>\n'
)
await writeFile(
  `${dir}/site.webmanifest`,
  JSON.stringify(
    {
      name: 'zaixi.dev',
      short_name: 'zaixi.dev',
      icons: [96, 192, 512].map((s) => ({
        src: `/static/favicons/android-chrome-${s}x${s}.png`,
        sizes: `${s}x${s}`,
        type: 'image/png',
      })),
      theme_color: '#000000',
      background_color: '#000000',
      display: 'standalone',
    },
    null,
    2
  ) + '\n'
)
await writeFile(
  `${dir}/browserconfig.xml`,
  '<?xml version="1.0" encoding="utf-8"?>\n<browserconfig><msapplication><tile><square150x150logo src="/static/favicons/mstile-150x150.png"/><TileColor>#000000</TileColor></tile></msapplication></browserconfig>\n'
)
console.log('favicons written')
