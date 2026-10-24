import { describe, expect, it } from 'vitest'
import { parseDocument } from '../../server/document'

describe('runtime document compiler', () => {
  it('keeps repository GitHub code embeds without permitting filesystem escape', async () => {
    const tree = await parseDocument(
      '::github-code ref=worktree path=package.json lang=json lines=1-3'
    )
    expect(JSON.stringify(tree)).toContain('zaixi-blog')
    await expect(parseDocument('::github-code ref=worktree path=../../.env')).rejects.toThrow(
      'Invalid GitHub path'
    )
  })
  it('preserves rich content as inert registry nodes', async () => {
    const tree = await parseDocument(
      '## Heading\n\n$e=mc^2$\n\n```ts\nconst x = 1\n```\n\n<StrategyCard data={{BTC:{winCount:2,profitFactor:-1}}} />\n\n<Icon name="Sparkles" />\n\n```echarts\n{"xAxis":{"data":["A"]},"yAxis":{},"series":[{"type":"bar","data":[1]}]}\n```\n\n$NASDAQ:AAPL\n'
    )
    const json = JSON.stringify(tree)
    for (const value of [
      'Heading',
      'svg',
      'data-language',
      'StrategyCard',
      'winCount',
      'Sparkles',
      'ECharts',
      'TradingViewMiniChart',
    ])
      expect(json).toContain(value)
  })
  for (const source of [
    'import x from "fs"\n\n# A',
    'export const x=1',
    '{alert(1)}',
    '<StrategyCard data={fetch("/evil")} />',
    '<div {...props} />',
    '<img src="javascript:alert(1)" />',
    '<div onClick="alert(1)" />',
    '<div dangerouslySetInnerHTML={{__html:"bad"}} />',
    '<Unknown />',
    '<StrategyCard data={{__proto__:{a:1}}} />',
  ]) {
    it(`rejects executable or unsafe content: ${source}`, async () => {
      await expect(parseDocument(source)).rejects.toThrow()
    })
  }
})
