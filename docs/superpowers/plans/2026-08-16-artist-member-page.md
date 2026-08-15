# アーティスト/メンバーページ区分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** バンドメンバーとして自動昇格した`artist`行のうち、本人名義のリリースが無い(ソロデビューしていない)人を「メンバー」として判定し、`/artists/[id]`で軽量なメンバー用テンプレートを表示する。ソロデビュー済みの人や通常のアーティストは現状のフルページのまま変更しない。判定は自動(本人名義のalbum/trackの有無)＋管理画面での手動上書きの併用とし、一覧・検索からは「メンバー」判定を除外する。

**Architecture:** `utils/artistPageKind.ts`に判定ロジック(`resolveArtistPageKind`)と補助関数(`hasOwnRelease`, `getMemberArtistIds`)を新設する。`app/artists/[id]/page.tsx`はこの判定結果で分岐し、「メンバー」なら新設の`app/artists/[id]/MemberProfile.tsx`(軽量テンプレート、所属バンド一覧+プロデュース/楽曲提供実績を表示)を描画する。プロデュース実績は`artist_credit`ではなく`artist_relation`(`relation_type='production'`、本人が`artist_id_a`側)から取得する — 理由は下記Global Constraints参照。管理画面(`app/admin/data/artists/[id]/edit/page.tsx`)に3択の上書きUIを追加し、公開側の一覧・検索(`app/artists/page.tsx`, `app/search/actions.ts`)から`getMemberArtistIds`で「メンバー」判定のidを除外する。

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase (`@supabase/ssr`のRLS対応クライアントで読み取り、`createAdminClient`のservice_roleクライアントで書き込み)、Tailwind CSS v4。

**Spec:** `docs/superpowers/specs/2026-08-15-artist-member-page-design.md`

## Global Constraints

- **DBマイグレーションは適用済み。新規タスクを作らないこと。** Supabaseプロジェクト`ftvhglfthbcxhgnoninv`の`artist`テーブルに`page_override text`列を追加済み(check制約`artist_page_override_check`で`'artist'`または`'member'`のみ許可、未設定は`NULL`=自動判定)。既存の全行は`NULL`。
- **メンバーのプロデュース/楽曲提供実績のデータソースは`artist_relation`である(`artist_credit`ではない)。** `artist_credit.artist_id`は「クレジット対象の作品を持つアーティスト」を指す列であり、クレジットした本人(メンバー)のIDを指すものではない。メンバー本人は`artist.musicbrainz_id`で既存アーティストとして照合されるため、`utils/creditImport.ts`の既存ロジックにより本人のプロデュース/作曲/作詞等の実績は`artist_relation`(`relation_type='production'`、本人が`artist_id_a`、実績対象アーティストが`artist_id_b`)へ書き込まれる。この経路ではrole(producer/composer/lyricist等)の内訳は失われ一律`'production'`になるため、メンバーページでも「どのアーティストの作品に関わったか」の一覧表示にとどめ、role別の内訳は表示しない。実データ確認済み(例: `artist_id_a`=桜井和寿, `artist_id_b`=Mr.Children, `relation_type`='production')。
- URLは`/artists/[id]`のまま変更しない。`/members/[id]`のような別ルートは作らない。
- `writeArtistProfileFromMusicBrainzDetails`(自動昇格ロジック、`utils/artistProfileImport.ts`)は変更しない。
- 一覧・検索からのメンバー除外は`app/artists/page.tsx`(アーティスト一覧)と`app/search/actions.ts`(サイト内検索)の2箇所のみに適用する。`app/relations/page.tsx`(全アーティスト横断の相関図)は対象外とする — メンバーを除外すると`membership`関係のエッジ自体が描画できなくなるため。`app/map/page.tsx`・`app/tracks/page.tsx`のartist参照は「一覧・検索」ではなく描画用の補助データ取得であり対象外とする。
- 既存データの手動バックフィルは行わない。新規列は全行`NULL`(自動判定)のままで運用する。
- 自動テストは追加しない(既存の検証スタイルに合わせる)。検証は`npx tsc --noEmit`と、開発サーバーでの実機確認(実データ)で行う。
- 検証用の実データ(いずれも本番Supabaseプロジェクトの既存データ、変更・削除は行わない):
  - リリース無しメンバー: 桜井和寿(`MS_ART_j8p31xmu`, Mr.Childrenのメンバー, `artist_relation`に本人発の`production`関係が存在 → Mr.Children)
  - リリース無しメンバー(比較用、別バンド): 鈴木英哉(`MS_ART_382l76i0`)、田原健一(`MS_ART_ia73e2t6`)、中川敬輔(`MS_ART_inuo3udc`) — いずれもMr.Children(`MS_ART_40wvejfq`)のメンバー
  - リリースありメンバー(自動判定で「アーティスト」になるべきケース): A-Trak(`MS_ART_4nkwmv2i`, アルバム112件・トラック267件、Obscure Disorder/Duck Sauceのメンバーでもある)
  - 通常アーティスト(回帰確認用、変更が無いことを確認する対象): King Gnu(`MS_ART_k5fiz18l`)

---

### Task 1: 判定ヘルパー `utils/artistPageKind.ts`

**Files:**
- Create: `utils/artistPageKind.ts`

**Interfaces:**
- Produces:
  - `export type ArtistPageKind = 'artist' | 'member'`
  - `export function resolveArtistPageKind(pageOverride: string | null, ownsRelease: boolean): ArtistPageKind`
  - `export async function hasOwnRelease(supabase: SupabaseClient, artistId: string): Promise<boolean>`
  - `export async function getMemberArtistIds(supabase: SupabaseClient): Promise<Set<string>>`
- Consumes: なし(新規独立モジュール)

- [ ] **Step 1: `utils/artistPageKind.ts`を作成する**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type ArtistPageKind = 'artist' | 'member'

export function resolveArtistPageKind(pageOverride: string | null, ownsRelease: boolean): ArtistPageKind {
  if (pageOverride === 'artist' || pageOverride === 'member') {
    return pageOverride
  }
  return ownsRelease ? 'artist' : 'member'
}

export async function hasOwnRelease(supabase: SupabaseClient, artistId: string): Promise<boolean> {
  const [{ count: albumCount }, { count: trackCount }] = await Promise.all([
    supabase.from('album').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('track').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
  ])
  return (albumCount ?? 0) > 0 || (trackCount ?? 0) > 0
}

export async function getMemberArtistIds(supabase: SupabaseClient): Promise<Set<string>> {
  const [{ data: allArtists }, { data: albumRows }, { data: trackRows }] = await Promise.all([
    supabase.from('artist').select('id, page_override'),
    supabase.from('album').select('artist_id'),
    supabase.from('track').select('artist_id'),
  ])

  const releasedIds = new Set<string>()
  for (const row of albumRows ?? []) releasedIds.add(row.artist_id)
  for (const row of trackRows ?? []) {
    if (row.artist_id) releasedIds.add(row.artist_id)
  }

  const memberIds = new Set<string>()
  for (const artist of allArtists ?? []) {
    if (resolveArtistPageKind(artist.page_override, releasedIds.has(artist.id)) === 'member') {
      memberIds.add(artist.id)
    }
  }
  return memberIds
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: 実データでの判定ロジック確認**

この関数自体はDBアクセスを伴うため、単体では実機確認せず、Task 2(メンバーページ表示)・Task 4(一覧除外)の実機確認で併せて動作を確認する。ここでは型チェックの通過のみ確認する。

- [ ] **Step 4: コミット**

```bash
git add utils/artistPageKind.ts
git commit -m "feat: add artist/member page kind resolution helper"
```

---

### Task 2: メンバーページ表示 (`/artists/[id]`の分岐)

**Files:**
- Create: `app/artists/[id]/MemberProfile.tsx`
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Consumes: `resolveArtistPageKind`, `hasOwnRelease`(Task 1、`@/utils/artistPageKind`)
- Produces: `MemberProfile`コンポーネント(このタスク内で定義・使用、他タスクからは参照されない)

- [ ] **Step 1: `app/artists/[id]/MemberProfile.tsx`を作成する**

```tsx
import Link from 'next/link'

type Band = { id: string; name: string; description: string | null }
type Production = { id: number; artistId: string; artistName: string; description: string | null }

export default function MemberProfile({
  name,
  nameKana,
  nameEn,
  imageUrl,
  bio,
  bands,
  productions,
}: {
  name: string
  nameKana: string | null
  nameEn: string | null
  imageUrl: string | null
  bio: string | null
  bands: Band[]
  productions: Production[]
}) {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/search" className="text-xs text-white/40 hover:text-white/70">
        ← 検索に戻る
      </Link>

      <div className="mt-4 flex items-start gap-6">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={name} className="h-28 w-28 rounded-full object-cover" />
        ) : (
          <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-white/5 text-3xl">
            🎤
          </div>
        )}

        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-white/50">
            {nameKana && <span>{nameKana}</span>}
            {nameEn && <span>{nameEn}</span>}
          </div>

          {bands.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
              {bands.map((band) => (
                <Link
                  key={band.id}
                  href={`/artists/${band.id}`}
                  className="rounded-full border border-white/15 px-2.5 py-0.5 hover:bg-white/5"
                >
                  🎤 {band.name} のメンバー
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {bio && <p className="mt-6 text-sm leading-relaxed text-white/70">{bio}</p>}

      {productions.length > 0 && (
        <div className="mt-10">
          <h2 className="text-xs uppercase tracking-wide text-white/40">Production & Songwriting</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {productions.map((item) => (
              <li key={item.id}>
                <Link href={`/artists/${item.artistId}`} className="hover:text-white/70">
                  {item.artistName}
                </Link>
                {item.description && <span className="text-white/40"> ・ {item.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `app/artists/[id]/page.tsx`を変更する**

まず、ファイル先頭のimport群(1〜13行目)に以下を追加する:

```tsx
import { resolveArtistPageKind, hasOwnRelease } from '@/utils/artistPageKind'
import MemberProfile from './MemberProfile'
```

次に、現在の33〜79行目(トップレベルの`Promise.all`)を次のように変更する(第3要素として`hasOwnRelease(supabase, id)`を並行実行に追加する):

現在:

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

変更後:

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
    ownsRelease,
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
    hasOwnRelease(supabase, id),
  ])

  if (error || !artist) {
    notFound()
  }
```

続いて、現在の86〜100行目(`membershipRows`から`members`/`belongsToBands`を組み立てる部分)の直後、`appearances`の計算(102〜115行目)より前に、以下を挿入する(判定結果の計算と、「メンバー」判定時の早期return):

```tsx
  const pageKind = resolveArtistPageKind(artist.page_override, ownsRelease)

  if (pageKind === 'member') {
    const { data: productionRows } = await supabase
      .from('artist_relation')
      .select('id, description, target:artist_id_b(id, name)')
      .eq('artist_id_a', id)
      .eq('relation_type', 'production')

    const productions = (productionRows ?? [])
      .map((row) => {
        const target = Array.isArray(row.target) ? row.target[0] : row.target
        if (!target) return null
        return { id: row.id, artistId: target.id, artistName: target.name, description: row.description }
      })
      .filter((row): row is { id: number; artistId: string; artistName: string; description: string | null } => row !== null)

    return (
      <MemberProfile
        name={artist.name}
        nameKana={artist.name_kana}
        nameEn={artist.name_en}
        imageUrl={artist.image_url}
        bio={artist.bio}
        bands={belongsToBands}
        productions={productions}
      />
    )
  }
```

(挿入位置: `belongsToBands.push(...)`を含む`for`ループの閉じ`}`の直後、`const appearances = (eventAppearances ?? [])`の直前。これ以降の既存コード(`appearances`計算〜ファイル末尾のフルページJSX)は一切変更しない。)

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: 開発サーバーで実機確認**

1. `npm run dev`を起動
2. `/artists/MS_ART_j8p31xmu`(桜井和寿)を開く。以下を確認:
   - ディスコグラフィー/Live & Festivals/Awards/Relation Graphのセクションが表示されないこと(軽量テンプレートになっていること)
   - 「🎤 Mr.Children のメンバー」のバッジリンクが表示され、クリックで`/artists/MS_ART_40wvejfq`に遷移すること
   - 「Production & Songwriting」セクションに「Mr.Children」へのリンクが表示されること
3. `/artists/MS_ART_382l76i0`(鈴木英哉)・`/artists/MS_ART_ia73e2t6`(田原健一)でも同様に軽量ページになることを確認
4. `/artists/MS_ART_4nkwmv2i`(A-Trak)を開き、リリース実績があるため通常のフルアーティストページ(ディスコグラフィー等が表示される)のままであることを確認
5. `/artists/MS_ART_k5fiz18l`(King Gnu)を開き、従来通りのフルページ表示に変化がないことを確認(回帰確認)

- [ ] **Step 5: コミット**

```bash
git add app/artists/\[id\]/MemberProfile.tsx app/artists/\[id\]/page.tsx
git commit -m "feat: render lightweight member page for non-solo-debuted band members"
```

---

### Task 3: 管理画面にページ種別の手動上書きUIを追加

**Files:**
- Modify: `app/admin/data/actions.ts:57-110`(`updateArtist`)
- Modify: `app/admin/data/artists/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: なし(`artist.page_override`列を直接読み書きするのみ)
- Produces: なし(UIタスク、他タスクからは参照されない)

- [ ] **Step 1: `app/admin/data/actions.ts`の`updateArtist`を変更する**

現在の64〜100行目:

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

これを次のように変更する(`pageOverride`の読み取りと、`update`への追加):

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
  const pageOverrideRaw = String(formData.get('page_override') ?? '').trim()
  const pageOverride = pageOverrideRaw === 'artist' || pageOverrideRaw === 'member' ? pageOverrideRaw : null

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
      page_override: pageOverride,
    })
    .eq('id', artistId)
```

- [ ] **Step 2: `app/admin/data/artists/[id]/edit/page.tsx`にUIを追加する**

現在の84〜111行目(種別/結成年/配信状況の行と、その次の出身地の行の間):

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

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">出身地(都道府県・国など)</label>
            <input name="origin_prefecture" defaultValue={artist.origin_prefecture ?? ''} className={inputClass} />
          </div>
```

`</div>`(種別/結成年/配信状況の行を閉じるタグ)の直後、出身地の行の直前に、次のブロックを挿入する:

```tsx

        <div className="flex flex-wrap gap-2">
          <div className="max-w-[220px] flex-1">
            <label className="mb-1 block text-xs text-white/40">ページ種別(バンドメンバー用)</label>
            <select name="page_override" defaultValue={artist.page_override ?? ''} className={inputClass}>
              <option value="">自動判定(本人名義のリリース有無で判定)</option>
              <option value="artist">アーティストとして表示(強制)</option>
              <option value="member">メンバーとして表示(強制)</option>
            </select>
          </div>
        </div>
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: 開発サーバーで実機確認**

1. `/admin/data/artists/MS_ART_j8p31xmu/edit`(桜井和寿)を開き、「ページ種別」に「自動判定」が選ばれていることを確認
2. 「アーティストとして表示(強制)」を選んで保存し、`/artists/MS_ART_j8p31xmu`を開いて、リリース実績が無いにもかかわらずフルアーティストページ(ディスコグラフィー等のセクションが空のまま表示される)になることを確認
3. Supabase MCPの`execute_sql`で`select page_override from artist where id = 'MS_ART_j8p31xmu'`を実行し、`'artist'`が保存されていることを確認
4. 編集画面に戻り「自動判定」に戻して保存し、`/artists/MS_ART_j8p31xmu`が再びメンバーページ表示に戻ることを確認(実データへの一時的な変更だが、最終的に元の`NULL`に戻すため問題ない)

- [ ] **Step 5: コミット**

```bash
git add app/admin/data/actions.ts app/admin/data/artists/\[id\]/edit/page.tsx
git commit -m "feat: add manual artist/member page override control to admin edit page"
```

---

### Task 4: 一覧・検索からメンバーを除外

**Files:**
- Modify: `app/artists/page.tsx`
- Modify: `app/search/actions.ts`

**Interfaces:**
- Consumes: `getMemberArtistIds`(Task 1、`@/utils/artistPageKind`)

- [ ] **Step 1: `app/artists/page.tsx`を変更する**

ファイル全体を次の内容に置き換える:

```tsx
import { createClient } from '@/utils/Supabase/server'
import { getMemberArtistIds } from '@/utils/artistPageKind'
import ArtistBrowseClient from './ArtistBrowseClient'

export default async function ArtistsPage() {
  const supabase = await createClient()

  const [{ data }, memberIds] = await Promise.all([
    supabase.from('artist').select('id, name, name_kana, name_en, image_url'),
    getMemberArtistIds(supabase),
  ])

  const artists = (data ?? [])
    .filter((a) => !memberIds.has(a.id))
    .sort((a, b) => (a.name_kana ?? a.name).localeCompare(b.name_kana ?? b.name, 'ja'))

  return <ArtistBrowseClient artists={artists} />
}
```

- [ ] **Step 2: `app/search/actions.ts`を変更する**

ファイル全体を次の内容に置き換える(検索は除外後に20件を維持できるよう、DB取得件数を40件に増やしてからフィルタ・切り詰める):

```tsx
'use server'

import { createClient } from '@/utils/Supabase/server'
import { getMemberArtistIds } from '@/utils/artistPageKind'

export async function search(query: string) {
  const trimmed = query.trim()
  if (!trimmed) {
    return { artists: [], albums: [], error: null }
  }

  const supabase = await createClient()

  const [artistResult, albumResult, memberIds] = await Promise.all([
    supabase
      .from('artist')
      .select('id, name, name_kana, name_en')
      .ilike('name', `%${trimmed}%`)
      .limit(40),
    supabase
      .from('album')
      .select('id, title, title_kana, jacket_url, artist:artist_id(id, name)')
      .ilike('title', `%${trimmed}%`)
      .limit(20),
    getMemberArtistIds(supabase),
  ])

  if (artistResult.error) {
    return { artists: [], albums: [], error: artistResult.error.message }
  }
  if (albumResult.error) {
    return { artists: artistResult.data, albums: [], error: albumResult.error.message }
  }

  const artists = (artistResult.data ?? []).filter((a) => !memberIds.has(a.id)).slice(0, 20)

  return { artists, albums: albumResult.data, error: null }
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: 開発サーバーで実機確認**

1. `/artists`(アーティスト一覧)を開き、桜井和寿・鈴木英哉・田原健一・中川敬輔(Mr.Childrenのメンバー、Task 3で上書きを戻し忘れていないか要確認)、George Daniel・Adam Hann・Matthew Healy・Ross MacDonald(THE 1975のメンバー)が一覧に表示されないことを確認
2. 同じ一覧にMr.Children・THE 1975・A-Trak・King Gnuは通常通り表示されることを確認
3. `/search`で「桜井」を検索し、アーティスト結果が0件になることを確認
4. `/search`で「Mr.Children」を検索し、バンド自体はヒットすることを確認

- [ ] **Step 5: コミット**

```bash
git add app/artists/page.tsx app/search/actions.ts
git commit -m "feat: exclude non-solo-debuted band members from artist listing and search"
```

---

## Self-Review Notes

- **Spec coverage:** specのゴール5点を全てカバーしている。(1)自動判定+手動上書き併用 → Task 1(`resolveArtistPageKind`)+Task 3(上書きUI)。(2)メンバーページの内容(名前・写真・所属バンド一覧・bio・プロデュース/楽曲提供実績) → Task 2。(3)通常アーティストページは変更しない → Task 2で`pageKind === 'member'`の早期returnのみ追加し、既存の全JSXパスは無変更。(4)一覧・検索からの除外 → Task 4。(5)管理画面の3択UI → Task 3。非ゴール(URL分離・既存データのバックフィル・ソロデビュー判定へのクレジット実績混入・`credit_person`側の変更・自動昇格ロジックの変更)はいずれも実装していない。
- **Placeholder scan:** なし。全ステップに実コードを記載。
- **Type consistency:** `ArtistPageKind`/`resolveArtistPageKind`/`hasOwnRelease`/`getMemberArtistIds`(Task 1で定義)のシグネチャは、Task 2(`resolveArtistPageKind`, `hasOwnRelease`)・Task 4(`getMemberArtistIds`)で定義通りに呼び出している。`MemberProfile`の props型(Task 2 Step 1で定義)は同Step 2の呼び出し箇所(`bands={belongsToBands}` — 型は既存コードの`belongsToBands`配列と一致、`productions`は同ステップ内で組み立てた配列で型一致)と整合している。`artist_relation.id`(bigint)は`Production.id: number`として扱い、Task 2内で完結しており他タスクの型と衝突しない。
