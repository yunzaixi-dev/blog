import { expect, test } from '@playwright/test'

test('closed and hidden responsive directories do not measure headings while scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(encodeURI('/zh/数据分析/nodeseek-post-types/'))
  await page.locator('[data-article-body]').waitFor()
  const measure = () =>
    page.evaluate(async () => {
      let reads = 0
      const original = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = function () {
        if (this.matches('h2[id], h3[id]')) reads++
        return original.call(this)
      }
      try {
        for (let frame = 0; frame < 12; frame++) {
          window.scrollTo({ top: 150 + frame * 20, behavior: 'instant' })
          await new Promise(requestAnimationFrame)
        }
        return reads
      } finally {
        Element.prototype.getBoundingClientRect = original
      }
    })

  const disclosure = page.locator('.article-toc-mobile > button')
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  expect(await measure()).toBe(0)
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  expect(await measure()).toBeGreaterThan(0)
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  expect(await measure()).toBe(0)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.locator('.article-toc-desktop')).toBeVisible()
  expect(await measure()).toBeGreaterThan(0)
})
