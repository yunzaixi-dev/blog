import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  /** @type {string[]} */
  const violations = []
  page.on('console', (message) => {
    if (/Content Security Policy|content-security-policy|violates.*directive/i.test(message.text()))
      violations.push(message.text())
  })
  await page.goto(process.env.TEST_DEV_URL || 'http://127.0.0.1:45100/zh/')
  await page.locator('article').first().waitFor()
  const avatar = page.locator('img[src*="avatar.webp"]').first()
  await avatar.waitFor()
  await page.waitForFunction(() => {
    const image = document.querySelector('img[src*="avatar.webp"]')
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
  })
  assert.ok(
    await avatar.evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth > 0)
  )
  assert.deepEqual(violations, [])
  console.log('Dev media browser passed: anonymous S3 avatar naturalWidth > 0, no CSP violations')
} finally {
  await browser.close()
}
