import { readFile, writeFile, rm } from 'node:fs/promises'

const api = process.env.API_BASE_URL
if (api !== 'https://api.zaixi.dev')
  throw new Error('Pages release requires the production API origin')
const media = process.env.MEDIA_BASE_URL || 'https://blog-media.zaixi.dev'
if (media !== 'https://blog-media.zaixi.dev')
  throw new Error('Pages release requires the production media origin')
// Content and mutable media come from Go, never from this Pages deployment.
await rm('out/static/images', { recursive: true, force: true })
await rm('out/forum', { recursive: true, force: true })
const historical = await readFile('public/_redirects', 'utf8')
await writeFile(
  'out/_redirects',
  `${historical.trim()}\n/static/images/* ${api}/static/images/:splat 302\n/forum/* ${api}/forum/:splat 302\n/export/* ${api}/export/:splat 302\n/feed.xml ${api}/feed.xml 302\n/sitemap.xml ${api}/sitemap.xml 302\n/robots.txt ${api}/robots.txt 302\n/* /index.html 200\n`
)
const headers = await readFile('out/_headers', 'utf8')
await writeFile(
  'out/_headers',
  headers
    .replace("connect-src 'self'", `connect-src 'self' ${api}`)
    .replace("img-src 'self'", `img-src 'self' ${api} ${media}`)
    .replace("media-src 'self'", `media-src 'self' ${api} ${media}`)
)
const html = await readFile('out/index.html', 'utf8')
await writeFile('out/index.html', html.replace('href="/feed.xml"', `href="${api}/feed.xml"`))
console.log('Prepared Pages shell, API CSP, backend media redirects and client-route fallback')
