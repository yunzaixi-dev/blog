import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeMathjaxSvg from 'rehype-mathjax/svg'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePresetMinify from 'rehype-preset-minify'
import rehypePrettyCode from 'rehype-pretty-code'
import { remarkEChartsBlocks } from './remark/echartsBlocks'
import { remarkGitHubEmbeds } from './remark/githubEmbeds'
import { remarkIconShortcodes } from './remark/iconShortcodes'
import { remarkTradingViewWidgets } from './remark/tradingViewWidgets'
import { rehypeCodeLineMetadata } from './rehype/codeLineMetadata'
import { rehypeCodeSourceMetadata } from './rehype/codeSourceMetadata'
import { rehypePrettyCodeOptions } from './rehype/prettyCode'
import { autolinkIcon } from './svgs'

export const mdxOptions = {
  remarkPlugins: [
    remarkGfm,
    [remarkMath, { singleDollarTextMath: true }],
    remarkTradingViewWidgets,
    remarkEChartsBlocks,
    remarkIconShortcodes,
    remarkGitHubEmbeds,
  ],
  rehypePlugins: [
    rehypeSlug,
    [
      rehypeAutolinkHeadings,
      {
        behavior: 'prepend',
        headingProperties: {
          className: ['content-header'],
        },
        content: autolinkIcon,
      },
    ],
    rehypeMathjaxSvg,
    rehypeCodeSourceMetadata,
    [rehypePrettyCode, rehypePrettyCodeOptions],
    rehypeCodeLineMetadata,
    rehypePresetMinify,
  ],
} satisfies {
  remarkPlugins: import('unified').PluggableList
  rehypePlugins: import('unified').PluggableList
}
