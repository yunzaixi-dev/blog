import type { ReadTimeResults } from 'reading-time'
import type { TocHeading } from '../toc'
import type { Locale } from '../i18n'
import type { PostGitCommit } from '../postGit'

type Document = {
  slug: string
  path: string
  filePath: string
  readingTime: ReadTimeResults
  toc: TocHeading[]
}

export type Authors = Document & {
  name: string
  avatar?: string
  occupation?: string
  company?: string
  email?: string
  x?: string
  telegram?: string
  github?: string
}

export type Blog = Document & {
  title: string
  date: string
  categories: string[]
  tags: string[]
  lastmod?: string
  draft?: boolean
  summary?: string
  language?: string
  locale: Locale
  translationKey?: string
  image?: string
  images?: string | string[]
  authors?: string[]
  canonicalUrl?: string
  gitUpdatedAt: string
  gitCommits: PostGitCommit[]
  gitCommitCount: number
  githubUrl: string
}
