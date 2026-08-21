// __tests__/wikipedia-genre.integration.test.ts
//
// Wikipedia REST APIを実際に叩き、レスポンスの解析結果が想定通りであることを確認する。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { searchWikipediaGenre } from '../utils/wikipediaGenre.ts'

describe('searchWikipediaGenre', () => {
  test('finds Techno on English Wikipedia with a Detroit origin', async () => {
    const info = await searchWikipediaGenre('Techno')
    assert.ok(info, 'expected a result')
    assert.equal(info!.originYear, 1980)
    assert.ok(info!.originPlace?.includes('Detroit'), `expected originPlace to include Detroit, got: ${info!.originPlace}`)
    assert.ok(info!.subgenres.length > 0)
  })

  test('finds シティ・ポップ on Japanese Wikipedia (via redirect from シティーポップ) with a 1970s/Japan origin', async () => {
    const info = await searchWikipediaGenre('シティーポップ')
    assert.ok(info, 'expected a result')
    assert.equal(info!.originYear, 1970)
    assert.equal(info!.originPlace, '日本')
    assert.ok(info!.sourceUrl.includes('wikipedia.org'))
  })

  test('returns null for a nonexistent genre name', async () => {
    const info = await searchWikipediaGenre('zzzznonexistentgenrexyz123')
    assert.equal(info, null)
  })
})
