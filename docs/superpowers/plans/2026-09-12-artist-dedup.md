# 重複アーティストレコード統合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スガ シカオ・坂本冬美・ワン・ダイレクションの3組(カタログ丸ごと複製)と、空スタブ49組(トラック0件だが副次データが分散)の重複アーティストレコードを、データを失わずに1つの`artist_id`へ安全に統合する。

**Architecture:** 純粋なロジック(本体選定・アルバム/トラックのタイトル一致判定)は`utils/`に切り出してユニットテストする。DBへの読み書きは`scripts/dedupe-artists.ts`が担い、`--dry-run`(既定、書き込みなし)で内容を確認してから`--execute`で実際の移設・削除を行う。外部キーの付け替えは、実データベースから機械的に洗い出した参照元テーブル一覧(このplan内に列挙済み)に対して汎用の再ポイント処理を適用する。

**Tech Stack:** TypeScript(`tsx`実行)、Supabase JS Client(admin/service role)、`node:test`によるユニットテスト。

**Spec:** `docs/superpowers/specs/2026-09-12-artist-dedup-design.md`

## Global Constraints

- 対象は「深刻な3組」(スガ シカオ・坂本冬美・ワン・ダイレクション)と「空スタブ49組」のみ。ユニーク率0.2以上の中間的な重複(23組)や"Various Artists"のような編集盤クレジット名は対象外(スペック「非ゴール」参照)。
- アルバム・トラックの対応付けはタイトル完全一致のみ。表記ゆれを許容するあいまい一致は行わない。
- 対応付けできないデータは削除せず、本体の`artist_id`へ再割り当てして残す(推測でマージしない)。
- 実行は必ず`--dry-run`(既定)でレポートを確認してから`--execute`で行う。
- 1グループの処理失敗が他グループに影響しないようにする(グループ単位でtry/catch)。
- 外部キー付け替えの対象テーブル一覧は、2026-09-12に本番Supabaseの`information_schema`を直接クエリして確定したものを使う(下記「参照元テーブル一覧」)。

## 参照元テーブル一覧(2026-09-12、`information_schema`で確認済み)

### `artist.id`を参照するテーブル(本体・重複どちらの統合でも使う)

```
album.artist_id
album_artist.artist_id
artist_credit.artist_id
artist_external_link.artist_id   -- 特別処理: (link_type, url)重複は移設せず削除
artist_genre.artist_id            -- 特別処理: genre_id重複は移設せず削除
artist_label.artist_id
artist_match_log.stub_artist_id
artist_relation.artist_id_a       -- 特別処理: 付け替え後に自己参照になる行は削除
artist_relation.artist_id_b       -- 同上
award_entry.artist_id
bio_generation_log.artist_id
contest_entry.artist_id
event_appearance.artist_id
event_appearance_artist.artist_id
festival_pilot_artist_link.artist_id
genre_highlight.artist_id
music_event.artist_id
person_artist_relation.artist_id
radio_rotation.artist_id
ranking_entry.artist_id
setlist.artist_id
track.artist_id                   -- 深刻な3組では専用のマッチング処理(Task 2)で扱うため、
                                   -- 汎用リストからは除外する(下記Task 5参照)
track_artist.artist_id
youtube_mv_backfill_log.artist_id
```

### `album.id`を参照するテーブル(深刻な3組で、マッチ済みアルバムを削除する前に使う)

```
album.primary_album_id
album_artist.album_id
album_artwork.album_id
album_credit.album_id
album_genre.album_id
album_match_log.stub_album_id
album_pickup.album_id
artist_credit.album_id
award_entry.album_id
collection_entry.album_id
contest_entry.album_id
disc_guide_selection.album_id
genre_highlight.album_id
radio_rotation.album_id
ranking_entry.album_id
track.album_id                    -- マッチ済みアルバムは中のトラックが全て
                                   -- 処理済みのはずなので通常は0件になる
```

### `track.id`を参照するテーブル(深刻な3組で、マッチ済みトラックを削除する前に使う)

```
album.representative_track_id
artist_credit.track_id
award_entry.track_id
collection_entry.track_id
contest_entry.track_id
playlist_track.track_id
radio_rotation.track_id
ranking_entry.track_id
setlist_track.track_id
sync_entry.track_id
track_artist.track_id
track_credit.track_id
track_genre.track_id
track_instrument.track_id
```

---

### Task 1: 本体(canonical)選定ロジック

**Files:**
- Create: `utils/artistDedupCanonical.ts`
- Test: `__tests__/artist-dedup-canonical.unit.test.ts`

**Interfaces:**
- Produces: `export type ArtistCandidate = { id: string; trackCount: number; albumCount: number; externalLinkCount: number; genreCount: number; relationCount: number; mvBackfillLogCount: number; hasBio: boolean; hasImage: boolean }`, `export function secondaryDataScore(c: ArtistCandidate): number`, `export function pickCanonical(candidates: ArtistCandidate[]): ArtistCandidate`(空配列を渡すとErrorを投げる)。Task 4で使う。

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/artist-dedup-canonical.unit.test.ts
//
// 重複アーティストの中から「本体」として残す1行を選ぶ純粋関数のテスト。
// 優先順位: track数 > album数 > 副次データスコア > id文字列比較。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { secondaryDataScore, pickCanonical, type ArtistCandidate } from '../utils/artistDedupCanonical.ts'

function candidate(overrides: Partial<ArtistCandidate> & { id: string }): ArtistCandidate {
  return {
    trackCount: 0,
    albumCount: 0,
    externalLinkCount: 0,
    genreCount: 0,
    relationCount: 0,
    mvBackfillLogCount: 0,
    hasBio: false,
    hasImage: false,
    ...overrides,
  }
}

describe('secondaryDataScore', () => {
  test('sums all secondary data fields, counting hasBio/hasImage as 1 each', () => {
    const score = secondaryDataScore(
      candidate({ id: 'a', externalLinkCount: 3, genreCount: 2, relationCount: 1, mvBackfillLogCount: 4, hasBio: true, hasImage: true })
    )
    assert.equal(score, 3 + 2 + 1 + 4 + 1 + 1)
  })

  test('is 0 for a candidate with no secondary data at all', () => {
    assert.equal(secondaryDataScore(candidate({ id: 'a' })), 0)
  })
})

describe('pickCanonical', () => {
  test('picks the candidate with the most tracks when counts differ', () => {
    const result = pickCanonical([
      candidate({ id: 'a', trackCount: 100 }),
      candidate({ id: 'b', trackCount: 477 }),
      candidate({ id: 'c', trackCount: 300 }),
    ])
    assert.equal(result.id, 'b')
  })

  test('falls back to album count when track counts tie', () => {
    const result = pickCanonical([
      candidate({ id: 'a', trackCount: 477, albumCount: 60 }),
      candidate({ id: 'b', trackCount: 477, albumCount: 67 }),
    ])
    assert.equal(result.id, 'b')
  })

  test('falls back to secondary data score when track and album counts both tie', () => {
    const result = pickCanonical([
      candidate({ id: 'a', trackCount: 477, albumCount: 67, externalLinkCount: 0 }),
      candidate({ id: 'b', trackCount: 477, albumCount: 67, externalLinkCount: 7 }),
    ])
    assert.equal(result.id, 'b')
  })

  test('falls back to the lexicographically smallest id as the final tie-break', () => {
    const result = pickCanonical([
      candidate({ id: 'MS_ART_zzz', trackCount: 477, albumCount: 67 }),
      candidate({ id: 'MS_ART_aaa', trackCount: 477, albumCount: 67 }),
    ])
    assert.equal(result.id, 'MS_ART_aaa')
  })

  test('reproduces the real スガシカオ case: 330-track candidate with 7 links loses to a tied 477-track candidate', () => {
    const result = pickCanonical([
      candidate({ id: 'rich-but-smaller', trackCount: 330, albumCount: 35, externalLinkCount: 7 }),
      candidate({ id: 'largest-a', trackCount: 477, albumCount: 67 }),
      candidate({ id: 'largest-b', trackCount: 477, albumCount: 67 }),
    ])
    assert.equal(result.id, 'largest-a')
  })

  test('throws on an empty candidate list', () => {
    assert.throws(() => pickCanonical([]))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --env-file-if-exists=.env.local --test __tests__/artist-dedup-canonical.unit.test.ts`
Expected: FAIL — `Cannot find module '../utils/artistDedupCanonical.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// utils/artistDedupCanonical.ts
//
// 重複アーティストの中から「本体」として残す1行を選ぶ純粋関数。優先順位は
// (1)track数 (2)album数 (3)副次データスコア (4)id文字列比較の順(決定的にする
// ための最終手段)。docs/superpowers/specs/2026-09-12-artist-dedup-design.md
// 「1. 本体(canonical)行の選定」参照。

export type ArtistCandidate = {
  id: string
  trackCount: number
  albumCount: number
  externalLinkCount: number
  genreCount: number
  relationCount: number
  mvBackfillLogCount: number
  hasBio: boolean
  hasImage: boolean
}

/** 外部リンク・ジャンル・関係性・MVログの件数に、bio/image_urlの有無を1件分
 * 加算した「副次データの豊富さ」スコア。track/album数が同数のときの
 * タイブレークに使う。 */
export function secondaryDataScore(c: ArtistCandidate): number {
  return (
    c.externalLinkCount +
    c.genreCount +
    c.relationCount +
    c.mvBackfillLogCount +
    (c.hasBio ? 1 : 0) +
    (c.hasImage ? 1 : 0)
  )
}

export function pickCanonical(candidates: ArtistCandidate[]): ArtistCandidate {
  if (candidates.length === 0) {
    throw new Error('pickCanonical: candidates は1件以上必要です')
  }
  return [...candidates].sort((a, b) => {
    if (b.trackCount !== a.trackCount) return b.trackCount - a.trackCount
    if (b.albumCount !== a.albumCount) return b.albumCount - a.albumCount
    const scoreDiff = secondaryDataScore(b) - secondaryDataScore(a)
    if (scoreDiff !== 0) return scoreDiff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })[0]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --env-file-if-exists=.env.local --test __tests__/artist-dedup-canonical.unit.test.ts`
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add utils/artistDedupCanonical.ts __tests__/artist-dedup-canonical.unit.test.ts
git commit -m "feat: add canonical-artist selection logic for dedup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: アルバム・トラックのタイトル一致マッチングロジック

**Files:**
- Create: `utils/artistDedupMatching.ts`
- Test: `__tests__/artist-dedup-matching.unit.test.ts`

**Interfaces:**
- Produces: `export type AlbumRow = { id: string; title: string }`, `export type TrackRow = { id: string; title: string; disc_number: number | null; track_no: number | null }`, `export type MatchResult = { matched: { canonicalId: string; duplicateId: string }[]; ambiguousTitles: string[] }`, `export function matchAlbums(canonicalAlbums: AlbumRow[], duplicateAlbums: AlbumRow[]): MatchResult`, `export function matchTracks(canonicalTracks: TrackRow[], duplicateTracks: TrackRow[]): MatchResult`。Task 5で使う。

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/artist-dedup-matching.unit.test.ts
//
// 重複アーティストのアルバム・トラックを、タイトル完全一致で対応付ける
// 純粋関数のテスト。同名が複数ある場合は推測せず「あいまい」として除外する。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { matchAlbums, matchTracks, type AlbumRow, type TrackRow } from '../utils/artistDedupMatching.ts'

describe('matchAlbums', () => {
  test('matches albums with the same title 1:1', () => {
    const canonical: AlbumRow[] = [{ id: 'c1', title: 'Progress' }]
    const duplicate: AlbumRow[] = [{ id: 'd1', title: 'Progress' }]
    const result = matchAlbums(canonical, duplicate)
    assert.deepEqual(result.matched, [{ canonicalId: 'c1', duplicateId: 'd1' }])
    assert.deepEqual(result.ambiguousTitles, [])
  })

  test('does not match a duplicate album whose title has no counterpart', () => {
    const canonical: AlbumRow[] = [{ id: 'c1', title: 'Progress' }]
    const duplicate: AlbumRow[] = [{ id: 'd1', title: 'Only In Duplicate' }]
    const result = matchAlbums(canonical, duplicate)
    assert.deepEqual(result.matched, [])
    assert.deepEqual(result.ambiguousTitles, [])
  })

  test('flags a title as ambiguous when it appears more than once on either side, and does not match it', () => {
    const canonical: AlbumRow[] = [
      { id: 'c1', title: 'Best' },
      { id: 'c2', title: 'Best' },
    ]
    const duplicate: AlbumRow[] = [{ id: 'd1', title: 'Best' }]
    const result = matchAlbums(canonical, duplicate)
    assert.deepEqual(result.matched, [])
    assert.deepEqual(result.ambiguousTitles, ['Best'])
  })

  test('matches multiple distinct titles independently', () => {
    const canonical: AlbumRow[] = [
      { id: 'c1', title: 'Progress' },
      { id: 'c2', title: 'Sofa' },
    ]
    const duplicate: AlbumRow[] = [
      { id: 'd1', title: 'Sofa' },
      { id: 'd2', title: 'Progress' },
    ]
    const result = matchAlbums(canonical, duplicate)
    assert.deepEqual(
      result.matched.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId)),
      [
        { canonicalId: 'c1', duplicateId: 'd2' },
        { canonicalId: 'c2', duplicateId: 'd1' },
      ]
    )
  })
})

describe('matchTracks', () => {
  test('matches by title + disc_number + track_no when both sides have both numbers set', () => {
    const canonical: TrackRow[] = [{ id: 'c1', title: 'Progress', disc_number: 1, track_no: 3 }]
    const duplicate: TrackRow[] = [{ id: 'd1', title: 'Progress', disc_number: 1, track_no: 3 }]
    const result = matchTracks(canonical, duplicate)
    assert.deepEqual(result.matched, [{ canonicalId: 'c1', duplicateId: 'd1' }])
  })

  test('does not match when disc_number/track_no both present but differ, even if titles match, unless a title-only fallback applies uniquely', () => {
    const canonical: TrackRow[] = [{ id: 'c1', title: 'Progress', disc_number: 1, track_no: 3 }]
    const duplicate: TrackRow[] = [{ id: 'd1', title: 'Progress', disc_number: 2, track_no: 5 }]
    const result = matchTracks(canonical, duplicate)
    // 曲番号は不一致だがタイトルはユニークに1件ずつ対応するので、タイトルのみの
    // フォールバック(第2階層)で一致する
    assert.deepEqual(result.matched, [{ canonicalId: 'c1', duplicateId: 'd1' }])
  })

  test('falls back to title-only match when track_no is missing on one side', () => {
    const canonical: TrackRow[] = [{ id: 'c1', title: 'Progress', disc_number: null, track_no: null }]
    const duplicate: TrackRow[] = [{ id: 'd1', title: 'Progress', disc_number: 1, track_no: 3 }]
    const result = matchTracks(canonical, duplicate)
    assert.deepEqual(result.matched, [{ canonicalId: 'c1', duplicateId: 'd1' }])
  })

  test('flags a title as ambiguous when the title-only fallback finds more than one candidate on either side', () => {
    const canonical: TrackRow[] = [
      { id: 'c1', title: 'Progress', disc_number: null, track_no: null },
      { id: 'c2', title: 'Progress', disc_number: null, track_no: null },
    ]
    const duplicate: TrackRow[] = [{ id: 'd1', title: 'Progress', disc_number: null, track_no: null }]
    const result = matchTracks(canonical, duplicate)
    assert.deepEqual(result.matched, [])
    assert.deepEqual(result.ambiguousTitles, ['Progress'])
  })

  test('does not double-match a track already matched by the disc/track_no tier in the title-only fallback pass', () => {
    const canonical: TrackRow[] = [
      { id: 'c1', title: 'Progress', disc_number: 1, track_no: 1 },
      { id: 'c2', title: 'Progress', disc_number: 1, track_no: 2 },
    ]
    const duplicate: TrackRow[] = [
      { id: 'd1', title: 'Progress', disc_number: 1, track_no: 1 },
      { id: 'd2', title: 'Progress', disc_number: 1, track_no: 2 },
    ]
    const result = matchTracks(canonical, duplicate)
    assert.deepEqual(
      result.matched.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId)),
      [
        { canonicalId: 'c1', duplicateId: 'd1' },
        { canonicalId: 'c2', duplicateId: 'd2' },
      ]
    )
    assert.deepEqual(result.ambiguousTitles, [])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --env-file-if-exists=.env.local --test __tests__/artist-dedup-matching.unit.test.ts`
Expected: FAIL — `Cannot find module '../utils/artistDedupMatching.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// utils/artistDedupMatching.ts
//
// 重複アーティストのアルバム・トラックを、タイトル完全一致で対応付ける
// 純粋関数。同名が複数あって一意に決まらない場合は推測せず「あいまい」として
// 除外する(誤統合よりも取りこぼしを優先する)。
// docs/superpowers/specs/2026-09-12-artist-dedup-design.md「4. アルバムの
// 対応付け」「5. トラックの対応付け」参照。

export type AlbumRow = { id: string; title: string }
export type TrackRow = { id: string; title: string; disc_number: number | null; track_no: number | null }
export type MatchResult = { matched: { canonicalId: string; duplicateId: string }[]; ambiguousTitles: string[] }

function groupByTitle<T extends { title: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const list = map.get(row.title) ?? []
    list.push(row)
    map.set(row.title, list)
  }
  return map
}

export function matchAlbums(canonicalAlbums: AlbumRow[], duplicateAlbums: AlbumRow[]): MatchResult {
  const matched: { canonicalId: string; duplicateId: string }[] = []
  const ambiguousTitles: string[] = []

  const canonicalByTitle = groupByTitle(canonicalAlbums)
  const duplicateByTitle = groupByTitle(duplicateAlbums)

  for (const [title, cList] of canonicalByTitle) {
    const dList = duplicateByTitle.get(title)
    if (!dList || dList.length === 0) continue
    if (cList.length === 1 && dList.length === 1) {
      matched.push({ canonicalId: cList[0].id, duplicateId: dList[0].id })
    } else {
      ambiguousTitles.push(title)
    }
  }

  return { matched, ambiguousTitles }
}

export function matchTracks(canonicalTracks: TrackRow[], duplicateTracks: TrackRow[]): MatchResult {
  const matched: { canonicalId: string; duplicateId: string }[] = []
  const usedCanonical = new Set<string>()
  const usedDuplicate = new Set<string>()

  // 第1階層: タイトル + disc_number + track_no が両側とも設定されていて一致
  for (const c of canonicalTracks) {
    if (c.disc_number === null || c.track_no === null) continue
    const candidates = duplicateTracks.filter(
      (d) => d.title === c.title && d.disc_number === c.disc_number && d.track_no === c.track_no
    )
    if (candidates.length === 1) {
      matched.push({ canonicalId: c.id, duplicateId: candidates[0].id })
      usedCanonical.add(c.id)
      usedDuplicate.add(candidates[0].id)
    }
  }

  // 第2階層: 第1階層で未対応のものだけを対象に、タイトルのみで対応付ける
  const remainingCanonical = canonicalTracks.filter((c) => !usedCanonical.has(c.id))
  const remainingDuplicate = duplicateTracks.filter((d) => !usedDuplicate.has(d.id))
  const canonicalByTitle = groupByTitle(remainingCanonical)
  const duplicateByTitle = groupByTitle(remainingDuplicate)
  const ambiguousTitles: string[] = []

  for (const [title, cList] of canonicalByTitle) {
    const dList = duplicateByTitle.get(title)
    if (!dList || dList.length === 0) continue
    if (cList.length === 1 && dList.length === 1) {
      matched.push({ canonicalId: cList[0].id, duplicateId: dList[0].id })
    } else {
      ambiguousTitles.push(title)
    }
  }

  return { matched, ambiguousTitles }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --env-file-if-exists=.env.local --test __tests__/artist-dedup-matching.unit.test.ts`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add utils/artistDedupMatching.ts __tests__/artist-dedup-matching.unit.test.ts
git commit -m "feat: add exact-title album/track matching for artist dedup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: 汎用の外部キー再ポイント処理

**Files:**
- Create: `utils/fkRepoint.ts`
- Test: `__tests__/fk-repoint.unit.test.ts`

**Interfaces:**
- Produces: `export type FkReference = { table: string; column: string }`, `export type RepointOutcome = { table: string; column: string; status: 'ok' | 'failed'; movedCount?: number; error?: string }`, `export async function repointForeignKeys(refs: FkReference[], fromId: string, toId: string, updateFn: (table: string, column: string, fromId: string, toId: string) => Promise<{ error: string | null; count?: number }>): Promise<RepointOutcome[]>`。Task 5で使う(`updateFn`に実際のSupabase呼び出しを渡す)。`count`はdry-runレポートで「何件移設したか」を報告するために使う(スペック「安全確認」の必須報告項目)。

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/fk-repoint.unit.test.ts
//
// 「指定した外部キー列一覧それぞれについてUPDATEを試み、失敗したものは
// 個別に記録して残りは続行する」というオーケストレーションロジックのテスト。
// 実際のDB呼び出しはupdateFnとして注入するため、ここではDBに触れない。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { repointForeignKeys, type FkReference } from '../utils/fkRepoint.ts'

describe('repointForeignKeys', () => {
  test('calls updateFn once per reference and reports ok with the moved count when it succeeds', async () => {
    const refs: FkReference[] = [{ table: 'track_artist', column: 'artist_id' }]
    const calls: unknown[] = []
    const result = await repointForeignKeys(refs, 'dup-1', 'canon-1', async (table, column, fromId, toId) => {
      calls.push({ table, column, fromId, toId })
      return { error: null, count: 3 }
    })
    assert.deepEqual(result, [{ table: 'track_artist', column: 'artist_id', status: 'ok', movedCount: 3 }])
    assert.deepEqual(calls, [{ table: 'track_artist', column: 'artist_id', fromId: 'dup-1', toId: 'canon-1' }])
  })

  test('defaults movedCount to 0 when updateFn does not report a count', async () => {
    const refs: FkReference[] = [{ table: 'track_artist', column: 'artist_id' }]
    const result = await repointForeignKeys(refs, 'dup-1', 'canon-1', async () => ({ error: null }))
    assert.deepEqual(result, [{ table: 'track_artist', column: 'artist_id', status: 'ok', movedCount: 0 }])
  })

  test('records a failure for one reference without stopping the rest', async () => {
    const refs: FkReference[] = [
      { table: 'genre_highlight', column: 'artist_id' },
      { table: 'track_artist', column: 'artist_id' },
    ]
    const result = await repointForeignKeys(refs, 'dup-1', 'canon-1', async (table) => {
      if (table === 'genre_highlight') return { error: 'duplicate key value violates unique constraint' }
      return { error: null, count: 2 }
    })
    assert.deepEqual(result, [
      { table: 'genre_highlight', column: 'artist_id', status: 'failed', error: 'duplicate key value violates unique constraint' },
      { table: 'track_artist', column: 'artist_id', status: 'ok', movedCount: 2 },
    ])
  })

  test('returns an empty array for an empty reference list', async () => {
    const result = await repointForeignKeys([], 'dup-1', 'canon-1', async () => ({ error: null }))
    assert.deepEqual(result, [])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --env-file-if-exists=.env.local --test __tests__/fk-repoint.unit.test.ts`
Expected: FAIL — `Cannot find module '../utils/fkRepoint.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// utils/fkRepoint.ts
//
// 重複アーティスト/アルバム/トラックを削除する前に、それらのidを参照している
// 外部キー列を新しいid(本体側)へ一括で付け替えるための汎用処理。
// テーブルごとに固有のユニーク制約があり得るため、1テーブルの失敗が他の
// テーブルの処理を止めないようにする(実際の更新方法はupdateFnとして注入し、
// このファイル自体はDBに触れない)。

export type FkReference = { table: string; column: string }
export type RepointOutcome = { table: string; column: string; status: 'ok' | 'failed'; movedCount?: number; error?: string }

export async function repointForeignKeys(
  refs: FkReference[],
  fromId: string,
  toId: string,
  updateFn: (table: string, column: string, fromId: string, toId: string) => Promise<{ error: string | null; count?: number }>
): Promise<RepointOutcome[]> {
  const outcomes: RepointOutcome[] = []
  for (const ref of refs) {
    const { error, count } = await updateFn(ref.table, ref.column, fromId, toId)
    if (error) {
      outcomes.push({ table: ref.table, column: ref.column, status: 'failed', error })
    } else {
      outcomes.push({ table: ref.table, column: ref.column, status: 'ok', movedCount: count ?? 0 })
    }
  }
  return outcomes
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --env-file-if-exists=.env.local --test __tests__/fk-repoint.unit.test.ts`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add utils/fkRepoint.ts __tests__/fk-repoint.unit.test.ts
git commit -m "feat: add generic FK-repoint orchestration for artist dedup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: グループ発見 + dry-runレポート(書き込みなし)

**Files:**
- Create: `scripts/dedupe-artists.ts`

**Interfaces:**
- Consumes: `pickCanonical`/`ArtistCandidate`(Task 1)、`ArtistCandidate`型そのまま使用。
- Produces: このタスクではdry-run専用のレポート出力のみ(後続タスクで`--execute`を追加する)。`main()`という名前のエントリポイント関数をこのファイルの末尾に持つ(Task 5がこのファイルを直接拡張する)。

- [ ] **Step 1: スクリプトを作成する**

```ts
// scripts/dedupe-artists.ts
//
// 重複アーティストレコード(スガ シカオ・坂本冬美・ワン・ダイレクションの
// カタログ丸ごと複製3組と、トラック0件の空スタブ49組)を1つのartist_idへ
// 統合する。docs/superpowers/specs/2026-09-12-artist-dedup-design.md参照。
//
// 対象グループは名前ではなくルールで抽出する(将来同種の重複が増えても
// 再利用できるように): 名前が重複していて、
//   (a) 全重複行のtrack数合計が0 → 「空スタブ」として副次データのみ統合
//   (b) track数合計>0かつ「ユニークな曲名数/track数合計」が0.2未満 → 「深刻」
//       としてアルバム・トラックも含めて統合
// それ以外(ユニーク率0.2以上、"Various Artists"等)は対象外。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/dedupe-artists.ts --dry-run   (既定、書き込みなし)
//   npx tsx --env-file=.env.local scripts/dedupe-artists.ts --execute
import { createAdminClient } from '@/utils/Supabase/admin'
import { pickCanonical, type ArtistCandidate } from '@/utils/artistDedupCanonical'

type AdminClient = ReturnType<typeof createAdminClient>

const UNIQUENESS_THRESHOLD = 0.2

type ArtistRow = { id: string; name: string; bio: string | null; image_url: string | null }
type TrackTitleRow = { artist_id: string; title: string }

// PostgRESTの1リクエストあたり行数上限(既定1000件)を超えるため、range()で
// ページングして全件取得する(このプロジェクトで繰り返し発生している既知の
// 不具合パターン。utils/fetchAllRows.ts参照)。
async function fetchAllArtists(supabase: AdminClient): Promise<ArtistRow[]> {
  const rows: ArtistRow[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('artist')
      .select('id, name, bio, image_url')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    const page = (data ?? []) as ArtistRow[]
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function fetchTrackTitlesForArtists(supabase: AdminClient, artistIds: string[]): Promise<TrackTitleRow[]> {
  const rows: TrackTitleRow[] = []
  for (let i = 0; i < artistIds.length; i += 200) {
    const chunk = artistIds.slice(i, i + 200)
    const pageSize = 1000
    let offset = 0
    while (true) {
      const { data } = await supabase
        .from('track')
        .select('artist_id, title')
        .in('artist_id', chunk)
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)
      const page = (data ?? []) as TrackTitleRow[]
      rows.push(...page)
      if (page.length < pageSize) break
      offset += pageSize
    }
  }
  return rows
}

type GroupKind = 'stub' | 'severe'
type DedupGroup = { name: string; artistIds: string[]; kind: GroupKind }

/** 名前が重複しているアーティストを、空スタブ/深刻の2種類に分類して返す
 * (ユニーク率0.2以上の中間的な重複は対象外なので含めない)。 */
function classifyGroups(allArtists: ArtistRow[], trackTitles: TrackTitleRow[]): DedupGroup[] {
  const idsByName = new Map<string, string[]>()
  for (const a of allArtists) {
    const list = idsByName.get(a.name) ?? []
    list.push(a.id)
    idsByName.set(a.name, list)
  }

  const titlesByArtistId = new Map<string, string[]>()
  for (const t of trackTitles) {
    const list = titlesByArtistId.get(t.artist_id) ?? []
    list.push(t.title)
    titlesByArtistId.set(t.artist_id, list)
  }

  const groups: DedupGroup[] = []
  for (const [name, artistIds] of idsByName) {
    if (artistIds.length < 2) continue

    const allTitles: string[] = []
    for (const id of artistIds) {
      const titles = titlesByArtistId.get(id)
      if (titles) allTitles.push(...titles)
    }

    if (allTitles.length === 0) {
      groups.push({ name, artistIds, kind: 'stub' })
      continue
    }

    const uniqueRatio = new Set(allTitles).size / allTitles.length
    if (uniqueRatio < UNIQUENESS_THRESHOLD) {
      groups.push({ name, artistIds, kind: 'severe' })
    }
    // それ以外(ユニーク率0.2以上)は対象外
  }
  return groups
}

type SecondaryCounts = {
  trackCount: number
  albumCount: number
  externalLinkCount: number
  genreCount: number
  relationCount: number
  mvBackfillLogCount: number
}

async function fetchSecondaryCounts(supabase: AdminClient, artistId: string): Promise<SecondaryCounts> {
  const [track, album, link, genre, relA, relB, mv] = await Promise.all([
    supabase.from('track').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('album').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('artist_external_link').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('artist_genre').select('artist_id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }).eq('artist_id_a', artistId),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }).eq('artist_id_b', artistId),
    supabase.from('youtube_mv_backfill_log').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
  ])
  return {
    trackCount: track.count ?? 0,
    albumCount: album.count ?? 0,
    externalLinkCount: link.count ?? 0,
    genreCount: genre.count ?? 0,
    relationCount: (relA.count ?? 0) + (relB.count ?? 0),
    mvBackfillLogCount: mv.count ?? 0,
  }
}

async function buildCandidates(supabase: AdminClient, artistRows: ArtistRow[]): Promise<ArtistCandidate[]> {
  const candidates: ArtistCandidate[] = []
  for (const row of artistRows) {
    const counts = await fetchSecondaryCounts(supabase, row.id)
    candidates.push({
      id: row.id,
      trackCount: counts.trackCount,
      albumCount: counts.albumCount,
      externalLinkCount: counts.externalLinkCount,
      genreCount: counts.genreCount,
      relationCount: counts.relationCount,
      mvBackfillLogCount: counts.mvBackfillLogCount,
      hasBio: row.bio !== null && row.bio.trim() !== '',
      hasImage: row.image_url !== null,
    })
  }
  return candidates
}

const DRY_RUN = !process.argv.includes('--execute')

async function main() {
  const supabase = createAdminClient()

  console.log('アーティストを集計中...')
  const allArtists = await fetchAllArtists(supabase)
  console.log(`  ${allArtists.length}件のアーティストを取得しました`)

  const idsByName = new Map<string, string[]>()
  for (const a of allArtists) {
    const list = idsByName.get(a.name) ?? []
    list.push(a.id)
    idsByName.set(a.name, list)
  }
  const duplicateArtistIds = [...idsByName.values()].filter((ids) => ids.length > 1).flat()

  console.log('重複候補アーティストのトラックタイトルを取得中...')
  const trackTitles = await fetchTrackTitlesForArtists(supabase, duplicateArtistIds)

  const groups = classifyGroups(allArtists, trackTitles)
  const stubGroups = groups.filter((g) => g.kind === 'stub')
  const severeGroups = groups.filter((g) => g.kind === 'severe')

  console.log(`\n対象: 空スタブ${stubGroups.length}組、深刻${severeGroups.length}組\n`)

  const artistById = new Map(allArtists.map((a) => [a.id, a]))

  for (const group of [...severeGroups, ...stubGroups]) {
    console.log(`=== ${group.name}(${group.kind}, ${group.artistIds.length}行) ===`)
    const rows = group.artistIds.map((id) => artistById.get(id)!).filter(Boolean)
    const candidates = await buildCandidates(supabase, rows)
    const canonical = pickCanonical(candidates)
    console.log(`  本体候補: ${canonical.id}(track=${canonical.trackCount}, album=${canonical.albumCount})`)
    for (const c of candidates) {
      if (c.id === canonical.id) continue
      console.log(
        `  重複: ${c.id}(track=${c.trackCount}, album=${c.albumCount}, link=${c.externalLinkCount}, genre=${c.genreCount}, relation=${c.relationCount}, mvlog=${c.mvBackfillLogCount})`
      )
    }
  }

  console.log(`\n${DRY_RUN ? '[dry-run] 書き込みは行っていません。' : ''}`)
}

main()
```

- [ ] **Step 2: 動作確認(dry-runで実データに対して実行し、レポートを目視確認する)**

Run: `npx tsx --env-file=.env.local scripts/dedupe-artists.ts --dry-run`
Expected: 「対象: 空スタブ49組、深刻3組」と出力され、深刻3組がスガ シカオ・坂本冬美・ワン・ダイレクションであること、各組の本体候補が最もtrack数の多い行になっていることを目視で確認する。件数が仕様書の調査結果(空スタブ49組、深刻3組)と一致しない場合は、`UNIQUENESS_THRESHOLD`や`classifyGroups`のロジックを見直すこと。

- [ ] **Step 3: Commit**

```bash
git add scripts/dedupe-artists.ts
git commit -m "feat: add dry-run group discovery for artist dedup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: 副次データの統合(空スタブ49組 + 深刻3組共通)

**Files:**
- Modify: `scripts/dedupe-artists.ts`

**Interfaces:**
- Consumes: `repointForeignKeys`/`FkReference`(Task 3)。
- Produces: `mergeSecondaryData(supabase, canonicalId, duplicateId, execute)`という関数(Task 6が深刻3組の処理から呼ぶ)。

- [ ] **Step 1: `ARTIST_FK_REFERENCES`定数と統合関数を追加する**

`scripts/dedupe-artists.ts`の`import`ブロックを次のように変更する:

```ts
import { createAdminClient } from '@/utils/Supabase/admin'
import { pickCanonical, type ArtistCandidate } from '@/utils/artistDedupCanonical'
import { repointForeignKeys, type FkReference } from '@/utils/fkRepoint'
```

同ファイルの`const DRY_RUN = ...`の直前に、次のブロックを追加する(この一覧はこのplanの「参照元テーブル一覧」からtrack.artist_idを除いたもの。track.artist_idは深刻3組ではTask 6のマッチング処理で個別に扱うため、この汎用リストには含めない):

```ts
// artist.idを参照するテーブル一覧(2026-09-12、information_schemaで確認済み。
// track.artist_idは深刻3組のマッチング処理(mergeAlbumsAndTracks)で個別に
// 扱うためここには含めない)
const ARTIST_FK_REFERENCES: FkReference[] = [
  { table: 'album', column: 'artist_id' },
  { table: 'album_artist', column: 'artist_id' },
  { table: 'artist_credit', column: 'artist_id' },
  { table: 'artist_label', column: 'artist_id' },
  { table: 'artist_match_log', column: 'stub_artist_id' },
  { table: 'award_entry', column: 'artist_id' },
  { table: 'bio_generation_log', column: 'artist_id' },
  { table: 'contest_entry', column: 'artist_id' },
  { table: 'event_appearance', column: 'artist_id' },
  { table: 'event_appearance_artist', column: 'artist_id' },
  { table: 'festival_pilot_artist_link', column: 'artist_id' },
  { table: 'genre_highlight', column: 'artist_id' },
  { table: 'music_event', column: 'artist_id' },
  { table: 'person_artist_relation', column: 'artist_id' },
  { table: 'radio_rotation', column: 'artist_id' },
  { table: 'ranking_entry', column: 'artist_id' },
  { table: 'setlist', column: 'artist_id' },
  { table: 'track_artist', column: 'artist_id' },
  { table: 'youtube_mv_backfill_log', column: 'artist_id' },
]

async function updateFk(
  supabase: AdminClient,
  table: string,
  column: string,
  fromId: string,
  toId: string,
  execute: boolean
): Promise<{ error: string | null; count?: number }> {
  if (!execute) {
    // dry-run: 実際には書き込まず、対象になる件数だけ数えて返す
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, fromId)
    return { error: error ? error.message : null, count: count ?? 0 }
  }
  // { count: 'exact' }を付けると、UPDATEが実際に何件のマッチ行を更新したかが
  // 返ってくる(dry-runレポートで移設件数を報告するために必要)
  const { error, count } = await supabase.from(table).update({ [column]: toId }, { count: 'exact' }).eq(column, fromId)
  return { error: error ? error.message : null, count: count ?? 0 }
}

/** artist_external_link・artist_genreを本体へ移設する。本体側と(link_type,url)/
 * genre_idが重複するものは移設せず削除する(スペック「3. 副次データの移設」)。 */
async function migrateDedupedLinks(supabase: AdminClient, canonicalId: string, duplicateId: string, execute: boolean) {
  const [{ data: canonicalLinks }, { data: duplicateLinks }] = await Promise.all([
    supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', canonicalId),
    supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', duplicateId),
  ])
  const canonicalKeys = new Set((canonicalLinks ?? []).map((l) => `${l.link_type}|${l.url}`))
  let moved = 0
  let dropped = 0
  for (const link of duplicateLinks ?? []) {
    const key = `${link.link_type}|${link.url}`
    if (canonicalKeys.has(key)) {
      dropped++
      if (execute) await supabase.from('artist_external_link').delete().eq('id', link.id)
    } else {
      moved++
      canonicalKeys.add(key)
      if (execute) await supabase.from('artist_external_link').update({ artist_id: canonicalId }).eq('id', link.id)
    }
  }

  const [{ data: canonicalGenres }, { data: duplicateGenres }] = await Promise.all([
    supabase.from('artist_genre').select('genre_id').eq('artist_id', canonicalId),
    supabase.from('artist_genre').select('genre_id').eq('artist_id', duplicateId),
  ])
  const canonicalGenreIds = new Set((canonicalGenres ?? []).map((g) => g.genre_id))
  let genresMoved = 0
  let genresDropped = 0
  for (const g of duplicateGenres ?? []) {
    if (canonicalGenreIds.has(g.genre_id)) {
      genresDropped++
      if (execute) await supabase.from('artist_genre').delete().eq('artist_id', duplicateId).eq('genre_id', g.genre_id)
    } else {
      genresMoved++
      canonicalGenreIds.add(g.genre_id)
      if (execute)
        await supabase.from('artist_genre').update({ artist_id: canonicalId }).eq('artist_id', duplicateId).eq('genre_id', g.genre_id)
    }
  }

  return { linksMoved: moved, linksDropped: dropped, genresMoved, genresDropped }
}

/** artist_relationを本体へ移設する。付け替えた結果artist_id_a===artist_id_bに
 * なる行(グループ内の重複行同士の関係だった場合)は削除する(スペック
 * 「3. 副次データの移設」)。 */
async function migrateRelations(supabase: AdminClient, canonicalId: string, duplicateId: string, execute: boolean) {
  const { data: relations } = await supabase
    .from('artist_relation')
    .select('id, artist_id_a, artist_id_b')
    .or(`artist_id_a.eq.${duplicateId},artist_id_b.eq.${duplicateId}`)

  let moved = 0
  let droppedSelfRelation = 0
  for (const r of relations ?? []) {
    const newA = r.artist_id_a === duplicateId ? canonicalId : r.artist_id_a
    const newB = r.artist_id_b === duplicateId ? canonicalId : r.artist_id_b
    if (newA === newB) {
      droppedSelfRelation++
      if (execute) await supabase.from('artist_relation').delete().eq('id', r.id)
    } else {
      moved++
      if (execute) await supabase.from('artist_relation').update({ artist_id_a: newA, artist_id_b: newB }).eq('id', r.id)
    }
  }
  return { moved, droppedSelfRelation }
}

/** artist.bio等のスカラー項目で、本体側がnull/空のものだけ重複側の値を
 * コピーする(スペック「2. スカラー項目の補完」)。 */
async function fillScalarFields(supabase: AdminClient, canonicalId: string, duplicateId: string, execute: boolean) {
  const FIELDS = [
    'bio', 'image_url', 'name_kana', 'name_en', 'formed_year', 'disbanded_year',
    'active_status', 'hometown_country', 'origin_prefecture', 'hometown_city',
    'official_site_url', 'sns_x_url', 'sns_instagram_url', 'apple_music_artist_id', 'spotify_artist_id',
  ]
  const [{ data: canonicalRow }, { data: duplicateRow }] = await Promise.all([
    supabase.from('artist').select(FIELDS.join(',')).eq('id', canonicalId).single(),
    supabase.from('artist').select(FIELDS.join(',')).eq('id', duplicateId).single(),
  ])
  if (!canonicalRow || !duplicateRow) return { filled: [] as string[] }

  const patch: Record<string, unknown> = {}
  const filled: string[] = []
  for (const field of FIELDS) {
    const canonicalValue = (canonicalRow as Record<string, unknown>)[field]
    const duplicateValue = (duplicateRow as Record<string, unknown>)[field]
    const canonicalEmpty = canonicalValue === null || canonicalValue === ''
    const duplicateHasValue = duplicateValue !== null && duplicateValue !== ''
    if (canonicalEmpty && duplicateHasValue) {
      patch[field] = duplicateValue
      filled.push(field)
    }
  }
  if (filled.length > 0 && execute) {
    await supabase.from('artist').update(patch).eq('id', canonicalId)
  }
  return { filled }
}

/** 1件の重複artist_idについて、副次データ(外部リンク・ジャンル・関係性・
 * MVログ・スカラー項目)を本体へ統合する。空スタブ49組はこれだけで完了する。 */
async function mergeSecondaryData(supabase: AdminClient, canonicalId: string, duplicateId: string, execute: boolean) {
  const scalarResult = await fillScalarFields(supabase, canonicalId, duplicateId, execute)
  const linkResult = await migrateDedupedLinks(supabase, canonicalId, duplicateId, execute)
  const relationResult = await migrateRelations(supabase, canonicalId, duplicateId, execute)
  // updateFk自体がexecute=falseのときは書き込まず件数だけ数えるので、ここでは
  // 無条件に呼んでよい(mergeSecondaryDataの他の関数はそれぞれ内部でexecuteを
  // 見て書き込みを分岐しているのに対し、こちらはupdateFk自身がdry-run安全)
  const fkOutcomes = await repointForeignKeys(ARTIST_FK_REFERENCES, duplicateId, canonicalId, (table, column, fromId, toId) =>
    updateFk(supabase, table, column, fromId, toId, execute)
  )
  return { scalarResult, linkResult, relationResult, fkOutcomes }
}
```

- [ ] **Step 2: `main()`のループから`mergeSecondaryData`を呼ぶように変更する**

`main()`内のグループ処理ループを次のように置き換える(トラック/アルバムの統合(深刻3組のみ、Task 6で追加)は今はまだ呼ばない):

```ts
  for (const group of [...severeGroups, ...stubGroups]) {
    console.log(`=== ${group.name}(${group.kind}, ${group.artistIds.length}行) ===`)
    const rows = group.artistIds.map((id) => artistById.get(id)!).filter(Boolean)
    const candidates = await buildCandidates(supabase, rows)
    const canonical = pickCanonical(candidates)
    console.log(`  本体候補: ${canonical.id}(track=${canonical.trackCount}, album=${canonical.albumCount})`)

    for (const c of candidates) {
      if (c.id === canonical.id) continue
      console.log(
        `  重複: ${c.id}(track=${c.trackCount}, album=${c.albumCount}, link=${c.externalLinkCount}, genre=${c.genreCount}, relation=${c.relationCount}, mvlog=${c.mvBackfillLogCount})`
      )
      try {
        const result = await mergeSecondaryData(supabase, canonical.id, c.id, !DRY_RUN)
        console.log(
          `    補完フィールド: [${result.scalarResult.filled.join(', ')}] / リンク移設${result.linkResult.linksMoved}件・重複削除${result.linkResult.linksDropped}件 / ジャンル移設${result.linkResult.genresMoved}件・重複削除${result.linkResult.genresDropped}件 / 関係性移設${result.relationResult.moved}件・自己参照削除${result.relationResult.droppedSelfRelation}件`
        )
        // ARTIST_FK_REFERENCES経由で移設される各テーブルの件数(0件のものは省略)。
        // radio_rotation/ranking_entry/award_entry等、空スタブ組では0件のはずの
        // テーブルに非ゼロ件数が出た場合はここで気付けるようにする(スペック
        // 「安全確認」の必須報告項目)
        const nonZeroFks = result.fkOutcomes.filter((o) => o.status === 'ok' && (o.movedCount ?? 0) > 0)
        if (nonZeroFks.length > 0) {
          console.log(`    FK移設: ${nonZeroFks.map((f) => `${f.table}.${f.column}=${f.movedCount}件`).join(', ')}`)
        }
        const failedFks = result.fkOutcomes.filter((o) => o.status === 'failed')
        if (failedFks.length > 0) {
          console.log(`    ⚠️ FK付け替え失敗: ${failedFks.map((f) => `${f.table}.${f.column}(${f.error})`).join(', ')}`)
          console.log('    ⚠️ この重複行は削除しません(付け替えに失敗した参照が残っているため)')
        } else if (!DRY_RUN) {
          const { error: deleteError } = await supabase.from('artist').delete().eq('id', c.id)
          if (deleteError) {
            console.log(`    ❌ 重複artist行の削除に失敗しました: ${deleteError.message}`)
          }
        }
      } catch (err) {
        console.log(`    ❌ このグループの処理に失敗しました: ${(err as Error).message}`)
      }
    }
  }
```

- [ ] **Step 3: dry-runで再実行して確認する**

Run: `npx tsx --env-file=.env.local scripts/dedupe-artists.ts --dry-run`
Expected: 空スタブ49組それぞれについて、外部リンク・ジャンル・関係性の移設件数が表示される。合計すると仕様書の調査結果(外部リンク290件・ジャンル63件・関係性130件)と概ね一致することを確認する(重複削除される分があるため完全一致はしない)。深刻3組についても副次データの移設件数が表示されることを確認する(トラック/アルバムの統合はまだ行われていない)。

- [ ] **Step 4: Commit**

```bash
git add scripts/dedupe-artists.ts
git commit -m "feat: merge secondary artist data (links, genres, relations, logs)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: 深刻3組のアルバム・トラック統合

**Files:**
- Modify: `scripts/dedupe-artists.ts`

**Interfaces:**
- Consumes: `matchAlbums`/`matchTracks`(Task 2)、`repointForeignKeys`(Task 3)、`mergeSecondaryData`(Task 5)。

- [ ] **Step 1: `import`にTask 2の関数を追加する**

```ts
import { matchAlbums, matchTracks } from '@/utils/artistDedupMatching'
```

- [ ] **Step 2: `ALBUM_FK_REFERENCES`・`TRACK_FK_REFERENCES`定数と、アルバム/トラック統合関数を追加する**

`ARTIST_FK_REFERENCES`の定義の直後に追加する:

```ts
// album.idを参照するテーブル一覧(2026-09-12確認済み。マッチ済みアルバムを
// 削除する前に使う。track.album_idはトラック統合が終わっていれば通常0件)
const ALBUM_FK_REFERENCES: FkReference[] = [
  { table: 'album', column: 'primary_album_id' },
  { table: 'album_artist', column: 'album_id' },
  { table: 'album_artwork', column: 'album_id' },
  { table: 'album_credit', column: 'album_id' },
  { table: 'album_genre', column: 'album_id' },
  { table: 'album_match_log', column: 'stub_album_id' },
  { table: 'album_pickup', column: 'album_id' },
  { table: 'artist_credit', column: 'album_id' },
  { table: 'award_entry', column: 'album_id' },
  { table: 'collection_entry', column: 'album_id' },
  { table: 'contest_entry', column: 'album_id' },
  { table: 'disc_guide_selection', column: 'album_id' },
  { table: 'genre_highlight', column: 'album_id' },
  { table: 'radio_rotation', column: 'album_id' },
  { table: 'ranking_entry', column: 'album_id' },
  { table: 'track', column: 'album_id' },
]

// track.idを参照するテーブル一覧(2026-09-12確認済み。マッチ済みトラックを
// 削除する前に使う)
const TRACK_FK_REFERENCES: FkReference[] = [
  { table: 'album', column: 'representative_track_id' },
  { table: 'artist_credit', column: 'track_id' },
  { table: 'award_entry', column: 'track_id' },
  { table: 'collection_entry', column: 'track_id' },
  { table: 'contest_entry', column: 'track_id' },
  { table: 'playlist_track', column: 'track_id' },
  { table: 'radio_rotation', column: 'track_id' },
  { table: 'ranking_entry', column: 'track_id' },
  { table: 'setlist_track', column: 'track_id' },
  { table: 'sync_entry', column: 'track_id' },
  { table: 'track_artist', column: 'track_id' },
  { table: 'track_credit', column: 'track_id' },
  { table: 'track_genre', column: 'track_id' },
  { table: 'track_instrument', column: 'track_id' },
]

type AlbumFullRow = { id: string; title: string }
type TrackFullRow = { id: string; title: string; disc_number: number | null; track_no: number | null }

const TRACK_MERGE_FIELDS = [
  'youtube_video_id', 'preview_url', 'apple_music_track_id', 'spotify_track_id',
  'youtube_music_track_id', 'amazon_music_track_id', 'lyric_url', 'track_review', 'duration_seconds',
]

/** 対応付けられたトラックペアについて、本体側がnullの項目だけ重複側の値を
 * コピーする(スペック「6. マッチしたトラックのフィールド補完」)。その後、
 * トラックを参照する外部キーを本体トラックへ付け替えてから重複トラックを
 * 削除する(execute時のみ)。 */
async function mergeMatchedTrack(supabase: AdminClient, canonicalTrackId: string, duplicateTrackId: string, execute: boolean) {
  const [{ data: canonicalTrack }, { data: duplicateTrack }] = await Promise.all([
    supabase.from('track').select(TRACK_MERGE_FIELDS.join(',')).eq('id', canonicalTrackId).single(),
    supabase.from('track').select(TRACK_MERGE_FIELDS.join(',')).eq('id', duplicateTrackId).single(),
  ])
  const patch: Record<string, unknown> = {}
  const filled: string[] = []
  if (canonicalTrack && duplicateTrack) {
    for (const field of TRACK_MERGE_FIELDS) {
      const canonicalValue = (canonicalTrack as Record<string, unknown>)[field]
      const duplicateValue = (duplicateTrack as Record<string, unknown>)[field]
      if ((canonicalValue === null || canonicalValue === '') && duplicateValue !== null && duplicateValue !== '') {
        patch[field] = duplicateValue
        filled.push(field)
      }
    }
  }
  if (execute) {
    if (Object.keys(patch).length > 0) await supabase.from('track').update(patch).eq('id', canonicalTrackId)
    await repointForeignKeys(TRACK_FK_REFERENCES, duplicateTrackId, canonicalTrackId, (table, column, fromId, toId) =>
      updateFk(supabase, table, column, fromId, toId, execute)
    )
    await supabase.from('track').delete().eq('id', duplicateTrackId)
  }
  return { filled }
}

/** 1件の重複artist_idについて、アルバム・トラックをタイトル完全一致で本体へ
 * 対応付けて統合する(深刻3組専用。スペック「4〜8」参照)。 */
async function mergeAlbumsAndTracks(supabase: AdminClient, canonicalArtistId: string, duplicateArtistId: string, execute: boolean) {
  const [{ data: canonicalAlbums }, { data: duplicateAlbums }] = await Promise.all([
    supabase.from('album').select('id, title').eq('artist_id', canonicalArtistId),
    supabase.from('album').select('id, title').eq('artist_id', duplicateArtistId),
  ])
  const albumResult = matchAlbums((canonicalAlbums ?? []) as AlbumFullRow[], (duplicateAlbums ?? []) as AlbumFullRow[])

  let tracksMatched = 0
  let tracksReassigned = 0
  const trackAmbiguousTitles: string[] = []
  const matchedDuplicateAlbumIds = new Set(albumResult.matched.map((m) => m.duplicateId))

  for (const pair of albumResult.matched) {
    const [{ data: canonicalTracks }, { data: duplicateTracks }] = await Promise.all([
      supabase.from('track').select('id, title, disc_number, track_no').eq('album_id', pair.canonicalId),
      supabase.from('track').select('id, title, disc_number, track_no').eq('album_id', pair.duplicateId),
    ])
    const trackResult = matchTracks(
      (canonicalTracks ?? []) as TrackFullRow[],
      (duplicateTracks ?? []) as TrackFullRow[]
    )
    trackAmbiguousTitles.push(...trackResult.ambiguousTitles)

    for (const trackPair of trackResult.matched) {
      tracksMatched++
      await mergeMatchedTrack(supabase, trackPair.canonicalId, trackPair.duplicateId, execute)
    }

    const matchedDuplicateTrackIds = new Set(trackResult.matched.map((m) => m.duplicateId))
    const unmatchedTracks = (duplicateTracks ?? []).filter((t) => !matchedDuplicateTrackIds.has(t.id))
    for (const t of unmatchedTracks) {
      tracksReassigned++
      if (execute) await supabase.from('track').update({ artist_id: canonicalArtistId }).eq('id', t.id)
    }

    if (execute && unmatchedTracks.length === 0) {
      // アルバムの中身が全てマッチ・削除されたので、アルバム自体を削除する
      await repointForeignKeys(ALBUM_FK_REFERENCES, pair.duplicateId, pair.canonicalId, (table, column, fromId, toId) =>
        updateFk(supabase, table, column, fromId, toId, execute)
      )
      await supabase.from('album').delete().eq('id', pair.duplicateId)
    } else if (execute && unmatchedTracks.length > 0) {
      // 未マッチのトラックが残っているアルバムは削除せず本体へ付け替える
      await supabase.from('album').update({ artist_id: canonicalArtistId }).eq('id', pair.duplicateId)
    }
  }

  const unmatchedAlbums = (duplicateAlbums ?? []).filter((a) => !matchedDuplicateAlbumIds.has(a.id))
  for (const album of unmatchedAlbums) {
    if (execute) await supabase.from('album').update({ artist_id: canonicalArtistId }).eq('id', album.id)
  }

  return {
    matchedAlbums: albumResult.matched.length,
    ambiguousAlbumTitles: albumResult.ambiguousTitles,
    reassignedAlbums: unmatchedAlbums.map((a) => a.title),
    tracksMatched,
    tracksReassigned,
    trackAmbiguousTitles,
  }
}
```

- [ ] **Step 3: `main()`のループで、深刻グループの場合に`mergeAlbumsAndTracks`も呼ぶ**

Task 5 Step 2で書いた`try`ブロックの中に、`const failedFks = result.fkOutcomes.filter(...)`という行がある。**その行の直前**に、次のブロックを挿入する(`mergeAlbumsAndTracks`はアーティスト行を削除する判断より前に完了している必要があるため):

```ts
        if (group.kind === 'severe') {
          const albumTrackResult = await mergeAlbumsAndTracks(supabase, canonical.id, c.id, !DRY_RUN)
          console.log(
            `    アルバム統合: ${albumTrackResult.matchedAlbums}件マッチ / トラック統合: ${albumTrackResult.tracksMatched}件マッチ・${albumTrackResult.tracksReassigned}件は本体へ再割り当て`
          )
          if (albumTrackResult.ambiguousAlbumTitles.length > 0) {
            console.log(`    ⚠️ あいまいで未対応のアルバム: ${albumTrackResult.ambiguousAlbumTitles.join(', ')}`)
          }
          if (albumTrackResult.trackAmbiguousTitles.length > 0) {
            console.log(`    ⚠️ あいまいで未対応のトラック: ${albumTrackResult.trackAmbiguousTitles.join(', ')}`)
          }
          if (albumTrackResult.reassignedAlbums.length > 0) {
            console.log(`    再割り当てされたアルバム: ${albumTrackResult.reassignedAlbums.join(', ')}`)
          }
        }
```

Task 5 Step 2で既に追加済みの「重複artist行を削除する」ロジック(`failedFks`のチェックとその下の`else if (!DRY_RUN)`ブロック)はこのままでよい — `mergeAlbumsAndTracks`の後に実行されるため、アルバム/トラックの統合が終わってから削除の判断が行われる順序になる。深刻3組でアルバム・トラックが正しく統合されていれば、この時点で重複artistが参照しているalbum/track行は残っていないはずで、`DELETE FROM artist`は成功する。何らかの理由で統合しきれなかったalbum/trackが残っていた場合は、外部キー制約により削除がエラーになり、Task 5 Step 2で追加済みの`deleteError`のログでそれと分かる(データが黙って失われることはない)。

- [ ] **Step 4: dry-runで実データに対して再実行し、内容を確認する**

Run: `npx tsx --env-file=.env.local scripts/dedupe-artists.ts --dry-run`
Expected: スガ シカオ・坂本冬美・ワン・ダイレクションそれぞれについて、アルバム・トラックのマッチ件数、あいまいで未対応の一覧、再割り当てされるアルバムの一覧が表示される。スガ シカオの4行(477曲同士)については、ほぼ全曲がマッチすることを確認する。この出力を見て、明らかにおかしい対応付け(例: 全く違う曲同士がマッチしている)が無いか目視で確認すること。

- [ ] **Step 5: Commit**

```bash
git add scripts/dedupe-artists.ts
git commit -m "feat: merge duplicated albums/tracks for the 3 severe artist groups

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: 実行(`--execute`)と事後確認

**Files:**
- なし(既存の`scripts/dedupe-artists.ts`を実行するのみ)

- [ ] **Step 1: 深刻3組それぞれについて、実行前のtrack総数を記録しておく**

Run(Supabaseで直接確認、または`mcp__claude_ai_Supabase__execute_sql`で):
```sql
select a.name, count(distinct t.title) as expected_track_titles_after_merge
from artist a join track t on t.artist_id = a.id
where a.name in ('スガ シカオ', '坂本冬美', 'ワン・ダイレクション')
group by a.name;
```
この`count(distinct t.title)`に近い件数が、統合後の本体アーティストのtrack数になるはず(タイトルが完全に一致しないトラックは別途残るため、多少上振れする)。

- [ ] **Step 2: `--execute`を実行する**

Run: `npx tsx --env-file=.env.local scripts/dedupe-artists.ts --execute`
Expected: Task 6までと同じログが出力され、末尾の`[dry-run] 書き込みは行っていません。`という文言が出ないこと(`DRY_RUN`が`false`のときは空文字列になる)。

- [ ] **Step 3: 深刻3組が正しく1行に統合されたことを確認する**

Run(Supabaseで直接確認):
```sql
select name, count(*) from artist where name in ('スガ シカオ', '坂本冬美', 'ワン・ダイレクション') group by name;
```
Expected: いずれも`count = 1`。

- [ ] **Step 4: 本体アーティストページが正しく表示されることを確認する**

本体アーティストの`id`で`https://music-synapse.vercel.app/artists/{id}`(または開発サーバー)にアクセスし、Discographyタブでアルバム数・曲数が統合前より減っていない(むしろ重複が無くなって適切な件数になっている)ことを目視確認する。

- [ ] **Step 5: 削除された重複artist_idが404になることを確認する**

Task 7 Step 1より前に控えておいた重複側の`artist_id`のいずれかで`/artists/{id}`にアクセスし、404になることを確認する。

- [ ] **Step 6: 空スタブ49組が正しく1行ずつになったことを確認する**

Run(Supabaseで直接確認):
```sql
select count(*) as remaining_duplicate_groups
from (select name from artist group by name having count(*) > 1) x
where name not in (
  -- ユニーク率0.2以上の中間的な重複(今回のスコープ外)はここでは除外しない。
  -- 単純に「深刻3組・空スタブ49組が本当に1行になったか」だけを見る目的のクエリ
  select name from artist a join track t on t.artist_id = a.id
  group by a.name
  having count(distinct t.title)::numeric / nullif(count(t.id), 0) >= 0.2
);
```
Expected: 実行前の52組から、深刻3組・空スタブ49組の分が減っていること(0件になっていれば全て統合成功。中間的な重複23組は対象外なのでこのクエリの結果に含まれたままでよい)。

- [ ] **Step 7: `npm test`が全て通ることを確認してからCommitする**

Run: `npm test`
Expected: 全テストpass(このタスクではコードの変更は無いため、実行結果の確認のみ。コミットするものは無い)。
