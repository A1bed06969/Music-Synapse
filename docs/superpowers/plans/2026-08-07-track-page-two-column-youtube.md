# Track Page Two-Column Layout + YouTube Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the track detail page's "紹介文 + プレーヤー" area into a two-column layout (left: track review, right: players), add a YouTube preview player, and normalize `youtube_video_id` input the same way `spotify_track_id` was normalized in the prior plan.

**Architecture:** Extend the existing `extractYoutubeVideoId` helper in `utils/format.ts` to also accept a bare 11-character video ID (not just a full URL), use it in `updateTrack` to normalize `youtube_video_id` before saving, and restructure the relevant block of `app/tracks/[id]/page.tsx` into a conditional 2-column grid.

**Tech Stack:** Next.js 16 App Router, React Server Components + Server Actions, Supabase, Tailwind CSS v4.

## Global Constraints

- Only the "紹介文 + プレーヤー" block changes layout. The header (artwork/title/artist/duration) above it and the 歌詞リンク/使用楽器/クレジット sections below it stay full-width, unchanged.
- The block becomes a 2-column grid (`grid-cols-1 sm:grid-cols-2`) ONLY when both `track.track_review` is present AND at least one player (YouTube/Apple Music/Spotify) is available. In every other case (only review, only players, or neither), it renders as a single full-width column — this avoids an unbalanced grid with an empty half.
- Player order, top to bottom: YouTube → Apple Music → Spotify. Each renders independently based on its own data availability.
- YouTube embed: `https://www.youtube.com/embed/{track.youtube_video_id}`, using the exact same iframe markup (wrapper div, `allow`, `allowFullScreen`, `loading`, `className`) as the existing "Latest MV" section on `app/artists/[id]/page.tsx` (lines ~279-293), for visual/behavioral consistency with that established pattern.
- `extractYoutubeVideoId`'s existing behavior for full URLs (`youtu.be/...`, `youtube.com/watch?v=...`, `youtube.com/embed/...`) must not change — only a new bare-ID acceptance path is added. The function is also used elsewhere for `artist.url_latest_mv`, which is always a full URL; that call site's behavior must be unaffected.
- No automated test suite exists in this project. Verify with `npx tsc --noEmit` and curl/Playwright against a running dev server with real data; any field temporarily set on a real row for verification must be reverted to its original value afterward and confirmed via a follow-up read.

---

## File Structure

- **Modify** `utils/format.ts` — extend `extractYoutubeVideoId` to accept a bare ID.
- **Modify** `app/admin/data/actions.ts` — `updateTrack` normalizes `youtube_video_id` via `extractYoutubeVideoId`.
- **Modify** `app/tracks/[id]/page.tsx` — 2-column layout, YouTube player, reordered players, removal of the now-redundant bottom `track_review` paragraph.

---

### Task 1: Normalize `youtube_video_id` on save

**Files:**
- Modify: `utils/format.ts`
- Modify: `app/admin/data/actions.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `extractYoutubeVideoId` now also accepts a bare 11-character YouTube video ID as input (previously only accepted full URLs). Consumed by Task 2 indirectly (Task 2 reads whatever `updateTrack` — modified in this task — has saved to `track.youtube_video_id`, which is now guaranteed to be a clean bare ID or `null`).

- [ ] **Step 1: Extend `extractYoutubeVideoId` to accept a bare ID**

In `utils/format.ts`, find:

```ts
export function extractYoutubeVideoId(url: string): string | null {
  const isValidId = (candidate: string | null): candidate is string =>
    candidate !== null && /^[\w-]{11}$/.test(candidate)

  try {
    const parsed = new URL(url)
```

Replace with:

```ts
export function extractYoutubeVideoId(url: string): string | null {
  const isValidId = (candidate: string | null): candidate is string =>
    candidate !== null && /^[\w-]{11}$/.test(candidate)

  const trimmed = url.trim()
  if (isValidId(trimmed)) return trimmed

  try {
    const parsed = new URL(trimmed)
```

(The rest of the function — the `youtu.be` and `youtube.com` branches, and the `catch` block — is unchanged. Only the two lines above are added, and `url` becomes `trimmed` in the `new URL(...)` call so the URL-parsing path also tolerates surrounding whitespace.)

- [ ] **Step 2: Normalize `youtube_video_id` in `updateTrack`**

In `app/admin/data/actions.ts`, find the import line:

```ts
import { extractSpotifyTrackId } from '@/utils/format'
```

Replace with:

```ts
import { extractSpotifyTrackId, extractYoutubeVideoId } from '@/utils/format'
```

Then find:

```ts
  const youtubeVideoId = String(formData.get('youtube_video_id') ?? '').trim()
```

Replace with:

```ts
  const youtubeVideoIdRaw = String(formData.get('youtube_video_id') ?? '').trim()
  const youtubeVideoId = youtubeVideoIdRaw ? extractYoutubeVideoId(youtubeVideoIdRaw) : null
```

Then find, inside the `.update({ ... })` payload:

```ts
      youtube_video_id: youtubeVideoId || null,
```

Replace with:

```ts
      youtube_video_id: youtubeVideoId,
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify with Playwright — bare ID and full URL both normalize correctly, then revert**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
```

Create `/Users/th/dev/music-synapse/verify-youtube-normalize.mjs` (project directory, not `/tmp`, so both `playwright` and `@supabase/supabase-js` resolve):

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

const browser = await chromium.launch()
const page = await browser.newPage()

async function submitAndCheck(label, inputValue) {
  await page.goto('http://localhost:3000/admin/data/tracks/MS_TRK_8bhguqq9/edit')
  await page.fill('input[name="youtube_video_id"]', inputValue)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/tracks\/MS_TRK_8bhguqq9\?success=/, { timeout: 10000 })
  const { data } = await supabase.from('track').select('youtube_video_id').eq('id', 'MS_TRK_8bhguqq9').single()
  console.log(`${label}:`, JSON.stringify(data))
}

// 1. Bare 11-character video ID — the NEW path this task adds. Must be tested
// directly: it's the one code path Step 1's change actually introduces.
await submitAndCheck('AFTER_BARE_ID_SUBMIT', 'tvInAbYvbDY')

// 2. Full YouTube watch URL — exercises the pre-existing URL-parsing path,
// confirming it still works unchanged after Step 1's edit.
await submitAndCheck('AFTER_FULL_URL_SUBMIT', 'https://www.youtube.com/watch?v=tvInAbYvbDY')

await browser.close()

// Revert
const { error } = await supabase.from('track').update({ youtube_video_id: null }).eq('id', 'MS_TRK_8bhguqq9')
if (error) {
  console.error('REVERT_FAILED', error.message)
  process.exit(1)
}
const { data: after } = await supabase.from('track').select('youtube_video_id').eq('id', 'MS_TRK_8bhguqq9').single()
console.log('AFTER_REVERT:', JSON.stringify(after))
```

```bash
node verify-youtube-normalize.mjs
rm verify-youtube-normalize.mjs
```

Expected: `AFTER_BARE_ID_SUBMIT: {"youtube_video_id":"tvInAbYvbDY"}` (the new bare-ID path works), `AFTER_FULL_URL_SUBMIT: {"youtube_video_id":"tvInAbYvbDY"}` (the pre-existing URL-parsing path still works after Step 1's edit), `AFTER_REVERT: {"youtube_video_id":null}`.

- [ ] **Step 5: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 6: Commit**

```bash
git add utils/format.ts app/admin/data/actions.ts
git commit -m "Normalize pasted YouTube URLs to a bare video ID in updateTrack"
```

---

### Task 2: Two-column layout with YouTube player on the track page

**Files:**
- Modify: `app/tracks/[id]/page.tsx`

**Interfaces:**
- Consumes: `track.youtube_video_id`, normalized to a clean bare ID or `null` by Task 1's `updateTrack` change.
- Produces: nothing consumed by later tasks — this is the final task in this plan.

- [ ] **Step 1: Compute `youtubeSrc`**

Find:

```tsx
  const appleMusicSrc =
    track.apple_music_track_id && album?.apple_music_album_id
      ? `https://embed.music.apple.com/jp/album/${encodeURIComponent(track.title)}/${album.apple_music_album_id}?i=${track.apple_music_track_id}`
      : null
```

Replace with:

```tsx
  const appleMusicSrc =
    track.apple_music_track_id && album?.apple_music_album_id
      ? `https://embed.music.apple.com/jp/album/${encodeURIComponent(track.title)}/${album.apple_music_album_id}?i=${track.apple_music_track_id}`
      : null

  const youtubeSrc = track.youtube_video_id ? `https://www.youtube.com/embed/${track.youtube_video_id}` : null
```

- [ ] **Step 2: Replace the players block with the 2-column layout**

Find:

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
```

Replace with:

```tsx
      {(track.track_review || youtubeSrc || appleMusicSrc || track.spotify_track_id) && (
        <div
          className={
            track.track_review && (youtubeSrc || appleMusicSrc || track.spotify_track_id)
              ? 'mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2'
              : 'mt-6'
          }
        >
          {track.track_review && <p className="text-sm leading-relaxed text-white/70">{track.track_review}</p>}
          {(youtubeSrc || appleMusicSrc || track.spotify_track_id) && (
            <div className="space-y-3">
              {youtubeSrc && (
                <div className="aspect-video overflow-hidden rounded-md bg-black">
                  <iframe
                    src={youtubeSrc}
                    title={track.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    loading="lazy"
                    className="h-full w-full"
                  />
                </div>
              )}
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
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 3: Remove the now-redundant bottom `track_review` paragraph**

Find (at the end of the file, just before the closing `</div>` / `)` / `}`):

```tsx
      {track.track_review && (
        <p className="mt-8 text-sm leading-relaxed text-white/70">{track.track_review}</p>
      )}
    </div>
  )
}
```

Replace with:

```tsx
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify the 2-column layout and player order with real + temporary test data**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
```

`MS_TRK_8bhguqq9` (Fujii Kaze, "Alfie") already has a real, populated `apple_music_track_id`/album `apple_music_album_id`, and currently has `track_review` and `youtube_video_id` both `null` (reverted by Task 1). Temporarily set both for this verification, using the real YouTube ID for "Alfie" (`tvInAbYvbDY`) confirmed via web search when this plan was written:

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
  const { error } = await supabase.from('track').update({
    track_review: 'プラン検証用テストレビュー',
    youtube_video_id: 'tvInAbYvbDY',
  }).eq('id', 'MS_TRK_8bhguqq9');
  if (error) { console.error('SETUP_FAILED', error.message); process.exit(1); }
  console.log('SETUP_OK');
})();
"
```

Then check the rendered page:

```bash
curl -s http://localhost:3000/tracks/MS_TRK_8bhguqq9 > /tmp/track-check.html
grep -oE 'grid-cols-1 gap-6 sm:grid-cols-2' /tmp/track-check.html
grep -oE 'プラン検証用テストレビュー' /tmp/track-check.html
grep -oE 'https://www\.youtube\.com/embed/tvInAbYvbDY' /tmp/track-check.html
grep -oE 'https://embed\.music\.apple\.com/jp/album/[^"]*' /tmp/track-check.html
```

Expected: the grid class appears (review + at least one player both present → 2-column active), the review text appears, the YouTube embed URL appears, and the Apple Music embed URL appears. Separately, confirm ordering — the YouTube `<iframe>` must appear before the Apple Music `<iframe>` in the raw HTML:

```bash
node -e "
const html = require('fs').readFileSync('/tmp/track-check.html', 'utf8');
const ytIndex = html.indexOf('youtube.com/embed');
const appleIndex = html.indexOf('embed.music.apple.com');
console.log('YOUTUBE_INDEX:', ytIndex);
console.log('APPLE_INDEX:', appleIndex);
console.log('YOUTUBE_BEFORE_APPLE:', ytIndex !== -1 && appleIndex !== -1 && ytIndex < appleIndex);
"
rm /tmp/track-check.html
```

Expected: `YOUTUBE_BEFORE_APPLE: true`.

Now verify the no-review case switches to full width (single column, no `grid-cols` class) by temporarily clearing `track_review` while keeping the players:

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
  const { error } = await supabase.from('track').update({ track_review: null }).eq('id', 'MS_TRK_8bhguqq9');
  if (error) { console.error('UPDATE_FAILED', error.message); process.exit(1); }
  console.log('REVIEW_CLEARED');
})();
"
curl -s http://localhost:3000/tracks/MS_TRK_8bhguqq9 | grep -c 'grid-cols-1 gap-6 sm:grid-cols-2'
```

Expected: `REVIEW_CLEARED` prints, and the grep count is `0` (no 2-column grid class present — players render full width in a single column).

- [ ] **Step 6: Revert all test data**

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
  const { error } = await supabase.from('track').update({
    track_review: null,
    youtube_video_id: null,
  }).eq('id', 'MS_TRK_8bhguqq9');
  if (error) { console.error('REVERT_FAILED', error.message); process.exit(1); }
  const { data } = await supabase.from('track').select('track_review, youtube_video_id').eq('id', 'MS_TRK_8bhguqq9').single();
  console.log('AFTER_REVERT:', JSON.stringify(data));
})();
"
```

Expected: `AFTER_REVERT: {"track_review":null,"youtube_video_id":null}`.

- [ ] **Step 7: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 8: Commit**

```bash
git add "app/tracks/[id]/page.tsx"
git commit -m "Add two-column layout and YouTube player to track detail page"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit` once more from the project root — expect zero errors.
- [ ] With the dev server running, visit `/tracks/MS_TRK_8bhguqq9` and confirm it renders normally (no review, no YouTube/Spotify data — only the Apple Music player, full width, no grid).
- [ ] Confirm `track.youtube_video_id` and `track.track_review` are both `null` for `MS_TRK_8bhguqq9` (Task 2 Step 6 already verified this, but re-check if anything was left behind).
- [ ] Stop the dev server: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`
