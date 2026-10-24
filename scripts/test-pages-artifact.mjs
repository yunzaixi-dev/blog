import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const text = await readFile('out/_redirects', 'utf8')
const historical = (await readFile('public/_redirects', 'utf8')).trim()
assert.ok(
  text.startsWith(historical),
  'Historical rules must retain their order before resource forwards and SPA fallback'
)
const rules = text
  .split('\n')
  .filter((line) => line.trim() && !line.startsWith('#'))
  .map((line) => line.trim().split(/\s+/))
/** @param {string} pathname */
const resolve = (pathname) => {
  for (const [source, destination, status] of rules) {
    const [before, after] = source.split('*')
    if (source === pathname) return [destination, status]
    if (source.includes('*') && pathname.startsWith(before) && pathname.endsWith(after))
      return [
        destination.replace(
          ':splat',
          pathname.slice(before.length, pathname.length - after.length)
        ),
        status,
      ]
  }
  throw new Error(`No rule for ${pathname}`)
}
assert.deepEqual(resolve('/posts/hello'), ['/zh/%E5%BB%BA%E7%AB%99/hello/', '301'])
assert.deepEqual(resolve('/blog/hello'), ['/zh/hello', '301'])
assert.deepEqual(resolve('/categories/linux'), ['/zh/categories/linux', '301'])
assert.deepEqual(resolve('/static/images/new.webp'), [
  'https://api.zaixi.dev/static/images/new.webp',
  '302',
])
assert.deepEqual(resolve('/new-client-route/'), ['/index.html', '200'])
const headers = await readFile('out/_headers', 'utf8')
assert.ok(
  headers.includes('https://api.zaixi.dev') && headers.includes('https://blog-media.zaixi.dev')
)
console.log(
  'Pages artifact passed historical redirects, resource forwarding, SPA ordering and API/R2 CSP'
)
