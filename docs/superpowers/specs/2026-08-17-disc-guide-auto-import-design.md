# Disc Guide Album Auto-Import System Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically extract album metadata from disc guide page images via Tesseract OCR, match against existing database, enable user confirmation with light edits, and register to disc_guide_selection with automatic artist bulk import when needed.

**Architecture:** Three-stage pipeline — (1) Image OCR + structured extraction, (2) Album matching with user-facing confirmation UI in admin panel (one page at a time), (3) Registration + automatic artist bulk import for unregistered artists. Disc guide metadata (title, ISBN, cover image from Google Books API) stored separately. Supports large batch ingestion (4,400 pages across 44 guides) via staged rollout (one guide at a time for validation).

**Tech Stack:** Next.js 16.2.12, Tesseract.js (OCR), Google Books API (cover images), Supabase (PostgreSQL), TypeScript, Tailwind CSS.

## Global Constraints

- **Database:** PostgreSQL via Supabase. No breaking schema changes to existing tables.
- **OCR:** Tesseract.js (local, free). No external API calls for OCR (cost constraint).
- **Album matching:** User selects from candidates (not auto-matched) to handle name variations (e.g., 日本語 vs romaji).
- **Unregistered artists:** Auto-trigger iTunes bulk-import pipeline (after() job) if artist missing during disc_guide_selection registration.
- **Unregistered albums:** Create new album records (all streaming IDs null) when not found in database.
- **Disc guide cover:** Fetch via Google Books API using ISBN. Fallback to placeholder if not found.
- **Confirmation UI:** Staged one-page-at-a-time (not all-at-once) in admin dashboard; list shows pending pages, user clicks one to confirm/edit.
- **Deferred text display:** "〇〇ガイドに掲載" on album detail page (no page number).
- **Rollout strategy:** One guide at a time; validate before proceeding to next.

---

## Database Design

### New Table: `disc_guide_scan_pending`

Temporary storage for OCR-extracted album data awaiting user confirmation. Records remain until user approves and registers.

```sql
CREATE TABLE disc_guide_scan_pending (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('DGS'::text),
  disc_guide_id TEXT NOT NULL REFERENCES disc_guide(id) ON DELETE CASCADE,
  
  -- Image metadata
  image_filename TEXT NOT NULL,
  image_url TEXT, -- signed URL or CDN path for display
  
  -- OCR extraction (JSON array of album entries)
  extracted_data JSONB NOT NULL, -- format: [{ title, artist_name, label, release_year, ... }]
  extraction_confidence FLOAT, -- 0.0-1.0, based on Tesseract quality
  
  -- Album matching results
  matched_data JSONB NOT NULL, -- format: [{ extracted_index, album_id?, artist_id?, candidates: [...] }]
  
  -- User confirmation state
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'confirmed', 'registered'
  confirmed_data JSONB, -- user-edited extraction + selections (confirmed_data.*.album_id set by user)
  confirmation_notes TEXT,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  confirmed_by TEXT, -- user ID
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_disc_guide_scan_pending_disc_guide_id ON disc_guide_scan_pending(disc_guide_id);
CREATE INDEX idx_disc_guide_scan_pending_status ON disc_guide_scan_pending(status);
```

### Modified Table: `disc_guide`

Add cover image URL (fetched from Google Books API).

```sql
ALTER TABLE disc_guide ADD COLUMN cover_image_url TEXT;
ALTER TABLE disc_guide ADD COLUMN cover_image_fetched_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE disc_guide ADD COLUMN isbn_lookup_error TEXT; -- null if success, error message if failed
```

### Existing Table: `disc_guide_selection`

No schema changes. Album registration flows directly from confirmed_data in disc_guide_scan_pending.

---

## System Architecture

### Overall Flow

```
1. User creates disc_guide (title, publisher, ISBN, published_year)
   ↓
2. System auto-fetches cover image from Google Books API (by ISBN)
   - Success: store cover_image_url in disc_guide
   - Fail: set isbn_lookup_error, display placeholder in UI
   ↓
3. User uploads 1+ page images for the guide (100 images = 1 full guide)
   ↓
4. Each image → Tesseract OCR (async, background job)
   → Extract album entries (title, artist, label, year)
   → Save to disc_guide_scan_pending (status='pending')
   ↓
5. Admin dashboard lists disc_guide_scan_pending records
   User clicks one page → confirmation UI
   ↓
6. Confirmation UI (one page at a time):
   a) Show OCR-extracted text (title, artist, label, year for each album)
   b) User fixes typos (light edits only, not structural changes)
   c) For each album: dropdown to select matching album from DB
      - If no match: option to create new (unregistered) album
      - Includes artist name + confirmation
   d) User submits confirmation
   ↓
7. On confirmation:
   a) Save confirmed_data + album selections to disc_guide_scan_pending
   b) For each album entry:
      - If album_id selected: use that album
      - If new album + artist exists: create album (streaming IDs all null)
      - If new album + artist missing: create both, trigger iTunes bulk import
   c) Register all to disc_guide_selection (disc_guide_id, album_id, note=null)
   d) After() job: if any artists were bulk-imported, run autoImportArtistProfileFromMusicBrainz()
   e) Update disc_guide_scan_pending status='registered'
   ↓
8. Album detail page (/albums/[id]):
   - Query disc_guide_selection for this album_id
   - Display "〇〇ガイドに掲載" for each matching guide
   ↓
9. Disc guide detail page (new):
   - Show disc_guide cover image
   - Group registered albums by section (e.g., "Jazz", "Electronic")
   - Display album thumbnails + titles
```

---

## Backend Components

### 1. Disc Guide Cover Image Fetch (Google Books API)

**When:** During disc_guide creation (via app/admin/data/discguides/actions.ts)

**API:** Google Books API (`https://www.googleapis.com/books/v1/volumes`)

**Flow:**
```typescript
// On disc_guide creation
const isbn = formData.get('isbn');
if (isbn) {
  after(async () => {
    try {
      const coverUrl = await fetchGoogleBooksCover(isbn);
      await supabase.from('disc_guide').update({ cover_image_url: coverUrl }).eq('isbn', isbn);
    } catch (err) {
      await supabase.from('disc_guide').update({ isbn_lookup_error: err.message }).eq('isbn', isbn);
    }
  });
}
```

**Error handling:** If API fails or ISBN not found, isbn_lookup_error is set; UI shows placeholder cover.

### 2. Image Upload & Tesseract OCR (Background Job)

**Endpoint:** `POST /api/admin/disc-guide-scan/upload`

**Input:** 
- disc_guide_id
- image files (multiple)

**Flow:**
```typescript
// In background job (after() handler)
for (const file of files) {
  // 1. Upload to storage (Supabase Storage or CDN)
  const imageUrl = await uploadImage(file, `disc-guides/${disc_guide_id}/`);
  
  // 2. Run Tesseract OCR
  const ocrResult = await performOCR(imageUrl);
  // Returns: { text: "...", confidence: 0.85, blocks: [...] }
  
  // 3. Parse OCR text → structured album data
  const extracted = await parseOCRToAlbums(ocrResult.text);
  // Returns: [{ title, artist_name, label, release_year }, ...]
  
  // 4. Match against existing albums (get candidates)
  const matched = await matchAlbumsWithCandidates(extracted);
  // Returns: [{ extracted_index, album_id?, artist_id?, candidates: [...] }, ...]
  
  // 5. Save to disc_guide_scan_pending
  await supabase.from('disc_guide_scan_pending').insert({
    disc_guide_id,
    image_filename: file.name,
    image_url: imageUrl,
    extracted_data: extracted,
    extraction_confidence: ocrResult.confidence,
    matched_data: matched,
    status: 'pending'
  });
}
```

**Album matching logic:**
- For each extracted album (title, artist):
  - Query album table: `title = extracted.title AND artist.name = extracted.artist_name`
  - If exact match (or 1 candidate): return as primary
  - If multiple candidates: return top 3 by similarity score
  - If no match: return empty candidates array

**OCR parsing strategy:**
- Tesseract outputs raw text
- Parse by heuristics (format detection: "Title / Artist / Label (Year)")
- Clean up: trim whitespace, detect Japanese/romaji
- Fallback: manual review if confidence < 0.7

### 3. Album Matching & Candidate Generation

**Endpoint:** `POST /api/admin/disc-guide-scan/match`

**Input:** disc_guide_scan_pending.id

**Logic:**
```typescript
async function matchAlbumsWithCandidates(extracted: AlbumExtract[]): Promise<MatchResult[]> {
  const results: MatchResult[] = [];
  
  for (const entry of extracted) {
    // Query by artist + title
    const { data: albums } = await supabase
      .from('album')
      .select('id, title, artist:artist_id(id, name)')
      .ilike('title', `%${entry.title}%`)
      .limit(10);
    
    const artistMatches = albums?.filter(
      a => a.artist.name.includes(entry.artist_name) || entry.artist_name.includes(a.artist.name)
    ) || [];
    
    const candidates = artistMatches.slice(0, 3);
    const primaryMatch = candidates[0];
    
    results.push({
      extracted_index: extracted.indexOf(entry),
      album_id: primaryMatch?.id || null,
      artist_id: primaryMatch?.artist.id || null,
      candidates: candidates.map(c => ({ id: c.id, title: c.title, artist_name: c.artist.name }))
    });
  }
  
  return results;
}
```

### 4. Confirmation UI & API

**Admin page:** `app/admin/data/discguides/confirm/page.tsx`

**Flow:**
- List all `disc_guide_scan_pending` records with status='pending' (grouped by disc_guide)
- Click one record → detail view with OCR-extracted albums
- For each album:
  - Show: extracted title, artist, label, year (editable for typos only)
  - Dropdown: select matching album from `candidates`
  - Option: "Create new album for unregistered entry"
- Submit → confirmation API

**Confirmation API:** `POST /api/admin/disc-guide-scan/confirm`

**Input:**
```typescript
{
  pending_id: string,
  confirmed_data: {
    albums: [
      {
        extracted_index: number,
        title: string,
        artist_name: string,
        label?: string,
        year?: number,
        album_id?: string, // user selected from candidates or null
        create_new_album?: boolean // if true, create new
      }
    ]
  }
}
```

**Output:** Status + summary (e.g., "5 albums confirmed, 2 new albums to create")

### 5. Registration & Auto-Bulk-Import

**Endpoint:** `POST /api/admin/disc-guide-scan/register`

**Input:** pending_id (confirmed record)

**Flow:**
```typescript
// 1. Load confirmed_data from disc_guide_scan_pending
const pending = await supabase.from('disc_guide_scan_pending')
  .select('*').eq('id', pending_id).single();
const confirmed = pending.confirmed_data;

// 2. Create albums & register selections
const bulkImportArtistIds: string[] = [];

for (const albumData of confirmed.albums) {
  let albumId = albumData.album_id;
  
  if (!albumId && albumData.create_new_album) {
    // Get or create artist
    let artistId = albumData.artist_id;
    if (!artistId) {
      // Artist missing: create + mark for bulk import
      const { data: newArtist } = await supabase.from('artist')
        .insert({ name: albumData.artist_name })
        .select('id').single();
      artistId = newArtist.id;
      bulkImportArtistIds.push(artistId);
    }
    
    // Create album (unregistered: all streaming IDs null)
    const { data: newAlbum } = await supabase.from('album')
      .insert({
        artist_id: artistId,
        title: albumData.title,
        release_date: albumData.year ? `${albumData.year}-01-01` : null,
        album_type: 'other'
      })
      .select('id').single();
    albumId = newAlbum.id;
  }
  
  // Register to disc_guide_selection
  await supabase.from('disc_guide_selection').insert({
    disc_guide_id: pending.disc_guide_id,
    album_id: albumId,
    note: null
  });
}

// 3. Update pending status
await supabase.from('disc_guide_scan_pending')
  .update({ status: 'registered', confirmed_at: new Date() })
  .eq('id', pending_id);

// 4. Trigger bulk import for new artists
if (bulkImportArtistIds.length > 0) {
  after(async () => {
    for (const artistId of bulkImportArtistIds) {
      try {
        const result = await autoImportArtistProfileFromMusicBrainz(supabase, artistId);
        console.log(`Auto-import for artist ${artistId}: ${result}`);
      } catch (err) {
        console.error(`Auto-import failed for artist ${artistId}:`, err);
      }
    }
  });
}
```

---

## Admin UI Pages

### 1. Disc Guide Create/Edit
**Path:** `app/admin/data/discguides/page.tsx`

**Additions:**
- ISBN field (triggers Google Books cover fetch)
- Progress indicator (cover fetch status)
- Upload images button (trigger OCR batch job)

### 2. Disc Guide Scan Confirmation
**Path:** `app/admin/data/discguides/confirm/page.tsx` (new)

**Layout:**
```
┌─ Pending Scans ─────────────────┐
│ Guide: "DJ Culture"             │
│ ├─ Page 10-11 [2 albums]        │  ← Click to open
│ ├─ Page 12-13 [3 albums]        │
│ └─ Page 14-15 [1 album]         │
└─────────────────────────────────┘

┌─ Confirmation Detail ───────────┐
│ Page: 10-11                     │
│ Confidence: 85%                 │
│                                  │
│ Album 1:                        │
│ Title: [Hoping For The Sun]     │
│ Artist: [DJ Takemura]           │
│ Label: Global Jazz              │
│ Year: 1992                      │
│                                  │
│ Match Album:                    │
│ ┌─ Dropdown ──────────────────┐ │
│ │ Search: (showing 3 candidates)
│ │ ☑ Hoping For The Sun / DJ T.  │
│ │ ☐ For Tomorrow / Takemura     │
│ │ ☐ [Create new album]          │
│ └──────────────────────────────┘ │
│                                  │
│ [Album 2] [Album 3]...          │
│                                  │
│ [Cancel] [Save Confirmation]    │
└─────────────────────────────────┘
```

**States:**
- `pending` → show in list, clickable
- `confirmed` → show in list, badge "確認済み", non-clickable
- `registered` → remove from list, show in "Completed" section

### 3. Album Detail Page Enhancement
**Path:** `app/albums/[id]/page.tsx`

**Addition:**
```typescript
const { data: guideSelections } = await supabase
  .from('disc_guide_selection')
  .select('disc_guide:disc_guide_id(id, title, cover_image_url)')
  .eq('album_id', albumId);

// Display in page:
{guideSelections?.map(sel => (
  <div key={sel.disc_guide_id}>
    <img src={sel.disc_guide.cover_image_url} alt={sel.disc_guide.title} />
    <p>{sel.disc_guide.title}に掲載</p>
  </div>
))}
```

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| **Google Books API fails** | Set isbn_lookup_error, show placeholder cover, allow manual override later |
| **Tesseract confidence < 0.6** | Mark extraction_confidence low, highlight in confirmation UI for extra review |
| **Album match confidence < 0.5** | Don't auto-select, show all candidates, require user selection |
| **Artist not found on creation** | Create new artist record, trigger bulk import (primary flow) |
| **Artist bulk import fails** | Log error, continue; manual fix available later |
| **Image upload fails** | Retry up to 3x, then fail gracefully with error message |
| **Confirmation API timeout** | Partial state saved; user can retry |

---

## Implementation Strategy (Staged Rollout)

### Phase 1: Single Guide Validation
1. Create 1 disc_guide with ISBN
2. Upload 5-10 page images
3. Run through confirmation UI
4. Verify:
   - Cover image fetches correctly
   - Tesseract accuracy acceptable
   - User confirmation flow smooth
   - Albums register correctly
   - Auto-bulk-import triggers for new artists

### Phase 2: Rollout to Next Guides
- If Phase 1 OK: proceed to guide 2, 3, etc. (one per week)
- Monitor: OCR failures, matching issues, user feedback
- Adjust heuristics as needed (e.g., parsing rules for different guide formats)

### Phase 3: Full Batch (44 Guides × 100 Pages)
- Once confident, batch-upload remaining guides
- Monitor job queue, completion time, resource usage

---

## Testing Checklist

- [ ] Google Books API cover fetch (success + failure cases)
- [ ] Tesseract OCR on sample pages (accuracy, confidence scoring)
- [ ] Album matching: exact match, partial match, no match cases
- [ ] Confirmation UI: edit, select from candidates, create new album
- [ ] Artist creation + auto-bulk-import trigger
- [ ] disc_guide_selection registration (verify data integrity)
- [ ] Album detail page: display guide info correctly
- [ ] Error cases: malformed images, API timeouts, invalid ISBN

---

## Future Enhancements (Out of Scope)

- Batch confirmation (multiple pages at once)
- Confidence-based auto-approval (skip confirmation for high-confidence extractions)
- Guide sections/categorization (e.g., "Jazz", "Electronic")
- Duplicate detection (same album in multiple guides)
- Batch export/import of disc_guide_selection data
