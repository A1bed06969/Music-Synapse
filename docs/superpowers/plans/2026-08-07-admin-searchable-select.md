# Admin Searchable Track/Album Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain `<select>` track/album pickers on `/admin/data` (currently unusable at ~1993 tracks / 387 albums) with a searchable, client-side-filtered combobox, reused across all 6 usage sites.

**Architecture:** One new client component (`SearchableSelect`) that renders a text-search input backed by a hidden form field, plus a data-shape-agnostic `{id, label}[]` prop. `app/admin/data/page.tsx` computes the item lists once and swaps in the component at each of the 6 existing `<select name="track_id">` / `<select name="album_id">` call sites.

**Tech Stack:** Next.js 16 App Router (React Server Components + one new Client Component), Tailwind CSS v4, no new dependencies.

## Global Constraints

- No new npm dependencies — implement with plain `useState`, no combobox library.
- Client-side filtering only. All items are loaded into the browser once; no server round-trip per keystroke.
- The hidden `<input type="hidden" name={name} value={selectedId ?? ''}>` must submit correctly inside the existing native `<form action={serverAction}>` elements — no change to any server action's signature or validation.
- Required-field behavior (sync entry's track, label-linking's album) relies entirely on existing server-side validation (`if (!x) { redirectWith('error', ...) }`) — no new client-side `required` enforcement.
- Album picker labels must show "タイトル — アーティスト名" consistently across all 3 album usage sites (today only 1 of 3 shows the artist name; the query already fetches it, so this is a display-only fix, no query changes).
- Match up to 20 results per keystroke, case-insensitive substring match against the item's `label`.
- No automated test suite exists in this project. Verify with `npx tsc --noEmit` and Playwright/curl against a running dev server with real data; any row updated for verification purposes must be reverted to its original value afterward and confirmed via a follow-up read; any row inserted for verification must be deleted afterward and confirmed via a follow-up count.

---

## File Structure

- **Create** `app/admin/data/SearchableSelect.tsx` — the reusable client component.
- **Modify** `app/admin/data/page.tsx` — import it, compute `trackPickerItems`/`albumPickerItems`, replace the 6 `<select>` blocks.

---

### Task 1: `SearchableSelect` component + track selects

**Files:**
- Create: `app/admin/data/SearchableSelect.tsx`
- Modify: `app/admin/data/page.tsx`

**Interfaces:**
- Produces: `export default function SearchableSelect({ items, name, placeholder }: { items: { id: string; label: string }[]; name: string; placeholder: string })`. Renders a hidden `<input>` named `name` carrying the selected item's `id` (or `''` if none selected) — this is the only contract later code depends on; it behaves exactly like the `<select name="...">` it replaces from the surrounding form's point of view.
- Consumes (Task 2): the same component, unmodified, plus a new `albumPickerItems` array Task 2 computes following the identical `{id, label}` shape this task establishes for `trackPickerItems`.

- [ ] **Step 1: Create the component**

Create `app/admin/data/SearchableSelect.tsx`:

```tsx
'use client'

import { useState } from 'react'

type Item = { id: string; label: string }

export default function SearchableSelect({
  items,
  name,
  placeholder,
}: {
  items: Item[]
  name: string
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Item | null>(null)
  const [open, setOpen] = useState(false)

  const filtered = query
    ? items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).slice(0, 20)
    : []

  function selectItem(item: Item) {
    setSelected(item)
    setQuery('')
    setOpen(false)
  }

  function clearSelection() {
    setSelected(null)
    setQuery('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered.length > 0) selectItem(filtered[0])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative w-full max-w-xs">
      <input type="hidden" name={name} value={selected?.id ?? ''} />
      {selected ? (
        <div className="flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white">
          <span className="flex-1 truncate">{selected.label}</span>
          <button
            type="button"
            onClick={clearSelection}
            className="text-white/40 hover:text-white"
            aria-label="選択を解除"
          >
            ×
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
      )}
      {open && query && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-white/15 bg-black shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-white/40">該当なし</p>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectItem(item)}
                className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10"
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

Note on the `onMouseDown={(e) => e.preventDefault()}` on each candidate button: this stops the text input from firing `onBlur` when a candidate is clicked (`preventDefault` on `mousedown` stops the browser's default focus-shift), so `onClick` reliably fires and selects the item before `onBlur` could close the dropdown out from under the click. This is why `onBlur` can be a plain `setOpen(false)` with no artificial delay — clicking a candidate never triggers it in the first place; only genuinely leaving the input (tabbing away, clicking elsewhere) does.

- [ ] **Step 2: Import the component in `app/admin/data/page.tsx`**

Find:

```tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { PREFECTURE_COORDS } from '@/utils/prefectures'
```

Replace with:

```tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { PREFECTURE_COORDS } from '@/utils/prefectures'
import SearchableSelect from './SearchableSelect'
```

- [ ] **Step 3: Compute `trackPickerItems`**

Find:

```tsx
  const albumOptions = albums ?? []
  const trackOptions = tracks ?? []
```

Replace with:

```tsx
  const albumOptions = albums ?? []
  const trackOptions = tracks ?? []
  const trackPickerItems = trackOptions.map((t) => {
    const artist = Array.isArray(t.artist) ? t.artist[0] : t.artist
    return { id: t.id, label: `${t.title}${artist?.name ? ` — ${artist.name}` : ''}` }
  })
```

- [ ] **Step 4: Replace the two identical optional track selects (radio rotation + ranking entry)**

This exact block appears **twice** in the file (once in the ラジオローテーション form, once in the キュレーションコンテンツ／ランキングエントリー form) — byte-for-byte identical both times, and both get the same replacement. Use your editor's "replace all occurrences" so both are updated identically; do not replace only one.

Find (both occurrences):

```tsx
            <select name="track_id" className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="">(トラック指定なし)</option>
              {trackOptions.map((t) => {
                const artist = Array.isArray(t.artist) ? t.artist[0] : t.artist
                return (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {artist?.name ? ` — ${artist.name}` : ''}
                  </option>
                )
              })}
            </select>
```

Replace with (both occurrences):

```tsx
            <SearchableSelect items={trackPickerItems} name="track_id" placeholder="トラックを検索(任意)" />
```

- [ ] **Step 5: Replace the sync entry's required track select**

This block is different (it has `required`, a different placeholder, and different indentation — it appears once, in the タイアップ・シンクロアーカイブ／シンクエントリー form).

Find:

```tsx
          <select name="track_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              トラックを選択
            </option>
            {trackOptions.map((t) => {
              const artist = Array.isArray(t.artist) ? t.artist[0] : t.artist
              return (
                <option key={t.id} value={t.id}>
                  {t.title}
                  {artist?.name ? ` — ${artist.name}` : ''}
                </option>
              )
            })}
          </select>
```

Replace with:

```tsx
          <SearchableSelect items={trackPickerItems} name="track_id" placeholder="トラックを選択" />
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Verify with Playwright — search, select, submit, and interaction details**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
```

Create `/Users/th/dev/music-synapse/verify-track-picker.mjs` (project directory, not `/tmp`, so `playwright` resolves):

```js
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:3000/admin/data')

// All three track pickers should render with their expected placeholders.
const optionalPlaceholders = await page.locator('input[placeholder="トラックを検索(任意)"]').count()
console.log('OPTIONAL_TRACK_PICKERS_COUNT (expect 2):', optionalPlaceholders)
const requiredPlaceholder = await page.locator('input[placeholder="トラックを選択"]').count()
console.log('REQUIRED_TRACK_PICKER_COUNT (expect 1):', requiredPlaceholder)

// Use the required one (sync entry form) for the full interaction test.
const syncTrackInput = page.locator('input[placeholder="トラックを選択"]')

// No-match case
await syncTrackInput.fill('プラン検証用に絶対一致しない文字列xyz123')
await page.waitForTimeout(150)
const noMatchVisible = await page.locator('text=該当なし').isVisible()
console.log('NO_MATCH_TEXT_VISIBLE:', noMatchVisible)

// Real match case
await syncTrackInput.fill('Alfie')
await page.waitForTimeout(150)
const candidate = page.locator('button:has-text("Alfie")').first()
console.log('CANDIDATE_VISIBLE:', await candidate.isVisible())
await candidate.click()

// Selecting should replace the search input with a display chip showing the label
const selectedChipVisible = await page.locator('text=Alfie').first().isVisible()
console.log('SELECTED_CHIP_VISIBLE:', selectedChipVisible)

// Clear button should revert back to the search input
await page.locator('button[aria-label="選択を解除"]').first().click()
const backToSearchInput = await syncTrackInput.isVisible()
console.log('BACK_TO_SEARCH_AFTER_CLEAR:', backToSearchInput)

// Re-select for the actual form submission test
await syncTrackInput.fill('Alfie')
await page.waitForTimeout(150)
await page.locator('button:has-text("Alfie")').first().click()

// Create a throwaway sync_work, then submit the sync_entry form with the searched track
await page.fill('input[placeholder*="熱闘甲子園"]', 'プラン検証用テスト作品')
await page.click('button:has-text("作品を追加")')
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })

// Required-field validation: select the sync_work but leave the track picker
// untouched (empty). SearchableSelect's hidden input has no client-side
// `required` by design (per this plan's Global Constraints — validation is
// server-side only), so the browser must let this submit, and the existing
// server action must reject it.
await page.goto('http://localhost:3000/admin/data')
await page.selectOption('select[name="sync_work_id"]', { label: 'プラン検証用テスト作品' })
await page.click('button:has-text("起用楽曲を追加")')
await page.waitForURL(/\/admin\/data\?error=/, { timeout: 10000 })
console.log('REQUIRED_FIELD_VALIDATION_OK: redirected to error as expected')

// Now the real successful-submission case: select both fields properly.
await page.goto('http://localhost:3000/admin/data')
await page.selectOption('select[name="sync_work_id"]', { label: 'プラン検証用テスト作品' })
await syncTrackInput.fill('Alfie')
await page.waitForTimeout(150)
await page.locator('button:has-text("Alfie")').first().click()
await page.fill('input[placeholder*="OPテーマ"]', 'プラン検証用テスト使用箇所')
await page.click('button:has-text("起用楽曲を追加")')
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })

console.log('FORM_SUBMIT_OK')
await browser.close()
```

```bash
node verify-track-picker.mjs
rm verify-track-picker.mjs
```

Expected: `OPTIONAL_TRACK_PICKERS_COUNT (expect 2): 2`, `REQUIRED_TRACK_PICKER_COUNT (expect 1): 1`, `NO_MATCH_TEXT_VISIBLE: true`, `CANDIDATE_VISIBLE: true`, `SELECTED_CHIP_VISIBLE: true`, `BACK_TO_SEARCH_AFTER_CLEAR: true`, `REQUIRED_FIELD_VALIDATION_OK: redirected to error as expected`, `FORM_SUBMIT_OK` prints.

Confirm the DB row directly, then clean it up:

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
  const { data: work } = await supabase.from('sync_work').select('id').eq('title', 'プラン検証用テスト作品').single();
  const { data: entries } = await supabase.from('sync_entry').select('id, track_id, usage_detail').eq('sync_work_id', work.id);
  console.log('SYNC_ENTRY_ROWS:', JSON.stringify(entries));
  console.log('TRACK_ID_CORRECT:', entries.length === 1 && entries[0].track_id === 'MS_TRK_8bhguqq9');
  await supabase.from('sync_entry').delete().eq('sync_work_id', work.id);
  await supabase.from('sync_work').delete().eq('id', work.id);
  const { count } = await supabase.from('sync_work').select('*', { count: 'exact', head: true }).eq('title', 'プラン検証用テスト作品');
  console.log('CLEANUP_CONFIRMED (expect 0):', count);
})();
"
```

Expected: `TRACK_ID_CORRECT: true` (the picker correctly submitted `MS_TRK_8bhguqq9`, Fujii Kaze's "Alfie", as `track_id` — proving the hidden-input mechanism works end to end through a real server action), `CLEANUP_CONFIRMED (expect 0): 0`.

- [ ] **Step 8: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 9: Commit**

```bash
git add app/admin/data/SearchableSelect.tsx app/admin/data/page.tsx
git commit -m "Add searchable combobox for admin track selection"
```

---

### Task 2: Album selects

**Files:**
- Modify: `app/admin/data/page.tsx`

**Interfaces:**
- Consumes: `SearchableSelect` (Task 1, unmodified).
- Produces: nothing consumed by later tasks — this is the final task in this plan.

- [ ] **Step 1: Compute `albumPickerItems`**

Find:

```tsx
  const trackPickerItems = trackOptions.map((t) => {
    const artist = Array.isArray(t.artist) ? t.artist[0] : t.artist
    return { id: t.id, label: `${t.title}${artist?.name ? ` — ${artist.name}` : ''}` }
  })
```

Replace with:

```tsx
  const trackPickerItems = trackOptions.map((t) => {
    const artist = Array.isArray(t.artist) ? t.artist[0] : t.artist
    return { id: t.id, label: `${t.title}${artist?.name ? ` — ${artist.name}` : ''}` }
  })
  const albumPickerItems = albumOptions.map((a) => {
    const artist = Array.isArray(a.artist) ? a.artist[0] : a.artist
    return { id: a.id, label: `${a.title}${artist?.name ? ` — ${artist.name}` : ''}` }
  })
```

- [ ] **Step 2: Replace the label-linking form's required album select**

Find:

```tsx
          <select name="album_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              アルバムを選択
            </option>
            {albumOptions.map((a) => {
              const artist = Array.isArray(a.artist) ? a.artist[0] : a.artist
              return (
                <option key={a.id} value={a.id}>
                  {a.title}
                  {artist?.name ? ` — ${artist.name}` : ''}
                </option>
              )
            })}
          </select>
```

Replace with:

```tsx
          <SearchableSelect items={albumPickerItems} name="album_id" placeholder="アルバムを選択" />
```

- [ ] **Step 3: Replace the two identical optional album selects (radio rotation + ranking entry)**

This exact block appears **twice** in the file, byte-for-byte identical both times, and both get the same replacement. Use your editor's "replace all occurrences" so both are updated identically.

Find (both occurrences):

```tsx
            <select name="album_id" className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="">(アルバム指定なし)</option>
              {albumOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
```

Replace with (both occurrences):

```tsx
            <SearchableSelect items={albumPickerItems} name="album_id" placeholder="アルバムを検索(任意)" />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify with Playwright — search, select, submit against a real album, then revert**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
```

The test album `MS_ALB_sbvf6yn5` ("HELP EVER HURT COVER" by Fujii Kaze) currently has `label_id = null`. Create `/Users/th/dev/music-synapse/verify-album-picker.mjs`:

```js
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    })
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: before } = await supabase.from('album').select('label_id').eq('id', 'MS_ALB_sbvf6yn5').single()
console.log('BEFORE_LABEL_ID (expect null):', JSON.stringify(before))

const browser = await chromium.launch()
const page = await browser.newPage()

// Create a throwaway label
await page.goto('http://localhost:3000/admin/data')
await page.fill('input[placeholder="レーベル名"]', 'プラン検証用テストレーベル')
await page.click('button:has-text("レーベルを追加")')
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })

// Search and select the test album, then link it to the test label
await page.goto('http://localhost:3000/admin/data')
const albumInput = page.locator('input[placeholder="アルバムを選択"]')
await albumInput.fill('HELP EVER HURT COVER')
await page.waitForTimeout(150)
await page.locator('button:has-text("HELP EVER HURT COVER")').first().click()
await page.selectOption('select[name="label_id"]', { label: 'プラン検証用テストレーベル' })
await page.click('button:has-text("アルバムを紐付け")')
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })

await browser.close()

const { data: after } = await supabase.from('album').select('label_id, label:label_id(name)').eq('id', 'MS_ALB_sbvf6yn5').single()
console.log('AFTER_LABEL:', JSON.stringify(after))

// Revert: restore the album's label_id to null, delete the throwaway label
const { error: revertError } = await supabase.from('album').update({ label_id: null }).eq('id', 'MS_ALB_sbvf6yn5')
if (revertError) {
  console.error('REVERT_FAILED', revertError.message)
  process.exit(1)
}
const { data: labelRow } = await supabase.from('label').select('id').eq('name', 'プラン検証用テストレーベル').single()
await supabase.from('label').delete().eq('id', labelRow.id)

const { data: finalCheck } = await supabase.from('album').select('label_id').eq('id', 'MS_ALB_sbvf6yn5').single()
console.log('AFTER_REVERT (expect null):', JSON.stringify(finalCheck))
const { count } = await supabase.from('label').select('*', { count: 'exact', head: true }).eq('name', 'プラン検証用テストレーベル')
console.log('LABEL_CLEANUP_CONFIRMED (expect 0):', count)
```

```bash
node verify-album-picker.mjs
rm verify-album-picker.mjs
```

Expected: `BEFORE_LABEL_ID (expect null): {"label_id":null}`, `AFTER_LABEL` shows a non-null `label_id` whose joined `label.name` is `"プラン検証用テストレーベル"` (confirming the album picker correctly submitted `MS_ALB_sbvf6yn5`), `AFTER_REVERT (expect null): {"label_id":null}`, `LABEL_CLEANUP_CONFIRMED (expect 0): 0`.

Also confirm the two optional album pickers render with the expected placeholder and now show artist names (previously only 1 of 3 did):

```bash
curl -s http://localhost:3000/admin/data | grep -oE 'アルバムを検索\(任意\)' | wc -l
```

Expected: `2`.

- [ ] **Step 6: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 7: Commit**

```bash
git add app/admin/data/page.tsx
git commit -m "Add searchable combobox for admin album selection"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit` once more from the project root — expect zero errors.
- [ ] With the dev server running, visit `/admin/data` and confirm all 6 picker instances render (3 track, 3 album), each showing the correct placeholder text.
- [ ] Confirm `MS_ALB_sbvf6yn5.label_id` is `null` and no row named `プラン検証用%` remains in `sync_work`, `sync_entry`, or `label` (Task 1/2's own steps already verified this, but re-check if anything was left behind).
- [ ] Stop the dev server: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`
