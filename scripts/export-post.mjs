// Export a post for republishing elsewhere.
//
//   pnpm export list                 posts and their slugs
//   pnpm export forum <slug>         forum Markdown (absolute image URLs) → clipboard
//   pnpm export x <slug>             X article rich text → clipboard, images → ~/Downloads/x-export/<slug>/
//
// Add --print to write to stdout instead of the clipboard.
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import siteMetadata from '../data/siteMetadata.ts'
import { findPost, postUrl, readPosts, toForumMarkdown, toXArticle } from './lib/post-export.mjs'

const [command, query] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const print = process.argv.includes('--print')
const siteUrl = siteMetadata.siteUrl.replace(/\/$/, '')
const posts = await readPosts()

/**
 * Puts text on the Wayland or X11 clipboard; returns false when neither tool exists.
 * @param {string} value
 */
function copy(value, type = 'text/plain') {
  /** @type {[string, string[]][]} */
  const tools = [
    ['wl-copy', ['--type', type]],
    ['xclip', ['-selection', 'clipboard', '-t', type]],
  ]
  for (const [tool, args] of tools) {
    // wl-copy and xclip stay behind to serve the clipboard; with inherited
    // output pipes, spawnSync would wait for them forever.
    const result = spawnSync(tool, args, {
      input: value,
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 5000,
    })
    if (!result.error && result.status === 0) return true
  }
  return false
}

function requirePost() {
  const post = query && findPost(posts, query)
  if (!post) {
    console.error(
      query ? `没有找到文章：${query}` : '请提供文章 slug，可用 `pnpm export list` 查看'
    )
    process.exit(1)
  }
  return post
}

if (command === 'list') {
  for (const post of posts) console.log(`${post.slug.padEnd(28)} ${post.title}`)
} else if (command === 'forum') {
  const post = requirePost()
  const markdown = toForumMarkdown(siteUrl, post)
  if (print || !copy(markdown)) process.stdout.write(markdown)
  else console.log(`已复制论坛 Markdown：${post.title}（${markdown.length} 字符）`)
} else if (command === 'x') {
  const post = requirePost()
  const article = await toXArticle(siteUrl, post)
  if (print) {
    process.stdout.write(article.html + '\n')
    process.exit(0)
  }
  const folder = path.join(os.homedir(), 'Downloads', 'x-export', post.slug)
  await mkdir(folder, { recursive: true })
  for (const image of article.images) {
    const name = `${String(image.number).padStart(2, '0')}-${path.basename(new URL(image.url).pathname)}`
    // A post can be exported before it is published: prefer the local file.
    const local = path.join('public', decodeURIComponent(new URL(image.url).pathname))
    if (image.url.startsWith(siteUrl) && existsSync(local))
      await copyFile(local, path.join(folder, name))
    else
      await writeFile(
        path.join(folder, name),
        Buffer.from(await (await fetch(image.url)).arrayBuffer())
      )
  }
  await writeFile(path.join(folder, 'article.html'), article.html)
  const copied = copy(article.html, 'text/html')
  console.log(`标题：${article.title}`)
  console.log(
    copied
      ? '正文已作为富文本复制，到 X 文章编辑器正文处直接粘贴。'
      : `未找到剪贴板工具，正文见 ${path.join(folder, 'article.html')}`
  )
  console.log(`图片 ${article.images.length} 张已保存到 ${folder}`)
  console.log('  00 是封面；其余按正文里的【图 NN】标记依次插入。')
  console.log(`原文：${postUrl(siteUrl, post)}`)
} else {
  console.error('用法：pnpm export <list | forum <slug> | x <slug>> [--print]')
  process.exit(1)
}
