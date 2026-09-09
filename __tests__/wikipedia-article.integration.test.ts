// __tests__/wikipedia-article.integration.test.ts
//
// 実際にWikipedia APIを叩く結合テスト(モックしない、既存の結合テストと同じ方針)。
//
// 実行: npm test
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWikipediaLeadText } from '../utils/wikipediaArticle.ts'

describe('fetchWikipediaLeadText', () => {
  test('fetches a plain-text lead section for a known Japanese article (藤井風)', async () => {
    const text = await fetchWikipediaLeadText('ja', '藤井風')
    assert.ok(text, 'expected lead text')
    assert.ok(!text!.includes('[['), 'should not contain leftover wikilink brackets')
    assert.ok(!text!.includes('{{'), 'should not contain leftover template braces (e.g. from the infobox)')
    assert.ok(text!.length > 30)
  })

  test('returns null for a nonexistent article', async () => {
    const text = await fetchWikipediaLeadText('ja', 'zzzznonexistentarticlexyz123')
    assert.equal(text, null)
  })
})
