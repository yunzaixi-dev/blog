import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('backend URL boundary', () => {
  it('keeps local API requests same-origin by default', async () => {
    vi.stubEnv('API_BASE_URL', '')
    const { backendUrl } = await import('../../lib/backend')
    expect(backendUrl('/api/page?path=%2Fzh%2F')).toBe('/api/page?path=%2Fzh%2F')
  })

  it('uses the configured production API origin for page and search', async () => {
    vi.stubEnv('API_BASE_URL', 'https://api.zaixi.dev/')
    const { backendUrl } = await import('../../lib/backend')
    expect(backendUrl('/api/page?path=%2Fzh%2F')).toBe(
      'https://api.zaixi.dev/api/page?path=%2Fzh%2F'
    )
    expect(backendUrl('/api/search?q=test&locale=zh')).toBe(
      'https://api.zaixi.dev/api/search?q=test&locale=zh'
    )
  })

  it('moves only backend resources, preserving page links and external assets', async () => {
    vi.stubEnv('API_BASE_URL', 'https://api.zaixi.dev')
    const { resolveBackendResources } = await import('../../lib/backend')
    expect(
      resolveBackendResources({
        image: '/static/images/new.webp',
        body: [{ props: { src: '/forum/chart.webp', href: '/zh/topic/post/' } }],
        external: 'https://example.com/static/file.png',
        canonical: 'https://zaixi.dev/zh/topic/post/',
        export: '/export/zh/topic/post.md',
      })
    ).toEqual({
      image: 'https://api.zaixi.dev/static/images/new.webp',
      body: [{ props: { src: 'https://api.zaixi.dev/forum/chart.webp', href: '/zh/topic/post/' } }],
      external: 'https://example.com/static/file.png',
      canonical: 'https://zaixi.dev/zh/topic/post/',
      export: 'https://api.zaixi.dev/export/zh/topic/post.md',
    })
  })
})
