import { expect, test, type Browser } from '@playwright/test'

const previewPort = Number(process.env.PLAYWRIGHT_PORT || 45102)
const devPort = Number(process.env.PLAYWRIGHT_DEV_PORT || 45100)
const previewBaseUrl = `http://127.0.0.1:${previewPort}`
const devBaseUrl = `http://127.0.0.1:${devPort}`
const parityEnabled = process.env.PLAYWRIGHT_DEV_PREVIEW_PARITY === '1'

type PageSnapshot = {
  status: number
  title: string
  htmlLang: string | null
  heading: string
  description: string
  backLink: string | null
}

async function capturePage(browser: Browser, baseUrl: string, pathname: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const events: string[] = []
  const record = (value: string) => events.push(`${Date.now()} ${value}`)
  page.on('request', (request) => {
    if (request.isNavigationRequest() || request.url().includes('/api/'))
      record(`request ${request.url()}`)
  })
  page.on('response', (response) => {
    if (response.request().isNavigationRequest() || response.url().includes('/api/'))
      record(`response ${response.status()} ${response.url()}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      record(`console ${message.type()} ${message.text()}`)
  })
  page.on('pageerror', (error) => record(`pageerror ${error.message}`))

  try {
    record('navigation start')
    const response = await page.goto(`${baseUrl}${pathname}`)
    record('navigation complete')
    await page.locator('h1').waitFor()
    record('heading ready')
    const description = page.locator('h1 + p')
    const backLink = page.locator('h1 + p + a')

    return {
      status: response?.status() || 0,
      title: await page.title(),
      htmlLang: await page.locator('html').getAttribute('lang'),
      heading: await page.locator('h1').innerText(),
      description: (await description.count()) > 0 ? (await description.textContent()) || '' : '',
      backLink: (await backLink.count()) > 0 ? await backLink.getAttribute('href') : null,
    } satisfies PageSnapshot
  } finally {
    record('context close start')
    console.log(`[parity-stage] ${baseUrl}${pathname}\n${events.join('\n')}`)
    await context.close()
    console.log(`[parity-stage] ${baseUrl}${pathname} context close complete`)
  }
}

test.describe('development and static preview parity', () => {
  test.skip(!parityEnabled, 'Run with pnpm test:e2e:parity')

  test('shared redirects preserve status, destination, Unicode, and trailing slashes', async ({
    request,
  }) => {
    for (const pathname of [
      '/',
      '/categories',
      '/categories/',
      '/blog/xiaomi-book-pro-14',
      '/blog/xiaomi-book-pro-14/',
      '/blog/%E6%8A%98%E8%85%BE/',
    ]) {
      const [development, preview] = await Promise.all([
        request.get(`${devBaseUrl}${pathname}`, { maxRedirects: 0 }),
        request.get(`${previewBaseUrl}${pathname}`, { maxRedirects: 0 }),
      ])

      expect({ status: development.status(), location: development.headers().location }).toEqual({
        status: preview.status(),
        location: preview.headers().location,
      })
    }
  })

  test('legacy image URLs return the same WebP in development and preview', async ({ request }) => {
    for (const base of [devBaseUrl, previewBaseUrl]) {
      const redirect = await request.get(`${base}/static/images/codex-cheap-claude-alt/panel.jpg`, {
        maxRedirects: 0,
      })
      expect(redirect.status()).toBe(301)
      expect(redirect.headers().location).toBe('/static/images/codex-cheap-claude-alt/panel.webp')
      const response = await request.get(`${base}/static/images/codex-cheap-claude-alt/panel.jpg`)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toBe('image/webp')
      expect((await response.body()).subarray(0, 4).toString()).toBe('RIFF')
    }
  })

  for (const [pathname, htmlLang] of [
    ['/zh/', 'zh-CN'],
    ['/en/', 'en-US'],
    ['/zh/categories/%E6%95%B0%E6%8D%AE%E5%88%86%E6%9E%90/', 'zh-CN'],
  ] as const) {
    test(`${pathname} renders the same localized document`, async ({ browser }) => {
      const [development, preview] = await Promise.all([
        capturePage(browser, devBaseUrl, pathname),
        capturePage(browser, previewBaseUrl, pathname),
      ])

      expect(development.status).toBe(200)
      expect(preview.status).toBe(200)
      expect(development.htmlLang).toBe(htmlLang)
      expect(preview.htmlLang).toBe(htmlLang)
      expect(development.heading).toBe(preview.heading)
    })
  }

  for (const pathname of ['/missing', '/zh/missing', '/en/missing']) {
    test(`${pathname} renders the same custom 404`, async ({ browser }) => {
      const [development, preview] = await Promise.all([
        capturePage(browser, devBaseUrl, pathname),
        capturePage(browser, previewBaseUrl, pathname),
      ])

      expect(development).toEqual(preview)
      expect(development.status).toBe(404)
      expect(development.title).toContain('zaixi.dev')
      expect(development.backLink).toBe(pathname.startsWith('/en/') ? '/en/' : '/zh/')
    })
  }
})
