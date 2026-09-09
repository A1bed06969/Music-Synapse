# Artist Knowledge Interface (アーティスト詳細ページ3カラム再設計) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アーティスト詳細ページを、PC=LEFT(40%固定)/CENTER(40%スクロール)/RIGHT(20%固定)の3カラム、9つの実URLセクション(Overview/Discography/Timeline/Festival&Live/Network/Media/Ranking/Awards/Radio Rotation)を持つ「Artist Knowledge Interface」に再設計する。

**Architecture:** `app/artists/[id]/layout.tsx`がLEFT(Artist Identity)・RIGHT(Navigation)を1回だけ取得・描画し、9つの`page.tsx`(セクションごとの実ルート)が`{children}`としてCENTERに差し込まれる。既存の`app/artists/[id]/timeline/page.tsx`はこの新シェル内のTimelineセクションとして置き換わる(URLは同じなので既存リンクは壊れない)。既存コンポーネント(`ArtistLinkIcons`, `ArtistTimeline`, `RelationGraph`, `buildArtistAlbumQuery`, `buildArtistAppearanceQuery`, `fetchArtistMediaSelections`)を最大限再利用する。

**Tech Stack:** Next.js App Router(Server Components + 各セクションごとのネストルート)、Supabase、Tailwind CSS。

**Spec:** [docs/superpowers/specs/2026-09-09-artist-knowledge-interface-design.md](../specs/2026-09-09-artist-knowledge-interface-design.md)

## Global Constraints

- Desktopは3カラム、視覚比率は常に`40:40:20`を維持する(`grid-template-columns: minmax(280px, 4fr) minmax(320px, 4fr) minmax(180px, 2fr)`)。ページ最大幅は`max-w-[1600px] mx-auto`。適用ブレークポイントは`lg:`。
- LEFT・RIGHTは`sticky`。ブラウザ全体のスクロールロックは行わない。
- Mobile(`lg:`未満)は1カラム: Artist Identity(コンパクト版)→Compact Navigation(2列グリッド)→Content の順。Navigationを画面上部に固定しない。
- セクション切り替えは実ルート遷移(`layout.tsx`共有によりLEFT/RIGHTは再取得・再マウントされない)。クライアント側のタブ状態は使わない。
- 既存Supabaseの実データのみを使用する。ダミーデータ・空のプレースホルダーを作らない。データ0件のセクションは大きな空状態カードではなく静かな1行のみ。
- v1スコープ外: Related Artists(似ているアーティスト)、Music Profile文言、Sound/Moodタグ、アルバム/トラックページのレイアウト変更、メンバー個別ページ(`MemberProfile`)のレイアウト変更。
- 画像は既存の`<img>` + object-fit運用を踏襲する(next/imageへの切り替えは行わない)。
- カード化はDiscography(Artwork Card)のみ。Timeline/Media/Ranking/Awards/Radio RotationはEditorial List、NetworkはRelationGraphベースの専用UI。

---

### Task 1: セクション件数カウントユーティリティ

**Files:**
- Create: `utils/artistDetailCounts.ts`
- Test: `__tests__/artist-detail-counts.unit.test.ts`

**Interfaces:**
- Produces: `type ArtistSectionCounts = { discography: number; timeline: number; live: number; network: number; media: number; ranking: number; awards: number; radio: number }`、`fetchArtistSectionCounts(supabase: SupabaseClient, artistId: string): Promise<ArtistSectionCounts>`(Task 4が使用)、`buildArtistRankingAwardFilter(supabase: SupabaseClient, artistId: string): Promise<string>`(PostgREST `.or()`用フィルター文字列。Task 11・Task 12・Task 5が使用)。

RIGHTカラムのナビゲーションバッジ用の件数。各セクションが実際に表示する内容と完全に一致するとは限らない軽量な目安値として設計する(重い集計は避ける)。

- **discography**: `buildArtistAlbumQuery`と同じ集合(単独名義+`album_artist`経由)の件数
- **timeline**: `ArtistTimeline`が合算する6種(release/live/festival/tieup/media/award)の件数の合計(既存の年表ロジックと同じ母集団)
- **live**: `buildArtistAppearanceQuery`と同じ集合(単独出演+コラボ出演)の件数
- **network**: `artist_relation`のうち、このアーティストが`artist_id_a`または`artist_id_b`側の行数(membership/production)
- **media**: ニュース関連付け(`findRelatedNews`)の件数。ニュースはDBではなくキャッシュテーブルの読み取り+タイトル一致判定のため、この関数の外(呼び出し元)で計算済みの数値を渡してもらう形にはせず、ここでは0を返す固定値とし、実際の件数表示はセクションページ自身が計算してNavigationへ渡す(Task 3参照)。
- **ranking**: `ranking_entry`のうち、`artist_id`直接一致 **または** `album_id`/`track_id`がこのアーティストのアルバム/トラックに一致する行数。本番データの実測で、`ranking_entry`の56%(1645/2932件)が`artist_id`が null で`album_id`/`track_id`経由でしか解決できないことが判明している(2026-09-09にSupabaseへ直接確認済み)。`artist_id`直接一致のみにすると大半を取り逃すため、間接解決を必須とする
- **awards**: `award_entry`のうち、`artist_id`直接一致 **または** `album_id`/`track_id`経由で一致する行数。本番データでは`award_entry`は現在1行のみ存在し、その1行も`artist_id`が null(album_id/track_id経由でのみ解決可能)。直接一致のみでは0件になってしまうため、こちらも間接解決を必須とする
- **radio**: `fetchArtistMediaSelections`が返す配列の長さ(track/album/artist直接指定の3方向を合算した既存ロジックをそのまま使う)

- [ ] **Step 1: 失敗するテストを書く**

```ts
// __tests__/artist-detail-counts.unit.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sumTimelineCounts } from '../utils/artistDetailCounts.ts'

describe('sumTimelineCounts', () => {
  test('6種の件数を合計する', () => {
    const result = sumTimelineCounts({
      releaseCount: 3,
      liveCount: 2,
      festivalCount: 1,
      tieUpCount: 0,
      mediaCount: 5,
      awardCount: 1,
    })
    assert.equal(result, 12)
  })

  test('すべて0なら0', () => {
    const result = sumTimelineCounts({
      releaseCount: 0,
      liveCount: 0,
      festivalCount: 0,
      tieUpCount: 0,
      mediaCount: 0,
      awardCount: 0,
    })
    assert.equal(result, 0)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --env-file-if-exists=.env.local --test --test-name-pattern=sumTimelineCounts "__tests__/**/*.test.ts"`
Expected: FAIL(`../utils/artistDetailCounts.ts`が存在しない)

- [ ] **Step 3: `utils/artistDetailCounts.ts`を実装**

```ts
// utils/artistDetailCounts.ts
//
// アーティスト詳細ページ(3カラム版)のRIGHTカラム、各セクションのナビゲーション
// バッジに出す件数。重い集計を避けるため、head:trueのcount専用クエリを使い、
// 各セクションが実際に描画する内容と1件単位で完全一致することは保証しない
// (目安値として設計。詳細はdocs/superpowers/specs/2026-09-09-artist-knowledge-interface-design.md
// の「RIGHTカラム: Navigation」参照)。
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchArtistMediaSelections } from './fetchArtistMediaSelections'

export type ArtistSectionCounts = {
  discography: number
  timeline: number
  live: number
  network: number
  media: number
  ranking: number
  awards: number
  radio: number
}

export function sumTimelineCounts(counts: {
  releaseCount: number
  liveCount: number
  festivalCount: number
  tieUpCount: number
  mediaCount: number
  awardCount: number
}): number {
  return (
    counts.releaseCount +
    counts.liveCount +
    counts.festivalCount +
    counts.tieUpCount +
    counts.mediaCount +
    counts.awardCount
  )
}

async function countAlbums(supabase: SupabaseClient, artistId: string): Promise<number> {
  const { data: coArtistLinks } = await supabase.from('album_artist').select('album_id').eq('artist_id', artistId)
  const coArtistAlbumIds = (coArtistLinks ?? []).map((r) => r.album_id as string)

  let query = supabase.from('album').select('id', { count: 'exact', head: true }).is('primary_album_id', null)
  query =
    coArtistAlbumIds.length > 0
      ? query.or(`artist_id.eq.${artistId},id.in.(${coArtistAlbumIds.join(',')})`)
      : query.eq('artist_id', artistId)
  const { count } = await query
  return count ?? 0
}

async function countAppearances(supabase: SupabaseClient, artistId: string): Promise<number> {
  const { data: links } = await supabase
    .from('event_appearance_artist')
    .select('event_appearance_id')
    .eq('artist_id', artistId)
  const appearanceIds = [...new Set((links ?? []).map((r) => r.event_appearance_id as number))]
  return appearanceIds.length
}

/** `ranking_entry`/`award_entry`はどちらも`artist_id`/`album_id`/`track_id`を
 * 個別に持つ(どの粒度で選出されたかによりどれかがnullになる)。このアーティスト
 * 起点での「直接+アルバム/トラック経由」の行をすべて拾うためのPostgREST `.or()`
 * フィルター文字列を組み立てる。album_artist/track_artist(コラボ)経由の間接一致
 * は対象外とする(本番データで合計5行のみの稀なケースのため、v1ではスコープ外)。 */
export async function buildArtistRankingAwardFilter(supabase: SupabaseClient, artistId: string): Promise<string> {
  const [{ data: albumRows }, { data: trackRows }] = await Promise.all([
    supabase.from('album').select('id').eq('artist_id', artistId),
    supabase.from('track').select('id').eq('artist_id', artistId),
  ])
  const albumIds = (albumRows ?? []).map((r) => r.id as string)
  const trackIds = (trackRows ?? []).map((r) => r.id as string)

  const clauses = [`artist_id.eq.${artistId}`]
  if (albumIds.length > 0) clauses.push(`album_id.in.(${albumIds.join(',')})`)
  if (trackIds.length > 0) clauses.push(`track_id.in.(${trackIds.join(',')})`)
  return clauses.join(',')
}

export async function fetchArtistSectionCounts(
  supabase: SupabaseClient,
  artistId: string
): Promise<ArtistSectionCounts> {
  const rankingAwardFilter = await buildArtistRankingAwardFilter(supabase, artistId)

  const [
    discography,
    live,
    { count: musicEventCount },
    { count: tieUpCount },
    { count: awardCount },
    { count: networkA },
    { count: networkB },
    { count: rankingCount },
    mediaSelections,
  ] = await Promise.all([
    countAlbums(supabase, artistId),
    countAppearances(supabase, artistId),
    supabase.from('music_event').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase
      .from('sync_entry')
      .select('id, track:track_id!inner(artist_id)', { count: 'exact', head: true })
      .eq('track.artist_id', artistId),
    supabase.from('award_entry').select('id', { count: 'exact', head: true }).or(rankingAwardFilter),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }).eq('artist_id_a', artistId),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }).eq('artist_id_b', artistId),
    supabase.from('ranking_entry').select('id', { count: 'exact', head: true }).or(rankingAwardFilter),
    fetchArtistMediaSelections(supabase, artistId),
  ])

  return {
    discography,
    timeline: sumTimelineCounts({
      releaseCount: discography,
      liveCount: musicEventCount ?? 0,
      festivalCount: live,
      tieUpCount: tieUpCount ?? 0,
      mediaCount: mediaSelections.length,
      awardCount: awardCount ?? 0,
    }),
    live,
    network: (networkA ?? 0) + (networkB ?? 0),
    media: 0,
    ranking: rankingCount ?? 0,
    awards: awardCount ?? 0,
    radio: mediaSelections.length,
  }
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `node --env-file-if-exists=.env.local --test --test-name-pattern=sumTimelineCounts "__tests__/**/*.test.ts"`
Expected: PASS(2件)

- [ ] **Step 5: Commit**

```bash
git add utils/artistDetailCounts.ts __tests__/artist-detail-counts.unit.test.ts
git commit -m "feat: add artist detail section count utility"
```

---

### Task 2: LEFTカラム(Artist Identity)

**Files:**
- Create: `app/components/artist-detail/ArtistIdentityPanel.tsx`
- Create: `app/components/artist-detail/BiographyReadMore.tsx`

**Interfaces:**
- Produces: `ArtistIdentityPanel`(Server Component、props仕様は下記)、`BiographyReadMore`(Client Component、`{ text: string }`のみ受け取る)。Task 4(layout.tsx)が使用する。

- [ ] **Step 1: `BiographyReadMore`(折りたたみBiography)を実装**

```tsx
// app/components/artist-detail/BiographyReadMore.tsx
'use client'

import { useState } from 'react'

/** LEFTカラムのBiographyを初期5〜8行に折りたたみ、「Read More」で全文展開する。
 * LEFTカラムはsticky(1画面に収める方針)のため、長文Biographyがそのまま
 * スクロールを要求してしまわないようにする。 */
export default function BiographyReadMore({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <p className={`whitespace-pre-wrap text-sm leading-relaxed text-white/70 ${expanded ? '' : 'line-clamp-6'}`}>
        {text}
      </p>
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-xs text-white/50 underline-offset-2 hover:text-white hover:underline"
        >
          Read More →
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `ArtistIdentityPanel`を実装**

```tsx
// app/components/artist-detail/ArtistIdentityPanel.tsx
import ArtistLinkIcons from '@/app/components/ArtistLinkIcons'
import BiographyReadMore from './BiographyReadMore'

export type ArtistIdentityData = {
  id: string
  name: string
  nameKana: string | null
  nameEn: string | null
  imageUrl: string | null
  bio: string | null
  formedYear: number | null
  disbandedYear: number | null
  activeStatus: string | null
  hometownCountry: string | null
  originPrefecture: string | null
  hometownCity: string | null
  genreNames: string[]
  officialSiteUrl: string | null
  snsXUrl: string | null
  snsInstagramUrl: string | null
  appleMusicArtistId: string | null
  spotifyArtistId: string | null
  externalLinks: { id: string; link_type: string; url: string }[]
}

function activeYearsLabel(data: ArtistIdentityData): string | null {
  if (!data.formedYear) return null
  const end = data.disbandedYear ? String(data.disbandedYear) : data.activeStatus === 'inactive' ? '?' : 'Present'
  return `${data.formedYear} — ${end}`
}

/** アーティスト詳細ページのLEFTカラム。Desktopではstickyで1画面に収まる分量
 * (画像+基本情報+ジャンル+外部リンク+Biography抜粋)だけを表示する。
 * Music Profile文言・Sound/Moodタグはデータが存在しないためv1では出さない
 * (docs/superpowers/specs/2026-09-09-artist-knowledge-interface-design.md 非ゴール参照)。 */
export default function ArtistIdentityPanel({ data }: { data: ArtistIdentityData }) {
  const originLabel = [data.originPrefecture, data.hometownCity, data.hometownCountry].filter(Boolean).join(' / ')
  const activeYears = activeYearsLabel(data)

  return (
    <div className="flex flex-col gap-5">
      <div className="aspect-square w-full overflow-hidden rounded-lg bg-white/5">
        {data.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.imageUrl} alt={data.name} className="h-full w-full object-cover" />
        ) : null}
      </div>

      <div>
        <h1 className="text-2xl font-bold leading-tight">{data.name}</h1>
        {(data.nameKana || data.nameEn) && (
          <p className="mt-1 text-sm text-white/50">{[data.nameKana, data.nameEn].filter(Boolean).join(' / ')}</p>
        )}
      </div>

      {(originLabel || activeYears) && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {originLabel && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-white/40">Origin</dt>
              <dd className="mt-0.5 text-white/80">{originLabel}</dd>
            </div>
          )}
          {activeYears && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-white/40">Active</dt>
              <dd className="mt-0.5 text-white/80">{activeYears}</dd>
            </div>
          )}
        </dl>
      )}

      {data.genreNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.genreNames.slice(0, 8).map((name) => (
            <span key={name} className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-white/60">
              {name}
            </span>
          ))}
        </div>
      )}

      <ArtistLinkIcons
        artistName={data.name}
        officialSiteUrl={data.officialSiteUrl}
        snsXUrl={data.snsXUrl}
        snsInstagramUrl={data.snsInstagramUrl}
        appleMusicArtistId={data.appleMusicArtistId}
        spotifyArtistId={data.spotifyArtistId}
        externalLinks={data.externalLinks}
      />

      {data.bio && data.bio.trim() && (
        <div>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Biography</h2>
          <div className="mt-2">
            <BiographyReadMore text={data.bio} />
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし(この時点ではまだ呼び出し元が無いため、未使用エクスポートによるエラーは出ない)

- [ ] **Step 4: Commit**

```bash
git add app/components/artist-detail/ArtistIdentityPanel.tsx app/components/artist-detail/BiographyReadMore.tsx
git commit -m "feat: add artist detail LEFT column (identity panel)"
```

---

### Task 3: RIGHTカラム(Navigation)

**Files:**
- Create: `app/components/artist-detail/ArtistNav.tsx`

**Interfaces:**
- Consumes: `ArtistSectionCounts`(Task 1)
- Produces: `ArtistNav`(Client Component)、`NAV_SECTIONS`(セクション定義の配列、Task 4/5〜13が参照する可能性はないが一貫性のためここに集約する)。

- [ ] **Step 1: `ArtistNav`を実装**

```tsx
// app/components/artist-detail/ArtistNav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ArtistSectionCounts } from '@/utils/artistDetailCounts'

export type NavSection = {
  number: string
  key: keyof ArtistSectionCounts | 'overview'
  label: string
  path: string // artistIdの後に続くパス。空文字はOverview(index)。
}

export const NAV_SECTIONS: NavSection[] = [
  { number: '01', key: 'overview', label: 'OVERVIEW', path: '' },
  { number: '02', key: 'discography', label: 'DISCOGRAPHY', path: '/discography' },
  { number: '03', key: 'timeline', label: 'TIMELINE', path: '/timeline' },
  { number: '04', key: 'live', label: 'FESTIVAL & LIVE', path: '/live' },
  { number: '05', key: 'network', label: 'NETWORK', path: '/network' },
  { number: '06', key: 'media', label: 'MEDIA', path: '/media' },
  { number: '07', key: 'ranking', label: 'RANKING', path: '/ranking' },
  { number: '08', key: 'awards', label: 'AWARDS', path: '/awards' },
  { number: '09', key: 'radio', label: 'RADIO ROTATION', path: '/radio' },
]

/** RIGHTカラムのArtist Navigation。Editorial Index形式(Number・Label・Countのみ、
 * 大きなボタンにしない)。アクティブ項目はアクセントラインで表現する。
 * mediaのカウントは呼び出し元(各page.tsx)が実際に計算した値を渡すまで0のままで、
 * Overview/Discography等の別セクション閲覧中はこの値のまま(目安値の性質上、
 * 他セクションで最新化する必要はない)。 */
export default function ArtistNav({
  artistId,
  counts,
}: {
  artistId: string
  counts: ArtistSectionCounts
}) {
  const pathname = usePathname()
  const basePath = `/artists/${artistId}`

  return (
    <nav aria-label="アーティストページ内ナビゲーション">
      <p className="text-xs uppercase tracking-wide text-white/40">Artist</p>
      <ul className="mt-3 flex flex-col gap-3 lg:grid-cols-1">
        {NAV_SECTIONS.map((section) => {
          const href = `${basePath}${section.path}`
          const isActive = pathname === href
          const count = section.key === 'overview' ? null : counts[section.key]
          return (
            <li key={section.key}>
              <Link
                href={href}
                className={`flex items-baseline gap-2 border-l-2 py-1 pl-3 text-sm transition ${
                  isActive
                    ? 'border-white text-white'
                    : 'border-transparent text-white/50 hover:border-white/30 hover:text-white/80'
                }`}
              >
                <span className="text-[10px] text-white/30">{section.number}</span>
                <span className="tracking-wide">{section.label}</span>
                {count !== null && count > 0 && <span className="ml-auto text-xs text-white/30">{count}</span>}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add app/components/artist-detail/ArtistNav.tsx
git commit -m "feat: add artist detail RIGHT column (navigation)"
```

---

### Task 4: 3カラムシェル(layout.tsx)

**Files:**
- Create: `app/artists/[id]/layout.tsx`

**Interfaces:**
- Consumes: `ArtistIdentityPanel`/`ArtistIdentityData`(Task 2)、`ArtistNav`(Task 3)、`fetchArtistSectionCounts`(Task 1)、`resolveArtistPageKind`/`hasOwnRelease`(既存`utils/artistPageKind.ts`)、`MemberProfile`(既存)。
- Produces: LEFT/RIGHT付き3カラムグリッドのレイアウト。`{children}`がCENTERに入る。以降の全セクション`page.tsx`(Task 5〜13)はこのlayout配下に置かれる。

メンバー個別ページ(自身名義のリリースを持たないアーティスト)は、この3カラムシェルの対象外。layout側で判定し、対象外なら既存`MemberProfile`をそのまま描画して`children`を描画しない(=セクションルートに到達させない)。

- [ ] **Step 1: `layout.tsx`を実装**

```tsx
// app/artists/[id]/layout.tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { resolveArtistPageKind, hasOwnRelease } from '@/utils/artistPageKind'
import { fetchArtistSectionCounts } from '@/utils/artistDetailCounts'
import ArtistIdentityPanel, { type ArtistIdentityData } from '@/app/components/artist-detail/ArtistIdentityPanel'
import ArtistNav from '@/app/components/artist-detail/ArtistNav'
import ArtistNavMobile from '@/app/components/artist-detail/ArtistNavMobile'
import BackLink from '@/app/components/navigation/BackLink'
import MemberProfile from './MemberProfile'

type ArtistRow = {
  id: string
  name: string
  name_kana: string | null
  name_en: string | null
  image_url: string | null
  bio: string | null
  formed_year: number | null
  disbanded_year: number | null
  active_status: string | null
  hometown_country: string | null
  origin_prefecture: string | null
  hometown_city: string | null
  official_site_url: string | null
  sns_x_url: string | null
  sns_instagram_url: string | null
  apple_music_artist_id: string | null
  spotify_artist_id: string | null
  page_override: string | null
}

export default async function ArtistDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: artist, error }, ownsRelease, { data: genreRows }, { data: externalLinks }] = await Promise.all([
    supabase.from('artist').select('*').eq('id', id).single<ArtistRow>(),
    hasOwnRelease(supabase, id),
    supabase.from('artist_genre').select('genre:genre_id(name)').eq('artist_id', id),
    supabase
      .from('artist_external_link')
      .select('id, link_type, url')
      .eq('artist_id', id)
      .order('link_type', { ascending: true })
      .order('url', { ascending: true }),
  ])

  if (error || !artist) {
    notFound()
  }

  const pageKind = resolveArtistPageKind(artist.page_override, ownsRelease)
  if (pageKind === 'member') {
    const { data: membershipRows } = await supabase
      .from('artist_relation')
      .select('id, description, band:artist_id_a(id, name, image_url), member:artist_id_b(id, name, image_url)')
      .eq('relation_type', 'membership')
      .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`)
    const belongsToBands: { id: string; name: string; description: string | null }[] = []
    for (const row of membershipRows ?? []) {
      const band = Array.isArray(row.band) ? row.band[0] : row.band
      const member = Array.isArray(row.member) ? row.member[0] : row.member
      if (band && member?.id === id) belongsToBands.push({ id: band.id, name: band.name, description: row.description })
    }
    const { data: productionRows } = await supabase
      .from('artist_relation')
      .select('id, description, artist_a:artist_id_a(id, name), artist_b:artist_id_b(id, name)')
      .eq('relation_type', 'production')
      .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`)
    const productions = (productionRows ?? [])
      .map((row) => {
        const a = Array.isArray(row.artist_a) ? row.artist_a[0] : row.artist_a
        const b = Array.isArray(row.artist_b) ? row.artist_b[0] : row.artist_b
        if (!a || !b) return null
        const other = a.id === id ? b : a
        return { id: row.id, artistId: other.id, artistName: other.name, description: row.description }
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

  const counts = await fetchArtistSectionCounts(supabase, id)

  const identity: ArtistIdentityData = {
    id: artist.id,
    name: artist.name,
    nameKana: artist.name_kana,
    nameEn: artist.name_en,
    imageUrl: artist.image_url,
    bio: artist.bio,
    formedYear: artist.formed_year,
    disbandedYear: artist.disbanded_year,
    activeStatus: artist.active_status,
    hometownCountry: artist.hometown_country,
    originPrefecture: artist.origin_prefecture,
    hometownCity: artist.hometown_city,
    genreNames: (genreRows ?? [])
      .map((r) => (Array.isArray(r.genre) ? r.genre[0]?.name : r.genre?.name))
      .filter((name): name is string => Boolean(name)),
    officialSiteUrl: artist.official_site_url,
    snsXUrl: artist.sns_x_url,
    snsInstagramUrl: artist.sns_instagram_url,
    appleMusicArtistId: artist.apple_music_artist_id,
    spotifyArtistId: artist.spotify_artist_id,
    externalLinks: externalLinks ?? [],
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      <BackLink fallbackHref="/search" fallbackLabel="検索に戻る" />
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(280px,4fr)_minmax(320px,4fr)_minmax(180px,2fr)]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <ArtistIdentityPanel data={identity} />
        </div>
        <div className="min-w-0">{children}</div>
        <div className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
          <ArtistNav artistId={id} counts={counts} />
        </div>
        <div className="lg:hidden">
          <ArtistNavMobile artistId={id} counts={counts} />
        </div>
      </div>
    </div>
  )
}
```

`ArtistNavMobile`はArtistNav(RIGHT用、縦1列)とは別の見た目(2列グリッド)が必要なため、Client Componentとして分離する(Step 2で実装)。

- [ ] **Step 2: Mobile用ナビゲーション(2列グリッド)を実装**

```tsx
// app/components/artist-detail/ArtistNavMobile.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ArtistSectionCounts } from '@/utils/artistDetailCounts'
import { NAV_SECTIONS } from './ArtistNav'

/** Mobile用のコンパクトな2列グリッドナビゲーション。縦長の1列リストにせず、
 * 9項目を5行程度に収める(仕様: セクション「Mobile Navigation」参照)。 */
export default function ArtistNavMobile({
  artistId,
  counts,
}: {
  artistId: string
  counts: ArtistSectionCounts
}) {
  const pathname = usePathname()
  const basePath = `/artists/${artistId}`

  return (
    <nav aria-label="アーティストページ内ナビゲーション" className="mt-2">
      <div className="grid grid-cols-2 divide-x divide-y divide-white/10 border border-white/10">
        {NAV_SECTIONS.map((section) => {
          const href = `${basePath}${section.path}`
          const isActive = pathname === href
          const count = section.key === 'overview' ? null : counts[section.key]
          return (
            <Link
              key={section.key}
              href={href}
              className={`flex items-center justify-between px-3 py-2.5 text-xs ${
                isActive ? 'bg-white/5 text-white' : 'text-white/60'
              }`}
            >
              <span>
                <span className="mr-1.5 text-white/30">{section.number}</span>
                {section.label}
              </span>
              {count !== null && count > 0 && <span className="text-white/30">{count}</span>}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。ただしTask 5(Overview)がまだ無いため、この時点ではこのlayoutを使う`page.tsx`が存在せずビルドは通らない可能性がある。次のタスクで解消されるので、このタスク単体では`tsc --noEmit`(型チェックのみ、ルーティング未解決は許容)の通過を確認基準とする。

- [ ] **Step 4: Commit**

```bash
git add app/artists/[id]/layout.tsx app/components/artist-detail/ArtistNavMobile.tsx
git commit -m "feat: add artist detail 3-column shell layout"
```

---

### Task 5: Overviewセクション(デフォルト表示)

**Files:**
- Modify: `app/artists/[id]/page.tsx`(既存ファイルを全面書き換え。旧ロジックの大半はTask 6〜13へ分散移設される)

**Interfaces:**
- Consumes: Task 4の`layout.tsx`配下で描画される(このファイルは`{children}`の中身)。
- Produces: なし(末端ページ)。

既存`page.tsx`が持っていた「見開き」構成の情報を、Overview用に再構成する。既存の代表曲(Popular Tracks)ロジックをそのまま移設する。

- [ ] **Step 1: `page.tsx`をOverview用に書き換え**

```tsx
// app/artists/[id]/page.tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { notFound } from 'next/navigation'
import { formatDate, STREAMING_STATUS_LABEL } from '@/utils/format'
import { buildArtistAlbumQuery } from '@/utils/artistAlbumQuery'
import { buildArtistAppearanceQuery } from '@/utils/artistAppearanceQuery'
import { findRelatedNews, formatRelativeTime } from '@/utils/newsParser'
import { fetchCachedNews } from '@/utils/newsCache'
import { buildArtistRankingAwardFilter } from '@/utils/artistDetailCounts'

type FeaturedEntryRow = {
  id: string
  kind: 'ranking' | 'award'
  label: string
  periodLabel: string
}

type OverviewAlbumRow = {
  id: string
  title: string
  jacket_url: string | null
  release_date: string | null
  streaming_status: string | null
}

type ScoredTrackRow = {
  track_id: string
  track:
    | { id: string; title: string; album: { id: string; jacket_url: string | null } | { id: string; jacket_url: string | null }[] | null }
    | { id: string; title: string; album: { id: string; jacket_url: string | null } | { id: string; jacket_url: string | null }[] | null }[]
    | null
}

type ArtistAppearanceRow = {
  id: number
  venue: string | null
  start_time: string | null
  event_edition: { year: number | null; event: { name: string } | { name: string }[] | null } | { year: number | null; event: { name: string } | { name: string }[] | null }[] | null
}

type OverviewRankingEntryRow = {
  id: string
  period_date: string | null
  ranking: { id: string; name: string } | { id: string; name: string }[] | null
}

type OverviewAwardEntryRow = {
  id: string
  year: number | null
  result: string | null
  award: { name: string } | { name: string }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function ArtistOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // ranking_entry/award_entryはartist_id/album_id/track_idのいずれかで紐づく
  // (直接artist_idだけでは本番データの過半数を取り逃す。utils/artistDetailCounts.ts
  //  のbuildArtistRankingAwardFilter参照)ため、フィルター文字列を先に組み立てる。
  const rankingAwardFilter = await buildArtistRankingAwardFilter(supabase, id)

  const [
    { data: albums },
    [{ data: rotationRows }, { data: rankingRows }],
    { data: appearanceRows },
    { items: newsItems },
    { data: rankingEntries },
    { data: awardEntries },
  ] = await Promise.all([
    buildArtistAlbumQuery<OverviewAlbumRow>(supabase, id, 'id, title, jacket_url, release_date, streaming_status'),
    Promise.all([
      supabase
        .from('radio_rotation')
        .select('track_id, track:track_id!inner(id, title, album:album_id(id, jacket_url))')
        .eq('track.artist_id', id)
        .overrideTypes<ScoredTrackRow[], { merge: false }>(),
      supabase
        .from('ranking_entry')
        .select('track_id, track:track_id!inner(id, title, album:album_id(id, jacket_url))')
        .eq('track.artist_id', id)
        .overrideTypes<ScoredTrackRow[], { merge: false }>(),
    ]),
    buildArtistAppearanceQuery<ArtistAppearanceRow>(
      supabase,
      id,
      'id, venue, start_time, event_edition:event_edition_id(year, event:event_id(name))'
    ),
    fetchCachedNews(),
    supabase
      .from('ranking_entry')
      .select('id, period_date, ranking:ranking_id!inner(id, name)')
      .or(rankingAwardFilter)
      .order('period_date', { ascending: false })
      .limit(2)
      .overrideTypes<OverviewRankingEntryRow[], { merge: false }>(),
    supabase
      .from('award_entry')
      .select('id, year, result, award:award_id(name)')
      .or(rankingAwardFilter)
      .order('year', { ascending: false })
      .limit(2)
      .overrideTypes<OverviewAwardEntryRow[], { merge: false }>(),
  ])

  const { data: artistForNews } = await supabase.from('artist').select('name, name_kana, name_en').eq('id', id).single()
  const relatedNews = artistForNews
    ? findRelatedNews(
        newsItems,
        [artistForNews.name, artistForNews.name_kana, artistForNews.name_en].filter((k): k is string => Boolean(k)),
        3
      )
    : []

  // 代表曲(Popular Tracks): パワープレイ実績+ランキング選出の件数が多い順に最大5曲
  const scoreByTrackId = new Map<string, number>()
  const trackById = new Map<string, { id: string; title: string; album: { id: string; jacket_url: string | null } | null }>()
  for (const row of [...(rotationRows ?? []), ...(rankingRows ?? [])]) {
    if (!row.track_id) continue
    scoreByTrackId.set(row.track_id, (scoreByTrackId.get(row.track_id) ?? 0) + 1)
    if (!trackById.has(row.track_id)) {
      const t = Array.isArray(row.track) ? row.track[0] : row.track
      if (t) {
        const album = Array.isArray(t.album) ? t.album[0] : t.album
        trackById.set(row.track_id, { id: t.id, title: t.title, album: album ?? null })
      }
    }
  }
  const popularTracks = Array.from(trackById.values())
    .map((t) => ({ ...t, score: scoreByTrackId.get(t.id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const latestRelease = (albums ?? [])[0] ?? null

  const now = new Date().toISOString()
  const upcomingLive = (appearanceRows ?? [])
    .filter((row) => row.start_time && row.start_time > now)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
    .slice(0, 3)

  const featuredContent: FeaturedEntryRow[] = [
    ...(rankingEntries ?? []).map((row) => {
      const ranking = firstOf(row.ranking)
      return {
        id: `ranking-${row.id}`,
        kind: 'ranking' as const,
        label: ranking?.name ?? '—',
        periodLabel: row.period_date ? formatDate(row.period_date) : '',
      }
    }),
    ...(awardEntries ?? []).map((row) => {
      const award = firstOf(row.award)
      return {
        id: `award-${row.id}`,
        kind: 'award' as const,
        label: award?.name ?? '—',
        periodLabel: [row.year ? `${row.year}年` : null, row.result].filter(Boolean).join(' · '),
      }
    }),
  ].slice(0, 2)

  if (!artistForNews) notFound()

  return (
    <div className="flex flex-col gap-10">
      {latestRelease && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Latest Release</h2>
          <Link href={`/albums/${latestRelease.id}`} className="mt-3 flex gap-4 group">
            <div className="h-28 w-28 shrink-0 overflow-hidden rounded-md bg-white/5">
              {latestRelease.jacket_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={latestRelease.jacket_url} alt={latestRelease.title} className="h-full w-full object-cover transition group-hover:opacity-80" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-medium group-hover:underline">{latestRelease.title}</p>
              <p className="mt-1 text-xs text-white/40">{formatDate(latestRelease.release_date)}</p>
              {latestRelease.streaming_status && (
                <p className="mt-1 text-xs text-white/50">
                  {STREAMING_STATUS_LABEL[latestRelease.streaming_status]?.icon}{' '}
                  {STREAMING_STATUS_LABEL[latestRelease.streaming_status]?.label}
                </p>
              )}
            </div>
          </Link>
        </section>
      )}

      {popularTracks.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Popular Tracks</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {popularTracks.map((t, i) => (
              <li key={t.id}>
                <Link href={`/tracks/${t.id}`} className="flex items-center gap-3 py-2 text-sm hover:opacity-70">
                  <span className="w-4 shrink-0 text-xs text-white/30">{i + 1}</span>
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-white/5">
                    {t.album?.jacket_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.album.jacket_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <span className="truncate">{t.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {upcomingLive.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Upcoming Live</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {upcomingLive.map((row) => {
              const edition = firstOf(row.event_edition)
              const event = edition ? firstOf(edition.event) : null
              return (
                <li key={row.id} className="py-2 text-sm">
                  <p className="font-medium">{event?.name ?? '—'}</p>
                  <p className="mt-0.5 text-xs text-white/40">
                    {row.start_time ? formatDate(row.start_time) : ''}
                    {row.venue ? ` · ${row.venue}` : ''}
                  </p>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {relatedNews.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Latest Media</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {relatedNews.map((item) => (
              <li key={item.id} className="py-2 text-sm">
                <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {item.title}
                </a>
                <p className="mt-0.5 text-xs text-white/40">
                  {item.source} · {formatRelativeTime(item.publishedAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {featuredContent.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Featured Content</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {featuredContent.map((entry) => (
              <li key={entry.id} className="py-2 text-sm">
                <p>{entry.label}</p>
                {entry.periodLabel && <p className="mt-0.5 text-xs text-white/40">{entry.periodLabel}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: ローカルで表示確認**

Run: `npm run dev`(既に起動していれば不要)。既知のアーティストID(例: `MS_ART_yu7eev56`)で`http://localhost:3000/artists/MS_ART_yu7eev56`を開く。3カラム(LEFT: 画像/基本情報/リンク/Biography、CENTER: Overview、RIGHT: ナビゲーション)が表示され、Latest Release/Popular Tracks等が実データで出ることを確認する。

- [ ] **Step 4: Commit**

```bash
git add "app/artists/[id]/page.tsx"
git commit -m "feat: rebuild artist page as Overview section in 3-column shell"
```

---

### Task 6: Discographyセクション

**Files:**
- Create: `app/artists/[id]/discography/page.tsx`
- Create: `app/components/artist-detail/DiscographyFilters.tsx`

**Interfaces:**
- Consumes: `buildArtistAlbumQuery`(既存)、`ALBUM_TYPE_LABEL_JA`/`ALBUM_TYPE_ORDER`/`classifyAlbumType`(既存`utils/albumType.ts`)、`STREAMING_STATUS_LABEL`(既存`utils/format.ts`)。
- Produces: なし(末端ページ)。

CENTER幅(40%)の中を3列グリッドにする(Mobileは2列)。既存`/albums`一覧のページング・フィルタ運用(60件単位、URLクエリパラメータ)に合わせる。

- [ ] **Step 1: フィルターUI(Client Component)を実装**

```tsx
// app/components/artist-detail/DiscographyFilters.tsx
'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ALBUM_TYPE_LABEL_JA, ALBUM_TYPE_ORDER } from '@/utils/albumType'

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'streaming', label: '配信中' },
  { value: 'unreleased', label: '未解禁' },
]

/** Discographyセクション上部のフィルター。URLのクエリパラメータ(type/status)で
 * 状態を表す(既存/albumsページと同じ、サーバー側で絞り込むための設計)。 */
export default function DiscographyFilters({ type, status }: { type: string; status: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== 'all') params.set(key, value)
      else params.delete(key)
    }
    params.delete('page')
    const search = params.toString()
    router.push(search ? `${pathname}?${search}` : pathname)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => navigate({ type: null })}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs ${type === 'all' ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
        >
          ALL
        </button>
        {ALBUM_TYPE_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => navigate({ type: t })}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs ${type === t ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
          >
            {ALBUM_TYPE_LABEL_JA[t]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => navigate({ status: f.value })}
            className={`rounded-full border px-3 py-1 text-xs ${status === f.value ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `discography/page.tsx`を実装**

```tsx
// app/artists/[id]/discography/page.tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { buildArtistAlbumQuery } from '@/utils/artistAlbumQuery'
import { STREAMING_STATUS_LABEL } from '@/utils/format'
import { ALBUM_TYPE_LABEL_JA, ALBUM_TYPE_ORDER, classifyAlbumType, type AlbumType } from '@/utils/albumType'
import DiscographyFilters from '@/app/components/artist-detail/DiscographyFilters'

const PAGE_SIZE = 60 // 3列グリッドに揃うよう3の倍数(既存/albumsページと同じ単位)

type AlbumRow = {
  id: string
  title: string
  jacket_url: string | null
  release_date: string | null
  streaming_status: string | null
  track_count: number | null
  label: { name: string } | { name: string }[] | null
}

const UNRELEASED_VALUES = ['none', 'unreleased']

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export default async function DiscographyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ type?: string; status?: string; page?: string }>
}) {
  const { id } = await params
  const { type: typeParam, status: statusParam, page: pageParam } = await searchParams
  const type = ALBUM_TYPE_ORDER.includes(typeParam as AlbumType) ? (typeParam as AlbumType) : 'all'
  const status = statusParam === 'streaming' || statusParam === 'unreleased' ? statusParam : 'all'
  const page = Math.max(0, Number(pageParam ?? 0) || 0)

  const supabase = await createClient()
  const { data } = await buildArtistAlbumQuery<AlbumRow>(
    supabase,
    id,
    'id, title, jacket_url, release_date, streaming_status, track_count, label:label_id(name)'
  )

  let albums = (data ?? []).map((a) => ({ ...a, albumType: classifyAlbumType(a.title, a.track_count) }))
  if (type !== 'all') albums = albums.filter((a) => a.albumType === type)
  if (status === 'streaming') albums = albums.filter((a) => !UNRELEASED_VALUES.includes(a.streaming_status ?? ''))
  else if (status === 'unreleased') albums = albums.filter((a) => UNRELEASED_VALUES.includes(a.streaming_status ?? ''))

  const totalCount = albums.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = albums.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Discography</h2>
      <div className="mt-3">
        <DiscographyFilters type={type} status={status} />
      </div>
      <p className="mt-3 text-xs text-white/40">{totalCount}件</p>

      {pageItems.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当する作品が見つかりませんでした。</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {pageItems.map((album) => {
            const label = firstOf(album.label)
            const statusInfo = album.streaming_status ? STREAMING_STATUS_LABEL[album.streaming_status] : null
            return (
              <Link key={album.id} href={`/albums/${album.id}`} className="group block">
                <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                  {album.jacket_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={album.jacket_url} alt={album.title} className="h-full w-full object-cover transition group-hover:opacity-80" />
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-medium">{album.title}</p>
                <p className="truncate text-xs text-white/40">
                  {album.release_date ?? ''} · {ALBUM_TYPE_LABEL_JA[album.albumType]}
                </p>
                {label && <p className="truncate text-xs text-white/30">{label.name}</p>}
                {statusInfo && <p className="text-xs text-white/50">{statusInfo.icon} {statusInfo.label}</p>}
              </Link>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4 text-xs text-white/50">
          {page > 0 && (
            <Link href={`?${new URLSearchParams({ ...(type !== 'all' && { type }), ...(status !== 'all' && { status }), page: String(page - 1) }).toString()}`}>
              ← 前へ
            </Link>
          )}
          <span>{page + 1} / {totalPages}</span>
          {page + 1 < totalPages && (
            <Link href={`?${new URLSearchParams({ ...(type !== 'all' && { type }), ...(status !== 'all' && { status }), page: String(page + 1) }).toString()}`}>
              次へ →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: ローカルで表示確認**

`http://localhost:3000/artists/MS_ART_yu7eev56/discography`を開き、3列グリッド(Mobile幅では2列)でアルバムが表示され、種別/配信状況フィルターとページングが動作することを確認する。

- [ ] **Step 5: Commit**

```bash
git add "app/artists/[id]/discography/page.tsx" app/components/artist-detail/DiscographyFilters.tsx
git commit -m "feat: add artist detail Discography section"
```

---

### Task 7: Timelineセクション(既存ページを新シェルへ統合)

**Files:**
- Modify: `app/artists/[id]/timeline/page.tsx`(既存の独立ページを、新シェル配下のセクションページとして書き換え)
- Modify: `app/artists/[id]/ArtistTimeline.tsx`(変更不要な想定だが、`groupByYear`prop等の呼び出し方法をこのタスクで確認する)

**Interfaces:**
- Consumes: `ArtistTimeline`(既存)、`buildArtistAlbumQuery`/`buildArtistAppearanceQuery`(既存)、`fetchArtistMediaSelections`(既存)。
- Produces: なし(末端ページ)。

- [ ] **Step 1: 既存の`timeline/page.tsx`を読み、現在のデータ取得ロジックを確認**

Run: `cat "app/artists/[id]/timeline/page.tsx"` で全文を確認する(92行)。既存実装は独立した`BackLink`・`<div className="mx-auto max-w-[1600px] ...">`ラッパーを持っているはずなので、これらを新シェル(`layout.tsx`が既に持っている)と重複させないよう、Step 2で除去する。

- [ ] **Step 2: 新シェル向けに書き換え**

既存ファイルの中身(データ取得のPromise.all部分)はそのまま活かし、JSXの外側ラッパー(`<div className="mx-auto max-w-[1600px] px-6 py-12">` と`BackLink`)だけを取り除いて、`<ArtistTimeline ... groupByYear />`の呼び出しをそのまま返すようにする。具体的な差分は以下の形になる(既存のPromise.all・型定義は変更しない。returnブロックのみ変更する):

```tsx
// app/artists/[id]/timeline/page.tsx の return 部分を以下に変更する
// (import文からPromise.allまでの既存コードはそのまま残す。
//  Link, notFound, BackLink 由来の外枠だけを外す)

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Timeline</h2>
      <p className="mt-1 text-xs text-white/40">シングル・EPを含む全リリース、ライブ、フェス出演、タイアップ、メディア選出、受賞歴を年ごとに表示しています。</p>
      <ArtistTimeline
        albums={albums ?? []}
        musicEvents={musicEvents ?? []}
        eventAppearances={eventAppearances ?? []}
        tieUps={tieUps ?? []}
        mediaSelections={mediaSelections}
        awards={awards ?? []}
        groupByYear
      />
    </div>
  )
```

既存ファイルの冒頭にある`<h1>`や`BackLink`呼び出しの行は削除する(新シェルの`layout.tsx`が`BackLink`を1回だけ描画するため、セクションページ側では不要)。

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: ローカルで表示確認**

`http://localhost:3000/artists/MS_ART_yu7eev56/timeline`を開き、年ごとにグルーピングされた年表がCENTERカラムに表示されることを確認する。

- [ ] **Step 5: Commit**

```bash
git add "app/artists/[id]/timeline/page.tsx"
git commit -m "feat: move artist Timeline into the 3-column shell"
```

---

### Task 8: Festival & Liveセクション

**Files:**
- Create: `app/artists/[id]/live/page.tsx`
- Create: `app/components/artist-detail/LiveTabs.tsx`

**Interfaces:**
- Consumes: `buildArtistAppearanceQuery`(既存)。
- Produces: なし(末端ページ)。

- [ ] **Step 1: Upcoming/Past切り替えタブ(Client Component)を実装**

```tsx
// app/components/artist-detail/LiveTabs.tsx
'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export default function LiveTabs({ tab }: { tab: 'upcoming' | 'past' }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(nextTab: 'upcoming' | 'past') {
    const params = new URLSearchParams(searchParams.toString())
    if (nextTab === 'upcoming') params.delete('tab')
    else params.set('tab', 'past')
    const search = params.toString()
    router.push(search ? `${pathname}?${search}` : pathname)
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => navigate('upcoming')}
        className={`rounded-full border px-3 py-1 text-xs ${tab === 'upcoming' ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
      >
        Upcoming
      </button>
      <button
        type="button"
        onClick={() => navigate('past')}
        className={`rounded-full border px-3 py-1 text-xs ${tab === 'past' ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
      >
        Past
      </button>
    </div>
  )
}
```

- [ ] **Step 2: `live/page.tsx`を実装**

```tsx
// app/artists/[id]/live/page.tsx
import { createClient } from '@/utils/Supabase/server'
import { buildArtistAppearanceQuery } from '@/utils/artistAppearanceQuery'
import { formatDate } from '@/utils/format'
import LiveTabs from '@/app/components/artist-detail/LiveTabs'

type AppearanceRow = {
  id: number
  venue: string | null
  start_time: string | null
  event_edition: { year: number | null; venue: string | null; event: { name: string } | { name: string }[] | null } | { year: number | null; venue: string | null; event: { name: string } | { name: string }[] | null }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export default async function LivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab: tabParam } = await searchParams
  const tab = tabParam === 'past' ? 'past' : 'upcoming'

  const supabase = await createClient()
  const { data } = await buildArtistAppearanceQuery<AppearanceRow>(
    supabase,
    id,
    'id, venue, start_time, event_edition:event_edition_id(year, venue, event:event_id(name))'
  )

  const now = new Date().toISOString()
  const rows = (data ?? [])
    .filter((row) => (tab === 'upcoming' ? (row.start_time ?? '') > now : (row.start_time ?? '') <= now))
    .sort((a, b) => (tab === 'upcoming' ? (a.start_time ?? '').localeCompare(b.start_time ?? '') : (b.start_time ?? '').localeCompare(a.start_time ?? '')))

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Festival & Live</h2>
      <div className="mt-3">
        <LiveTabs tab={tab} />
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">{tab === 'upcoming' ? '予定されている出演はありません。' : '過去の出演履歴がありません。'}</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {rows.map((row) => {
            const edition = firstOf(row.event_edition)
            const event = edition ? firstOf(edition.event) : null
            return (
              <li key={row.id} className="py-3 text-sm">
                <p className="font-medium">{event?.name ?? '—'}</p>
                <p className="mt-0.5 text-xs text-white/40">
                  {row.start_time ? formatDate(row.start_time) : edition?.year ? `${edition.year}年` : ''}
                  {(row.venue ?? edition?.venue) ? ` · ${row.venue ?? edition?.venue}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 型チェックとローカル確認**

Run: `npx tsc --noEmit`。`http://localhost:3000/artists/MS_ART_yu7eev56/live`でUpcoming/Past切り替えが動作することを確認。

- [ ] **Step 4: Commit**

```bash
git add "app/artists/[id]/live/page.tsx" app/components/artist-detail/LiveTabs.tsx
git commit -m "feat: add artist detail Festival & Live section"
```

---

### Task 9: Networkセクション

**Files:**
- Create: `app/artists/[id]/network/page.tsx`
- Create: `app/components/artist-detail/ArtistNetworkList.tsx`

**Interfaces:**
- Consumes: `RelationGraph`/`RelationNode`/`RelationEdge`(既存`app/components/RelationGraph.tsx`)。
- Produces: なし(末端ページ)。

Desktop幅では既存の汎用`RelationGraph`をこのアーティスト起点のデータに絞って再利用する。Mobile幅ではグラフの代わりにシンプルなリストを出す(`RelationGraph`はグラフ専用のコンポーネントで、狭幅でのグラフ描画は視認性が悪いため)。

- [ ] **Step 1: Mobile用リスト表示を実装**

```tsx
// app/components/artist-detail/ArtistNetworkList.tsx
import Link from 'next/link'

export type NetworkRelation = {
  id: string
  otherArtistId: string
  otherArtistName: string
  otherArtistImageUrl: string | null
  relationType: 'membership' | 'production'
  description: string | null
}

const RELATION_TYPE_LABEL: Record<NetworkRelation['relationType'], string> = {
  membership: 'メンバー',
  production: 'プロデュース',
}

/** Mobile向けのシンプルな関係性リスト(RelationGraphの代替)。 */
export default function ArtistNetworkList({ relations }: { relations: NetworkRelation[] }) {
  if (relations.length === 0) {
    return <p className="mt-4 text-sm text-white/40">登録されている関係性はありません。</p>
  }

  return (
    <ul className="mt-4 divide-y divide-white/5">
      {relations.map((r) => (
        <li key={r.id} className="py-3">
          <Link href={`/artists/${r.otherArtistId}`} className="flex items-center gap-3 hover:opacity-70">
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/5">
              {r.otherArtistImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.otherArtistImageUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{r.otherArtistName}</p>
              <p className="text-xs text-white/40">{RELATION_TYPE_LABEL[r.relationType]}{r.description ? ` · ${r.description}` : ''}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: `network/page.tsx`を実装**

```tsx
// app/artists/[id]/network/page.tsx
import { createClient } from '@/utils/Supabase/server'
import RelationGraph, { type RelationNode, type RelationEdge } from '@/app/components/RelationGraph'
import ArtistNetworkList, { type NetworkRelation } from '@/app/components/artist-detail/ArtistNetworkList'

type RelationRow = {
  id: number
  relation_type: string
  description: string | null
  artist_id_a: string
  artist_id_b: string
  a: { id: string; name: string; image_url: string | null } | { id: string; name: string; image_url: string | null }[] | null
  b: { id: string; name: string; image_url: string | null } | { id: string; name: string; image_url: string | null }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export default async function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: artist } = await supabase.from('artist').select('id, name, image_url').eq('id', id).single()
  const { data: relationRows } = await supabase
    .from('artist_relation')
    .select('id, relation_type, description, artist_id_a, artist_id_b, a:artist_id_a(id, name, image_url), b:artist_id_b(id, name, image_url)')
    .in('relation_type', ['membership', 'production'])
    .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`)
    .overrideTypes<RelationRow[], { merge: false }>()

  const relations: NetworkRelation[] = (relationRows ?? [])
    .map((row) => {
      const a = firstOf(row.a)
      const b = firstOf(row.b)
      const other = row.artist_id_a === id ? b : a
      if (!other || (row.relation_type !== 'membership' && row.relation_type !== 'production')) return null
      return {
        id: String(row.id),
        otherArtistId: other.id,
        otherArtistName: other.name,
        otherArtistImageUrl: other.image_url,
        relationType: row.relation_type,
        description: row.description,
      }
    })
    .filter((r): r is NetworkRelation => r !== null)

  const nodes: RelationNode[] = artist
    ? [
        { id: artist.id, name: artist.name, imageUrl: artist.image_url, type: 'artist' },
        ...relations.map((r) => ({ id: r.otherArtistId, name: r.otherArtistName, imageUrl: r.otherArtistImageUrl, type: 'artist' as const })),
      ]
    : []
  const edges: RelationEdge[] = relations.map((r) => ({
    source: id,
    target: r.otherArtistId,
    style: 'solid',
    label: r.description,
  }))

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Artist Network</h2>
      <div className="mt-4 hidden lg:block">
        {relations.length === 0 ? (
          <p className="text-sm text-white/40">登録されている関係性はありません。</p>
        ) : (
          <RelationGraph nodes={nodes} edges={edges} />
        )}
      </div>
      <div className="lg:hidden">
        <ArtistNetworkList relations={relations} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `RelationGraph`の実際のprops名を確認し、必要なら合わせる**

Run: `grep -n "export default function RelationGraph" -A 15 app/components/RelationGraph.tsx`
このタスクを実装する担当者は、上記コードの`<RelationGraph nodes={nodes} edges={edges} />`呼び出しが実際のprops名(`nodes`/`edges`という命名でない場合はその名前)と一致するか確認し、必要に応じて呼び出し側を実際のシグネチャに合わせて修正すること。

- [ ] **Step 4: 型チェックとローカル確認**

Run: `npx tsc --noEmit`。`http://localhost:3000/artists/MS_ART_yu7eev56/network`(または関係性を持つ別のアーティストID)で、Desktop幅ではグラフ、Mobile幅(devtoolsで確認)ではリストが表示されることを確認する。

- [ ] **Step 5: Commit**

```bash
git add "app/artists/[id]/network/page.tsx" app/components/artist-detail/ArtistNetworkList.tsx
git commit -m "feat: add artist detail Network section"
```

---

### Task 10: Mediaセクション

**Files:**
- Create: `app/artists/[id]/media/page.tsx`

**Interfaces:**
- Consumes: `findRelatedNews`/`formatRelativeTime`(既存`utils/newsParser.ts`)、`fetchCachedNews`(既存`utils/newsCache.ts`)。
- Produces: なし(末端ページ)。

このセクションは「ニュース記事」のみを対象とする(既存`fetchArtistMediaSelections`はラジオのパワープレイ選出データであり、命名に反してニュースではない。それはTask 13のRadio Rotationセクションで使う)。

- [ ] **Step 1: `media/page.tsx`を実装**

```tsx
// app/artists/[id]/media/page.tsx
import { createClient } from '@/utils/Supabase/server'
import { findRelatedNews, formatRelativeTime } from '@/utils/newsParser'
import { fetchCachedNews } from '@/utils/newsCache'

const MEDIA_LIMIT = 30

export default async function MediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: artist }, { items }] = await Promise.all([
    supabase.from('artist').select('name, name_kana, name_en').eq('id', id).single(),
    fetchCachedNews(),
  ])

  const relatedNews = artist
    ? findRelatedNews(items, [artist.name, artist.name_kana, artist.name_en].filter((k): k is string => Boolean(k)), MEDIA_LIMIT)
    : []

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Media</h2>
      {relatedNews.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">関連する記事は見つかりませんでした。</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {relatedNews.map((item) => (
            <li key={item.id} className="py-3">
              <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline">
                {item.title}
              </a>
              <p className="mt-1 text-xs text-white/40">
                {item.source} · {formatRelativeTime(item.publishedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `utils/artistDetailCounts.ts`のmediaカウントを、このタスクで実際に計算できるようにする**

Task 1で`media: 0`固定にしていた値を、ここで正しく埋める。`app/artists/[id]/layout.tsx`(Task 4)の`fetchArtistSectionCounts`呼び出し後に、`findRelatedNews`の結果件数で上書きする形にする。`app/artists/[id]/layout.tsx`に以下の変更を加える:

```tsx
// app/artists/[id]/layout.tsx の counts 取得部分を以下のように変更する
// (変更前: const counts = await fetchArtistSectionCounts(supabase, id))
import { findRelatedNews } from '@/utils/newsParser'
import { fetchCachedNews } from '@/utils/newsCache'

// ... (既存のPromise.allの直後)
const [counts, { items: newsItemsForCount }] = await Promise.all([
  fetchArtistSectionCounts(supabase, id),
  fetchCachedNews(),
])
const mediaCount = findRelatedNews(
  newsItemsForCount,
  [artist.name, artist.name_kana, artist.name_en].filter((k): k is string => Boolean(k)),
  30
).length
counts.media = mediaCount
```

- [ ] **Step 3: 型チェックとローカル確認**

Run: `npx tsc --noEmit`。`http://localhost:3000/artists/MS_ART_yu7eev56/media`を開き、関連ニュースが表示され、RIGHTナビゲーションのMEDIAバッジに正しい件数が出ることを確認する。

- [ ] **Step 4: Commit**

```bash
git add "app/artists/[id]/media/page.tsx" "app/artists/[id]/layout.tsx"
git commit -m "feat: add artist detail Media section"
```

---

### Task 11: Rankingセクション

**Files:**
- Create: `app/artists/[id]/ranking/page.tsx`

**Interfaces:**
- Consumes: `buildArtistRankingAwardFilter`(Task 1、`utils/artistDetailCounts.ts`)。artist_id直接一致に加え、album_id/track_id経由の間接一致も含める(本番データの56%が間接一致のみのため必須。Task 1のInterfaces参照)。
- Produces: なし(末端ページ)。

- [ ] **Step 1: `ranking/page.tsx`を実装**

```tsx
// app/artists/[id]/ranking/page.tsx
import { createClient } from '@/utils/Supabase/server'
import { formatDate } from '@/utils/format'
import { buildArtistRankingAwardFilter } from '@/utils/artistDetailCounts'

type RankingEntryRow = {
  id: string
  period_date: string | null
  rank: number | null
  ranking: { id: string; name: string } | { id: string; name: string }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export default async function RankingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const rankingAwardFilter = await buildArtistRankingAwardFilter(supabase, id)
  const { data } = await supabase
    .from('ranking_entry')
    .select('id, period_date, rank, ranking:ranking_id!inner(id, name)')
    .or(rankingAwardFilter)
    .order('period_date', { ascending: false })
    .overrideTypes<RankingEntryRow[], { merge: false }>()

  const rows = data ?? []

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Ranking</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">ランキング掲載履歴はありません。</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {rows.map((row) => {
            const ranking = firstOf(row.ranking)
            return (
              <li key={row.id} className="py-3 text-sm">
                <p className="font-medium">{ranking?.name ?? '—'}</p>
                <p className="mt-0.5 text-xs text-white/40">
                  {row.period_date ? formatDate(row.period_date) : ''}
                  {row.rank ? ` · #${row.rank}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 型チェックとローカル確認**

Run: `npx tsc --noEmit`。`http://localhost:3000/artists/MS_ART_yu7eev56/ranking`で表示確認。

- [ ] **Step 3: Commit**

```bash
git add "app/artists/[id]/ranking/page.tsx"
git commit -m "feat: add artist detail Ranking section"
```

---

### Task 12: Awardsセクション

**Files:**
- Create: `app/artists/[id]/awards/page.tsx`

**Interfaces:**
- Consumes: `buildArtistRankingAwardFilter`(Task 1、`utils/artistDetailCounts.ts`)。artist_id直接一致に加え、album_id/track_id経由の間接一致も含める(本番データでは`award_entry`の唯一の行がartist_id null・album_id/track_id経由でのみ解決可能なため必須。Task 1のInterfaces参照)。
- Produces: なし(末端ページ)。

- [ ] **Step 1: `awards/page.tsx`を実装**

```tsx
// app/artists/[id]/awards/page.tsx
import { createClient } from '@/utils/Supabase/server'
import { buildArtistRankingAwardFilter } from '@/utils/artistDetailCounts'

type AwardEntryRow = {
  id: string
  year: number | null
  category: string | null
  result: string | null
  award: { name: string } | { name: string }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export default async function AwardsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const rankingAwardFilter = await buildArtistRankingAwardFilter(supabase, id)
  const { data } = await supabase
    .from('award_entry')
    .select('id, year, category, result, award:award_id(name)')
    .or(rankingAwardFilter)
    .order('year', { ascending: false })
    .overrideTypes<AwardEntryRow[], { merge: false }>()

  const rows = data ?? []

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Awards</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">受賞・ノミネート歴はありません。</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {rows.map((row) => {
            const award = firstOf(row.award)
            return (
              <li key={row.id} className="py-3 text-sm">
                <p className="font-medium">{[award?.name, row.category].filter(Boolean).join(' ')}</p>
                <p className="mt-0.5 text-xs text-white/40">
                  {row.year ? `${row.year}年` : ''}
                  {row.result ? ` · ${row.result}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 型チェックとローカル確認**

Run: `npx tsc --noEmit`。`http://localhost:3000/artists/MS_ART_yu7eev56/awards`で表示確認(受賞歴が無いアーティストの場合は空状態メッセージを確認)。

- [ ] **Step 3: Commit**

```bash
git add "app/artists/[id]/awards/page.tsx"
git commit -m "feat: add artist detail Awards section"
```

---

### Task 13: Radio Rotationセクション

**Files:**
- Create: `app/artists/[id]/radio/page.tsx`

**Interfaces:**
- Consumes: `fetchArtistMediaSelections`(既存、`radio_rotation`をtrack/album/artist直接指定の3方向から合算する)。
- Produces: なし(末端ページ)。

- [ ] **Step 1: `radio/page.tsx`を実装**

```tsx
// app/artists/[id]/radio/page.tsx
import { createClient } from '@/utils/Supabase/server'
import { fetchArtistMediaSelections } from '@/utils/fetchArtistMediaSelections'
import { formatDate } from '@/utils/format'

export default async function RadioRotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const selections = await fetchArtistMediaSelections(supabase, id)
  const rows = [...selections].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Radio Rotation</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">ラジオでの選出履歴はありません。</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {rows.map((row) => (
            <li key={row.id} className="py-3 text-sm">
              <p className="font-medium">{row.trackTitle ?? '—'}</p>
              <p className="mt-0.5 text-xs text-white/40">
                {row.date ? formatDate(row.date) : ''}
                {row.mediaName ? ` · ${row.mediaName}` : ''}
                {row.programName ? ` ${row.programName}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 型チェックとローカル確認**

Run: `npx tsc --noEmit`。`http://localhost:3000/artists/MS_ART_yu7eev56/radio`で表示確認。

- [ ] **Step 3: Commit**

```bash
git add "app/artists/[id]/radio/page.tsx"
git commit -m "feat: add artist detail Radio Rotation section"
```

---

### Task 14: 仕上げ(レスポンシブ確認・不要コードの整理)

**Files:**
- Modify: `app/artists/[id]/layout.tsx`(必要なら微調整)
- 削除候補の確認: 旧2カラム実装で使われていた`app/components/detail/StickyMiniHeader.tsx` / `VisualSlot.tsx` / `DetailHeader.tsx`は**アルバム・トラックページ側で引き続き使用中のため削除しない**(このタスクでは触らない)。旧`page.tsx`が持っていた`ArtistCreditQuadrantGraph`/`buildArtistCreditQuadrants`呼び出しは、Overview/Networkいずれにも移設されなかった場合、未使用として残っていないか確認する。

**Interfaces:**
- Consumes: Task 1〜13の全成果物。
- Produces: なし(最終確認タスク)。

- [ ] **Step 1: 未使用コードの確認**

Run: `npx eslint "app/artists/[id]/**/*.tsx" app/components/artist-detail --ext .tsx,.ts`
Expected: 未使用importの警告が出ないこと。もし`ArtistCreditQuadrantGraph`(既存、producers/collaborators/musiciansの散布図)がどのセクションからも呼ばれていない場合、これは意図的な非採用(Network セクションはRelationGraphベースに一本化する設計のため)であり、コンポーネント自体の削除は本タスクの範囲外(他ページから参照されていないか`grep -rln "ArtistCreditQuadrantGraph" app`で確認し、他に参照が無ければ将来のクリーンアップ候補としてのみ記録し、削除はしない)。

- [ ] **Step 2: Playwrightで実ブラウザ確認(PC)**

`playwright-core`を使い、`http://localhost:3000/artists/MS_ART_yu7eev56`(またはBasic Auth設定済みの場合は本番相当URL)をviewport 1440x900で開く。以下を確認する:
- LEFT/CENTER/RIGHTの3カラムが視覚的に約40:40:20の比率になっている
- CENTERを縦にスクロールしてもLEFT/RIGHTが画面内に留まる(sticky)
- RIGHTの各ナビゲーションリンクをクリックし、URLが`/artists/[id]/discography`等に変わり、LEFTの内容(画像・Biography)が再読み込みされない(ネットワークタブで`artist`テーブルへの再フェッチが発生しないことまでは確認不要、体感上ちらつかないことを目視確認すれば十分)

- [ ] **Step 3: Playwrightで実ブラウザ確認(Mobile)**

同じPlaywrightスクリプトをviewport 390x844で実行し、以下を確認する:
- Identity→2列ナビゲーション→Contentの順に縦積みになっている
- ナビゲーションが2列グリッドで、9項目が5行程度に収まっている(縦に間延びしていない)
- Discographyセクションが2列グリッドになっている

- [ ] **Step 4: 受賞歴・ランキング掲載・ラジオ選出のいずれも無いアーティストで空状態を確認**

award_entry/ranking_entryはartist_id直接一致だけでなくalbum_id/track_id経由でも解決されるため(Task 1参照)、単純に`award_entry.artist_id`の非存在だけでは判定できない。該当アーティストIDを1件探すには、そのアーティストのアルバム・トラックのidも含めて除外する:

```sql
SELECT a.id
FROM artist a
WHERE NOT EXISTS (
  SELECT 1 FROM award_entry ae
  WHERE ae.artist_id = a.id
     OR ae.album_id IN (SELECT id FROM album WHERE artist_id = a.id)
     OR ae.track_id IN (SELECT id FROM track WHERE artist_id = a.id)
)
LIMIT 1;
```

そのIDで`/awards`・`/ranking`・`/radio`を開き、大きな空状態カードではなく静かな1行のメッセージが出ることを確認する。

- [ ] **Step 5: 最終コミット**

Step 1〜4で修正が発生した場合のみコミットする。

```bash
git add -A
git commit -m "fix: responsive/polish pass for artist knowledge interface" --allow-empty
```

---

## 自己レビュー結果

- **spec網羅性**: 設計書の各セクション(LEFT Identity、RIGHT Navigation、Overview、Discography 3列、Timeline統合、Festival&Live、Network、Media、Ranking、Awards、Radio Rotation、Mobile 2列ナビゲーション、空状態、非ゴール)すべてにタスクが対応している。
- **プレースホルダー**: 無し。全ステップに実コード・実行コマンド・期待結果を記載。
- **型の一貫性**: `ArtistSectionCounts`(Task 1で定義)を`ArtistNav`(Task 3)・`ArtistNavMobile`(Task 4)・`layout.tsx`(Task 4)が同じ型で受け渡している。`NAV_SECTIONS`(Task 3で定義・export)を`ArtistNavMobile`(Task 4)がimportして再利用しており、ラベル・パスの二重管理を避けている。
- **設計書からの実装レベルの補足(1): Media/Radio Rotationのデータ源修正**: 設計書は「06. Media」のデータ源を`fetchArtistMediaSelections`と記載していたが、実装調査の結果この関数は`radio_rotation`(ラジオのパワープレイ等選出)を返す既存ユーティリティであり、ニュース記事とは無関係と判明した。Media(ニュース)は`findRelatedNews`、Radio Rotation(ラジオ選出)は`fetchArtistMediaSelections`、と対応を訂正して本プランに反映した(Task 10・Task 13)。設計書本体(`docs/superpowers/specs/2026-09-09-artist-knowledge-interface-design.md`)も同じ訂正を反映済み。
- **設計書からの実装レベルの補足(2): Ranking/Awardsの間接解決を必須化**: `ranking_entry`/`award_entry`は本番Supabaseで`artist_id`・`album_id`・`track_id`をそれぞれ独立して持ち、どの粒度で選出されたかによりいずれかがnullになる。2026-09-09にSupabaseへ直接クエリして確認した結果、`ranking_entry`の56%(1645/2932件)が`artist_id`がnullでalbum_id/track_id経由でしか解決できず、`award_entry`は本番に存在する唯一の1行がまさにそのケース(artist_id null)だった。既存`app/artists/[id]/page.tsx`の`artist_id`直接一致のみのクエリを踏襲すると、Ranking/Awardsセクションの大半〜全件が0件表示になってしまう欠陥を実装前に発見し、`utils/artistDetailCounts.ts`に`buildArtistRankingAwardFilter`を追加してTask 1(カウント)・Task 5(Overview)・Task 11(Ranking)・Task 12(Awards)すべてで一貫して間接解決するよう修正した。
