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
    assert.ok(src, 'Article media must have a source')
    // A default cover may use the stable API alias; validate the actual redirect
    // target and image bytes, not just the authored src string.
    const response = await page.request.get(src)
    assert.equal(response.status(), 200, `Media request failed: ${src}`)
    assert.ok(response.headers()['content-type']?.startsWith('image/'))
    const publication = await page.request.get(
      `${process.env.API_BASE_URL || 'http://127.0.0.1:45141'}/api/page?path=/zh/`
    )
    assert.equal(publication.status(), 200)
    const revision = publication.headers()['x-content-revision']
    assert.ok(revision, 'API must identify the committed release')
    const finalURL = new URL(response.url())
    const mediaBase = new URL(process.env.MEDIA_BASE_URL || response.url())
    assert.equal(finalURL.origin, mediaBase.origin)
    assert.ok(
      finalURL.pathname.includes(`/releases/${revision}/`),
      `Unexpected media target: ${response.url()}`
    )
    await media.evaluate(async (image) => {
      if (!(image instanceof HTMLImageElement)) throw new Error('Expected an image')
      await image.decode()
      if (image.naturalWidth === 0) throw new Error('Image did not decode')
    })
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
