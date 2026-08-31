# Junkie Dig (レコード屋ディグり体験) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen, swipe-driven "record store digging" discovery modal (branded "Junkie Dig"), reachable from a floating button on every page, that lets a user flip through randomly-shuffled albums within genre "shelves" (plus a genre-less "new arrivals" shelf), auto-playing each record's first track and reacting to swipe gestures for next-record / album-detail / shelf-change.

**Architecture:** Two new Postgres RPC functions do the heavy aggregation (which genres have enough eligible albums; which albums belong to a shelf) so the app code stays a thin data-fetch + shuffle layer. Two new public API routes (`/api/record-digging/shelves`, `/api/record-digging/records`) expose that data to a client-only component tree. A single `useSwipeGesture` hook normalizes touch/mouse/keyboard input into one `onSwipe(direction)` callback; a `useDiggingSound` hook synthesizes UI sound effects with the Web Audio API (no audio file assets). Everything mounts once, globally, from `app/layout.tsx`.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres RPC + `@supabase/supabase-js`), Tailwind CSS, Web Audio API. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-record-digging-design.md`

## Global Constraints

- `MIN_SHELF_ALBUMS = 8` — a genre only becomes a shelf if it has ≥8 eligible (jacket-having) albums.
- `NEW_ARRIVALS_DAYS = 30` — the "new arrivals" shelf covers albums released in the last 30 days (JST).
- Shelf eligibility requires `album.jacket_url IS NOT NULL` only — `preview_url` is **not** required (records without a preview still appear in the crate; playback is just skipped for them).
- Shuffle-without-immediate-repeat: when a shelf's deck is exhausted, reshuffle and swap the new first item if it equals the deck's last-shown record.
- No new npm dependencies. No audio file assets — all SE is synthesized via Web Audio API, created lazily on first use (browser autoplay policy).
- Swipe threshold: 80px (touch/mouse), fires once per gesture. Keyboard arrows fire immediately (no threshold).
- Floating launcher label: **"Junkie Dig"**.
- This app has no test runner installed (no jest/vitest in `package.json`). Every task's "test" step is: `npx tsc --noEmit -p .` (must be clean) plus a concrete manual verification (a one-off `tsx` script against the real Supabase project for data-layer code, or `npm run dev` + `curl`/browser interaction for routes and UI). Do not introduce a test framework as part of this plan.
- Supabase project id: `ftvhglfthbcxhgnoninv`. Apply the migration in Task 1 with the `mcp__claude_ai_Supabase__apply_migration` tool, not a local `supabase/migrations/*.sql` file left unapplied — but **also** write the same SQL to `supabase/migrations/20260831_add_record_digging_shelves.sql` so it's tracked in the repo like every other migration here.
- Follow existing conventions: Supabase server client for public reads is `createClient` from `@/utils/Supabase/server` (see `app/api/map/geo-boundary/route.ts` for the exact pattern) — never `createAdminClient` for these public, read-only routes.

---

### Task 1: Database RPCs and the `recordDigging` data layer

**Files:**
- Create: `supabase/migrations/20260831_add_record_digging_shelves.sql`
- Create: `utils/recordDigging.ts`

**Interfaces:**
- Produces:
  - `MIN_SHELF_ALBUMS: number`, `NEW_ARRIVALS_DAYS: number`, `NEW_ARRIVALS_KEY: 'new-arrivals'`, `NEW_ARRIVALS_LABEL: '新着'` (exported constants)
  - `type DiggingShelf = { key: string; label: string; isGenre: boolean }`
  - `type DiggingRecord = { id: string; title: string; jacketUrl: string; artistId: string; artistName: string; releaseDate: string | null; firstTrackId: string | null; firstTrackPreviewUrl: string | null }`
  - `fetchEligibleGenreShelves(supabase): Promise<DiggingShelf[]>` — always returns `NEW_ARRIVALS_KEY` first, then genre shelves sorted by label
  - `fetchShelfRecords(supabase, shelfKey: string): Promise<DiggingRecord[]>`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260831_add_record_digging_shelves.sql`:

```sql
-- Junkie Dig(レコード屋ディグり体験)向けの棚判定・アルバム取得用RPC。
-- ジャンルタグはartist_genre経由でしか付いていないため、ジャケットありの
-- アルバム数をアーティスト経由で集計し、閾値以上のジャンルだけを「棚」として
-- 返す。新着棚(ジャンル不問)は別関数で扱う。
CREATE OR REPLACE FUNCTION record_digging_eligible_genres(min_albums int)
RETURNS TABLE (genre_id text, genre_name text, album_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT g.id, g.name, COUNT(DISTINCT al.id) AS album_count
  FROM genre g
  JOIN artist_genre ag ON ag.genre_id = g.id
  JOIN album al ON al.artist_id = ag.artist_id AND al.jacket_url IS NOT NULL
  GROUP BY g.id, g.name
  HAVING COUNT(DISTINCT al.id) >= min_albums
  ORDER BY g.name;
$$;

CREATE OR REPLACE FUNCTION record_digging_shelf_albums(target_genre_id text)
RETURNS TABLE (
  album_id text, title text, jacket_url text, artist_id text, artist_name text, release_date date
)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT al.id, al.title, al.jacket_url, al.artist_id, ar.name, al.release_date
  FROM album al
  JOIN artist ar ON ar.id = al.artist_id
  JOIN artist_genre ag ON ag.artist_id = al.artist_id
  WHERE ag.genre_id = target_genre_id AND al.jacket_url IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION record_digging_new_arrivals(since_date date)
RETURNS TABLE (
  album_id text, title text, jacket_url text, artist_id text, artist_name text, release_date date
)
LANGUAGE sql STABLE AS $$
  SELECT al.id, al.title, al.jacket_url, al.artist_id, ar.name, al.release_date
  FROM album al
  JOIN artist ar ON ar.id = al.artist_id
  WHERE al.jacket_url IS NOT NULL
    AND al.release_date >= since_date
    AND al.release_date <= CURRENT_DATE
  ORDER BY al.release_date DESC;
$$;
```

- [ ] **Step 2: Apply the migration to the live project**

Use the `mcp__claude_ai_Supabase__apply_migration` tool with:
- `project_id`: `ftvhglfthbcxhgnoninv`
- `name`: `add_record_digging_shelves`
- `query`: the exact SQL from Step 1

Confirm it returns success (no error).

- [ ] **Step 3: Write `utils/recordDigging.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

type Supabase = SupabaseClient<any, any, any>

export const MIN_SHELF_ALBUMS = 8
export const NEW_ARRIVALS_DAYS = 30
export const NEW_ARRIVALS_KEY = 'new-arrivals'
export const NEW_ARRIVALS_LABEL = '新着'

export type DiggingShelf = {
  key: string
  label: string
  isGenre: boolean
}

export type DiggingRecord = {
  id: string
  title: string
  jacketUrl: string
  artistId: string
  artistName: string
  releaseDate: string | null
  firstTrackId: string | null
  firstTrackPreviewUrl: string | null
}

// サーバーはUTCで動くため、JSTの「今日からN日前」を単純な日数引き算ではなく
// UTC基準のDate.UTCで組み立てる(utils/homeCards.tsのtomorrowJSTと同じ考え方)
function daysAgoJST(days: number): string {
  const todayJST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [y, m, d] = todayJST.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
}

type ShelfAlbumRow = {
  album_id: string
  title: string
  jacket_url: string
  artist_id: string
  artist_name: string
  release_date: string | null
}

/** 各アルバムの最初の収録曲(disc_number→track_no昇順で先頭)を取得し、
 * DiggingRecordへ組み立てる。preview_urlが無い曲でもfirstTrackIdは設定する
 * (試聴不可の表示に使うのはfirstTrackPreviewUrlの有無で判定するため)。 */
async function attachFirstTracks(supabase: Supabase, rows: ShelfAlbumRow[]): Promise<DiggingRecord[]> {
  if (rows.length === 0) return []

  const albumIds = rows.map((r) => r.album_id)
  const { data: tracks } = await supabase
    .from('track')
    .select('id, album_id, track_no, disc_number, preview_url')
    .in('album_id', albumIds)
    .order('disc_number', { ascending: true, nullsFirst: true })
    .order('track_no', { ascending: true, nullsFirst: true })

  const firstTrackByAlbum = new Map<string, { id: string; preview_url: string | null }>()
  for (const t of tracks ?? []) {
    if (!firstTrackByAlbum.has(t.album_id)) {
      firstTrackByAlbum.set(t.album_id, { id: t.id, preview_url: t.preview_url })
    }
  }

  return rows.map((r) => {
    const firstTrack = firstTrackByAlbum.get(r.album_id)
    return {
      id: r.album_id,
      title: r.title,
      jacketUrl: r.jacket_url,
      artistId: r.artist_id,
      artistName: r.artist_name,
      releaseDate: r.release_date,
      firstTrackId: firstTrack?.id ?? null,
      firstTrackPreviewUrl: firstTrack?.preview_url ?? null,
    }
  })
}

/** 棚として採用できるジャンル一覧(MIN_SHELF_ALBUMS枚以上のジャケット付き
 * アルバムを持つジャンルのみ)を、先頭に「新着」を付けて返す。 */
export async function fetchEligibleGenreShelves(supabase: Supabase): Promise<DiggingShelf[]> {
  const { data, error } = await supabase.rpc('record_digging_eligible_genres', { min_albums: MIN_SHELF_ALBUMS })
  if (error) {
    console.error('棚候補ジャンルの取得に失敗しました:', error.message)
    return [{ key: NEW_ARRIVALS_KEY, label: NEW_ARRIVALS_LABEL, isGenre: false }]
  }

  const genreShelves: DiggingShelf[] = (data ?? []).map((row: { genre_id: string; genre_name: string }) => ({
    key: row.genre_id,
    label: row.genre_name,
    isGenre: true,
  }))

  return [{ key: NEW_ARRIVALS_KEY, label: NEW_ARRIVALS_LABEL, isGenre: false }, ...genreShelves]
}

/** 指定した棚に属するレコード一覧を返す。'new-arrivals'はジャンル不問で
 * 直近NEW_ARRIVALS_DAYS日以内にリリースされたアルバムを返す。 */
export async function fetchShelfRecords(supabase: Supabase, shelfKey: string): Promise<DiggingRecord[]> {
  if (shelfKey === NEW_ARRIVALS_KEY) {
    const { data, error } = await supabase.rpc('record_digging_new_arrivals', {
      since_date: daysAgoJST(NEW_ARRIVALS_DAYS),
    })
    if (error) {
      console.error('新着棚の取得に失敗しました:', error.message)
      return []
    }
    return attachFirstTracks(supabase, (data ?? []) as ShelfAlbumRow[])
  }

  const { data, error } = await supabase.rpc('record_digging_shelf_albums', { target_genre_id: shelfKey })
  if (error) {
    console.error(`棚(${shelfKey})の取得に失敗しました:`, error.message)
    return []
  }
  return attachFirstTracks(supabase, (data ?? []) as ShelfAlbumRow[])
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Verify against real data with a one-off script**

Write this to the scratchpad (not committed) and run with `set -a && source .env.local && set +a && npx tsx <path>`:

```ts
import { createClient } from '@supabase/supabase-js'
import { fetchEligibleGenreShelves, fetchShelfRecords } from './utils/recordDigging'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const shelves = await fetchEligibleGenreShelves(supabase)
  console.log('shelves:', shelves.length, shelves.slice(0, 5))

  const newArrivals = await fetchShelfRecords(supabase, 'new-arrivals')
  console.log('new-arrivals records:', newArrivals.length, newArrivals[0])

  const firstGenre = shelves.find((s) => s.isGenre)
  if (firstGenre) {
    const records = await fetchShelfRecords(supabase, firstGenre.key)
    console.log(`${firstGenre.label} records:`, records.length, records[0])
  }
}
main()
```

Expected: `shelves` includes `new-arrivals` first plus multiple genre shelves (e.g. Rock, Pop — matches the ≥8-album threshold); `new-arrivals records` and the genre's `records` are non-empty arrays where each item has a `jacketUrl` and `firstTrackId` is non-null for at least some entries (some may have `firstTrackPreviewUrl: null`, which is expected).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260831_add_record_digging_shelves.sql utils/recordDigging.ts
git commit -m "feat: add record-digging shelf/record data layer and RPCs"
```

---

### Task 2: Public API routes

**Files:**
- Create: `app/api/record-digging/shelves/route.ts`
- Create: `app/api/record-digging/records/route.ts`

**Interfaces:**
- Consumes: `fetchEligibleGenreShelves`, `fetchShelfRecords` from `@/utils/recordDigging` (Task 1); `createClient` from `@/utils/Supabase/server`
- Produces: `GET /api/record-digging/shelves` → `DiggingShelf[]` JSON; `GET /api/record-digging/records?shelf={key}` → `DiggingRecord[]` JSON (400 if `shelf` missing)

- [ ] **Step 1: Write the shelves route**

```ts
// app/api/record-digging/shelves/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/utils/Supabase/server'
import { fetchEligibleGenreShelves } from '@/utils/recordDigging'

export async function GET() {
  const supabase = await createClient()
  const shelves = await fetchEligibleGenreShelves(supabase)
  return NextResponse.json(shelves)
}
```

- [ ] **Step 2: Write the records route**

```ts
// app/api/record-digging/records/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/Supabase/server'
import { fetchShelfRecords } from '@/utils/recordDigging'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const shelf = searchParams.get('shelf')
  if (!shelf) {
    return NextResponse.json({ error: 'shelf is required' }, { status: 400 })
  }
  const supabase = await createClient()
  const records = await fetchShelfRecords(supabase, shelf)
  return NextResponse.json(records)
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Verify against the local dev server**

```bash
npm run dev > /tmp/nextdev.log 2>&1 &
sleep 6
set -a && source .env.local && set +a
curl -s -u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}" "http://localhost:3000/api/record-digging/shelves" | head -c 500
echo
curl -s -u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}" "http://localhost:3000/api/record-digging/records?shelf=new-arrivals" | head -c 500
echo
curl -s -o /dev/null -w "%{http_code}\n" -u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}" "http://localhost:3000/api/record-digging/records"
pkill -f "next dev"
```

Expected: first two calls return non-empty JSON arrays; the third (missing `shelf` param) returns `400`.

- [ ] **Step 5: Commit**

```bash
git add app/api/record-digging/shelves/route.ts app/api/record-digging/records/route.ts
git commit -m "feat: add record-digging API routes"
```

---

### Task 3: `useSwipeGesture` hook

**Files:**
- Create: `app/components/record-digging/useSwipeGesture.ts`

**Interfaces:**
- Produces: `type SwipeDirection = 'up' | 'down' | 'left' | 'right'`; `useSwipeGesture(onSwipe: (direction: SwipeDirection) => void): React.RefObject<HTMLDivElement>` — attach the returned ref to the swipeable container; touch/mouse are scoped to that element, keyboard arrows are scoped to `document`.

- [ ] **Step 1: Write the hook**

```ts
'use client'

import { useEffect, useRef } from 'react'

export type SwipeDirection = 'up' | 'down' | 'left' | 'right'

const SWIPE_THRESHOLD_PX = 80

/** タッチ/マウスドラッグ/矢印キーを統一的にスワイプ方向イベントへ変換する。
 * 返されたrefを対象要素に付けると、その要素上でのタッチ・マウス操作を検知する
 * (矢印キーはdocument全体で検知する)。1ジェスチャーにつきonSwipeは最大1回だけ発火する。 */
export function useSwipeGesture(onSwipe: (direction: SwipeDirection) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const onSwipeRef = useRef(onSwipe)
  onSwipeRef.current = onSwipe

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let startX = 0
    let startY = 0
    let tracking = false
    let fired = false

    function resolveDirection(dx: number, dy: number): SwipeDirection | null {
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      if (Math.max(absX, absY) < SWIPE_THRESHOLD_PX) return null
      if (absX > absY) return dx > 0 ? 'right' : 'left'
      return dy > 0 ? 'down' : 'up'
    }

    function handleMove(clientX: number, clientY: number) {
      if (!tracking || fired) return
      const direction = resolveDirection(clientX - startX, clientY - startY)
      if (direction) {
        fired = true
        tracking = false
        onSwipeRef.current(direction)
      }
    }

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      tracking = true
      fired = false
    }
    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0]
      handleMove(t.clientX, t.clientY)
    }
    function onTouchEnd() {
      tracking = false
    }

    function onMouseDown(e: MouseEvent) {
      startX = e.clientX
      startY = e.clientY
      tracking = true
      fired = false
    }
    function onMouseMove(e: MouseEvent) {
      handleMove(e.clientX, e.clientY)
    }
    function onMouseUp() {
      tracking = false
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowUp') onSwipeRef.current('up')
      else if (e.key === 'ArrowDown') onSwipeRef.current('down')
      else if (e.key === 'ArrowLeft') onSwipeRef.current('left')
      else if (e.key === 'ArrowRight') onSwipeRef.current('right')
      else return
      e.preventDefault()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return ref
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors. (Behavioral verification of the actual swipe detection happens in Task 6's integration test, once there's a real element to attach it to.)

- [ ] **Step 3: Commit**

```bash
git add app/components/record-digging/useSwipeGesture.ts
git commit -m "feat: add useSwipeGesture hook for record-digging"
```

---

### Task 4: `useDiggingSound` hook

**Files:**
- Create: `app/components/record-digging/useDiggingSound.ts`

**Interfaces:**
- Produces: `useDiggingSound(): { playFlip: () => void; playPickup: () => void }`

- [ ] **Step 1: Write the hook**

```ts
'use client'

import { useRef } from 'react'

/** レコードを切り替える「シュッ」という短い音と、取り上げる「余韻のある」音を
 * Web Audio APIでその場合成する(外部音源ファイルは使わない)。AudioContextは
 * ブラウザの自動再生制約を避けるため、最初のplay*呼び出し時に遅延生成する。 */
export function useDiggingSound() {
  const ctxRef = useRef<AudioContext | null>(null)

  function getContext(): AudioContext {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext()
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume()
    }
    return ctxRef.current
  }

  function makeNoiseBuffer(ctx: AudioContext, durationSeconds: number): AudioBuffer {
    const bufferSize = Math.floor(ctx.sampleRate * durationSeconds)
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
    }
    return buffer
  }

  function playFlip() {
    const ctx = getContext()
    const duration = 0.08

    const source = ctx.createBufferSource()
    source.buffer = makeNoiseBuffer(ctx, duration)

    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 2000

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.5, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    source.start()
  }

  function playPickup() {
    const ctx = getContext()
    const duration = 0.3

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(200, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + duration)

    const oscGain = ctx.createGain()
    oscGain.gain.setValueAtTime(0.3, ctx.currentTime)
    oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    const noiseSource = ctx.createBufferSource()
    noiseSource.buffer = makeNoiseBuffer(ctx, 0.05)
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.2, ctx.currentTime)

    osc.connect(oscGain)
    oscGain.connect(ctx.destination)
    noiseSource.connect(noiseGain)
    noiseGain.connect(ctx.destination)

    osc.start()
    osc.stop(ctx.currentTime + duration)
    noiseSource.start()
  }

  return { playFlip, playPickup }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/record-digging/useDiggingSound.ts
git commit -m "feat: add useDiggingSound hook (Web Audio SE synthesis)"
```

---

### Task 5: Presentational components — `RecordSleeve` and `GenreShelfTabs`

**Files:**
- Create: `app/components/record-digging/RecordSleeve.tsx`
- Create: `app/components/record-digging/GenreShelfTabs.tsx`

**Interfaces:**
- Consumes: `type DiggingRecord`, `type DiggingShelf` from `@/utils/recordDigging` (Task 1)
- Produces: `<RecordSleeve current={DiggingRecord} upNext={DiggingRecord[]} />`; `<GenreShelfTabs shelves={DiggingShelf[]} currentIndex={number} />`

- [ ] **Step 1: Write `RecordSleeve.tsx`**

```tsx
'use client'

import type { DiggingRecord } from '@/utils/recordDigging'

/** 中央に現在の1枚、その奥に次・次々のレコード(upNext、最大2件)をチラ見せする。
 * 完全には見せず、縮小+低opacityで縁だけ覗かせて「棚を掘っている」感を出す。 */
export default function RecordSleeve({
  current,
  upNext,
}: {
  current: DiggingRecord
  upNext: DiggingRecord[]
}) {
  return (
    <div className="relative mx-auto aspect-square w-64 sm:w-80">
      {upNext
        .slice()
        .reverse()
        .map((rec, i) => {
          const depth = upNext.length - i
          return (
            <div
              key={rec.id}
              className="absolute inset-x-0 overflow-hidden rounded-lg bg-white/5"
              style={{
                top: `${depth * 10}px`,
                bottom: `${-depth * 10}px`,
                transform: `scale(${1 - depth * 0.05})`,
                opacity: 0.25 / depth,
                zIndex: 10 - depth,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={rec.jacketUrl} alt="" className="h-full w-full object-cover" />
            </div>
          )
        })}

      <div className="relative z-10 aspect-square overflow-hidden rounded-lg bg-white/5 shadow-2xl shadow-black/70 ring-1 ring-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.jacketUrl} alt={current.title} className="h-full w-full object-contain" />
        {!current.firstTrackPreviewUrl && (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white/60 backdrop-blur">
            配信情報なし
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `GenreShelfTabs.tsx`**

```tsx
'use client'

import type { DiggingShelf } from '@/utils/recordDigging'

/** 参考画像の仕切り札のように、現在の棚名を強調表示し、その左右に前後の棚名を
 * 薄く覗かせる(左右スワイプで棚が変わることの示唆になる)。棚が1つしか無ければ
 * 前後は表示しない。 */
export default function GenreShelfTabs({
  shelves,
  currentIndex,
}: {
  shelves: DiggingShelf[]
  currentIndex: number
}) {
  if (shelves.length === 0) return null
  const showNeighbors = shelves.length > 1
  const prev = shelves[(currentIndex - 1 + shelves.length) % shelves.length]
  const current = shelves[currentIndex]
  const next = shelves[(currentIndex + 1) % shelves.length]

  return (
    <div className="relative z-10 flex items-center justify-center gap-3 px-4 text-center">
      {showNeighbors && <span className="truncate text-xs text-white/25">{prev.label}</span>}
      <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-1.5 text-sm font-semibold tracking-wide text-amber-200">
        {current.label}
      </span>
      {showNeighbors && <span className="truncate text-xs text-white/25">{next.label}</span>}
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors. (Visual verification happens in Task 6's integration test, once these render with real data inside the modal.)

- [ ] **Step 4: Commit**

```bash
git add app/components/record-digging/RecordSleeve.tsx app/components/record-digging/GenreShelfTabs.tsx
git commit -m "feat: add RecordSleeve and GenreShelfTabs presentational components"
```

---

### Task 6: `RecordDiggingModal`

**Files:**
- Create: `app/components/record-digging/RecordDiggingModal.tsx`

**Interfaces:**
- Consumes: `useSwipeGesture`, `type SwipeDirection` (Task 3); `useDiggingSound` (Task 4); `RecordSleeve`, `GenreShelfTabs` (Task 5); `type DiggingShelf`, `type DiggingRecord`, `NEW_ARRIVALS_KEY` from `@/utils/recordDigging` (Task 1); `usePreviewPlayer` from `@/app/components/PreviewPlayerContext`; `/api/record-digging/shelves` and `/api/record-digging/records` (Task 2)
- Produces: `<RecordDiggingModal onClose={() => void} />`

- [ ] **Step 1: Write `RecordDiggingModal.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePreviewPlayer } from '@/app/components/PreviewPlayerContext'
import { useSwipeGesture, type SwipeDirection } from './useSwipeGesture'
import { useDiggingSound } from './useDiggingSound'
import RecordSleeve from './RecordSleeve'
import GenreShelfTabs from './GenreShelfTabs'
import { NEW_ARRIVALS_KEY, type DiggingShelf, type DiggingRecord } from '@/utils/recordDigging'

function shuffle<T>(items: T[]): T[] {
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** 山札を再シャッフルする際、直前の1枚(prevLastId)が新しい山札の先頭に来ないよう
 * 1回だけ入れ替える(セッション内で同じ盤がすぐ連続するのを防ぐ)。 */
function reshuffleDeck(items: DiggingRecord[], prevLastId: string | null): DiggingRecord[] {
  const shuffled = shuffle(items)
  if (shuffled.length > 1 && prevLastId && shuffled[0].id === prevLastId) {
    ;[shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]]
  }
  return shuffled
}

type LoadState = 'loading' | 'ready' | 'error'

export default function RecordDiggingModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { setPlayingTrackId } = usePreviewPlayer()
  const { playFlip, playPickup } = useDiggingSound()

  const [shelves, setShelves] = useState<DiggingShelf[]>([])
  const [shelfIndex, setShelfIndex] = useState(0)
  const [deck, setDeck] = useState<DiggingRecord[]>([])
  const [deckPosition, setDeckPosition] = useState(0)
  const [state, setState] = useState<LoadState>('loading')
  const [showHint, setShowHint] = useState(true)

  // 棚一覧の取得(モーダルを開いた瞬間に1回だけ)
  useEffect(() => {
    let cancelled = false
    fetch('/api/record-digging/shelves')
      .then((res) => {
        if (!res.ok) throw new Error('shelves fetch failed')
        return res.json()
      })
      .then((data: DiggingShelf[]) => {
        if (!cancelled) setShelves(data)
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 現在の棚のレコード取得(shelvesが決まった時・shelfIndexが変わった時)
  useEffect(() => {
    if (shelves.length === 0) return
    const shelf = shelves[shelfIndex]
    let cancelled = false
    setState('loading')
    fetch(`/api/record-digging/records?shelf=${encodeURIComponent(shelf.key)}`)
      .then((res) => {
        if (!res.ok) throw new Error('records fetch failed')
        return res.json()
      })
      .then((data: DiggingRecord[]) => {
        if (cancelled) return
        if (data.length === 0) {
          // 「新着」が0件なら、次の棚(ジャンル)があれば自動フォールバック
          if (shelf.key === NEW_ARRIVALS_KEY && shelves.length > 1) {
            setShelfIndex(1)
            return
          }
          setState('error')
          return
        }
        setDeck(shuffle(data))
        setDeckPosition(0)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelves, shelfIndex])

  // 現在のレコードが変わるたびに1曲目を自動再生(試聴できなければ止めるだけ)
  useEffect(() => {
    if (state !== 'ready' || deck.length === 0) return
    const current = deck[deckPosition]
    setPlayingTrackId(current.firstTrackPreviewUrl && current.firstTrackId ? current.firstTrackId : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, deckPosition, state])

  // モーダルを閉じたら再生停止
  useEffect(() => {
    return () => setPlayingTrackId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 4000)
    return () => clearTimeout(timer)
  }, [])

  function handleSwipe(direction: SwipeDirection) {
    setShowHint(false)
    if (state !== 'ready' || deck.length === 0) return

    if (direction === 'down') {
      playFlip()
      const next = deckPosition + 1
      if (next < deck.length) {
        setDeckPosition(next)
      } else {
        setDeck(reshuffleDeck(deck, deck[deck.length - 1]?.id ?? null))
        setDeckPosition(0)
      }
      return
    }

    if (direction === 'up') {
      const current = deck[deckPosition]
      playPickup()
      setPlayingTrackId(null)
      onClose()
      router.push(`/albums/${current.id}`)
      return
    }

    if (shelves.length <= 1) return

    playFlip()
    if (direction === 'left') {
      setShelfIndex((i) => (i - 1 + shelves.length) % shelves.length)
    } else if (direction === 'right') {
      setShelfIndex((i) => (i + 1) % shelves.length)
    }
  }

  const swipeRef = useSwipeGesture(handleSwipe)

  const current = deck[deckPosition]
  const upNext = deck.slice(deckPosition + 1, deckPosition + 3)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#120d08]">
      {/* オリジナル背景: 暖色照明+木目テクスチャ(SVG feTurbulence)。画像アセット無し */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-20" aria-hidden>
        <filter id="junkie-dig-wood-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.15" numOctaves={3} seed={7} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#junkie-dig-wood-grain)" />
      </svg>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 20%, rgba(240,151,90,0.18), transparent 60%)' }}
      />

      <div className="relative z-10 flex items-center justify-between p-4">
        <span className="text-sm font-semibold tracking-wide text-amber-200">Junkie Dig</span>
        <button
          type="button"
          onClick={() => {
            setPlayingTrackId(null)
            onClose()
          }}
          aria-label="閉じる"
          className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
        >
          閉じる ✕
        </button>
      </div>

      {shelves.length > 0 && <GenreShelfTabs shelves={shelves} currentIndex={shelfIndex} />}

      <div ref={swipeRef} className="relative z-10 flex flex-1 items-center justify-center overflow-hidden px-6">
        {state === 'error' && (
          <p className="text-sm text-white/50">読み込みに失敗しました。閉じてもう一度開いてみてください。</p>
        )}
        {state === 'loading' && <p className="text-sm text-white/30">棚を探しています...</p>}
        {state === 'ready' && current && (
          <div className="w-full">
            <RecordSleeve current={current} upNext={upNext} />
            <div className="mt-6 text-center">
              <p className="text-lg font-bold text-white">{current.title}</p>
              <p className="text-sm text-white/50">{current.artistName}</p>
            </div>
          </div>
        )}
      </div>

      {showHint && state === 'ready' && (
        <div className="pointer-events-none relative z-10 flex justify-center gap-6 pb-6 text-[11px] text-white/40">
          <span>↓ 次へ</span>
          <span>↑ 詳細へ</span>
          {shelves.length > 1 && <span>← → 棚を変える</span>}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Verify with a temporary render in the dev server**

Temporarily add `<RecordDiggingModal onClose={() => {}} />` to the bottom of `app/page.tsx`'s JSX (do not commit this), then:

```bash
npm run dev > /tmp/nextdev.log 2>&1 &
sleep 6
set -a && source .env.local && set +a
curl -s -u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}" "http://localhost:3000/" | grep -o "Junkie Dig" | wc -l
pkill -f "next dev"
```

Expected: count ≥ 1 (the modal's header label renders). Then revert the temporary edit to `app/page.tsx` (`git checkout -- app/page.tsx` or manually remove the line) — Task 7 is what actually wires the modal in for real, via the launcher.

- [ ] **Step 4: Commit**

```bash
git add app/components/record-digging/RecordDiggingModal.tsx
git commit -m "feat: add RecordDiggingModal (swipe orchestration, playback, SE)"
```

---

### Task 7: `RecordDiggingLauncher` and site-wide wiring

**Files:**
- Create: `app/components/record-digging/RecordDiggingLauncher.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `RecordDiggingModal` (Task 6)
- Produces: `<RecordDiggingLauncher />` — a self-contained floating button + modal toggle, mountable anywhere

- [ ] **Step 1: Write `RecordDiggingLauncher.tsx`**

```tsx
'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

// モーダルはWeb Audio・スワイプ判定込みでそれなりの重さがあるため、開くまで
// バンドルに含めない(全ページで読み込まれるランチャー自体は軽く保つ)
const RecordDiggingModal = dynamic(() => import('./RecordDiggingModal'), { ssr: false })

export default function RecordDiggingLauncher() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-amber-400/30 bg-[#1a120b]/90 px-4 py-2.5 text-xs font-semibold tracking-wide text-amber-200 shadow-lg shadow-black/50 backdrop-blur transition hover:bg-[#241a10]"
      >
        🎧 Junkie Dig
      </button>
      {open && <RecordDiggingModal onClose={() => setOpen(false)} />}
    </>
  )
}
```

- [ ] **Step 2: Wire into `app/layout.tsx`**

Modify `app/layout.tsx`: add the import near the other component imports (after the `PreviewPlayerProvider` import), and render `<RecordDiggingLauncher />` right after `<main>` closes, still inside `<PreviewPlayerProvider>`:

```tsx
import { PreviewPlayerProvider } from "./components/PreviewPlayerContext";
import RecordDiggingLauncher from "./components/record-digging/RecordDiggingLauncher";
```

```tsx
        <PreviewPlayerProvider>
          <main className="flex-1">{children}</main>
          <RecordDiggingLauncher />
        </PreviewPlayerProvider>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Full end-to-end verification**

```bash
npm run dev > /tmp/nextdev.log 2>&1 &
sleep 6
set -a && source .env.local && set +a
curl -s -u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}" "http://localhost:3000/" -o /tmp/home_digging.html -w "%{http_code}\n"
grep -o "Junkie Dig" /tmp/home_digging.html | wc -l
curl -s -u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}" "http://localhost:3000/albums" -o /tmp/albums_digging.html -w "%{http_code}\n"
grep -o "Junkie Dig" /tmp/albums_digging.html | wc -l
pkill -f "next dev"
```

Expected: both pages return 200 and contain the "Junkie Dig" launcher button label (proving it's mounted globally, not page-specific). Note the button label is present even though the modal itself is `dynamic(..., { ssr: false })` — only the modal's contents are excluded from SSR, the launcher button renders normally.

Then, since gesture/audio behavior cannot be verified via `curl`, do a manual check with `npm run dev` running and the browser open at `http://localhost:3000`:
1. Click the floating "Junkie Dig" button — modal should open showing a "新着" shelf record with hint text, and (if the record has a preview) audio should start playing.
2. Press `ArrowDown` a few times — record should change, a short SE should play, and if a new record has a preview it should start playing (replacing the previous one).
3. Press `ArrowRight` — the genre tab label should change and a new deck should load for that genre.
4. Press `ArrowUp` — a slightly longer SE should play, the modal should close, and the browser should navigate to that record's `/albums/[id]` page.
5. Reopen the modal and use Chrome DevTools' touch emulation (or a real touch device) to confirm the same four gestures work by dragging.

- [ ] **Step 5: Commit**

```bash
git add app/components/record-digging/RecordDiggingLauncher.tsx app/layout.tsx
git commit -m "feat: mount Junkie Dig floating launcher site-wide"
```
