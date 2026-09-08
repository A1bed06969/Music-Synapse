// __tests__/wikidata-sitelink.integration.test.ts
//
// 実際にWikidata APIを叩く結合テスト(モックしない、既存の結合テストと同じ方針)。
//
// 実行: npm test
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWikipediaSitelink } from '../utils/wikidata.ts'

describe('fetchWikipediaSitelink', () => {
  test('resolves the Japanese Wikipedia title for 藤井風 (Q84803821)', async () => {
    const result = await fetchWikipediaSitelink('Q84803821')
    assert.ok(result)
    assert.equal(result!.lang, 'ja')
    assert.equal(result!.title, '藤井風')
  })

  test('returns null for a malformed QID', async () => {
    const result = await fetchWikipediaSitelink('not-a-qid')
    assert.equal(result, null)
  })
})
