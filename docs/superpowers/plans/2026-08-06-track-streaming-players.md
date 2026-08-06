# Track Streaming Players Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Apple Music and Spotify preview players to the track detail page (`/tracks/[id]`), and a new admin edit form so `spotify_track_id` and other streaming/metadata fields (currently unfilled) can be registered.

**Architecture:** One new server action (`updateTrack`) added to the existing `app/admin/data/actions.ts`, one new edit page (`app/admin/data/tracks/[id]/edit/page.tsx`) mirroring the existing artist edit page, and additions to the existing `app/tracks/[id]/page.tsx` (an "編集" link, a success/error banner, and the two conditionally-rendered player iframes).

**Tech Stack:** Next.js 16 App Router, React Server Components + Server Actions, Supabase (`@supabase/ssr` for reads, `@supabase/supabase-js` service-role client for the write), Tailwind CSS v4.

## Global Constraints

- `track.apple_music_track_id` is populated on all 1834 tracks; `album.apple_music_album_id` is populated on all 387 albums. `track.spotify_track_id` and the other streaming-ID columns are currently unpopulated on every row.
- `apple_music_track_id` is the iTunes import's matching key and must never be user-editable (same rule as `artist.apple_music_artist_id` / `artist.name` on the existing artist edit form).
- Editable fields on the new track edit form: `spotify_track_id`, `amazon_music_track_id`, `youtube_music_track_id`, `bandcamp_track_id`, `soundcloud_track_id`, `tidal_track_id`, `youtube_video_id`, `lyric_url`, `isrc`, `bpm`, `track_review`.
- No `/admin/data` track list section — 1834 rows makes that impractical (unlike the 11-row artist list). The edit form is reached via an "編集" link placed directly on the public `/tracks/[id]` page instead.
- Apple Music embed storefront must be `jp` — the iTunes import pipeline (`utils/itunes.ts`) already queries `country=JP`, so Apple Music IDs are registered under the `jp` storefront.
- Apple Music embed URL format: `https://embed.music.apple.com/jp/album/{slug}/{albumId}?i={trackId}` — requires both `track.apple_music_track_id` and the track's album's `apple_music_album_id`. Render only when both are present.
- Spotify embed URL format: `https://open.spotify.com/embed/track/{spotifyTrackId}?utm_source=generator` — render only when `track.spotify_track_id` is present.
- Neither player has an empty-state message — if neither ID is available, the whole "試聴" section is omitted (not shown as an empty box).
- No automated test suite exists in this project. Verify with `npx tsc --noEmit` and curl/Playwright against a running dev server with real data; any field temporarily set on a real row for verification must be reverted to its original value afterward and confirmed via a follow-up read.

---

## File Structure

- **Modify** `app/admin/data/actions.ts` — add `updateTrack`.
- **Create** `app/admin/data/tracks/[id]/edit/page.tsx` — edit form for the 11 fields above.
- **Modify** `app/tracks/[id]/page.tsx` — add the "編集" link, a success/error banner, and the Apple Music / Spotify players.

---

### Task 1: `updateTrack` server action and edit page

**Files:**
- Modify: `app/admin/data/actions.ts`
- Create: `app/admin/data/tracks/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: the existing `createAdminClient`, `redirectWith` helpers, and `revalidatePath`/`redirect` imports already in `actions.ts`.
- Produces: `export async function updateTrack(formData: FormData)` in `app/admin/data/actions.ts`. Consumed by this task's own edit page (`<form action={updateTrack}>`) and by no other task.

- [ ] **Step 1: Append `updateTrack` to `app/admin/data/actions.ts`**

Append to the end of the file (after `updateArtist`):

```ts

export async function updateTrack(formData: FormData) {
  const trackId = String(formData.get('track_id') ?? '')

  if (!trackId) {
    redirectWith('error', '不正なリクエストです。')
  }

  const spotifyTrackId = String(formData.get('spotify_track_id') ?? '').trim()
  const amazonMusicTrackId = String(formData.get('amazon_music_track_id') ?? '').trim()
  const youtubeMusicTrackId = String(formData.get('youtube_music_track_id') ?? '').trim()
  const bandcampTrackId = String(formData.get('bandcamp_track_id') ?? '').trim()
  const soundcloudTrackId = String(formData.get('soundcloud_track_id') ?? '').trim()
  const tidalTrackId = String(formData.get('tidal_track_id') ?? '').trim()
  const youtubeVideoId = String(formData.get('youtube_video_id') ?? '').trim()
  const lyricUrl = String(formData.get('lyric_url') ?? '').trim()
  const isrc = String(formData.get('isrc') ?? '').trim()
  const bpmRaw = String(formData.get('bpm') ?? '').trim()
  const trackReview = String(formData.get('track_review') ?? '').trim()

  const bpmNum = Number(bpmRaw)
  const bpm = bpmRaw && !Number.isNaN(bpmNum) ? bpmNum : null

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('track')
    .update({
      spotify_track_id: spotifyTrackId || null,
      amazon_music_track_id: amazonMusicTrackId || null,
      youtube_music_track_id: youtubeMusicTrackId || null,
      bandcamp_track_id: bandcampTrackId || null,
      soundcloud_track_id: soundcloudTrackId || null,
      tidal_track_id: tidalTrackId || null,
      youtube_video_id: youtubeVideoId || null,
      lyric_url: lyricUrl || null,
      isrc: isrc || null,
      bpm,
      track_review: trackReview || null,
    })
    .eq('id', trackId)

  if (error) {
    redirect(`/tracks/${trackId}?error=${encodeURIComponent(`更新に失敗しました: ${error.message}`)}`)
  }

  revalidatePath(`/tracks/${trackId}`)
  redirect(`/tracks/${trackId}?success=${encodeURIComponent('トラック情報を更新しました。')}`)
}
```

Note: unlike every other action in this file, `updateTrack` redirects to `/tracks/${trackId}` on both success and error, not to `/admin/data` — there is no track list on `/admin/data` to return to, so this uses `redirect()` directly (already imported at the top of the file) instead of the shared `redirectWith` helper, except for the "missing trackId" guard clause, which still goes through `redirectWith('error', ...)` to `/admin/data` since there is no track id to build a `/tracks/{id}` URL with in that case.

- [ ] **Step 2: Create the edit page**

Create `app/admin/data/tracks/[id]/edit/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { updateTrack } from '@/app/admin/data/actions'

const inputClass =
  'w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'
const buttonClass =
  'rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85'

export default async function TrackEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: track, error } = await supabase
    .from('track')
    .select('*, artist:artist_id(name)')
    .eq('id', id)
    .single()

  if (error || !track) {
    notFound()
  }

  const artist = Array.isArray(track.artist) ? track.artist[0] : track.artist

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href={`/tracks/${id}`} className="text-xs text-white/40 hover:text-white/70">
        ← トラックに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{track.title} を編集</h1>
      {artist && <p className="mt-1 text-sm text-white/50">{artist.name}</p>}

      <form action={updateTrack} className="mt-8 space-y-4">
        <input type="hidden" name="track_id" value={track.id} />

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Spotify Track ID</label>
            <input name="spotify_track_id" defaultValue={track.spotify_track_id ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">YouTube Video ID</label>
            <input name="youtube_video_id" defaultValue={track.youtube_video_id ?? ''} className={inputClass} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Amazon Music Track ID</label>
            <input
              name="amazon_music_track_id"
              defaultValue={track.amazon_music_track_id ?? ''}
              className={inputClass}
            />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">YouTube Music Track ID</label>
            <input
              name="youtube_music_track_id"
              defaultValue={track.youtube_music_track_id ?? ''}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Bandcamp Track ID</label>
            <input name="bandcamp_track_id" defaultValue={track.bandcamp_track_id ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">SoundCloud Track ID</label>
            <input name="soundcloud_track_id" defaultValue={track.soundcloud_track_id ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Tidal Track ID</label>
            <input name="tidal_track_id" defaultValue={track.tidal_track_id ?? ''} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-white/40">歌詞URL</label>
          <input name="lyric_url" type="url" defaultValue={track.lyric_url ?? ''} className={inputClass} />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">ISRC</label>
            <input name="isrc" defaultValue={track.isrc ?? ''} className={inputClass} />
          </div>
          <div className="max-w-[140px] flex-1">
            <label className="mb-1 block text-xs text-white/40">BPM</label>
            <input name="bpm" type="number" step="0.1" defaultValue={track.bpm ?? ''} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-white/40">レビュー</label>
          <textarea name="track_review" rows={4} defaultValue={track.track_review ?? ''} className={inputClass} />
        </div>

        <button type="submit" className={buttonClass}>
          保存
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify with Playwright — edit, confirm persisted, then revert**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
```

Create `/Users/th/dev/music-synapse/verify-track-edit.mjs` (project directory, not `/tmp`, so `playwright` resolves):

```js
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()

await page.goto('http://localhost:3000/admin/data/tracks/MS_TRK_8bhguqq9/edit')
await page.fill('input[name="spotify_track_id"]', 'プラン検証用テストID')
await page.fill('input[name="isrc"]', 'TESTISRC0001')
await page.fill('input[name="bpm"]', '120')
await page.click('button[type="submit"]')
await page.waitForURL(/\/tracks\/MS_TRK_8bhguqq9\?success=/, { timeout: 10000 })

const body = await page.textContent('body')
console.log('SUCCESS_BANNER_PRESENT:', body.includes('トラック情報を更新しました。'))

await browser.close()
```

```bash
node verify-track-edit.mjs
rm verify-track-edit.mjs
```

Expected: `SUCCESS_BANNER_PRESENT: true`. (The banner itself doesn't exist on the track page yet — Task 2 adds it. If this line is `false` because the text isn't found anywhere, that's expected at this point; what matters here is that the redirect URL itself matched `?success=`, confirming the write succeeded. Note this in your report rather than treating a `false` banner-text check as a failure.)

Confirm the DB write directly, then revert it:

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
  const { data: before } = await supabase.from('track').select('spotify_track_id, isrc, bpm').eq('id', 'MS_TRK_8bhguqq9').single();
  console.log('BEFORE_REVERT:', JSON.stringify(before));
  const { error } = await supabase.from('track').update({ spotify_track_id: null, isrc: null, bpm: null }).eq('id', 'MS_TRK_8bhguqq9');
  if (error) { console.error('REVERT_FAILED', error.message); process.exit(1); }
  const { data: after } = await supabase.from('track').select('spotify_track_id, isrc, bpm').eq('id', 'MS_TRK_8bhguqq9').single();
  console.log('AFTER_REVERT:', JSON.stringify(after));
})();
"
```

Expected: `BEFORE_REVERT` shows `spotify_track_id: "プラン検証用テストID"`, `isrc: "TESTISRC0001"`, `bpm: 120` (confirming the form write worked). `AFTER_REVERT` shows all three as `null`.

- [ ] **Step 5: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 6: Commit**

```bash
git add app/admin/data/actions.ts "app/admin/data/tracks/[id]/edit/page.tsx"
git commit -m "Add updateTrack server action and track edit page"
```

---

### Task 2: Streaming players on the track detail page

**Files:**
- Modify: `app/tracks/[id]/page.tsx`

**Interfaces:**
- Consumes: the `/admin/data/tracks/{id}/edit` page from Task 1 (linked to, and used during this task's own verification to set a real Spotify ID).
- Produces: nothing consumed by later tasks — this is the final task in this plan.

- [ ] **Step 1: Add `apple_music_album_id` to the album select and add the `searchParams` prop**

Find:

```tsx
export default async function TrackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: track, error } = await supabase
    .from('track')
    .select('*, album:album_id(id, title, jacket_url), artist:artist_id(id, name)')
    .eq('id', id)
    .single()
```

Replace with:

```tsx
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
    .select('*, album:album_id(id, title, jacket_url, apple_music_album_id), artist:artist_id(id, name)')
    .eq('id', id)
    .single()
```

- [ ] **Step 2: Compute the Apple Music embed URL after the existing `album`/`artist` unwrap**

Find:

```tsx
  const album = Array.isArray(track.album) ? track.album[0] : track.album
  const artist = Array.isArray(track.artist) ? track.artist[0] : track.artist
```

Replace with:

```tsx
  const album = Array.isArray(track.album) ? track.album[0] : track.album
  const artist = Array.isArray(track.artist) ? track.artist[0] : track.artist

  const appleMusicSrc =
    track.apple_music_track_id && album?.apple_music_album_id
      ? `https://embed.music.apple.com/jp/album/${encodeURIComponent(track.title)}/${album.apple_music_album_id}?i=${track.apple_music_track_id}`
      : null
```

- [ ] **Step 3: Add the success/error banner and the "編集" link**

Find:

```tsx
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      {album && (
        <Link href={`/albums/${album.id}`} className="text-xs text-white/40 hover:text-white/70">
          ← {album.title}
        </Link>
      )}

      <div className="mt-4 flex items-start gap-5">
```

Replace with:

```tsx
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      {success && (
        <div className="mb-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      <div className="flex items-center justify-between">
        {album ? (
          <Link href={`/albums/${album.id}`} className="text-xs text-white/40 hover:text-white/70">
            ← {album.title}
          </Link>
        ) : (
          <span />
        )}
        <Link href={`/admin/data/tracks/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
          編集
        </Link>
      </div>

      <div className="mt-4 flex items-start gap-5">
```

- [ ] **Step 4: Add the 試聴 (players) section**

Find:

```tsx
      {track.lyric_url && (
        <a
          href={track.lyric_url}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-block rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:text-white"
        >
          歌詞を見る
        </a>
      )}
```

Replace with:

```tsx
      {(appleMusicSrc || track.spotify_track_id) && (
        <section className="mt-6 space-y-3">
          {appleMusicSrc && (
            <iframe
              allow="autoplay *; encrypted-media *; clipboard-write"
              frameBorder="0"
              height="175"
              style={{ width: '100%', maxWidth: '660px', overflow: 'hidden', borderRadius: '10px' }}
              sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
              src={appleMusicSrc}
              loading="lazy"
            />
          )}
          {track.spotify_track_id && (
            <iframe
              style={{ borderRadius: '12px' }}
              src={`https://open.spotify.com/embed/track/${track.spotify_track_id}?utm_source=generator`}
              width="100%"
              height="152"
              frameBorder="0"
              allowFullScreen
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
            />
          )}
        </section>
      )}

      {track.lyric_url && (
        <a
          href={track.lyric_url}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-block rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:text-white"
        >
          歌詞を見る
        </a>
      )}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify the Apple Music player (already-populated real data)**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
curl -s http://localhost:3000/tracks/MS_TRK_8bhguqq9 | grep -oE 'https://embed\.music\.apple\.com/jp/album/[^"]*'
```

Expected: one URL printed, containing `1565892276` (the album's `apple_music_album_id`) and ending in `?i=1565892285` (the track's `apple_music_track_id`).

- [ ] **Step 7: Verify the Spotify player end-to-end, using the edit page from Task 1, then revert**

```bash
cat > /Users/th/dev/music-synapse/verify-spotify-player.mjs <<'EOF'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()

// Set a real Spotify track ID via the edit page built in Task 1
await page.goto('http://localhost:3000/admin/data/tracks/MS_TRK_8bhguqq9/edit')
await page.fill('input[name="spotify_track_id"]', '0Vnq3CJ2Heh6IwQm09H2BI')
await page.click('button[type="submit"]')
await page.waitForURL(/\/tracks\/MS_TRK_8bhguqq9\?success=/, { timeout: 10000 })

const body = await page.textContent('body')
console.log('SUCCESS_BANNER_PRESENT:', body.includes('トラック情報を更新しました。'))

const spotifyIframeSrc = await page.getAttribute(
  'iframe[src*="open.spotify.com/embed/track/"]',
  'src'
)
console.log('SPOTIFY_IFRAME_SRC:', spotifyIframeSrc)
console.log('SPOTIFY_ID_CORRECT:', spotifyIframeSrc?.includes('0Vnq3CJ2Heh6IwQm09H2BI'))

await browser.close()
EOF
node verify-spotify-player.mjs
rm verify-spotify-player.mjs
```

Expected: `SUCCESS_BANNER_PRESENT: true` (this is the first point in the plan where the banner text actually exists on the page, since this task added it). `SPOTIFY_ID_CORRECT: true`.

Revert the test value:

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
  const { error } = await supabase.from('track').update({ spotify_track_id: null }).eq('id', 'MS_TRK_8bhguqq9');
  if (error) { console.error('REVERT_FAILED', error.message); process.exit(1); }
  const { data } = await supabase.from('track').select('spotify_track_id').eq('id', 'MS_TRK_8bhguqq9').single();
  console.log('AFTER_REVERT:', JSON.stringify(data));
})();
"
```

Expected: `AFTER_REVERT: {"spotify_track_id":null}`.

- [ ] **Step 8: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 9: Commit**

```bash
git add "app/tracks/[id]/page.tsx"
git commit -m "Add Apple Music and Spotify preview players to track detail page"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit` once more from the project root — expect zero errors.
- [ ] With the dev server running, visit `/tracks/MS_TRK_8bhguqq9` and confirm the Apple Music player renders (Spotify should not, since it was reverted to null).
- [ ] Visit `/admin/data/tracks/MS_TRK_8bhguqq9/edit`, confirm all 11 fields render with their current (empty, except any pre-existing data) values.
- [ ] Confirm `track.spotify_track_id`, `isrc`, and `bpm` are back to `null` for `MS_TRK_8bhguqq9` (both tasks' verification steps already confirmed this, but re-check if anything was left behind).
- [ ] Stop the dev server: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`
