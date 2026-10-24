import { expect, it, vi, afterEach } from 'vitest'
import { clearPostGitHistoryCache, getPostGitHistory } from '../../content-pipeline/gitHistory'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  clearPostGitHistoryCache()
})
it('does not request remote metadata on the default content path', async () => {
  vi.stubEnv('GIT_HISTORY_REMOTE', undefined)
  const fetch = vi.fn(() => {
    throw new Error('No network available')
  })
  vi.stubGlobal('fetch', fetch)
  await getPostGitHistory('content/blog/zh/not-in-git.md')
  expect(fetch).not.toHaveBeenCalled()
})
