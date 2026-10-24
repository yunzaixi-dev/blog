import { expect, test, type Page } from '@playwright/test'

type TermRoute = {
  locale: 'zh' | 'en'
  section: 'categories' | 'tags'
  navigationLabel: string
  indexHeading: string
  indexPath: string
  detailVisibleHeading: string
  detailPath: string
}

const termRoutes: TermRoute[] = [
  {
    locale: 'zh',
    section: 'categories',
    navigationLabel: '分类',
    indexHeading: '全部分类',
    indexPath: '/zh/categories/',
    detailVisibleHeading: '分类：数据分析',
    detailPath: '/zh/categories/%E6%95%B0%E6%8D%AE%E5%88%86%E6%9E%90/',
  },
  {
    locale: 'zh',
    section: 'tags',
    navigationLabel: '标签',
    indexHeading: '全部标签',
    indexPath: '/zh/tags/',
    detailVisibleHeading: '#NodeSeek',
    detailPath: '/zh/tags/nodeseek/',
  },
]

async function navigateFromPrimaryNavigation(page: Page, route: TermRoute) {
  const header = page.getByRole('banner')
  const openNavigationLabel = route.locale === 'zh' ? '打开导航' : 'Open navigation'
  const navigationLabel = route.locale === 'zh' ? '主导航' : 'Primary navigation'

  if ((page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 1024) {
    await header.getByRole('button', { name: openNavigationLabel }).click()
  }

  await header
    .getByRole('navigation', { name: navigationLabel })
    .getByRole('link', { name: route.navigationLabel, exact: true })
    .click()
}

async function expectStableTermChip(page: Page, href: string) {
  const chip = page.locator(`main a[href="${decodeURI(href)}"]`).first()
  const box = await chip.boundingBox()
  const transitionProperty = await chip.evaluate(
    (element) => getComputedStyle(element).transitionProperty
  )

  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(transitionProperty).not.toContain('all')
  expect(transitionProperty).toContain('color')
}

test('application shell explains its API content contract without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(new URL('/zh/categories/', baseURL).href)
  expect(await page.content()).toContain('通过 API 加载文章')
  await expect(page.locator('main')).toHaveCount(0)
  await context.close()
})

for (const route of termRoutes) {
  test(`${route.locale} ${route.section} navigates from the header through a term chip`, async ({
    page,
  }) => {
    await page.goto(`/${route.locale}/`)
    await navigateFromPrimaryNavigation(page, route)

    await expect(page).toHaveURL(route.indexPath)
    await expect(page.getByRole('heading', { level: 1, name: route.indexHeading })).toBeVisible()
    await expectStableTermChip(page, route.detailPath)

    await page.locator(`main a[href="${decodeURI(route.detailPath)}"]`).click()

    await expect(page).toHaveURL(route.detailPath)
    await expect(
      page.getByRole('heading', { level: 1, name: route.detailVisibleHeading })
    ).toBeVisible()
    await expect(page.locator('main [data-post-shell]').first()).toBeVisible()
  })
}
