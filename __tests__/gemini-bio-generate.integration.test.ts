// Gemini紹介文生成の結合テスト。実際のAPI呼び出しを行う(モックしない、
// このプロジェクトの既存結合テストと同じ方針)。GEMINI_API_KEYが未設定の
// 環境ではskipする。
//
// 実行: npm test
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { generateArtistBioWithGemini } from '../utils/geminiBioGenerate.ts'

describe('generateArtistBioWithGemini', () => {
  test('generates a bio from a source text with real biographical content', async (t) => {
    if (!process.env.GEMINI_API_KEY) {
      return t.skip('GEMINI_API_KEY not set')
    }
    const facts = {
      artistName: 'テスト太郎',
      genreNames: ['J-Pop'],
      formedYear: 2020,
      originPrefecture: '東京都',
      hometownCity: null,
    }
    const sourceText =
      'テスト太郎は2020年に東京でデビューしたシンガーソングライター。弾き語りのライブ配信で人気を集め、2022年に1stアルバム『始まりの歌』をリリースした。'
    const result = await generateArtistBioWithGemini(facts, sourceText, 'article_context')
    assert.equal(result.status, 'generated')
    if (result.status === 'generated') {
      assert.ok(result.bio.length >= 50, `expected a non-trivial bio, got: ${result.bio}`)
    }
  })

  test('declines when the source text has no real biographical content', async (t) => {
    if (!process.env.GEMINI_API_KEY) {
      return t.skip('GEMINI_API_KEY not set')
    }
    const facts = { artistName: '謎のアーティストXYZ', genreNames: [], formedYear: null, originPrefecture: null, hometownCity: null }
    const result = await generateArtistBioWithGemini(facts, '謎のアーティストXYZ', 'wikidata')
    assert.equal(result.status, 'declined')
  })
})
