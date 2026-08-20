// __tests__/disc-guide-import.unit.test.ts
//
// ディスクガイドDBファジーマッチのユニットテスト。DB接続が必要。
//
// 実行: npm test   (内部で `node --env-file-if-exists=.env.local --test __tests__/`)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { matchAlbumsWithCandidates } from '../utils/discGuideImport.ts'
import { createAdminClient } from '../utils/Supabase/admin.ts'

// matchAlbumsWithCandidates はDB(search_albums_fuzzy RPC)を叩くため、
// dev serverは不要だがSupabase接続が必要。Phase 1レポートで実測した
// 「ilikeの完全部分一致だと0件になる」3パターンが、pg_trgmファジー検索に
// 切り替えたことで候補に出てくることを確認する。
describe('matchAlbumsWithCandidates (live DB, pg_trgm fuzzy search)', () => {
  test('surfaces "The Vertigo of Bliss" despite an injected space and a wrong character', async () => {
    const supabase = createAdminClient()
    const { data: existing } = await supabase
      .from('album')
      .select('id')
      .eq('title', 'The Vertigo of Bliss')
      .limit(1)
      .maybeSingle()
    if (!existing) {
      console.warn('[unit] "The Vertigo of Bliss" not found in DB; skipping fuzzy-match assertions')
      return
    }

    const cases = [
      { title: 'The Vertigo of Bliss (2003)', artist_name: 'Biffy Clyro' }, // 年号除去前と同じ入力
      { title: 'The Vertigo of Bl iss', artist_name: 'Biffy Clyro' }, // 空白混入
      { title: 'The Vertigo of Blise', artist_name: 'Biffy Clyro' }, // 1文字誤読
    ]

    const results = await matchAlbumsWithCandidates(supabase, cases)
    for (const [i, r] of results.entries()) {
      assert.ok(
        r.candidates.some((c) => c.title === 'The Vertigo of Bliss'),
        `case ${i} (${JSON.stringify(cases[i])}) should surface "The Vertigo of Bliss" as a candidate, got: ${JSON.stringify(r.candidates)}`
      )
    }
  })

  test('reports a similarity score that separates confident matches from spurious ones', async () => {
    const supabase = createAdminClient()
    const { data: existing } = await supabase
      .from('album')
      .select('id')
      .eq('title', 'The Vertigo of Bliss')
      .limit(1)
      .maybeSingle()
    if (!existing) {
      console.warn('[unit] "The Vertigo of Bliss" not found in DB; skipping similarity assertions')
      return
    }

    // 確度の高いマッチ(表記ゆれ込み): Phase 2実データ検証で確認済みのしきい値
    // 0.5を安全に上回るはず(実測: 0.79〜1.0)。
    const [strong] = await matchAlbumsWithCandidates(supabase, [
      { title: 'The Vertigo of Bl iss', artist_name: 'Biffy Clyro' },
    ])
    const strongTop = strong.candidates.find((c) => c.title === 'The Vertigo of Bliss')
    assert.ok(strongTop, 'expected "The Vertigo of Bliss" among candidates')
    assert.ok(
      (strongTop!.similarity ?? 0) >= 0.5,
      `expected similarity >= 0.5 for a near-exact match, got ${strongTop!.similarity}`
    )

    // 実在しない90年代マイナー作品(Phase 2で実際に0.15〜0.17を記録したケース):
    // 候補が返ってきても、確度は0.5を大きく下回るはず。
    const [weak] = await matchAlbumsWithCandidates(supabase, [
      { title: 'Hoping For The Sun', artist_name: 'DJ Takemura & Kool Jazz Productions' },
    ])
    if (weak.candidates.length > 0) {
      assert.ok(
        (weak.candidates[0].similarity ?? 1) < 0.5,
        `expected similarity < 0.5 for an unrelated album, got ${weak.candidates[0].similarity}`
      )
    }
  })
})
