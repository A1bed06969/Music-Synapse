// __tests__/gemini-radio-pick-extract.integration.test.ts
//
// Gemini構造化抽出の結合テスト。実際のAPI呼び出しを行う(モックしない、
// このプロジェクトの既存結合テストと同じ方針)。GEMINI_API_KEYが未設定の
// 環境ではskipする。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { extractRadioPicksFromUrl } from '../utils/geminiRadioPickExtract.ts'

describe('extractRadioPicksFromUrl', () => {
  test('extracts at least one pick from FM福井 Heavy Rotation (known-working pilot page)', async (t) => {
    if (!process.env.GEMINI_API_KEY) {
      return t.skip('GEMINI_API_KEY not set')
    }

    const picks = await extractRadioPicksFromUrl('FM福井', 'https://www.fmfukui.jp/heavyrotation/')
    assert.ok(picks.length > 0, 'expected at least one extracted pick')
    for (const pick of picks) {
      assert.ok(pick.artistName.length > 0)
      assert.ok(pick.trackTitle.length > 0)
    }
  })
})
