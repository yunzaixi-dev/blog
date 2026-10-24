import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMdx from 'remark-mdx'
import remarkRehype from 'remark-rehype'
import { mdxOptions } from '../content-pipeline/source'

export type DocumentNode = {
  tag: string
  props: Record<string, unknown>
  children: (DocumentNode | string)[]
}
type Tree = {
  type: string
  value?: unknown
  tagName?: string
  name?: string
  properties?: Record<string, unknown>
  attributes?: Tree[]
  children?: Tree[]
  data?: { estree?: Tree }
  expression?: Tree
  body?: Tree[]
  elements?: Tree[]
  propertiesList?: Tree[]
  key?: Tree
  argument?: Tree
  operator?: string
  computed?: boolean
  kind?: string
  method?: boolean
  shorthand?: boolean
  [key: string]: unknown
}
const widgets = new Set([
  'Icon',
  'Image',
  'ECharts',
  'StrategyCard',
  'TradingViewAdvancedChart',
  'TradingViewMiniChart',
])
const html = new Set(
  'a abbr b blockquote br caption code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input kbd li mark ol p picture pre s section small source span strong sub summary sup table tbody td th thead tr ul video audio track svg g path defs use rect line polyline polygon circle ellipse text title desc symbol clipPath foreignObject mjx-container mjx-assistive-mml math semantics mrow mi mo mn msup msub mfrac annotation'.split(
    ' '
  )
)
const dangerous = /^(?:on|__proto__$|prototype$|constructor$|dangerouslySetInnerHTML$|srcDoc$)/i

function literal(node: Tree | null | undefined): unknown {
  if (!node) throw new Error('Missing static expression')
  if (
    node.type === 'Literal' &&
    (node.value === null || ['string', 'number', 'boolean'].includes(typeof node.value))
  )
    return node.value
  if (
    node.type === 'UnaryExpression' &&
    node.operator === '-' &&
    typeof node.argument?.value === 'number'
  )
    return -node.argument.value
  if (node.type === 'ArrayExpression') return (node.elements || []).map(literal)
  if (node.type === 'ObjectExpression') {
    const value: Record<string, unknown> = {}
    for (const property of node.properties as unknown as Tree[]) {
      if (
        property.type !== 'Property' ||
        property.computed ||
        property.method ||
        property.shorthand ||
        property.kind !== 'init'
      )
        throw new Error('Only static object properties are allowed')
      const key = String(property.key?.name || property.key?.value || '')
      if (!key || dangerous.test(key)) throw new Error('Unsafe object key')
      value[key] = literal(property.value as Tree)
    }
    return value
  }
  throw new Error(`Executable MDX is not allowed: ${node.type}`)
}

function expression(node: Tree) {
  const body = node.data?.estree?.body
  if (body?.length !== 1 || body[0].type !== 'ExpressionStatement')
    throw new Error('Only static MDX expressions are allowed')
  return literal(body[0].expression)
}

function checkProps(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    if (dangerous.test(key)) throw new Error(`Unsafe attribute ${key}`)
    if (['href', 'src', 'xlinkHref', 'xLinkHref', 'poster', 'sourceUrl'].includes(key)) {
      if (
        typeof value !== 'string' ||
        !/^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#|[^:/\s]+(?:\/|$))/i.test(value) ||
        (/^[\s]*[a-z]+:/i.test(value) && !/^(https?:|mailto:|tel:)/i.test(value))
      )
        throw new Error(`Unsafe URL in ${key}`)
    }
    if (key === 'style' && typeof value !== 'object') throw new Error('Style must be static object')
    if (
      key === 'style' &&
      value &&
      Object.entries(value).some(
        ([name, item]) =>
          dangerous.test(name) ||
          (typeof item === 'string' && /url\s*\(|expression\s*\(/i.test(item))
      )
    )
      throw new Error('Unsafe style value')
  }
}

function validateMdx() {
  return (tree: Tree) => {
    const visit = (node: Tree) => {
      if (node.type === 'mdxjsEsm') throw new Error('MDX imports and exports are not allowed')
      if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression')
        throw new Error('Body expressions are not allowed')
      if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        if (!node.name || (!widgets.has(node.name) && !html.has(node.name)))
          throw new Error(`Unknown component ${node.name}`)
        const props: Record<string, unknown> = {}
        for (const attr of node.attributes || []) {
          if (attr.type !== 'mdxJsxAttribute' || !attr.name)
            throw new Error('Spread attributes are not allowed')
          props[attr.name] =
            attr.value === null
              ? true
              : typeof attr.value === 'object'
                ? expression(attr.value as Tree)
                : attr.value
        }
        checkProps(props)
        node.data = { ...node.data, hName: node.name, hProperties: props } as Tree['data']
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

export async function parseDocument(source: string): Promise<DocumentNode[]> {
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(mdxOptions.remarkPlugins)
    .use(validateMdx)
    .use(remarkRehype, {
      handlers: {
        mdxJsxFlowElement(state, node) {
          return state.applyData(node, {
            type: 'element',
            tagName: node.name || 'div',
            properties: {},
            children: state.all(node),
          })
        },
        mdxJsxTextElement(state, node) {
          return state.applyData(node, {
            type: 'element',
            tagName: node.name || 'span',
            properties: {},
            children: state.all(node),
          })
        },
      },
    })
    .use(mdxOptions.rehypePlugins)
  const tree = await pipeline.run(pipeline.parse(source))
  const convert = (node: Tree): DocumentNode | string => {
    if (node.type === 'text') return String(node.value || '')
    if (
      node.type !== 'element' ||
      !node.tagName ||
      (!html.has(node.tagName) && !widgets.has(node.tagName) && node.tagName !== 'style')
    )
      throw new Error(`Unsupported document node ${node.tagName || node.type}`)
    const props = node.properties || {}
    if (typeof props.style === 'string') {
      const style: Record<string, string> = {}
      for (const part of props.style.split(';')) {
        const colon = part.indexOf(':')
        if (colon < 0) continue
        const key = part.slice(0, colon).trim(),
          value = part.slice(colon + 1).trim()
        if (/url\s*\(|expression\s*\(/i.test(value)) throw new Error('Unsafe generated style')
        style[
          key.startsWith('--')
            ? key
            : key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
        ] = value
      }
      props.style = style
    }
    checkProps(props)
    return {
      tag: node.tagName,
      props,
      children: (node.children || []).filter((child) => child.type !== 'comment').map(convert),
    }
  }
  return tree.children
    .filter((child) => child.type !== 'comment')
    .map((node) => convert(node as Tree)) as DocumentNode[]
}
