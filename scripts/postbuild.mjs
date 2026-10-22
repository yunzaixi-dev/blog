import rss from './rss.mjs'
import { execSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import siteMetadata from '../data/siteMetadata.ts'
import { normalizeExportedHtmlLanguages } from './lib/localized-html.mjs'
import { readPosts, toForumMarkdown } from './lib/post-export.mjs'

/** Forum-ready Markdown for every post at /export/<locale>/<category>/<slug>.md, to copy from any device. */
async function forumExports() {
  const siteUrl = siteMetadata.siteUrl.replace(/\/$/, '')
  const posts = await readPosts()
  for (const post of posts) {
    const file = path.join('out', 'export', `${post.route}.md`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, toForumMarkdown(siteUrl, post))
  }
  console.log(`Forum Markdown exported for ${posts.length} posts`)
}

async function searchIndex() {
  try {
    execSync('pagefind --site out', { stdio: 'inherit', cwd: process.cwd() })
    console.log('Pagefind search index generated...')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Pagefind index generation failed:', message)
    throw error
  }
}

async function postbuild() {
  await rss()
  await forumExports()
  await normalizeExportedHtmlLanguages('out')
  await searchIndex()
}

postbuild()
