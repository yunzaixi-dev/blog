import { createInterface } from 'node:readline'
import { parseFrontmatter } from './frontmatter'
import readingTime from 'reading-time'
import siteMetadata from '../data/siteMetadata'
import { parseDocument } from './document'
import { blogComputedFields, computedFields } from '../content-pipeline/computedFields'
import type { Blog, Authors } from '../lib/content/types'
import { setContent, getPostPageData, getTermListData } from '../lib/content/posts'
import { buildHomePageData } from '../lib/content/homePage'
import { buildTermIndexPageData, buildTermPageMeta } from '../lib/content/termPages'
import {
  localizedAlternates,
  localizedPostAlternates,
  localizedTermAlternates,
} from '../lib/seo/alternates'
import { locales, localeConfig, ui } from '../lib/i18n'
import { countTerms } from '../lib/content/terms'
import { createArticleJsonLd, createPostCollectionJsonLd } from '../lib/structuredData'
import { getPostImageUrls } from '../lib/postImages'
import { toForumMarkdown } from '../scripts/lib/post-export.mjs'
import { clearPostGitHistoryCache } from '../content-pipeline/gitHistory'

type Input = { files: { path: string; data: string }[] }
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )

export async function buildSnapshot(input: Input) {
  clearPostGitHistoryCache()
  const blogs: Blog[] = [],
    authors: Authors[] = []
  const bodies = new Map<string, Awaited<ReturnType<typeof parseDocument>>>()
  const exports: Record<string, string> = {}
  const documents = []
  for (const file of input.files) {
    const { data, content } = parseFrontmatter(file.data)
    const blog = file.path.startsWith('blog/')
    if (!blog && !file.path.startsWith('authors/')) continue
    if (
      blog &&
      (typeof data.title !== 'string' ||
        !data.title.trim() ||
        !(typeof data.date === 'string' || data.date instanceof Date) ||
        Number.isNaN(new Date(data.date).getTime()))
    )
      throw new Error(`${file.path}: title and valid date are required`)
    if (!blog && typeof data.name !== 'string')
      throw new Error(`${file.path}: author name is required`)
    for (const key of ['categories', 'tags', 'authors'])
      if (
        data[key] !== undefined &&
        (!Array.isArray(data[key]) || data[key].some((v: unknown) => typeof v !== 'string'))
      )
        throw new Error(`${file.path}: ${key} must contain strings`)
    if (data.draft !== undefined && typeof data.draft !== 'boolean')
      throw new Error(`${file.path}: draft must be boolean`)
    for (const key of ['summary', 'language', 'translationKey', 'image', 'canonicalUrl'])
      if (data[key] !== undefined && typeof data[key] !== 'string')
        throw new Error(`${file.path}: ${key} must be string`)
    const doc = {
      ...data,
      body: { raw: content },
      _raw: { sourceFilePath: file.path, flattenedPath: file.path.replace(/\.mdx?$/, '') },
    }
    const computed: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(blog ? blogComputedFields : computedFields))
      computed[key] = await field.resolve(doc)
    const metadata = {
      categories: [],
      tags: [],
      ...data,
      ...computed,
      date: data.date ? new Date(data.date as string | Date).toISOString() : undefined,
      lastmod: data.lastmod ? new Date(data.lastmod as string | Date).toISOString() : undefined,
      readingTime: readingTime(content),
    }
    const body = await parseDocument(content)
    if (!blog) {
      authors.push(metadata as unknown as Authors)
      continue
    }
    const post = metadata as unknown as Blog
    if (
      !['zh', 'en'].includes(post.locale) ||
      !post.slug ||
      /^(categories|tags|search|404)(?:\/|$)/.test(post.slug) ||
      /[?#\\]/.test(post.path)
    )
      throw new Error(`${file.path}: invalid article route`)
    if (post.canonicalUrl && !/^https?:\/\//i.test(post.canonicalUrl))
      throw new Error(`${file.path}: canonicalUrl must be HTTP(S)`)
    if (post.image && !/^(?:\/(?!\/)|https?:\/\/)/i.test(post.image))
      throw new Error(`${file.path}: invalid cover URL`)
    if (blogs.some((item) => item.path === post.path))
      throw new Error(`Duplicate article ${post.path}`)
    blogs.push(post)
    if (post.draft) continue
    bodies.set(post.path, body)
    const plain = (nodes: ((typeof body)[number] | string)[]): string =>
      nodes.map((node) => (typeof node === 'string' ? node : plain(node.children))).join(' ')
    documents.push({
      url: `/${post.path}/`,
      locale: post.locale,
      title: post.title,
      summary: post.summary || '',
      text: plain(body),
      image: post.image || '',
    })
    exports[`/export/${post.path}.md`] = toForumMarkdown(siteMetadata.siteUrl, {
      file: file.path,
      locale: post.locale,
      route: post.path,
      slug: post.slug,
      title: post.title,
      summary: post.summary || '',
      date: post.date,
      tags: post.tags,
      cover: post.image || '',
      body: content,
    })
  }
  setContent(blogs, authors)
  const pages: Record<string, unknown> = {}
  const add = (url: string, value: Record<string, unknown>) => {
    const post = value.post as Blog | undefined
    const canonical = post?.canonicalUrl || new URL(url, siteMetadata.siteUrl).href
    pages[url] = {
      ...value,
      url,
      metadata: {
        title: `${value.title} | ${siteMetadata.title}`,
        description: value.description || siteMetadata.description,
        canonical,
        languages: value.languages,
        image: getPostImageUrls({
          image: post?.image,
          images: post?.images,
          fallback: siteMetadata.socialBanner,
          siteUrl: siteMetadata.siteUrl,
        })[0],
        type: post ? 'article' : 'website',
        published: post?.date,
        modified: post?.gitUpdatedAt || post?.lastmod || post?.date,
        jsonLd: value.jsonLd,
      },
    }
  }
  for (const locale of locales) {
    const base = {
      locale,
      description: ui[locale].siteDescription,
      languages: localizedAlternates(siteMetadata.siteUrl).languages,
    }
    add(`/${locale}/`, { ...base, ...buildHomePageData(locale), kind: 'home' })
    add(`/${locale}/search/`, {
      ...base,
      title: ui[locale].search,
      kind: 'search',
      languages: localizedAlternates(siteMetadata.siteUrl, 'search').languages,
    })
    add(`/${locale}/404/`, { ...base, title: ui[locale].notFoundTitle, kind: 'notFound' })
    for (const field of ['categories', 'tags'] as const) {
      const index = buildTermIndexPageData(locale, field)
      add(`/${locale}/${field}/`, {
        ...base,
        ...index,
        field,
        kind: 'termIndex',
        languages: localizedAlternates(siteMetadata.siteUrl, field).languages,
      })
      for (const slug of Object.keys(
        countTerms(
          blogs.filter((p) => !p.draft && p.locale === locale),
          field
        )
      )) {
        const term = buildTermPageMeta(locale, field, slug),
          data = getTermListData(locale, field, slug)
        const { sourcePosts: _source, ...projection } = data
        void _source
        add(`/${locale}/${field}/${slug}/`, {
          ...base,
          ...projection,
          kind: 'term',
          title: term.title,
          description: term.description,
          visibleTitle:
            field === 'categories'
              ? ui[locale].categoryDetailTitle(term.term)
              : ui[locale].tagDetailTitle(term.term),
          languages: localizedTermAlternates(siteMetadata.siteUrl, field, slug).languages,
          jsonLd: createPostCollectionJsonLd({ ...term, locale, posts: data.posts }),
        })
      }
    }
    for (const post of blogs.filter((p) => !p.draft && p.locale === locale)) {
      const data = getPostPageData(locale, post.slug)!
      add(`/${post.path}/`, {
        ...base,
        ...data,
        kind: 'post',
        title: post.title,
        description: post.summary || '',
        body: bodies.get(post.path),
        languages: localizedPostAlternates(siteMetadata.siteUrl, post).languages,
        jsonLd: createArticleJsonLd({ post, authors: data.authorDetails, locale }),
      })
    }
  }
  const published = blogs.filter((p) => !p.draft).sort((a, b) => b.date.localeCompare(a.date))
  const feeds: Record<string, string> = {}
  const feed = (posts: Blog[], route: string) => {
    feeds[route] =
      `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>${escape(siteMetadata.title)}</title><link>${siteMetadata.siteUrl}</link><description>${escape(siteMetadata.description)}</description>${posts.map((post) => `<item><title>${escape(post.title)}</title><link>${escape(new URL(`/${post.path}/`, siteMetadata.siteUrl).href)}</link><guid>${escape(new URL(`/${post.path}/`, siteMetadata.siteUrl).href)}</guid><description>${escape(post.summary || '')}</description><pubDate>${new Date(post.date).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`
  }
  feed(published, '/feed.xml')
  for (const locale of locales) {
    const posts = published.filter((p) => p.locale === locale)
    for (const tag of Object.keys(countTerms(posts, 'tags'))) {
      const selected = getTermListData(locale, 'tags', tag).posts
      feed(
        posts.filter((p) => selected.some((item) => item.path === p.path)),
        `/${locale}/tags/${tag}/feed.xml`
      )
      if (locale === 'zh')
        feed(
          posts.filter((p) => selected.some((item) => item.path === p.path)),
          `/tags/${tag}/feed.xml`
        )
    }
  }
  const sitemap = `<?xml version="1.0" encoding="utf-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${Object.entries(
    pages
  )
    .filter(([url]) => !url.endsWith('/404/'))
    .map(([url, value]) => {
      const page = value as { metadata: { languages: Record<string, string>; modified?: string } }
      return `<url><loc>${escape(new URL(url, siteMetadata.siteUrl).href)}</loc>${page.metadata.modified ? `<lastmod>${escape(page.metadata.modified)}</lastmod>` : ''}${Object.entries(
        page.metadata.languages
      )
        .map(
          ([lang, href]) =>
            `<xhtml:link rel="alternate" hreflang="${escape(lang)}" href="${escape(href)}"/>`
        )
        .join('')}</url>`
    })
    .join('')}</urlset>`
  return {
    version: 1,
    pages,
    documents,
    exports,
    feeds,
    sitemap,
    robots: `User-agent: *\nAllow: /\nDisallow: /export/\nSitemap: ${siteMetadata.siteUrl}/sitemap.xml\n`,
    locales: Object.fromEntries(locales.map((l) => [l, localeConfig[l].htmlLang])),
  }
}

if (process.argv[1] && /content-worker\.(?:mjs|ts)$/.test(process.argv[1])) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    try {
      process.stdout.write(
        `${JSON.stringify({ result: await buildSnapshot(JSON.parse(line) as Input) })}\n`
      )
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`
      )
    }
  }
}
