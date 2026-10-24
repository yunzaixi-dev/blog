import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../../server/frontmatter'

describe('YAML-only frontmatter', () => {
  it('normalizes BOM and CRLF before safe YAML parsing', () => {
    expect(parseFrontmatter('\uFEFF---\r\ntitle: Safe\r\ndraft: true\r\n---\r\nBody')).toEqual({
      data: { title: 'Safe', draft: true },
      content: 'Body',
    })
  })
  for (const prefix of ['', '\uFEFF'])
    for (const newline of ['\n', '\r\n']) {
      it(`rejects language declarations before engine dispatch (${JSON.stringify(prefix + newline)})`, () => {
        for (const language of ['javascript', 'js', 'json', 'yaml'])
          expect(() =>
            parseFrontmatter(
              `${prefix}---${language}${newline}title: Safe${newline}---${newline}Body`
            )
          ).toThrow('Only YAML')
      })
    }
  it('rejects invalid YAML and non-mapping metadata', () => {
    expect(() => parseFrontmatter('---\ntitle: [broken\n---\nBody')).toThrow()
    expect(() => parseFrontmatter('---\n- one\n---\nBody')).toThrow('mapping')
  })
})
