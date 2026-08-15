# アーティスト/メンバーページ区分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** バンドメンバーとして自動昇格した`artist`行のうち、本人名義のリリース実績が無いもの(=ソロデビューしていないメンバー)を、フルアーティストページではなく軽量な「メンバーページ」テンプレートで表示し、一覧・検索からは除外する。

**Architecture:** `artist.page_override`(手動上書き)と本人名義の album/track の有無から`utils/artistPageKind.ts`の`resolveArtistPageKind`が'artist'/'member'を判定する。URLは`/artists/[id]`のまま、`app/artists/[id]/page.tsx`が判定結果でセクションの出し分けを行う(member判定時はDiscography/Live/Awards/MVを省略し、代わりに`artist_credit`をartist_id軸で引いたCreditsセクションを表示)。一覧(`app/artists/page.tsx`)・検索(`app/search/actions.ts`)は`getReleaseArtistIdSet`+`filterPublicArtists`でmember判定のidを除外する。管理画面(`app/admin/data/artists/[id]/edit/page.tsx`)に`page_override`の3択(自動判定/アーティスト固定/メンバー固定)を追加する。

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase (`@supabase/ssr`のRLS対応クライアントで読み取り、`createAdminClient`のservice_roleクライアントで書き込み)、Tailwind CSS v4。

**Spec:** `docs/superpowers/specs/2026-08-15-artist-member-page-design.md`

## Global Constraints

- **DBマイグレーションは適用済み。新規タスクを作らないこと。** Supabaseプロジェクト`ftvhglfthbcxhgnoninv`に以下を適用済み:
  - `artist`テーブルに`page_override text`列を追加(`check (page_override in ('artist', 'member'))`、null許容・既定値null)。
- 判定は「`page_override`が設定されていればそれに従う。未設定なら本人名義の album(`album.artist_id`)または track(`track.artist_id`)が1件以上あれば'artist'、無ければ'member'」の1本のロジックのみ(`resolveArtistPageKind`)。この判定ロジックを複数箇所に重複実装しないこと。
- ソロデビュー判定にクレジット実績(producer/composer等)を含めない。クレジットは表示情報としてのみ使う。
- URLは`/artists/[id]`のまま変更しない。`/members/[id]`のような別ルートは作らない。
- 一覧・検索からの除外対象は`app/artists/page.tsx`(アーティスト一覧)と`app/search/actions.ts`(検索)の2箇所のみ。`app/relations/page.tsx`(総合相関図)・`app/artists/unreleased/page.tsx`・`app/tracks/page.tsx`・`app/map/page.tsx`は対象外(いずれも本人名義のリリースが無いメンバーは元々ヒットしない、または相関図としてメンバーを含めて表示する方が自然なため、変更しない)。
- 自動テストは追加しない(既存の検証スタイルに合わせる)。検証は`npx tsc --noEmit`と開発サーバーでの実機確認で行う。

---

### Task 1: 判定ロジックのヘルパーモジュール + ラベル定義

**Files:**
- Create: `utils/artistPageKind.ts`
- Modify: `utils/format.ts`(末尾に追加)

**Interfaces:**
- Produces:
  - `utils/artistPageKind.ts`: `export type ArtistPageKind = 'artist' | 'member'`
  - `export function resolveArtistPageKind(pageOverride: string | null, hasOwnRelease: boolean): ArtistPageKind`
  - `export async function getReleaseArtistIdSet(supabase: SupabaseClient): Promise<Set<string>>`
  - `export function filterPublicArtists<T extends { id: string; page_override: string | null }>(rows: T[], releaseArtistIds: Set<string>): T[]`
  - `utils/format.ts`: `export const PAGE_OVERRIDE_LABEL: Record<string, string>`

- [ ] **Step 1: `utils/artistPageKind.ts`を作成する**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type ArtistPageKind = 'artist' | 'member'

export function resolveArtistPageKind(pageOverride: string | null, hasOwnRelease: boolean): ArtistPageKind {
  if (pageOverride === 'artist' || pageOverride === 'member') return pageOverride
  return hasOwnRelease ? 'artist' : 'member'
}

export async function getReleaseArtistIdSet(supabase: SupabaseClient): Promise<Set<string>> {
  const [{ data: albumRows }, { data: trackRows }] = await Promise.all([
    supabase.from('album').select('artist_id'),
    supabase.from('track').select('artist_id').not('artist_id', 'is', null),
  ])

  const ids = new Set<string>()
  for (const row of albumRows ?? []) {
    if (row.artist_id) ids.add(row.artist_id)
  }
  for (const row of trackRows ?? []) {
    if (row.artist_id) ids.add(row.artist_id)
  }
  return ids
}

export function filterPublicArtists<T extends { id: string; page_override: string | null }>(
  rows: T[],
  releaseArtistIds: Set<string>
): T[] {
  return rows.filter((row) => resolveArtistPageKind(row.page_override, releaseArtistIds.has(row.id)) === 'artist')
}
```

- [ ] **Step 2: `utils/format.ts`の末尾に追記する**

```ts

export const PAGE_OVERRIDE_LABEL: Record<string, string> = {
  artist: 'アーティストとして表示',
  member: 'メンバーとして表示',
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: 動作確認(使い捨てスクリプト)**

`/private/tmp/claude-501/-Users-th-dev-music-synapse/3ee696e2-2617-46fa-bd22-1e76a75c01e8/scratchpad/`に一時ファイルを置いて確認する:

```bash
npx tsx -e "
import('/Users/th/dev/music-synapse/utils/artistPageKind.ts').then((m) => {
  console.log(m.resolveArtistPageKind(null, false)) // 'member'
  console.log(m.resolveArtistPageKind(null, true))  // 'artist'
  console.log(m.resolveArtistPageKind('artist', false)) // 'artist'(上書き優先)
  console.log(m.resolveArtistPageKind('member', true))  // 'member'(上書き優先)
})
"
```

Expected: コメント通りの出力(member, artist, artist, member)

- [ ] **Step 5: コミット**

```bash
git add utils/artistPageKind.ts utils/format.ts
git commit -m "feat: add artist/member page kind resolution helper"
```

---

### Task 2: アーティスト詳細ページのkind別描画(メンバー用Creditsセクション追加)

**Files:**
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Consumes: `resolveArtistPageKind`(Task 1、`@/utils/artistPageKind`)

**注記(設計時の訂正)**: 当初`artist_credit`テーブルを`artist_id`=このメンバーのidで引く想定だったが、`artist_credit.artist_id`は「クレジットされた作品を持つアーティスト(album/trackの主アーティスト)」を指す列であり、クレジット対象人物(プロデューサー等)のIDではない。`utils/creditImport.ts:93-128`(`writeAlbumCredits`)を確認した結果、クレジット対象人物が既存の`artist`行と一致する場合(`artistMatchColumn`でMBID/Discogs IDが一致)は、`artist_credit`ではなく`artist_relation`(`relation_type='production'`)に書き込まれる。したがって、メンバー本人が誰かの作品のプロデュース等に関わった実績は`artist_relation`側から取得する必要がある。`artist_id_a`/`artist_id_b`は`[matchedArtist.id, artistId].sort()`でアルファベット順に格納されており(`creditImport.ts:105`)、どちら側が「クレジット対象人物」かを列だけから判別することはできない。ただし本セクションは`kind === 'member'`(=本人名義のalbum/trackを持たない)の場合にのみ表示するため、このメンバーが`relation_type='production'`の関係に登場する時点で「作品を所有する側」ではあり得ず、必ず「クレジット対象人物側」であることが論理的に保証される。そのため、`artist_id_a`/`artist_id_b`のどちらがこのメンバーのidかを判定し、常に「もう一方」を実績の対象アーティストとして扱えばよい。

- [ ] **Step 1: importを変更する**

現在の11〜13行目:

```tsx
import RelationGraph from '@/app/components/RelationGraph'
import { buildArtistRelationGraph } from '@/utils/relationGraphData'
import ArtistLinkIcons from '@/app/components/ArtistLinkIcons'
```

これを次のように変更する:

```tsx
import RelationGraph from '@/app/components/RelationGraph'
import { buildArtistRelationGraph } from '@/utils/relationGraphData'
import ArtistLinkIcons from '@/app/components/ArtistLinkIcons'
import { resolveArtistPageKind } from '@/utils/artistPageKind'
```

- [ ] **Step 2: データ取得にtrack件数を追加する**

現在の33〜83行目:

```tsx
  const [
    [
      { data: artist, error },
      { data: albums },
      { data: musicEvents },
      { data: eventAppearances },
      { data: externalLinks },
      { data: awardEntries },
      { data: membershipRows },
    ],
    relationGraph,
  ] = await Promise.all([
    Promise.all([
      supabase.from('artist').select('*').eq('id', id).single(),
      supabase
        .from('album')
        .select('id, title, jacket_url, release_date, album_type, streaming_status')
        .eq('artist_id', id)
        .order('release_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('music_event')
        .select('id, name, event_date, venue')
        .eq('artist_id', id)
        .order('event_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('event_appearance')
        .select('id, stage, venue, is_headliner, event_edition:event_edition_id(year, venue, event:event_id(name))')
        .eq('artist_id', id),
      supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', id).order('link_type', { ascending: true }).order('url', { ascending: true }),
      supabase
        .from('award_entry')
        .select('id, year, category, result, award:award_id(name)')
        .eq('artist_id', id)
        .order('year', { ascending: false }),
      supabase
        .from('artist_relation')
        .select(
          'id, description, band:artist_id_a(id, name, image_url), member:artist_id_b(id, name, image_url)'
        )
        .eq('relation_type', 'membership')
        .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`),
    ]),
    (async () => {
      const { data: nameRow } = await supabase.from('artist').select('name').eq('id', id).single()
      return buildArtistRelationGraph(supabase, id, nameRow?.name ?? '')
    })(),
  ])

  if (error || !artist) {
    notFound()
  }
```

これを次のように変更する(内側の`Promise.all`にtrack件数取得を追加し、`kind`を計算する):

```tsx
  const [
    [
      { data: artist, error },
      { data: albums },
      { data: musicEvents },
      { data: eventAppearances },
      { data: externalLinks },
      { data: awardEntries },
      { data: membershipRows },
      { count: trackCount },
    ],
    relationGraph,
  ] = await Promise.all([
    Promise.all([
      supabase.from('artist').select('*').eq('id', id).single(),
      supabase
        .from('album')
        .select('id, title, jacket_url, release_date, album_type, streaming_status')
        .eq('artist_id', id)
        .order('release_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('music_event')
        .select('id, name, event_date, venue')
        .eq('artist_id', id)
        .order('event_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('event_appearance')
        .select('id, stage, venue, is_headliner, event_edition:event_edition_id(year, venue, event:event_id(name))')
        .eq('artist_id', id),
      supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', id).order('link_type', { ascending: true }).order('url', { ascending: true }),
      supabase
        .from('award_entry')
        .select('id, year, category, result, award:award_id(name)')
        .eq('artist_id', id)
        .order('year', { ascending: false }),
      supabase
        .from('artist_relation')
        .select(
          'id, description, band:artist_id_a(id, name, image_url), member:artist_id_b(id, name, image_url)'
        )
        .eq('relation_type', 'membership')
        .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`),
      supabase.from('track').select('id', { count: 'exact', head: true }).eq('artist_id', id),
    ]),
    (async () => {
      const { data: nameRow } = await supabase.from('artist').select('name').eq('id', id).single()
      return buildArtistRelationGraph(supabase, id, nameRow?.name ?? '')
    })(),
  ])

  if (error || !artist) {
    notFound()
  }

  const hasOwnRelease = (albums?.length ?? 0) > 0 || (trackCount ?? 0) > 0
  const kind = resolveArtistPageKind(artist.page_override, hasOwnRelease)
```

- [ ] **Step 3: メンバー用の制作クレジット取得ロジックを追加する**

現在の86〜100行目(`mvVideoId`の宣言と`members`/`belongsToBands`の計算)の直後、`appearances`の計算(現在102〜115行目)の前に、次のブロックを追加する:

```tsx

  // kind==='member'の場合、本人名義のalbum/trackが無いため、
  // production関係に登場する時点で必ず「クレジット対象人物側」である
  // (album/trackを所有する側になることがない)。そのため相手側を
  // 常に「実績の対象アーティスト」として扱ってよい(詳細はTask 2の注記を参照)
  const productionCredits: { id: string; artistId: string; artistName: string; description: string | null }[] = []
  if (kind === 'member') {
    const { data: productionRows } = await supabase
      .from('artist_relation')
      .select('id, description, artist_a:artist_id_a(id, name), artist_b:artist_id_b(id, name)')
      .eq('relation_type', 'production')
      .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`)
    for (const row of productionRows ?? []) {
      const a = Array.isArray(row.artist_a) ? row.artist_a[0] : row.artist_a
      const b = Array.isArray(row.artist_b) ? row.artist_b[0] : row.artist_b
      if (!a || !b) continue
      const other = a.id === id ? b : a
      productionCredits.push({ id: row.id, artistId: other.id, artistName: other.name, description: row.description })
    }
  }
```

- [ ] **Step 4: Live & Festivalsセクションをkind==='artist'限定にする**

現在の195〜237行目全体(`<SectionDivider label="Live & Festivals" />`から続くdivの閉じタグまで)を、`{kind === 'artist' && ( ... )}`で包む。中身は変更しない。冒頭と末尾のみ変更:

```tsx
      {kind === 'artist' && (
        <>
          <SectionDivider label="Live & Festivals" />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
```

(中略、既存の中身そのまま)

```tsx
          </div>
        </>
      )}
```

- [ ] **Step 5: Discographyセクションをkind==='artist'限定にする**

現在の239〜277行目全体(`<SectionDivider label="Discography" />`から続くブロックの閉じ`)}`まで)を、同様に`{kind === 'artist' && ( ... )}`で包む。冒頭:

```tsx
      {kind === 'artist' && (
        <>
          <SectionDivider label="Discography" />
```

末尾(現在の277行目`)}`の直後):

```tsx
        </>
      )}
```

- [ ] **Step 6: Membersセクションの直後にCreditsセクションを追加する**

現在の279〜307行目(Membersセクション)はそのまま変更しない。その直後(308行目の空行の位置)に、次のセクションを追加する:

```tsx

      {kind === 'member' && productionCredits.length > 0 && (
        <>
          <SectionDivider label="Credits" />
          <ul className="mt-4 space-y-2 text-sm">
            {productionCredits.map((credit) => (
              <li key={credit.id}>
                <Link href={`/artists/${credit.artistId}`} className="hover:text-white/70">
                  {credit.artistName}
                </Link>
                {credit.description && <span className="text-white/40"> ・ {credit.description}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
```

(`Link`はファイル冒頭1行目で既にimport済みのため、新規importは不要)

- [ ] **Step 7: Awardsセクションをkind==='artist'限定にする**

現在の309〜333行目全体(`{awardEntries && awardEntries.length > 0 && ( ... )}`)を、次のように条件を追加する:

```tsx
      {kind === 'artist' && awardEntries && awardEntries.length > 0 && (
```

(以降の中身・閉じタグは変更しない)

- [ ] **Step 8: Latest MVセクションをkind==='artist'限定にする**

現在の335〜349行目全体(`{mvVideoId && ( ... )}`)を、次のように条件を追加する:

```tsx
      {kind === 'artist' && mvVideoId && (
```

(以降の中身・閉じタグは変更しない)

- [ ] **Step 9: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 10: 開発サーバーで実機確認**

`npm run dev`で起動し、Supabase MCPの`execute_sql`で以下を実行してテスト対象を選ぶ:

```sql
select a.id, a.name
from artist a
where a.page_override is null
  and not exists (select 1 from album where artist_id = a.id)
  and not exists (select 1 from track where artist_id = a.id)
limit 3;
```

1. 上記で見つかったリリース実績の無いバンドメンバーの`/artists/[id]`を開き、Live & Festivals/Discography/Awards/Latest MVセクションが表示されないこと、Biography・所属バンドバッジ・Relation Graphは表示されることを確認
2. `relation_type='production'`の`artist_relation`行が無ければ、Supabase MCPの`execute_sql`で該当メンバーidを使い1件作成して用意する(実データとして残しても問題ない):
   ```sql
   insert into artist_relation (artist_id_a, artist_id_b, relation_type, relation_style, description)
   values ('<このメンバーのid>', '<適当な既存artistのid>', 'production', 'solid', null)
   on conflict (artist_id_a, artist_id_b, relation_type) do nothing;
   ```
   このメンバーのページを開き、Creditsセクションに相手アーティスト名がリンク付きで表示されることを確認
3. リリース実績のある通常のアーティストページ(例: King Gnu)を開き、これまで通りDiscography等の全セクションが表示されることを確認(回帰確認)

- [ ] **Step 11: コミット**

```bash
git add app/artists/\[id\]/page.tsx
git commit -m "feat: render lightweight member page for release-less band members"
```

---

### Task 3: 一覧・検索からのメンバー除外

**Files:**
- Modify: `app/artists/page.tsx`
- Modify: `app/search/actions.ts`

**Interfaces:**
- Consumes: `getReleaseArtistIdSet`, `filterPublicArtists`(Task 1、`@/utils/artistPageKind`)

- [ ] **Step 1: `app/artists/page.tsx`を変更する**

ファイル全体を次の内容に置き換える:

```tsx
import { createClient } from '@/utils/Supabase/server'
import { getReleaseArtistIdSet, filterPublicArtists } from '@/utils/artistPageKind'
import ArtistBrowseClient from './ArtistBrowseClient'

export default async function ArtistsPage() {
  const supabase = await createClient()

  const [{ data }, releaseArtistIds] = await Promise.all([
    supabase.from('artist').select('id, name, name_kana, name_en, image_url, page_override'),
    getReleaseArtistIdSet(supabase),
  ])

  const artists = filterPublicArtists(data ?? [], releaseArtistIds).sort((a, b) =>
    (a.name_kana ?? a.name).localeCompare(b.name_kana ?? b.name, 'ja')
  )

  return <ArtistBrowseClient artists={artists} />
}
```

- [ ] **Step 2: `app/search/actions.ts`を変更する**

ファイル全体を次の内容に置き換える:

```ts
'use server'

import { createClient } from '@/utils/Supabase/server'
import { getReleaseArtistIdSet, filterPublicArtists } from '@/utils/artistPageKind'

export async function search(query: string) {
  const trimmed = query.trim()
  if (!trimmed) {
    return { artists: [], albums: [], error: null }
  }

  const supabase = await createClient()

  const [artistResult, albumResult, releaseArtistIds] = await Promise.all([
    supabase
      .from('artist')
      .select('id, name, name_kana, name_en, page_override')
      .ilike('name', `%${trimmed}%`)
      .limit(20),
    supabase
      .from('album')
      .select('id, title, title_kana, jacket_url, artist:artist_id(id, name)')
      .ilike('title', `%${trimmed}%`)
      .limit(20),
    getReleaseArtistIdSet(supabase),
  ])

  if (artistResult.error) {
    return { artists: [], albums: [], error: artistResult.error.message }
  }

  const artists = filterPublicArtists(artistResult.data ?? [], releaseArtistIds)

  if (albumResult.error) {
    return { artists, albums: [], error: albumResult.error.message }
  }

  return { artists, albums: albumResult.data, error: null }
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: 開発サーバーで実機確認**

1. `/artists`を開き、Task 2で確認したリリース実績の無いメンバーが一覧に出ないこと、リリースのある通常のアーティストは引き続き出ることを確認
2. トップページ等の検索フォームで、リリース実績の無いメンバーの名前を検索してもヒットしないこと、通常のアーティスト名では従来通りヒットすることを確認
3. 管理画面(Task 4実装後でよい)から`page_override='artist'`を手動設定したメンバーが、一覧・検索に出るようになることを確認(このステップはTask 4完了後に再確認する)

- [ ] **Step 5: コミット**

```bash
git add app/artists/page.tsx app/search/actions.ts
git commit -m "feat: exclude release-less band members from artist listing and search"
```

---

### Task 4: 管理画面にページ種別の手動上書きUIを追加

**Files:**
- Modify: `app/admin/data/artists/[id]/edit/page.tsx`
- Modify: `app/admin/data/actions.ts:57-109`(`updateArtist`)

**Interfaces:**
- Consumes: `PAGE_OVERRIDE_LABEL`(Task 1、`@/utils/format`)

- [ ] **Step 1: `app/admin/data/artists/[id]/edit/page.tsx`のimportを変更する**

現在の4行目:

```tsx
import { ARTIST_TYPE_LABEL, ARTIST_STREAMING_STATUS_LABEL, STREAMING_STATUS_LABEL } from '@/utils/format'
```

これを次のように変更する:

```tsx
import { ARTIST_TYPE_LABEL, ARTIST_STREAMING_STATUS_LABEL, STREAMING_STATUS_LABEL, PAGE_OVERRIDE_LABEL } from '@/utils/format'
```

- [ ] **Step 2: 種別/結成年/配信状況の行にページ種別セレクトを追加する**

現在の84〜111行目:

```tsx
        <div className="flex flex-wrap gap-2">
          <div className="max-w-[160px] flex-1">
            <label className="mb-1 block text-xs text-white/40">種別</label>
            <select name="artist_type" defaultValue={artist.artist_type ?? ''} className={inputClass}>
              <option value="">未設定</option>
              {Object.entries(ARTIST_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="max-w-[140px] flex-1">
            <label className="mb-1 block text-xs text-white/40">結成年</label>
            <input name="formed_year" type="number" defaultValue={artist.formed_year ?? ''} className={inputClass} />
          </div>
          <div className="max-w-[160px] flex-1">
            <label className="mb-1 block text-xs text-white/40">配信状況</label>
            <select name="streaming_status" defaultValue={artist.streaming_status ?? ''} className={inputClass}>
              <option value="">未設定</option>
              {Object.entries(ARTIST_STREAMING_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
```

これを次のように変更する(末尾に「ページ種別」のセレクトを追加):

```tsx
        <div className="flex flex-wrap gap-2">
          <div className="max-w-[160px] flex-1">
            <label className="mb-1 block text-xs text-white/40">種別</label>
            <select name="artist_type" defaultValue={artist.artist_type ?? ''} className={inputClass}>
              <option value="">未設定</option>
              {Object.entries(ARTIST_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="max-w-[140px] flex-1">
            <label className="mb-1 block text-xs text-white/40">結成年</label>
            <input name="formed_year" type="number" defaultValue={artist.formed_year ?? ''} className={inputClass} />
          </div>
          <div className="max-w-[160px] flex-1">
            <label className="mb-1 block text-xs text-white/40">配信状況</label>
            <select name="streaming_status" defaultValue={artist.streaming_status ?? ''} className={inputClass}>
              <option value="">未設定</option>
              {Object.entries(ARTIST_STREAMING_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="max-w-[200px] flex-1">
            <label className="mb-1 block text-xs text-white/40">ページ種別</label>
            <select name="page_override" defaultValue={artist.page_override ?? ''} className={inputClass}>
              <option value="">自動判定(リリース有無で判定)</option>
              {Object.entries(PAGE_OVERRIDE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
```

- [ ] **Step 3: `app/admin/data/actions.ts`の`updateArtist`を変更する**

現在の64〜101行目:

```ts
  const bio = String(formData.get('bio') ?? '').trim()
  const nameKana = String(formData.get('name_kana') ?? '').trim()
  const nameEn = String(formData.get('name_en') ?? '').trim()
  const artistType = String(formData.get('artist_type') ?? '').trim()
  const formedYearRaw = String(formData.get('formed_year') ?? '').trim()
  const originPrefecture = String(formData.get('origin_prefecture') ?? '').trim()
  const hometownCity = String(formData.get('hometown_city') ?? '').trim()
  const streamingStatus = String(formData.get('streaming_status') ?? '').trim()
  const officialSiteUrl = String(formData.get('official_site_url') ?? '').trim()
  const snsXUrl = String(formData.get('sns_x_url') ?? '').trim()
  const snsInstagramUrl = String(formData.get('sns_instagram_url') ?? '').trim()
  const imageUrl = String(formData.get('image_url') ?? '').trim()
  const spotifyArtistId = String(formData.get('spotify_artist_id') ?? '').trim()
  const urlLatestMv = String(formData.get('url_latest_mv') ?? '').trim()

  const formedYearNum = Number(formedYearRaw)
  const formedYear = formedYearRaw && !Number.isNaN(formedYearNum) ? formedYearNum : null

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('artist')
    .update({
      bio: bio || null,
      name_kana: nameKana || null,
      name_en: nameEn || null,
      artist_type: artistType || null,
      formed_year: formedYear,
      origin_prefecture: originPrefecture || null,
      hometown_city: hometownCity || null,
      streaming_status: streamingStatus || null,
      official_site_url: officialSiteUrl || null,
      sns_x_url: snsXUrl || null,
      sns_instagram_url: snsInstagramUrl || null,
      image_url: imageUrl || null,
      spotify_artist_id: spotifyArtistId || null,
      url_latest_mv: urlLatestMv || null,
    })
    .eq('id', artistId)
```

これを次のように変更する(`pageOverride`の読み取りと更新payloadへの追加):

```ts
  const bio = String(formData.get('bio') ?? '').trim()
  const nameKana = String(formData.get('name_kana') ?? '').trim()
  const nameEn = String(formData.get('name_en') ?? '').trim()
  const artistType = String(formData.get('artist_type') ?? '').trim()
  const formedYearRaw = String(formData.get('formed_year') ?? '').trim()
  const originPrefecture = String(formData.get('origin_prefecture') ?? '').trim()
  const hometownCity = String(formData.get('hometown_city') ?? '').trim()
  const streamingStatus = String(formData.get('streaming_status') ?? '').trim()
  const officialSiteUrl = String(formData.get('official_site_url') ?? '').trim()
  const snsXUrl = String(formData.get('sns_x_url') ?? '').trim()
  const snsInstagramUrl = String(formData.get('sns_instagram_url') ?? '').trim()
  const imageUrl = String(formData.get('image_url') ?? '').trim()
  const spotifyArtistId = String(formData.get('spotify_artist_id') ?? '').trim()
  const urlLatestMv = String(formData.get('url_latest_mv') ?? '').trim()
  const pageOverride = String(formData.get('page_override') ?? '').trim()

  const formedYearNum = Number(formedYearRaw)
  const formedYear = formedYearRaw && !Number.isNaN(formedYearNum) ? formedYearNum : null

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('artist')
    .update({
      bio: bio || null,
      name_kana: nameKana || null,
      name_en: nameEn || null,
      artist_type: artistType || null,
      formed_year: formedYear,
      origin_prefecture: originPrefecture || null,
      hometown_city: hometownCity || null,
      streaming_status: streamingStatus || null,
      official_site_url: officialSiteUrl || null,
      sns_x_url: snsXUrl || null,
      sns_instagram_url: snsInstagramUrl || null,
      image_url: imageUrl || null,
      spotify_artist_id: spotifyArtistId || null,
      url_latest_mv: urlLatestMv || null,
      page_override: pageOverride || null,
    })
    .eq('id', artistId)
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: 開発サーバーで実機確認**

1. Task 2のStep 10で見つけたリリース実績の無いメンバーの編集画面(`/admin/data/artists/[id]/edit`)を開き、「ページ種別」に「自動判定」が選択されていることを確認
2. 「アーティストとして表示」を選んで保存し、`/artists/[id]`がフルアーティストページで表示されること、`/artists`一覧と検索にも出るようになることを確認
3. 「自動判定」に戻して保存し、再びメンバーページ表示・一覧除外に戻ることを確認

- [ ] **Step 6: コミット**

```bash
git add app/admin/data/artists/\[id\]/edit/page.tsx app/admin/data/actions.ts
git commit -m "feat: add manual artist/member page override to admin edit form"
```

---

## Self-Review Notes

- **Spec coverage:** ゴール5点(自動判定+手動上書き、メンバーページテンプレート、URL統一、一覧・検索からの除外、管理画面UI)をTask 1〜4で全てカバー。非ゴール(URL分離、既存データの手動バックフィル、クレジットを判定条件に含めること、`credit_person`との統合、自動昇格ロジック自体の変更)はいずれも実装していない。DBマイグレーションは適用済みとしてGlobal Constraintsに明記し、タスク化していない。
- **Placeholder scan:** なし。全ステップに実コードを記載。
- **Type consistency:** `resolveArtistPageKind(pageOverride: string | null, hasOwnRelease: boolean): ArtistPageKind`(Task 1)のシグネチャを、Task 2(`app/artists/[id]/page.tsx`)・Task 3(`filterPublicArtists`経由)で一貫して使用。`PAGE_OVERRIDE_LABEL`(Task 1で定義)のキー(`artist`/`member`)は`page_override`列のCHECK制約の許可値と一致し、Task 4の`<select>`が生成する値もこの2値のみ。`getReleaseArtistIdSet`/`filterPublicArtists`のシグネチャはTask 1で定義したものをTask 3でそのまま呼び出している。
- **設計時の訂正(Task 2)**: 当初`artist_credit.artist_id`をメンバー本人のidで引く設計だったが、`utils/creditImport.ts`を実装コードで確認した結果、このカラムは「クレジットされた作品を持つアーティスト」を指し、クレジット対象人物ではないことが判明。クレジット対象人物が既存の`artist`行と一致する場合は`artist_relation`(`relation_type='production'`)に書き込まれる方式に合わせ、Task 2 Step 3・6・10を修正済み。
