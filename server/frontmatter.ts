import { createRequire } from 'node:module'

// Call only gray-matter's safe YAML parser, never its language dispatcher.
const require = createRequire(import.meta.url)
const { yaml } = require('gray-matter/lib/engines.js') as {
  yaml: { parse(source: string): unknown }
}

export function parseFrontmatter(source: string) {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  if (!lines[0].startsWith('---')) return { data: {} as Record<string, unknown>, content: text }
  if (lines[0] !== '---')
    throw new Error('Only YAML frontmatter without a language declaration is allowed')
  const end = lines.indexOf('---', 1)
  if (end < 0) throw new Error('Unclosed YAML frontmatter')
  const value = yaml.parse(lines.slice(1, end).join('\n'))
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value)))
    throw new Error('YAML frontmatter must be a mapping')
  return {
    data: (value || {}) as Record<string, unknown>,
    content: lines.slice(end + 1).join('\n'),
  }
}
