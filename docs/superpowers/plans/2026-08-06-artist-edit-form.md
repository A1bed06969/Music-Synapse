# Artist Edit Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a simple `/admin/data/artists/[id]/edit` admin form for the 14 `artist` profile fields the app actually renders, linked from a new "アーティスト" list on `/admin/data`, so data enrichment no longer requires raw SQL.

**Architecture:** A new server action `updateArtist` in the existing `app/admin/data/actions.ts` handles the update, following the exact pattern of every other action in that file (`createAdminClient()`, empty-string-to-null, `redirectWith`). A new dynamic route `app/admin/data/artists/[id]/edit/page.tsx` fetches the artist and renders a pre-filled form. `streaming_status` is redefined from a 3-value enum to a 2-value one (`available`/`none`), which requires dropping and recreating its DB check constraint.

**Tech Stack:** Next.js 16 App Router, React Server Components + Server Actions, Supabase (`@supabase/ssr` for reads, `@supabase/supabase-js` service-role client for writes), Tailwind CSS v4. DB migration applied via the Supabase MCP `apply_migration` tool (project_id `ftvhglfthbcxhgnoninv`), available in this environment.

## Global Constraints

- Editable fields are exactly these 14: `bio`, `name_kana`, `name_en`, `artist_type`, `formed_year`, `origin_prefecture`, `hometown_city`, `streaming_status`, `official_site_url`, `sns_x_url`, `sns_instagram_url`, `image_url`, `spotify_artist_id`, `url_latest_mv`. Do not add fields beyond this list (spec: "非ゴール" explicitly excludes `name`, `apple_music_artist_id`, and every other column not currently rendered anywhere in the app).
- `origin_prefecture` is a free-text input, not a prefecture `<select>` — it must support non-Japanese values (spec: "海外アーティストに対応するため").
- `streaming_status` becomes a 2-value field: `available` / `none`. The DB has a pre-existing CHECK constraint (`artist_streaming_status_check`, currently `all`/`physical_only`/`partial`) that must be replaced, not just reinterpreted in application code.
- No new admin form for creating artists — creation stays iTunes-import-only.
- No image upload — `image_url` is a plain text URL field, matching how `jacket_url` already works elsewhere in this app.
- No pagination/search on the artist list — there are 5 rows today, a plain full list is fine.
- No automated test suite exists in this project (confirmed convention). Verify with `npx tsc --noEmit` and curl/Playwright against a running dev server with real data.
- All 5 artists currently have `streaming_status` and `origin_prefecture` set to `NULL` — no data migration/backfill is needed, only the constraint definition changes.

---

## File Structure

- **Modify** `utils/format.ts` — redefine `ARTIST_STREAMING_STATUS_LABEL` from 3 keys to 2.
- **Modify** `app/admin/data/actions.ts` — add `updateArtist(formData: FormData)`.
- **Modify** `app/admin/data/page.tsx` — add an "アーティスト" list section with edit links.
- **Create** `app/admin/data/artists/[id]/edit/page.tsx` — the edit form page.
- **DB migration** — replace `artist_streaming_status_check`, applied directly via the Supabase MCP tool (no repo file).

---

### Task 1: Migrate the `streaming_status` check constraint

**Files:**
- None in the repo — this is a database schema change, applied via the Supabase MCP `apply_migration` tool.

**Interfaces:**
- Produces: `artist.streaming_status` now accepts only `'available'` or `'none'` (or `NULL`) at the database level. Consumed by Task 2 (label map) and Task 5 (form select).

- [ ] **Step 1: Apply the migration**

Use the `apply_migration` MCP tool with:
- `project_id`: `ftvhglfthbcxhgnoninv`
- `name`: `redefine_artist_streaming_status_binary`
- `query`:
```sql
alter table artist drop constraint artist_streaming_status_check;
alter table artist add constraint artist_streaming_status_check
  check (streaming_status = any (array['available'::text, 'none'::text]));
```

- [ ] **Step 2: Verify the constraint definition**

Use the `execute_sql` MCP tool with `project_id: ftvhglfthbcxhgnoninv` and:
```sql
select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'artist'::regclass and conname = 'artist_streaming_status_check';
```
Expected: one row, `def` contains `'available'` and `'none'`, not `'all'`/`'physical_only'`/`'partial'`.

- [ ] **Step 3: Verify both new values are actually insertable**

Use `execute_sql` with `project_id: ftvhglfthbcxhgnoninv`:
```sql
update artist set streaming_status = 'available' where id = 'MS_ART_yu7eev56';
update artist set streaming_status = 'none' where id = 'MS_ART_yu7eev56';
update artist set streaming_status = null where id = 'MS_ART_yu7eev56';
```
Expected: all three statements succeed (no constraint violation), and the artist's `streaming_status` ends up back at `null` (this is test-data cleanup — leave it `null`, matching the rest of the artist rows).

No commit for this task (schema-only, no repo files changed).

---

### Task 2: Redefine `ARTIST_STREAMING_STATUS_LABEL`

**Files:**
- Modify: `utils/format.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ARTIST_STREAMING_STATUS_LABEL` now has exactly the keys `available` and `none`. Consumed by Task 5 (edit form `<select>` options) and the pre-existing `/artists/[id]/page.tsx` (unchanged file, already reads this map by key — no code change needed there, only its rendered label text changes).

- [ ] **Step 1: Replace the label map**

Find in `utils/format.ts`:

```ts
export const ARTIST_STREAMING_STATUS_LABEL: Record<string, string> = {
  all: '全解禁確定',
  physical_only: 'フィジカルのみ',
  partial: '一部限定配信',
}
```

Replace with:

```ts
export const ARTIST_STREAMING_STATUS_LABEL: Record<string, string> = {
  available: 'あり',
  none: 'なし',
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify the existing artist detail page still compiles and renders correctly**

`app/artists/[id]/page.tsx` reads `ARTIST_STREAMING_STATUS_LABEL[artist.streaming_status]` inside a `{artist.streaming_status && (...)}` guard — this needs no code change, but confirm it still renders correctly end-to-end after Task 1 sets a real value:

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
```

Then use the `execute_sql` MCP tool (`project_id: ftvhglfthbcxhgnoninv`) to temporarily set `update artist set streaming_status = 'available' where id = 'MS_ART_yu7eev56';`, then:

```bash
curl -s http://localhost:3000/artists/MS_ART_yu7eev56 | grep -o '配信: あり'
```

Expected: `配信: あり` appears. Then clear it back with `execute_sql`: `update artist set streaming_status = null where id = 'MS_ART_yu7eev56';`. Leave the dev server running — later tasks in this plan reuse it.

- [ ] **Step 4: Commit**

```bash
git add utils/format.ts
git commit -m "Redefine ARTIST_STREAMING_STATUS_LABEL as a binary available/none"
```

---

### Task 3: `updateArtist` server action

**Files:**
- Modify: `app/admin/data/actions.ts`

**Interfaces:**
- Consumes: nothing new (uses the existing `createAdminClient`, `redirectWith` helpers already in this file).
- Produces: `export async function updateArtist(formData: FormData)`, a server action expecting a hidden `artist_id` field plus the 14 editable fields by their exact column names as form field names. Consumed by Task 5's `<form action={updateArtist}>`.

- [ ] **Step 1: Add the action**

Append to the end of `app/admin/data/actions.ts` (after the existing `createSyncEntry` function):

```ts

export async function updateArtist(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')

  if (!artistId) {
    redirectWith('error', '不正なリクエストです。')
  }

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

  if (error) {
    redirectWith('error', `更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', 'アーティスト情報を更新しました。')
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/data/actions.ts
git commit -m "Add updateArtist server action"
```

(This action isn't reachable from any UI yet — Task 5 wires it up. Nothing to curl-verify here beyond the type-check.)

---

### Task 4: Artist list section on `/admin/data`

**Files:**
- Modify: `app/admin/data/page.tsx:154-158`

**Interfaces:**
- Consumes: the existing `artistOptions` variable (already computed at line 129 as `const artistOptions = artists ?? []`, itself from the existing `supabase.from('artist').select('id, name').order('name')` query at line 85 — no query change needed).
- Produces: a link to `/admin/data/artists/${id}/edit` for each artist. Consumed by Task 5 (the route it links to).

- [ ] **Step 1: Insert the new section**

Find:

```tsx
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      {/* ジャンル */}
```

Replace with:

```tsx
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      {/* アーティスト */}
      <section className="mt-10 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold">アーティスト</h2>
        <p className="mt-2 text-xs text-white/40">
          プロフィール項目(bio・URL・配信状況等)の編集はこちらから。新規登録はiTunes一括登録のみ対応。
        </p>
        {artistOptions.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">まだアーティストが登録されていません。</p>
        ) : (
          <ul className="mt-4 divide-y divide-white/10">
            {artistOptions.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span>{a.name}</span>
                <Link href={`/admin/data/artists/${a.id}/edit`} className="text-xs text-white/40 hover:text-white/70">
                  編集 →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ジャンル */}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify with curl**

```bash
curl -s http://localhost:3000/admin/data | grep -c '編集 →'
```

Expected: `5` (one "編集 →" link per current artist row). The link targets don't resolve yet (Task 5 creates that route) — this step only confirms the list section itself renders.

- [ ] **Step 4: Commit**

```bash
git add app/admin/data/page.tsx
git commit -m "Add artist list with edit links to admin data page"
```

---

### Task 5: Artist edit page

**Files:**
- Create: `app/admin/data/artists/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `updateArtist` from `app/admin/data/actions.ts` (Task 3), `ARTIST_TYPE_LABEL` and `ARTIST_STREAMING_STATUS_LABEL` from `utils/format.ts` (the latter redefined in Task 2).
- Produces: nothing consumed by later tasks — this is the final task in this plan.

- [ ] **Step 1: Create the file**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { ARTIST_TYPE_LABEL, ARTIST_STREAMING_STATUS_LABEL } from '@/utils/format'
import { updateArtist } from '@/app/admin/data/actions'

const inputClass =
  'w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'
const buttonClass =
  'rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85'

export default async function ArtistEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: artist, error } = await supabase.from('artist').select('*').eq('id', id).single()

  if (error || !artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} を編集</h1>

      <form action={updateArtist} className="mt-8 space-y-4">
        <input type="hidden" name="artist_id" value={artist.id} />

        <div>
          <label className="mb-1 block text-xs text-white/40">bio</label>
          <textarea name="bio" rows={4} defaultValue={artist.bio ?? ''} className={inputClass} />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">ふりがな</label>
            <input name="name_kana" defaultValue={artist.name_kana ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">英語表記</label>
            <input name="name_en" defaultValue={artist.name_en ?? ''} className={inputClass} />
          </div>
        </div>

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
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">出身都市</label>
            <input name="hometown_city" defaultValue={artist.hometown_city ?? ''} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-white/40">公式サイトURL</label>
          <input name="official_site_url" type="url" defaultValue={artist.official_site_url ?? ''} className={inputClass} />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">X URL</label>
            <input name="sns_x_url" type="url" defaultValue={artist.sns_x_url ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Instagram URL</label>
            <input name="sns_instagram_url" type="url" defaultValue={artist.sns_instagram_url ?? ''} className={inputClass} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/40">画像URL</label>
          <input name="image_url" type="url" defaultValue={artist.image_url ?? ''} className={inputClass} />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Spotify Artist ID</label>
            <input name="spotify_artist_id" defaultValue={artist.spotify_artist_id ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Latest MV URL(YouTube)</label>
            <input name="url_latest_mv" type="url" defaultValue={artist.url_latest_mv ?? ''} className={inputClass} />
          </div>
        </div>

        <button type="submit" className={buttonClass}>
          保存
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify the edit page renders with current values pre-filled**

```bash
curl -s http://localhost:3000/admin/data/artists/MS_ART_yu7eev56/edit | grep -o 'Fujii Kaze を編集'
```

Expected: `Fujii Kaze を編集` appears.

- [ ] **Step 4: Verify a non-existent artist id 404s**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin/data/artists/MS_ART_does_not_exist/edit
```

Expected: `404`.

- [ ] **Step 5: Verify the full submit-and-persist round trip with Playwright**

```bash
cat > /tmp/verify-artist-edit.mjs <<'EOF'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:3000/admin/data/artists/MS_ART_yu7eev56/edit')

await page.fill('textarea[name="bio"]', 'プラン検証用テストbio')
await page.selectOption('select[name="streaming_status"]', 'available')
await page.fill('input[name="spotify_artist_id"]', '4Kc9jkE1sTe1zsxGz6nEZG')
await page.click('button[type="submit"]')
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })
console.log('AFTER_SUBMIT_URL:', page.url())

await page.goto('http://localhost:3000/artists/MS_ART_yu7eev56')
const bodyText = await page.textContent('body')
console.log('BIO_PRESENT:', bodyText.includes('プラン検証用テストbio'))
console.log('STREAMING_LABEL_PRESENT:', bodyText.includes('配信: あり'))
console.log('SPOTIFY_BUTTON_PRESENT:', bodyText.includes('Spotify'))

await browser.close()
EOF
node /tmp/verify-artist-edit.mjs
```

Expected: `AFTER_SUBMIT_URL` contains `success=`, and all three of `BIO_PRESENT`, `STREAMING_LABEL_PRESENT`, `SPOTIFY_BUTTON_PRESENT` are `true`.

- [ ] **Step 6: Clean up the test values**

This project's convention is to clean up test data after verifying. Restore Fujii Kaze's row to how it was before this task's verification (bio/streaming_status/spotify_artist_id were all `null` beforehand — confirmed earlier in this plan's design phase):

```bash
cat > /tmp/cleanup-artist-edit-test.mjs <<'EOF'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:3000/admin/data/artists/MS_ART_yu7eev56/edit')

await page.fill('textarea[name="bio"]', '')
await page.selectOption('select[name="streaming_status"]', '')
await page.fill('input[name="spotify_artist_id"]', '')
await page.click('button[type="submit"]')
await page.waitForURL(/\/admin\/data\?success=/, { timeout: 10000 })
console.log('CLEANED_UP')

await browser.close()
EOF
node /tmp/cleanup-artist-edit-test.mjs
rm /tmp/verify-artist-edit.mjs /tmp/cleanup-artist-edit-test.mjs
```

Then confirm via the `execute_sql` MCP tool (`project_id: ftvhglfthbcxhgnoninv`):
```sql
select bio, streaming_status, spotify_artist_id from artist where id = 'MS_ART_yu7eev56';
```
Expected: all three columns are `null`.

- [ ] **Step 7: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 8: Commit**

```bash
git add app/admin/data/artists/\[id\]/edit/page.tsx
git commit -m "Add artist edit form page"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit` once more from the project root — expect zero errors across all changed/created files.
- [ ] With the dev server running, visit `/admin/data`, confirm the new "アーティスト" section lists all 5 artists with working "編集 →" links.
- [ ] Click through to an edit page, confirm all 14 fields are present and any already-set values (e.g. Fujii Kaze's `apple_music_artist_id`-derived Apple Music button on the detail page, which this form does NOT edit) are unaffected by a save.
- [ ] Confirm `streaming_status` can be set to both `あり` and `なし` and saved successfully (proves the migrated constraint works end-to-end through the UI, not just via direct SQL).
- [ ] Stop the dev server: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`
