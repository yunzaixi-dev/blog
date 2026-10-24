import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildSnapshot } from '../../server/content-worker'

describe('content snapshot projections', () => {
  afterEach(() => vi.unstubAllEnvs())
  for (const environment of [undefined, 'production'])
    it(`never exposes draft metadata in public projections (${environment || 'unset'})`, async () => {
      vi.stubEnv('NODE_ENV', environment)
      const files = [
        {
          path: 'blog/zh/Test/public.md',
          data: '---\ntitle: Published\ndate: 2026-10-01\ncategories: [Public]\n---\nVisible',
        },
        {
          path: 'blog/zh/Test/secret.md',
          data: '---\ntitle: PrivateDraftTitle\nsummary: PrivateDraftSummary\ndate: 2026-10-02\ncategories: [PrivateDraftCategory]\ntags: [PrivateDraftTag]\ndraft: true\n---\nPrivateDraftBody',
        },
      ]
      const snapshot = await buildSnapshot({ files })
      expect(JSON.stringify(snapshot)).not.toContain('PrivateDraft')
      expect(snapshot.pages['/zh/Test/secret/']).toBeUndefined()
    })
  it('supports isolated English content, same-snapshot terms and draft filtering', async () => {
    const result = await buildSnapshot({
      files: [
        {
          path: 'blog/en/Test/new.md',
          data: '---\ntitle: Fresh\ndate: 2026-10-01\ncategories: [Test]\ntags: [Runtime]\n---\n## New body\n\nUnicode 中文 😀',
        },
        {
          path: 'blog/en/Test/draft.md',
          data: '---\ntitle: Secret\ndate: 2026-10-01\ndraft: true\n---\nHidden',
        },
      ],
    })
    expect(result.pages['/en/Test/new/']).toBeTruthy()
    expect(result.pages['/en/categories/test/']).toBeTruthy()
    expect(result.pages['/en/Test/draft/']).toBeUndefined()
    expect(result.documents).toHaveLength(1)
    expect(result.sitemap).toContain('/en/Test/new/')
    expect(result.feeds['/feed.xml']).toContain('Fresh')
    expect(result.exports['/export/en/Test/new.md']).toContain('Unicode 中文 😀')
  })
})
