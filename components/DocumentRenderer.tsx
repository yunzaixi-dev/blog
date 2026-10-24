import { createElement, type ComponentType } from 'react'
import { components } from './MDXComponents'
import type { DocumentNode } from '../server/document'

const names: Record<string, string> = {
  ariaHidden: 'aria-hidden',
  ariaLabel: 'aria-label',
  ariaLabelledBy: 'aria-labelledby',
  ariaDescribedBy: 'aria-describedby',
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  'xlink:href': 'xlinkHref',
}
export default function DocumentRenderer({ nodes }: { nodes: (DocumentNode | string)[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (typeof node === 'string') return node
        const props: Record<string, unknown> = { key: index }
        for (const [key, value] of Object.entries(node.props))
          props[names[key] || key] =
            Array.isArray(value) && key === 'className' ? value.join(' ') : value
        const Component = components[node.tag] as ComponentType<Record<string, unknown>> | undefined
        return createElement(
          Component || node.tag,
          props,
          node.children.length ? <DocumentRenderer nodes={node.children} /> : undefined
        )
      })}
    </>
  )
}
