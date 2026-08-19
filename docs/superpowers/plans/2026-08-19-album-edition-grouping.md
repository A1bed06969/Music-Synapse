# Album Edition Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate deluxe/bonus/regional edition albums under a single representative release (the earliest-released one) across every album listing surface, with an "Other Versions" section on the album detail page to reach the rest — matching Apple Music's pattern, as confirmed with real production data (Cardi B's "AM I THE DRAMA?" spans 11 real, non-duplicate `album` rows).

**Architecture:** A new self-referencing `album.primary_album_id` column marks non-representative editions. A pure, unit-tested title-normalization + grouping function decides which albums belong together (same artist, same `album_type ∈ {Album, EP, Live}`, matching normalized title after stripping known edition-keyword parentheticals). A re-runnable backfill script applies it to the existing catalog. Every page that lists albums (artist discography, artist timeline, global album browse, search, release calendar) adds one filter condition to show only representative albums. The album detail page gains an "Other Versions" section. An admin tool lets a human correct any mis-grouping without being overwritten by the next backfill run.

**Tech Stack:** Next.js/TypeScript (App Router, Server Components + Server Actions), Supabase (Postgres), `node --test`.

**Spec:** docs/superpowers/specs/2026-08-19-album-edition-grouping-design.md

## Global Constraints

- Grouping applies only to `album_type IN ('Album', 'EP', 'Live')`. Singles (remix/instrumental/radio-edit variants) are explicitly out of scope.
- Matching is title-normalization only — no jacket image comparison.
- The representative of a group is the one with the earliest `release_date` (nulls sort last; ties break on `id` ascending — decided during planning per the spec's deferred tie-break note).
- The backfill script must be safe to re-run indefinitely: it must never touch rows where `edition_group_manual_override = true` (admin-corrected rows) or rows that already have `primary_album_id` set.
- No new table — a single self-referencing `album.primary_album_id` column plus `album.edition_group_manual_override` boolean, per the spec's stated reasoning (simple "one representative + others" tree, not a many-to-many relation).
- Follow this repo's existing patterns: `mergeLabel` in `app/admin/data/labels/actions.ts` is the template for admin actions that reassign/adjust relations; `searchAlbums`/`SearchableSelect` (`app/admin/data/actions.ts`, `app/admin/data/SearchableSelect.tsx`) is the existing searchable-picker component to reuse for the admin tool, not a new one.

---

### Task 1: Migration — `primary_album_id` and `edition_group_manual_override`

**Files:**
- Create: `supabase/migrations/20260819_add_album_edition_grouping.sql`

**Interfaces:**
- Produces: `album.primary_album_id` (text, nullable, FK to `album.id`), `album.edition_group_manual_override` (boolean, not null, default false), an index on `primary_album_id`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260819_add_album_edition_grouping.sql
-- デラックス版・地域別版・ボーナス版などの「版違い」アルバムを、代表版(最速
-- リリース日のもの)+その他の版、という形にグループ化するための下準備。
-- 新テーブルは作らず、自己参照の1カラムで「代表1件+その他」の木構造を表す。
ALTER TABLE album ADD COLUMN primary_album_id TEXT REFERENCES album(id) ON DELETE SET NULL;
ALTER TABLE album ADD COLUMN edition_group_manual_override BOOLEAN NOT NULL DEFAULT false;

-- primary_album_idでの絞り込み(is null / eq)が複数ページのクエリで頻出するため
CREATE INDEX idx_album_primary_album_id ON album(primary_album_id);
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with `project_id: ftvhglfthbcxhgnoninv`, `name: add_album_edition_grouping`, and the SQL body above.

- [ ] **Step 3: Verify via SQL**

Via `mcp__claude_ai_Supabase__execute_sql` (`project_id: ftvhglfthbcxhgnoninv`):

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'album' and column_name in ('primary_album_id', 'edition_group_manual_override');
```

Expected: both columns present; `primary_album_id` nullable with no default; `edition_group_manual_override` not nullable, default `false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260819_add_album_edition_grouping.sql
git commit -m "feat: add album edition grouping columns"
```

---

### Task 2: Grouping logic (`utils/albumEditionGrouping.ts`)

**Files:**
- Create: `utils/albumEditionGrouping.ts`
- Test: `__tests__/album-edition-grouping.unit.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (pure logic, no DB access).
- Produces (for Task 3 to consume):
  - `normalizeAlbumTitleForGrouping(title: string): string`
  - `type AlbumForGrouping = { id: string; artistId: string; title: string; releaseDate: string | null; albumType: string | null }`
  - `type EditionGroup = { primaryId: string; editionIds: string[] }`
  - `groupAlbumsForEditionMerge(albums: AlbumForGrouping[]): EditionGroup[]`

- [ ] **Step 1: Write the failing unit tests**

```typescript
// __tests__/album-edition-grouping.unit.test.ts
//
// アルバムの「版」をタイトル正規化でグループ化するロジックの純粋関数テスト。
// 実データ(Cardi B "AM I THE DRAMA?"シリーズ)由来のケースを含む。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAlbumTitleForGrouping, groupAlbumsForEditionMerge } from '../utils/albumEditionGrouping.ts'

describe('normalizeAlbumTitleForGrouping', () => {
  test('strips a trailing edition-keyword parenthetical', () => {
    assert.equal(normalizeAlbumTitleForGrouping('AM I THE DRAMA? (Bonus Edition)'), 'AM I THE DRAMA?')
  })

  test('strips multiple trailing edition-keyword parentheticals', () => {
    assert.equal(normalizeAlbumTitleForGrouping('Title (Deluxe) (Japan Version)'), 'Title')
  })

  test('leaves a title with no edition-keyword parenthetical unchanged', () => {
    assert.equal(normalizeAlbumTitleForGrouping('Gangsta Bitch Music, Vol. 1'), 'Gangsta Bitch Music, Vol. 1')
  })

  test('does not strip a parenthetical with no edition keyword', () => {
    assert.equal(normalizeAlbumTitleForGrouping('Title (feat. Someone)'), 'Title (feat. Someone)')
  })

  test('strips "The Snow Mix" via the mix keyword', () => {
    assert.equal(normalizeAlbumTitleForGrouping('AM I THE DRAMA? (The Snow Mix)'), 'AM I THE DRAMA?')
  })

  test('is case-insensitive on the keyword match', () => {
    assert.equal(normalizeAlbumTitleForGrouping('Title (DELUXE EDITION)'), 'Title')
  })
})

describe('groupAlbumsForEditionMerge', () => {
  test('groups same-artist albums whose normalized titles match; earliest release date becomes primary', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'a1', artistId: 'art1', title: 'AM I THE DRAMA?', releaseDate: '2025-09-19', albumType: 'Album' },
      { id: 'a2', artistId: 'art1', title: 'AM I THE DRAMA?', releaseDate: '2025-09-18', albumType: 'Album' },
      { id: 'a3', artistId: 'art1', title: 'AM I THE DRAMA? (Bonus Edition)', releaseDate: '2025-09-22', albumType: 'Album' },
    ])
    assert.equal(groups.length, 1)
    assert.equal(groups[0].primaryId, 'a2')
    assert.deepEqual(groups[0].editionIds.sort(), ['a1', 'a3'])
  })

  test('does not group distinct works with different normalized titles (Vol. 1 vs Vol. 2)', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'b1', artistId: 'art2', title: 'Gangsta Bitch Music, Vol. 1', releaseDate: '2016-03-07', albumType: 'Album' },
      { id: 'b2', artistId: 'art2', title: 'Gangsta Bitch Music, Vol. 2', releaseDate: '2017-01-20', albumType: 'Album' },
    ])
    assert.equal(groups.length, 0)
  })

  test('does not group albums from different artists even with the same title', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'c1', artistId: 'artX', title: 'Greatest Hits', releaseDate: '2020-01-01', albumType: 'Album' },
      { id: 'c2', artistId: 'artY', title: 'Greatest Hits', releaseDate: '2020-01-01', albumType: 'Album' },
    ])
    assert.equal(groups.length, 0)
  })

  test('ignores Single album_type even with matching titles', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'd1', artistId: 'art3', title: 'Bongos', releaseDate: '2023-09-08', albumType: 'Single' },
      { id: 'd2', artistId: 'art3', title: 'Bongos (Radio Edit)', releaseDate: '2023-09-07', albumType: 'Single' },
    ])
    assert.equal(groups.length, 0)
  })

  test('produces no group for a lone ungrouped album', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'e1', artistId: 'art4', title: 'Solo Album', releaseDate: '2019-01-01', albumType: 'Album' },
    ])
    assert.equal(groups.length, 0)
  })

  test('sorts a null release_date last when picking the primary', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'f1', artistId: 'art5', title: 'Untitled', releaseDate: null, albumType: 'Album' },
      { id: 'f2', artistId: 'art5', title: 'Untitled (Deluxe)', releaseDate: '2022-01-01', albumType: 'Album' },
    ])
    assert.equal(groups.length, 1)
    assert.equal(groups[0].primaryId, 'f2')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern "normalizeAlbumTitleForGrouping|groupAlbumsForEditionMerge"`
Expected: FAIL — `../utils/albumEditionGrouping.ts` does not exist yet.

- [ ] **Step 3: Implement `utils/albumEditionGrouping.ts`**

```typescript
// utils/albumEditionGrouping.ts
//
// デラックス版・地域別版・ボーナス版などの「版違い」アルバムを、タイトル正規化で
// グループ化するロジック。ジャケット画像の比較は行わない(タイトルのみで判定)。
// 過検出(誤って別作品をまとめる)より過小検出(まとめ漏れ)を優先する方針のため、
// 版表記キーワードは「これが付いていれば版違いとほぼ断定できる」語だけに絞っている。
// まとめ漏れは管理画面(app/admin/data/albums/edition-groups/)から手動で救える。

const EDITION_KEYWORDS = [
  'edition',
  'version',
  'deluxe',
  'bonus',
  'remaster',
  'remastered',
  'anniversary',
  'extended',
  'expanded',
  'complete',
  'definitive',
  'special',
  'mix',
  'live',
  'explicit',
  'clean',
  'exclusive',
  'international',
  'target',
  'walmart',
]

// 末尾の括弧(...)/[...]のうち、版表記キーワードを含むものにマッチする。
// 複数の括弧が連続する場合に対応するため、呼び出し側でマッチしなくなるまで
// 繰り返し適用する。
const TRAILING_EDITION_BRACKET_RE = new RegExp(
  `\\s*[([][^()[\\]]*\\b(${EDITION_KEYWORDS.join('|')})\\b[^()[\\]]*[)\\]]\\s*$`,
  'i'
)

export function normalizeAlbumTitleForGrouping(title: string): string {
  let normalized = title.trim().normalize('NFKC')
  while (TRAILING_EDITION_BRACKET_RE.test(normalized)) {
    normalized = normalized.replace(TRAILING_EDITION_BRACKET_RE, '').trim()
  }
  return normalized
}

export type AlbumForGrouping = {
  id: string
  artistId: string
  title: string
  releaseDate: string | null
  albumType: string | null
}

export type EditionGroup = {
  primaryId: string
  editionIds: string[]
}

const GROUPABLE_ALBUM_TYPES = new Set(['Album', 'EP', 'Live'])

export function groupAlbumsForEditionMerge(albums: AlbumForGrouping[]): EditionGroup[] {
  const buckets = new Map<string, AlbumForGrouping[]>()

  for (const album of albums) {
    if (!album.albumType || !GROUPABLE_ALBUM_TYPES.has(album.albumType)) continue
    const key = `${album.artistId}::${normalizeAlbumTitleForGrouping(album.title).toLowerCase()}`
    const bucket = buckets.get(key) ?? []
    bucket.push(album)
    buckets.set(key, bucket)
  }

  const groups: EditionGroup[] = []
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue

    const sorted = [...bucket].sort((a, b) => {
      const dateA = a.releaseDate ?? '9999-99-99'
      const dateB = b.releaseDate ?? '9999-99-99'
      if (dateA !== dateB) return dateA.localeCompare(dateB)
      return a.id.localeCompare(b.id)
    })

    const [primary, ...rest] = sorted
    groups.push({ primaryId: primary.id, editionIds: rest.map((a) => a.id) })
  }

  return groups
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern "normalizeAlbumTitleForGrouping|groupAlbumsForEditionMerge"`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add utils/albumEditionGrouping.ts __tests__/album-edition-grouping.unit.test.ts
git commit -m "feat: add pure album edition grouping logic"
```

---

### Task 3: Backfill script

**Files:**
- Create: `scripts/backfill-album-edition-groups.ts`

**Interfaces:**
- Consumes: `groupAlbumsForEditionMerge`, `type AlbumForGrouping` from `utils/albumEditionGrouping.ts` (Task 2); `primary_album_id`/`edition_group_manual_override` columns from Task 1.
- Produces: nothing consumed by later tasks — this is the plan's data-population step, run manually against production.

- [ ] **Step 1: Implement the script**

```typescript
// scripts/backfill-album-edition-groups.ts
/**
 * デラックス版・地域別版・ボーナス版などの「版違い」アルバムを、代表版
 * (最速リリース日)+その他の版、という形にグループ化する。
 * primary_album_idが未設定(NULL)かつedition_group_manual_overrideがfalseの
 * アルバムだけを対象とするため、管理画面から手動修正した行や既にグループ化
 * 済みの行は上書きしない。何度でも安全に再実行できる(新しくインポートされた
 * 版を後から拾うため、定期的な再実行を想定)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-album-edition-groups.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { groupAlbumsForEditionMerge, type AlbumForGrouping } from '@/utils/albumEditionGrouping'

async function main() {
  const supabase = createAdminClient()

  const { data: albums, error } = await supabase
    .from('album')
    .select('id, artist_id, title, release_date, album_type')
    .is('primary_album_id', null)
    .eq('edition_group_manual_override', false)
    .in('album_type', ['Album', 'EP', 'Live'])

  if (error) {
    console.error('アルバム取得に失敗しました:', error.message)
    process.exit(1)
  }

  const rows: AlbumForGrouping[] = (albums ?? []).map((a) => ({
    id: a.id,
    artistId: a.artist_id,
    title: a.title,
    releaseDate: a.release_date,
    albumType: a.album_type,
  }))

  const groups = groupAlbumsForEditionMerge(rows)

  if (groups.length === 0) {
    console.log('グループ化対象のアルバムはありません。')
    return
  }

  console.log(`${groups.length}件のグループを検出しました。\n`)

  let updated = 0
  let failed = 0

  for (const group of groups) {
    const { error: updateError } = await supabase
      .from('album')
      .update({ primary_album_id: group.primaryId })
      .in('id', group.editionIds)

    if (updateError) {
      console.error(`  失敗 (primary=${group.primaryId}): ${updateError.message}`)
      failed += 1
      continue
    }
    console.log(`  primary=${group.primaryId} / editions=${group.editionIds.join(', ')}`)
    updated += 1
  }

  console.log(`\n完了: ${updated}件のグループを適用、${failed}件失敗。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Run against production and verify with real data**

```bash
npx tsx --env-file=.env.local scripts/backfill-album-edition-groups.ts
```

Expect the "AM I THE DRAMA?" group to appear in the output (11 rows total: 1 primary + 10 editions, based on the real data found during design — verify the actual count matches what's in production at run time, it may have changed).

Then verify via `mcp__claude_ai_Supabase__execute_sql` (`project_id: ftvhglfthbcxhgnoninv`):

```sql
select a.id, a.title, a.release_date, a.primary_album_id
from album a
join artist ar on ar.id = a.artist_id
where ar.name ilike '%cardi%' and a.title ilike '%drama%'
order by a.release_date;
```

Expected: exactly one row with `primary_album_id IS NULL` (the earliest-dated one), the rest with `primary_album_id` set to that row's `id`.

Also confirm the safety property — run the script a second time immediately:

```bash
npx tsx --env-file=.env.local scripts/backfill-album-edition-groups.ts
```

Expected: `グループ化対象のアルバムはありません。` (nothing left ungrouped that should be grouped — proves idempotency).

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-album-edition-groups.ts
git commit -m "feat: add backfill script for album edition grouping"
```

---

### Task 4: Filter representative-only albums across listing surfaces

**Files:**
- Modify: `app/artists/[id]/page.tsx:63-66`
- Modify: `app/artists/[id]/timeline/page.tsx:29-32`
- Modify: `app/albums/page.tsx:22-25`
- Modify: `app/search/actions.ts:20-24`
- Modify: `app/albums/calendar/page.tsx:56-61`

**Interfaces:**
- Consumes: `album.primary_album_id` column from Task 1. Does not depend on Task 2/3's code, only on the column existing and (for meaningful verification) Task 3 having populated it.
- Produces: nothing consumed by later tasks.

This task is five mechanical, same-shape edits: add `.is('primary_album_id', null)` to each existing album query so it returns only representative albums. Read each file fresh before editing — line numbers may have drifted since this plan was written.

- [ ] **Step 1: `app/artists/[id]/page.tsx`**

Find the album query (currently):

```typescript
supabase
  .from('album')
  .select('id, title, jacket_url, release_date, album_type, streaming_status')
  .eq('artist_id', id)
  .order('release_date', { ascending: false, nullsFirst: false }),
```

Add the filter:

```typescript
supabase
  .from('album')
  .select('id, title, jacket_url, release_date, album_type, streaming_status')
  .eq('artist_id', id)
  .is('primary_album_id', null)
  .order('release_date', { ascending: false, nullsFirst: false }),
```

- [ ] **Step 2: `app/artists/[id]/timeline/page.tsx`**

Find the album query (currently):

```typescript
supabase
  .from('album')
  .select('id, title, jacket_url, release_date')
  .eq('artist_id', id)
  .order('release_date', { ascending: false, nullsFirst: false }),
```

Add the same filter:

```typescript
supabase
  .from('album')
  .select('id, title, jacket_url, release_date')
  .eq('artist_id', id)
  .is('primary_album_id', null)
  .order('release_date', { ascending: false, nullsFirst: false }),
```

- [ ] **Step 3: `app/albums/page.tsx`**

Inside `fetchAllAlbums`, find:

```typescript
const { data } = await supabase
  .from('album')
  .select('id, title, title_kana, jacket_url, release_date, streaming_status, artist:artist_id(name)')
  .range(offset, offset + PAGE_SIZE - 1)
```

Add the filter:

```typescript
const { data } = await supabase
  .from('album')
  .select('id, title, title_kana, jacket_url, release_date, streaming_status, artist:artist_id(name)')
  .is('primary_album_id', null)
  .range(offset, offset + PAGE_SIZE - 1)
```

- [ ] **Step 4: `app/search/actions.ts`**

Find the album query inside `search()`:

```typescript
supabase
  .from('album')
  .select('id, title, title_kana, jacket_url, artist:artist_id(id, name)')
  .ilike('title', `%${trimmed}%`)
  .limit(20),
```

Add the filter:

```typescript
supabase
  .from('album')
  .select('id, title, title_kana, jacket_url, artist:artist_id(id, name)')
  .ilike('title', `%${trimmed}%`)
  .is('primary_album_id', null)
  .limit(20),
```

- [ ] **Step 5: `app/albums/calendar/page.tsx`**

Find the album query:

```typescript
const { data: albumRows } = await supabase
  .from('album')
  .select('id, title, jacket_url, release_date, artist:artist_id(id, name)')
  .gte('release_date', start)
  .lt('release_date', end)
  .order('release_date', { ascending: true })
```

Add the filter:

```typescript
const { data: albumRows } = await supabase
  .from('album')
  .select('id, title, jacket_url, release_date, artist:artist_id(id, name)')
  .gte('release_date', start)
  .lt('release_date', end)
  .is('primary_album_id', null)
  .order('release_date', { ascending: true })
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 7: Run the test suite**

Run: `npm test`
Expected: all tests pass (no test files touched by this task).

- [ ] **Step 8: Verify locally against real data**

Start the dev server and confirm the Cardi B "AM I THE DRAMA?" editions collapse to one entry on each surface:

```bash
npm run dev &
sleep 3
# Find Cardi B's artist id first if you don't already have it, then:
curl -s -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" "http://localhost:3000/artists/<cardi_b_artist_id>" | grep -o "AM I THE DRAMA?" | wc -l
curl -s -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" "http://localhost:3000/artists/<cardi_b_artist_id>/timeline" | grep -o "AM I THE DRAMA?" | wc -l
```

(Read Basic Auth credentials from `.env.local`, never print their values.) Expected: exactly 1 for each (down from the many that existed before this task, matching what Task 3's verification confirmed in the database). Note that raw HTML `grep` counts can include the string appearing in the React Server Components flight payload as well as the rendered HTML, so don't be alarmed if the count is 2 rather than 1 for a single visible entry — compare against the pre-fix count (which was much higher) rather than expecting exactly 1.

- [ ] **Step 9: Commit**

```bash
git add app/artists/\[id\]/page.tsx app/artists/\[id\]/timeline/page.tsx app/albums/page.tsx app/search/actions.ts app/albums/calendar/page.tsx
git commit -m "feat: show only representative album editions across listing pages"
```

---

### Task 5: "Other Versions" section on the album detail page

**Files:**
- Modify: `app/albums/[id]/page.tsx`

**Interfaces:**
- Consumes: `album.primary_album_id` (Task 1); real grouped data from Task 3/4 to verify against.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the current file fresh**

Read `app/albums/[id]/page.tsx` in full before editing — this plan was written against a specific version and the file may have shifted.

- [ ] **Step 2: Add the other-versions query**

After the existing `Promise.all` that fetches `tracks`/`discGuideSelections` (currently ending around where `artist`/`label` are destructured from `album`), add a new query. The anchor for "this album's group" is `album.primary_album_id` if set (this album is itself an edition), otherwise `album.id` (this album is itself the representative):

```typescript
const groupAnchorId = album.primary_album_id ?? album.id
const { data: otherVersions } = await supabase
  .from('album')
  .select('id, title, jacket_url, release_date')
  .or(`id.eq.${groupAnchorId},primary_album_id.eq.${groupAnchorId}`)
  .neq('id', id)
  .order('release_date', { ascending: true, nullsFirst: false })
```

(The `.or()` with directly-interpolated id values matches the existing pattern already used in this repo, e.g. `app/artists/[id]/page.tsx`'s membership query `.or(\`artist_id_a.eq.${id},artist_id_b.eq.${id}\`)` — these are our own internally-generated `MS_ALB_...` id strings, not user input, so this is safe and consistent with established convention.)

- [ ] **Step 3: Render the section**

Add this section after the existing "掲載ディスクガイド" section (or after the tracklist section if `discGuideSelections` is empty — place it as the last section either way, matching the spec's "trackガイド下、Apple Musicと同じ体裁" placement). Reuse the exact discography card styling already used in `app/artists/[id]/page.tsx` (`w-28` flex-shrink-0 cards, `aspect-square` jacket, `group-hover:scale-105`) for visual consistency:

```tsx
{otherVersions && otherVersions.length > 0 && (
  <section className="mt-10">
    <h2 className="text-lg font-semibold">その他のバージョン</h2>
    <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
      {otherVersions.map((v) => (
        <Link key={v.id} href={`/albums/${v.id}`} className="group block w-28 flex-shrink-0">
          <div className="aspect-square overflow-hidden rounded-md bg-white/5">
            {v.jacket_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={v.jacket_url}
                alt={v.title}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/20">No Art</div>
            )}
          </div>
          <p className="mt-2 truncate text-sm font-medium">{v.title}</p>
          <p className="text-xs text-white/40">{formatDate(v.release_date)}</p>
        </Link>
      ))}
    </div>
  </section>
)}
```

`Link` and `formatDate` are already imported at the top of this file (`formatDate` from `@/utils/format`, `Link` from `next/link`) — no new imports needed for this step.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Verify locally against real data**

```bash
npm run dev &
sleep 3
```

Find one of the Cardi B "AM I THE DRAMA?" album ids from Task 3's verification query (the representative one, `primary_album_id IS NULL`) and curl its detail page:

```bash
curl -s -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" "http://localhost:3000/albums/<representative_album_id>" | grep -o "その他のバージョン"
```

Expected: the string is present (section rendered). Also curl one of the *edition* album ids (one with `primary_album_id` set) to confirm the section appears there too, listing its siblings including the representative.

- [ ] **Step 6: Commit**

```bash
git add app/albums/\[id\]/page.tsx
git commit -m "feat: add Other Versions section to the album detail page"
```

---

### Task 6: Admin correction tool

**Files:**
- Create: `app/admin/data/albums/edition-groups/page.tsx`
- Create: `app/admin/data/albums/edition-groups/actions.ts`

**Interfaces:**
- Consumes: `searchAlbums`, `type PickerItem` from `app/admin/data/actions.ts` (existing); `SearchableSelect` from `app/admin/data/SearchableSelect.tsx` (existing); `inputClass`/`buttonClass` from `app/admin/data/adminUi.ts` (existing, per the pattern in `app/admin/data/labels/page.tsx`).
- Produces: nothing consumed by other tasks — this is the plan's final task.

- [ ] **Step 1: Read reference files fresh**

Read `app/admin/data/labels/page.tsx` and `app/admin/data/labels/actions.ts` in full (the `mergeLabel`/`linkAlbumLabel` pattern this task follows) and `app/admin/data/actions.ts` (for the exact `searchAlbums`/`PickerItem` signatures) before writing this task's files — this plan was written from a specific snapshot and the exact `inputClass`/`buttonClass` export names should be re-confirmed from `app/admin/data/adminUi.ts` (or wherever labels page.tsx's import `'../adminUi'` actually resolves to — read that import to confirm the path).

- [ ] **Step 2: Implement `app/admin/data/albums/edition-groups/actions.ts`**

```typescript
// app/admin/data/albums/edition-groups/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/albums/edition-groups?${result}=${encodeURIComponent(message)}`)
}

/** 自動グループ化を誤りと判断した版を、そのグループから外す。以後の自動
 * バックフィルに再び拾われないよう、手動修正フラグを立てる。 */
export async function unlinkEdition(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  if (!albumId) {
    redirectWith('error', 'アルバムを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('album')
    .update({ primary_album_id: null, edition_group_manual_override: true })
    .eq('id', albumId)

  if (error) {
    redirectWith('error', `グループ解除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/albums/edition-groups')
  redirectWith('success', 'グループから外しました。')
}

/** 自動判定で拾われなかった版を、手動で代表版に紐付ける。代表版自身が既に
 * 別の版になっている(primary_album_idを持つ)場合は、多段階のグループに
 * なってしまうため拒否する。 */
export async function linkEdition(formData: FormData) {
  const editionId = String(formData.get('edition_album_id') ?? '')
  const primaryId = String(formData.get('primary_album_id') ?? '')

  if (!editionId || !primaryId || editionId === primaryId) {
    redirectWith('error', '版とその代表版には異なるアルバムを選んでください。')
  }

  const supabase = createAdminClient()

  const { data: primaryAlbum } = await supabase
    .from('album')
    .select('id, primary_album_id')
    .eq('id', primaryId)
    .single()

  if (!primaryAlbum) {
    redirectWith('error', '指定した代表版が見つかりませんでした。')
  }
  if (primaryAlbum!.primary_album_id) {
    redirectWith('error', '指定した代表版は既に別のアルバムの版になっています。そのグループの本来の代表版を指定してください。')
  }

  const { error } = await supabase
    .from('album')
    .update({ primary_album_id: primaryId, edition_group_manual_override: true })
    .eq('id', editionId)

  if (error) {
    redirectWith('error', `紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/albums/edition-groups')
  revalidatePath(`/albums/${primaryId}`)
  redirectWith('success', '版を紐付けました。')
}

/** グループの代表版を、既存の版のうちの1件に差し替える。旧代表版は新代表版の
 * 版になり、それまで旧代表版を指していた他の版も全て新代表版へ付け替わる。 */
export async function changeGroupRepresentative(formData: FormData) {
  const currentPrimaryId = String(formData.get('current_primary_id') ?? '')
  const newPrimaryId = String(formData.get('new_primary_id') ?? '')

  if (!currentPrimaryId || !newPrimaryId || currentPrimaryId === newPrimaryId) {
    redirectWith('error', '現在の代表版と新しい代表版には異なるアルバムを選んでください。')
  }

  const supabase = createAdminClient()

  const { data: newPrimary } = await supabase
    .from('album')
    .select('id, primary_album_id')
    .eq('id', newPrimaryId)
    .single()

  if (!newPrimary || newPrimary.primary_album_id !== currentPrimaryId) {
    redirectWith('error', '指定した新しい代表版は、そのグループの版ではありません。')
  }

  // 新代表版以外の、旧代表版を指していた版たちを新代表版へ付け替える
  const { error: reassignError } = await supabase
    .from('album')
    .update({ primary_album_id: newPrimaryId })
    .eq('primary_album_id', currentPrimaryId)
    .neq('id', newPrimaryId)
  if (reassignError) {
    redirectWith('error', `版の付け替えに失敗しました: ${reassignError.message}`)
  }

  // 旧代表版を新代表版の版にする
  const { error: demoteError } = await supabase
    .from('album')
    .update({ primary_album_id: newPrimaryId })
    .eq('id', currentPrimaryId)
  if (demoteError) {
    redirectWith('error', `旧代表版の更新に失敗しました: ${demoteError.message}`)
  }

  // 新代表版自身をNULLにする(これが代表版になる)
  const { error: promoteError } = await supabase
    .from('album')
    .update({ primary_album_id: null })
    .eq('id', newPrimaryId)
  if (promoteError) {
    redirectWith('error', `新代表版の更新に失敗しました: ${promoteError.message}`)
  }

  revalidatePath('/admin/data/albums/edition-groups')
  revalidatePath(`/albums/${currentPrimaryId}`)
  revalidatePath(`/albums/${newPrimaryId}`)
  redirectWith('success', '代表版を変更しました。')
}
```

- [ ] **Step 3: Implement `app/admin/data/albums/edition-groups/page.tsx`**

```tsx
// app/admin/data/albums/edition-groups/page.tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../adminUi'
import SearchableSelect from '../../SearchableSelect'
import { searchAlbums } from '../../actions'
import { unlinkEdition, linkEdition, changeGroupRepresentative } from './actions'

export default async function AlbumEditionGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const { data: editions } = await supabase
    .from('album')
    .select('id, title, release_date, primary_album_id, artist:artist_id(name)')
    .not('primary_album_id', 'is', null)
    .order('primary_album_id')

  const primaryIds = Array.from(new Set((editions ?? []).map((e) => e.primary_album_id as string)))
  const { data: primaries } =
    primaryIds.length > 0
      ? await supabase
          .from('album')
          .select('id, title, release_date, artist:artist_id(name)')
          .in('id', primaryIds)
      : { data: [] }

  const primariesById = new Map((primaries ?? []).map((p) => [p.id, p]))

  const editionsByPrimary = new Map<string, typeof editions>()
  for (const edition of editions ?? []) {
    const key = edition.primary_album_id as string
    const list = editionsByPrimary.get(key) ?? []
    list.push(edition)
    editionsByPrimary.set(key, list)
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">アルバムの版グループ</h1>
      <p className="mt-2 text-xs text-white/40">
        デラックス版・地域別版・ボーナス版などをまとめた版グループの確認・修正。まとめ間違いはグループから外し、まとめ漏れは手動で紐付けられる。
      </p>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <div className="mt-10 rounded-md border border-white/10 p-4">
        <h2 className="text-sm font-semibold">まとめ漏れを手動で紐付け</h2>
        <form action={linkEdition} className="mt-3 flex flex-wrap items-center gap-2">
          <SearchableSelect searchAction={searchAlbums} name="edition_album_id" placeholder="版として紐付けるアルバム" />
          <span className="text-xs text-white/40">を</span>
          <SearchableSelect searchAction={searchAlbums} name="primary_album_id" placeholder="代表版のアルバム" />
          <button type="submit" className={buttonClass}>
            紐付け
          </button>
        </form>
      </div>

      <div className="mt-10 space-y-6">
        {primariesById.size === 0 ? (
          <p className="text-sm text-white/40">現在グループ化されているアルバムはありません。</p>
        ) : (
          Array.from(primariesById.entries()).map(([primaryId, primary]) => {
            const artist = Array.isArray(primary.artist) ? primary.artist[0] : primary.artist
            const groupEditions = editionsByPrimary.get(primaryId) ?? []
            return (
              <div key={primaryId} className="rounded-md border border-white/10 p-4">
                <p className="text-sm font-semibold">
                  {primary.title}{' '}
                  <span className="text-xs font-normal text-white/40">
                    (代表版・{artist?.name} ・ {primary.release_date ?? '発売日未設定'})
                  </span>
                </p>
                <ul className="mt-3 space-y-2 text-sm text-white/60">
                  {groupEditions.map((edition) => (
                    <li key={edition.id} className="flex flex-wrap items-center gap-2">
                      <span>
                        {edition.title} ({edition.release_date ?? '発売日未設定'})
                      </span>
                      <form action={unlinkEdition}>
                        <input type="hidden" name="album_id" value={edition.id} />
                        <button type="submit" className="text-xs text-red-300 hover:text-red-200">
                          グループから外す
                        </button>
                      </form>
                      <form action={changeGroupRepresentative}>
                        <input type="hidden" name="current_primary_id" value={primaryId} />
                        <input type="hidden" name="new_primary_id" value={edition.id} />
                        <button type="submit" className="text-xs text-white/40 hover:text-white">
                          これを代表版にする
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
```

Adjust the relative import paths (`'../../adminUi'`, `'../../SearchableSelect'`, `'../../actions'`) if Step 1's fresh read shows different actual paths — this file lives two directories deeper (`app/admin/data/albums/edition-groups/`) than `app/admin/data/labels/page.tsx` (`app/admin/data/labels/`), so the relative path prefix is one level longer (`../../` instead of `../`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors. If `editions`/`primaries` types don't infer cleanly through the `Map`/`Array.from` chain, add explicit type annotations rather than using `any`.

- [ ] **Step 5: Verify locally against real data**

```bash
npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" "http://localhost:3000/admin/data/albums/edition-groups"
```

Expected: `200`. Then load the page in a way you can inspect content (curl + grep, or describe what you verified) and confirm the Cardi B "AM I THE DRAMA?" group appears with its representative and ~10 editions listed, matching Task 3's verification. Do not click any of the destructive form buttons during verification unless you intend to actually test the action — if you do test `unlinkEdition`/`linkEdition`/`changeGroupRepresentative`, use a real album pair from the database and re-verify the resulting state in Supabase afterward (re-run Task 3 Step 3's SQL query), since these actions do mutate production data.

- [ ] **Step 6: Commit**

```bash
git add app/admin/data/albums/edition-groups/
git commit -m "feat: add admin tool for correcting album edition groups"
```

---

## After this plan lands

- Deploy to production (`env -u VERCEL_OIDC_TOKEN npx vercel --prod --yes`) and re-verify Task 4/5/6's checks against the live site.
- Consider adding a link to `/admin/data/albums/edition-groups` from the main `/admin/data` index page if one exists with links to other admin tools (check `app/admin/data/page.tsx`).
- Re-run `scripts/backfill-album-edition-groups.ts` periodically (or after future large iTunes import batches) to catch newly-added editions — it is safe to re-run indefinitely per this plan's Task 3 verification.
