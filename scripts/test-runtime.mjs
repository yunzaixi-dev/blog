import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, stat, utimes, rm, readFile, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'

const directory = await mkdtemp('/tmp/opencode/blog-runtime-')
const content = path.join(directory, 'content')
await mkdir(path.join(content, 'blog', 'zh', '测试'), { recursive: true })
const file = path.join(content, 'blog', 'zh', '测试', 'fresh.md')
const source = (body = 'Alpha正文', draft = false) =>
  `---\ntitle: Runtime Fresh\ndate: 2026-10-01\ncategories: [运行时]\ntags: [Runtime]\ndraft: ${draft}\n---\n## Heading\n\n${body}\n`
await writeFile(file, source())
await writeFile(
  path.join(content, 'blog', 'zh', '测试', 'private.md'),
  '---\ntitle: PrivateDraftTitle\nsummary: PrivateDraftSummary\ndate: 2026-10-02\ncategories: [PrivateDraftCategory]\ntags: [PrivateDraftTag]\ndraft: true\n---\nPrivateDraftBody'
)
const child = spawn(
  path.resolve('dist', 'blog'),
  ['--addr', '127.0.0.1:45101', '--static', 'out', '--content', content],
  { stdio: ['ignore', 'ignore', 'pipe'] }
)
try {
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Server exited ${code}`)))
    child.stderr.on('data', (data) => {
      if (String(data).includes('Blog listening')) resolve(undefined)
    })
  })
  /** @param {string} url */
  const get = (url) => fetch(`http://127.0.0.1:45101${url}`)
  /** @param {string} word */
  const assertVisible = async (word) => {
    const page = await get('/api/page?path=/zh/测试/fresh/')
    assert.equal(page.status, 200)
    assert.equal(page.headers.get('cache-control'), 'no-store')
    assert.ok((await page.text()).includes(word))
    const search = await get(`/api/search?q=${encodeURIComponent(word)}&locale=zh`)
    assert.equal((await search.json()).results.length, 1)
    for (const url of ['/feed.xml', '/sitemap.xml', '/export/zh/测试/fresh.md']) {
      const response = await get(url)
      assert.equal(response.status, 200)
      assert.ok((await response.text()).includes(url.endsWith('.md') ? word : 'fresh'))
    }
  }
  await assertVisible('Alpha正文')
  for (const url of [
    '/api/page?path=/zh/',
    '/api/page?path=/zh/测试/fresh/',
    '/api/page?path=/zh/categories/',
    '/api/page?path=/zh/tags/',
    '/api/search?q=PrivateDraft&locale=zh',
    '/feed.xml',
    '/sitemap.xml',
  ]) {
    assert.ok(!(await (await get(url)).text()).includes('PrivateDraft'), `Draft leaked via ${url}`)
  }
  for (const url of ['/api/page?path=/zh/测试/private/', '/export/zh/测试/private.md'])
    assert.equal((await get(url)).status, 404)
  const info = await stat(file)
  await writeFile(file, source('Bravo正文'))
  await utimes(file, info.atime, info.mtime)
  assert.equal((await stat(file)).size, info.size)
  await assertVisible('Bravo正文')
  const added = path.join(content, 'blog', 'zh', '测试', 'added.md')
  await writeFile(added, source('新文章即时出现'))
  assert.equal((await get('/api/page?path=/zh/测试/added/')).status, 200)
  await rm(added)
  assert.equal((await get('/api/page?path=/zh/测试/added/')).status, 404)
  await writeFile(file, source('Bravo正文', true))
  assert.equal((await get('/api/page?path=/zh/测试/fresh/')).status, 404)
  assert.equal((await get('/export/zh/测试/fresh.md')).status, 404)
  assert.equal((await (await get('/api/search?q=Bravo&locale=zh')).json()).results.length, 0)
  assert.ok(!(await (await get('/sitemap.xml')).text()).includes('/测试/fresh/'))
  await writeFile(file, '---\ntitle: [broken\n---\nBad')
  for (const url of [
    '/api/page?path=/zh/',
    '/api/search?q=x&locale=zh',
    '/feed.xml',
    '/sitemap.xml',
    '/export/zh/测试/fresh.md',
    '/zh/测试/fresh/',
  ])
    assert.equal((await get(url)).status, 503)
  await writeFile(file, source('恢复后立即可见'))
  await assertVisible('恢复后立即可见')
  const html = await (await get('/zh/测试/fresh/')).text()
  assert.ok(html.includes('Runtime Fresh'))
  assert.ok(!html.includes('恢复后立即可见'))
  for (const entry of await readdir('out/assets')) {
    if (entry.endsWith('.js'))
      assert.ok(
        !(await readFile(path.join('out/assets', entry), 'utf8')).includes('恢复后立即可见')
      )
  }
  assert.equal((await get('/api/unknown')).status, 404)
  assert.equal((await get('/static/unknown.png')).status, 404)
  console.log(
    'Runtime publication passed: create, same-length preserved-time edit, draft, delete, invalid/recover; page/search/feed/sitemap/export remain coherent without rebuild/restart'
  )
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await once(child, 'exit')
  }
  await rm(directory, { recursive: true, force: true })
}
