# Event Public Pages (List & Detail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public `/events` (list, filterable by type) and `/events/[id]` (detail, with a year switcher and venue/stage-grouped lineup) pages for the `event`/`event_edition`/`event_appearance` tables, including admin support for multi-venue festivals (e.g. SUMMER SONIC Tokyo/Osaka) where the same artist can appear at different venues within the same edition.

**Architecture:** Two new server-component pages under `app/events/`, following the existing `app/media/sync/page.tsx` + `app/media/sync/[id]/page.tsx` list/detail pattern exactly. A small addition to the existing admin `createEventAppearance` action and form to capture a per-appearance `venue`. A one-line change to the home page's stat tiles.

**Tech Stack:** Next.js 16 App Router, React Server Components, Supabase (`@supabase/ssr` read-only client for all new pages; `@supabase/supabase-js` service-role client already used by the admin action), Tailwind CSS v4.

## Global Constraints

- **DB migration already applied** (via Supabase MCP, not part of this plan's tasks): `event_appearance` now has a nullable `venue` (text) column. The old unique index `event_appearance_edition_artist_key (event_edition_id, artist_id)` was replaced with `event_appearance_edition_artist_venue_key` on `(event_edition_id, artist_id, coalesce(venue, ''))`. This means: the same artist can have multiple appearance rows in the same `event_edition` as long as `venue` differs; two rows with the same artist, edition, and venue (including both left blank) are rejected by the DB as a duplicate-key error, which already surfaces through the existing `redirectWith('error', ...)` path in `createEventAppearance`.
- `event.event_type` allows only `festival` / `one_off_live` / `other` (unchanged from the prior plan).
- `event_genre` is out of scope — no reference anywhere.
- No edit/delete UI anywhere in this plan (list/detail pages are read-only; the only write surface touched is the existing admin "出演登録" form gaining one new optional field).
- `music_event` (standalone artist shows) is never shown on `/events` or `/events/[id]` — it has no relation to the `event` table. It stays exclusively on the artist detail page's existing "Live & Festivals" section.
- No full-text search on `/events` — only the `event_type` filter.
- Effective venue for display = `event_appearance.venue ?? event_edition.venue ?? null`. Group appearances by venue (then by stage within each venue) only when the selected edition's appearances resolve to **more than one distinct effective venue**; otherwise group by stage only (no venue heading), to avoid a redundant heading on ordinary single-venue events.
- No automated test suite exists in this project. Verify with `npx tsc --noEmit` and curl/Playwright against a running dev server with real, clearly-labeled test data (`プラン検証用...` prefix), cleaned up afterward and confirmed via a 0-count check.

---

## File Structure

- **Modify** `app/admin/data/actions.ts` — `createEventAppearance` gains a `venue` field.
- **Modify** `app/admin/data/page.tsx` — the "出演登録" form gains a venue input; the query and list display include it.
- **Create** `app/events/page.tsx` — event list, filterable by `event_type`.
- **Create** `app/events/[id]/page.tsx` — event detail: year switcher, venue/stage-grouped lineup.
- **Modify** `app/page.tsx` — the "イベント" stat tile becomes a link to `/events`.

---

### Task 1: Admin support for per-appearance venue

**Files:**
- Modify: `app/admin/data/actions.ts:492-522` (the `createEventAppearance` function)
- Modify: `app/admin/data/page.tsx:152-157` (the `event_appearance` query), `app/admin/data/page.tsx:846-879` (the appearance form and its list display)

**Interfaces:**
- Consumes: nothing new — the DB migration (see Global Constraints) is already applied.
- Produces: `createEventAppearance` now accepts and stores `venue`. Consumed by Task 3's verification (creates test rows with distinct venues) and by the detail page built in Task 3 (reads `event_appearance.venue`).

- [ ] **Step 1: Add `venue` to `createEventAppearance`**

In `app/admin/data/actions.ts`, find:

```ts
export async function createEventAppearance(formData: FormData) {
  const eventEditionId = String(formData.get('event_edition_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const stage = String(formData.get('stage') ?? '').trim()
  const startTime = String(formData.get('start_time') ?? '').trim()
  const endTime = String(formData.get('end_time') ?? '').trim()
  const isHeadliner = formData.get('is_headliner') === 'on'

  if (!eventEditionId || !artistId) {
    redirectWith('error', '開催回とアーティストを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_appearance').insert({
    event_edition_id: eventEditionId,
    artist_id: artistId,
    stage: stage || null,
    // datetime-local からの入力はタイムゾーン情報を持たないため、日本時間として保存する
    start_time: startTime ? `${startTime}:00+09:00` : null,
    end_time: endTime ? `${endTime}:00+09:00` : null,
    is_headliner: isHeadliner,
  })

  if (error) {
    redirectWith('error', `出演情報の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', '出演情報を登録しました。')
}
```

Replace with:

```ts
export async function createEventAppearance(formData: FormData) {
  const eventEditionId = String(formData.get('event_edition_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const stage = String(formData.get('stage') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const startTime = String(formData.get('start_time') ?? '').trim()
  const endTime = String(formData.get('end_time') ?? '').trim()
  const isHeadliner = formData.get('is_headliner') === 'on'

  if (!eventEditionId || !artistId) {
    redirectWith('error', '開催回とアーティストを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_appearance').insert({
    event_edition_id: eventEditionId,
    artist_id: artistId,
    stage: stage || null,
    venue: venue || null,
    // datetime-local からの入力はタイムゾーン情報を持たないため、日本時間として保存する
    start_time: startTime ? `${startTime}:00+09:00` : null,
    end_time: endTime ? `${endTime}:00+09:00` : null,
    is_headliner: isHeadliner,
  })

  if (error) {
    redirectWith('error', `出演情報の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', '出演情報を登録しました。')
}
```

- [ ] **Step 2: Add `venue` to the admin query**

In `app/admin/data/page.tsx`, find:

```ts
    supabase
      .from('event_appearance')
      .select(
        'id, stage, is_headliner, artist:artist_id(name), event_edition:event_edition_id(year, event:event_id(name))'
      )
      .order('id', { ascending: false }),
```

Replace with:

```ts
    supabase
      .from('event_appearance')
      .select(
        'id, stage, venue, is_headliner, artist:artist_id(name), event_edition:event_edition_id(year, event:event_id(name))'
      )
      .order('id', { ascending: false }),
```

- [ ] **Step 3: Add the venue input to the "出演登録" form**

In `app/admin/data/page.tsx`, find:

```tsx
          <span className="text-xs text-white/40">が出演</span>
          <input name="stage" placeholder="ステージ名(任意)" className={`${inputClass} max-w-[160px]`} />
          <input name="start_time" type="datetime-local" className={`${inputClass} max-w-[200px]`} />
```

Replace with:

```tsx
          <span className="text-xs text-white/40">が出演</span>
          <input name="stage" placeholder="ステージ名(任意)" className={`${inputClass} max-w-[160px]`} />
          <input
            name="venue"
            placeholder="会場(任意・複数会場フェスの場合のみ)"
            className={`${inputClass} max-w-[220px]`}
          />
          <input name="start_time" type="datetime-local" className={`${inputClass} max-w-[200px]`} />
```

- [ ] **Step 4: Show venue in the appearance list display**

In `app/admin/data/page.tsx`, find:

```tsx
              return (
                <li key={row.id}>
                  {artist?.name} — {event?.name}({edition?.year})
                  {row.stage ? ` / ${row.stage}` : ''}
                  {row.is_headliner && <span className="text-white/30"> ★ヘッドライナー</span>}
                </li>
              )
```

Replace with:

```tsx
              return (
                <li key={row.id}>
                  {artist?.name} — {event?.name}({edition?.year})
                  {row.stage ? ` / ${row.stage}` : ''}
                  {row.venue ? ` @ ${row.venue}` : ''}
                  {row.is_headliner && <span className="text-white/30"> ★ヘッドライナー</span>}
                </li>
              )
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify with Playwright — multi-venue registration works, same-venue duplicate is rejected**

Start the dev server if not already running:

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
```

Create the script at `/Users/th/dev/music-synapse/verify-venue.mjs` (project directory, not `/tmp`, so `playwright` resolves from `node_modules`):

```js
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()

// 1. Create the test event
await page.goto('http://localhost:3000/admin/data')
const eventForm = 'form:has(input[placeholder*="FUJI ROCK"])'
await page.fill(`${eventForm} input[name="name"]`, 'プラン検証用テストイベント')
await page.selectOption(`${eventForm} select[name="event_type"]`, 'festival')
await page.click(`${eventForm} button[type="submit"]`)
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })

// 2. Create the 2026 edition (venue left blank — venue lives on the appearances)
const editionForm = 'form:has(select[name="event_id"])'
await page.selectOption(`${editionForm} select[name="event_id"]`, { label: 'プラン検証用テストイベント' })
await page.fill(`${editionForm} input[name="year"]`, '2026')
await page.click(`${editionForm} button[type="submit"]`)
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })

const appearanceForm = 'form:has(input[name="is_headliner"])'
const editionLabel = 'プラン検証用テストイベント(2026)'

// 3. Fujii Kaze at 東京会場 — should succeed
await page.selectOption(`${appearanceForm} select[name="event_edition_id"]`, { label: editionLabel })
await page.selectOption(`${appearanceForm} select[name="artist_id"]`, { label: 'Fujii Kaze' })
await page.fill(`${appearanceForm} input[name="stage"]`, 'MAIN STAGE')
await page.fill(`${appearanceForm} input[name="venue"]`, '東京会場')
await page.click(`${appearanceForm} button[type="submit"]`)
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })
console.log('STEP3_OK: Fujii Kaze @ 東京会場 registered')

// 4. Fujii Kaze at 大阪会場 (same artist, different venue) — should succeed
await page.selectOption(`${appearanceForm} select[name="event_edition_id"]`, { label: editionLabel })
await page.selectOption(`${appearanceForm} select[name="artist_id"]`, { label: 'Fujii Kaze' })
await page.fill(`${appearanceForm} input[name="stage"]`, 'MAIN STAGE')
await page.fill(`${appearanceForm} input[name="venue"]`, '大阪会場')
await page.click(`${appearanceForm} button[type="submit"]`)
await page.waitForURL(/\/admin\/data\?(success|error)=/, { timeout: 10000 })
const urlAfterStep4 = page.url()
console.log('STEP4_URL:', urlAfterStep4)
console.log('STEP4_OK (expect success):', urlAfterStep4.includes('success='))

// 5. Fujii Kaze at 東京会場 again (exact duplicate) — should be rejected
await page.selectOption(`${appearanceForm} select[name="event_edition_id"]`, { label: editionLabel })
await page.selectOption(`${appearanceForm} select[name="artist_id"]`, { label: 'Fujii Kaze' })
await page.fill(`${appearanceForm} input[name="stage"]`, 'MAIN STAGE')
await page.fill(`${appearanceForm} input[name="venue"]`, '東京会場')
await page.click(`${appearanceForm} button[type="submit"]`)
await page.waitForURL(/\/admin\/data\?(success|error)=/, { timeout: 10000 })
const urlAfterStep5 = page.url()
console.log('STEP5_URL:', urlAfterStep5)
console.log('STEP5_OK (expect error, duplicate rejected):', urlAfterStep5.includes('error='))

// 6. Kenshi Yonezu at 大阪会場 — should succeed
await page.selectOption(`${appearanceForm} select[name="event_edition_id"]`, { label: editionLabel })
await page.selectOption(`${appearanceForm} select[name="artist_id"]`, { label: 'Kenshi Yonezu' })
await page.fill(`${appearanceForm} input[name="stage"]`, 'MAIN STAGE')
await page.fill(`${appearanceForm} input[name="venue"]`, '大阪会場')
await page.click(`${appearanceForm} button[type="submit"]`)
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })
console.log('STEP6_OK: Kenshi Yonezu @ 大阪会場 registered')

await browser.close()
```

```bash
node verify-venue.mjs
rm verify-venue.mjs
```

Expected: `STEP3_OK`, `STEP4_OK (expect success): true`, `STEP5_OK (expect error, duplicate rejected): true`, `STEP6_OK` all print as shown.

Then confirm the row count and venues directly via the Supabase admin client (or Supabase MCP `execute_sql` if available in your environment):

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: event } = await supabase.from('event').select('id').eq('name', 'プラン検証用テストイベント').single();
  const { data: edition } = await supabase.from('event_edition').select('id').eq('event_id', event.id).eq('year', 2026).single();
  const { data: rows } = await supabase.from('event_appearance').select('artist_id, venue, stage').eq('event_edition_id', edition.id);
  console.log('APPEARANCE_ROW_COUNT:', rows.length);
  console.log(JSON.stringify(rows, null, 2));
})();
"
```

Expected: `APPEARANCE_ROW_COUNT: 3` (Fujii Kaze × 2 venues + Kenshi Yonezu × 1 venue — the duplicate attempt in step 5 must NOT have created a 4th row).

**Leave this test data in place** — Task 3 builds directly on it (adds a second edition and verifies the public detail page), and Task 3's own final step cleans up everything.

- [ ] **Step 7: Commit**

```bash
git add app/admin/data/actions.ts app/admin/data/page.tsx
git commit -m "Support per-appearance venue for multi-venue festivals (admin)"
```

---

### Task 2: Event list page

**Files:**
- Create: `app/events/page.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 (reads `event` table only, unaffected by the venue change).
- Produces: nothing consumed by later tasks — Task 3's detail page is a separate route reached by links from this page, not a code dependency.

- [ ] **Step 1: Create the list page**

Create `app/events/page.tsx`:

```tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  other: 'その他',
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ event_type?: string }>
}) {
  const { event_type: eventType } = await searchParams
  const supabase = await createClient()

  let query = supabase.from('event').select('id, name, event_type, founded_year').order('name')

  if (eventType) query = query.eq('event_type', eventType)

  const { data: events } = await query

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold">イベント</h1>
      <p className="mt-2 text-sm text-white/50">フェス・単発イベントの開催情報。</p>

      <form className="mt-6 flex flex-wrap gap-2" action="/events">
        <select
          name="event_type"
          defaultValue={eventType ?? ''}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          <option value="">種別: すべて</option>
          {Object.entries(EVENT_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85"
        >
          絞り込み
        </button>
      </form>

      {!events || events.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">該当するイベントが登録されていません。</p>
      ) : (
        <ul className="mt-8 divide-y divide-white/10">
          {events.map((e) => (
            <li key={e.id} className="py-3">
              <Link href={`/events/${e.id}`} className="font-medium hover:opacity-70">
                {e.name}
              </Link>
              <p className="mt-0.5 text-xs text-white/40">
                {e.event_type ? EVENT_TYPE_LABEL[e.event_type] ?? e.event_type : ''}
                {e.founded_year ? ` · ${e.founded_year}年〜` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify with curl**

Ensure the dev server is running (same startup snippet as Task 1 Step 6 if it isn't).

```bash
curl -s http://localhost:3000/events | grep -oE 'イベント|種別: すべて|プラン検証用テストイベント'
```

Expected: all three strings appear (page renders, filter select renders, Task 1's test event — still in the DB at this point — appears in the unfiltered list).

```bash
curl -s "http://localhost:3000/events?event_type=festival" | grep -c 'プラン検証用テストイベント'
curl -s "http://localhost:3000/events?event_type=one_off_live" | grep -c 'プラン検証用テストイベント'
```

Expected: first command prints `1` (test event is `festival` type, matches filter), second prints `0` (filtered out under a different type).

- [ ] **Step 4: Commit**

```bash
git add app/events/page.tsx
git commit -m "Add /events list page with event_type filter"
```

---

### Task 3: Event detail page

**Files:**
- Create: `app/events/[id]/page.tsx`

**Interfaces:**
- Consumes: `event_appearance.venue` (Task 1). Reads the test data Task 1 created (`プラン検証用テストイベント`, 2026 edition, 3 appearance rows).
- Produces: nothing consumed by later tasks — this is the last route added in this plan.

- [ ] **Step 1: Create the detail page**

Create `app/events/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate } from '@/utils/format'

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  other: 'その他',
}

type Appearance = {
  id: number
  stage: string | null
  venue: string | null
  isHeadliner: boolean
  artistId: string
  artistName: string
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ year?: string }>
}) {
  const { id } = await params
  const { year: yearParam } = await searchParams
  const supabase = await createClient()

  const { data: event, error } = await supabase
    .from('event')
    .select('id, name, event_type, founded_year, country, prefecture, description')
    .eq('id', id)
    .single()

  if (error || !event) {
    notFound()
  }

  const { data: editions } = await supabase
    .from('event_edition')
    .select('id, year, start_date, end_date, venue, description')
    .eq('event_id', id)
    .order('year', { ascending: false })

  const editionList = editions ?? []
  const requestedYear = yearParam ? Number(yearParam) : null
  const selectedEdition =
    (requestedYear ? editionList.find((ed) => ed.year === requestedYear) : null) ?? editionList[0] ?? null

  let appearances: Appearance[] = []

  if (selectedEdition) {
    const { data: appearanceRows } = await supabase
      .from('event_appearance')
      .select('id, stage, venue, is_headliner, artist:artist_id(id, name)')
      .eq('event_edition_id', selectedEdition.id)

    appearances = (appearanceRows ?? []).map((row) => {
      const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
      return {
        id: row.id,
        stage: row.stage,
        venue: row.venue ?? selectedEdition.venue ?? null,
        isHeadliner: row.is_headliner,
        artistId: artist?.id ?? '',
        artistName: artist?.name ?? '?',
      }
    })
  }

  const distinctVenues = new Set(appearances.map((a) => a.venue ?? ''))
  const groupByVenue = distinctVenues.size > 1

  const venueGroups = new Map<string, Appearance[]>()
  for (const a of appearances) {
    const venueKey = groupByVenue ? a.venue ?? 'その他' : '__all__'
    if (!venueGroups.has(venueKey)) venueGroups.set(venueKey, [])
    venueGroups.get(venueKey)!.push(a)
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント一覧
      </Link>

      <p className="mt-4 text-xs text-white/40">
        {event.event_type ? EVENT_TYPE_LABEL[event.event_type] ?? event.event_type : ''}
        {event.founded_year ? ` · ${event.founded_year}年〜` : ''}
      </p>
      <h1 className="mt-1 text-2xl font-bold">{event.name}</h1>
      {(event.country || event.prefecture) && (
        <p className="mt-1 text-sm text-white/50">
          {[event.country, event.prefecture].filter(Boolean).join(' / ')}
        </p>
      )}
      {event.description && <p className="mt-3 text-sm leading-relaxed text-white/70">{event.description}</p>}

      {editionList.length === 0 || !selectedEdition ? (
        <p className="mt-10 text-sm text-white/40">まだ開催情報が登録されていません。</p>
      ) : (
        <>
          <div className="mt-8 flex flex-wrap gap-2">
            {editionList.map((ed) => (
              <Link
                key={ed.id}
                href={`/events/${id}?year=${ed.year}`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  ed.year === selectedEdition.year
                    ? 'border-white bg-white text-black'
                    : 'border-white/15 text-white/60 hover:border-white/30'
                }`}
              >
                {ed.year}
              </Link>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm text-white/70">
              {selectedEdition.venue ?? '会場未定'}
              {selectedEdition.start_date &&
                ` ・ ${formatDate(selectedEdition.start_date)}${
                  selectedEdition.end_date && selectedEdition.end_date !== selectedEdition.start_date
                    ? `〜${formatDate(selectedEdition.end_date)}`
                    : ''
                }`}
            </p>
            {selectedEdition.description && (
              <p className="mt-2 text-xs text-white/50">{selectedEdition.description}</p>
            )}
          </div>

          {appearances.length === 0 ? (
            <p className="mt-8 text-sm text-white/40">まだ出演アーティストが登録されていません。</p>
          ) : (
            <div className="mt-8 space-y-6">
              {Array.from(venueGroups.entries()).map(([venueKey, rows]) => {
                const stageGroups = new Map<string, Appearance[]>()
                for (const row of rows) {
                  const stageKey = row.stage ?? 'その他'
                  if (!stageGroups.has(stageKey)) stageGroups.set(stageKey, [])
                  stageGroups.get(stageKey)!.push(row)
                }
                return (
                  <div key={venueKey}>
                    {groupByVenue && <h2 className="text-sm font-semibold text-white/80">{venueKey}</h2>}
                    <div className={groupByVenue ? 'mt-3 space-y-4 border-l border-white/10 pl-4' : 'space-y-4'}>
                      {Array.from(stageGroups.entries()).map(([stageKey, stageRows]) => (
                        <div key={stageKey}>
                          <h3 className="text-xs font-medium uppercase tracking-wide text-white/40">{stageKey}</h3>
                          <ul className="mt-2 space-y-1 text-sm">
                            {stageRows.map((a) => (
                              <li key={a.id}>
                                <Link href={`/artists/${a.artistId}`} className="hover:opacity-70">
                                  {a.artistName}
                                </Link>
                                {a.isHeadliner && <span className="text-white/30"> ★ヘッドライナー</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add a second edition to Task 1's test event, to exercise the year switcher and the single-venue (no heading) path**

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: event } = await supabase.from('event').select('id').eq('name', 'プラン検証用テストイベント').single();
  const { data: fujii } = await supabase.from('artist').select('id').eq('name', 'Fujii Kaze').single();
  const { data: edition, error: editionError } = await supabase
    .from('event_edition')
    .insert({ event_id: event.id, year: 2025, venue: '日本武道館' })
    .select('id')
    .single();
  if (editionError) { console.error('EDITION_INSERT_FAILED', editionError.message); process.exit(1); }
  const { error: appearanceError } = await supabase
    .from('event_appearance')
    .insert({ event_edition_id: edition.id, artist_id: fujii.id, stage: 'メインアリーナ', is_headliner: true });
  if (appearanceError) { console.error('APPEARANCE_INSERT_FAILED', appearanceError.message); process.exit(1); }
  console.log('SECOND_EDITION_OK');
})();
"
```

Expected: `SECOND_EDITION_OK` prints. This 2025 edition has a single appearance with no per-appearance `venue` set, so its effective venue is the edition's own `venue` ("日本武道館") for every row — exactly one distinct venue, which must NOT produce a venue heading on the detail page.

- [ ] **Step 4: Verify with Playwright**

Create `/Users/th/dev/music-synapse/verify-event-detail.mjs`:

```js
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()

// Look up the test event's id from the list page
await page.goto('http://localhost:3000/events')
const href = await page.getAttribute('a:has-text("プラン検証用テストイベント")', 'href')
console.log('EVENT_HREF:', href)

// Default view = latest edition = 2026, multi-venue
await page.goto(`http://localhost:3000${href}`)
let body = await page.textContent('body')
console.log('YEAR_2026_PRESENT:', body.includes('2026'))
console.log('YEAR_2025_PRESENT:', body.includes('2025'))
console.log('VENUE_TOKYO_HEADING:', body.includes('東京会場'))
console.log('VENUE_OSAKA_HEADING:', body.includes('大阪会場'))
console.log('STAGE_HEADING:', body.includes('MAIN STAGE'))
console.log('FUJII_LINK_PRESENT:', body.includes('Fujii Kaze'))
console.log('YONEZU_LINK_PRESENT:', body.includes('Kenshi Yonezu'))
console.log('HEADLINER_MARK_ABSENT_ON_2026:', !body.includes('★ヘッドライナー'))

// Switch to 2025 via the year pill — single venue, no venue heading expected
await page.click('a:has-text("2025")')
await page.waitForURL(/[?&]year=2025/)
body = await page.textContent('body')
console.log('2025_VENUE_HEADING_ABSENT:', !body.includes('東京会場') && !body.includes('大阪会場'))
console.log('2025_BUDOKAN_PRESENT:', body.includes('日本武道館'))
console.log('2025_STAGE_HEADING:', body.includes('メインアリーナ'))
console.log('2025_HEADLINER_MARK_PRESENT:', body.includes('★ヘッドライナー'))

await browser.close()
```

```bash
node verify-event-detail.mjs
rm verify-event-detail.mjs
```

Expected: every logged line is `true` (except `EVENT_HREF`/`YEAR_HREF`, which just print the URL).

- [ ] **Step 5: Verify both empty-state paths (no editions at all, and an edition with zero appearances)**

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: noEditionEvent, error: e1 } = await supabase
    .from('event')
    .insert({ name: 'プラン検証用テストイベント(開催情報なし)', event_type: 'other' })
    .select('id')
    .single();
  if (e1) { console.error('INSERT_FAILED', e1.message); process.exit(1); }
  console.log('NO_EDITION_EVENT_ID:', noEditionEvent.id);

  const { data: noAppearanceEvent, error: e2 } = await supabase
    .from('event')
    .insert({ name: 'プラン検証用テストイベント(出演者なし)', event_type: 'other' })
    .select('id')
    .single();
  if (e2) { console.error('INSERT_FAILED', e2.message); process.exit(1); }
  const { error: e3 } = await supabase
    .from('event_edition')
    .insert({ event_id: noAppearanceEvent.id, year: 2024 });
  if (e3) { console.error('EDITION_INSERT_FAILED', e3.message); process.exit(1); }
  console.log('NO_APPEARANCE_EVENT_ID:', noAppearanceEvent.id);
})();
"
```

Take the printed `NO_EDITION_EVENT_ID` and `NO_APPEARANCE_EVENT_ID` and:

```bash
curl -s http://localhost:3000/events/<NO_EDITION_EVENT_ID> | grep -oE 'まだ開催情報が登録されていません。'
curl -s http://localhost:3000/events/<NO_APPEARANCE_EVENT_ID> | grep -oE 'まだ出演アーティストが登録されていません。'
```

Expected: each command prints its respective message exactly once.

- [ ] **Step 6: Clean up all test data from this plan**

Delete everything created in Task 1 Step 6, Task 3 Step 3, and Task 3 Step 5, child rows before parents:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: events } = await supabase.from('event').select('id').like('name', 'プラン検証用%');
  for (const ev of events ?? []) {
    const { data: editions } = await supabase.from('event_edition').select('id').eq('event_id', ev.id);
    for (const ed of editions ?? []) {
      await supabase.from('event_appearance').delete().eq('event_edition_id', ed.id);
    }
    await supabase.from('event_edition').delete().eq('event_id', ev.id);
    await supabase.from('event').delete().eq('id', ev.id);
  }
  console.log('CLEANED_UP');
})();
"
```

Expected: `CLEANED_UP` prints. Confirm via a follow-up count:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  for (const t of ['event', 'event_edition', 'event_appearance', 'music_event']) {
    const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
    console.log(t, count);
  }
})();
"
```

Expected: all four print `0`.

- [ ] **Step 7: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 8: Commit**

```bash
git add "app/events/[id]/page.tsx"
git commit -m "Add /events/[id] detail page with year switcher and venue/stage grouping"
```

---

### Task 4: Link the home page's event stat tile to /events

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by later tasks — this is the final task in this plan.

- [ ] **Step 1: Add an optional `href` to `STAT_ITEMS` and link the event tile**

Find:

```tsx
const STAT_ITEMS: { key: 'artist' | 'album' | 'track' | 'event' | 'discGuide'; label: string }[] = [
  { key: 'artist', label: 'アーティスト' },
  { key: 'album', label: 'アルバム' },
  { key: 'track', label: 'トラック' },
  { key: 'event', label: 'イベント' },
  { key: 'discGuide', label: 'ディスクガイド' },
]
```

Replace with:

```tsx
const STAT_ITEMS: { key: 'artist' | 'album' | 'track' | 'event' | 'discGuide'; label: string; href?: string }[] = [
  { key: 'artist', label: 'アーティスト' },
  { key: 'album', label: 'アルバム' },
  { key: 'track', label: 'トラック' },
  { key: 'event', label: 'イベント', href: '/events' },
  { key: 'discGuide', label: 'ディスクガイド' },
]
```

Find:

```tsx
      <section className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {STAT_ITEMS.map((item) => (
          <div
            key={item.key}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-5 text-center"
          >
            <p className="text-2xl font-bold">{stats[item.key].toLocaleString()}</p>
            <p className="mt-1 text-xs text-white/50">{item.label}</p>
          </div>
        ))}
      </section>
```

Replace with:

```tsx
      <section className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {STAT_ITEMS.map((item) => {
          const tileClass = 'rounded-lg border border-white/10 bg-white/[0.03] px-4 py-5 text-center'
          const tileContent = (
            <>
              <p className="text-2xl font-bold">{stats[item.key].toLocaleString()}</p>
              <p className="mt-1 text-xs text-white/50">{item.label}</p>
            </>
          )
          return item.href ? (
            <Link key={item.key} href={item.href} className={`${tileClass} transition hover:border-white/25`}>
              {tileContent}
            </Link>
          ) : (
            <div key={item.key} className={tileClass}>
              {tileContent}
            </div>
          )
        })}
      </section>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify with curl**

```bash
curl -s http://localhost:3000/ | grep -oE 'href="/events"'
```

Expected: `href="/events"` appears at least once.

- [ ] **Step 4: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "Link home page event stat tile to /events"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit` once more from the project root — expect zero errors across all changed files.
- [ ] With the dev server running, visit `/events`, confirm the type filter works.
- [ ] Visit an event with multiple venues in one edition — confirm the "会場 → ステージ" 2-level grouping and the year switcher both work.
- [ ] Visit an event with a single venue — confirm no venue heading appears (stage-only grouping).
- [ ] Confirm `event` / `event_edition` / `event_appearance` / `music_event` are all back to 0 rows (Task 3 Step 6 already verified this, but re-check if any later step's data was left behind).
- [ ] Confirm the home page's "イベント" tile links to `/events`.
- [ ] Stop the dev server: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`
