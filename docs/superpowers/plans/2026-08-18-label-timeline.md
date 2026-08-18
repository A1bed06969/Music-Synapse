# レーベル年表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MusicBrainzでレーベルを検索して取り込めるようにし、レーベル詳細ページに発足・所属アーティストの加入/脱退・アルバムリリース・アワード受賞を時系列でまとめた年表セクションを追加する。

**Architecture:** 既存の`label`/`artist_label`/`album`/`award_entry`テーブルのみを使い、新規テーブルは作らない。MusicBrainzのLabel検索APIから候補を取得して人間が選ぶ取込フロー(既存のアーティスト取込・フェス出演者取込と同じパターン)と、レーベル詳細ページが既に取得済みのデータを1本の時系列リストへマージする純粋関数+それを描画するサーバーコンポーネントの2本立て。

**Tech Stack:** Next.js App Router (Server Actions, Server Components), Supabase, MusicBrainz API (`musicbrainz.org/ws/2`), Node built-in test runner (`node --test`)

**Spec:** docs/superpowers/specs/2026-08-18-label-timeline-design.md

## Global Constraints

- MusicBrainz APIはUser-Agentヘッダー必須、1リクエスト/秒のレート制限(既存の`utils/musicbrainz.ts`の`fetchMusicBrainz`をそのまま流用し、新しいレート制限処理は書かない)
- 既存の手動入力フォーム(`createLabel`/`linkArtistLabel`/`linkAlbumLabel`)は変更しない。MusicBrainz検索はあくまで追加の入口
- レーベル詳細ページの既存セクション(創設者/所属アーティスト/カタログ/アワード受賞)のJSX・データ取得クエリは変更しない。年表は追加のみ
- 日付が無い行(所属開始日未入力など)は年表に出さない。年表は「日付が分かる出来事」だけを扱う
- 自由文の手入力イベント・複数レーベル比較ビュー・レーベルの活動終了年は今回のスコープ外(spec「非ゴール」参照)

---

### Task 1: MusicBrainzレーベル検索関数

**Files:**
- Modify: `utils/musicbrainz.ts` (末尾に追記)
- Test: `__tests__/musicbrainz-label-search.integration.test.ts` (新規)

**Interfaces:**
- Consumes: 同ファイル内の`fetchMusicBrainz(url: string, label: string): Promise<any>`(既存、変更しない)
- Produces: `export type MusicBrainzLabelSearchResult = { mbid: string; name: string; type: string | null; country: string | null; areaName: string | null; foundedYear: number | null }` と `export async function searchLabel(name: string): Promise<MusicBrainzLabelSearchResult[]>`。Task 2がこの型と関数をインポートして使う

- [ ] **Step 1: 既存の`searchArtist`のすぐ後に`searchLabel`を追記する**

`utils/musicbrainz.ts`の51行目(`export async function searchArtist`の閉じ`}`の直後、`const ALLOWED_LINK_TYPES`の直前)に以下を追記:

```ts
export type MusicBrainzLabelSearchResult = {
  mbid: string
  name: string
  type: string | null
  country: string | null
  areaName: string | null
  foundedYear: number | null
}

export async function searchLabel(name: string): Promise<MusicBrainzLabelSearchResult[]> {
  const url = `${MUSICBRAINZ_BASE}/label?query=${encodeURIComponent(name)}&fmt=json&limit=5`
  const data = await fetchMusicBrainz(url, 'label search')
  return (data.labels ?? []).map((l: any) => ({
    mbid: l.id,
    name: l.name,
    type: l.type ?? null,
    country: l.country ?? null,
    areaName: l.area?.name ?? null,
    foundedYear: l['life-span']?.begin ? Number(String(l['life-span'].begin).slice(0, 4)) : null,
  }))
}
```

- [ ] **Step 2: 統合テストを書く(実APIを叩く。既存の統合テストに実APIコールがある前提を踏襲)**

`__tests__/musicbrainz-label-search.integration.test.ts`を新規作成:

```ts
// __tests__/musicbrainz-label-search.integration.test.ts
//
// MusicBrainzのLabel検索APIを実際に叩き、レスポンス形式が想定通りであることを確認する。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { searchLabel } from '../utils/musicbrainz.ts'

describe('searchLabel', () => {
  test('finds Motown with founded year 1959', async () => {
    const results = await searchLabel('Motown')
    assert.ok(results.length > 0, 'expected at least one result')
    const motown = results.find((r) => r.name === 'Motown')
    assert.ok(motown, 'expected a result named exactly "Motown"')
    assert.equal(motown!.foundedYear, 1959)
    assert.equal(motown!.country, 'US')
  })

  test('returns empty array for a nonsense query', async () => {
    const results = await searchLabel('zzzznonexistentlabelxyz123')
    assert.deepEqual(results, [])
  })
})
```

- [ ] **Step 3: テストを実行して通ることを確認する**

Run: `npm test -- --test-name-pattern searchLabel`
Expected: PASS(2件とも)。MusicBrainz APIは1req/秒のレート制限があるため、実行に数秒かかるのは正常

- [ ] **Step 4: コミット**

```bash
git add utils/musicbrainz.ts __tests__/musicbrainz-label-search.integration.test.ts
git commit -m "feat: add MusicBrainz label search"
```

---

### Task 2: レーベル作成のサーバーアクション

**Files:**
- Modify: `app/admin/data/labels/actions.ts`

**Interfaces:**
- Consumes: Task 1の`searchLabel`・`MusicBrainzLabelSearchResult`(`@/utils/musicbrainz`からインポート)
- Produces: `export async function searchMusicBrainzLabel(name: string): Promise<MusicBrainzLabelSearchResult[]>` と `export async function createLabelFromMusicBrainz(formData: FormData): Promise<void>`。Task 3のクライアントコンポーネントがこの2つをインポートして使う。`createLabelFromMusicBrainz`はFormDataから`name`(string, 必須)・`founded_year`(string, 空文字列可)を読む。フォーム側は`mbid`も隠しフィールドとして送るが、今回の重複防止はレーベル名の完全一致のみで行うため、サーバー側では読まない(将来MBIDでの照合に切り替える余地を残すため送信だけはしておく)

- [ ] **Step 1: `searchLabel`のインポートを追加する**

`app/admin/data/labels/actions.ts`の5行目(`import { createAdminClient } from '@/utils/Supabase/admin'`)の直後に追記:

```ts
import { searchLabel, type MusicBrainzLabelSearchResult } from '@/utils/musicbrainz'
```

- [ ] **Step 2: `searchMusicBrainzLabel`と`createLabelFromMusicBrainz`をファイル末尾に追記する**

```ts
export async function searchMusicBrainzLabel(name: string): Promise<MusicBrainzLabelSearchResult[]> {
  return searchLabel(name)
}

/** MusicBrainzの検索候補からレーベルを作成する。同名レーベルが既に存在する場合は
 * 新規作成せず、founded_yearが未設定なら補完するだけに留める(upsertArtistFromItunes
 * の重複防止と同じ考え方)。 */
export async function createLabelFromMusicBrainz(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const foundedYearRaw = String(formData.get('founded_year') ?? '').trim()
  const foundedYear = foundedYearRaw ? Number(foundedYearRaw) : null

  if (!name) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { data: existing } = await supabase.from('label').select('id, founded_year').eq('name', name).maybeSingle()

  if (existing) {
    if (!existing.founded_year && foundedYear) {
      await supabase.from('label').update({ founded_year: foundedYear }).eq('id', existing.id)
    }
    revalidatePath('/admin/data/labels')
    redirectWith('success', `「${name}」は既に登録されています(設立年が未設定だった場合は補完しました)。`)
  }

  const { error } = await supabase.from('label').insert({ name, founded_year: foundedYear })
  if (error) {
    redirectWith('error', `レーベルの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/labels')
  redirectWith('success', `レーベル「${name}」をMusicBrainzから登録しました。`)
}
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npx tsc --noEmit -p .`
Expected: エラー無し

- [ ] **Step 4: コミット**

```bash
git add app/admin/data/labels/actions.ts
git commit -m "feat: add label creation from MusicBrainz search"
```

---

### Task 3: レーベル検索UI

**Files:**
- Create: `app/admin/data/labels/MusicBrainzLabelSearch.tsx`
- Modify: `app/admin/data/labels/page.tsx`

**Interfaces:**
- Consumes: Task 2の`searchMusicBrainzLabel`・`createLabelFromMusicBrainz`(`./actions`からインポート)
- Produces: なし(末端のUIコンポーネント)

- [ ] **Step 1: クライアントコンポーネントを新規作成する**

`app/admin/data/labels/MusicBrainzLabelSearch.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { searchMusicBrainzLabel, createLabelFromMusicBrainz } from './actions'
import type { MusicBrainzLabelSearchResult } from '@/utils/musicbrainz'

export default function MusicBrainzLabelSearch() {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<MusicBrainzLabelSearchResult[] | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSearch() {
    if (!query.trim()) return
    startTransition(async () => {
      const results = await searchMusicBrainzLabel(query.trim())
      setCandidates(results)
    })
  }

  return (
    <div className="mt-6 rounded-md border border-white/15 p-4">
      <p className="text-xs text-white/40">MusicBrainzでレーベルを検索</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="レーベル名"
          className="w-full max-w-xs rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={isPending}
          className="rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
        >
          {isPending ? '検索中...' : '検索'}
        </button>
      </div>

      {candidates !== null && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {candidates.length === 0 ? (
            <li className="text-white/40">候補が見つかりませんでした。</li>
          ) : (
            candidates.map((c) => (
              <li key={c.mbid} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {c.name}
                  <span className="ml-2 text-xs text-white/30">
                    {[c.type, c.areaName ?? c.country, c.foundedYear ? `${c.foundedYear}年設立` : null]
                      .filter(Boolean)
                      .join(' / ')}
                  </span>
                </span>
                <form action={createLabelFromMusicBrainz}>
                  <input type="hidden" name="mbid" value={c.mbid} />
                  <input type="hidden" name="name" value={c.name} />
                  <input type="hidden" name="founded_year" value={c.foundedYear ?? ''} />
                  <button
                    type="submit"
                    className="rounded-md border border-white/15 px-2 py-1 text-xs hover:bg-white/5"
                  >
                    この候補で登録
                  </button>
                </form>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `app/admin/data/labels/page.tsx`に組み込む**

6行目のimport文を変更:

```ts
import { createLabel, linkArtistLabel, linkAlbumLabel } from './actions'
```

を

```ts
import { createLabel, linkArtistLabel, linkAlbumLabel } from './actions'
import MusicBrainzLabelSearch from './MusicBrainzLabelSearch'
```

に変更する。

32行目の`<h1 className="mt-4 text-2xl font-bold">レーベル</h1>`の直後、41行目の`<form action={createLabel} ...>`の直前に追記:

```tsx
      <MusicBrainzLabelSearch />
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npx tsc --noEmit -p .`
Expected: エラー無し

- [ ] **Step 4: ローカルで動作確認する**

Run: `npm run dev`(バックグラウンド起動)。Basic認証のヘッダーを付けて`/admin/data/labels`にアクセスし、検索欄に「Motown」と入力して検索ボタンを押す。「Motown」が候補に出て「1959年設立」の表記があること、「この候補で登録」を押すとレーベル一覧に追加されることを確認する。確認後`pkill -f "next dev"`でdevサーバーを止める

- [ ] **Step 5: コミット**

```bash
git add app/admin/data/labels/MusicBrainzLabelSearch.tsx app/admin/data/labels/page.tsx
git commit -m "feat: add MusicBrainz label search UI to admin labels page"
```

---

### Task 4: 年表マージロジック(純粋関数)

**Files:**
- Create: `utils/labelTimeline.ts`
- Test: `__tests__/label-timeline.unit.test.ts`

**Interfaces:**
- Consumes: なし(純粋関数、外部依存無し)
- Produces:
  ```ts
  export type LabelTimelineEntry = {
    date: string // 'YYYY-MM-DD'
    kind: 'founded' | 'founder' | 'joined' | 'left' | 'release' | 'award'
    title: string
    href: string | null
  }
  export type LabelTimelineInput = {
    foundedYear: number | null
    founders: { name: string; role: string | null }[]
    roster: { artistId: string; artistName: string; startDate: string | null; endDate: string | null }[]
    catalog: { albumId: string; albumTitle: string; artistName: string; releaseDate: string | null }[]
    awards: { year: number; awardName: string; category: string | null; result: string | null; subjectName: string }[]
  }
  export function buildLabelTimeline(input: LabelTimelineInput): LabelTimelineEntry[]
  ```
  Task 5の`LabelTimeline.tsx`がこの型と関数をインポートして使う

- [ ] **Step 1: 失敗するテストを書く**

`__tests__/label-timeline.unit.test.ts`を新規作成:

```ts
// __tests__/label-timeline.unit.test.ts
//
// レーベル年表のマージ・ソートロジックのユニットテスト。DB/サーバ不要、純粋関数のみ。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildLabelTimeline } from '../utils/labelTimeline.ts'

describe('buildLabelTimeline', () => {
  test('orders founding, founders, joins, leaves, releases, and awards chronologically', () => {
    const entries = buildLabelTimeline({
      foundedYear: 1959,
      founders: [{ name: 'Berry Gordy', role: '創業者' }],
      roster: [
        { artistId: 'a1', artistName: 'The Supremes', startDate: '1961-01-15', endDate: '1977-06-01' },
      ],
      catalog: [
        { albumId: 'al1', albumTitle: 'Where Did Our Love Go', artistName: 'The Supremes', releaseDate: '1964-08-01' },
      ],
      awards: [
        { year: 1965, awardName: 'Grammy', category: 'Best Group', result: 'Nominated', subjectName: 'The Supremes' },
      ],
    })

    assert.deepEqual(
      entries.map((e) => [e.date, e.kind]),
      [
        ['1959-01-01', 'founded'],
        ['1959-01-01', 'founder'],
        ['1961-01-15', 'joined'],
        ['1964-08-01', 'release'],
        ['1965-01-01', 'award'],
        ['1977-06-01', 'left'],
      ]
    )
    assert.equal(entries[0].title, 'レーベル発足')
    assert.equal(entries[1].title, 'Berry Gordy(創業者)が設立')
    assert.equal(entries[2].title, 'The Supremes 加入')
    assert.equal(entries[2].href, '/artists/a1')
    assert.equal(entries[3].title, 'The Supremes「Where Did Our Love Go」リリース')
    assert.equal(entries[3].href, '/albums/al1')
    assert.equal(entries[4].title, 'The Supremes Grammy Best Group(Nominated) 受賞')
    assert.equal(entries[5].title, 'The Supremes 脱退')
  })

  test('omits founding/founder entries when foundedYear is null', () => {
    const entries = buildLabelTimeline({
      foundedYear: null,
      founders: [{ name: 'Someone', role: null }],
      roster: [],
      catalog: [],
      awards: [],
    })
    assert.deepEqual(entries, [])
  })

  test('omits roster/catalog rows with no date', () => {
    const entries = buildLabelTimeline({
      foundedYear: null,
      founders: [],
      roster: [{ artistId: 'a1', artistName: 'No Date Artist', startDate: null, endDate: null }],
      catalog: [{ albumId: 'al1', albumTitle: 'Unreleased', artistName: 'No Date Artist', releaseDate: null }],
      awards: [],
    })
    assert.deepEqual(entries, [])
  })

  test('founder title omits role parentheses when role is null', () => {
    const entries = buildLabelTimeline({
      foundedYear: 1970,
      founders: [{ name: 'Anonymous', role: null }],
      roster: [],
      catalog: [],
      awards: [],
    })
    assert.equal(entries[1].title, 'Anonymousが設立')
  })
})
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -- --test-name-pattern buildLabelTimeline`
Expected: FAIL(`Cannot find module '../utils/labelTimeline.ts'`)

- [ ] **Step 3: 実装する**

`utils/labelTimeline.ts`を新規作成:

```ts
export type LabelTimelineEntry = {
  date: string
  kind: 'founded' | 'founder' | 'joined' | 'left' | 'release' | 'award'
  title: string
  href: string | null
}

export type LabelTimelineInput = {
  foundedYear: number | null
  founders: { name: string; role: string | null }[]
  roster: { artistId: string; artistName: string; startDate: string | null; endDate: string | null }[]
  catalog: { albumId: string; albumTitle: string; artistName: string; releaseDate: string | null }[]
  awards: { year: number; awardName: string; category: string | null; result: string | null; subjectName: string }[]
}

/** レーベル詳細ページが既に取得済みのデータを、日付が分かる出来事だけ時系列1本の
 * リストへマージする。日付を持たない行(所属開始日未入力の所属アーティスト等)は
 * 年表からは除外する(既存の所属アーティスト一覧側には引き続き表示される)。 */
export function buildLabelTimeline(input: LabelTimelineInput): LabelTimelineEntry[] {
  const entries: LabelTimelineEntry[] = []

  if (input.foundedYear) {
    const foundedDate = `${input.foundedYear}-01-01`
    entries.push({ date: foundedDate, kind: 'founded', title: 'レーベル発足', href: null })
    for (const founder of input.founders) {
      entries.push({
        date: foundedDate,
        kind: 'founder',
        title: founder.role ? `${founder.name}(${founder.role})が設立` : `${founder.name}が設立`,
        href: null,
      })
    }
  }

  for (const member of input.roster) {
    if (member.startDate) {
      entries.push({
        date: member.startDate,
        kind: 'joined',
        title: `${member.artistName} 加入`,
        href: `/artists/${member.artistId}`,
      })
    }
    if (member.endDate) {
      entries.push({
        date: member.endDate,
        kind: 'left',
        title: `${member.artistName} 脱退`,
        href: `/artists/${member.artistId}`,
      })
    }
  }

  for (const album of input.catalog) {
    if (album.releaseDate) {
      entries.push({
        date: album.releaseDate,
        kind: 'release',
        title: `${album.artistName}「${album.albumTitle}」リリース`,
        href: `/albums/${album.albumId}`,
      })
    }
  }

  for (const award of input.awards) {
    const parts = [award.awardName, award.category, award.result ? `(${award.result})` : null].filter(Boolean)
    entries.push({
      date: `${award.year}-01-01`,
      kind: 'award',
      title: `${award.subjectName} ${parts.join(' ')} 受賞`,
      href: null,
    })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date))
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test -- --test-name-pattern buildLabelTimeline`
Expected: PASS(4件とも)

- [ ] **Step 5: コミット**

```bash
git add utils/labelTimeline.ts __tests__/label-timeline.unit.test.ts
git commit -m "feat: add label timeline merge logic"
```

---

### Task 5: 年表UIコンポーネントの組み込み

**Files:**
- Create: `app/labels/[id]/LabelTimeline.tsx`
- Modify: `app/labels/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 4の`buildLabelTimeline`・`LabelTimelineInput`・`LabelTimelineEntry`(`@/utils/labelTimeline`からインポート)。`utils/format`の`formatDate`(既存、変更しない)
- Produces: なし(末端のUIコンポーネント)

- [ ] **Step 1: `LabelTimeline.tsx`を新規作成する**

`app/labels/[id]/page.tsx`の既存クエリ(20-32行目、`founders`/`roster`/`catalog`)と同じSupabaseの型(join列がオブジェクトまたは配列で返るPostgREST特有の形)をそのまま受け取り、コンポーネント内でフラット化してから`buildLabelTimeline`に渡す。`awards`クエリは`app/labels/[id]/page.tsx`の48-64行目で取得済みのものをそのまま渡す。

```tsx
import Link from 'next/link'
import { buildLabelTimeline, type LabelTimelineInput } from '@/utils/labelTimeline'
import { formatDate } from '@/utils/format'

type FounderRow = { role: string | null; person: { name: string } | { name: string }[] | null }
type RosterRow = {
  start_date: string | null
  end_date: string | null
  artist: { id: string; name: string } | { id: string; name: string }[] | null
}
type CatalogRow = {
  id: string
  title: string
  release_date: string | null
  artist: { id: string; name: string } | { id: string; name: string }[] | null
}
type AwardRow = {
  year: number
  category: string | null
  result: string | null
  award: { name: string } | { name: string }[] | null
  artist: { name: string } | { name: string }[] | null
  album: { title: string } | { title: string }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

const KIND_ICON: Record<string, string> = {
  founded: '🏷️',
  founder: '👤',
  joined: '➕',
  left: '➖',
  release: '💿',
  award: '🏆',
}

export default function LabelTimeline({
  foundedYear,
  founders,
  roster,
  catalog,
  awards,
}: {
  foundedYear: number | null
  founders: FounderRow[]
  roster: RosterRow[]
  catalog: CatalogRow[]
  awards: AwardRow[]
}) {
  const input: LabelTimelineInput = {
    foundedYear,
    founders: founders.map((f) => ({ name: firstOf(f.person)?.name ?? '', role: f.role })).filter((f) => f.name),
    roster: roster
      .map((r) => {
        const artist = firstOf(r.artist)
        return artist
          ? { artistId: artist.id, artistName: artist.name, startDate: r.start_date, endDate: r.end_date }
          : null
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
    catalog: catalog
      .map((c) => {
        const artist = firstOf(c.artist)
        return artist
          ? { albumId: c.id, albumTitle: c.title, artistName: artist.name, releaseDate: c.release_date }
          : null
      })
      .filter((c): c is NonNullable<typeof c> => c !== null),
    awards: awards.map((a) => ({
      year: a.year,
      awardName: firstOf(a.award)?.name ?? '',
      category: a.category,
      result: a.result,
      subjectName: firstOf(a.artist)?.name ?? firstOf(a.album)?.title ?? '',
    })),
  }

  const entries = buildLabelTimeline(input)

  if (entries.length === 0) {
    return <p className="mt-4 text-sm text-white/40">まだ年表に表示できる出来事が登録されていません。</p>
  }

  return (
    <ul className="mt-4 space-y-3 border-l border-white/10 pl-4 text-sm">
      {entries.map((entry, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[21px] top-0.5 text-xs">{KIND_ICON[entry.kind]}</span>
          <span className="text-xs text-white/40">{formatDate(entry.date)}</span>{' '}
          {entry.href ? (
            <Link href={entry.href} className="text-white/80 hover:text-white">
              {entry.title}
            </Link>
          ) : (
            <span className="text-white/80">{entry.title}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: `app/labels/[id]/page.tsx`に組み込む**

4行目のimportに追記:

```ts
import { formatDate } from '@/utils/format'
```

を

```ts
import { formatDate } from '@/utils/format'
import LabelTimeline from './LabelTimeline'
```

に変更する。

77-79行目の`description`表示ブロックの直後(`founders`セクションの直前)に追記:

```tsx
      <section className="mt-8">
        <h2 className="text-lg font-semibold">年表</h2>
        <LabelTimeline
          foundedYear={label.founded_year}
          founders={founders ?? []}
          roster={roster ?? []}
          catalog={catalog ?? []}
          awards={awards ?? []}
        />
      </section>
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npx tsc --noEmit -p .`
Expected: エラー無し

- [ ] **Step 4: ローカルで動作確認する**

Run: `npm run dev`(バックグラウンド起動)。Task 3で登録したMotownのレーベルIDをSupabaseで確認し(`select id from label where name = 'Motown'`)、`/labels/{id}`にBasic認証ヘッダー付きでアクセスして「年表」セクションに「レーベル発足」の行が`1959.01.01`で出ることを確認する。所属アーティストやアルバムを紐付けていない場合は発足行のみで問題ない。確認後`pkill -f "next dev"`でdevサーバーを止める

- [ ] **Step 5: コミット**

```bash
git add app/labels/[id]/LabelTimeline.tsx app/labels/[id]/page.tsx
git commit -m "feat: add label timeline section to label detail page"
```

---

### Task 6: デプロイと本番確認

**Files:** なし(デプロイ作業のみ)

**Interfaces:** なし

- [ ] **Step 1: 全体の型チェックとテストを実行する**

Run: `npx tsc --noEmit -p . && npm test`
Expected: 全てPASS

- [ ] **Step 2: 本番デプロイする**

Run: `env -u VERCEL_OIDC_TOKEN npx vercel --prod --yes`

- [ ] **Step 3: 本番で動作確認する**

Basic認証ヘッダー付きcurlで`/admin/data/labels`にアクセスし、MusicBrainz検索フォームが表示されることを確認する。実際に1レーベル(例: Motown)を検索して登録し、`/labels/{id}`で年表セクションが表示されることを確認する
