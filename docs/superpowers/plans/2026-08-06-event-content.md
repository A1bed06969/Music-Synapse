# Event Content (Live Shows & Festival Appearances) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin registration forms for the existing-but-unused `event`/`event_edition`/`event_appearance`/`music_event` tables, and a "Live & Festivals" section on the artist detail page that displays this artist's standalone live shows and festival appearance history.

**Architecture:** Four new server actions in the existing `app/admin/data/actions.ts`, one new "イベント" section in `app/admin/data/page.tsx` with four forms following the exact pattern of every other section on that page, and a new section in `app/artists/[id]/page.tsx` (reusing the existing `SectionDivider` helper) with two side-by-side cards fed by two new queries.

**Tech Stack:** Next.js 16 App Router, React Server Components + Server Actions, Supabase (`@supabase/ssr` for reads, `@supabase/supabase-js` service-role client for writes), Tailwind CSS v4.

## Global Constraints

- `event.event_type` has a DB CHECK constraint allowing only `festival` / `one_off_live` / `other` (confirmed via `pg_constraint`). The admin form's `<select>` must offer exactly these three values.
- Foreign keys: `event_edition.event_id → event.id`, `event_appearance.event_edition_id → event_edition.id`, `event_appearance.artist_id → artist.id`, `music_event.artist_id → artist.id` (confirmed via `information_schema`).
- `event_genre` is out of scope this plan — no form, no query, no reference to it anywhere.
- No edit/delete UI for any of the four tables — registration only, matching every other section on `/admin/data`.
- No standalone `/events` public pages — the only public-facing surface is the new section on `/artists/[id]`.
- The "Live & Festivals" section on the artist detail page must always render (unlike Biography, which hides entirely when empty) — each of its two cards independently shows its own "まだ...がありません。" message when empty, matching the Discography/Relation Graph convention already used on that page.
- No automated test suite exists in this project (confirmed convention). Verify with `npx tsc --noEmit` and curl/Playwright against a running dev server with real data — test rows created for verification must be clearly labeled and cleaned up afterward, per this project's established convention.

---

## File Structure

- **Modify** `app/admin/data/actions.ts` — add `createEvent`, `createEventEdition`, `createEventAppearance`, `createMusicEvent`.
- **Modify** `app/admin/data/page.tsx` — add an "イベント" section with four forms and their list displays.
- **Modify** `app/artists/[id]/page.tsx` — add a "Live & Festivals" section between Biography and Discography.

---

### Task 1: `createEvent` and `createEventEdition` server actions

**Files:**
- Modify: `app/admin/data/actions.ts`

**Interfaces:**
- Consumes: nothing new (uses the existing `createAdminClient`, `redirectWith` helpers already in this file).
- Produces: `export async function createEvent(formData: FormData)` and `export async function createEventEdition(formData: FormData)`. Consumed by Task 3's `<form action={createEvent}>` / `<form action={createEventEdition}>`.

- [ ] **Step 1: Append the two actions**

Append to the end of `app/admin/data/actions.ts` (after the existing `updateArtist` function):

```ts

export async function createEvent(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const eventType = String(formData.get('event_type') ?? '').trim()
  const foundedYearRaw = String(formData.get('founded_year') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!name) {
    redirectWith('error', 'イベント名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event').insert({
    name,
    event_type: eventType || null,
    founded_year: foundedYearRaw ? Number(foundedYearRaw) : null,
    country: country || null,
    prefecture: prefecture || null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `イベントの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  redirectWith('success', `イベント「${name}」を登録しました。`)
}

export async function createEventEdition(formData: FormData) {
  const eventId = String(formData.get('event_id') ?? '')
  const yearRaw = String(formData.get('year') ?? '').trim()
  const startDate = String(formData.get('start_date') ?? '').trim()
  const endDate = String(formData.get('end_date') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!eventId || !yearRaw) {
    redirectWith('error', 'イベントと年を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_edition').insert({
    event_id: eventId,
    year: Number(yearRaw),
    start_date: startDate || null,
    end_date: endDate || null,
    venue: venue || null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `開催回の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  redirectWith('success', '開催回を登録しました。')
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/data/actions.ts
git commit -m "Add createEvent and createEventEdition server actions"
```

(These actions aren't reachable from any UI yet — Task 3 wires them up. Nothing to curl-verify here beyond the type-check.)

---

### Task 2: `createEventAppearance` and `createMusicEvent` server actions

**Files:**
- Modify: `app/admin/data/actions.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export async function createEventAppearance(formData: FormData)` and `export async function createMusicEvent(formData: FormData)`. Consumed by Task 3's forms and by Task 4 (the rows these write are what the artist page reads).

- [ ] **Step 1: Append the two actions**

Append to the end of `app/admin/data/actions.ts` (after `createEventEdition` from Task 1):

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
    start_time: startTime || null,
    end_time: endTime || null,
    is_headliner: isHeadliner,
  })

  if (error) {
    redirectWith('error', `出演情報の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', '出演情報を登録しました。')
}

export async function createMusicEvent(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const eventDate = String(formData.get('event_date') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!artistId || !name) {
    redirectWith('error', 'アーティストと公演名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('music_event').insert({
    artist_id: artistId,
    name,
    event_date: eventDate || null,
    venue: venue || null,
    prefecture: prefecture || null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `単独公演の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', `単独公演「${name}」を登録しました。`)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/data/actions.ts
git commit -m "Add createEventAppearance and createMusicEvent server actions"
```

---

### Task 3: Admin UI — "イベント" section

**Files:**
- Modify: `app/admin/data/page.tsx`

**Interfaces:**
- Consumes: `createEvent`, `createEventEdition` (Task 1), `createEventAppearance`, `createMusicEvent` (Task 2). Reuses the existing `artistOptions`, `inputClass`, `buttonClass`.
- Produces: nothing consumed by later tasks — this is a self-contained UI addition.

- [ ] **Step 1: Import the four new actions**

Find:

```ts
import {
  createGenre,
  linkArtistGenre,
  createRelation,
  createLabel,
  linkArtistLabel,
  linkAlbumLabel,
  createMedia,
  createMediaProgram,
  createRadioRotation,
  createRanking,
  createRankingEntry,
  createSyncWork,
  createSyncEntry,
} from './actions'
```

Replace with:

```ts
import {
  createGenre,
  linkArtistGenre,
  createRelation,
  createLabel,
  linkArtistLabel,
  linkAlbumLabel,
  createMedia,
  createMediaProgram,
  createRadioRotation,
  createRanking,
  createRankingEntry,
  createSyncWork,
  createSyncEntry,
  createEvent,
  createEventEdition,
  createEventAppearance,
  createMusicEvent,
} from './actions'
```

- [ ] **Step 2: Add the event-type options and label map**

Find:

```ts
const WORK_TYPE_OPTIONS = [
  { value: 'cm', label: 'CM' },
  { value: 'anime', label: 'アニメ' },
  { value: 'game', label: 'ゲーム' },
  { value: 'movie', label: '映画' },
  { value: 'tv_program', label: 'テレビ番組' },
]
```

Add immediately after it:

```ts

const EVENT_TYPE_OPTIONS = [
  { value: 'festival', label: 'フェス' },
  { value: 'one_off_live', label: '単発イベント' },
  { value: 'other', label: 'その他' },
]

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  other: 'その他',
}
```

- [ ] **Step 3: Add the four new queries**

Find:

```ts
    supabase.from('sync_work').select('id, title, work_type, year').order('title'),
    supabase
      .from('sync_entry')
      .select('id, usage_detail, sync_work:sync_work_id(title), track:track_id(title)')
      .order('id', { ascending: false }),
  ])
```

Replace with:

```ts
    supabase.from('sync_work').select('id, title, work_type, year').order('title'),
    supabase
      .from('sync_entry')
      .select('id, usage_detail, sync_work:sync_work_id(title), track:track_id(title)')
      .order('id', { ascending: false }),
    supabase.from('event').select('id, name, event_type').order('name'),
    supabase
      .from('event_edition')
      .select('id, year, event:event_id(name)')
      .order('year', { ascending: false }),
    supabase
      .from('event_appearance')
      .select(
        'id, stage, is_headliner, artist:artist_id(name), event_edition:event_edition_id(year, event:event_id(name))'
      )
      .order('id', { ascending: false }),
    supabase
      .from('music_event')
      .select('id, name, event_date, artist:artist_id(name)')
      .order('id', { ascending: false }),
  ])
```

- [ ] **Step 4: Destructure the new query results and build option lists**

Find:

```ts
  const [
    { data: artists },
    { data: genres },
    { data: labels },
    { data: albums },
    { data: tracks },
    { data: mediaList },
    { data: mediaPrograms },
    { data: artistGenres },
    { data: relations },
    { data: artistLabels },
    { data: albumLabels },
    { data: rotations },
    { data: rankings },
    { data: rankingEntries },
    { data: syncWorks },
    { data: syncEntries },
  ] = await Promise.all([
```

Replace with:

```ts
  const [
    { data: artists },
    { data: genres },
    { data: labels },
    { data: albums },
    { data: tracks },
    { data: mediaList },
    { data: mediaPrograms },
    { data: artistGenres },
    { data: relations },
    { data: artistLabels },
    { data: albumLabels },
    { data: rotations },
    { data: rankings },
    { data: rankingEntries },
    { data: syncWorks },
    { data: syncEntries },
    { data: events },
    { data: eventEditions },
    { data: eventAppearances },
    { data: musicEvents },
  ] = await Promise.all([
```

- [ ] **Step 5: Add derived option lists**

Find:

```ts
  const rankingOptions = rankings ?? []
  const syncWorkOptions = syncWorks ?? []
```

Replace with:

```ts
  const rankingOptions = rankings ?? []
  const syncWorkOptions = syncWorks ?? []
  const eventOptions = events ?? []
  const eventEditionOptions = (eventEditions ?? []).map((row) => {
    const event = Array.isArray(row.event) ? row.event[0] : row.event
    return { id: row.id, label: `${event?.name ?? '?'}(${row.year})` }
  })
```

- [ ] **Step 6: Add the "イベント" section**

Find the end of the file:

```tsx
        {syncEntries && syncEntries.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {syncEntries.map((row) => {
              const work = Array.isArray(row.sync_work) ? row.sync_work[0] : row.sync_work
              const track = Array.isArray(row.track) ? row.track[0] : row.track
              return (
                <li key={row.id}>
                  {work?.title} — {track?.title}
                  {row.usage_detail ? `(${row.usage_detail})` : ''}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
```

Replace with:

```tsx
        {syncEntries && syncEntries.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {syncEntries.map((row) => {
              const work = Array.isArray(row.sync_work) ? row.sync_work[0] : row.sync_work
              const track = Array.isArray(row.track) ? row.track[0] : row.track
              return (
                <li key={row.id}>
                  {work?.title} — {track?.title}
                  {row.usage_detail ? `(${row.usage_detail})` : ''}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* イベント */}
      <section className="mt-10 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold">イベント</h2>

        <form action={createEvent} className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input name="name" placeholder="イベント名(例: FUJI ROCK FESTIVAL)" required className={`${inputClass} max-w-xs`} />
            <select name="event_type" className={`${inputClass} max-w-[140px]`} defaultValue="">
              <option value="">種別(任意)</option>
              {EVENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <input name="founded_year" type="number" placeholder="発祥年(任意)" className={`${inputClass} max-w-[140px]`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <input name="country" placeholder="国(任意)" className={`${inputClass} max-w-[160px]`} />
            <input name="prefecture" placeholder="都道府県(任意)" className={`${inputClass} max-w-[160px]`} />
          </div>
          <input name="description" placeholder="概要(任意)" className={inputClass} />
          <button type="submit" className={buttonClass}>
            イベントを追加
          </button>
        </form>

        {events && events.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {events.map((e) => (
              <li key={e.id}>
                {e.name}
                {e.event_type && (
                  <span className="text-white/30"> ({EVENT_TYPE_LABEL[e.event_type] ?? e.event_type})</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <form action={createEventEdition} className="mt-6 flex flex-wrap gap-2">
          <select name="event_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              イベントを選択
            </option>
            {eventOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <input name="year" type="number" placeholder="年" required className={`${inputClass} max-w-[100px]`} />
          <input name="start_date" type="date" className={`${inputClass} max-w-[160px]`} />
          <input name="end_date" type="date" className={`${inputClass} max-w-[160px]`} />
          <input name="venue" placeholder="会場(任意)" className={`${inputClass} max-w-xs`} />
          <button type="submit" className={buttonClass}>
            開催回を追加
          </button>
        </form>

        {eventEditions && eventEditions.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {eventEditions.map((row) => {
              const event = Array.isArray(row.event) ? row.event[0] : row.event
              return (
                <li key={row.id}>
                  {event?.name}({row.year})
                </li>
              )
            })}
          </ul>
        )}

        <form action={createEventAppearance} className="mt-6 flex flex-wrap items-center gap-2">
          <select name="event_edition_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              開催回を選択
            </option>
            {eventEditionOptions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/40">に</span>
          <select name="artist_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              アーティストを選択
            </option>
            {artistOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/40">が出演</span>
          <input name="stage" placeholder="ステージ名(任意)" className={`${inputClass} max-w-[160px]`} />
          <input name="start_time" type="datetime-local" className={`${inputClass} max-w-[200px]`} />
          <input name="end_time" type="datetime-local" className={`${inputClass} max-w-[200px]`} />
          <label className="flex items-center gap-1.5 text-xs text-white/60">
            <input name="is_headliner" type="checkbox" className="h-3.5 w-3.5" />
            ヘッドライナー
          </label>
          <button type="submit" className={buttonClass}>
            出演情報を追加
          </button>
        </form>

        {eventAppearances && eventAppearances.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {eventAppearances.map((row) => {
              const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
              const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
              const event = edition ? (Array.isArray(edition.event) ? edition.event[0] : edition.event) : null
              return (
                <li key={row.id}>
                  {artist?.name} — {event?.name}({edition?.year})
                  {row.stage ? ` / ${row.stage}` : ''}
                  {row.is_headliner && <span className="text-white/30"> ★ヘッドライナー</span>}
                </li>
              )
            })}
          </ul>
        )}

        <form action={createMusicEvent} className="mt-6 flex flex-wrap gap-2">
          <select name="artist_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              アーティストを選択
            </option>
            {artistOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input name="name" placeholder="公演名(例: ○○ホール ワンマンライブ)" required className={`${inputClass} max-w-xs`} />
          <input name="event_date" type="date" className={`${inputClass} max-w-[160px]`} />
          <input name="venue" placeholder="会場(任意)" className={`${inputClass} max-w-xs`} />
          <input name="prefecture" placeholder="都道府県(任意)" className={`${inputClass} max-w-[160px]`} />
          <button type="submit" className={buttonClass}>
            単独公演を追加
          </button>
        </form>

        {musicEvents && musicEvents.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {musicEvents.map((row) => {
              const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
              return (
                <li key={row.id}>
                  {artist?.name} — {row.name}
                  {row.event_date ? `(${row.event_date})` : ''}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Verify with curl and a real (labeled) round trip**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
curl -s http://localhost:3000/admin/data | grep -oE 'イベントを追加|開催回を追加|出演情報を追加|単独公演を追加'
```

Expected: all four button labels appear.

Then verify the full create chain with Playwright, using a test event clearly labeled so it's identifiable for cleanup (`プラン検証用テストイベント`), and Fujii Kaze (`MS_ART_yu7eev56`) as the test artist since real relation/discography data already exists for them:

```bash
cat > /tmp/verify-event-content.mjs <<'EOF'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()

// 1. Create the event
await page.goto('http://localhost:3000/admin/data')
const eventForm = 'form:has(input[placeholder*="FUJI ROCK"])'
await page.fill(`${eventForm} input[name="name"]`, 'プラン検証用テストイベント')
await page.selectOption(`${eventForm} select[name="event_type"]`, 'festival')
await page.click(`${eventForm} button[type="submit"]`)
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })

// 2. Create the edition
// Note: input[name="year"] alone is ambiguous — the pre-existing createSyncWork
// form (タイアップ・シンクロアーカイブ section) also has a field named "year".
// select[name="event_id"] is unique to the event_edition form.
const editionForm = 'form:has(select[name="event_id"])'
await page.selectOption(`${editionForm} select[name="event_id"]`, { label: 'プラン検証用テストイベント' })
await page.fill(`${editionForm} input[name="year"]`, '2026')
await page.click(`${editionForm} button[type="submit"]`)
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })

// 3. Create the appearance for Fujii Kaze
const appearanceForm = 'form:has(input[name="is_headliner"])'
await page.selectOption(`${appearanceForm} select[name="event_edition_id"]`, { label: 'プラン検証用テストイベント(2026)' })
await page.selectOption(`${appearanceForm} select[name="artist_id"]`, { label: 'Fujii Kaze' })
await page.fill(`${appearanceForm} input[name="stage"]`, 'GREEN STAGE')
await page.check(`${appearanceForm} input[name="is_headliner"]`)
await page.click(`${appearanceForm} button[type="submit"]`)
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })

// 4. Create a standalone live show for Fujii Kaze
const musicEventForm = 'form:has(input[placeholder*="ワンマンライブ"])'
await page.selectOption(`${musicEventForm} select[name="artist_id"]`, { label: 'Fujii Kaze' })
await page.fill(`${musicEventForm} input[name="name"]`, 'プラン検証用テスト公演')
await page.fill(`${musicEventForm} input[name="event_date"]`, '2026-09-01')
await page.click(`${musicEventForm} button[type="submit"]`)
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })

console.log('ADMIN_ROUND_TRIP_OK')

await browser.close()
EOF
node /tmp/verify-event-content.mjs
rm /tmp/verify-event-content.mjs
```

Expected: `ADMIN_ROUND_TRIP_OK` prints with no errors thrown along the way.

Leave the test data in place — Task 4's verification builds on it, and its own final step cleans everything up.

- [ ] **Step 9: Commit**

```bash
git add app/admin/data/page.tsx
git commit -m "Add event admin section (event, edition, appearance, music_event forms)"
```

---

### Task 4: Artist detail page — "Live & Festivals" section

**Files:**
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Consumes: the existing `SectionDivider` helper and `formatDate` from `@/utils/format` (both already imported/defined in this file). Reads rows written by `createEventAppearance` / `createMusicEvent` (Task 2), via the test data created in Task 3.
- Produces: nothing consumed by later tasks — this is the final task in this plan.

- [ ] **Step 1: Add the two new queries to the initial `Promise.all`**

Find:

```tsx
  const [{ data: artist, error }, { data: albums }, { data: relations }] = await Promise.all([
    supabase.from('artist').select('*').eq('id', id).single(),
    supabase
      .from('album')
      .select('id, title, jacket_url, release_date, album_type')
      .eq('artist_id', id)
      .order('release_date', { ascending: false, nullsFirst: false }),
    supabase
      .from('artist_relation')
      .select('artist_id_a, artist_id_b, relation_type, relation_style, description')
      .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`),
  ])

  if (error || !artist) {
    notFound()
  }
```

Replace with:

```tsx
  const [{ data: artist, error }, { data: albums }, { data: relations }, { data: musicEvents }, { data: eventAppearances }] =
    await Promise.all([
      supabase.from('artist').select('*').eq('id', id).single(),
      supabase
        .from('album')
        .select('id, title, jacket_url, release_date, album_type')
        .eq('artist_id', id)
        .order('release_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('artist_relation')
        .select('artist_id_a, artist_id_b, relation_type, relation_style, description')
        .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`),
      supabase
        .from('music_event')
        .select('id, name, event_date, venue')
        .eq('artist_id', id)
        .order('event_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('event_appearance')
        .select('id, stage, is_headliner, event_edition:event_edition_id(year, event:event_id(name))')
        .eq('artist_id', id),
    ])

  if (error || !artist) {
    notFound()
  }
```

- [ ] **Step 2: Build the sorted appearances list**

Find:

```tsx
  const mvVideoId = artist.url_latest_mv ? extractYoutubeVideoId(artist.url_latest_mv) : null
```

Replace with:

```tsx
  const mvVideoId = artist.url_latest_mv ? extractYoutubeVideoId(artist.url_latest_mv) : null

  const appearances = (eventAppearances ?? [])
    .map((row) => {
      const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
      const event = edition ? (Array.isArray(edition.event) ? edition.event[0] : edition.event) : null
      return {
        id: row.id,
        stage: row.stage,
        isHeadliner: row.is_headliner,
        eventName: event?.name ?? '—',
        year: edition?.year ?? 0,
      }
    })
    .sort((a, b) => b.year - a.year)
```

- [ ] **Step 3: Render the section between Biography and Discography**

Find:

```tsx
      {artist.bio && (
        <>
          <SectionDivider label="Biography" />
          <p className="mt-4 text-sm leading-relaxed text-white/70">{artist.bio}</p>
        </>
      )}

      <SectionDivider label="Discography" />
```

Replace with:

```tsx
      {artist.bio && (
        <>
          <SectionDivider label="Biography" />
          <p className="mt-4 text-sm leading-relaxed text-white/70">{artist.bio}</p>
        </>
      )}

      <SectionDivider label="Live & Festivals" />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs uppercase tracking-wide text-white/40">Live Info</p>
          {!musicEvents || musicEvents.length === 0 ? (
            <p className="mt-3 text-sm text-white/40">まだライブ情報がありません。</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {musicEvents.map((live) => (
                <li key={live.id}>
                  <p className="font-medium">{live.name}</p>
                  <p className="text-xs text-white/40">
                    {formatDate(live.event_date)}
                    {live.venue ? ` ・ ${live.venue}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs uppercase tracking-wide text-white/40">Festival Appearances</p>
          {appearances.length === 0 ? (
            <p className="mt-3 text-sm text-white/40">まだフェス出演歴がありません。</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {appearances.map((a) => (
                <li key={a.id}>
                  <p className="font-medium">
                    {a.eventName}
                    {a.year > 0 ? `(${a.year})` : ''}
                  </p>
                  <p className="text-xs text-white/40">
                    {a.stage ?? ''}
                    {a.isHeadliner ? ' ・ ★ヘッドライナー' : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <SectionDivider label="Discography" />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify with Playwright — the full page, using Task 3's test data**

```bash
cat > /tmp/verify-live-festivals.mjs <<'EOF'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:3000/artists/MS_ART_yu7eev56')
await page.waitForTimeout(500)

const bodyText = await page.textContent('body')
console.log('SECTION_HEADING_PRESENT:', bodyText.includes('Live & Festivals'))
console.log('LIVE_INFO_PRESENT:', bodyText.includes('プラン検証用テスト公演'))
console.log('FESTIVAL_APPEARANCE_PRESENT:', bodyText.includes('プラン検証用テストイベント'))
console.log('HEADLINER_MARK_PRESENT:', bodyText.includes('★ヘッドライナー'))

await browser.close()
EOF
node /tmp/verify-live-festivals.mjs
rm /tmp/verify-live-festivals.mjs
```

Expected: all four are `true`.

Then verify the empty-state path on an artist with none of this data — Kenshi Yonezu (`MS_ART_5kji9c1a`):

```bash
curl -s http://localhost:3000/artists/MS_ART_5kji9c1a | grep -oE 'まだライブ情報がありません。|まだフェス出演歴がありません。'
```

Expected: both messages appear (confirming the section itself still renders, unlike Biography which hides when empty).

- [ ] **Step 6: Clean up the test data**

This is real production data now that the feature works — but the specific rows created in Task 3 were labeled test data and should be removed, same convention as every prior plan in this project. Delete child rows before parents to satisfy foreign keys:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  await supabase.from('music_event').delete().eq('name', 'プラン検証用テスト公演');
  const { data: event } = await supabase.from('event').select('id').eq('name', 'プラン検証用テストイベント').maybeSingle();
  if (event) {
    const { data: editions } = await supabase.from('event_edition').select('id').eq('event_id', event.id);
    for (const ed of editions ?? []) {
      await supabase.from('event_appearance').delete().eq('event_edition_id', ed.id);
    }
    await supabase.from('event_edition').delete().eq('event_id', event.id);
    await supabase.from('event').delete().eq('id', event.id);
  }
  console.log('CLEANED_UP');
})();
"
```

Expected: `CLEANED_UP` prints with no errors. Confirm via a follow-up select that `event` / `event_edition` / `event_appearance` / `music_event` are all back to 0 rows:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    })
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
git add app/artists/\[id\]/page.tsx
git commit -m "Add Live & Festivals section to artist detail page"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit` once more from the project root — expect zero errors across all changed files.
- [ ] With the dev server running, visit `/admin/data`, confirm the "イベント" section has all four forms and their selects are populated from prior entries within the same session.
- [ ] Visit `/artists/MS_ART_yu7eev56` and `/artists/MS_ART_5kji9c1a`, confirm the Live & Festivals section renders in both cases (populated and empty), positioned between Biography and Discography.
- [ ] Confirm the event/event_edition/event_appearance/music_event tables are empty again (Task 4 Step 6 already verified this, but re-check if any earlier step's data was left behind).
- [ ] Stop the dev server: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`
