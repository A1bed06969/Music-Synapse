# アーティスト年表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アーティストのリリース・単独ライブ・フェス出演・タイアップ(新規)を時系列1本にまとめ、アーティストページに横スクロールの年表として表示する。タイアップは管理画面から手動入力する。

**Architecture:** 新規テーブル`tie_up`を1つ追加する以外は、アーティストページが既に取得済みのalbums/musicEvents/eventAppearancesのクエリ結果をそのまま流用する。レーベル年表(`utils/labelTimeline.ts`)と同じ形の純粋マージ関数`buildArtistTimeline`を作り、それを呼ぶサーバーコンポーネントをアーティストページに追加する。

**Tech Stack:** Next.js App Router (Server Actions, Server Components), Supabase, Node built-in test runner (`node --test`)

**Spec:** docs/superpowers/specs/2026-08-19-artist-timeline-design.md

## Global Constraints

- 新規テーブルは`tie_up`のみ(spec「データモデル」参照)。他は既存データの再利用のみ
- タイアップは手動入力のみ(自動取込・自動照合は行わない)
- 横スクロールのカードは均等間隔で時系列順に並べるだけで、実日付に比例した配置や年ラベルのグルーピングはしない(レーベル年表と異なる方針)
- 日付が不明な行(タイアップの`year`未入力、フェス出演の`start_time`未設定等)は年表から除外する。他の既存セクション(Discography/Live & Festivals等)の表示・クエリは変更しない
- `tie_up`はRLSで公開read policyを付ける(公開ページのアーティスト年表から読むため)。insert/update/deleteは管理画面のservice_role経由のみ

---

### Task 1: `tie_up`テーブルの作成

**Files:**
- Create: `supabase/migrations/20260819_create_tie_up.sql`

**Interfaces:**
- Consumes: なし
- Produces: `tie_up`テーブル(列: `id`, `track_id`, `category`, `work_title`, `year`, `note`, `created_at`)。Task 2以降がこのテーブルに対してSELECT/INSERTする

- [ ] **Step 1: マイグレーションファイルを作成する**

`supabase/migrations/20260819_create_tie_up.sql`:

```sql
-- supabase/migrations/20260819_create_tie_up.sql
-- アーティスト年表機能の一部。タイアップ(アニメ/ドラマ/CM等での楽曲使用)は
-- MusicBrainz/Wikidataに日本国内向けの情報がほぼ無く自動取込が難しいため、
-- 管理画面からの手動入力専用テーブルとする。track単位で紐づける
-- (「この曲がアニメOPに使われた」という粒度の情報のため)。

CREATE TABLE tie_up (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('TIE'::text),
  track_id TEXT NOT NULL REFERENCES track(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('anime', 'drama', 'movie', 'cm', 'game', 'other')),
  work_title TEXT NOT NULL,
  year INTEGER,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_tie_up_track_id ON tie_up(track_id);

-- 公開ページ(アーティスト年表)から読むため、event_edition_date等と同じく
-- 公開read policyを付ける(insert/update/deleteは管理画面のservice_role経由のみ)。
ALTER TABLE tie_up ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON tie_up FOR SELECT TO public USING (true);
```

- [ ] **Step 2: Supabase MCPツールでマイグレーションを適用する**

`mcp__claude_ai_Supabase__apply_migration`ツールを、`project_id: "ftvhglfthbcxhgnoninv"`、`name: "create_tie_up"`、`query`にStep 1のSQL本文(ファイルヘッダーのコメント行を除く`CREATE TABLE`以降)を渡して実行する。

- [ ] **Step 3: テーブルが作成されたことを確認する**

`mcp__claude_ai_Supabase__execute_sql`ツールで以下を実行し、空配列(0行)が返ることを確認する(エラーにならなければテーブルは存在する):

```sql
select * from tie_up limit 1;
```

- [ ] **Step 4: コミット**

```bash
git add supabase/migrations/20260819_create_tie_up.sql
git commit -m "feat: add tie_up table for artist timeline"
```

---

### Task 2: 年表マージロジック(純粋関数)

**Files:**
- Create: `utils/artistTimeline.ts`
- Test: `__tests__/artist-timeline.unit.test.ts`

**Interfaces:**
- Consumes: なし(純粋関数、外部依存無し)
- Produces:
  ```ts
  export type ArtistTimelineEntry = {
    date: string // 'YYYY-MM-DD'
    kind: 'release' | 'live' | 'festival' | 'tieup'
    title: string
    subtitle: string | null
    href: string | null
    imageUrl: string | null
  }
  export type ArtistTimelineInput = {
    releases: { albumId: string; title: string; releaseDate: string | null; jacketUrl: string | null }[]
    lives: { id: string; name: string; eventDate: string | null; venue: string | null }[]
    festivals: { appearanceId: number; eventName: string; startTime: string | null; venue: string | null }[]
    tieUps: { id: string; trackTitle: string; category: string; workTitle: string; year: number | null; albumId: string | null }[]
  }
  export function buildArtistTimeline(input: ArtistTimelineInput): ArtistTimelineEntry[]
  ```
  Task 4の`ArtistTimeline.tsx`がこの型と関数をインポートして使う

- [ ] **Step 1: 失敗するテストを書く**

`__tests__/artist-timeline.unit.test.ts`を新規作成:

```ts
// __tests__/artist-timeline.unit.test.ts
//
// アーティスト年表のマージ・ソートロジックのユニットテスト。DB/サーバ不要、純粋関数のみ。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildArtistTimeline } from '../utils/artistTimeline.ts'

describe('buildArtistTimeline', () => {
  test('orders releases, lives, festivals, and tie-ups chronologically', () => {
    const entries = buildArtistTimeline({
      releases: [{ albumId: 'al1', title: 'First Album', releaseDate: '2019-03-01', jacketUrl: 'https://example.com/jacket.jpg' }],
      lives: [{ id: 'ev1', name: 'ワンマンライブ', eventDate: '2020-06-15', venue: '渋谷クラブクアトロ' }],
      festivals: [{ appearanceId: 1, eventName: 'SUMMER SONIC', startTime: '2021-08-14T12:00:00+09:00', venue: 'ZOZOマリンスタジアム' }],
      tieUps: [{ id: 'tie1', trackTitle: 'テーマ曲', category: 'anime', workTitle: '鬼滅の刃', year: 2019, albumId: 'al1' }],
    })

    assert.deepEqual(
      entries.map((e) => [e.date, e.kind]),
      [
        ['2019-01-01', 'tieup'],
        ['2019-03-01', 'release'],
        ['2020-06-15', 'live'],
        ['2021-08-14', 'festival'],
      ]
    )
    assert.equal(entries[0].title, 'テーマ曲')
    assert.equal(entries[0].subtitle, '鬼滅の刃')
    assert.equal(entries[0].href, '/albums/al1')
    assert.equal(entries[1].title, 'First Album')
    assert.equal(entries[1].href, '/albums/al1')
    assert.equal(entries[1].imageUrl, 'https://example.com/jacket.jpg')
    assert.equal(entries[2].title, 'ワンマンライブ')
    assert.equal(entries[2].subtitle, '渋谷クラブクアトロ')
    assert.equal(entries[3].title, 'SUMMER SONIC')
    assert.equal(entries[3].subtitle, 'ZOZOマリンスタジアム')
  })

  test('omits entries with no resolvable date', () => {
    const entries = buildArtistTimeline({
      releases: [{ albumId: 'al1', title: 'No Date', releaseDate: null, jacketUrl: null }],
      lives: [{ id: 'ev1', name: 'No Date Live', eventDate: null, venue: null }],
      festivals: [{ appearanceId: 1, eventName: 'No Date Fes', startTime: null, venue: null }],
      tieUps: [{ id: 'tie1', trackTitle: 'No Year', category: 'cm', workTitle: 'XYZ', year: null, albumId: null }],
    })
    assert.deepEqual(entries, [])
  })

  test('tie-up without an album has no href', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [],
      tieUps: [{ id: 'tie1', trackTitle: 'テーマ曲', category: 'drama', workTitle: 'XYZ', year: 2022, albumId: null }],
    })
    assert.equal(entries[0].href, null)
  })

  test('festival date is derived from startTime date portion only (drops time-of-day)', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [{ appearanceId: 1, eventName: 'FUJI ROCK', startTime: '2026-07-25T15:30:00+09:00', venue: null }],
      tieUps: [],
    })
    assert.equal(entries[0].date, '2026-07-25')
  })
})
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -- --test-name-pattern buildArtistTimeline`
Expected: FAIL(`Cannot find module '../utils/artistTimeline.ts'`)

- [ ] **Step 3: 実装する**

`utils/artistTimeline.ts`を新規作成:

```ts
const CATEGORY_LABEL: Record<string, string> = {
  anime: 'アニメ',
  drama: 'ドラマ',
  movie: '映画',
  cm: 'CM',
  game: 'ゲーム',
  other: 'タイアップ',
}

export type ArtistTimelineEntry = {
  date: string
  kind: 'release' | 'live' | 'festival' | 'tieup'
  title: string
  subtitle: string | null
  href: string | null
  imageUrl: string | null
}

export type ArtistTimelineInput = {
  releases: { albumId: string; title: string; releaseDate: string | null; jacketUrl: string | null }[]
  lives: { id: string; name: string; eventDate: string | null; venue: string | null }[]
  festivals: { appearanceId: number; eventName: string; startTime: string | null; venue: string | null }[]
  tieUps: { id: string; trackTitle: string; category: string; workTitle: string; year: number | null; albumId: string | null }[]
}

/** アーティストページが既に取得済みのデータを、日付が分かる出来事だけ時系列1本の
 * リストへマージする。日付を持たない行(タイアップのyear未入力、フェス出演の
 * start_time未設定等)は年表からは除外する(既存の各セクション側には引き続き表示される)。 */
export function buildArtistTimeline(input: ArtistTimelineInput): ArtistTimelineEntry[] {
  const entries: ArtistTimelineEntry[] = []

  for (const release of input.releases) {
    if (!release.releaseDate) continue
    entries.push({
      date: release.releaseDate,
      kind: 'release',
      title: release.title,
      subtitle: null,
      href: `/albums/${release.albumId}`,
      imageUrl: release.jacketUrl,
    })
  }

  for (const live of input.lives) {
    if (!live.eventDate) continue
    entries.push({
      date: live.eventDate,
      kind: 'live',
      title: live.name,
      subtitle: live.venue,
      href: null,
      imageUrl: null,
    })
  }

  for (const festival of input.festivals) {
    if (!festival.startTime) continue
    entries.push({
      date: festival.startTime.slice(0, 10),
      kind: 'festival',
      title: festival.eventName,
      subtitle: festival.venue,
      href: null,
      imageUrl: null,
    })
  }

  for (const tieUp of input.tieUps) {
    if (!tieUp.year) continue
    entries.push({
      date: `${tieUp.year}-01-01`,
      kind: 'tieup',
      title: tieUp.trackTitle,
      subtitle: `${tieUp.workTitle}(${CATEGORY_LABEL[tieUp.category] ?? tieUp.category})`,
      href: tieUp.albumId ? `/albums/${tieUp.albumId}` : null,
      imageUrl: null,
    })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date))
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test -- --test-name-pattern buildArtistTimeline`
Expected: PASS(4件とも)

- [ ] **Step 5: コミット**

```bash
git add utils/artistTimeline.ts __tests__/artist-timeline.unit.test.ts
git commit -m "feat: add artist timeline merge logic"
```

---

### Task 3: タイアップ登録の管理画面

**Files:**
- Create: `app/admin/data/tieups/actions.ts`
- Create: `app/admin/data/tieups/page.tsx`

**Interfaces:**
- Consumes: `searchTracks`(`@/app/admin/data/actions`から既存、`(query: string) => Promise<{id: string; label: string}[]>`)、`SearchableSelect`(`@/app/admin/data/SearchableSelect`から既存)、`inputClass`/`buttonClass`(`@/app/admin/data/adminUi`から既存)
- Produces: なし(末端の管理画面ページ)。Task 1の`tie_up`テーブルにINSERTする

- [ ] **Step 1: サーバーアクションを作成する**

`app/admin/data/tieups/actions.ts`を新規作成:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/tieups?${result}=${encodeURIComponent(message)}`)
}

export async function createTieUp(formData: FormData) {
  const trackId = String(formData.get('track_id') ?? '')
  const category = String(formData.get('category') ?? '')
  const workTitle = String(formData.get('work_title') ?? '').trim()
  const yearRaw = String(formData.get('year') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!trackId || !category || !workTitle) {
    redirectWith('error', '楽曲・種別・作品名は必須です。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('tie_up').insert({
    track_id: trackId,
    category,
    work_title: workTitle,
    year: yearRaw ? Number(yearRaw) : null,
    note: note || null,
  })

  if (error) {
    redirectWith('error', `タイアップの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/tieups')
  redirectWith('success', `「${workTitle}」のタイアップを登録しました。`)
}
```

- [ ] **Step 2: 管理画面ページを作成する**

`app/admin/data/tieups/page.tsx`を新規作成:

```tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchTracks } from '../actions'
import { createTieUp } from './actions'

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'anime', label: 'アニメ' },
  { value: 'drama', label: 'ドラマ' },
  { value: 'movie', label: '映画' },
  { value: 'cm', label: 'CM' },
  { value: 'game', label: 'ゲーム' },
  { value: 'other', label: 'その他' },
]

export default async function TieUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const { data: tieUps } = await supabase
    .from('tie_up')
    .select('id, category, work_title, year, note, track:track_id(title, artist:artist_id(name))')
    .order('year', { ascending: false, nullsFirst: false })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">タイアップ</h1>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createTieUp} className="mt-6 flex flex-wrap items-center gap-2">
        <SearchableSelect searchAction={searchTracks} name="track_id" placeholder="楽曲を選択" />
        <select name="category" required className={`${inputClass} max-w-[140px]`} defaultValue="">
          <option value="" disabled>
            種別
          </option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input name="work_title" placeholder="作品名" required className={`${inputClass} max-w-xs`} />
        <input name="year" type="number" placeholder="年(任意)" className={`${inputClass} max-w-[120px]`} />
        <input name="note" placeholder="補足(任意、OP/ED等)" className={`${inputClass} max-w-xs`} />
        <button type="submit" className={buttonClass}>
          タイアップを追加
        </button>
      </form>

      {tieUps && tieUps.length > 0 && (
        <ul className="mt-6 space-y-1.5 text-sm text-white/60">
          {tieUps.map((row) => {
            const track = Array.isArray(row.track) ? row.track[0] : row.track
            const artist = track ? (Array.isArray(track.artist) ? track.artist[0] : track.artist) : null
            const categoryLabel = CATEGORY_OPTIONS.find((c) => c.value === row.category)?.label ?? row.category
            return (
              <li key={row.id}>
                {track?.title ?? '(不明な楽曲)'}
                {artist?.name ? ` — ${artist.name}` : ''} 「{row.work_title}」({categoryLabel}
                {row.year ? `・${row.year}年` : ''})
                {row.note ? ` ${row.note}` : ''}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npx tsc --noEmit -p .`
Expected: エラー無し

- [ ] **Step 4: ローカルで動作確認する**

Run: `npm run dev`(バックグラウンド起動)。Basic認証のヘッダーを付けて`/admin/data/tieups`にアクセスし、フォームが表示されることを確認する。楽曲検索欄に何か既存曲のタイトルを入力して候補が出ることを確認する(実際の登録操作は任意)。確認後`pkill -f "next dev"`でdevサーバーを止める

- [ ] **Step 5: コミット**

```bash
git add app/admin/data/tieups/actions.ts app/admin/data/tieups/page.tsx
git commit -m "feat: add tie-up admin registration page"
```

---

### Task 4: アーティストページへの年表組み込み

**Files:**
- Create: `app/artists/[id]/ArtistTimeline.tsx`
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 2の`buildArtistTimeline`・`ArtistTimelineInput`(`@/utils/artistTimeline`からインポート)
- Produces: なし(末端のUIコンポーネント)

- [ ] **Step 1: `ArtistTimeline.tsx`を新規作成する**

`app/artists/[id]/page.tsx`の既存クエリ(`albums`/`musicEvents`/`eventAppearances`、いずれも配列またはオブジェクトで返るPostgREST特有のjoin形)と、Step 2で追加する`tieUps`クエリをそのまま受け取り、コンポーネント内でフラット化してから`buildArtistTimeline`に渡す。

```tsx
import Link from 'next/link'
import { buildArtistTimeline, type ArtistTimelineInput } from '@/utils/artistTimeline'
import { formatDate } from '@/utils/format'

type AlbumRow = { id: string; title: string; jacket_url: string | null; release_date: string | null }
type MusicEventRow = { id: string; name: string; event_date: string | null; venue: string | null }
type EventAppearanceRow = {
  id: number
  venue: string | null
  event_edition: { venue: string | null; event: { name: string } | { name: string }[] | null } | { venue: string | null; event: { name: string } | { name: string }[] | null }[] | null
  start_time: string | null
}
type TieUpRow = {
  id: string
  category: string
  work_title: string
  year: number | null
  track: { title: string; album_id: string | null } | { title: string; album_id: string | null }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

const KIND_ICON: Record<string, string> = {
  release: '💿',
  live: '🎤',
  festival: '🎪',
  tieup: '📺',
}

export default function ArtistTimeline({
  albums,
  musicEvents,
  eventAppearances,
  tieUps,
}: {
  albums: AlbumRow[]
  musicEvents: MusicEventRow[]
  eventAppearances: EventAppearanceRow[]
  tieUps: TieUpRow[]
}) {
  const input: ArtistTimelineInput = {
    releases: albums.map((a) => ({ albumId: a.id, title: a.title, releaseDate: a.release_date, jacketUrl: a.jacket_url })),
    lives: musicEvents.map((e) => ({ id: e.id, name: e.name, eventDate: e.event_date, venue: e.venue })),
    festivals: eventAppearances.map((row) => {
      const edition = firstOf(row.event_edition)
      const event = edition ? firstOf(edition.event) : null
      return {
        appearanceId: row.id,
        eventName: event?.name ?? '—',
        startTime: row.start_time,
        venue: row.venue ?? edition?.venue ?? null,
      }
    }),
    tieUps: tieUps
      .map((t) => {
        const track = firstOf(t.track)
        return track
          ? {
              id: t.id,
              trackTitle: track.title,
              category: t.category,
              workTitle: t.work_title,
              year: t.year,
              albumId: track.album_id,
            }
          : null
      })
      .filter((t): t is NonNullable<typeof t> => t !== null),
  }

  const entries = buildArtistTimeline(input)

  if (entries.length === 0) {
    return <p className="mt-4 text-sm text-white/40">まだ年表に表示できる出来事が登録されていません。</p>
  }

  return (
    <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
      {entries.map((entry, i) => (
        <div key={i} className="block w-32 flex-shrink-0">
          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md bg-white/5 text-2xl">
            {entry.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.imageUrl} alt={entry.title} className="h-full w-full object-cover" />
            ) : (
              <span>{KIND_ICON[entry.kind]}</span>
            )}
          </div>
          <p className="mt-2 text-xs text-white/40">{formatDate(entry.date)}</p>
          {entry.href ? (
            <Link href={entry.href} className="block truncate text-sm font-medium hover:underline">
              {entry.title}
            </Link>
          ) : (
            <p className="truncate text-sm font-medium">{entry.title}</p>
          )}
          {entry.subtitle && <p className="truncate text-xs text-white/40">{entry.subtitle}</p>}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: `app/artists/[id]/page.tsx`の`event_appearance`クエリに`start_time`を追加する**

70行目付近の既存クエリを変更する。変更前:

```ts
      supabase
        .from('event_appearance')
        .select('id, stage, venue, is_headliner, event_edition:event_edition_id(year, venue, event:event_id(name))')
        .eq('artist_id', id),
```

変更後(`start_time`を追加するのみ、他のカラム・既存の`appearances`変数の計算ロジックは一切変更しない):

```ts
      supabase
        .from('event_appearance')
        .select('id, stage, venue, is_headliner, start_time, event_edition:event_edition_id(year, venue, event:event_id(name))')
        .eq('artist_id', id),
```

- [ ] **Step 3: `tieUps`クエリを追加する**

同じ`Promise.all`配列内、Step 2で変更した`event_appearance`クエリのすぐ後(`artist_external_link`クエリの前)に追記する。分割代入の変数リスト(`[{ data: artist, error }, { data: albums }, { data: musicEvents }, { data: eventAppearances }, { data: externalLinks }, { data: awardEntries }, { data: membershipRows }]`)にも`{ data: tieUps }`を`eventAppearances`の直後に追加すること。

追加するクエリ。埋め込んだ`track`テーブルの列(`artist_id`)を条件に絞り込むため、PostgRESTの仕様上`!inner`を付けて内部結合にする必要がある(`!inner`を付けないと`.eq('track.artist_id', id)`が外側の`tie_up`行を絞り込まず、無関係な行まで返ってしまう):

```ts
      supabase
        .from('tie_up')
        .select('id, category, work_title, year, track:track_id!inner(title, album_id, artist_id)')
        .eq('track.artist_id', id),
```

- [ ] **Step 4: importと年表セクションを追加する**

ファイル冒頭のimportに追記:

```ts
import { ALBUM_TYPE_LABEL_JA, ALBUM_TYPE_ORDER, type AlbumType } from '@/utils/albumType'
```

の直後に

```ts
import ArtistTimeline from './ArtistTimeline'
```

を追加する。

`<SectionDivider label="Discography" />`のブロック(既存のディスコグラフィー表示、`{ALBUM_TYPE_ORDER.map(...)}`を含む一連のJSX)の直後、`{members.length > 0 && (`の直前に追記:

```tsx
      <SectionDivider label="Timeline" />
      <ArtistTimeline
        albums={albums ?? []}
        musicEvents={musicEvents ?? []}
        eventAppearances={eventAppearances ?? []}
        tieUps={tieUps ?? []}
      />
```

- [ ] **Step 5: 型チェックを実行する**

Run: `npx tsc --noEmit -p .`
Expected: エラー無し

- [ ] **Step 6: ローカルで動作確認する**

Run: `npm run dev`(バックグラウンド起動)。既にアルバムが登録されているアーティストのIDをSupabaseで確認し(例: `select id from artist where id = 'MS_ART_akt6du2q'` — L'Arc-en-Ciel、85枚のアルバムが登録済み)、`/artists/{id}`にBasic認証ヘッダー付きでアクセスして「Timeline」セクションにリリースのカードが日付付きで並んでいることを確認する。確認後`pkill -f "next dev"`でdevサーバーを止める

- [ ] **Step 7: コミット**

```bash
git add app/artists/[id]/ArtistTimeline.tsx app/artists/[id]/page.tsx
git commit -m "feat: add artist timeline section to artist detail page"
```

---

### Task 5: デプロイと本番確認

**Files:** なし(デプロイ作業のみ)

**Interfaces:** なし

- [ ] **Step 1: 全体の型チェックとテストを実行する**

Run: `npx tsc --noEmit -p . && npm test`
Expected: 全てPASS

- [ ] **Step 2: 本番デプロイする**

Run: `env -u VERCEL_OIDC_TOKEN npx vercel --prod --yes`

- [ ] **Step 3: 本番で動作確認する**

Basic認証ヘッダー付きcurlで`/admin/data/tieups`にアクセスし、フォームが表示されることを確認する。次に、アルバムが登録済みの実在アーティストページ(例: `/artists/MS_ART_akt6du2q`)にアクセスし、「Timeline」セクションが表示され、リリースのカードが日付付きで並んでいることを確認する。
