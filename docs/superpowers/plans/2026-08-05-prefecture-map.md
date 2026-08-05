# Prefecture Pin Map (Power Play & Heavy Rotation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deformed SVG map of Japan to `/media/on-air` that shows a pin per prefecture with active rotation data for the selected month, and lets the user click a pin to instantly see that prefecture's stations/tracks without a page reload.

**Architecture:** `/media/on-air/page.tsx` (Server Component) fetches and aggregates rotation data by prefecture server-side, then passes a plain data array as props to a new `PrefectureMap` client component that owns only the pin-selection UI state. A static coordinate table (`utils/prefectures.ts`) supplies the deformed map layout — no map library, no geo API.

**Tech Stack:** Next.js 16 App Router, React Server + Client Components, Supabase (`@supabase/ssr`), Tailwind CSS v4, inline SVG.

## Global Constraints

- No external map library or geo/map API — coordinates are a hand-authored static table (spec: "外部地図ライブラリ・地図APIには依存しない").
- Map is deformed/approximate, not geographically accurate (spec: "非ゴール... 緯度経度に基づく正確な地理描画").
- No media edit UI in this plan — only the "メディアを追加" (create) form gets a new field (spec: "非ゴール... メディアの編集フォーム").
- No automated test suite exists in this project (no test framework in `package.json`) and the spec explicitly calls for manual verification only (spec: "自動テストは追加しない"). Every task below is verified by running the dev server and checking with `curl` and/or a throwaway Playwright script in the scratchpad directory, per this project's established convention — not by writing unit tests.
- `media.prefecture` for FM802 is already backfilled to `大阪府` (done during brainstorming). No further backfill is in scope.
- Pin/ranking count mismatches for media with no `prefecture` set are an accepted, known limitation — do not add reconciliation or warning UI (spec).

---

## File Structure

- **Create** `utils/prefectures.ts` — static list of all 47 prefectures with deformed `{ x, y }` coordinates (0–100 viewBox space). Pure data, no logic.
- **Create** `app/components/PrefectureMap.tsx` — `'use client'` component. Exports `PrefectureEntry` and `PrefectureMapData` types, plus the default `PrefectureMap` component. Owns only `selectedPref` UI state.
- **Modify** `app/media/on-air/page.tsx` — extend the existing `monthRows` Supabase query to also fetch `media.prefecture`, aggregate into `PrefectureMapData[]`, and render `<PrefectureMap>` between the month nav and the ranking table.
- **Modify** `app/admin/data/actions.ts` — `createMedia` reads and inserts a `prefecture` field.
- **Modify** `app/admin/data/page.tsx` — "メディアを追加" form gets a `<select name="prefecture">` populated from `utils/prefectures.ts`.

---

### Task 1: Prefecture coordinate table

**Files:**
- Create: `utils/prefectures.ts`

**Interfaces:**
- Produces: `export type PrefectureCoord = { name: string; x: number; y: number }` and `export const PREFECTURE_COORDS: PrefectureCoord[]` (47 entries, unique `name`s, `x`/`y` in the 0–100 range). Consumed by Task 2 (`PrefectureMap`) and Task 3 (`page.tsx` aggregation only needs the `name` strings implicitly via matching `media.prefecture` values) and Task 5 (admin form select options).

- [ ] **Step 1: Create the file with all 47 prefectures**

```ts
// utils/prefectures.ts
export type PrefectureCoord = { name: string; x: number; y: number }

// 0-100 のviewBox上でのデフォルメ配置。緯度経度に基づく正確な地理座標ではない。
export const PREFECTURE_COORDS: PrefectureCoord[] = [
  { name: '北海道', x: 82, y: 8 },
  { name: '青森県', x: 76, y: 18 },
  { name: '岩手県', x: 80, y: 22 },
  { name: '宮城県', x: 77, y: 26 },
  { name: '秋田県', x: 71, y: 22 },
  { name: '山形県', x: 72, y: 27 },
  { name: '福島県', x: 74, y: 31 },
  { name: '茨城県', x: 76, y: 35 },
  { name: '栃木県', x: 72, y: 33 },
  { name: '群馬県', x: 68, y: 33 },
  { name: '埼玉県', x: 70, y: 36 },
  { name: '千葉県', x: 77, y: 39 },
  { name: '東京都', x: 72, y: 38 },
  { name: '神奈川県', x: 71, y: 41 },
  { name: '新潟県', x: 66, y: 30 },
  { name: '富山県', x: 60, y: 32 },
  { name: '石川県', x: 57, y: 30 },
  { name: '福井県', x: 56, y: 35 },
  { name: '山梨県', x: 68, y: 39 },
  { name: '長野県', x: 64, y: 36 },
  { name: '岐阜県', x: 60, y: 39 },
  { name: '静岡県', x: 68, y: 42 },
  { name: '愛知県', x: 63, y: 42 },
  { name: '三重県', x: 61, y: 45 },
  { name: '滋賀県', x: 58, y: 41 },
  { name: '京都府', x: 56, y: 40 },
  { name: '大阪府', x: 55, y: 44 },
  { name: '兵庫県', x: 52, y: 42 },
  { name: '奈良県', x: 57, y: 45 },
  { name: '和歌山県', x: 55, y: 48 },
  { name: '鳥取県', x: 48, y: 40 },
  { name: '島根県', x: 44, y: 39 },
  { name: '岡山県', x: 48, y: 44 },
  { name: '広島県', x: 43, y: 44 },
  { name: '山口県', x: 38, y: 46 },
  { name: '徳島県', x: 50, y: 49 },
  { name: '香川県', x: 48, y: 48 },
  { name: '愛媛県', x: 43, y: 49 },
  { name: '高知県', x: 46, y: 51 },
  { name: '福岡県', x: 34, y: 50 },
  { name: '佐賀県', x: 31, y: 52 },
  { name: '長崎県', x: 27, y: 53 },
  { name: '熊本県', x: 32, y: 55 },
  { name: '大分県', x: 37, y: 52 },
  { name: '宮崎県', x: 35, y: 57 },
  { name: '鹿児島県', x: 31, y: 60 },
  { name: '沖縄県', x: 18, y: 68 },
]
```

- [ ] **Step 2: Verify there are exactly 47 unique names**

Run: `npx tsc --noEmit`
Expected: no errors — this confirms the file is structurally valid TypeScript.

Then run a plain grep count to confirm the entry count matches the 47 Japanese prefectures (1 都 + 1 道 + 2 府 + 43 県):

Run: `grep -c "name:" utils/prefectures.ts`
Expected: `47`

Run: `grep -o "name: '[^']*'" utils/prefectures.ts | sort -u | wc -l`
Expected: `47` (confirms no duplicate names)

- [ ] **Step 3: Commit**

```bash
git add utils/prefectures.ts
git commit -m "Add deformed prefecture coordinate table for on-air map"
```

---

### Task 2: PrefectureMap client component

**Files:**
- Create: `app/components/PrefectureMap.tsx`

**Interfaces:**
- Consumes: `PREFECTURE_COORDS` from `utils/prefectures.ts` (Task 1).
- Produces: `export type PrefectureEntry = { stationName: string; targetLabel: string; targetHref: string | null; musicType: 'DOMESTIC' | 'OVERSEAS' }`, `export type PrefectureMapData = { prefecture: string; mediaCount: number; entries: PrefectureEntry[] }`, and default export `PrefectureMap({ data }: { data: PrefectureMapData[] })`. Consumed by Task 3 (`on-air/page.tsx`).

- [ ] **Step 1: Create the component**

```tsx
// app/components/PrefectureMap.tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import { PREFECTURE_COORDS } from '@/utils/prefectures'

export type PrefectureEntry = {
  stationName: string
  targetLabel: string
  targetHref: string | null
  musicType: 'DOMESTIC' | 'OVERSEAS'
}

export type PrefectureMapData = {
  prefecture: string
  mediaCount: number
  entries: PrefectureEntry[]
}

const MUSIC_TYPE_LABEL: Record<string, string> = {
  DOMESTIC: '邦楽',
  OVERSEAS: '洋楽',
}

export default function PrefectureMap({ data }: { data: PrefectureMapData[] }) {
  const [selectedPref, setSelectedPref] = useState<string | null>(null)

  const dataByPrefecture = new Map(data.map((d) => [d.prefecture, d]))
  const selected = selectedPref ? dataByPrefecture.get(selectedPref) : null

  return (
    <div>
      <svg viewBox="0 0 100 100" className="w-full max-w-md touch-none select-none" style={{ maxHeight: 420 }}>
        {PREFECTURE_COORDS.map((coord) => {
          const entry = dataByPrefecture.get(coord.name)
          if (!entry) return null
          const isSelected = selectedPref === coord.name

          return (
            <g
              key={coord.name}
              transform={`translate(${coord.x}, ${coord.y})`}
              onClick={() => setSelectedPref(isSelected ? null : coord.name)}
              className="cursor-pointer"
            >
              <circle
                r={isSelected ? 2.6 : 2}
                fill={isSelected ? '#ffffff' : 'rgba(255,255,255,0.5)'}
                stroke="rgba(255,255,255,0.6)"
                strokeWidth={0.3}
              />
              <text x={0} y={-3} textAnchor="middle" fontSize={2.4} fill="rgba(255,255,255,0.7)">
                {entry.mediaCount}
              </text>
            </g>
          )
        })}
      </svg>

      {selected && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm font-semibold">{selected.prefecture}の選出局</p>
          <ul className="mt-3 divide-y divide-white/10">
            {selected.entries.map((entry, i) => (
              <li key={i} className="flex items-center justify-between gap-4 py-2 text-sm">
                <div>
                  {entry.targetHref ? (
                    <Link href={entry.targetHref} className="font-medium hover:opacity-70">
                      {entry.targetLabel}
                    </Link>
                  ) : (
                    <span className="font-medium">{entry.targetLabel}</span>
                  )}
                  <p className="text-xs text-white/40">{entry.stationName}</p>
                </div>
                <span className="shrink-0 text-xs text-white/30">{MUSIC_TYPE_LABEL[entry.musicType]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (this component isn't imported anywhere yet, so this only confirms the file itself is syntactically and structurally valid TypeScript/TSX).

- [ ] **Step 3: Commit**

```bash
git add app/components/PrefectureMap.tsx
git commit -m "Add PrefectureMap client component"
```

---

### Task 3: Wire the map into `/media/on-air`

**Files:**
- Modify: `app/media/on-air/page.tsx`

**Interfaces:**
- Consumes: `PrefectureMap`, `PrefectureMapData`, `PrefectureEntry` from `app/components/PrefectureMap.tsx` (Task 2). Reuses the existing local `firstOf` helper already defined in this file.
- Produces: nothing new consumed by later tasks — this is the integration point.

- [ ] **Step 1: Add the import**

In `app/media/on-air/page.tsx`, after the existing imports (after line 3, `import { formatDate } from '@/utils/format'`), add:

```ts
import PrefectureMap, { type PrefectureMapData } from '@/app/components/PrefectureMap'
```

- [ ] **Step 2: Extend the `monthRows` query to fetch prefecture data**

Find this block (currently lines 84–94):

```ts
  // 今月のパワープレイ&ヘビロテ ランキング(局横断・選出局数順)。フィルターに関わらず月全体を集計
  const { data: monthRows } = await supabase
    .from('radio_rotation')
    .select(
      `track_id, album_id, artist_id, music_type,
       media_program:media_program_id(media_id),
       track:track_id(id, title, artist:artist_id(name)),
       album:album_id(id, title, artist:artist_id(name)),
       artist:artist_id(id, name)`
    )
    .gte('period_start_date', monthStart)
    .lt('period_start_date', monthEnd)
```

Replace the `media_program:media_program_id(media_id)` line so the embedded `media` relation also comes along:

```ts
  // 今月のパワープレイ&ヘビロテ ランキング(局横断・選出局数順)。フィルターに関わらず月全体を集計
  const { data: monthRows } = await supabase
    .from('radio_rotation')
    .select(
      `track_id, album_id, artist_id, music_type,
       media_program:media_program_id(media_id, media:media_id(name, prefecture)),
       track:track_id(id, title, artist:artist_id(name)),
       album:album_id(id, title, artist:artist_id(name)),
       artist:artist_id(id, name)`
    )
    .gte('period_start_date', monthStart)
    .lt('period_start_date', monthEnd)
```

- [ ] **Step 3: Build the prefecture aggregation**

Find the ranking aggregation block that ends with:

```ts
  const ranking = Array.from(rankingMap.values())
    .sort((a, b) => b.mediaIds.size - a.mediaIds.size)
    .slice(0, 20)
```

Immediately after it (still before the `return (`), add a second aggregation pass over the same `monthRows` for the prefecture map:

```ts
  type PrefectureAgg = {
    prefecture: string
    mediaIds: Set<string>
    entries: PrefectureMapData['entries']
  }
  const prefMap = new Map<string, PrefectureAgg>()
  for (const row of monthRows ?? []) {
    const program = firstOf(row.media_program)
    const media = program ? firstOf(program.media) : null
    if (!media?.prefecture) continue

    const track = firstOf(row.track)
    const album = firstOf(row.album)
    const artist = firstOf(row.artist)
    const trackArtist = track ? firstOf(track.artist) : null
    const albumArtist = album ? firstOf(album.artist) : null

    const baseLabel = track?.title ?? album?.title ?? artist?.name ?? '—'
    const sub = track ? trackArtist?.name : album ? albumArtist?.name : null
    const targetHref = track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : null

    if (!prefMap.has(media.prefecture)) {
      prefMap.set(media.prefecture, { prefecture: media.prefecture, mediaIds: new Set(), entries: [] })
    }
    const agg = prefMap.get(media.prefecture)!
    if (program?.media_id) agg.mediaIds.add(program.media_id)
    agg.entries.push({
      stationName: media.name,
      targetLabel: sub ? `${baseLabel} — ${sub}` : baseLabel,
      targetHref,
      musicType: row.music_type as 'DOMESTIC' | 'OVERSEAS',
    })
  }
  const prefectureData: PrefectureMapData[] = Array.from(prefMap.values()).map((agg) => ({
    prefecture: agg.prefecture,
    mediaCount: agg.mediaIds.size,
    entries: agg.entries,
  }))
```

- [ ] **Step 4: Render the map**

Find the month-nav closing `</div>` (line 182, immediately followed by the `{ranking.length > 0 && (` block). Insert the map between them:

```tsx
      </div>

      <div className="mt-8">
        <PrefectureMap data={prefectureData} />
      </div>

      {ranking.length > 0 && (
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Start the dev server and verify structurally with curl**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
curl -s http://localhost:3000/media/on-air | grep -oE '大阪府|パワープレイ&ヘビロテ'
```

Expected output includes `パワープレイ&ヘビロテ`. `大阪府` will only appear if the currently-selected month has a rotation entry tied to FM802 — check `tail -30 /tmp/music-synapse-dev.log` for any server errors regardless.

- [ ] **Step 7: Verify the interactive pin with Playwright**

Use the scratchpad directory (already has `playwright` installed from earlier in this project's session; if not, run `npm install playwright --no-save` inside the scratchpad directory first).

```bash
cat > /tmp/verify-prefecture-map.mjs <<'EOF'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:3000/media/on-air')
await page.waitForTimeout(500)

const pinCount = await page.locator('svg circle').count()
console.log('PIN_COUNT:', pinCount)

if (pinCount > 0) {
  await page.locator('svg g').first().click()
  await page.waitForTimeout(300)
  const panelVisible = await page.locator('text=の選出局').count()
  console.log('PANEL_VISIBLE_AFTER_CLICK:', panelVisible)
}

await page.screenshot({ path: '/tmp/prefecture-map-check.png', fullPage: true })
await browser.close()
console.log('done')
EOF
node /tmp/verify-prefecture-map.mjs
```

Expected: `PIN_COUNT` is at least 1 (FM802/大阪府, assuming the currently-selected month has a rotation entry — if `PIN_COUNT` is 0, switch to the month that has the FM802 entry created earlier in this project via the archive `<select>` on the page before re-running), and `PANEL_VISIBLE_AFTER_CLICK` is `1`. View `/tmp/prefecture-map-check.png` to confirm the pin and panel render correctly, then delete it.

- [ ] **Step 8: Commit**

```bash
git add app/media/on-air/page.tsx
git commit -m "Add prefecture pin map to media on-air page"
```

---

### Task 4: Add prefecture field to the "メディアを追加" admin form

**Files:**
- Modify: `app/admin/data/actions.ts`
- Modify: `app/admin/data/page.tsx`

**Interfaces:**
- Consumes: `PREFECTURE_COORDS` from `utils/prefectures.ts` (Task 1).
- Produces: nothing consumed by later tasks (this is the final task in this plan).

- [ ] **Step 1: Update `createMedia` to accept `prefecture`**

In `app/admin/data/actions.ts`, find:

```ts
export async function createMedia(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const mediaType = String(formData.get('media_type') ?? '').trim()
  const area = String(formData.get('area') ?? '').trim()

  if (!name) {
    redirectWith('error', 'メディア名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('media').insert({
    name,
    media_type: mediaType || null,
    area: area || null,
  })
```

Replace with:

```ts
export async function createMedia(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const mediaType = String(formData.get('media_type') ?? '').trim()
  const area = String(formData.get('area') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()

  if (!name) {
    redirectWith('error', 'メディア名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('media').insert({
    name,
    media_type: mediaType || null,
    area: area || null,
    prefecture: prefecture || null,
  })
```

- [ ] **Step 2: Add the prefecture `<select>` to the form**

In `app/admin/data/page.tsx`, add the import at the top (next to the other imports):

```ts
import { PREFECTURE_COORDS } from '@/utils/prefectures'
```

Find the "メディアを追加" form:

```tsx
        <form action={createMedia} className="mt-4 flex flex-wrap gap-2">
          <input name="name" placeholder="メディア名(例: FM802)" required className={`${inputClass} max-w-xs`} />
          <select name="media_type" className={`${inputClass} max-w-[140px]`} defaultValue="">
            <option value="">種別(任意)</option>
            {MEDIA_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input name="area" placeholder="エリア(任意。例: 関西)" className={`${inputClass} max-w-[160px]`} />
          <button type="submit" className={buttonClass}>
            メディアを追加
          </button>
        </form>
```

Replace with (adds a prefecture select before the submit button):

```tsx
        <form action={createMedia} className="mt-4 flex flex-wrap gap-2">
          <input name="name" placeholder="メディア名(例: FM802)" required className={`${inputClass} max-w-xs`} />
          <select name="media_type" className={`${inputClass} max-w-[140px]`} defaultValue="">
            <option value="">種別(任意)</option>
            {MEDIA_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input name="area" placeholder="エリア(任意。例: 関西)" className={`${inputClass} max-w-[160px]`} />
          <select name="prefecture" className={`${inputClass} max-w-[140px]`} defaultValue="">
            <option value="">都道府県(任意)</option>
            {PREFECTURE_COORDS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass}>
            メディアを追加
          </button>
        </form>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify with Playwright**

```bash
cat > /tmp/verify-media-prefecture-form.mjs <<'EOF'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:3000/admin/data')

const mediaForm = 'form:has(input[name="name"][placeholder*="FM802"])'
await page.fill(`${mediaForm} input[name="name"]`, 'プラン検証用テスト局')
await page.selectOption(`${mediaForm} select[name="prefecture"]`, '東京都')
await page.click(`${mediaForm} button[type="submit"]`)
await page.waitForURL(/success=/, { timeout: 10000 })
console.log('AFTER_SUBMIT_URL:', page.url())

await browser.close()
EOF
node /tmp/verify-media-prefecture-form.mjs
```

Expected: `AFTER_SUBMIT_URL` contains a `success=` query param with the message about registering the media.

Then clean up the test row (this project's convention is to remove test data after verifying — see prior sessions' cleanup pattern):

Use the Supabase MCP `execute_sql` tool (or `psql`/dashboard if unavailable) to run:

```sql
delete from media where name = 'プラン検証用テスト局';
```

- [ ] **Step 5: Commit**

```bash
git add app/admin/data/actions.ts app/admin/data/page.tsx
git commit -m "Add prefecture field to media creation form"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit` one more time from the project root — expect zero errors across all four changed/created files.
- [ ] With the dev server running, visit `/media/on-air` in a real browser (or via the Playwright script from Task 3, Step 7) and confirm: the map renders, FM802's pin appears in 大阪府's approximate position, clicking it reveals the station panel with a working link to the pushed track.
- [ ] Visit `/admin/data`, confirm the "メディアを追加" form now has a 都道府県 dropdown with 47 options.
- [ ] Stop the dev server: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`
