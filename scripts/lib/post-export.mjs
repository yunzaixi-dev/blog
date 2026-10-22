// Turns a post's source into the two formats it is republished in: Markdown a
// forum accepts as-is, and rich text for X's article editor. Shared by the
// export CLI (scripts/export-post.mjs) and postbuild, which serves the forum
// Markdown at /export/<locale>/<category>/<slug>.md.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

const CONTENT_DIR = path.join('content', 'blog')
const POST_EXTENSIONS = new Set(['.md', '.mdx'])

/**
 * @typedef {{ file: string, locale: string, route: string, slug: string, title: string, summary: string, date: string, tags: string[], cover: string, body: string }} ExportPost
 */

/** @returns {Promise<ExportPost[]>} every published post, newest first */
export async function readPosts() {
  const posts = []
  for (const entry of await readdir(CONTENT_DIR, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !POST_EXTENSIONS.has(path.extname(entry.name))) continue
    const file = path.join(entry.parentPath, entry.name)
    const { data, content } = matter(await readFile(file, 'utf8'))
    if (data.draft === true) continue
    // content/blog/<locale>/<category>/<slug>.md is served at /<locale>/<category>/<slug>/.
    const route = path
      .relative(CONTENT_DIR, file)
      .split(path.sep)
      .join('/')
      .replace(/\.mdx?$/, '')
    posts.push({
      file,
      locale: route.split('/')[0],
      route,
      slug: path.basename(route),
      title: String(data.title),
      summary: data.summary ? String(data.summary) : '',
      date: data.date instanceof Date ? data.date.toISOString() : String(data.date),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      cover: data.image ? String(data.image) : '',
      body: content,
    })
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date))
}

/** @param {ExportPost[]} posts @param {string} query a slug or route */
export function findPost(posts, query) {
  const wanted = query.replace(/^\/+|\/+$/g, '')
  return posts.find((post) => post.route === wanted || post.slug === wanted)
}

/** @param {string} siteUrl @param {ExportPost} post */
export function postUrl(siteUrl, post) {
  return `${siteUrl}/${post.route.split('/').map(encodeURIComponent).join('/')}/`
}

/**
 * Site-relative link and image targets become absolute, so the text works off-site.
 * @param {string} siteUrl
 * @param {string} markdown
 */
export function absolutize(siteUrl, markdown) {
  return markdown
    .replace(/(\]\()\/(?!\/)/g, `$1${siteUrl}/`)
    .replace(/((?:src|href)=["'])\/(?!\/)/g, `$1${siteUrl}/`)
}

/**
 * Markdown for forums (NodeSeek and other Markdown boards): title, summary,
 * the body with absolute image URLs, and a link back to the original.
 * @param {string} siteUrl
 * @param {ExportPost} post
 */
export function toForumMarkdown(siteUrl, post) {
  const parts = [`# ${post.title}`]
  if (post.summary) parts.push(`> ${post.summary}`)
  if (post.cover) parts.push(`![${post.title}](${siteUrl}${post.cover})`)
  parts.push(absolutize(siteUrl, post.body.trim()))
  parts.push(`---\n\n原文：[${post.title}](${postUrl(siteUrl, post)})`)
  return parts.join('\n\n') + '\n'
}

/** @typedef {{ number: number, url: string, alt: string }} ExportImage */
/** @typedef {any} MdastNode Markdown tree nodes are rewritten in place across many types. */

/** @param {string} value */
const text = (value) => ({ type: 'text', value })
/** @param {...MdastNode} children */
const paragraph = (...children) => ({ type: 'paragraph', children })

/**
 * Rewrites the Markdown tree into what X's article editor keeps on paste:
 * headings, paragraphs, lists, quotes, links and emphasis. Images cannot be
 * pasted, so each becomes a numbered marker and is returned for upload in
 * order; code and tables, which the editor does not render, become quotes and
 * plain lines rather than vanishing.
 * @param {string} siteUrl
 * @param {ExportImage[]} images receives each image in order
 */
function xArticleTransform(siteUrl, images) {
  /** @param {MdastNode} tree */
  return (tree) => {
    let count = 0
    /** @param {MdastNode} node */
    const visit = (node) => {
      if (!node.children) return
      node.children = node.children.flatMap((/** @type {MdastNode} */ child) => {
        if (child.type === 'image') {
          const url = /^https?:/.test(child.url) ? child.url : `${siteUrl}${child.url}`
          count += 1
          images.push({ number: count, url, alt: child.alt || '' })
          return [
            {
              type: 'strong',
              children: [
                text(
                  `【图 ${String(count).padStart(2, '0')}${child.alt ? `：${child.alt}` : ''}】`
                ),
              ],
            },
          ]
        }
        if (child.type === 'code') {
          return [
            {
              type: 'blockquote',
              children: child.value
                .split('\n')
                .map((/** @type {string} */ line) =>
                  paragraph({ type: 'inlineCode', value: line || ' ' })
                ),
            },
          ]
        }
        if (child.type === 'table') {
          return child.children.map((/** @type {MdastNode} */ row) =>
            paragraph(
              text(
                row.children
                  .map((/** @type {MdastNode} */ cell) =>
                    cell.children.map((/** @type {MdastNode} */ c) => c.value ?? '').join('')
                  )
                  .join(' ｜ ')
              )
            )
          )
        }
        if (child.type === 'heading') {
          // The editor has two heading levels.
          child.depth = child.depth <= 2 ? 2 : 3
        }
        if (child.type === 'link' && child.url.startsWith('/')) child.url = `${siteUrl}${child.url}`
        visit(child)
        return [child]
      })
    }
    visit(tree)
  }
}

/**
 * Rich text for X articles, plus the images to insert at each marker.
 * @param {string} siteUrl
 * @param {ExportPost} post
 */
export async function toXArticle(siteUrl, post) {
  /** @type {ExportImage[]} */
  const images = []
  if (post.cover) images.push({ number: 0, url: `${siteUrl}${post.cover}`, alt: '封面' })
  const html = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(() => xArticleTransform(siteUrl, images))
      .use(remarkRehype)
      .use(rehypeStringify)
      .process(post.body)
  )
  const footer = `<p>原文：<a href="${postUrl(siteUrl, post)}">${postUrl(siteUrl, post)}</a></p>`
  return { title: post.title, html: html + footer, images }
}
