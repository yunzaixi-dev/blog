import { test as base, expect } from '@playwright/test'
import { buildSnapshot } from '../../server/content-worker'

const rich = `---
title: Rich runtime reading
date: 2026-10-01
tags: [Fixture]
---
## 包含长标签与英文 inline_code 的内容目录标题

正文中的 inline_code 与丰富内容。

$$
f(x) = ${Array.from({ length: 30 }, (_, i) => `x_{${i}}`).join(' + ')}
$$

~~~ts title="Long code" showLineNumbers
const longValue = "${'long static value '.repeat(30)}"
~~~

| Compact | Value |
| --- | --- |
| A | B |

| Long column | Long value | Another column |
| --- | --- | --- |
| ${'VeryLongTableValue'.repeat(30)} | ${'AnotherLongValue'.repeat(30)} | Tail |

## Second section

- A nested content family item
- Another item with static text

${'A complete paragraph for readable English and 中文阅读。 '.repeat(40)}
`.replaceAll('\u0001', '`')
let snapshot: ReturnType<typeof buildSnapshot> | undefined
function fixtureSnapshot() {
  return (snapshot ||= buildSnapshot({
    files: [
      { path: 'blog/zh/测试/rich.md', data: rich },
      {
        path: 'blog/en/fixture/reading.md',
        data: `---\ntitle: English runtime reading\ndate: 2026-10-01\n---\n${'This is a readable English paragraph with clear language and enough prose to measure natural line length. '.repeat(9)}\n\n## Reading section\n\nAn inline \`code_token\` remains styled.\n\n${'The next paragraph continues the article for scrolling and measuring. '.repeat(35)}`,
      },
    ],
  }))
}

export const test = base.extend({
  page: async ({ page, javaScriptEnabled }, use) => {
    const goto = page.goto.bind(page)
    page.goto = async (...args) => {
      const response = await goto(...args)
      if (javaScriptEnabled !== false) await page.locator('main h1').waitFor({ state: 'attached' })
      return response
    }
    await page.route(
      (url) =>
        ['/zh/测试/rich/', '/en/fixture/reading/'].includes(decodeURI(url.pathname)) ||
        (url.pathname === '/api/page' &&
          ['/zh/测试/rich/', '/en/fixture/reading/'].includes(url.searchParams.get('path') || '')),
      async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/page') {
          const data = await fixtureSnapshot()
          await route.fulfill({ json: data.pages[url.searchParams.get('path')!] })
        } else {
          const response = await route.fetch({ url: new URL('/zh/', url).href })
          await route.fulfill({ response, status: 200 })
        }
      }
    )
    await use(page)
  },
})
export { expect }
