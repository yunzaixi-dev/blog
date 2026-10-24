import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/** @type {Record<string,{file:string,isEntry?:boolean,imports?:string[],dynamicImports?:string[]}>} */
const manifest = JSON.parse(await readFile('out/.vite/manifest.json', 'utf8'))
const initial = new Set()
/** @param {string} key */
function walk(key) {
  if (initial.has(key)) return
  initial.add(key)
  for (const imported of manifest[key]?.imports || []) walk(imported)
}
for (const [key, value] of Object.entries(manifest)) if (value.isEntry) walk(key)
assert.ok(
  ![...initial].some((key) => /echarts/i.test(key)),
  'ECharts must not be an initial dependency'
)
assert.ok(
  Object.keys(manifest).some((key) => /echartsCore/.test(key)),
  'ECharts async module must be delivered'
)
const html = await readFile('out/index.html', 'utf8')
assert.ok(!html.includes('data-article-body'), 'Article bodies must not be built into HTML')
for (const [key, entry] of Object.entries(manifest)) {
  assert.ok(
    !/(content\/blog|server\/|content-pipeline\/)/.test(key),
    'Runtime content/compiler must not enter browser graph'
  )
  const code = await readFile(`out/${entry.file}`, 'utf8')
  assert.ok(
    !/function MDXContent|bodyCode|@mdx-js\/mdx/.test(code),
    'Executable MDX must not be delivered'
  )
}
console.log('Client graph verified: API-only bodies, no content compiler, ECharts async-only')
