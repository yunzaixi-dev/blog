import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { once } from 'node:events'
import path from 'node:path'

// Serve the actual split-origin Pages build without Go's dynamic shell handler.
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname
  const filename = pathname.startsWith('/assets/') ? pathname.slice(1) : 'index.html'
  if (filename.includes('..')) {
    response.writeHead(404).end()
    return
  }
  try {
    const data = await readFile(path.join('out', filename))
    response.setHeader(
      'Content-Type',
      filename.endsWith('.js')
        ? 'text/javascript'
        : filename.endsWith('.css')
          ? 'text/css'
          : 'text/html'
    )
    response.end(data)
  } catch {
    response.writeHead(404).end()
  }
})
server.listen(45140, '127.0.0.1')
await once(server, 'listening')
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  /** @type {string[]} */
  const failed = []
  page.on('pageerror', (error) => failed.push(error.message))
  await page.goto('http://127.0.0.1:45140/zh/')
  await page.getByRole('main').waitFor()
  await page.locator('article').first().waitFor()
  assert.equal((await page.locator('h1').count()) > 0, true)
  const media = page.locator('article img').first()
  if (await media.count()) {
    const src = await media.getAttribute('src')
    assert.ok(src?.includes('/releases/'), `Expected immutable media URL, got ${src}`)
  }
  await page.goto('http://127.0.0.1:45140/zh/nonexistent-cross-origin/')
  await page.locator('[data-not-found-code]').waitFor()
  assert.deepEqual(failed, [])
  console.log(
    'Pages split-origin browser passed: direct dynamic route, API content and API 404 rendering'
  )
} finally {
  await browser.close()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve(undefined)))
  )
}
