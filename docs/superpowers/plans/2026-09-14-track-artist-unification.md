# トラック/アルバムの名義統一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** フィーチャリング曲が異なるアーティストの下に別々のtrack/album行として重複登録されている問題を、既存データの統合(track_artist/album_artist経由での多アーティスト紐付け)と、今後のインポート処理での再発防止の両方で解決する。

**Architecture:** 純粋なロジック(グループ検出・本体選定・表示順決定)は`utils/`に切り出してユニットテストする。DBへの読み書きは`scripts/unify-track-artist-credits.ts`が担い、`--dry-run`(既定、書き込みなし)で内容を確認してから`--execute`で実際の統合・削除を行う(2026-09-12のアーティスト重複統合プロジェクトと同じ安全設計)。今後の再発防止は、実際のインポート処理(`app/admin/import/actions.ts`の`syncOneAlbum`)にガードを追加する形で行う。

**Tech Stack:** TypeScript(`tsx`実行)、Supabase JS Client(admin/service role)、`node:test`によるユニットテスト、Next.js Server Actions。

**Spec:** `docs/superpowers/specs/2026-09-14-track-artist-unification-design.md`

## Global Constraints

- 対象はtrack.titleが"feat"(大文字小文字区別なし)を含むトラックのみ(非ゴール: それ以外の名義違い重複)。
- マッチングは主に`apple_music_track_id`(album側は`apple_music_album_id`)の完全一致。これが片側でも無い場合のみ、title・album title・track_no・duration_secondsの完全一致にフォールバックする。あいまい一致は行わない。
- 同一artist_id内に一致する行が複数ある場合はそのグループを丸ごとスキップし、dry-runレポートに一覧化する(推測で統合しない)。
- `track.artist_id`・`album.artist_id`は変更しない(既存の全ページ・クエリの動作を変えないため)。多アーティスト紐付けは`track_artist`/`album_artist`経由でのみ行う。
- 実行は必ず`--dry-run`(既定)でレポートを確認してから`--execute`で行う。
- 1グループの処理失敗が他グループに影響しないようにする(グループ単位でtry/catch)。
- 外部キー付け替えの対象テーブル一覧は、2026-09-14に本番Supabaseの`information_schema`を直接クエリして確定したもの(下記「参照元テーブル一覧」)を使う。

## 参照元テーブル一覧(2026-09-14、`information_schema`で確認済み)

### `album.id`を参照するテーブル(重複album削除前に使う)

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
track.album_id
```

### `track.id`を参照するテーブル(重複track削除前に使う)

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

### 補足: track_artist / album_artist のユニーク制約(2026-09-14確認済み)

- `album_artist`には`UNIQUE(album_id, artist_id)`制約がある。書き込み時は既存行の有無を確認してから挿入すること(重複挿入は制約違反になる)。
- `track_artist`には`(track_id, artist_id)`のユニーク制約が**無い**(idの主キーのみ)。DB制約に頼れないため、挿入前に必ずアプリ側で既存行の有無を確認すること。

---

### Task 1: グループ検出ロジック(純粋関数)

**Files:**
- Create: `utils/trackCreditMatching.ts`
- Test: `__tests__/track-credit-matching.unit.test.ts`

**Interfaces:**
- Produces: `export type TrackCreditRow = { id: string; artistId: string; appleMusicTrackId: string | null; title: string; albumId: string; albumTitle: string; trackNo: number | null; durationSeconds: number | null }`、`export type CreditGroup = { rows: TrackCreditRow[] }`、`export type GroupResult = { groups: CreditGroup[]; ambiguousKeys: string[] }`、`export function groupTrackCredits(rows: TrackCreditRow[]): GroupResult`。Task 2・4で使う。

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/track-credit-matching.unit.test.ts
//
// フィーチャリング曲が複数アーティストに分散している行を、apple_music_track_id
// (優先)またはtitle+albumTitle+trackNo+durationSecondsの完全一致でグループ化する
// 純粋関数のテスト。同一artist_id内に一致行が複数ある場合はあいまいとして
// スキップする。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { groupTrackCredits, type TrackCreditRow } from '../utils/trackCreditMatching.ts'

function row(overrides: Partial<TrackCreditRow> & { id: string; artistId: string }): TrackCreditRow {
  return {
    appleMusicTrackId: null,
    title: 'Song',
    albumId: 'alb-1',
    albumTitle: 'Album',
    trackNo: 1,
    durationSeconds: 200,
    ...overrides,
  }
}

describe('groupTrackCredits', () => {
  test('groups two rows sharing the same apple_music_track_id across different artists', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: '999' }),
      row({ id: 't2', artistId: 'a2', appleMusicTrackId: '999' }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 1)
    assert.deepEqual(
      result.groups[0].rows.map((r) => r.id).sort(),
      ['t1', 't2']
    )
    assert.deepEqual(result.ambiguousKeys, [])
  })

  test('does not group rows from the same artist_id even if apple_music_track_id matches', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: '999' }),
      row({ id: 't2', artistId: 'a1', appleMusicTrackId: '999' }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 0)
    assert.equal(result.ambiguousKeys.length, 1)
  })

  test('falls back to title+albumTitle+trackNo+durationSeconds when apple_music_track_id is null', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: null, title: 'Duet', albumTitle: 'LP', trackNo: 3, durationSeconds: 180 }),
      row({ id: 't2', artistId: 'a2', appleMusicTrackId: null, title: 'Duet', albumTitle: 'LP', trackNo: 3, durationSeconds: 180 }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 1)
    assert.deepEqual(
      result.groups[0].rows.map((r) => r.id).sort(),
      ['t1', 't2']
    )
  })

  test('fallback still matches when trackNo is null on both sides (field dropped from comparison)', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: null, title: 'Duet', albumTitle: 'LP', trackNo: null, durationSeconds: 180 }),
      row({ id: 't2', artistId: 'a2', appleMusicTrackId: null, title: 'Duet', albumTitle: 'LP', trackNo: null, durationSeconds: 180 }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 1)
  })

  test('does not cross-match a row with apple_music_track_id against a row without one, even with identical title/album', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: '999', title: 'Duet', albumTitle: 'LP', trackNo: 3, durationSeconds: 180 }),
      row({ id: 't2', artistId: 'a2', appleMusicTrackId: null, title: 'Duet', albumTitle: 'LP', trackNo: 3, durationSeconds: 180 }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 0)
  })

  test('a group of 3 distinct artists forms a single group', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: '999' }),
      row({ id: 't2', artistId: 'a2', appleMusicTrackId: '999' }),
      row({ id: 't3', artistId: 'a3', appleMusicTrackId: '999' }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 1)
    assert.equal(result.groups[0].rows.length, 3)
  })

  test('a single row (no cross-artist duplicate) produces no group', () => {
    const rows = [row({ id: 't1', artistId: 'a1', appleMusicTrackId: '999' })]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 0)
    assert.equal(result.ambiguousKeys.length, 0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --env-file-if-exists=.env.local --test __tests__/track-credit-matching.unit.test.ts`
Expected: FAIL — `Cannot find module '../utils/trackCreditMatching.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// utils/trackCreditMatching.ts
//
// フィーチャリング曲が異なるartist_idに分散登録されている行を検出する純粋関数。
// apple_music_track_idが両側にあればそれを優先(最も確実な外部ID一致)、
// 無ければtitle+albumTitle+trackNo+durationSecondsの完全一致にフォールバックする。
// 同一artist_id内に一致行が複数ある場合(同名異版等)は推測せず「あいまい」として
// スキップする。docs/superpowers/specs/2026-09-14-track-artist-unification-design.md
// 「検出・マッチング基準」参照。

export type TrackCreditRow = {
  id: string
  artistId: string
  appleMusicTrackId: string | null
  title: string
  albumId: string
  albumTitle: string
  trackNo: number | null
  durationSeconds: number | null
}

export type CreditGroup = { rows: TrackCreditRow[] }
export type GroupResult = { groups: CreditGroup[]; ambiguousKeys: string[] }

function fallbackKey(r: TrackCreditRow): string {
  return `${r.title} ${r.albumTitle} ${r.trackNo ?? ''} ${r.durationSeconds ?? ''}`
}

function buildGroups(rows: TrackCreditRow[], keyOf: (r: TrackCreditRow) => string): GroupResult {
  const byKey = new Map<string, TrackCreditRow[]>()
  for (const r of rows) {
    const list = byKey.get(keyOf(r)) ?? []
    list.push(r)
    byKey.set(keyOf(r), list)
  }

  const groups: CreditGroup[] = []
  const ambiguousKeys: string[] = []
  for (const [key, groupRows] of byKey) {
    const distinctArtists = new Set(groupRows.map((r) => r.artistId))
    if (distinctArtists.size < 2) continue // 単独artist内の重複や単一行はこの関数の対象外
    const artistCounts = new Map<string, number>()
    for (const r of groupRows) {
      artistCounts.set(r.artistId, (artistCounts.get(r.artistId) ?? 0) + 1)
    }
    const hasSameArtistDuplicate = [...artistCounts.values()].some((c) => c > 1)
    if (hasSameArtistDuplicate) {
      ambiguousKeys.push(key)
      continue
    }
    groups.push({ rows: groupRows })
  }
  return { groups, ambiguousKeys }
}

export function groupTrackCredits(rows: TrackCreditRow[]): GroupResult {
  const withAppleId = rows.filter((r) => r.appleMusicTrackId !== null)
  const withoutAppleId = rows.filter((r) => r.appleMusicTrackId === null)

  const primary = buildGroups(withAppleId, (r) => `apple:${r.appleMusicTrackId}`)
  const fallback = buildGroups(withoutAppleId, fallbackKey)

  return {
    groups: [...primary.groups, ...fallback.groups],
    ambiguousKeys: [...primary.ambiguousKeys, ...fallback.ambiguousKeys],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --env-file-if-exists=.env.local --test __tests__/track-credit-matching.unit.test.ts`
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add utils/trackCreditMatching.ts __tests__/track-credit-matching.unit.test.ts
git commit -m "feat: add cross-artist track-credit group detection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 本体(canonical)選定ロジック

**Files:**
- Create: `utils/trackCreditCanonical.ts`
- Test: `__tests__/track-credit-canonical.unit.test.ts`

**Interfaces:**
- Consumes: `TrackCreditRow`(Task 1)。
- Produces: `export type EnrichmentFields = { youtubeVideoId: string | null; previewUrl: string | null; appleMusicTrackId: string | null; spotifyTrackId: string | null; youtubeMusicTrackId: string | null; amazonMusicTrackId: string | null; lyricUrl: string | null; trackReview: string | null }`、`export type CanonicalCandidate = { id: string; artistId: string; enrichment: EnrichmentFields }`、`export function pickCanonicalTrack(candidates: CanonicalCandidate[]): CanonicalCandidate`(空配列はErrorを投げる)。Task 4で使う。

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/track-credit-canonical.unit.test.ts
//
// 重複track候補の中から、非nullの補完可能フィールド数が最も多い行を本体として
// 選ぶ純粋関数のテスト。同数の場合はidの文字列比較で決定的に選ぶ。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { pickCanonicalTrack, type CanonicalCandidate, type EnrichmentFields } from '../utils/trackCreditCanonical.ts'

function enrichment(overrides: Partial<EnrichmentFields> = {}): EnrichmentFields {
  return {
    youtubeVideoId: null,
    previewUrl: null,
    appleMusicTrackId: null,
    spotifyTrackId: null,
    youtubeMusicTrackId: null,
    amazonMusicTrackId: null,
    lyricUrl: null,
    trackReview: null,
    ...overrides,
  }
}

describe('pickCanonicalTrack', () => {
  test('picks the candidate with the most non-null enrichment fields', () => {
    const result = pickCanonicalTrack([
      { id: 'c1', artistId: 'a1', enrichment: enrichment({ previewUrl: 'x' }) },
      { id: 'c2', artistId: 'a2', enrichment: enrichment({ previewUrl: 'x', youtubeVideoId: 'y', lyricUrl: 'z' }) },
    ])
    assert.equal(result.id, 'c2')
  })

  test('falls back to lexicographically smallest id when field counts tie', () => {
    const result = pickCanonicalTrack([
      { id: 'zzz', artistId: 'a1', enrichment: enrichment({ previewUrl: 'x' }) },
      { id: 'aaa', artistId: 'a2', enrichment: enrichment({ previewUrl: 'y' }) },
    ])
    assert.equal(result.id, 'aaa')
  })

  test('treats all-null enrichment as zero and still resolves deterministically', () => {
    const result = pickCanonicalTrack([
      { id: 'b', artistId: 'a1', enrichment: enrichment() },
      { id: 'a', artistId: 'a2', enrichment: enrichment() },
    ])
    assert.equal(result.id, 'a')
  })

  test('throws on an empty candidate list', () => {
    assert.throws(() => pickCanonicalTrack([]))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --env-file-if-exists=.env.local --test __tests__/track-credit-canonical.unit.test.ts`
Expected: FAIL — `Cannot find module '../utils/trackCreditCanonical.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// utils/trackCreditCanonical.ts
//
// 重複track候補の中から、非nullの補完可能フィールド数が最も多い行を本体として
// 選ぶ純粋関数。docs/superpowers/specs/2026-09-14-track-artist-unification-design.md
// 「本体(canonical)track/albumの選定」参照。

export type EnrichmentFields = {
  youtubeVideoId: string | null
  previewUrl: string | null
  appleMusicTrackId: string | null
  spotifyTrackId: string | null
  youtubeMusicTrackId: string | null
  amazonMusicTrackId: string | null
  lyricUrl: string | null
  trackReview: string | null
}

export type CanonicalCandidate = { id: string; artistId: string; enrichment: EnrichmentFields }

function nonNullCount(e: EnrichmentFields): number {
  return Object.values(e).filter((v) => v !== null && v !== '').length
}

export function pickCanonicalTrack(candidates: CanonicalCandidate[]): CanonicalCandidate {
  if (candidates.length === 0) {
    throw new Error('pickCanonicalTrack: candidates は1件以上必要です')
  }
  return [...candidates].sort((a, b) => {
    const diff = nonNullCount(b.enrichment) - nonNullCount(a.enrichment)
    if (diff !== 0) return diff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })[0]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --env-file-if-exists=.env.local --test __tests__/track-credit-canonical.unit.test.ts`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add utils/trackCreditCanonical.ts __tests__/track-credit-canonical.unit.test.ts
git commit -m "feat: add canonical-track selection logic for credit unification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: 表示順(billing_order)決定ロジック

**Files:**
- Create: `utils/featuringBillingOrder.ts`
- Test: `__tests__/featuring-billing-order.unit.test.ts`

**Interfaces:**
- Produces: `export type BillingCandidate = { artistId: string; artistName: string; richnessScore: number }`、`export type BillingResult = { artistId: string; role: 'primary' | 'featuring'; billingOrder: number }[]`、`export function extractFeaturedNames(title: string): string[] | null`(feat.部分を抽出できなければnull)、`export function determineBillingOrder(title: string, candidates: BillingCandidate[]): BillingResult`。Task 4で使う。

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/featuring-billing-order.unit.test.ts
//
// トラックタイトルから"(feat. A, B)"/"[feat. A, B]"を抽出し、グループ内の
// アーティスト名のうち抽出結果に含まれないものを本体(primary)、含まれるものを
// featuringとして表示順を決める純粋関数のテスト。抽出できない・名前が
// 一致しない場合は、richnessScore(カタログの豊富さ)の降順で本体を決める。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { extractFeaturedNames, determineBillingOrder, type BillingCandidate } from '../utils/featuringBillingOrder.ts'

describe('extractFeaturedNames', () => {
  test('extracts a single featured name from parentheses', () => {
    assert.deepEqual(extractFeaturedNames('Song (feat. Dan Hicks)'), ['Dan Hicks'])
  })

  test('extracts multiple comma/ampersand-separated names from brackets', () => {
    assert.deepEqual(extractFeaturedNames('Song [feat. Will Bernard & Robert Walter]'), ['Will Bernard', 'Robert Walter'])
  })

  test('extracts 3+ names mixing comma and ampersand', () => {
    assert.deepEqual(
      extractFeaturedNames('Song (feat. A, B & C)'),
      ['A', 'B', 'C']
    )
  })

  test('returns null when the title has no feat. pattern', () => {
    assert.equal(extractFeaturedNames('Plain Song Title'), null)
  })
})

describe('determineBillingOrder', () => {
  test('uses feat. parsing when an artist name in the group matches the extracted list', () => {
    const candidates: BillingCandidate[] = [
      { artistId: 'a1', artistName: 'The Christmas Jug Band', richnessScore: 1 },
      { artistId: 'a2', artistName: 'Dan Hicks', richnessScore: 5 },
    ]
    const result = determineBillingOrder('Under the Mistletoe (feat. Dan Hicks)', candidates)
    assert.deepEqual(result, [
      { artistId: 'a1', role: 'primary', billingOrder: 1 },
      { artistId: 'a2', role: 'featuring', billingOrder: 2 },
    ])
  })

  test('falls back to richnessScore descending when no group artist name matches the extracted feat. list', () => {
    const candidates: BillingCandidate[] = [
      { artistId: 'a1', artistName: 'ナイル・ロジャース', richnessScore: 3 },
      { artistId: 'a2', artistName: 'シック', richnessScore: 9 },
    ]
    const result = determineBillingOrder('"New Jack" Sober (feat. Craig David & Stefflon Don)', candidates)
    assert.deepEqual(result, [
      { artistId: 'a2', role: 'primary', billingOrder: 1 },
      { artistId: 'a1', role: 'featuring', billingOrder: 2 },
    ])
  })

  test('falls back to id string comparison when richnessScore also ties', () => {
    const candidates: BillingCandidate[] = [
      { artistId: 'z1', artistName: 'X', richnessScore: 1 },
      { artistId: 'a1', artistName: 'Y', richnessScore: 1 },
    ]
    const result = determineBillingOrder('Plain Title', candidates)
    assert.deepEqual(result, [
      { artistId: 'a1', role: 'primary', billingOrder: 1 },
      { artistId: 'z1', role: 'featuring', billingOrder: 2 },
    ])
  })

  test('orders 3+ featuring artists by their order of appearance in the extracted list', () => {
    const candidates: BillingCandidate[] = [
      { artistId: 'a-c', artistName: 'C', richnessScore: 1 },
      { artistId: 'a-main', artistName: 'Main Act', richnessScore: 1 },
      { artistId: 'a-b', artistName: 'B', richnessScore: 1 },
    ]
    const result = determineBillingOrder('Song (feat. B, C)', candidates)
    assert.deepEqual(result, [
      { artistId: 'a-main', role: 'primary', billingOrder: 1 },
      { artistId: 'a-b', role: 'featuring', billingOrder: 2 },
      { artistId: 'a-c', role: 'featuring', billingOrder: 3 },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --env-file-if-exists=.env.local --test __tests__/featuring-billing-order.unit.test.ts`
Expected: FAIL — `Cannot find module '../utils/featuringBillingOrder.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// utils/featuringBillingOrder.ts
//
// トラックタイトルから"(feat. A, B)"/"[feat. A, B]"パターンを抽出し、
// グループ内アーティストの表示順(billing_order)を決める純粋関数。
// docs/superpowers/specs/2026-09-14-track-artist-unification-design.md
// 「表示順(billing_order)の決定」参照。表示順は安全性(データ損失)に
// 影響しないため、抽出できない場合はベストエフォートでrichnessScore→id文字列
// 比較にフォールバックする(推測してよい数少ない箇所)。

const FEAT_PATTERN = /[([]feat\.?\s+([^)\]]+)[)\]]/i

export function extractFeaturedNames(title: string): string[] | null {
  const match = title.match(FEAT_PATTERN)
  if (!match) return null
  const inner = match[1]
  // "A, B & C" のようなカンマ・アンパサンド混在を分割する
  return inner
    .split(/,|&/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export type BillingCandidate = { artistId: string; artistName: string; richnessScore: number }
export type BillingEntry = { artistId: string; role: 'primary' | 'featuring'; billingOrder: number }

export function determineBillingOrder(title: string, candidates: BillingCandidate[]): BillingEntry[] {
  const featuredNames = extractFeaturedNames(title)

  if (featuredNames) {
    const featuredSet = new Set(featuredNames.map((n) => n.trim()))
    const nonFeatured = candidates.filter((c) => !featuredSet.has(c.artistName.trim()))
    const featured = candidates.filter((c) => featuredSet.has(c.artistName.trim()))

    // グループ内の誰か1名だけがfeat.リストの「外」にいる場合のみ、タイトル解析による
    // 判定を信頼する(0名または全員がfeat.リストに含まれる場合は判定材料にならない)
    if (nonFeatured.length === 1 && featured.length === candidates.length - 1) {
      const primary = nonFeatured[0]
      const orderedFeatured = [...featured].sort(
        (a, b) => featuredNames.indexOf(a.artistName.trim()) - featuredNames.indexOf(b.artistName.trim())
      )
      return [
        { artistId: primary.artistId, role: 'primary', billingOrder: 1 },
        ...orderedFeatured.map((c, i) => ({ artistId: c.artistId, role: 'featuring' as const, billingOrder: i + 2 })),
      ]
    }
  }

  // フォールバック: richnessScore降順、同点ならid文字列比較
  const sorted = [...candidates].sort((a, b) => {
    if (b.richnessScore !== a.richnessScore) return b.richnessScore - a.richnessScore
    return a.artistId < b.artistId ? -1 : a.artistId > b.artistId ? 1 : 0
  })
  return sorted.map((c, i) => ({
    artistId: c.artistId,
    role: i === 0 ? 'primary' : 'featuring',
    billingOrder: i + 1,
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --env-file-if-exists=.env.local --test __tests__/featuring-billing-order.unit.test.ts`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add utils/featuringBillingOrder.ts __tests__/featuring-billing-order.unit.test.ts
git commit -m "feat: add feat.-title parsing and billing-order logic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: グループ発見 + dry-runレポート(書き込みなし)

**Files:**
- Create: `scripts/unify-track-artist-credits.ts`

**Interfaces:**
- Consumes: `groupTrackCredits`/`TrackCreditRow`(Task 1)、`pickCanonicalTrack`/`CanonicalCandidate`(Task 2)、`determineBillingOrder`/`BillingCandidate`(Task 3)。
- Produces: dry-run専用のレポート出力のみ(後続タスクで`--execute`を追加する)。`main()`という名前のエントリポイント関数をこのファイルの末尾に持つ(Task 5がこのファイルを直接拡張する)。

- [ ] **Step 1: スクリプトを作成する**

```ts
// scripts/unify-track-artist-credits.ts
//
// track.titleに"feat"を含み、apple_music_track_id(または title+album title+
// track_no+duration_secondsのフォールバック)が一致するにもかかわらず異なる
// artist_idに分散しているトラックを、track_artist/album_artist経由の統合に
// まとめる。docs/superpowers/specs/2026-09-14-track-artist-unification-design.md参照。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/unify-track-artist-credits.ts --dry-run   (既定、書き込みなし)
//   npx tsx --env-file=.env.local scripts/unify-track-artist-credits.ts --execute
import { createAdminClient } from '@/utils/Supabase/admin'
import { groupTrackCredits, type TrackCreditRow } from '@/utils/trackCreditMatching'
import { pickCanonicalTrack, type CanonicalCandidate } from '@/utils/trackCreditCanonical'
import { determineBillingOrder, type BillingCandidate } from '@/utils/featuringBillingOrder'

type AdminClient = ReturnType<typeof createAdminClient>

type RawTrackRow = {
  id: string
  artist_id: string
  apple_music_track_id: string | null
  title: string
  album_id: string
  track_no: number | null
  duration_seconds: number | null
  youtube_video_id: string | null
  preview_url: string | null
  spotify_track_id: string | null
  youtube_music_track_id: string | null
  amazon_music_track_id: string | null
  lyric_url: string | null
  track_review: string | null
}

// "feat"を含むtrackは6万件超あるため、PostgRESTの1リクエストあたり行数上限
// (既定1000件)を超える。utils/fetchAllRows.tsと同じ理由でrange()ページングする
// (このプロジェクトで繰り返し発生している既知の不具合パターン)
async function fetchFeaturingTracks(supabase: AdminClient): Promise<RawTrackRow[]> {
  const rows: RawTrackRow[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('track')
      .select(
        'id, artist_id, apple_music_track_id, title, album_id, track_no, duration_seconds, youtube_video_id, preview_url, spotify_track_id, youtube_music_track_id, amazon_music_track_id, lyric_url, track_review'
      )
      .ilike('title', '%feat%')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`fetchFeaturingTracks: ${error.message}`)
    const page = (data ?? []) as RawTrackRow[]
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function fetchAlbumTitles(supabase: AdminClient, albumIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const uniqueIds = [...new Set(albumIds)]
  for (let i = 0; i < uniqueIds.length; i += 500) {
    const chunk = uniqueIds.slice(i, i + 500)
    const { data, error } = await supabase.from('album').select('id, title').in('id', chunk)
    if (error) throw new Error(`fetchAlbumTitles: ${error.message}`)
    for (const row of data ?? []) map.set(row.id, row.title)
  }
  return map
}

async function fetchArtistNames(supabase: AdminClient, artistIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const uniqueIds = [...new Set(artistIds)]
  for (let i = 0; i < uniqueIds.length; i += 500) {
    const chunk = uniqueIds.slice(i, i + 500)
    const { data, error } = await supabase.from('artist').select('id, name').in('id', chunk)
    if (error) throw new Error(`fetchArtistNames: ${error.message}`)
    for (const row of data ?? []) map.set(row.id, row.name)
  }
  return map
}

function toCreditRow(r: RawTrackRow, albumTitles: Map<string, string>): TrackCreditRow {
  return {
    id: r.id,
    artistId: r.artist_id,
    appleMusicTrackId: r.apple_music_track_id,
    title: r.title,
    albumId: r.album_id,
    albumTitle: albumTitles.get(r.album_id) ?? '',
    trackNo: r.track_no,
    durationSeconds: r.duration_seconds,
  }
}

function toCanonicalCandidate(r: RawTrackRow): CanonicalCandidate {
  return {
    id: r.id,
    artistId: r.artist_id,
    enrichment: {
      youtubeVideoId: r.youtube_video_id,
      previewUrl: r.preview_url,
      appleMusicTrackId: r.apple_music_track_id,
      spotifyTrackId: r.spotify_track_id,
      youtubeMusicTrackId: r.youtube_music_track_id,
      amazonMusicTrackId: r.amazon_music_track_id,
      lyricUrl: r.lyric_url,
      trackReview: r.track_review,
    },
  }
}

const DRY_RUN = !process.argv.includes('--execute')

async function main() {
  const supabase = createAdminClient()

  console.log('"feat"を含むトラックを取得中...')
  const rawRows = await fetchFeaturingTracks(supabase)
  console.log(`  ${rawRows.length}件取得しました`)

  const albumTitles = await fetchAlbumTitles(supabase, rawRows.map((r) => r.album_id))
  const artistNames = await fetchArtistNames(supabase, rawRows.map((r) => r.artist_id))
  const rawById = new Map(rawRows.map((r) => [r.id, r]))

  const creditRows = rawRows.map((r) => toCreditRow(r, albumTitles))
  const { groups, ambiguousKeys } = groupTrackCredits(creditRows)
  const totalRowsInvolved = groups.reduce((sum, g) => sum + g.rows.length, 0)
  const totalAlbumsInvolved = new Set(groups.flatMap((g) => g.rows.map((r) => r.albumId))).size

  console.log(
    `\n対象グループ: ${groups.length}件(関与track行: ${totalRowsInvolved}件、関与album行: ${totalAlbumsInvolved}件)、あいまいでスキップ: ${ambiguousKeys.length}件\n`
  )

  let feetParsedCount = 0
  let fallbackOrderCount = 0

  for (const group of groups) {
    const candidates: CanonicalCandidate[] = group.rows.map((r) => toCanonicalCandidate(rawById.get(r.id)!))
    const canonical = pickCanonicalTrack(candidates)
    const runnerUp = candidates.length > 1 ? pickCanonicalTrack(candidates.filter((c) => c.id !== canonical.id)) : null
    const canonicalCount = Object.values(canonical.enrichment).filter((v) => v !== null && v !== '').length
    const runnerUpCount = runnerUp ? Object.values(runnerUp.enrichment).filter((v) => v !== null && v !== '').length : 0
    const reason =
      !runnerUp || canonicalCount !== runnerUpCount
        ? `補完フィールド数最大(${canonicalCount}件)`
        : 'id文字列比較で決定'

    const billingCandidates: BillingCandidate[] = group.rows.map((r) => ({
      artistId: r.artistId,
      artistName: artistNames.get(r.artistId) ?? r.artistId,
      richnessScore: candidates.find((c) => c.artistId === r.artistId) === canonical ? 1 : 0,
    }))
    const billing = determineBillingOrder(group.rows[0].title, billingCandidates)

    // 表示順がタイトル解析(feat.パターン)で決まったか、フォールバック
    // (richnessScore→id比較)で決まったかを、determineBillingOrderの内部条件と
    // 同じ判定式で再現して集計する(dry-runレポートの必須報告項目)
    const featuredNames = extractFeaturedNames(group.rows[0].title)
    const nonFeaturedCandidateCount = featuredNames
      ? billingCandidates.filter((c) => !featuredNames.includes(c.artistName.trim())).length
      : 0
    const usedFeatParsing = featuredNames !== null && nonFeaturedCandidateCount === 1
    if (usedFeatParsing) feetParsedCount++
    else fallbackOrderCount++

    console.log(`=== ${group.rows[0].title} ===`)
    console.log(`  本体track: ${canonical.id}(artist_id=${canonical.artistId}) — 選定理由: ${reason}`)
    console.log(
      `  表示順(${usedFeatParsing ? 'タイトル解析' : 'フォールバック'}): ${billing.map((b) => `${artistNames.get(b.artistId) ?? b.artistId}(${b.role}, order=${b.billingOrder})`).join(' / ')}`
    )
  }

  console.log(`\n表示順の決定方法: タイトル解析${feetParsedCount}件 / フォールバック${fallbackOrderCount}件`)

  if (ambiguousKeys.length > 0) {
    console.log(`\n⚠️ あいまいでスキップしたグループキー(全${ambiguousKeys.length}件): ${ambiguousKeys.join(', ')}`)
  }

  console.log(`\n${DRY_RUN ? '[dry-run] 書き込みは行っていません。' : ''}`)
}

main()
```

`extractFeaturedNames`を使うため、`import`ブロックに追加する:

```ts
import { determineBillingOrder, extractFeaturedNames, type BillingCandidate } from '@/utils/featuringBillingOrder'
```

(既存の`import { determineBillingOrder, type BillingCandidate } from '@/utils/featuringBillingOrder'`をこの行で置き換える)

- [ ] **Step 2: 動作確認(dry-runで実データに対して実行し、レポートを目視確認する)**

Run: `npx tsx --env-file=.env.local scripts/unify-track-artist-credits.ts --dry-run`
Expected: 「対象グループ: 3736件(関与track行: 9683件...)」前後(調査時点の件数。データ更新により多少増減してよい)、「Under the Mistletoe (feat. Dan Hicks)」等の実例で本体trackと選定理由・表示順が妥当に出力されることを目視確認する。billingCandidatesの`richnessScore`は暫定的に「本体候補なら1、それ以外は0」という単純な扱いにしている点に注意(Task 3のフォールバック順位づけをテストする目的のみで、実際のenrichmentフィールド数そのものではない — Task 5でこの部分をより正確な値に置き換える)。

- [ ] **Step 3: Commit**

```bash
git add scripts/unify-track-artist-credits.ts
git commit -m "feat: add dry-run group discovery for track-credit unification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: 実際の統合処理(track_artist/album_artist作成・重複削除)

**Files:**
- Modify: `scripts/unify-track-artist-credits.ts`

**Interfaces:**
- Consumes: なし(Task 1-3の関数は既にTask 4で導入済み)。
- Produces: `main()`のループを拡張し、`--execute`時に実際の統合を行う。

- [ ] **Step 1: `import`に外部キー再ポイント処理を追加する**

`scripts/unify-track-artist-credits.ts`の`import`ブロックの末尾に追加する:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
```

- [ ] **Step 2: FK参照一覧・updateFk・統合関数を追加する**

`const DRY_RUN = ...`の直前に追加する:

```ts
// album.idを参照するテーブル一覧(2026-09-14、information_schemaで確認済み)
const ALBUM_FK_REFERENCES: { table: string; column: string }[] = [
  { table: 'album', column: 'primary_album_id' },
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

// track.idを参照するテーブル一覧(2026-09-14、information_schemaで確認済み)
const TRACK_FK_REFERENCES: { table: string; column: string }[] = [
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
  { table: 'track_credit', column: 'track_id' },
  { table: 'track_genre', column: 'track_id' },
  { table: 'track_instrument', column: 'track_id' },
  // track_artist.track_idはここでは扱わない(重複trackが持つtrack_artist行は
  // 通常無い前提だが、念のためmergeTrackArtistRows内で個別に確認・移設する)
]

async function repointFk(
  supabase: AdminClient,
  refs: { table: string; column: string }[],
  fromId: string,
  toId: string,
  execute: boolean
): Promise<{ table: string; column: string; error: string | null; movedCount: number }[]> {
  const outcomes: { table: string; column: string; error: string | null; movedCount: number }[] = []
  for (const ref of refs) {
    if (!execute) {
      const { count, error } = await supabase.from(ref.table).select('*', { count: 'exact', head: true }).eq(ref.column, fromId)
      outcomes.push({ table: ref.table, column: ref.column, error: error ? error.message : null, movedCount: count ?? 0 })
      continue
    }
    const { error, count } = await supabase.from(ref.table).update({ [ref.column]: toId }, { count: 'exact' }).eq(ref.column, fromId)
    outcomes.push({ table: ref.table, column: ref.column, error: error ? error.message : null, movedCount: count ?? 0 })
  }
  return outcomes
}

const TRACK_MERGE_FIELDS = [
  'youtube_video_id', 'preview_url', 'apple_music_track_id', 'spotify_track_id',
  'youtube_music_track_id', 'amazon_music_track_id', 'lyric_url', 'track_review',
] as const

/** 本体trackが持たないフィールドを重複trackの値で埋める(既存の値は上書きしない) */
async function fillTrackFields(supabase: AdminClient, canonicalId: string, duplicateRow: RawTrackRow, execute: boolean) {
  const patch: Record<string, unknown> = {}
  const filled: string[] = []
  const { data: canonicalRow, error } = await supabase.from('track').select(TRACK_MERGE_FIELDS.join(',')).eq('id', canonicalId).single()
  if (error || !canonicalRow) throw new Error(`fillTrackFields: 本体track取得失敗(${canonicalId}): ${error?.message}`)

  const canonical = canonicalRow as unknown as Record<string, unknown>
  const dup = duplicateRow as unknown as Record<string, unknown>
  for (const field of TRACK_MERGE_FIELDS) {
    const canonicalValue = canonical[field]
    const dupValue = dup[field]
    if ((canonicalValue === null || canonicalValue === '') && dupValue !== null && dupValue !== '') {
      patch[field] = dupValue
      filled.push(field)
    }
  }
  if (filled.length > 0 && execute) {
    const { error: updateError } = await supabase.from('track').update(patch).eq('id', canonicalId)
    if (updateError) throw new Error(`fillTrackFields: 本体track更新失敗(${canonicalId}): ${updateError.message}`)
  }
  return { filled }
}

/** track_artist行を作成する(既存の(track_id, artist_id)組があれば重複挿入しない。
 * track_artistにはこの組み合わせのユニーク制約が無いため、アプリ側で確認する) */
async function upsertTrackArtist(
  supabase: AdminClient,
  trackId: string,
  artistId: string,
  role: 'primary' | 'featuring',
  billingOrder: number,
  execute: boolean
): Promise<void> {
  const { data: existing, error: selectError } = await supabase
    .from('track_artist')
    .select('id')
    .eq('track_id', trackId)
    .eq('artist_id', artistId)
    .maybeSingle()
  if (selectError) throw new Error(`upsertTrackArtist: 既存確認失敗(${trackId}, ${artistId}): ${selectError.message}`)
  if (existing) return // 既に存在するので何もしない
  if (!execute) return
  const { error: insertError } = await supabase
    .from('track_artist')
    .insert({ track_id: trackId, artist_id: artistId, role, billing_order: billingOrder })
  if (insertError) throw new Error(`upsertTrackArtist: 挿入失敗(${trackId}, ${artistId}): ${insertError.message}`)
}

/** album_artist行を作成する(album_artistは(album_id, artist_id)にユニーク制約が
 * あるため、DBの制約違反を避けるためにも事前確認する) */
async function upsertAlbumArtist(
  supabase: AdminClient,
  albumId: string,
  artistId: string,
  role: 'primary' | 'featuring',
  billingOrder: number,
  execute: boolean
): Promise<void> {
  const { data: existing, error: selectError } = await supabase
    .from('album_artist')
    .select('id')
    .eq('album_id', albumId)
    .eq('artist_id', artistId)
    .maybeSingle()
  if (selectError) throw new Error(`upsertAlbumArtist: 既存確認失敗(${albumId}, ${artistId}): ${selectError.message}`)
  if (existing) return
  if (!execute) return
  const { error: insertError } = await supabase
    .from('album_artist')
    .insert({ album_id: albumId, artist_id: artistId, role, billing_order: billingOrder })
  if (insertError) throw new Error(`upsertAlbumArtist: 挿入失敗(${albumId}, ${artistId}): ${insertError.message}`)
}
```

- [ ] **Step 3: `main()`のループを、実際の統合を行うように拡張する**

`main()`内の、`for (const group of groups) {`で始まる行から、その後に続く`if (ambiguousKeys.length > 0) { ... }`ブロックまで(Task 4 Step 1で書いた`console.log(\`\n${DRY_RUN ? '[dry-run]...` の行は含まない、その直前まで)を、丸ごと次のブロックで置き換える:

```ts
  let succeeded = 0
  let failed = 0
  let feetParsedCount = 0
  let fallbackOrderCount = 0
  let trackArtistCreated = 0
  let albumArtistCreated = 0
  let tracksDeleted = 0
  let albumsDeleted = 0
  let fkRepointFailures = 0

  for (const group of groups) {
    try {
      const candidates: CanonicalCandidate[] = group.rows.map((r) => toCanonicalCandidate(rawById.get(r.id)!))
      const canonical = pickCanonicalTrack(candidates)
      const canonicalRawRow = rawById.get(canonical.id)!
      const runnerUp = candidates.length > 1 ? pickCanonicalTrack(candidates.filter((c) => c.id !== canonical.id)) : null
      const canonicalCount = Object.values(canonical.enrichment).filter((v) => v !== null && v !== '').length
      const runnerUpCount = runnerUp ? Object.values(runnerUp.enrichment).filter((v) => v !== null && v !== '').length : 0
      const reason =
        !runnerUp || canonicalCount !== runnerUpCount ? `補完フィールド数最大(${canonicalCount}件)` : 'id文字列比較で決定'

      const billingCandidates: BillingCandidate[] = group.rows.map((r) => {
        const c = candidates.find((c) => c.artistId === r.artistId)!
        const nonNullCount = Object.values(c.enrichment).filter((v) => v !== null && v !== '').length
        return { artistId: r.artistId, artistName: artistNames.get(r.artistId) ?? r.artistId, richnessScore: nonNullCount }
      })
      const billing = determineBillingOrder(group.rows[0].title, billingCandidates)

      const featuredNames = extractFeaturedNames(group.rows[0].title)
      const nonFeaturedCandidateCount = featuredNames
        ? billingCandidates.filter((c) => !featuredNames.includes(c.artistName.trim())).length
        : 0
      const usedFeatParsing = featuredNames !== null && nonFeaturedCandidateCount === 1
      if (usedFeatParsing) feetParsedCount++
      else fallbackOrderCount++

      console.log(`=== ${group.rows[0].title} ===`)
      console.log(`  本体track: ${canonical.id}(artist_id=${canonical.artistId}) — 選定理由: ${reason}`)

      // 本体trackへ、グループ内の全アーティストのtrack_artistを作成する
      for (const b of billing) {
        await upsertTrackArtist(supabase, canonical.id, b.artistId, b.role, b.billingOrder, !DRY_RUN)
        trackArtistCreated++
      }
      console.log(
        `  track_artist(${usedFeatParsing ? 'タイトル解析' : 'フォールバック'}): ${billing.map((b) => `${artistNames.get(b.artistId) ?? b.artistId}(${b.role}, order=${b.billingOrder})`).join(' / ')}`
      )

      // 本体albumへ、同じ表示順でalbum_artistを作成する(本体trackのalbum_idを基準にする)
      const canonicalAlbumId = canonicalRawRow.album_id
      for (const b of billing) {
        await upsertAlbumArtist(supabase, canonicalAlbumId, b.artistId, b.role, b.billingOrder, !DRY_RUN)
        albumArtistCreated++
      }

      // 重複track(本体以外)を、フィールド補完→FK付け替え→削除する
      for (const dupRow of group.rows) {
        if (dupRow.id === canonical.id) continue
        const dupRawRow = rawById.get(dupRow.id)!
        const { filled } = await fillTrackFields(supabase, canonical.id, dupRawRow, !DRY_RUN)
        if (filled.length > 0) console.log(`    補完(${dupRow.id} → ${canonical.id}): [${filled.join(', ')}]`)

        const fkOutcomes = await repointFk(supabase, TRACK_FK_REFERENCES, dupRow.id, canonical.id, !DRY_RUN)
        const failedFks = fkOutcomes.filter((o) => o.error !== null)
        if (failedFks.length > 0) {
          console.log(`    ⚠️ track(${dupRow.id})のFK付け替え失敗: ${failedFks.map((f) => `${f.table}.${f.column}(${f.error})`).join(', ')}`)
          console.log(`    ⚠️ 重複track(${dupRow.id})は削除しません`)
          fkRepointFailures++
          continue
        }
        if (!DRY_RUN) {
          const { error: deleteError } = await supabase.from('track').delete().eq('id', dupRow.id)
          if (deleteError) {
            console.log(`    ❌ 重複track(${dupRow.id})の削除に失敗しました: ${deleteError.message}`)
            continue
          }
        }
        tracksDeleted++

        // このtrackが属していた重複album(本体albumと異なる場合)を、収録trackが
        // 他に残っていなければ削除する
        const dupAlbumId = dupRawRow.album_id
        if (dupAlbumId === canonicalAlbumId) continue
        const { count: remainingTracks, error: countError } = await supabase
          .from('track')
          .select('id', { count: 'exact', head: true })
          .eq('album_id', dupAlbumId)
        if (countError) {
          console.log(`    ⚠️ album(${dupAlbumId})の残りtrack件数確認に失敗: ${countError.message}`)
          continue
        }
        if ((remainingTracks ?? 0) > 0) continue // 他のtrackが残っているアルバムは削除しない

        const albumFkOutcomes = await repointFk(supabase, ALBUM_FK_REFERENCES, dupAlbumId, canonicalAlbumId, !DRY_RUN)
        const failedAlbumFks = albumFkOutcomes.filter((o) => o.error !== null)
        if (failedAlbumFks.length > 0) {
          console.log(`    ⚠️ album(${dupAlbumId})のFK付け替え失敗: ${failedAlbumFks.map((f) => `${f.table}.${f.column}(${f.error})`).join(', ')}`)
          console.log(`    ⚠️ 重複album(${dupAlbumId})は削除しません`)
          fkRepointFailures++
          continue
        }
        if (!DRY_RUN) {
          const { error: albumDeleteError } = await supabase.from('album').delete().eq('id', dupAlbumId)
          if (albumDeleteError) {
            console.log(`    ❌ 重複album(${dupAlbumId})の削除に失敗しました: ${albumDeleteError.message}`)
            continue
          }
        }
        albumsDeleted++
        console.log(`    削除: album(${dupAlbumId})`)
      }
      succeeded++
    } catch (err) {
      console.log(`  ❌ このグループの処理に失敗しました: ${(err as Error).message}`)
      failed++
    }
  }

  if (ambiguousKeys.length > 0) {
    console.log(`\n⚠️ あいまいでスキップしたグループキー(全${ambiguousKeys.length}件): ${ambiguousKeys.join(', ')}`)
  }

  console.log(`\n=== サマリー ===`)
  console.log(`成功: ${succeeded}グループ、失敗: ${failed}グループ`)
  console.log(`表示順の決定方法: タイトル解析${feetParsedCount}件 / フォールバック${fallbackOrderCount}件`)
  console.log(`作成: track_artist ${trackArtistCreated}件、album_artist ${albumArtistCreated}件`)
  console.log(`削除: track ${tracksDeleted}件、album ${albumsDeleted}件`)
  console.log(`FK付け替え失敗: ${fkRepointFailures}件${fkRepointFailures > 0 ? '(該当行は削除されていません)' : ''}`)
```

`extractFeaturedNames`を使うため、Task 4 Step 1で追加した`import`が既にこのファイルに存在していることを確認する(`import { determineBillingOrder, extractFeaturedNames, type BillingCandidate } from '@/utils/featuringBillingOrder'`)。

`toCanonicalCandidate`の呼び出しが重複しないよう、Task 4で書いたレポート専用のループ(billingCandidatesを`richnessScore: candidates.find(...) === canonical ? 1 : 0`という簡易値で計算していた部分)は、上記の正確なenrichmentフィールド数ベースの計算に置き換わる形で完全に上書きされる。

- [ ] **Step 4: dry-runで再実行して確認する**

Run: `npx tsx --env-file=.env.local scripts/unify-track-artist-credits.ts --dry-run`
Expected: 各グループについてtrack_artist予定・補完予定フィールド・FK付け替え予定件数が表示され、末尾に「=== サマリー ===」ブロック(成功/失敗グループ数、表示順決定方法の内訳、作成予定のtrack_artist/album_artist件数、削除予定のtrack/album件数、FK付け替え失敗件数)が表示されること、書き込みが行われないことを確認する(dry-run実行後にDBの`track_artist`件数が変化していないことを直接SQLで確認する)。「Under the Mistletoe (feat. Dan Hicks)」の実例で、本体track1件・track_artist 5件相当が計画されることを確認する。

- [ ] **Step 5: Commit**

```bash
git add scripts/unify-track-artist-credits.ts
git commit -m "feat: implement track/album credit unification and duplicate cleanup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: 今後の再発防止(syncOneAlbumへのガード追加)

**Files:**
- Modify: `app/admin/import/actions.ts:220-362`(`syncOneAlbum`関数)

**Interfaces:**
- Consumes: なし(既存関数の内部ロジック変更のみ)。
- Produces: `syncOneAlbum`の外部シグネチャ・戻り値は変更しない(既存の4箇所の呼び出し元はそのまま動作する)。

- [ ] **Step 1: album作成前に、別アーティスト下の同一apple_music_album_idを確認するガードを追加する**

`app/admin/import/actions.ts`の`syncOneAlbum`内、`let albumId: string`から始まる既存ブロック(現在の226-288行目付近、`if (existingAlbumId) { ... } else { ... }`)を次のように置き換える:

```ts
  let albumId: string
  let createdAlbumArtistId: string | null = null
  if (existingAlbumId) {
    // album_typeは更新対象に含めない(手動修正が再同期のたびに上書きされないようにするため)
    albumId = existingAlbumId
    const { error: albumUpdateError } = await supabase.from('album').update(albumPayload).eq('id', albumId)
    if (albumUpdateError) {
      console.error('アルバム更新失敗:', itunesAlbum.collectionName, albumUpdateError.message)
    }
  } else {
    // 新規作成前に、同一apple_music_album_idを持つアルバムが既に「別の」
    // artist_idの下に存在しないか確認する(フィーチャリング曲のアルバムが
    // 参加アーティストごとに重複登録されるのを防ぐ。2026-09-14の調査で、
    // これを怠ったことが実際に多数の重複album/trackを生んでいたことを確認した)
    const { data: crossArtistAlbum, error: crossArtistError } = await supabase
      .from('album')
      .select('id, artist_id')
      .eq('apple_music_album_id', String(itunesAlbum.collectionId))
      .neq('artist_id', artistId)
      .maybeSingle()
    if (crossArtistError) {
      console.error('別アーティスト下の既存アルバム確認に失敗しました:', itunesAlbum.collectionName, crossArtistError.message)
    }

    if (crossArtistAlbum) {
      // 既存のアルバムを再利用し、このアーティストをalbum_artistとして追加する
      // (album.artist_idは変更しない。既存の全ページ・クエリの動作を変えないため)
      albumId = crossArtistAlbum.id
      createdAlbumArtistId = artistId
      const { error: albumUpdateError } = await supabase.from('album').update(albumPayload).eq('id', albumId)
      if (albumUpdateError) {
        console.error('アルバム更新失敗(既存アルバム再利用):', itunesAlbum.collectionName, albumUpdateError.message)
      }
    } else {
      const { data: insertedAlbum, error: albumError } = await supabase
        .from('album')
        .insert({ ...albumPayload, album_type: classifyAlbumType(title, itunesAlbum.trackCount ?? null) })
        .select('id')
        .single()

      if (albumError || !insertedAlbum) {
        console.error('アルバム登録失敗:', itunesAlbum.collectionName, albumError?.message)
        return 0
      }
      albumId = insertedAlbum.id
    }
  }

  if (createdAlbumArtistId) {
    const { data: existingAlbumArtist, error: albumArtistSelectError } = await supabase
      .from('album_artist')
      .select('id')
      .eq('album_id', albumId)
      .eq('artist_id', createdAlbumArtistId)
      .maybeSingle()
    if (albumArtistSelectError) {
      console.error('album_artist確認に失敗しました:', itunesAlbum.collectionName, albumArtistSelectError.message)
    } else if (!existingAlbumArtist) {
      const { count: existingCount } = await supabase
        .from('album_artist')
        .select('id', { count: 'exact', head: true })
        .eq('album_id', albumId)
      const { error: albumArtistInsertError } = await supabase
        .from('album_artist')
        .insert({ album_id: albumId, artist_id: createdAlbumArtistId, role: 'featuring', billing_order: (existingCount ?? 0) + 1 })
      if (albumArtistInsertError) {
        console.error('album_artist登録に失敗しました:', itunesAlbum.collectionName, albumArtistInsertError.message)
      }
    }
  }
```

- [ ] **Step 2: track作成側は既存の`album_id`スコープの既存判定のままでよいことを確認する**

`syncOneAlbum`のtrackループ(既存の`for (const itunesTrack of itunesTracks) { ... }`、apple_music_track_id + album_idでの既存判定)は変更不要である。Step 1のガードにより、フィーチャリング曲は既に本体のalbum_idへ同期されるようになるため、trackループの既存判定(apple_music_track_id + album_id)がそのまま正しく機能し、重複trackが作られなくなる。**このステップはコード変更なし、動作確認のみ**。

- [ ] **Step 3: 型チェックとテストを実行する**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: エラーなし

Run: `npm test`
Expected: 全テストpass(このタスクではテストの追加は無い。既存のディスクガイド関連の1件の失敗は無関係な既知の問題として無視してよい)

- [ ] **Step 4: Commit**

```bash
git add app/admin/import/actions.ts
git commit -m "fix: prevent duplicate album/track rows for featuring credits at import time

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: 未登録フィーチャリングアーティストのスタブ作成

**Files:**
- Modify: `app/admin/import/actions.ts`(`syncOneAlbum`内、track作成ブロック)

**Interfaces:**
- Consumes: `extractFeaturedNames`(Task 3、`@/utils/featuringBillingOrder`からimportする)。
- Produces: なし(内部ロジックのみ)。

- [ ] **Step 1: importを追加する**

`app/admin/import/actions.ts`の`import`ブロックに追加する:

```ts
import { extractFeaturedNames } from '@/utils/featuringBillingOrder'
```

- [ ] **Step 2: track新規作成時に、feat.パターンの未登録アーティストをスタブ作成する関数を追加する**

`syncOneAlbum`関数の直前に追加する:

```ts
/** track.titleが新規に"(feat. X)"パターンを含み、Xがまだartistテーブルに
 * 存在しない場合、名前のみの最小限スタブを作成してtrack_artistへ追加する
 * (既存のimport-nme-100.ts等と同じ「名前のみスタブ」パターンを踏襲)。
 * 既に存在する場合は既存のartist_idでtrack_artistへ追加するだけに留める。 */
async function linkOrStubFeaturedArtists(supabase: SupabaseClient, trackId: string, trackTitle: string): Promise<void> {
  const featuredNames = extractFeaturedNames(trackTitle)
  if (!featuredNames || featuredNames.length === 0) return

  for (const [index, name] of featuredNames.entries()) {
    const { data: existingArtist, error: selectError } = await supabase
      .from('artist')
      .select('id')
      .eq('name', name)
      .maybeSingle()
    if (selectError) {
      console.error(`フィーチャリングアーティスト確認に失敗しました(${name}):`, selectError.message)
      continue
    }

    let artistId: string
    if (existingArtist) {
      artistId = existingArtist.id
    } else {
      const { data: inserted, error: insertError } = await supabase.from('artist').insert({ name }).select('id').single()
      if (insertError || !inserted) {
        console.error(`フィーチャリングアーティストのスタブ作成に失敗しました(${name}):`, insertError?.message)
        continue
      }
      artistId = inserted.id
    }

    const { data: existingLink, error: linkSelectError } = await supabase
      .from('track_artist')
      .select('id')
      .eq('track_id', trackId)
      .eq('artist_id', artistId)
      .maybeSingle()
    if (linkSelectError) {
      console.error(`track_artist確認に失敗しました(${name}):`, linkSelectError.message)
      continue
    }
    if (existingLink) continue

    const { error: linkInsertError } = await supabase
      .from('track_artist')
      .insert({ track_id: trackId, artist_id: artistId, role: 'featuring', billing_order: index + 2 })
    if (linkInsertError) {
      console.error(`track_artist登録に失敗しました(${name}):`, linkInsertError.message)
    }
  }
}
```

- [ ] **Step 3: track新規作成の直後に呼び出す**

`syncOneAlbum`内、`else { const { data: insertedTrack, ... } ... albumTrackList.push({ id: insertedTrack.id, title: itunesTrack.trackName }) }`の直後(`trackCount++`より前)に1行追加する:

```ts
      albumTrackList.push({ id: insertedTrack.id, title: itunesTrack.trackName })
      await linkOrStubFeaturedArtists(supabase, insertedTrack.id, itunesTrack.trackName)
```

- [ ] **Step 4: 型チェックを実行する**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: エラーなし

- [ ] **Step 5: Commit**

```bash
git add app/admin/import/actions.ts
git commit -m "feat: stub-create unregistered featuring artists at track import time

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: 未マッチアーティスト管理画面へのtrack_artist経由スタブの追加

**Files:**
- Modify: `app/admin/data/artists/unmatched/page.tsx`

**Interfaces:**
- Consumes: なし。
- Produces: なし(表示ロジックの拡張のみ)。

- [ ] **Step 1: track_artist経由のスタブを取得するクエリを追加する**

`app/admin/data/artists/unmatched/page.tsx`内、`const [{ data: eventLinks }, { data: curationLinks }] = await Promise.all([...])`のブロックを次のように置き換える:

```ts
  const [{ data: eventLinks }, { data: curationLinks }, { data: featuringLinks }] = await Promise.all([
    supabase
      .from('event_appearance_artist')
      .select(
        'artist:artist_id!inner(id, name, created_at, apple_music_artist_id), event_appearance:event_appearance_id(event_edition:event_edition_id(year, event:event_id(name)))'
      )
      .is('artist.apple_music_artist_id', null),
    supabase
      .from('ranking_entry')
      .select('artist:artist_id!inner(id, name, created_at, apple_music_artist_id), ranking:ranking_id(id, name)')
      .is('artist.apple_music_artist_id', null)
      .not('artist_id', 'is', null),
    supabase
      .from('track_artist')
      .select('artist:artist_id!inner(id, name, created_at, apple_music_artist_id), track:track_id(title)')
      .is('artist.apple_music_artist_id', null)
      .eq('role', 'featuring'),
  ])
```

- [ ] **Step 2: 取得したスタブを既存の集計ループに合流させる**

`for (const link of eventLinks ?? []) { ... }`と`for (const link of curationLinks ?? []) { ... }`のブロックの後(既存の集計ループの末尾)に追加する:

```ts
  for (const link of featuringLinks ?? []) {
    const artist = firstOf(link.artist)
    if (!artist) continue
    stubById.set(artist.id, { id: artist.id, name: artist.name, createdAt: artist.created_at })

    const track = firstOf(link.track)
    if (track) addContext(artist.id, `フィーチャリング: ${track.title}`)
  }
```

（`firstOf`・`addContext`・`stubById`は同ファイル内に既存の関数・変数であり、そのまま再利用する。`link.track`の型は`{ title: string } | { title: string }[] | null`のいずれかになりうるため、既存の`firstOf`ヘルパーで単一値に正規化してから使う。）

- [ ] **Step 3: 型チェックを実行する**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: エラーなし。もし`link.track`の型が`firstOf`の型シグネチャと合わない場合、同ファイル内の既存の`firstOf<T>`ジェネリック関数の型引数を明示的に指定する(`firstOf<{ title: string }>(link.track)`)。

- [ ] **Step 4: Commit**

```bash
git add app/admin/data/artists/unmatched/page.tsx
git commit -m "feat: surface featuring-derived stub artists in the unmatched-artist admin page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: 実行(`--execute`)と事後確認

**Files:**
- なし(既存の`scripts/unify-track-artist-credits.ts`を実行するのみ)

- [ ] **Step 1: 実行前に代表グループの件数を記録しておく**

Run(Supabaseで直接確認、または`mcp__claude_ai_Supabase__execute_sql`で):
```sql
select count(*) from track_artist;
select count(*) from album_artist;
```

- [ ] **Step 2: `--execute`を実行する**

Run: `npx tsx --env-file=.env.local scripts/unify-track-artist-credits.ts --execute`
Expected: Task 5までと同じログが出力され、末尾に「成功: N グループ、失敗: 0 グループ」に近い結果が出ること(失敗が出た場合はエラー内容を確認し、恒久的な失敗か一時的なものか判断する)。

- [ ] **Step 3: track_artist/album_artistの件数が増えたことを確認する**

Run(Supabaseで直接確認):
```sql
select count(*) from track_artist;
select count(*) from album_artist;
```
Expected: Step 1で記録した件数より増えていること。

- [ ] **Step 4: 代表例(Under the Mistletoe (feat. Dan Hicks))が正しく統合されたことを確認する**

Run(Supabaseで直接確認):
```sql
select count(*) from track where title = 'Under the Mistletoe (feat. Dan Hicks)';
select ta.role, ta.billing_order, a.name
from track t
join track_artist ta on ta.track_id = t.id
join artist a on a.id = ta.artist_id
where t.title = 'Under the Mistletoe (feat. Dan Hicks)'
order by ta.billing_order;
```
Expected: trackが1件のみになっていること、track_artistが本体+関与アーティスト分(このケースでは5件)存在し、billing_orderが1から連番になっていること。

- [ ] **Step 5: 本体トラックページが正しく表示されることを確認する**

該当トラックの`id`で`https://music-synapse.vercel.app/tracks/{id}`(または開発サーバー)にアクセスし、ページが正しく表示される(エラーにならない)ことを確認する。

- [ ] **Step 6: `npm test`が全て通ることを確認する**

Run: `npm test`
Expected: 全テストpass(このタスクではコードの変更は無いため、実行結果の確認のみ)。
