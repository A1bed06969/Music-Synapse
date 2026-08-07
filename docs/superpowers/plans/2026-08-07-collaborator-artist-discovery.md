# Collaborator Artist Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin discover and selectively import the collaborator artists credited on an existing artist's featuring/collab releases, with mandatory human confirmation before anything is imported.

**Architecture:** Two new pure functions in `utils/itunes.ts` (parse collaborator names out of album-level credit strings; search Apple Music by name), a new review page under the artist edit flow that surfaces candidates for each extracted name, and a new server action that hands any selected candidate IDs to the existing `importArtistsFromItunes` — no new import logic.

**Tech Stack:** Next.js 16 App Router, React Server Components + Server Actions, Supabase, Tailwind CSS v4, no new dependencies.

## Global Constraints

- No automatic adoption of search results — every import requires an explicit human selection. This is the feature's entire reason for existing (Apple's search API returns wrong-person matches for Japanese names, confirmed by direct testing: searching "Rin音" returns three different "Rinne"/"RiN" artists, none of which display "Rin音" anywhere in their data).
- Collaborator extraction is album-level only (`entity=album`'s per-collection `artistName`), not track-level — no new API calls beyond what a normal artist re-fetch already makes.
- Candidates whose `artistId` already exists in our `artist.apple_music_artist_id` column must be excluded (no duplicate-import risk).
- Names with zero surviving candidates (not found, or all filtered as already-registered) are skipped from the selectable list, not shown as individual errors — the page lists them in one summary line at the bottom instead.
- Reuse `importArtistsFromItunes` (`app/admin/import/actions.ts`) unmodified for the actual import — it already accepts either a full URL or a bare numeric ID string.
- No automated test suite exists in this project. Verify with `npx tsc --noEmit` and curl/Playwright against a running dev server with real data.

---

## File Structure

- **Modify** `utils/itunes.ts` — add `searchArtist` and `extractCollaboratorNames`.
- **Create** `app/admin/data/artists/[id]/collaborators/page.tsx` — candidate review page.
- **Create** `app/admin/data/artists/[id]/collaborators/actions.ts` — `importSelectedCollaborators`.
- **Modify** `app/admin/data/artists/[id]/edit/page.tsx` — add the entry-point link.

---

### Task 1: `searchArtist` and `extractCollaboratorNames`

**Files:**
- Modify: `utils/itunes.ts`

**Interfaces:**
- Produces: `export type ItunesArtistSearchResult = { artistId: number; artistName: string; primaryGenreName?: string; artistLinkUrl?: string }`, `export async function searchArtist(name: string): Promise<ItunesArtistSearchResult[]>`, `export function extractCollaboratorNames(primaryArtistName: string, albums: ItunesAlbum[]): string[]`. Consumed by Task 2's candidates page.

- [ ] **Step 1: Add the two functions**

Append to the end of `utils/itunes.ts`:

```ts

export type ItunesArtistSearchResult = {
  artistId: number
  artistName: string
  primaryGenreName?: string
  artistLinkUrl?: string
}

/**
 * アーティスト名でApple Musicを検索し、候補を返す(上位5件)。
 * 同名・類似名の別人がヒットすることがあるため、呼び出し側で必ず人間の確認を挟むこと。
 */
export async function searchArtist(name: string): Promise<ItunesArtistSearchResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5&country=JP`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`iTunes API error (artist search): ${res.status}`)
  }
  const data = await res.json()
  return (data.results ?? [])
    .filter((r: any) => r.wrapperType === 'artist')
    .map((r: any) => ({
      artistId: r.artistId,
      artistName: r.artistName,
      primaryGenreName: r.primaryGenreName,
      artistLinkUrl: r.artistLinkUrl,
    }))
}

/**
 * アルバム一覧のartistNameから、本人名義と異なる連名クレジットを人名単位に分解して返す。
 * 括弧の深さを追跡し、深さ0の「,」「&」でのみ分割する(例:
 * "ACAね(ずっと真夜中でいいのに。), Rin音, Yaffle" は
 * ["ACAね(ずっと真夜中でいいのに。)", "Rin音", "Yaffle"] に分解され、本人名義"Yaffle"は除外される)。
 */
export function extractCollaboratorNames(primaryArtistName: string, albums: ItunesAlbum[]): string[] {
  const names = new Set<string>()

  for (const album of albums) {
    if (!album.artistName || album.artistName === primaryArtistName) continue

    let depth = 0
    let current = ''
    const parts: string[] = []
    for (const ch of album.artistName) {
      if (ch === '(' || ch === '（') depth++
      if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1)
      if (depth === 0 && (ch === ',' || ch === '&')) {
        parts.push(current)
        current = ''
      } else {
        current += ch
      }
    }
    parts.push(current)

    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed && trimmed !== primaryArtistName) {
        names.add(trimmed)
      }
    }
  }

  return Array.from(names)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify with a temporary route handler**

These two functions have no UI yet (Task 2 wires them up), so verify them directly through a throwaway Next.js route handler rather than the browser.

Create `app/api/_verify/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { extractCollaboratorNames, searchArtist } from '@/utils/itunes'

export async function GET() {
  const testAlbums = [
    { artistName: 'Yaffle', collectionName: 'solo release' } as any,
    { artistName: 'ACAね(ずっと真夜中でいいのに。), Rin音, Yaffle', collectionName: 'feature 1' } as any,
    { artistName: 'Yaffle & AI', collectionName: 'feature 2' } as any,
    { artistName: 'imase & Yaffle', collectionName: 'feature 3' } as any,
  ]
  const names = extractCollaboratorNames('Yaffle', testAlbums)
  const maricelleResults = await searchArtist('MARICELLE')
  return NextResponse.json({ names, maricelleResults })
}
```

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
curl -s http://localhost:3000/api/_verify | python3 -m json.tool
```

Expected JSON shape:
- `names` is an array containing exactly `["ACAね(ずっと真夜中でいいのに。)", "Rin音", "AI", "imase"]` (order may vary; "Yaffle" must NOT appear, since it's the primary artist name and gets filtered out of every split).
- `maricelleResults` is an array with exactly one entry: `artistId: 1019986011`, `artistName: "Maricelle"`, `primaryGenreName: "ポップ"` (or similar), `artistLinkUrl` starting with `https://music.apple.com/`.

- [ ] **Step 4: Delete the temporary route and stop the dev server**

```bash
rm -rf app/api/_verify
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 5: Commit**

```bash
git add utils/itunes.ts
git commit -m "Add searchArtist and extractCollaboratorNames to utils/itunes.ts"
```

---

### Task 2: Candidate review page, import action, and edit-page entry point

**Files:**
- Create: `app/admin/data/artists/[id]/collaborators/page.tsx`
- Create: `app/admin/data/artists/[id]/collaborators/actions.ts`
- Modify: `app/admin/data/artists/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `searchArtist`, `extractCollaboratorNames`, `ItunesArtistSearchResult` (Task 1); `fetchArtistWithAlbums` (existing, `utils/itunes.ts`); `importArtistsFromItunes` (existing, `app/admin/import/actions.ts`).
- Produces: nothing consumed by later tasks — this is the final task in this plan.

- [ ] **Step 1: Create the server action**

Create `app/admin/data/artists/[id]/collaborators/actions.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { importArtistsFromItunes } from '@/app/admin/import/actions'

export async function importSelectedCollaborators(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const count = Number(formData.get('candidate_count') ?? '0')

  const selectedIds: string[] = []
  for (let i = 0; i < count; i++) {
    const value = String(formData.get(`select_${i}`) ?? '')
    if (value) selectedIds.push(value)
  }

  if (selectedIds.length === 0) {
    redirect(
      `/admin/data/artists/${artistId}/collaborators?error=${encodeURIComponent('登録するアーティストを選択してください。')}`
    )
  }

  const results = await importArtistsFromItunes(selectedIds)
  const successCount = results.filter((r) => r.success).length
  const failedMessages = results.filter((r) => !r.success).map((r) => r.message)

  revalidatePath('/admin/data')

  if (successCount === 0) {
    redirect(
      `/admin/data/artists/${artistId}/collaborators?error=${encodeURIComponent(`登録に失敗しました: ${failedMessages.join(' / ')}`)}`
    )
  }

  const successMessage =
    failedMessages.length > 0
      ? `${successCount}件のアーティストを登録しました(${failedMessages.length}件失敗)。`
      : `${successCount}件のアーティストを登録しました。`

  redirect(`/admin/data/artists/${artistId}/collaborators?success=${encodeURIComponent(successMessage)}`)
}
```

- [ ] **Step 2: Create the candidate review page**

Create `app/admin/data/artists/[id]/collaborators/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { fetchArtistWithAlbums, extractCollaboratorNames, searchArtist } from '@/utils/itunes'
import { importSelectedCollaborators } from './actions'

export default async function CollaboratorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { id } = await params
  const { success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: artist, error } = await supabase
    .from('artist')
    .select('id, name, apple_music_artist_id')
    .eq('id', id)
    .single()

  if (error || !artist) {
    notFound()
  }

  if (!artist.apple_music_artist_id) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link href={`/admin/data/artists/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
          ← {artist.name} の編集に戻る
        </Link>
        <p className="mt-8 text-sm text-white/40">Apple Music IDが未設定です。</p>
      </div>
    )
  }

  const { albums } = await fetchArtistWithAlbums(artist.apple_music_artist_id)
  const names = extractCollaboratorNames(artist.name, albums)

  const { data: existingArtists } = await supabase.from('artist').select('apple_music_artist_id')
  const existingIds = new Set((existingArtists ?? []).map((a) => a.apple_music_artist_id))

  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const candidates = await searchArtist(name)
        const filtered = candidates.filter((c) => !existingIds.has(String(c.artistId)))
        return { name, candidates: filtered }
      } catch {
        return { name, candidates: [] }
      }
    })
  )

  const withCandidates = results.filter((r) => r.candidates.length > 0)
  const notFoundNames = results.filter((r) => r.candidates.length === 0).map((r) => r.name)

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/admin/data/artists/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name} の編集に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} のコラボアーティストを探す</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {names.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">連名の作品が見つかりませんでした。</p>
      ) : withCandidates.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">候補が見つかりませんでした。</p>
      ) : (
        <form action={importSelectedCollaborators} className="mt-8 space-y-6">
          <input type="hidden" name="artist_id" value={id} />
          <input type="hidden" name="candidate_count" value={withCandidates.length} />
          {withCandidates.map((result, i) => (
            <div key={result.name}>
              <p className="text-sm font-medium">{result.name}</p>
              <div className="mt-2 space-y-1.5">
                <label className="flex items-center gap-2 text-sm text-white/60">
                  <input type="radio" name={`select_${i}`} value="" defaultChecked />
                  登録しない
                </label>
                {result.candidates.map((c) => (
                  <label key={c.artistId} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={`select_${i}`} value={c.artistId} />
                    {c.artistName}
                    {c.primaryGenreName && <span className="text-xs text-white/40">({c.primaryGenreName})</span>}
                    {c.artistLinkUrl && (
                      <a
                        href={c.artistLinkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-white/40 underline hover:text-white/70"
                      >
                        Apple Musicで見る
                      </a>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button
            type="submit"
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85"
          >
            選択したアーティストを登録する
          </button>
        </form>
      )}

      {notFoundNames.length > 0 && (
        <p className="mt-8 text-xs text-white/40">見つからなかった名前: {notFoundNames.join('、')}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add the entry-point link on the artist edit page**

In `app/admin/data/artists/[id]/edit/page.tsx`, find:

```tsx
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} を編集</h1>
```

Replace with:

```tsx
      <div className="flex items-center justify-between">
        <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
          ← 管理画面に戻る
        </Link>
        <Link
          href={`/admin/data/artists/${artist.id}/collaborators`}
          className="text-xs text-white/40 hover:text-white/70"
        >
          コラボアーティストを探す
        </Link>
      </div>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} を編集</h1>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify with Playwright against the real Yaffle case**

Yaffle (`MS_ART_brig42yo`, Apple Music ID `1156875724`) has confirmed collaborator credits including "MARICELLE" (a clean, single-result search match: Apple artist ID `1019986011`, not currently in the DB).

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
```

Create `/Users/th/dev/music-synapse/verify-collaborators.mjs`:

```js
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()

// 1. Entry point link on the edit page
await page.goto('http://localhost:3000/admin/data/artists/MS_ART_brig42yo/edit')
const linkVisible = await page.locator('a:has-text("コラボアーティストを探す")').isVisible()
console.log('ENTRY_LINK_VISIBLE:', linkVisible)
await page.click('a:has-text("コラボアーティストを探す")')
await page.waitForURL(/\/collaborators$/)

// 2. Known collaborator name appears as a heading
const body = await page.textContent('body')
console.log('MARICELLE_NAME_PRESENT:', body.includes('MARICELLE') || body.includes('Maricelle'))

// 3. The Maricelle candidate has a valid Apple Music link
const maricelleLink = await page.getAttribute('a:has-text("Apple Musicで見る")', 'href')
console.log('SOME_APPLE_LINK_PRESENT:', !!maricelleLink && maricelleLink.startsWith('https://music.apple.com/'))

// 4. Select the Maricelle radio button specifically (not "登録しない") and submit
const maricelleRow = page.locator('div', { hasText: 'MARICELLE' }).last()
await maricelleRow.locator('input[type="radio"][value="1019986011"]').check()
await page.click('button:has-text("選択したアーティストを登録する")')
await page.waitForURL(/\?success=/, { timeout: 60000 })

const afterSubmit = await page.textContent('body')
console.log('SUCCESS_BANNER_PRESENT:', afterSubmit.includes('件のアーティストを登録しました'))

await browser.close()
```

```bash
node verify-collaborators.mjs
rm verify-collaborators.mjs
```

Expected: `ENTRY_LINK_VISIBLE: true`, `MARICELLE_NAME_PRESENT: true`, `SOME_APPLE_LINK_PRESENT: true`, `SUCCESS_BANNER_PRESENT: true`.

Confirm Maricelle was actually imported (this is real, intended data — not test data to clean up, since the entire point of this feature is to import genuine collaborator artists):

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
  const { data } = await supabase.from('artist').select('id, name, apple_music_artist_id').eq('apple_music_artist_id', '1019986011').single();
  console.log('IMPORTED_ARTIST:', JSON.stringify(data));
})();
"
```

Expected: `IMPORTED_ARTIST` shows a row with `apple_music_artist_id: "1019986011"` and a name matching "Maricelle" (or its Japanese-localized equivalent, per the country=JP fix from the prior plan).

Also verify the already-registered-exclusion path: Yaffle's own name obviously shouldn't appear as a selectable candidate (it's filtered out by `extractCollaboratorNames` itself, matching Task 1's verified behavior), and re-visiting the collaborators page now that Maricelle is imported should no longer offer her as a candidate:

```bash
curl -s http://localhost:3000/admin/data/artists/MS_ART_brig42yo/collaborators | grep -c 'value="1019986011"'
```

Expected: `0` (Maricelle's candidate radio button no longer appears now that her `apple_music_artist_id` exists in the DB — confirms the existing-artist exclusion filter works, not just at design-time but against real freshly-imported data).

- [ ] **Step 6: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 7: Commit**

```bash
git add "app/admin/data/artists/[id]/collaborators" "app/admin/data/artists/[id]/edit/page.tsx"
git commit -m "Add collaborator artist discovery and selective import"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit` once more from the project root — expect zero errors.
- [ ] With the dev server running, visit `/admin/data/artists/MS_ART_brig42yo/edit`, confirm the "コラボアーティストを探す" link is present and leads to a working candidate review page.
- [ ] Confirm no leftover `app/api/_verify` route exists (`ls app/api` should not list `_verify`, or `app/api` should not exist at all if this is the only route ever added there).
- [ ] Confirm Maricelle (`apple_music_artist_id = '1019986011'`) exists in the `artist` table with her albums/tracks — this is real, intentionally-imported data from this plan's own verification, not something to delete.
- [ ] Stop the dev server: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`
