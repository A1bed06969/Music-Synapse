# Artist Detail Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/artists/[id]` with a reorganized header (subscribe + SNS links), a sectioned Biography/Discography/Latest MV layout, and an embedded live relation-graph preview — structure only, keeping the app's existing dark theme.

**Architecture:** All changes live in the existing Server Component `app/artists/[id]/page.tsx` plus one new nullable column on `artist` and one new pure helper in `utils/format.ts`. No new components: the existing `app/components/RelationGraph.tsx` client component is reused unmodified inside a narrower container so its SVG (which sizes from `viewBox`, not fixed pixels) naturally renders as a small preview.

**Tech Stack:** Next.js 16 App Router, React Server Components, Supabase (`@supabase/ssr`), Tailwind CSS v4.

## Global Constraints

- Keep the existing dark theme (black background, white text, existing pill/border/hover conventions). Do NOT adopt the design concept's light paper color scheme or serif fonts — this was an explicit design decision, not an oversight.
- Live Info, Festival Appearances, and Chronology sections are out of scope for this plan (spec: "非ゴール" — they need new schema/tables and are deferred to a future spec). Do not add stub/placeholder sections for them.
- No new admin edit form for `artist`. `url_latest_mv` is populated directly in Supabase (dashboard or `execute_sql`), the same way `bio` / `official_site_url` already are.
- No automated test suite exists in this project (confirmed convention). Verify with `npx tsc --noEmit`, targeted `node -e` checks for pure functions, and Playwright/curl against the running dev server — not new test files.
- Do not modify `app/components/RelationGraph.tsx`. It already renders responsively from its internal `viewBox="0 0 800 560"`; the mini-preview is achieved purely by constraining the width of its parent container.
- Section order (top to bottom): Header → Biography → Discography → Latest MV → Relation Graph. (Latest MV sits below Discography per explicit instruction — do not place it near the top.)
- Remove the existing inline "🔗 相関図を見る" header link once the Relation Graph section exists, to avoid two links pointing at the same destination.

---

## File Structure

- **Modify** `utils/format.ts` — add `extractYoutubeVideoId(url: string): string | null`.
- **Modify** `app/artists/[id]/page.tsx` — header reorg, local `SectionDivider` helper, Biography/Discography restyle, new Latest MV section, new Relation Graph preview section. This is the only page file touched.
- **Schema** — add `artist.url_latest_mv` (text, nullable) via SQL run against the project's Supabase instance.

---

### Task 1: Add `url_latest_mv` column to `artist`

**Files:**
- None in the repo — this is a database schema change.

**Interfaces:**
- Produces: `artist.url_latest_mv` (text, nullable), consumed by Task 5.

- [ ] **Step 1: Run the migration**

If a Supabase MCP tool (e.g. `execute_sql`) is available in your environment, use it to run:

```sql
alter table artist add column url_latest_mv text;
```

If no such tool is available, ask your human partner to run that statement via the Supabase dashboard SQL editor, and wait for confirmation before continuing.

- [ ] **Step 2: Verify the column exists**

Run this from the project root (reads `.env.local` directly, no new dependency):

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
supabase.from('artist').select('id, url_latest_mv').limit(1).then(({ data, error }) => {
  if (error) { console.error('ERROR', error); process.exit(1); }
  console.log('OK', JSON.stringify(data));
});
"
```

Expected: `OK [...]` with no error (the `url_latest_mv` key is present in the returned row, even if `null`).

- [ ] **Step 3: Set a real, stable YouTube URL on one artist row for later verification, and note it**

This project's convention is to test against real rows rather than throwaway data, and to clean up anything that isn't real content afterward. Since no artist has `url_latest_mv` set yet, temporarily set a known-stable public YouTube video (YouTube's own oldest video, guaranteed to keep working) on Fujii Kaze (`MS_ART_yu7eev56`) purely to prove the embed mechanism in Task 5 — this is NOT meant to be kept as real data, and must be cleared again at the end of Task 5's verification.

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
supabase.from('artist').update({ url_latest_mv: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }).eq('id', 'MS_ART_yu7eev56').select().then(({ data, error }) => {
  if (error) { console.error('ERROR', error); process.exit(1); }
  console.log('UPDATED', JSON.stringify(data));
});
"
```

Expected: `UPDATED [...]` showing `url_latest_mv` set on the Fujii Kaze row.

No commit for this task (schema-only, no repo files changed).

---

### Task 2: `extractYoutubeVideoId` helper

**Files:**
- Modify: `utils/format.ts`

**Interfaces:**
- Produces: `export function extractYoutubeVideoId(url: string): string | null`. Consumed by Task 5.

- [ ] **Step 1: Add the function**

Append to the end of `utils/format.ts`:

```ts
export function extractYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1) || null
    }
    if (parsed.hostname.endsWith('youtube.com')) {
      const v = parsed.searchParams.get('v')
      if (v) return v
      const embedMatch = parsed.pathname.match(/^\/embed\/([^/]+)/)
      if (embedMatch) return embedMatch[1]
    }
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Verify with a few inline cases**

Plain Node can't `require()` a `.ts` file directly, so verify the logic with a throwaway copy of the same function body:

```bash
node -e "
function extractYoutubeVideoId(url) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1) || null
    }
    if (parsed.hostname.endsWith('youtube.com')) {
      const v = parsed.searchParams.get('v')
      if (v) return v
      const embedMatch = parsed.pathname.match(/^\/embed\/([^/]+)/)
      if (embedMatch) return embedMatch[1]
    }
    return null
  } catch {
    return null
  }
}
console.log(extractYoutubeVideoId('https://www.youtube.com/watch?v=jNQXAC9IVRw')) // expect jNQXAC9IVRw
console.log(extractYoutubeVideoId('https://youtu.be/jNQXAC9IVRw')) // expect jNQXAC9IVRw
console.log(extractYoutubeVideoId('https://www.youtube.com/embed/jNQXAC9IVRw')) // expect jNQXAC9IVRw
console.log(extractYoutubeVideoId('not a url')) // expect null
console.log(extractYoutubeVideoId('https://example.com/watch?v=abc')) // expect null
"
```

Expected output (5 lines): `jNQXAC9IVRw`, `jNQXAC9IVRw`, `jNQXAC9IVRw`, `null`, `null`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add utils/format.ts
git commit -m "Add extractYoutubeVideoId helper for artist MV embeds"
```

---

### Task 3: Header reorganization

**Files:**
- Modify: `app/artists/[id]/page.tsx:77-96`

**Interfaces:**
- Consumes: `artist.apple_music_artist_id`, `artist.spotify_artist_id`, `artist.official_site_url`, `artist.sns_x_url`, `artist.sns_instagram_url` (all already selected via the existing `select('*')`).
- Produces: nothing new consumed by later tasks — this only touches the header block.

- [ ] **Step 1: Replace the links row**

Find this block (current lines 77-96):

```tsx
          <div className="mt-3 flex gap-3 text-xs text-white/40">
            {artist.official_site_url && (
              <a href={artist.official_site_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                公式サイト
              </a>
            )}
            {artist.sns_x_url && (
              <a href={artist.sns_x_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                X
              </a>
            )}
            {artist.sns_instagram_url && (
              <a href={artist.sns_instagram_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                Instagram
              </a>
            )}
            <Link href={`/artists/${artist.id}/relations`} className="hover:text-white/70">
              🔗 相関図を見る
            </Link>
          </div>
```

Replace with (subscribe row, then SNS row, relation link removed):

```tsx
          <div className="mt-3 flex flex-wrap gap-2">
            {artist.apple_music_artist_id && (
              <a
                href={`https://music.apple.com/jp/artist/${encodeURIComponent(artist.name)}/${artist.apple_music_artist_id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5"
              >
                ▶ Apple Music
              </a>
            )}
            {artist.spotify_artist_id && (
              <a
                href={`https://open.spotify.com/artist/${artist.spotify_artist_id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5"
              >
                ▶ Spotify
              </a>
            )}
          </div>

          <div className="mt-3 flex gap-3 text-xs text-white/40">
            {artist.official_site_url && (
              <a href={artist.official_site_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                公式サイト
              </a>
            )}
            {artist.sns_x_url && (
              <a href={artist.sns_x_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                X
              </a>
            )}
            {artist.sns_instagram_url && (
              <a href={artist.sns_instagram_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                Instagram
              </a>
            )}
          </div>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify with curl against the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
nohup npm run dev > /tmp/music-synapse-dev.log 2>&1 &
disown
for i in $(seq 1 40); do
  if curl -sf http://localhost:3000 >/dev/null; then echo "SERVER UP"; break; fi
  sleep 1
done
curl -s http://localhost:3000/artists/MS_ART_yu7eev56 | grep -o 'Apple Music'
```

Expected: `Apple Music` appears in the output (Fujii Kaze has `apple_music_artist_id` set). Check `tail -30 /tmp/music-synapse-dev.log` for no server errors. Leave the dev server running for the next tasks.

- [ ] **Step 4: Commit**

```bash
git add app/artists/\[id\]/page.tsx
git commit -m "Reorganize artist header into subscribe row and SNS row"
```

---

### Task 4: `SectionDivider` helper + Biography/Discography restyle

**Files:**
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Produces: local function `SectionDivider({ label }: { label: string })` (not exported — used only within this file). Consumed by Task 5 and Task 6.

- [ ] **Step 1: Add the `SectionDivider` helper**

Add this function above `export default async function ArtistDetailPage` (after the existing imports, so it sits near the top of the file):

```tsx
function SectionDivider({ label }: { label: string }) {
  return (
    <div className="mt-10 flex items-center gap-3">
      <span className="h-1 w-1 rounded-full bg-white/40" />
      <span className="flex-1 border-t border-white/10" />
      <span className="text-xs uppercase tracking-wide text-white/40">{label}</span>
    </div>
  )
}
```

- [ ] **Step 2: Restyle the Biography section**

Find:

```tsx
      {artist.bio && <p className="mt-8 text-sm leading-relaxed text-white/70">{artist.bio}</p>}
```

Replace with:

```tsx
      {artist.bio && (
        <>
          <SectionDivider label="Biography" />
          <p className="mt-4 text-sm leading-relaxed text-white/70">{artist.bio}</p>
        </>
      )}
```

- [ ] **Step 3: Restyle the Discography section**

Find this block (the existing `<section>` wrapping the album grid):

```tsx
      <section className="mt-10">
        <h2 className="text-lg font-semibold">アルバム</h2>
        {!albums || albums.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">まだアルバムが登録されていません。</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {albums.map((album) => (
              <Link key={album.id} href={`/albums/${album.id}`} className="group block">
                <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                  {album.jacket_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={album.jacket_url}
                      alt={album.title}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/20">
                      No Art
                    </div>
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-medium">{album.title}</p>
                <p className="text-xs text-white/40">{formatDate(album.release_date)}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
```

Replace with (divider instead of `<section>`/`<h2>`, horizontal-scroll row instead of grid):

```tsx
      <SectionDivider label="Discography" />
      {!albums || albums.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">まだアルバムが登録されていません。</p>
      ) : (
        <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
          {albums.map((album) => (
            <Link key={album.id} href={`/albums/${album.id}`} className="group block w-28 flex-shrink-0">
              <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                {album.jacket_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={album.jacket_url}
                    alt={album.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/20">
                    No Art
                  </div>
                )}
              </div>
              <p className="mt-2 truncate text-sm font-medium">{album.title}</p>
              <p className="text-xs text-white/40">{formatDate(album.release_date)}</p>
            </Link>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify with curl**

```bash
curl -s http://localhost:3000/artists/MS_ART_yu7eev56 | grep -oE 'Biography|Discography'
```

Expected: both `Biography` and `Discography` appear in the output (the `uppercase` class is CSS-only styling — the actual text node rendered is `Biography`/`Discography`). Fujii Kaze (`MS_ART_yu7eev56`) has both a `bio` and 31 albums, so both sections render.

- [ ] **Step 6: Verify Discography scrolls with Playwright**

```bash
cat > /tmp/verify-discography-scroll.mjs <<'EOF'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
await page.goto('http://localhost:3000/artists/MS_ART_yu7eev56')
await page.waitForTimeout(500)

const row = page.locator('div.overflow-x-auto').first()
const scrollWidth = await row.evaluate((el) => el.scrollWidth)
const clientWidth = await row.evaluate((el) => el.clientWidth)
console.log('SCROLL_WIDTH:', scrollWidth, 'CLIENT_WIDTH:', clientWidth)
await browser.close()
EOF
node /tmp/verify-discography-scroll.mjs
rm /tmp/verify-discography-scroll.mjs
```

Expected: `SCROLL_WIDTH` is noticeably larger than `CLIENT_WIDTH` (31 albums at `w-28` plus gaps far exceeds the `max-w-3xl` page width), confirming the row overflows horizontally rather than wrapping.

- [ ] **Step 7: Commit**

```bash
git add app/artists/\[id\]/page.tsx
git commit -m "Add SectionDivider and restyle Biography/Discography sections"
```

---

### Task 5: Latest MV section

**Files:**
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Consumes: `extractYoutubeVideoId` from `utils/format.ts` (Task 2), `SectionDivider` from Task 4, `artist.url_latest_mv` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the helper**

Find:

```ts
import { formatDate, ARTIST_STREAMING_STATUS_LABEL, ARTIST_TYPE_LABEL } from '@/utils/format'
```

Replace with:

```ts
import { formatDate, extractYoutubeVideoId, ARTIST_STREAMING_STATUS_LABEL, ARTIST_TYPE_LABEL } from '@/utils/format'
```

- [ ] **Step 2: Compute the video ID after the artist/albums fetch**

Find:

```tsx
  if (error || !artist) {
    notFound()
  }

  return (
```

Replace with:

```tsx
  if (error || !artist) {
    notFound()
  }

  const mvVideoId = artist.url_latest_mv ? extractYoutubeVideoId(artist.url_latest_mv) : null

  return (
```

- [ ] **Step 3: Render the section after Discography**

Insert immediately after the Discography block added in Task 4 (right after its closing `)}` and before the final closing `</div>` of the page), so the JSX reads:

```tsx
        </div>
      )}

      {mvVideoId && (
        <>
          <SectionDivider label="Latest MV" />
          <div className="mt-4 aspect-video overflow-hidden rounded-md bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${mvVideoId}`}
              title={`${artist.name} Latest MV`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
        </>
      )}
    </div>
  )
}
```

(The `</div>\n  )\n}` at the end already exists as the page's closing tags — only the `{mvVideoId && (...)}` block is new, inserted before them.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify the embed renders**

```bash
curl -s http://localhost:3000/artists/MS_ART_yu7eev56 | grep -o 'youtube.com/embed/jNQXAC9IVRw'
```

Expected: `youtube.com/embed/jNQXAC9IVRw` appears (the test video URL set on Fujii Kaze in Task 1, Step 3).

Then verify a different artist with no `url_latest_mv` set does NOT render the section:

```bash
curl -s http://localhost:3000/artists/MS_ART_5kji9c1a | grep -o 'Latest MV'
```

Expected: no output (Kenshi Yonezu, `MS_ART_5kji9c1a`, has no `url_latest_mv` set, so the section must not render).

- [ ] **Step 6: Clean up the test MV URL**

This was only set to prove the embed mechanism (Task 1, Step 3) — clear it now that it's verified:

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
supabase.from('artist').update({ url_latest_mv: null }).eq('id', 'MS_ART_yu7eev56').select().then(({ data, error }) => {
  if (error) { console.error('ERROR', error); process.exit(1); }
  console.log('CLEARED', JSON.stringify(data));
});
"
```

Expected: `CLEARED [...]` showing `url_latest_mv` back to `null`.

- [ ] **Step 7: Commit**

```bash
git add app/artists/\[id\]/page.tsx utils/format.ts
git commit -m "Add Latest MV section to artist detail page"
```

---

### Task 6: Relation Graph mini-preview

**Files:**
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Consumes: `RelationGraph`, `RelationEdge`, `RelationNode` from `app/components/RelationGraph.tsx` (existing, unmodified). `SectionDivider` from Task 4.
- Produces: nothing consumed by later tasks — this is the final section of the page.

- [ ] **Step 1: Add the import**

Find:

```ts
import { formatDate, extractYoutubeVideoId, ARTIST_STREAMING_STATUS_LABEL, ARTIST_TYPE_LABEL } from '@/utils/format'
```

Add immediately after it:

```ts
import RelationGraph, { type RelationEdge, type RelationNode } from '@/app/components/RelationGraph'
```

- [ ] **Step 2: Fetch relation data alongside the existing artist/album fetch**

Find:

```tsx
  const [{ data: artist, error }, { data: albums }] = await Promise.all([
    supabase.from('artist').select('*').eq('id', id).single(),
    supabase
      .from('album')
      .select('id, title, jacket_url, release_date, album_type')
      .eq('artist_id', id)
      .order('release_date', { ascending: false, nullsFirst: false }),
  ])

  if (error || !artist) {
    notFound()
  }

  const mvVideoId = artist.url_latest_mv ? extractYoutubeVideoId(artist.url_latest_mv) : null
```

Replace with (adds a third parallel query for this artist's relations, then the same follow-up pattern already used by `app/artists/[id]/relations/page.tsx` to resolve the other side of each relation and its genre category):

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

  const mvVideoId = artist.url_latest_mv ? extractYoutubeVideoId(artist.url_latest_mv) : null

  const otherIds = Array.from(
    new Set((relations ?? []).map((r) => (r.artist_id_a === id ? r.artist_id_b : r.artist_id_a)))
  )

  const { data: others } = otherIds.length
    ? await supabase.from('artist').select('id, name').in('id', otherIds)
    : { data: [] }

  const allRelationArtistIds = [id, ...otherIds]
  const { data: artistGenres } = await supabase
    .from('artist_genre')
    .select('artist_id, genre:genre_id(name)')
    .in('artist_id', allRelationArtistIds)

  const categoryByArtist = new Map<string, string>()
  for (const row of artistGenres ?? []) {
    if (categoryByArtist.has(row.artist_id)) continue
    const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
    if (genre?.name) categoryByArtist.set(row.artist_id, genre.name)
  }

  const relationNodes: RelationNode[] = [{ id: artist.id, name: artist.name }, ...(others ?? [])].map((a) => ({
    id: a.id,
    name: a.name,
    category: categoryByArtist.get(a.id) ?? null,
  }))
  const relationEdges: RelationEdge[] = (relations ?? []).map((r) => ({
    source: r.artist_id_a,
    target: r.artist_id_b,
    style: (r.relation_style as 'solid' | 'dotted') ?? 'solid',
    label: r.description ?? r.relation_type,
  }))
```

- [ ] **Step 3: Render the section as the last thing on the page**

Find the end of the file:

```tsx
      {mvVideoId && (
        <>
          <SectionDivider label="Latest MV" />
          <div className="mt-4 aspect-video overflow-hidden rounded-md bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${mvVideoId}`}
              title={`${artist.name} Latest MV`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
        </>
      )}
    </div>
  )
}
```

Replace with (adds the Relation Graph section after Latest MV, before the page's closing tags):

```tsx
      {mvVideoId && (
        <>
          <SectionDivider label="Latest MV" />
          <div className="mt-4 aspect-video overflow-hidden rounded-md bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${mvVideoId}`}
              title={`${artist.name} Latest MV`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
        </>
      )}

      <SectionDivider label="Relation Graph" />
      <div className="mt-4 max-w-sm overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
        <RelationGraph nodes={relationNodes} edges={relationEdges} centerId={artist.id} />
      </div>
      <Link
        href={`/artists/${artist.id}/relations`}
        className="mt-2 block text-right text-xs text-white/40 hover:text-white/70"
      >
        相関図を全画面で見る →
      </Link>
    </div>
  )
}
```

Note: the container is constrained by `max-w-sm` (width), not a fixed height. `RelationGraph`'s internal `<svg>` has no explicit `height` attribute — only `viewBox="0 0 800 560"` and `className="w-full"` — so a narrower parent shrinks its rendered height proportionally rather than clipping it. Do not wrap it in a fixed-height `overflow-hidden` container instead; that would crop the graph rather than shrink it.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify with Playwright — the full page end to end**

```bash
cat > /tmp/verify-artist-detail.mjs <<'EOF'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } })
await page.goto('http://localhost:3000/artists/MS_ART_yu7eev56')
await page.waitForTimeout(600)

console.log('APPLE_MUSIC_BUTTON:', await page.locator('text=Apple Music').count())
console.log('BIOGRAPHY_DIVIDER:', await page.locator('text=Biography').count())
console.log('DISCOGRAPHY_DIVIDER:', await page.locator('text=Discography').count())
console.log('RELATION_DIVIDER:', await page.locator('text=Relation Graph').count())
console.log('RELATION_SVG_NODE_COUNT:', await page.locator('a[href^="/artists/"] svg circle, svg circle').count())
console.log('FULLSCREEN_LINK:', await page.locator('text=相関図を全画面で見る').count())

const graphBox = await page.locator('svg').last().boundingBox()
console.log('RELATION_SVG_BOX:', JSON.stringify(graphBox))

await page.locator('text=相関図を全画面で見る').click()
await page.waitForURL(/\/relations$/, { timeout: 5000 })
console.log('NAVIGATED_TO:', page.url())

await page.screenshot({ path: '/tmp/artist-detail-final.png', fullPage: true })
await browser.close()
EOF
node /tmp/verify-artist-detail.mjs
```

Expected: all counts are at least `1`, `RELATION_SVG_BOX` shows a `width` around 384 (the `max-w-sm` container) with a proportionally smaller `height` (roughly `width * 560/800`, i.e. no severe clipping), and `NAVIGATED_TO` ends in `/artists/MS_ART_yu7eev56/relations`. View `/tmp/artist-detail-final.png` to confirm the page reads correctly top to bottom, then delete it and the script:

```bash
rm /tmp/artist-detail-final.png /tmp/verify-artist-detail.mjs
```

- [ ] **Step 6: Stop the dev server**

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 7: Commit**

```bash
git add app/artists/\[id\]/page.tsx
git commit -m "Add relation graph mini-preview to artist detail page"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit` once more from the project root — expect zero errors.
- [ ] With the dev server running, visit `/artists/MS_ART_yu7eev56` in a real browser and confirm the section order top to bottom: header (with Apple Music button, no relation link) → Biography → Discography (horizontal scroll) → Relation Graph mini-preview with a working "相関図を全画面で見る" link. Confirm Latest MV does not appear (its test value was cleared in Task 5).
- [ ] Confirm `/artists/MS_ART_5kji9c1a` (an artist with no relations and no `url_latest_mv`) still renders without errors, with Relation Graph showing its existing empty state ("まだ相関データがありません。") and no Latest MV section.
- [ ] Stop the dev server: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`
