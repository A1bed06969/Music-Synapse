# アーティスト / アルバム / トラック詳細ページ 再設計 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3つの詳細ページを「ヘッダー行 → 見開き2段組 → 全幅の棚」という共通レイアウトに統一し、紹介文が無くても空白が目立たない状態にする。

**Architecture:** 共通部品を4つ(`DetailHeader` / `VisualSlot` / `ListenLinks` / `StickyMiniHeader`)新設し、既存の3つの`page.tsx`をその上に組み直す。`StickyMiniHeader`だけがクライアントコンポーネントで、残りはすべてサーバーコンポーネント。データ取得は各`page.tsx`に残す。

**Tech Stack:** Next.js App Router (この版は破壊的変更があるため`node_modules/next/dist/docs/`のガイドを必ず参照する) / React Server Components / Tailwind CSS / Supabase

**Spec:** `docs/superpowers/specs/2026-09-08-detail-pages-redesign-design.md`

## Global Constraints

- 既存のダークテーマ(`bg-[#0a0a0a]` / 白文字)を維持する。ライトテーマ化・テーマ切替は行わない
- 星評価・ユーザーレビュー・コレクション等のソーシャル機能は**一切作らない**
- 新規DBカラムは追加しない。紹介文は既存の`album_review` / `track_review` / `artist.bio`、MVは既存の`track.youtube_video_id` / `artist.url_latest_mv`を使う
- アルバムのMVは`album.representative_track_id`が指すトラックの`youtube_video_id`。未設定なら`track_no`が最小のトラックの`youtube_video_id`
- クレジットは削除しない。トラックページのクレジットは`<details>`(デフォルト閉じ、見出し「クレジット(N件)」)にして棚の下へ移す。アルバムページにクレジットは追加しない
- 見開きの左右比は `1.15 : 1`。`lg`未満では見開きを解除して1列に積む
- 左スロットの優先順は 紹介文 → MV → 大判アートワーク → 関連ジャケのモザイク。1と2は両方あれば両方を縦に積む
- 自動テストは追加しない。各タスクの検証は `npx tsc --noEmit` / `npx eslint <対象>` / `npm run build` と、ローカルdevサーバー(`npm run dev`)へのPlaywrightスクリーンショットで行う
- devサーバーへのアクセスにはBasic認証が必要(`.env.local`の`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`)
- コミットは関連ファイルのみ`git add`する(`-A`は使わない)

## 検証用の実データ(すべて本番DBに存在する)

| 用途 | ID | 備考 |
|---|---|---|
| アルバム(選出あり・11曲) | `MS_ALB_9rsjx0u6` | 藤井風「HELP EVER HURT NEVER」 |
| トラック(パワープレイ実績あり) | `MS_TRK_orlfyvj2` | 藤井風「優しさ」FM802ヘビロテ |
| アーティスト(bioあり・情報が最も多い) | `MS_ART_yu7eev56` | 藤井風 |

---

### Task 1: 配信リンクの共通部品 `ListenLinks`

**Files:**
- Create: `app/components/detail/ListenLinks.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type ListenLinkIds = {
    appleMusicId?: string | null
    spotifyId?: string | null
    youtubeMusicId?: string | null
    amazonMusicId?: string | null
  }
  export default function ListenLinks(props: {
    kind: 'album' | 'track'
    ids: ListenLinkIds
    extraLinks?: { label: string; href: string }[]
  }): JSX.Element | null
  ```

- [ ] **Step 1: コンポーネントを作成する**

`app/components/detail/ListenLinks.tsx`:

```tsx
export type ListenLinkIds = {
  appleMusicId?: string | null
  spotifyId?: string | null
  youtubeMusicId?: string | null
  amazonMusicId?: string | null
}

type Item = { key: string; label: string; href: string }

/** アルバム/トラック詳細ページのヘッダーに並べる配信サービスへのリンク。
 * yoynが小さい丸アイコンを並べるのに対し、こちらはサービス名を出したボタンにして
 * 見た目を分ける(設計書「①ヘッダー行」参照)。値が無いサービスは出さない。 */
export default function ListenLinks({
  kind,
  ids,
  extraLinks = [],
}: {
  kind: 'album' | 'track'
  ids: ListenLinkIds
  extraLinks?: { label: string; href: string }[]
}) {
  const items: Item[] = []

  if (ids.appleMusicId) {
    items.push({
      key: 'apple',
      label: 'Apple Music',
      href:
        kind === 'album'
          ? `https://music.apple.com/jp/album/${ids.appleMusicId}`
          : `https://music.apple.com/jp/song/${ids.appleMusicId}`,
    })
  }
  if (ids.spotifyId) {
    items.push({
      key: 'spotify',
      label: 'Spotify',
      href:
        kind === 'album'
          ? `https://open.spotify.com/album/${ids.spotifyId}`
          : `https://open.spotify.com/track/${ids.spotifyId}`,
    })
  }
  if (ids.youtubeMusicId) {
    items.push({
      key: 'youtube-music',
      label: 'YouTube Music',
      href:
        kind === 'album'
          ? `https://music.youtube.com/browse/${ids.youtubeMusicId}`
          : `https://music.youtube.com/watch?v=${ids.youtubeMusicId}`,
    })
  }
  if (ids.amazonMusicId) {
    items.push({
      key: 'amazon-music',
      label: 'Amazon Music',
      href:
        kind === 'album'
          ? `https://music.amazon.co.jp/albums/${ids.amazonMusicId}`
          : `https://music.amazon.co.jp/tracks/${ids.amazonMusicId}`,
    })
  }

  for (const [i, link] of extraLinks.entries()) {
    items.push({ key: `extra-${i}`, label: link.label, href: link.href })
  }

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <a
          key={item.key}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 transition hover:border-white/40 hover:text-white"
        >
          {item.label}
        </a>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 型チェックとlintを通す**

Run: `npx tsc --noEmit && npx eslint app/components/detail/ListenLinks.tsx`
Expected: どちらも出力なし(エラー0件)

- [ ] **Step 3: コミット**

```bash
git add app/components/detail/ListenLinks.tsx
git commit -m "feat: add ListenLinks component for album/track streaming links"
```

---

### Task 2: 見開き左の図版スロット `VisualSlot`

**Files:**
- Create: `app/components/detail/VisualSlot.tsx`

**Interfaces:**
- Produces:
  ```ts
  export default function VisualSlot(props: {
    review?: string | null
    youtubeVideoId?: string | null
    imageUrl?: string | null
    imageAlt: string
    imageShape?: 'square' | 'circle'
    mosaic?: { id: string; href: string; imageUrl: string | null; title: string }[]
  }): JSX.Element | null

  /** 呼び出し側が「見開きにするか1カラムにするか」を判定するための関数。
   * VisualSlotの戻り値で判定してはいけない(JSX要素は常に truthy になるため)。 */
  export function hasVisualContent(props: {
    review?: string | null
    youtubeVideoId?: string | null
    imageUrl?: string | null
    mosaicCount?: number
  }): boolean
  ```
  `hasVisualContent`が`false`のとき、呼び出し側は見開きを解除して右カラムを全幅にする(Task 5〜7で実装)。

- [ ] **Step 1: コンポーネントを作成する**

`app/components/detail/VisualSlot.tsx`:

```tsx
import Link from 'next/link'

type MosaicItem = { id: string; href: string; imageUrl: string | null; title: string }

/** 見開きにするか1カラムにするかの判定用。
 * `const visual = <VisualSlot/>` の戻り値はJSX要素なので、
 * コンポーネントが内部でnullを返しても常にtruthyになる。判定は必ずこの関数で行う。 */
export function hasVisualContent({
  review,
  youtubeVideoId,
  imageUrl,
  mosaicCount = 0,
}: {
  review?: string | null
  youtubeVideoId?: string | null
  imageUrl?: string | null
  mosaicCount?: number
}): boolean {
  return Boolean((review && review.trim()) || youtubeVideoId || imageUrl || mosaicCount > 0)
}

/** 見開きの左カラム。紹介文がほぼ存在しない(album_review 0件 / artist.bio 4件)ため、
 * テキストが無いときは図版で埋める。優先順は
 * 紹介文 → MV → 大判アートワーク → 関連ジャケのモザイク。
 * どれも無ければnullを返し、呼び出し側が見開きを解除する。 */
export default function VisualSlot({
  review,
  youtubeVideoId,
  imageUrl,
  imageAlt,
  imageShape = 'square',
  mosaic = [],
}: {
  review?: string | null
  youtubeVideoId?: string | null
  imageUrl?: string | null
  imageAlt: string
  imageShape?: 'square' | 'circle'
  mosaic?: MosaicItem[]
}) {
  const hasReview = Boolean(review && review.trim())
  const hasVideo = Boolean(youtubeVideoId)

  if (hasReview || hasVideo) {
    return (
      <div className="space-y-6">
        {hasReview && (
          <div>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">紹介</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/75">{review}</p>
          </div>
        )}
        {hasVideo && (
          <div>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
              ミュージックビデオ
            </h2>
            <div className="mt-2 aspect-video overflow-hidden rounded-md bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${youtubeVideoId}`}
                title={imageAlt}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="h-full w-full"
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  if (imageUrl) {
    return (
      <div>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">アートワーク</h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={imageAlt}
          className={`mt-2 aspect-square w-full object-cover ${
            imageShape === 'circle' ? 'rounded-full' : 'rounded-md'
          }`}
        />
      </div>
    )
  }

  if (mosaic.length > 0) {
    return (
      <div>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">関連作品</h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {mosaic.slice(0, 9).map((item) => (
            <Link key={item.id} href={item.href} className="group block">
              <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                    No Art
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  return null
}
```

- [ ] **Step 2: 型チェックとlintを通す**

Run: `npx tsc --noEmit && npx eslint app/components/detail/VisualSlot.tsx`
Expected: どちらも出力なし

- [ ] **Step 3: コミット**

```bash
git add app/components/detail/VisualSlot.tsx
git commit -m "feat: add VisualSlot component with review/MV/artwork fallback chain"
```

---

### Task 3: ヘッダー行の共通部品 `DetailHeader`

**Files:**
- Create: `app/components/detail/DetailHeader.tsx`

**Interfaces:**
- Consumes: `app/components/CurationTags.tsx` の `CurationRanking` 型(`{ id: string; name: string; source: string | null }`)
- Produces:
  ```ts
  export default function DetailHeader(props: {
    imageUrl: string | null
    imageAlt: string
    imageShape?: 'square' | 'circle'
    title: string
    subtitle?: React.ReactNode
    metaLine?: React.ReactNode
    actions?: React.ReactNode
    rankings?: CurationRanking[]
    id?: string
  }): JSX.Element
  ```
  `id`はTask 4の`StickyMiniHeader`が監視するDOM要素のidに使う。

- [ ] **Step 1: コンポーネントを作成する**

`app/components/detail/DetailHeader.tsx`:

```tsx
import type { ReactNode } from 'react'
import CurationTags, { type CurationRanking } from '@/app/components/CurationTags'

/** 3つの詳細ページ共通のヘッダー行。左からジャケット/写真・タイトル・属性行・
 * リンク列を並べ、右端に選出/表彰のカラムを縦線区切りで置く。
 * yoynは左に固定カラムを立てるが、こちらは横一列にして下を見開きに使う
 * (設計書「レイアウト規則」参照)。 */
export default function DetailHeader({
  imageUrl,
  imageAlt,
  imageShape = 'square',
  title,
  subtitle,
  metaLine,
  actions,
  rankings = [],
  id,
}: {
  imageUrl: string | null
  imageAlt: string
  imageShape?: 'square' | 'circle'
  title: string
  subtitle?: ReactNode
  metaLine?: ReactNode
  actions?: ReactNode
  rankings?: CurationRanking[]
  id?: string
}) {
  const rounded = imageShape === 'circle' ? 'rounded-full' : 'rounded-lg'

  return (
    <div id={id} className="flex flex-col gap-5 border-b border-white/10 pb-8 sm:flex-row sm:gap-6">
      <div className={`h-32 w-32 shrink-0 overflow-hidden bg-white/5 sm:h-40 sm:w-40 ${rounded}`}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={imageAlt} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-white/20">No Art</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
        {subtitle && <div className="mt-1.5 text-sm text-white/60">{subtitle}</div>}
        {metaLine && <div className="mt-2 text-xs text-white/45">{metaLine}</div>}
        {actions && <div className="mt-4">{actions}</div>}
      </div>

      {rankings.length > 0 && (
        <div className="shrink-0 sm:w-52 sm:border-l sm:border-white/10 sm:pl-6">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">選出・表彰</h2>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs sm:flex-col sm:items-start">
            <CurationTags rankings={rankings} />
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 型チェックとlintを通す**

Run: `npx tsc --noEmit && npx eslint app/components/detail/DetailHeader.tsx`
Expected: どちらも出力なし

- [ ] **Step 3: コミット**

```bash
git add app/components/detail/DetailHeader.tsx
git commit -m "feat: add DetailHeader component shared by the three detail pages"
```

---

### Task 4: スマホ用の縮小固定バー `StickyMiniHeader`

**Files:**
- Create: `app/components/detail/StickyMiniHeader.tsx`

**Interfaces:**
- Consumes: Task 3の`DetailHeader`が付ける`id`(監視対象のDOM要素)
- Produces:
  ```ts
  export default function StickyMiniHeader(props: {
    watchElementId: string
    imageUrl: string | null
    title: string
    subtitle?: string | null
  }): JSX.Element | null
  ```

- [ ] **Step 1: コンポーネントを作成する**

`app/components/detail/StickyMiniHeader.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

/** スマホでヘッダー行が画面外に出たときだけ、上部に出る縮小版のバー。
 * ジャケットとタイトルを常に見える状態に保つ(設計書「レスポンシブ」参照)。
 * SiteHeaderが sticky top-0 z-20 なので、その下に潜り込まないよう top-14 z-10 に置く。
 * PCでは見開きの高さを稼ぐため表示しない(lg:hidden)。 */
export default function StickyMiniHeader({
  watchElementId,
  imageUrl,
  title,
  subtitle,
}: {
  watchElementId: string
  imageUrl: string | null
  title: string
  subtitle?: string | null
}) {
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    const target = document.getElementById(watchElementId)
    if (!target) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setPinned(!entry.isIntersecting)
      },
      { rootMargin: '-56px 0px 0px 0px' }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [watchElementId])

  if (!pinned) return null

  return (
    <div className="fixed inset-x-0 top-14 z-10 border-b border-white/10 bg-[#0a0a0a]/95 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-6 py-2">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white/5">
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          {subtitle && <p className="truncate text-[11px] text-white/45">{subtitle}</p>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 型チェックとlintを通す**

Run: `npx tsc --noEmit && npx eslint app/components/detail/StickyMiniHeader.tsx`
Expected: どちらも出力なし

- [ ] **Step 3: コミット**

```bash
git add app/components/detail/StickyMiniHeader.tsx
git commit -m "feat: add StickyMiniHeader for mobile detail pages"
```

---

### Task 5: アルバムページを新レイアウトに組み替える

**Files:**
- Modify: `app/albums/[id]/page.tsx`

**Interfaces:**
- Consumes: `DetailHeader` / `VisualSlot` / `ListenLinks` / `StickyMiniHeader`(Task 1〜4)

- [ ] **Step 1: 追加データを取得するクエリを足す**

`app/albums/[id]/page.tsx` の `otherVersions` を取得している`await supabase...`の直後に、以下2つの取得を足す。

```tsx
  // 見開き左のMV用。アルバム自体は動画カラムを持たないため、代表曲(未設定なら
  // track_noが最小の曲)のyoutube_video_idを借りる(設計書「データの前提」参照)
  const mvTrackId = album.representative_track_id ?? tracks?.[0]?.id ?? null
  const { data: mvTrack } = mvTrackId
    ? await supabase.from('track').select('youtube_video_id').eq('id', mvTrackId).maybeSingle()
    : { data: null }

  // 棚:同じアーティストの他の作品(このアルバムと別バージョン群は除く)
  const { data: otherWorks } = artist
    ? await supabase
        .from('album')
        .select('id, title, jacket_url, release_date')
        .eq('artist_id', artist.id)
        .neq('id', id)
        .is('primary_album_id', null)
        .order('release_date', { ascending: false, nullsFirst: false })
        .limit(20)
    : { data: null }
```

- [ ] **Step 2: importを差し替える**

ファイル先頭のimport群に以下を足す。

```tsx
import DetailHeader from '@/app/components/detail/DetailHeader'
import VisualSlot, { hasVisualContent } from '@/app/components/detail/VisualSlot'
import ListenLinks from '@/app/components/detail/ListenLinks'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
```

- [ ] **Step 3: 返却JSXのヘッダー部(現在の98〜206行目の`<div className="mt-4 flex flex-col gap-6 sm:flex-row">`ブロック全体)を`DetailHeader`に置き換える**

置き換え後(`← アーティスト名`のパンくずリンクの直後に置く):

```tsx
      <StickyMiniHeader
        watchElementId="album-header"
        imageUrl={album.jacket_url}
        title={album.title}
        subtitle={artist?.name ?? null}
      />

      <div className="mt-4">
        <DetailHeader
          id="album-header"
          imageUrl={album.jacket_url}
          imageAlt={album.title}
          title={album.title}
          subtitle={
            allArtists.length > 0 ? (
              <span className="flex flex-wrap items-center gap-x-1">
                {allArtists.map((a, i) => (
                  <span key={a.id} className="flex items-center">
                    <Link href={`/artists/${a.id}`} className="hover:text-white">
                      {a.name}
                    </Link>
                    {i < allArtists.length - 1 && <span className="text-white/40">,</span>}
                  </span>
                ))}
              </span>
            ) : null
          }
          metaLine={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {album.album_type && <span>{ALBUM_TYPE_LABEL_JA[album.album_type as AlbumType] ?? album.album_type}</span>}
              <span>·</span>
              <span>{formatDate(album.release_date)}</span>
              {label && (
                <>
                  <span>·</span>
                  <Link href={`/labels/${label.id}`} className="hover:text-white">
                    {label.name}
                  </Link>
                </>
              )}
              {album.track_count && (
                <>
                  <span>·</span>
                  <span>{album.track_count}曲</span>
                </>
              )}
              {album.format && (
                <>
                  <span>·</span>
                  <span>{album.format}</span>
                </>
              )}
              {status && (
                <>
                  <span>·</span>
                  <span>
                    {status.icon} {status.label}
                  </span>
                </>
              )}
            </span>
          }
          actions={
            <ListenLinks
              kind="album"
              ids={{
                appleMusicId: album.apple_music_album_id,
                spotifyId: album.spotify_album_id,
                youtubeMusicId: album.youtube_music_album_id,
                amazonMusicId: album.amazon_music_album_id,
              }}
              extraLinks={[
                ...(album.tower_url ? [{ label: 'TOWER RECORDS', href: album.tower_url }] : []),
                ...(album.discogs_url ? [{ label: 'Discogs', href: album.discogs_url }] : []),
                ...(album.jan_code
                  ? [{ label: 'Amazonで探す', href: `https://www.amazon.co.jp/s?k=${album.jan_code}` }]
                  : []),
              ]}
            />
          }
          rankings={curationRankings}
        />
      </div>
```

- [ ] **Step 4: 見開き2段組を組む(現在の`{album.album_review && ...}`とトラックリストのsectionを包む)**

現在の208行目`{album.album_review && (...)}`から、トラックリストの`</section>`までを、以下の構造に置き換える。トラックリストの内側(`discNumbers.map(...)`以下)は既存のJSXをそのまま流用する。

```tsx
      {(() => {
        const mosaic = (otherWorks ?? []).map((w) => ({
          id: w.id,
          href: `/albums/${w.id}`,
          imageUrl: w.jacket_url,
          title: w.title,
        }))
        // 判定は必ずhasVisualContentで行う。<VisualSlot/>の戻り値はJSX要素なので
        // 中身が空でも常にtruthyになり、見開き解除が効かなくなる
        const showVisual = hasVisualContent({
          review: album.album_review,
          youtubeVideoId: mvTrack?.youtube_video_id ?? null,
          imageUrl: album.jacket_url,
          mosaicCount: mosaic.length,
        })

        return (
          <div className={showVisual ? 'mt-10 flex flex-col gap-10 lg:flex-row' : 'mt-10'}>
            {showVisual && (
              <div className="lg:w-[46%] lg:shrink-0">
                <VisualSlot
                  review={album.album_review}
                  youtubeVideoId={mvTrack?.youtube_video_id ?? null}
                  imageUrl={album.jacket_url}
                  imageAlt={album.title}
                  mosaic={mosaic}
                />
              </div>
            )}
            <section className="min-w-0 flex-1">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
                収録曲{tracks && tracks.length > 0 ? ` ${tracks.length}` : ''}
              </h2>
              {/* ここから既存のトラックリストJSXをそのまま(h2は上で置き換え済みなので削る) */}
            </section>
          </div>
        )
      })()}
```

**注意:** 既存のトラックリストは`<h2 className="text-lg font-semibold">トラックリスト</h2>`を持っているので、その行は削除する(上の新しい`<h2>`が代わりになる)。`!tracks || tracks.length === 0`の空状態メッセージと、`discNumbers`の複数枚組分岐はそのまま残す。

- [ ] **Step 5: 棚(全幅)を組む**

「掲載ディスクガイド」「その他のバージョン」のsectionはそのまま残し、その前に「同じアーティストの他の作品」を足す。

```tsx
      {otherWorks && otherWorks.length > 0 && artist && (
        <section className="mt-14">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            {artist.name}の他の作品
          </h2>
          <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
            {otherWorks.map((work) => (
              <Link key={work.id} href={`/albums/${work.id}`} className="group w-28 shrink-0">
                <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                  {work.jacket_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={work.jacket_url}
                      alt={work.title}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                      No Art
                    </div>
                  )}
                </div>
                <p className="mt-1.5 truncate text-xs group-hover:opacity-70">{work.title}</p>
                <p className="truncate text-[10px] text-white/30">{formatDate(work.release_date)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
```

- [ ] **Step 6: 型チェック・lint・ビルドを通す**

Run: `npx tsc --noEmit && npx eslint app/albums/\[id\]/page.tsx && npm run build`
Expected: エラーなくビルド完了

- [ ] **Step 7: 実機で見た目を確認する**

devサーバーを起動する。

```bash
npm run dev > /tmp/next-dev.log 2>&1 &
until curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200\|401"; do sleep 1; done
```

`/tmp/shot-album.js` を作成して実行する。

```js
const { chromium } = require('/Users/th/dev/music-synapse/node_modules/playwright-core')
;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    httpCredentials: { username: process.env.BASIC_AUTH_USER, password: process.env.BASIC_AUTH_PASSWORD },
    viewport: { width: 1280, height: 1200 },
  })
  const page = await ctx.newPage()
  await page.goto('http://localhost:3000/albums/MS_ALB_9rsjx0u6', { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: '/tmp/album-pc.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 800 })
  await page.reload({ waitUntil: 'load' })
  await page.evaluate(() => window.scrollTo(0, 900))
  await page.waitForTimeout(600)
  await page.screenshot({ path: '/tmp/album-sp-scrolled.png' })
  await browser.close()
})()
```

Run: `node --env-file=.env.local /tmp/shot-album.js`

`/tmp/album-pc.png` を目視し、次を確認する:
1. ヘッダー行にジャケット・タイトル・配信リンクが並び、右端に「選出・表彰」バッジが出ている
2. 見開きの左に**大判ジャケット**が出ている(このアルバムは`album_review`が空のため)
3. 見開きの右に収録曲11曲が並んでいる
4. 下に「藤井風の他の作品」の横スクロール棚が出ている

`/tmp/album-sp-scrolled.png` を目視し、スクロール後に上部へ縮小バー(小ジャケ+タイトル)が固定表示されていることを確認する。

- [ ] **Step 8: 紹介文が入ると左が切り替わることを確認する(設計書テスト項目2)**

一時的に`album_review`を入れて、左カラムが大判ジャケットから紹介文に切り替わることを確認し、確認後は必ず元に戻す。

```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
await s.from('album').update({ album_review: '【表示確認用の仮テキスト】岡山出身のシンガーソングライター藤井風の1stアルバム。' }).eq('id', 'MS_ALB_9rsjx0u6')
console.log('セット完了')
"
```

`node --env-file=.env.local /tmp/shot-album.js` を再実行し、`/tmp/album-pc.png` で左カラムが
「紹介」見出し+本文になっていることを確認する。確認できたら**必ず元に戻す**。

```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
await s.from('album').update({ album_review: null }).eq('id', 'MS_ALB_9rsjx0u6')
console.log('元に戻しました')
"
```

- [ ] **Step 9: devサーバーを止めてコミット**

```bash
pkill -f "next dev"
git add app/albums/\[id\]/page.tsx
git commit -m "feat: rebuild album detail page with header/spread/shelf layout"
```

---

### Task 6: トラックページを新レイアウトに組み替える

**Files:**
- Modify: `app/tracks/[id]/page.tsx`

**Interfaces:**
- Consumes: `DetailHeader` / `VisualSlot` / `ListenLinks` / `StickyMiniHeader`(Task 1〜4)

- [ ] **Step 1: 棚用のデータ取得を足す**

既存の`Promise.all([...])`の後ろに、同じアルバムの他の曲を取る処理を足す。

```tsx
  // 棚:このアルバムの他の曲(前後の曲へ移動できる導線)
  const { data: siblingTracks } = track.album_id
    ? await supabase
        .from('track')
        .select('id, track_no, title, duration_seconds')
        .eq('album_id', track.album_id)
        .neq('id', id)
        .order('track_no', { ascending: true })
        .limit(50)
    : { data: null }
```

- [ ] **Step 2: importを足す**

```tsx
import DetailHeader from '@/app/components/detail/DetailHeader'
import VisualSlot, { hasVisualContent } from '@/app/components/detail/VisualSlot'
import ListenLinks from '@/app/components/detail/ListenLinks'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
```

- [ ] **Step 3: ヘッダー部(現在の159〜193行目の`<div className="mt-4 flex items-start gap-5">`ブロック)を`DetailHeader`に置き換える**

```tsx
      <StickyMiniHeader
        watchElementId="track-header"
        imageUrl={album?.jacket_url ?? null}
        title={track.title}
        subtitle={allArtists[0]?.name ?? null}
      />

      <div className="mt-4">
        <DetailHeader
          id="track-header"
          imageUrl={album?.jacket_url ?? null}
          imageAlt={track.title}
          title={track.title}
          subtitle={
            allArtists.length > 0 ? (
              <span className="flex flex-wrap items-center gap-x-1">
                {allArtists.map((a, i) => (
                  <span key={a.id} className="flex items-center">
                    <Link href={`/artists/${a.id}`} className="hover:text-white">
                      {a.name}
                    </Link>
                    {i < allArtists.length - 1 && <span className="text-white/40">,</span>}
                  </span>
                ))}
              </span>
            ) : null
          }
          metaLine={
            <span className="flex flex-wrap items-center gap-x-2">
              {album && (
                <>
                  <Link href={`/albums/${album.id}`} className="hover:text-white">
                    {album.title}
                  </Link>
                  <span>·</span>
                </>
              )}
              <span>{formatDuration(track.duration_seconds)}</span>
            </span>
          }
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <PreviewButton previewUrl={track.preview_url} trackId={track.id} size="lg" />
              <ListenLinks
                kind="track"
                ids={{
                  appleMusicId: track.apple_music_track_id,
                  spotifyId: track.spotify_track_id,
                  youtubeMusicId: track.youtube_music_track_id,
                  amazonMusicId: track.amazon_music_track_id,
                }}
                extraLinks={track.lyric_url ? [{ label: '歌詞を見る', href: track.lyric_url }] : []}
              />
            </div>
          }
          rankings={curationRankings}
        />
      </div>
```

同時に、既存の`{track.lyric_url && (<a ...>歌詞を見る</a>)}`のブロック(221〜230行目)は`extraLinks`に移したので**削除する**。

- [ ] **Step 4: 見開き2段組を組む**

現在の`{(track.track_review || hasPlayer) && (...)}`ブロック(195〜219行目)と、その後ろの「使用楽器」「パワープレイ」「タイアップ」の各sectionを、以下の構造に組み替える。各sectionの中身(`<ul>`以下)は既存JSXをそのまま流用する。

```tsx
      {(() => {
        const showVisual = hasVisualContent({
          review: track.track_review,
          youtubeVideoId: track.youtube_video_id,
          imageUrl: album?.jacket_url ?? null,
        })
        const hasRightContent =
          rotations.length > 0 || syncEntries.length > 0 || instrumentGroups.length > 0

        if (!showVisual && !hasRightContent) return null

        return (
          <div className={showVisual && hasRightContent ? 'mt-10 flex flex-col gap-10 lg:flex-row' : 'mt-10'}>
            {showVisual && (
              <div className={hasRightContent ? 'lg:w-[46%] lg:shrink-0' : ''}>
                <VisualSlot
                  review={track.track_review}
                  youtubeVideoId={track.youtube_video_id}
                  imageUrl={album?.jacket_url ?? null}
                  imageAlt={track.title}
                />
              </div>
            )}
            {hasRightContent && (
              <div className="min-w-0 flex-1 space-y-8">
                {/* ここに既存の「パワープレイ/ヘビロテ実績」「タイアップ実績」「使用楽器」の
                    各sectionをこの順で移設する。各h2のクラスは
                    text-[11px] font-medium uppercase tracking-[0.14em] text-white/35 に揃える */}
              </div>
            )}
          </div>
        )
      })()}
```

**注意:** `rotations` / `syncEntries` / `instrumentGroups` は既存の変数名。存在しない場合は既存コードの該当変数名に合わせること。

- [ ] **Step 5: クレジットを棚の下の折りたたみに移す**

現在の`{creditGroups.length > 0 && (<section>...クレジット...</section>)}`を、ファイル末尾側(棚のあと)へ移し、`<details>`で包む。

```tsx
      {creditGroups.length > 0 && (
        <details className="mt-14 border-t border-white/10 pt-6">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-[0.14em] text-white/35 hover:text-white/60">
            クレジット({creditGroups.length}件)
          </summary>
          <ul className="mt-3 space-y-1.5 text-sm">
            {/* 既存の creditGroups.map(...) をそのまま */}
          </ul>
        </details>
      )}
```

- [ ] **Step 6: 「このアルバムの他の曲」の棚を足す(クレジットの直前)**

```tsx
      {siblingTracks && siblingTracks.length > 0 && album && (
        <section className="mt-14">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            {album.title}の他の曲
          </h2>
          <ol className="mt-3 divide-y divide-white/10">
            {siblingTracks.map((t) => (
              <li key={t.id}>
                <Link href={`/tracks/${t.id}`} className="flex items-center gap-4 py-2.5 text-sm hover:opacity-70">
                  <span className="w-5 shrink-0 text-right text-white/30">{t.track_no ?? '-'}</span>
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="text-white/30">{formatDuration(t.duration_seconds)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
```

- [ ] **Step 7: 型チェック・lint・ビルドを通す**

Run: `npx tsc --noEmit && npx eslint app/tracks/\[id\]/page.tsx && npm run build`
Expected: エラーなし

- [ ] **Step 8: 実機で確認する**

devサーバーを起動し(Task 5 Step 7と同じ手順)、`/tmp/shot-track.js`のURLを
`http://localhost:3000/tracks/MS_TRK_orlfyvj2`に変えて実行する。

確認項目:
1. ヘッダーに試聴ボタン・配信リンク・(あれば)歌詞リンクが並んでいる
2. 見開き左に大判ジャケット、右に「パワープレイ/ヘビロテ実績」(FM802 ヘビーローテーション)が出ている
3. 下に「HELP EVER HURT NEVERの他の曲」が並んでいる
4. クレジットが折りたたみ(閉じた状態)で最下部にある
5. 以前のような大きな空白が無い

- [ ] **Step 9: devサーバーを止めてコミット**

```bash
pkill -f "next dev"
git add app/tracks/\[id\]/page.tsx
git commit -m "feat: rebuild track detail page with header/spread/shelf layout"
```

---

### Task 7: アーティストページを新レイアウトに組み替える

**Files:**
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Consumes: `DetailHeader` / `VisualSlot` / `StickyMiniHeader`(Task 2〜4。配信/SNSは既存の`ArtistLinkIcons`を使うため`ListenLinks`は使わない)

- [ ] **Step 1: 「代表曲」のデータ取得を足す**

既存のデータ取得の後ろに足す。

```tsx
  // 見開き右の「代表曲」。パワープレイ実績と選出の件数が多い順に最大5曲。
  // どちらも無いアーティストではセクションごと出さない。
  const { data: artistTracks } = await supabase
    .from('track')
    .select('id, title, album:album_id(id, jacket_url)')
    .eq('artist_id', id)
    .limit(200)

  const trackIds = (artistTracks ?? []).map((t) => t.id)
  const [{ data: rotationCounts }, { data: rankingCounts }] =
    trackIds.length > 0
      ? await Promise.all([
          supabase.from('radio_rotation').select('track_id').in('track_id', trackIds),
          supabase.from('ranking_entry').select('track_id').in('track_id', trackIds),
        ])
      : [{ data: [] }, { data: [] }]

  const scoreByTrackId = new Map<string, number>()
  for (const row of [...(rotationCounts ?? []), ...(rankingCounts ?? [])]) {
    if (!row.track_id) continue
    scoreByTrackId.set(row.track_id, (scoreByTrackId.get(row.track_id) ?? 0) + 1)
  }
  const topTracks = (artistTracks ?? [])
    .map((t) => ({ ...t, score: scoreByTrackId.get(t.id) ?? 0 }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
```

- [ ] **Step 2: importを足す**

```tsx
import DetailHeader from '@/app/components/detail/DetailHeader'
import VisualSlot, { hasVisualContent } from '@/app/components/detail/VisualSlot'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
```

- [ ] **Step 3: ヘッダー部を`DetailHeader`に置き換える**

既存のヘッダー(アーティスト画像・名前・読み・タグ・配信/SNSリンクを並べているブロック)を、以下に置き換える。`ArtistLinkIcons`への渡し値は既存のものをそのまま使う。

```tsx
      <StickyMiniHeader
        watchElementId="artist-header"
        imageUrl={artist.image_url}
        title={artist.name}
        subtitle={artist.name_kana ?? artist.name_en ?? null}
      />

      <div className="mt-4">
        <DetailHeader
          id="artist-header"
          imageUrl={artist.image_url}
          imageAlt={artist.name}
          imageShape="circle"
          title={artist.name}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2">
              {artist.name_kana && <span>{artist.name_kana}</span>}
              {artist.name_en && <span className="text-white/40">{artist.name_en}</span>}
            </span>
          }
          metaLine={
            <span className="flex flex-wrap items-center gap-x-2">
              {artist.artist_type && (
                <span>
                  {ARTIST_TYPE_LABEL[artist.artist_type as keyof typeof ARTIST_TYPE_LABEL] ?? artist.artist_type}
                </span>
              )}
              {artist.formed_year && (
                <>
                  <span>·</span>
                  <span>結成 {artist.formed_year}年</span>
                </>
              )}
              {(artist.origin_prefecture || artist.hometown_city) && (
                <>
                  <span>·</span>
                  <span>{artist.hometown_city ?? artist.origin_prefecture}</span>
                </>
              )}
              {artist.streaming_status && (
                <>
                  <span>·</span>
                  <span>配信: {ARTIST_STREAMING_STATUS_LABEL[artist.streaming_status]}</span>
                </>
              )}
            </span>
          }
          actions={
            <ArtistLinkIcons
              artistName={artist.name}
              officialSiteUrl={artist.official_site_url}
              snsXUrl={artist.sns_x_url}
              snsInstagramUrl={artist.sns_instagram_url}
              appleMusicArtistId={artist.apple_music_artist_id}
              spotifyArtistId={artist.spotify_artist_id}
              externalLinks={externalLinks ?? []}
            />
          }
          rankings={curationRankings}
        />
      </div>
```

- [ ] **Step 4: 見開き2段組を組む**

既存のBiographyセクションとLatest MVセクションを、見開きに組み替える。

```tsx
      {(() => {
        const showVisual = hasVisualContent({
          review: artist.bio,
          youtubeVideoId: mvVideoId,
          imageUrl: artist.image_url,
        })
        const hasRightContent = topTracks.length > 0 || festivalAppearances.length > 0

        if (!showVisual && !hasRightContent) return null

        return (
          <div className={showVisual && hasRightContent ? 'mt-10 flex flex-col gap-10 lg:flex-row' : 'mt-10'}>
            {showVisual && (
              <div className={hasRightContent ? 'lg:w-[46%] lg:shrink-0' : ''}>
                <VisualSlot
                  review={artist.bio}
                  youtubeVideoId={mvVideoId}
                  imageUrl={artist.image_url}
                  imageAlt={artist.name}
                  imageShape="circle"
                />
              </div>
            )}
            {hasRightContent && (
              <div className="min-w-0 flex-1 space-y-8">
                {topTracks.length > 0 && (
                  <section>
                    <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">代表曲</h2>
                    <ol className="mt-3 divide-y divide-white/10">
                      {topTracks.map((t) => {
                        const tAlbum = Array.isArray(t.album) ? t.album[0] : t.album
                        return (
                          <li key={t.id}>
                            <Link href={`/tracks/${t.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:opacity-70">
                              <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white/5">
                                {tAlbum?.jacket_url && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={tAlbum.jacket_url} alt="" className="h-full w-full object-cover" />
                                )}
                              </div>
                              <span className="flex-1 truncate">{t.title}</span>
                            </Link>
                          </li>
                        )
                      })}
                    </ol>
                  </section>
                )}
                {/* ここに既存の「ライブ / フェス出演」セクションを移設する。
                    h2のクラスは上と同じものに揃える */}
              </div>
            )}
          </div>
        )
      })()}
```

**注意:** `festivalAppearances` は既存の変数名に合わせること(既存コードで使っている名前を確認して置き換える)。

- [ ] **Step 5: 棚(ディスコグラフィ・年表・相関図)はそのまま残す**

既存のディスコグラフィ・タイムライン・相関図プレビューの各sectionは移動しない。ただし見出しのクラスを
`text-[11px] font-medium uppercase tracking-[0.14em] text-white/35` に統一する。

- [ ] **Step 6: 型チェック・lint・ビルドを通す**

Run: `npx tsc --noEmit && npx eslint app/artists/\[id\]/page.tsx && npm run build`
Expected: エラーなし

- [ ] **Step 7: 実機で確認する**

devサーバーを起動し、`http://localhost:3000/artists/MS_ART_yu7eev56` を撮影する。

確認項目:
1. ヘッダーに円形写真・名前・配信/SNSリンク・右端に「選出・表彰」(RADAR: Early Noise)が出ている
2. 見開き左にバイオグラフィー(このアーティストは`bio`あり)、右に「代表曲」とフェス出演が出ている
3. ディスコグラフィの横スクロール・年表・相関図プレビューが以前どおり動く
4. 相関図プレビューの「相関図を全画面で見る →」リンクが生きている

- [ ] **Step 8: devサーバーを止めてコミット**

```bash
pkill -f "next dev"
git add app/artists/\[id\]/page.tsx
git commit -m "feat: rebuild artist detail page with header/spread/shelf layout"
```

---

### Task 8: 本番デプロイと確認

**Files:** なし(デプロイのみ)

- [ ] **Step 1: pushする**

```bash
git push origin main
```

- [ ] **Step 2: 本番へデプロイする**

```bash
npx vercel deploy --prod --yes
```

「Not authorized」で失敗した場合は同じコマンドをもう一度実行する(このプロジェクトで頻発する一時的なエラー)。

- [ ] **Step 3: 本番で3ページを確認する**

```bash
USER=$(grep "^BASIC_AUTH_USER=" .env.local | cut -d= -f2-)
PASS=$(grep "^BASIC_AUTH_PASSWORD=" .env.local | cut -d= -f2-)
curl -s -o /dev/null -w "artist: %{http_code}\n" -u "$USER:$PASS" "https://music-synapse.vercel.app/artists/MS_ART_yu7eev56"
curl -s -o /dev/null -w "album:  %{http_code}\n" -u "$USER:$PASS" "https://music-synapse.vercel.app/albums/MS_ALB_9rsjx0u6"
curl -s -o /dev/null -w "track:  %{http_code}\n" -u "$USER:$PASS" "https://music-synapse.vercel.app/tracks/MS_TRK_orlfyvj2"
```

Expected: 3つとも `200`
