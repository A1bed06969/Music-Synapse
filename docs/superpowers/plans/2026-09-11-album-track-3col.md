# アルバム・トラック詳細ページ 3カラム化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the album and track detail pages (`app/albums/[id]/page.tsx`, `app/tracks/[id]/page.tsx`) into a fixed 3-column shell (LEFT=identity/RIGHT=related content/CENTER=independently-scrolling primary content), matching the visual taste already shipped for the artist detail page.

**Architecture:** A new shared, purely presentational shell component (`DetailPageShell`) replaces the current single-column "magazine spread" wrapper on both pages. New LEFT/CENTER components per page type replace the shared `DetailHeader`/`VisualSlot` components, which are deleted once both pages stop using them. All existing data-fetching queries are kept as-is except one new query (album power-play rotations) and one added column (`youtube_video_id` on the album's tracks query).

**Tech Stack:** Next.js App Router (Server Components + one Client Component for the album MV/tracklist tab), Supabase/PostgREST, Tailwind CSS, `node:test` for pure-logic unit tests.

**Spec:** `docs/superpowers/specs/2026-09-11-album-track-3col-design.md`

## Global Constraints

- Do not modify `app/artists/[id]/layout.tsx` or any artist-page component. The new shell is a separate component; duplication with the artist layout's pattern is accepted (per spec's non-goals).
- Reuse `ListenLinks`, `RotationModal`, `CurationTags`, `PreviewButton`, `StickyMiniHeader`, `BackLink` exactly as they exist today — no prop-signature changes to any of them.
- No new npm dependencies.
- No `next/image` — keep the project's existing `<img>` + `eslint-disable-next-line @next/next/no-img-element` convention.
- Delete `app/components/detail/VisualSlot.tsx` (and its `hasVisualContent` export) and `app/components/detail/DetailHeader.tsx` only after both page rewrites no longer import them (Task 9), and only after confirming via grep that nothing else in `app/` imports them.
- Every task must pass `npm run build` (Next.js type-check + compile) before being considered done.
- Follow the existing dark-theme Tailwind tokens already used on these pages (`text-white/40`, `border-white/10`, `text-[11px] font-medium uppercase tracking-[0.14em] text-white/35` for section headings, etc.) — do not invent a new visual language.

---

### Task 1: `DetailPageShell` shared 3-column shell

**Files:**
- Create: `app/components/detail/DetailPageShell.tsx`

**Interfaces:**
- Produces: `export default function DetailPageShell({ left, center, right }: { left: React.ReactNode; center: React.ReactNode; right: React.ReactNode })` — a purely presentational layout component with no data fetching. Tasks 5 and 8 consume this.

- [ ] **Step 1: Write the component**

```tsx
// app/components/detail/DetailPageShell.tsx
import type { ReactNode } from 'react'
import SiteFooter from '@/app/components/SiteFooter'

// SiteHeaderの実測高さ(border込み)。app/artists/[id]/layout.tsxの
// --artist-shell-h と同じ値・同じ理由(デスクトップのLEFT/RIGHTカラムを
// この下に固定するための基準値)。
const HEADER_HEIGHT_PX = 57

/** アルバム・トラック詳細ページ共通の3カラムシェル。アーティストページの
 * layout.tsx(app/artists/[id]/layout.tsx)で確立した固定高さ3カラム
 * パターン(LEFT/RIGHTは高さ固定・独立スクロール、CENTERだけが伸びる、
 * フッターはCENTERの中だけ)をアルバム・トラック向けに一般化したもの。
 * ページ内ナビゲーションの概念は持たない、純粋なレイアウト用コンポーネント。
 * アーティストページのlayout.tsxはこのコンポーネントを使わない
 * (意図的に別実装のまま。docs/superpowers/specs/2026-09-11-album-track-3col-design.md参照)。 */
export default function DetailPageShell({
  left,
  center,
  right,
}: {
  left: ReactNode
  center: ReactNode
  right: ReactNode
}) {
  return (
    <div
      className="lg:flex lg:flex-row lg:overflow-hidden"
      style={{ ['--detail-shell-h' as string]: `calc(100vh - ${HEADER_HEIGHT_PX}px)` }}
    >
      {/* Mobile(lg:未満): 通常のページスクロール、LEFT→CENTER→RIGHTの縦積み */}
      <div className="px-6 lg:hidden">
        <div className="pt-3">{left}</div>
        <div className="mt-8 min-w-0">{center}</div>
        <div className="mt-8 min-w-0 pb-8">{right}</div>
      </div>
      <div className="lg:hidden">
        <SiteFooter />
      </div>

      {/* Desktop(lg:以上): LEFT/RIGHTは固定、CENTERだけが独立スクロールし
          フッターもCENTERの中にだけ表示する。 */}
      <div className="hidden lg:block lg:h-[var(--detail-shell-h)] lg:w-[32%] lg:min-w-[320px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-white/5">
        <div className="px-8 pt-3">{left}</div>
      </div>
      <div className="hidden lg:block lg:h-[var(--detail-shell-h)] lg:min-w-0 lg:flex-1 lg:overflow-y-auto">
        <div className="px-8 pt-4 pb-8">{center}</div>
        <SiteFooter />
      </div>
      <div className="hidden lg:block lg:h-[var(--detail-shell-h)] lg:w-[26%] lg:min-w-[260px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-white/5">
        <div className="px-8 pt-4">{right}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (this component isn't imported anywhere yet, so this only checks for syntax/type errors in isolation — TypeScript still checks unreferenced files that are part of the `app/` tree).

- [ ] **Step 3: Commit**

```bash
git add app/components/detail/DetailPageShell.tsx
git commit -m "feat: add shared 3-column shell for album/track detail pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `orderAlbumTracksForMv` pure function (TDD)

**Files:**
- Create: `utils/albumMvOrder.ts`
- Test: `__tests__/album-mv-order.unit.test.ts`

**Interfaces:**
- Produces: `export type AlbumMvOrderTrack = { id: string; disc_number: number | null; track_no: number | null; youtube_video_id: string | null }` and `export function orderAlbumTracksForMv<T extends AlbumMvOrderTrack>(tracks: T[], representativeTrackId: string | null): T[]`. Task 4 (`AlbumCenterTabs`) consumes this.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/album-mv-order.unit.test.ts
//
// アルバムのMVタブ用に、YouTube動画を持つ収録曲を絞り込み・並び替えする
// 純粋関数のテスト。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { orderAlbumTracksForMv } from '../utils/albumMvOrder.ts'

describe('orderAlbumTracksForMv', () => {
  test('filters out tracks without a youtube_video_id', () => {
    const result = orderAlbumTracksForMv(
      [
        { id: 't1', disc_number: 1, track_no: 1, youtube_video_id: 'abc' },
        { id: 't2', disc_number: 1, track_no: 2, youtube_video_id: null },
      ],
      null
    )
    assert.deepEqual(result.map((t) => t.id), ['t1'])
  })

  test('sorts by disc_number then track_no ascending', () => {
    const result = orderAlbumTracksForMv(
      [
        { id: 't1', disc_number: 2, track_no: 1, youtube_video_id: 'a' },
        { id: 't2', disc_number: 1, track_no: 2, youtube_video_id: 'b' },
        { id: 't3', disc_number: 1, track_no: 1, youtube_video_id: 'c' },
      ],
      null
    )
    assert.deepEqual(result.map((t) => t.id), ['t3', 't2', 't1'])
  })

  test('treats a null disc_number as disc 1', () => {
    const result = orderAlbumTracksForMv(
      [
        { id: 't1', disc_number: null, track_no: 2, youtube_video_id: 'a' },
        { id: 't2', disc_number: 1, track_no: 1, youtube_video_id: 'b' },
      ],
      null
    )
    assert.deepEqual(result.map((t) => t.id), ['t2', 't1'])
  })

  test('moves the representative track to the front when present', () => {
    const result = orderAlbumTracksForMv(
      [
        { id: 't1', disc_number: 1, track_no: 1, youtube_video_id: 'a' },
        { id: 't2', disc_number: 1, track_no: 2, youtube_video_id: 'b' },
        { id: 't3', disc_number: 1, track_no: 3, youtube_video_id: 'c' },
      ],
      't3'
    )
    assert.deepEqual(result.map((t) => t.id), ['t3', 't1', 't2'])
  })

  test('leaves order unchanged when the representative track has no video', () => {
    const result = orderAlbumTracksForMv(
      [
        { id: 't1', disc_number: 1, track_no: 1, youtube_video_id: 'a' },
        { id: 't2', disc_number: 1, track_no: 2, youtube_video_id: null },
      ],
      't2'
    )
    assert.deepEqual(result.map((t) => t.id), ['t1'])
  })

  test('returns an empty array when no tracks have a video', () => {
    const result = orderAlbumTracksForMv(
      [{ id: 't1', disc_number: 1, track_no: 1, youtube_video_id: null }],
      null
    )
    assert.deepEqual(result, [])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- 2>&1 | grep -A3 album-mv-order`
Expected: FAIL — `Cannot find module '../utils/albumMvOrder.ts'` (file doesn't exist yet)

- [ ] **Step 3: Write the implementation**

```ts
// utils/albumMvOrder.ts

export type AlbumMvOrderTrack = {
  id: string
  disc_number: number | null
  track_no: number | null
  youtube_video_id: string | null
}

/** アルバムのMVタブ用に、YouTube動画を持つ収録曲だけを抽出し、
 * ディスク番号→トラック番号の昇順に並べた上で、代表曲(representative_track_id)
 * があればそれを先頭に繰り上げる。ジェネリクスにしているのは、呼び出し側が
 * タイトル等の追加フィールドを持つ型を渡してもそのまま維持されるようにするため
 * (utils/albumMvOrder.ts単体では最小限のフィールドしか知らない)。 */
export function orderAlbumTracksForMv<T extends AlbumMvOrderTrack>(
  tracks: T[],
  representativeTrackId: string | null
): T[] {
  const withVideo = tracks.filter((t) => t.youtube_video_id)
  const sorted = [...withVideo].sort((a, b) => {
    const discA = a.disc_number ?? 1
    const discB = b.disc_number ?? 1
    if (discA !== discB) return discA - discB
    const noA = a.track_no ?? 0
    const noB = b.track_no ?? 0
    return noA - noB
  })
  if (!representativeTrackId) return sorted
  const repIndex = sorted.findIndex((t) => t.id === representativeTrackId)
  if (repIndex <= 0) return sorted
  const rep = sorted[repIndex]
  return [rep, ...sorted.slice(0, repIndex), ...sorted.slice(repIndex + 1)]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- 2>&1 | grep -A3 album-mv-order`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add utils/albumMvOrder.ts __tests__/album-mv-order.unit.test.ts
git commit -m "feat: add pure ordering function for album MV grid

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `AlbumIdentityPanel` (album page LEFT)

**Files:**
- Create: `app/components/album-detail/AlbumIdentityPanel.tsx`

**Interfaces:**
- Consumes: `ListenLinks` (`app/components/detail/ListenLinks.tsx`, unchanged) — `export type ListenLinkIds = { appleMusicId?: string | null; spotifyId?: string | null; youtubeMusicId?: string | null; amazonMusicId?: string | null }`, `export default function ListenLinks({ kind, ids, extraLinks }: { kind: 'album' | 'track'; ids: ListenLinkIds; extraLinks?: { label: string; href: string }[] })`.
- Produces: `export type AlbumIdentityData = { id: string; jacketUrl: string | null; title: string; artists: { id: string; name: string }[]; albumTypeLabel: string | null; releaseDateLabel: string; label: { id: string; name: string } | null; trackCount: number; format: string | null; statusLabel: { icon: string; label: string } | null; listenIds: ListenLinkIds; extraLinks: { label: string; href: string }[]; review: string | null }` and `export default function AlbumIdentityPanel({ data }: { data: AlbumIdentityData })`. Task 5 consumes this.

- [ ] **Step 1: Write the component**

```tsx
// app/components/album-detail/AlbumIdentityPanel.tsx
import Link from 'next/link'
import ListenLinks, { type ListenLinkIds } from '@/app/components/detail/ListenLinks'

export type AlbumIdentityData = {
  id: string
  jacketUrl: string | null
  title: string
  artists: { id: string; name: string }[]
  albumTypeLabel: string | null
  releaseDateLabel: string
  label: { id: string; name: string } | null
  trackCount: number
  format: string | null
  statusLabel: { icon: string; label: string } | null
  listenIds: ListenLinkIds
  extraLinks: { label: string; href: string }[]
  review: string | null
}

/** アルバム詳細ページのLEFTカラム。ジャケット・タイトル・アーティスト・
 * メタ情報・視聴リンク・紹介文をまとめる(トラックページのTrackIdentityPanelと
 * 構成は同じだが、扱うメタ情報の種類が異なるため別コンポーネントにしている)。
 * (docs/superpowers/specs/2026-09-11-album-track-3col-design.md参照) */
export default function AlbumIdentityPanel({ data }: { data: AlbumIdentityData }) {
  return (
    <div className="flex flex-col gap-4">
      <div id="album-header">
        <div className="overflow-hidden rounded-lg bg-white/5">
          {data.jacketUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.jacketUrl} alt={data.title} className="h-auto w-full" />
          ) : (
            <div className="aspect-square w-full" />
          )}
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold leading-tight">{data.title}</h1>
          {data.artists.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-white/60">
              {data.artists.map((a, i) => (
                <span key={a.id} className="flex items-center">
                  <Link href={`/artists/${a.id}`} className="hover:text-white">
                    {a.name}
                  </Link>
                  {i < data.artists.length - 1 && <span className="text-white/40">,</span>}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/45">
        {data.albumTypeLabel && <span>{data.albumTypeLabel}</span>}
        {data.albumTypeLabel && <span>·</span>}
        <span>{data.releaseDateLabel}</span>
        {data.label && (
          <>
            <span>·</span>
            <Link href={`/labels/${data.label.id}`} className="hover:text-white">
              {data.label.name}
            </Link>
          </>
        )}
        {data.trackCount > 0 && (
          <>
            <span>·</span>
            <span>{data.trackCount}曲</span>
          </>
        )}
        {data.format && (
          <>
            <span>·</span>
            <span>{data.format}</span>
          </>
        )}
        {data.statusLabel && (
          <>
            <span>·</span>
            <span>
              {data.statusLabel.icon} {data.statusLabel.label}
            </span>
          </>
        )}
      </div>

      <ListenLinks kind="album" ids={data.listenIds} extraLinks={data.extraLinks} />

      {data.review && data.review.trim() && (
        <div>
          <h2 className="text-xs uppercase tracking-wide text-white/40">紹介</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{data.review}</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add app/components/album-detail/AlbumIdentityPanel.tsx
git commit -m "feat: add AlbumIdentityPanel for album page LEFT column

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `AlbumCenterTabs` (album page CENTER)

**Files:**
- Create: `app/components/album-detail/AlbumCenterTabs.tsx`

**Interfaces:**
- Consumes: `orderAlbumTracksForMv` from `utils/albumMvOrder.ts` (Task 2). `PreviewButton` (`app/components/PreviewButton.tsx`, unchanged) — `export default function PreviewButton({ previewUrl, trackId, size }: { previewUrl: string | null; trackId: string; size: 'sm' | 'lg' })`. `formatDuration` from `@/utils/format` (unchanged).
- Produces: `export type AlbumCenterTrack = { id: string; disc_number: number | null; track_no: number | null; title: string; duration_seconds: number | null; preview_url: string | null; youtube_video_id: string | null }` and `export default function AlbumCenterTabs({ tracks, representativeTrackId, albumTitle }: { tracks: AlbumCenterTrack[]; representativeTrackId: string | null; albumTitle: string })`. Task 5 consumes this.

- [ ] **Step 1: Write the component**

```tsx
// app/components/album-detail/AlbumCenterTabs.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatDuration } from '@/utils/format'
import PreviewButton from '@/app/components/PreviewButton'
import { orderAlbumTracksForMv } from '@/utils/albumMvOrder'

export type AlbumCenterTrack = {
  id: string
  disc_number: number | null
  track_no: number | null
  title: string
  duration_seconds: number | null
  preview_url: string | null
  youtube_video_id: string | null
}

/** アルバム詳細ページのCENTER。「収録曲」「MV」のタブ切替。MVタブは
 * このアルバムの収録曲のうちYouTube動画を持つものだけをサムネイルグリッドで
 * 並べ、クリックしたサムネイルをその場で埋め込み再生に差し替える(別タブ・
 * モーダルは使わない)。1件もMVが無いアルバムはタブ自体を出さず、収録曲
 * リストのみを表示する。(docs/superpowers/specs/2026-09-11-album-track-3col-design.md参照) */
export default function AlbumCenterTabs({
  tracks,
  representativeTrackId,
  albumTitle,
}: {
  tracks: AlbumCenterTrack[]
  representativeTrackId: string | null
  albumTitle: string
}) {
  const mvTracks = orderAlbumTracksForMv(tracks, representativeTrackId)
  const [tab, setTab] = useState<'tracklist' | 'mv'>('tracklist')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const showTabs = mvTracks.length > 0
  const activeTab = showTabs ? tab : 'tracklist'

  const discNumbers = Array.from(new Set(tracks.map((t) => t.disc_number ?? 1))).sort((a, b) => a - b)
  const isMultiDisc = discNumbers.length > 1

  return (
    <div>
      {showTabs && (
        <div className="flex gap-1 border-b border-white/10">
          <button
            type="button"
            onClick={() => setTab('tracklist')}
            className={`px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] ${
              activeTab === 'tracklist' ? 'border-b-2 border-white text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            収録曲
          </button>
          <button
            type="button"
            onClick={() => setTab('mv')}
            className={`px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] ${
              activeTab === 'mv' ? 'border-b-2 border-white text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            MV
          </button>
        </div>
      )}

      {activeTab === 'tracklist' ? (
        <div className="mt-4">
          {tracks.length === 0 ? (
            <p className="text-sm text-white/40">まだトラックが登録されていません。</p>
          ) : (
            discNumbers.map((discNumber) => {
              const discTracks = tracks.filter((t) => (t.disc_number ?? 1) === discNumber)
              return (
                <div key={discNumber} className="mt-4 first:mt-0">
                  {isMultiDisc && <h3 className="text-sm font-medium text-white/50">Disc {discNumber}</h3>}
                  <ol className="divide-y divide-white/10">
                    {discTracks.map((track) => (
                      <li key={track.id} className="flex items-center gap-3 py-3 text-sm">
                        <Link
                          href={`/tracks/${track.id}`}
                          className="flex flex-1 items-center gap-4 transition hover:opacity-70"
                        >
                          <span className="w-5 shrink-0 text-right text-white/30">{track.track_no ?? '-'}</span>
                          <span className="flex-1">{track.title}</span>
                          <span className="text-white/30">{formatDuration(track.duration_seconds)}</span>
                        </Link>
                        <PreviewButton previewUrl={track.preview_url} trackId={track.id} size="sm" />
                      </li>
                    ))}
                  </ol>
                </div>
              )
            })
          )}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {mvTracks.map((track) => (
            <div key={track.id}>
              {playingId === track.id ? (
                <div className="aspect-video overflow-hidden rounded-md bg-black">
                  <iframe
                    src={`https://www.youtube.com/embed/${track.youtube_video_id}?autoplay=1`}
                    title={`${albumTitle} - ${track.title}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    loading="lazy"
                    className="h-full w-full"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPlayingId(track.id)}
                  className="group block aspect-video w-full overflow-hidden rounded-md bg-white/5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://i.ytimg.com/vi/${track.youtube_video_id}/hqdefault.jpg`}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </button>
              )}
              <p className="mt-1.5 truncate text-xs text-white/60">{track.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add app/components/album-detail/AlbumCenterTabs.tsx
git commit -m "feat: add AlbumCenterTabs (tracklist/MV toggle) for album page CENTER

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Rewire `app/albums/[id]/page.tsx`

**Files:**
- Modify: `app/albums/[id]/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `DetailPageShell` (Task 1), `AlbumIdentityPanel`/`AlbumIdentityData` (Task 3), `AlbumCenterTabs`/`AlbumCenterTrack` (Task 4), plus existing `CurationTags` (`app/components/CurationTags.tsx`) and `RotationModal` (`app/components/track/RotationModal.tsx`), both unchanged.
- Produces: nothing consumed by later tasks (leaf page).

**Note on RIGHT column layout:** the previous "他の作品"/"その他のバージョン" shelves were a horizontal-scrolling row of `w-28` square thumbnails, sized for a full-width page. The new RIGHT column is a fixed ~26%-width sidebar, so this task switches those two shelves to a vertical list of small (`h-12 w-12`) thumbnails instead — same data and links, adapted presentation for the narrower column. Flag this to the task reviewer as an intentional adaptation, not a deviation to fix.

- [ ] **Step 1: Rewrite the page**

```tsx
// app/albums/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate, STREAMING_STATUS_LABEL } from '@/utils/format'
import { ALBUM_TYPE_LABEL_JA, type AlbumType } from '@/utils/albumType'
import DetailPageShell from '@/app/components/detail/DetailPageShell'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
import BackLink from '@/app/components/navigation/BackLink'
import AlbumIdentityPanel, { type AlbumIdentityData } from '@/app/components/album-detail/AlbumIdentityPanel'
import AlbumCenterTabs from '@/app/components/album-detail/AlbumCenterTabs'
import CurationTags from '@/app/components/CurationTags'
import RotationModal from '@/app/components/track/RotationModal'

export default async function AlbumDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: album, error } = await supabase
    .from('album')
    .select('*, artist:artist_id(id, name), label:label_id(id, name)')
    .eq('id', id)
    .single()

  if (error || !album) {
    notFound()
  }

  const [
    { data: tracks },
    { data: discGuideSelections },
    { data: coArtistRows },
    { data: curationSelections },
    { data: radioRotationRows },
  ] = await Promise.all([
    supabase
      .from('track')
      .select('id, disc_number, track_no, title, duration_seconds, preview_url, youtube_video_id')
      .eq('album_id', id)
      .order('disc_number', { ascending: true, nullsFirst: true })
      .order('track_no', { ascending: true }),
    supabase
      .from('disc_guide_selection')
      .select('id, note, disc_guide:disc_guide_id(id, title, publisher, published_year, cover_image_url)')
      .eq('album_id', id),
    supabase
      .from('album_artist')
      .select('artist_id, role, billing_order, artist:artist_id(id, name)')
      .eq('album_id', id)
      .order('billing_order', { ascending: true, nullsFirst: false }),
    // タワレコメン等の「順位のない選出企画」だけでなく、ranked型の企画も含めて
    // 選出バッジを出す(トラック/アーティスト詳細ページと方針を統一)
    supabase
      .from('ranking_entry')
      .select('ranking:ranking_id!inner(id, name, list_type, source)')
      .eq('album_id', id),
    // パワープレイ選出(RIGHT表示用)。トラックページのrotations取得と同じ形。
    supabase
      .from('radio_rotation')
      .select(
        'id, period_start_date, music_type, media_program:media_program_id(program_name, media:media_id(name))'
      )
      .eq('album_id', id)
      .order('period_start_date', { ascending: false }),
  ])

  const groupAnchorId = album.primary_album_id ?? album.id
  const { data: otherVersions } = await supabase
    .from('album')
    .select('id, title, jacket_url, release_date')
    .or(`id.eq.${groupAnchorId},primary_album_id.eq.${groupAnchorId}`)
    .neq('id', id)
    .order('release_date', { ascending: true, nullsFirst: false })

  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
  const label = Array.isArray(album.label) ? album.label[0] : album.label

  const { data: otherWorks } = artist
    ? await supabase
        .from('album')
        .select('id, title, jacket_url, release_date')
        .eq('artist_id', artist.id)
        .neq('id', groupAnchorId)
        .is('primary_album_id', null)
        .order('release_date', { ascending: false, nullsFirst: false })
        .limit(20)
    : { data: null }

  type ArtistRef = { id: string; name: string }
  const additionalArtists: ArtistRef[] = (coArtistRows ?? [])
    .map((row) => (Array.isArray(row.artist) ? row.artist[0] : row.artist))
    .filter((a): a is ArtistRef => a != null)
  const seenArtistIds = new Set<string>()
  const allArtists: ArtistRef[] = (artist ? [artist, ...additionalArtists] : additionalArtists).filter((a) => {
    if (seenArtistIds.has(a.id)) return false
    seenArtistIds.add(a.id)
    return true
  })
  const status = album.streaming_status ? STREAMING_STATUS_LABEL[album.streaming_status] : null

  type RankingRef = { id: string; name: string; source: string | null }
  const seenRankingIds = new Set<string>()
  const curationRankings: RankingRef[] = (curationSelections ?? [])
    .map((row) => (Array.isArray(row.ranking) ? row.ranking[0] : row.ranking))
    .filter((r): r is RankingRef & { list_type: string } => r != null)
    .filter((r) => {
      if (seenRankingIds.has(r.id)) return false
      seenRankingIds.add(r.id)
      return true
    })

  const identity: AlbumIdentityData = {
    id: album.id,
    jacketUrl: album.jacket_url,
    title: album.title,
    artists: allArtists,
    albumTypeLabel: album.album_type ? (ALBUM_TYPE_LABEL_JA[album.album_type as AlbumType] ?? album.album_type) : null,
    releaseDateLabel: formatDate(album.release_date),
    label,
    trackCount: album.track_count ?? 0,
    format: album.format,
    statusLabel: status,
    listenIds: {
      appleMusicId: album.apple_music_album_id,
      spotifyId: album.spotify_album_id,
      youtubeMusicId: album.youtube_music_album_id,
      amazonMusicId: album.amazon_music_album_id,
    },
    extraLinks: [
      ...(album.tower_url ? [{ label: 'TOWER RECORDS', href: album.tower_url }] : []),
      ...(album.discogs_url ? [{ label: 'Discogs', href: album.discogs_url }] : []),
      ...(album.jan_code
        ? [
            { label: 'Amazonで探す', href: `https://www.amazon.co.jp/s?k=${album.jan_code}` },
            { label: 'Discogsで探す', href: `https://www.discogs.com/search/?q=${album.jan_code}&type=release` },
          ]
        : []),
    ],
    review: album.album_review,
  }

  const rightColumn = (
    <div className="flex flex-col gap-8">
      {discGuideSelections && discGuideSelections.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">掲載ディスクガイド</h2>
          <ul className="mt-3 space-y-3 text-sm text-white/60">
            {discGuideSelections.map((row) => {
              const guide = Array.isArray(row.disc_guide) ? row.disc_guide[0] : row.disc_guide
              if (!guide) return null
              const meta = [guide.publisher, guide.published_year ? `${guide.published_year}年` : null]
                .filter(Boolean)
                .join(' / ')
              return (
                <li key={row.id} className="flex items-center gap-3">
                  {guide.cover_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={guide.cover_image_url}
                      alt={guide.title}
                      className="h-16 w-12 shrink-0 rounded object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <span className="text-white/80">{guide.title}</span>に掲載
                    {meta && <span className="text-white/40"> ({meta})</span>}
                    {row.note && <span className="text-white/40"> ・ {row.note}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {curationRankings.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            キュレーション・ランキング選出
          </h2>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <CurationTags rankings={curationRankings} />
          </div>
        </section>
      )}

      {radioRotationRows && radioRotationRows.length > 0 && <RotationModal rotations={radioRotationRows} />}

      {otherWorks && otherWorks.length > 0 && artist && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            {artist.name}の他の作品
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            {otherWorks.map((work) => (
              <Link key={work.id} href={`/albums/${work.id}`} className="group flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-white/5">
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
                <div className="min-w-0">
                  <p className="truncate text-xs group-hover:opacity-70">{work.title}</p>
                  <p className="truncate text-[10px] text-white/30">{formatDate(work.release_date)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {otherVersions && otherVersions.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">その他のバージョン</h2>
          <div className="mt-3 flex flex-col gap-3">
            {otherVersions.map((v) => (
              <Link key={v.id} href={`/albums/${v.id}`} className="group flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-white/5">
                  {v.jacket_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.jacket_url}
                      alt={v.title}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                      No Art
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs group-hover:opacity-70">{v.title}</p>
                  <p className="truncate text-[10px] text-white/30">{formatDate(v.release_date)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )

  return (
    <>
      <div className="px-6 pt-3 lg:px-8">
        <BackLink
          fallbackHref={artist ? `/artists/${artist.id}` : '/albums'}
          fallbackLabel={artist ? artist.name : 'アルバム一覧に戻る'}
        />
      </div>
      <StickyMiniHeader
        watchElementId="album-header"
        imageUrl={album.jacket_url}
        title={album.title}
        subtitle={artist?.name ?? null}
      />
      <DetailPageShell
        left={<AlbumIdentityPanel data={identity} />}
        center={
          <AlbumCenterTabs
            tracks={tracks ?? []}
            representativeTrackId={album.representative_track_id}
            albumTitle={album.title}
          />
        }
        right={rightColumn}
      />
    </>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 3: Manual verification with a real album**

Run: `npm run dev` (in one terminal), then in another:

```bash
cd /tmp && npm install puppeteer-core --no-save
```

```js
// /tmp/verify-album-page.mjs
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
// アルバムIDは手元のSupabaseで曲数・パワープレイ・ディスクガイドが揃っている
// レコードに差し替える(例: MVを複数持つ実在アルバム)
await page.goto('http://localhost:3000/albums/<ALBUM_ID>', { waitUntil: 'networkidle0' })

const layout = await page.evaluate(() => {
  const left = document.querySelector('.lg\\:w-\\[32\\%\\]')
  const center = document.querySelector('.lg\\:flex-1')
  const right = document.querySelector('.lg\\:w-\\[26\\%\\]')
  return {
    leftScroll: left ? { scrollHeight: left.scrollHeight, clientHeight: left.clientHeight } : null,
    centerScroll: center ? { scrollHeight: center.scrollHeight, clientHeight: center.clientHeight } : null,
    rightScroll: right ? { scrollHeight: right.scrollHeight, clientHeight: right.clientHeight } : null,
    hasFooterInCenter: !!center?.querySelector('footer'),
  }
})
console.log(JSON.stringify(layout, null, 2))

// MV/収録曲タブの切替確認
const hasMvTab = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')]
  const mvTab = buttons.find((b) => b.textContent?.trim() === 'MV')
  if (!mvTab) return 'no-mv-tab'
  mvTab.click()
  return true
})
console.log('mv tab click:', hasMvTab)

await browser.close()
```

Run: `NODE_PATH=/tmp/node_modules node /tmp/verify-album-page.mjs`
Expected: `leftScroll`/`rightScroll` show `scrollHeight` can exceed `clientHeight` without breaking layout (independent scroll containers, not a page-level scrollbar); `centerScroll.scrollHeight` grows with content; `hasFooterInCenter: true`; if the chosen test album has any track with a `youtube_video_id`, `mv tab click` returns `true` (not `'no-mv-tab'`).

Also load an album with **no** `youtube_video_id` on any track and confirm the MV tab button is absent (only the tracklist renders, no tab bar).

- [ ] **Step 4: Commit**

```bash
git add app/albums/[id]/page.tsx
git commit -m "feat: rebuild album detail page into 3-column shell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `TrackIdentityPanel` (track page LEFT)

**Files:**
- Create: `app/components/track-detail/TrackIdentityPanel.tsx`

**Interfaces:**
- Consumes: `ListenLinks`/`ListenLinkIds` (same as Task 3). `PreviewButton` (`app/components/PreviewButton.tsx`) — `export default function PreviewButton({ previewUrl, trackId, size }: { previewUrl: string | null; trackId: string; size: 'sm' | 'lg' })`.
- Produces: `export type TrackIdentityData = { id: string; jacketUrl: string | null; title: string; artists: { id: string; name: string }[]; album: { id: string; title: string } | null; durationLabel: string; previewUrl: string | null; listenIds: ListenLinkIds; extraLinks: { label: string; href: string }[]; review: string | null }` and `export default function TrackIdentityPanel({ data }: { data: TrackIdentityData })`. Task 8 consumes this.

- [ ] **Step 1: Write the component**

```tsx
// app/components/track-detail/TrackIdentityPanel.tsx
import Link from 'next/link'
import ListenLinks, { type ListenLinkIds } from '@/app/components/detail/ListenLinks'
import PreviewButton from '@/app/components/PreviewButton'

export type TrackIdentityData = {
  id: string
  jacketUrl: string | null
  title: string
  artists: { id: string; name: string }[]
  album: { id: string; title: string } | null
  durationLabel: string
  previewUrl: string | null
  listenIds: ListenLinkIds
  extraLinks: { label: string; href: string }[]
  review: string | null
}

/** トラック詳細ページのLEFTカラム。ジャケットはアルバム経由(トラック自体は
 * ジャケットを持たない、既存動作を踏襲)。試聴の大ボタン(PreviewButton size="lg")は
 * 従来DetailHeaderのactionsでListenLinksと並んでいたのをそのままこちらに移設する。
 * (docs/superpowers/specs/2026-09-11-album-track-3col-design.md参照) */
export default function TrackIdentityPanel({ data }: { data: TrackIdentityData }) {
  return (
    <div className="flex flex-col gap-4">
      <div id="track-header">
        <div className="overflow-hidden rounded-lg bg-white/5">
          {data.jacketUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.jacketUrl} alt={data.title} className="h-auto w-full" />
          ) : (
            <div className="aspect-square w-full" />
          )}
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold leading-tight">{data.title}</h1>
          {data.artists.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-white/60">
              {data.artists.map((a, i) => (
                <span key={a.id} className="flex items-center">
                  <Link href={`/artists/${a.id}`} className="hover:text-white">
                    {a.name}
                  </Link>
                  {i < data.artists.length - 1 && <span className="text-white/40">,</span>}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 text-xs text-white/45">
        {data.album && (
          <>
            <Link href={`/albums/${data.album.id}`} className="hover:text-white">
              {data.album.title}
            </Link>
            <span>·</span>
          </>
        )}
        <span>{data.durationLabel}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PreviewButton previewUrl={data.previewUrl} trackId={data.id} size="lg" />
        <ListenLinks kind="track" ids={data.listenIds} extraLinks={data.extraLinks} />
      </div>

      {data.review && data.review.trim() && (
        <div>
          <h2 className="text-xs uppercase tracking-wide text-white/40">紹介</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{data.review}</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add app/components/track-detail/TrackIdentityPanel.tsx
git commit -m "feat: add TrackIdentityPanel for track page LEFT column

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `TrackCenterContent` (track page CENTER)

**Files:**
- Create: `app/components/track-detail/TrackCenterContent.tsx`

**Interfaces:**
- Consumes: `formatDuration`, `CREDIT_ROLE_LABEL` from `@/utils/format` (unchanged).
- Produces: `export type SiblingTrack = { id: string; track_no: number | null; title: string; duration_seconds: number | null }`, `export type InstrumentGroup = { instrumentId: string; instrumentName: string; people: { id: string; name: string }[] }`, `export type CreditGroup = { role: string; people: { id: string; name: string }[] }`, and `export default function TrackCenterContent({ youtubeVideoId, title, album, siblingTracks, instrumentGroups, creditGroups }: { youtubeVideoId: string | null; title: string; album: { id: string; title: string } | null; siblingTracks: SiblingTrack[]; instrumentGroups: InstrumentGroup[]; creditGroups: CreditGroup[] })`. Task 8 consumes this. No tab state — this is a plain server component (no `'use client'`).

- [ ] **Step 1: Write the component**

```tsx
// app/components/track-detail/TrackCenterContent.tsx
import Link from 'next/link'
import { formatDuration, CREDIT_ROLE_LABEL } from '@/utils/format'

export type SiblingTrack = { id: string; track_no: number | null; title: string; duration_seconds: number | null }
export type InstrumentGroup = { instrumentId: string; instrumentName: string; people: { id: string; name: string }[] }
export type CreditGroup = { role: string; people: { id: string; name: string }[] }

/** トラック詳細ページのCENTER。MV(あれば先頭)→他の曲→使用楽器→クレジット、
 * の縦積み。アルバムページのCENTERと違いタブは持たない(トラックは単一の
 * MVしか扱わないため切り替えの必要が無い)。
 * (docs/superpowers/specs/2026-09-11-album-track-3col-design.md参照) */
export default function TrackCenterContent({
  youtubeVideoId,
  title,
  album,
  siblingTracks,
  instrumentGroups,
  creditGroups,
}: {
  youtubeVideoId: string | null
  title: string
  album: { id: string; title: string } | null
  siblingTracks: SiblingTrack[]
  instrumentGroups: InstrumentGroup[]
  creditGroups: CreditGroup[]
}) {
  return (
    <div className="flex flex-col gap-10">
      {youtubeVideoId && (
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">ミュージックビデオ</h2>
          <div className="mt-2 aspect-video overflow-hidden rounded-md bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${youtubeVideoId}`}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              className="h-full w-full"
            />
          </div>
        </div>
      )}

      {siblingTracks.length > 0 && album && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">{album.title}の他の曲</h2>
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

      {instrumentGroups.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">使用楽器</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {instrumentGroups.map((group) => (
              <li key={group.instrumentId} className="flex flex-wrap items-baseline gap-x-2 text-white/70">
                <Link href={`/tracks/instrument/${group.instrumentId}`} className="text-white/40 hover:text-white">
                  {group.instrumentName}
                </Link>
                {group.people.length > 0 && (
                  <span>
                    {group.people.map((person, i) => (
                      <span key={person.id}>
                        {i > 0 && '、'}
                        <Link href={`/people/${person.id}`} className="hover:text-white">
                          {person.name}
                        </Link>
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {creditGroups.length > 0 && (
        <details className="border-t border-white/10 pt-6">
          <summary className="cursor-pointer text-white/35 hover:text-white/60">
            <h2 className="inline text-[11px] font-medium uppercase tracking-[0.14em]">
              クレジット({creditGroups.reduce((total, g) => total + g.people.length, 0)}件)
            </h2>
          </summary>
          <ul className="mt-3 space-y-1.5 text-sm">
            {creditGroups.map((group) => (
              <li key={group.role} className="flex flex-wrap items-baseline gap-x-2 text-white/70">
                <span className="text-white/40">{CREDIT_ROLE_LABEL[group.role] ?? group.role}</span>
                <span>
                  {group.people.map((person, i) => (
                    <span key={person.id}>
                      {i > 0 && '、'}
                      <Link href={`/people/${person.id}`} className="hover:text-white">
                        {person.name}
                      </Link>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add app/components/track-detail/TrackCenterContent.tsx
git commit -m "feat: add TrackCenterContent for track page CENTER column

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Rewire `app/tracks/[id]/page.tsx`

**Files:**
- Modify: `app/tracks/[id]/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `DetailPageShell` (Task 1), `TrackIdentityPanel`/`TrackIdentityData` (Task 6), `TrackCenterContent` and its exported types (Task 7), plus existing `CurationTags` and `RotationModal`, unchanged.
- Produces: nothing consumed by later tasks (leaf page).

- [ ] **Step 1: Rewrite the page**

```tsx
// app/tracks/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDuration } from '@/utils/format'
import DetailPageShell from '@/app/components/detail/DetailPageShell'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
import BackLink from '@/app/components/navigation/BackLink'
import PreviewButton from '@/app/components/PreviewButton'
import RotationModal from '@/app/components/track/RotationModal'
import CurationTags from '@/app/components/CurationTags'
import TrackIdentityPanel, { type TrackIdentityData } from '@/app/components/track-detail/TrackIdentityPanel'
import TrackCenterContent from '@/app/components/track-detail/TrackCenterContent'

const WORK_TYPE_LABEL: Record<string, string> = {
  cm: 'CM',
  anime: 'アニメ',
  game: 'ゲーム',
  movie: '映画',
  tv_program: 'テレビ番組',
}

export default async function TrackDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { id } = await params
  const { success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: track, error } = await supabase
    .from('track')
    .select('*, album:album_id(id, title, jacket_url), artist:artist_id(id, name)')
    .eq('id', id)
    .single()

  if (error || !track) {
    notFound()
  }

  const [{ data: credits }, { data: trackInstruments }, { data: syncEntries }, { data: rotations }, { data: coArtistRows }, { data: curationSelections }] =
    await Promise.all([
      track.album_id
        ? supabase
            .from('artist_credit')
            .select('role, credit_person:credit_person_id(id, name), instrument:instrument_id(id, name)')
            .eq('album_id', track.album_id)
            .or(`track_id.eq.${id},track_id.is.null`)
        : Promise.resolve({ data: [] as { role: string; credit_person: { id: string; name: string } | { id: string; name: string }[] | null; instrument: { id: string; name: string } | { id: string; name: string }[] | null }[], error: null }),
      supabase.from('track_instrument').select('instrument:instrument_id(id, name)').eq('track_id', id),
      supabase
        .from('sync_entry')
        .select('id, usage_detail, sync_work:sync_work_id(id, title, work_type, year)')
        .eq('track_id', id),
      supabase
        .from('radio_rotation')
        .select(
          'id, period_start_date, music_type, media_program:media_program_id(program_name, media:media_id(name))'
        )
        .eq('track_id', id)
        .order('period_start_date', { ascending: false }),
      supabase
        .from('track_artist')
        .select('artist_id, role, billing_order, artist:artist_id(id, name)')
        .eq('track_id', id)
        .order('billing_order', { ascending: true, nullsFirst: false }),
      supabase
        .from('ranking_entry')
        .select('ranking:ranking_id!inner(id, name, list_type, source)')
        .eq('track_id', id),
    ])

  const { data: siblingTracks } = track.album_id
    ? await supabase
        .from('track')
        .select('id, track_no, title, duration_seconds')
        .eq('album_id', track.album_id)
        .neq('id', id)
        .order('track_no', { ascending: true })
        .limit(50)
    : { data: null }

  const album = Array.isArray(track.album) ? track.album[0] : track.album
  const artist = Array.isArray(track.artist) ? track.artist[0] : track.artist

  type ArtistRef = { id: string; name: string }
  const additionalArtists: ArtistRef[] = (coArtistRows ?? [])
    .map((row) => (Array.isArray(row.artist) ? row.artist[0] : row.artist))
    .filter((a): a is ArtistRef => a != null)
  const seenArtistIds = new Set<string>()
  const allArtists: ArtistRef[] = (artist ? [artist, ...additionalArtists] : additionalArtists).filter((a) => {
    if (seenArtistIds.has(a.id)) return false
    seenArtistIds.add(a.id)
    return true
  })

  type RankingRef = { id: string; name: string; source: string | null }
  const seenRankingIds = new Set<string>()
  const curationRankings: RankingRef[] = (curationSelections ?? [])
    .map((row) => (Array.isArray(row.ranking) ? row.ranking[0] : row.ranking))
    .filter((r): r is RankingRef & { list_type: string } => r != null)
    .filter((r) => {
      if (seenRankingIds.has(r.id)) return false
      seenRankingIds.add(r.id)
      return true
    })

  const ROLE_ORDER = ['producer', 'mix', 'mastering', 'composer', 'lyricist', 'arranger', 'artwork'] as const
  const creditsByRole = new Map<string, { id: string; name: string }[]>()
  for (const c of credits ?? []) {
    if (c.role === 'musician') continue
    const person = Array.isArray(c.credit_person) ? c.credit_person[0] : c.credit_person
    if (!person) continue
    const list = creditsByRole.get(c.role) ?? []
    if (!list.some((p) => p.id === person.id)) list.push({ id: person.id, name: person.name })
    creditsByRole.set(c.role, list)
  }
  const creditGroups = ROLE_ORDER.map((role) => ({ role, people: creditsByRole.get(role) ?? [] })).filter(
    (g) => g.people.length > 0
  )

  const performersByInstrumentId = new Map<string, { id: string; name: string }[]>()
  for (const c of credits ?? []) {
    if (c.role !== 'musician') continue
    const person = Array.isArray(c.credit_person) ? c.credit_person[0] : c.credit_person
    const instrument = Array.isArray(c.instrument) ? c.instrument[0] : c.instrument
    if (!person || !instrument) continue
    const list = performersByInstrumentId.get(instrument.id) ?? []
    if (!list.some((p) => p.id === person.id)) list.push({ id: person.id, name: person.name })
    performersByInstrumentId.set(instrument.id, list)
  }
  const instrumentGroups = (trackInstruments ?? [])
    .map((ti) => (Array.isArray(ti.instrument) ? ti.instrument[0] : ti.instrument))
    .filter((instrument): instrument is { id: string; name: string } => Boolean(instrument))
    .map((instrument) => ({
      instrumentId: instrument.id,
      instrumentName: instrument.name,
      people: performersByInstrumentId.get(instrument.id) ?? [],
    }))

  const identity: TrackIdentityData = {
    id: track.id,
    jacketUrl: album?.jacket_url ?? null,
    title: track.title,
    artists: allArtists,
    album: album ? { id: album.id, title: album.title } : null,
    durationLabel: formatDuration(track.duration_seconds),
    previewUrl: track.preview_url,
    listenIds: {
      appleMusicId: track.apple_music_track_id,
      spotifyId: track.spotify_track_id,
      youtubeMusicId: track.youtube_music_track_id,
      amazonMusicId: track.amazon_music_track_id,
    },
    extraLinks: track.lyric_url ? [{ label: '歌詞を見る', href: track.lyric_url }] : [],
    review: track.track_review,
  }

  const rightColumn = (
    <div className="flex flex-col gap-8">
      {rotations && rotations.length > 0 && <RotationModal rotations={rotations} />}

      {syncEntries && syncEntries.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">タイアップ実績</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-white/70">
            {syncEntries.map((row) => {
              const work = Array.isArray(row.sync_work) ? row.sync_work[0] : row.sync_work
              if (!work) return null
              return (
                <li key={row.id}>
                  {work.title}
                  {work.work_type && (
                    <span className="text-white/40"> ({WORK_TYPE_LABEL[work.work_type] ?? work.work_type})</span>
                  )}
                  {row.usage_detail && <span className="text-white/40"> ・ {row.usage_detail}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {curationRankings.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            キュレーション・ランキング選出
          </h2>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <CurationTags rankings={curationRankings} />
          </div>
        </section>
      )}
    </div>
  )

  return (
    <>
      <div className="px-6 pt-3 lg:px-8">
        {success && (
          <div className="mb-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
        )}
        {errorMessage && (
          <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
        )}
        <div className="flex items-center justify-between">
          <BackLink
            fallbackHref={album ? `/albums/${album.id}` : '/tracks'}
            fallbackLabel={album ? album.title : 'トラック一覧に戻る'}
          />
          <Link href={`/admin/data/tracks/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
            編集
          </Link>
        </div>
      </div>
      <StickyMiniHeader
        watchElementId="track-header"
        imageUrl={album?.jacket_url ?? null}
        title={track.title}
        subtitle={allArtists[0]?.name ?? null}
        action={<PreviewButton previewUrl={track.preview_url} trackId={track.id} size="sm" />}
      />
      <DetailPageShell
        left={<TrackIdentityPanel data={identity} />}
        center={
          <TrackCenterContent
            youtubeVideoId={track.youtube_video_id}
            title={track.title}
            album={album ? { id: album.id, title: album.title } : null}
            siblingTracks={siblingTracks ?? []}
            instrumentGroups={instrumentGroups}
            creditGroups={creditGroups}
          />
        }
        right={rightColumn}
      />
    </>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 3: Manual verification with a real track**

Reuse the Puppeteer-core setup from Task 5 Step 3 (already installed at `/tmp/node_modules`).

```js
// /tmp/verify-track-page.mjs
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
// トラックIDはMVあり・ローテーション実績あり・クレジットありの実在トラックに差し替える
await page.goto('http://localhost:3000/tracks/<TRACK_ID>', { waitUntil: 'networkidle0' })

const layout = await page.evaluate(() => {
  const left = document.querySelector('.lg\\:w-\\[32\\%\\]')
  const center = document.querySelector('.lg\\:flex-1')
  const right = document.querySelector('.lg\\:w-\\[26\\%\\]')
  return {
    leftScroll: left ? { scrollHeight: left.scrollHeight, clientHeight: left.clientHeight } : null,
    centerHasIframe: !!center?.querySelector('iframe'),
    rightHasContent: !!right && right.textContent.trim().length > 0,
    hasFooterInCenter: !!center?.querySelector('footer'),
  }
})
console.log(JSON.stringify(layout, null, 2))

await browser.close()
```

Run: `NODE_PATH=/tmp/node_modules node /tmp/verify-track-page.mjs`
Expected: `centerHasIframe: true` for a track with a `youtube_video_id`; `rightHasContent: true` if the track has rotations/sync/curation data; `hasFooterInCenter: true`.

Also load a track with **no** `youtube_video_id` and confirm the MV block is absent (CENTER starts directly with "他の曲" or whichever section applies).

- [ ] **Step 4: Commit**

```bash
git add app/tracks/[id]/page.tsx
git commit -m "feat: rebuild track detail page into 3-column shell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Delete now-unused `VisualSlot` and `DetailHeader`

**Files:**
- Delete: `app/components/detail/VisualSlot.tsx`
- Delete: `app/components/detail/DetailHeader.tsx`

**Interfaces:**
- Consumes: nothing (this task only removes dead code once Tasks 5 and 8 have already stopped importing these two files).
- Produces: nothing.

- [ ] **Step 1: Confirm nothing still imports them**

Run:
```bash
grep -rl "detail/VisualSlot" /Users/th/dev/music-synapse/app
grep -rl "detail/DetailHeader" /Users/th/dev/music-synapse/app
```
Expected: both commands print nothing (no output = no remaining importers). If either prints a file, stop — Task 5 or Task 8 is incomplete or was reverted; do not proceed with deletion.

- [ ] **Step 2: Delete the files**

```bash
git rm app/components/detail/VisualSlot.tsx app/components/detail/DetailHeader.tsx
```

- [ ] **Step 3: Verify the build still succeeds**

Run: `npm run build`
Expected: build succeeds (confirms no other file anywhere in the repo, including outside `app/`, still imports either deleted file)

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test file referenced either deleted component)

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove VisualSlot and DetailHeader, superseded by the 3-column shell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Every section of the spec (`DetailPageShell`, album LEFT/CENTER/RIGHT, track LEFT/CENTER/RIGHT, `VisualSlot`/`DetailHeader` removal) maps to a task above (Tasks 1, 3-5, 6-8, 9 respectively). Task 2 is a spec-implied prerequisite (the MV grid's ordering logic) called out in the spec's CENTER section for the album page.
- **Placeholder scan:** No TBD/TODO markers; every step has literal, runnable code or an exact command.
- **Type consistency:** `AlbumIdentityData`/`TrackIdentityData`/`AlbumCenterTrack`/`SiblingTrack`/`InstrumentGroup`/`CreditGroup` are each defined once (Tasks 3/6/4/7) and consumed with matching field names in Tasks 5/8. `ListenLinkIds` is imported from the existing `ListenLinks.tsx`, not redefined.
