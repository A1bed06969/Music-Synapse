// __tests__/wikipedia-article.unit.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { stripWikitextMarkup } from '../utils/wikipediaArticle.ts'

describe('stripWikitextMarkup', () => {
  test('resolves bare wikilinks to their target text', () => {
    const input = '[[藤井風]]は[[岡山県]][[里庄町]]出身の[[シンガーソングライター]]。'
    assert.equal(stripWikitextMarkup(input), '藤井風は岡山県里庄町出身のシンガーソングライター。')
  })

  test('resolves piped links using the display half', () => {
    const input = '[[Wikipedia:表記ガイド|表記ガイド]]に従う。'
    assert.equal(stripWikitextMarkup(input), '表記ガイドに従う。')
  })

  test('removes bold and italic markup', () => {
    const input = "これは'''重要'''で、こちらは''強調''です。"
    assert.equal(stripWikitextMarkup(input), 'これは重要で、こちらは強調です。')
  })

  test('removes ref tags including their content', () => {
    const input = '2020年にデビュー<ref>出典情報</ref>した。'
    assert.equal(stripWikitextMarkup(input), '2020年にデビューした。')
  })

  test('removes self-closing ref tags', () => {
    const input = '2020年にデビュー<ref name="foo" />した。'
    assert.equal(stripWikitextMarkup(input), '2020年にデビューした。')
  })

  test('removes simple non-nested templates', () => {
    const input = '{{lang|en|Kaze Fujii}}は日本のアーティスト。'
    assert.equal(stripWikitextMarkup(input), 'は日本のアーティスト。')
  })

  test('collapses multiple blank lines into one', () => {
    const input = '一行目。\n\n\n二行目。'
    assert.equal(stripWikitextMarkup(input), '一行目。\n二行目。')
  })

  test('removes a nested infobox entirely, leaving only the trailing prose', () => {
    const input =
      '{{Infobox musician\n| name = Test\n| genre = {{hlist|Pop|Rock}}\n}}\nActual prose about the artist here.'
    const result = stripWikitextMarkup(input)
    assert.equal(result, 'Actual prose about the artist here.')
    assert.ok(!result.includes('{{'), 'should not contain leftover template open braces')
    assert.ok(!result.includes('}}'), 'should not contain leftover template close braces')
    assert.ok(!result.includes('|'), 'should not contain leftover field separators')
  })
})
