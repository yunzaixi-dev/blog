import { useEffect } from 'react'
import { useLoaderData, useLocation } from 'react-router'
import JsonLd from '@/components/JsonLd'
import TermIndexView from '@/components/TermIndexView'
import SearchPageClient from '@/components/SearchPageClient'
import NotFoundPage from '@/components/NotFoundPage'
import DocumentRenderer from '@/components/DocumentRenderer'
import ListLayout from '@/layouts/ListLayoutWithTags'
import PostLayout from '@/layouts/PostLayout'
import type { Blog, Authors } from '@/lib/content/types'
import type { BlogListPost, PostNavItem } from '@/lib/listPosts'
import type { CountMap, TermSummary } from '@/lib/content/terms'
import type { ContentTreeNode } from '@/lib/content/contentTree'
import { localeConfig, type Locale } from '@/lib/i18n'
import type { TocHeading } from '@/lib/toc'
import type { DocumentNode } from '../server/document'

type PageData = {
  locale: Locale
  kind: 'home' | 'post' | 'term' | 'termIndex' | 'search' | 'notFound'
  title: string
  description: string
  url: string
  visibleTitle?: string
  posts: BlogListPost[]
  contentTree: ContentTreeNode[]
  categoryCounts: CountMap
  tagCounts: CountMap
  field: 'categories' | 'tags'
  terms: TermSummary[]
  post: Blog
  authorDetails: Authors[]
  previousPost: PostNavItem | null
  nextPost: PostNavItem | null
  toc: TocHeading[]
  body: DocumentNode[]
  metadata: {
    title: string
    description: string
    canonical: string
    languages: Record<string, string>
    image: string
    type: string
    jsonLd: Record<string, unknown>
  }
}
export async function pageLoader({ request }: { request: Request }) {
  const path = new URL(request.url).pathname
  const response = await fetch(`/api/page?${new URLSearchParams({ path: decodeURI(path) })}`, {
    signal: request.signal,
    cache: 'no-store',
  })
  if (!response.ok && response.status !== 404)
    throw new Error(`Content request failed (${response.status})`)
  return (await response.json()) as PageData
}
export default function Page() {
  const page = useLoaderData() as PageData
  const location = useLocation()
  useEffect(() => {
    document.documentElement.lang = localeConfig[page.locale].htmlLang
  }, [page.locale])
  return (
    <>
      <title>{page.metadata.title}</title>
      <meta name="description" content={page.metadata.description} />
      <link rel="canonical" href={page.metadata.canonical} />
      {Object.entries(page.metadata.languages).map(([lang, href]) => (
        <link key={lang} rel="alternate" hrefLang={lang} href={href} />
      ))}
      <meta property="og:title" content={page.metadata.title} />
      <meta property="og:description" content={page.metadata.description} />
      <meta property="og:url" content={page.metadata.canonical} />
      <meta property="og:type" content={page.metadata.type} />
      <meta property="og:locale" content={localeConfig[page.locale].htmlLang.replace('-', '_')} />
      <meta property="og:site_name" content="zaixi.dev" />
      <meta property="og:image" content={page.metadata.image} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={page.metadata.title} />
      <meta name="twitter:description" content={page.metadata.description} />
      <meta name="twitter:image" content={page.metadata.image} />
      <JsonLd data={page.metadata.jsonLd} />
      {page.kind === 'notFound' && <meta name="robots" content="noindex" />}
      {(page.kind === 'home' || page.kind === 'term') && (
        <ListLayout key={location.key} {...page} />
      )}
      {page.kind === 'termIndex' && <TermIndexView {...page} />}
      {page.kind === 'search' && <SearchPageClient key={page.locale} locale={page.locale} />}
      {page.kind === 'post' && (
        <PostLayout {...page}>
          <DocumentRenderer nodes={page.body} />
        </PostLayout>
      )}
      {page.kind === 'notFound' && <NotFoundPage />}
    </>
  )
}
