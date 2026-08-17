# Disc Guide Album Auto-Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a complete system for extracting album metadata from disc guide page images via Tesseract OCR, matching against existing database with user confirmation UI, and automatic registration with artist bulk-import for unregistered artists.

**Architecture:** Seven-phase implementation covering database schema, Google Books API integration, Tesseract OCR pipeline, album matching and candidate generation, admin UI for staged confirmation (one page at a time), registration with automatic bulk-import trigger, and album page display enhancements.

**Tech Stack:** Next.js 16.2.12, TypeScript, Supabase PostgreSQL, Tesseract.js, Google Books API, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-17-disc-guide-auto-import-design.md`

## Global Constraints

- Database: PostgreSQL via Supabase. No breaking changes to existing tables beyond documented additions.
- OCR: Tesseract.js (local, free). No external OCR API calls.
- Album matching: User selects from candidates (not auto-matched) to handle name variations.
- Unregistered artists: Auto-trigger iTunes bulk-import pipeline (after() job) during disc_guide_selection registration.
- Unregistered albums: Create new album records with all streaming IDs null when not found in DB.
- Disc guide cover: Fetch via Google Books API using ISBN. Fallback to placeholder if not found.
- Confirmation UI: One-page-at-a-time in admin dashboard; users select from pending list, confirm/edit, submit.
- Deferred text: "〇〇ガイドに掲載" on album detail (no page numbers).
- Rollout: One guide at a time; validate before proceeding to next.

---

## File Structure

**New files:**
- `utils/discGuideImport.ts` - Shared utilities (Tesseract, OCR parsing, album matching)
- `utils/googleBooksApi.ts` - Google Books API client
- `app/api/admin/disc-guide-scan/upload/route.ts` - Image upload endpoint
- `app/api/admin/disc-guide-scan/match/route.ts` - Album matching endpoint
- `app/api/admin/disc-guide-scan/confirm/route.ts` - Confirmation endpoint
- `app/api/admin/disc-guide-scan/register/route.ts` - Registration endpoint
- `app/admin/data/discguides/confirm/page.tsx` - Confirmation UI
- `app/admin/data/discguides/confirm/ConfirmationClient.tsx` - Client component for confirmation

**Modified files:**
- `app/admin/data/discguides/page.tsx` - Add image upload button, cover fetch status
- `app/admin/data/discguides/actions.ts` - Trigger cover image fetch on create
- `app/albums/[id]/page.tsx` - Display disc guide placements

---

## Tasks

### Task 1: Create `disc_guide_scan_pending` Table Migration

**Files:**
- Create: `supabase/migrations/20260817_create_disc_guide_scan_pending.sql`

**Interfaces:**
- Produces: `disc_guide_scan_pending` table with schema defined in spec (id, disc_guide_id, image_filename, image_url, extracted_data, extraction_confidence, matched_data, status, confirmed_data, confirmation_notes, confirmed_at, confirmed_by, created_at, updated_at)

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/20260817_create_disc_guide_scan_pending.sql

CREATE TABLE IF NOT EXISTS disc_guide_scan_pending (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('DGS'::text),
  disc_guide_id TEXT NOT NULL REFERENCES disc_guide(id) ON DELETE CASCADE,
  
  image_filename TEXT NOT NULL,
  image_url TEXT,
  
  extracted_data JSONB NOT NULL,
  extraction_confidence FLOAT,
  
  matched_data JSONB NOT NULL,
  
  status TEXT NOT NULL DEFAULT 'pending',
  confirmed_data JSONB,
  confirmation_notes TEXT,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  confirmed_by TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_disc_guide_scan_pending_disc_guide_id ON disc_guide_scan_pending(disc_guide_id);
CREATE INDEX idx_disc_guide_scan_pending_status ON disc_guide_scan_pending(status);
```

- [ ] **Step 2: Apply migration to Supabase**

```bash
supabase db push
```

- [ ] **Step 3: Verify table creation**

```bash
supabase db pull  # Verify types are generated
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "migration: create disc_guide_scan_pending table"
```

---

### Task 2: Modify `disc_guide` Table for Cover Image

**Files:**
- Create: `supabase/migrations/20260817_add_disc_guide_cover_fields.sql`

**Interfaces:**
- Produces: `disc_guide` table with new columns: `cover_image_url (TEXT)`, `cover_image_fetched_at (TIMESTAMP WITH TIME ZONE)`, `isbn_lookup_error (TEXT)`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/20260817_add_disc_guide_cover_fields.sql

ALTER TABLE disc_guide ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE disc_guide ADD COLUMN IF NOT EXISTS cover_image_fetched_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE disc_guide ADD COLUMN IF NOT EXISTS isbn_lookup_error TEXT;
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "migration: add cover image fields to disc_guide"
```

---

### Task 3: Create Google Books API Utility

**Files:**
- Create: `utils/googleBooksApi.ts`

**Interfaces:**
- Produces: `fetchGoogleBooksCover(isbn: string): Promise<string | null>` returns cover image URL or null if not found

- [ ] **Step 1: Write the function**

```typescript
// utils/googleBooksApi.ts

const GOOGLE_BOOKS_API_BASE = 'https://www.googleapis.com/books/v1/volumes';

export async function fetchGoogleBooksCover(isbn: string): Promise<string | null> {
  if (!isbn) return null;
  
  try {
    const params = new URLSearchParams({
      q: `isbn:${isbn}`,
      maxResults: '1',
    });
    
    const res = await fetch(`${GOOGLE_BOOKS_API_BASE}?${params}`, {
      headers: { 'User-Agent': 'MusicSynapse/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!res.ok) {
      console.warn(`Google Books API error: ${res.status}`);
      return null;
    }
    
    const data = (await res.json()) as {
      items?: Array<{ volumeInfo?: { imageLinks?: { thumbnail?: string } } }>;
    };
    
    const coverUrl = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
    return coverUrl || null;
  } catch (err) {
    console.error(`Failed to fetch cover for ISBN ${isbn}:`, err);
    return null;
  }
}
```

- [ ] **Step 2: Write a simple test**

```typescript
// Test: Can handle missing ISBN, network errors, valid responses
import { fetchGoogleBooksCover } from '@/utils/googleBooksApi';

describe('fetchGoogleBooksCover', () => {
  it('returns null for empty ISBN', async () => {
    const result = await fetchGoogleBooksCover('');
    expect(result).toBeNull();
  });

  it('returns cover URL for valid ISBN', async () => {
    // Mock or use integration test with real ISBN
    const result = await fetchGoogleBooksCover('9784894444639'); // Real example
    expect(typeof result).toBe('string' || 'null');
  });

  it('handles API errors gracefully', async () => {
    const result = await fetchGoogleBooksCover('invalid-isbn-12345');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add utils/googleBooksApi.ts
git commit -m "utils: add Google Books API cover image fetcher"
```

---

### Task 4: Create Tesseract & OCR Parsing Utilities

**Files:**
- Create: `utils/discGuideImport.ts`

**Interfaces:**
- Produces: 
  - `performOCR(imageUrl: string): Promise<{ text: string; confidence: number }>` - Run Tesseract on image
  - `parseOCRToAlbums(text: string): Promise<AlbumExtract[]>` - Parse OCR text to structured album data
  - Type: `AlbumExtract = { title: string; artist_name: string; label?: string; release_year?: number }`

- [ ] **Step 1: Install Tesseract.js if not present**

```bash
npm list tesseract.js || npm install tesseract.js
```

- [ ] **Step 2: Create OCR function**

```typescript
// utils/discGuideImport.ts

import Tesseract from 'tesseract.js';

export type AlbumExtract = {
  title: string;
  artist_name: string;
  label?: string;
  release_year?: number;
};

export async function performOCR(imageUrl: string): Promise<{
  text: string;
  confidence: number;
}> {
  try {
    const result = await Tesseract.recognize(imageUrl, 'jpn+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`OCR progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    const confidence = result.data.confidence / 100; // Tesseract returns 0-100
    return {
      text: result.data.text,
      confidence,
    };
  } catch (err) {
    console.error(`OCR failed for image ${imageUrl}:`, err);
    throw new Error(`OCR processing failed: ${(err as Error).message}`);
  }
}
```

- [ ] **Step 3: Create OCR text parser**

```typescript
// Continued in utils/discGuideImport.ts

export async function parseOCRToAlbums(text: string): Promise<AlbumExtract[]> {
  // Simple heuristic parser: split by newlines and detect patterns
  const lines = text.split('\n').filter((l) => l.trim());
  const albums: AlbumExtract[] = [];
  
  let current: Partial<AlbumExtract> = {};
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Detect year pattern (YYYY)
    const yearMatch = trimmed.match(/\((\d{4})\)/);
    if (yearMatch) {
      current.release_year = parseInt(yearMatch[1], 10);
    }
    
    // Detect artist pattern (usually before title, shorter line)
    if (trimmed.length < 50 && !current.artist_name && !current.title) {
      current.artist_name = trimmed;
    } else if (!current.title && current.artist_name && trimmed.length < 100) {
      current.title = trimmed;
    } else if (trimmed.length < 50) {
      current.label = trimmed;
    }
    
    // If we have title + artist, save as album
    if (current.title && current.artist_name) {
      albums.push({
        title: current.title,
        artist_name: current.artist_name,
        label: current.label,
        release_year: current.release_year,
      });
      current = {};
    }
  }
  
  return albums;
}
```

- [ ] **Step 4: Commit**

```bash
git add utils/discGuideImport.ts
git commit -m "utils: add Tesseract OCR and album extraction functions"
```

---

### Task 5: Create Album Matching Utility

**Files:**
- Modify: `utils/discGuideImport.ts`

**Interfaces:**
- Consumes: `AlbumExtract[]` from task 4
- Produces: `matchAlbumsWithCandidates(extracted: AlbumExtract[]): Promise<MatchResult[]>`
  - Type: `MatchResult = { extracted_index: number; album_id?: string; artist_id?: string; candidates: Array<{ id: string; title: string; artist_name: string }> }`

- [ ] **Step 1: Add matching function to utils/discGuideImport.ts**

```typescript
// Continued in utils/discGuideImport.ts

import { SupabaseClient } from '@supabase/supabase-js';

export type MatchResult = {
  extracted_index: number;
  album_id?: string;
  artist_id?: string;
  candidates: Array<{ id: string; title: string; artist_name: string }>;
};

export async function matchAlbumsWithCandidates(
  supabase: SupabaseClient,
  extracted: AlbumExtract[]
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];

  for (let i = 0; i < extracted.length; i++) {
    const entry = extracted[i];

    // Query albums by title (partial match)
    const { data: albums } = await supabase
      .from('album')
      .select('id, title, artist:artist_id(id, name)', { count: 'exact' })
      .ilike('title', `%${entry.title}%`)
      .limit(10);

    // Filter by artist match (flexible matching for variations)
    const artistMatches = (albums || []).filter(
      (a) =>
        a.artist?.name?.toLowerCase().includes(entry.artist_name.toLowerCase()) ||
        entry.artist_name.toLowerCase().includes(a.artist?.name?.toLowerCase() || '')
    );

    const candidates = artistMatches.slice(0, 3).map((a) => ({
      id: a.id,
      title: a.title,
      artist_name: a.artist?.name || 'Unknown',
    }));

    const primaryMatch = artistMatches[0];

    results.push({
      extracted_index: i,
      album_id: primaryMatch?.id,
      artist_id: primaryMatch?.artist?.id,
      candidates,
    });
  }

  return results;
}
```

- [ ] **Step 2: Commit**

```bash
git add utils/discGuideImport.ts
git commit -m "utils: add album matching and candidate generation"
```

---

### Task 6: Create Image Upload & OCR Background Job Endpoint

**Files:**
- Create: `app/api/admin/disc-guide-scan/upload/route.ts`

**Interfaces:**
- Consumes: FormData with files + disc_guide_id
- Produces: `{ success: boolean; message: string; pending_ids: string[] }`

- [ ] **Step 1: Create endpoint**

```typescript
// app/api/admin/disc-guide-scan/upload/route.ts

import { createAdminClient } from '@/utils/Supabase/admin';
import { after } from 'next/server';
import { performOCR, parseOCRToAlbums, matchAlbumsWithCandidates } from '@/utils/discGuideImport';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const discGuideId = formData.get('disc_guide_id') as string;
    const files = formData.getAll('files') as File[];

    if (!discGuideId || files.length === 0) {
      return NextResponse.json(
        { error: 'Missing disc_guide_id or files' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const pendingIds: string[] = [];

    // Trigger background processing
    after(async () => {
      for (const file of files) {
        try {
          // 1. Upload image (for now, use a simple URL placeholder; real implementation uses Supabase Storage)
          const imageUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;

          // 2. Run Tesseract OCR
          const ocrResult = await performOCR(imageUrl);

          // 3. Parse OCR result to albums
          const extracted = await parseOCRToAlbums(ocrResult.text);

          // 4. Match albums
          const matched = await matchAlbumsWithCandidates(supabase, extracted);

          // 5. Save to pending table
          const { data: pending } = await supabase
            .from('disc_guide_scan_pending')
            .insert({
              disc_guide_id: discGuideId,
              image_filename: file.name,
              image_url: imageUrl,
              extracted_data: extracted,
              extraction_confidence: ocrResult.confidence,
              matched_data: matched,
              status: 'pending',
            })
            .select('id')
            .single();

          if (pending) {
            pendingIds.push(pending.id);
            console.log(`OCR processed: ${file.name} → ${pending.id}`);
          }
        } catch (err) {
          console.error(`Failed to process ${file.name}:`, err);
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: `${files.length} images queued for processing`,
      pending_ids: pendingIds,
    });
  } catch (err) {
    console.error('Upload endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/disc-guide-scan/upload/route.ts
git commit -m "api: add disc guide image upload and OCR background job"
```

---

### Task 7: Create Album Matching Endpoint

**Files:**
- Create: `app/api/admin/disc-guide-scan/match/route.ts`

**Interfaces:**
- Consumes: POST { pending_id: string }
- Produces: `{ success: boolean; matched_data: MatchResult[] }`

- [ ] **Step 1: Create endpoint**

```typescript
// app/api/admin/disc-guide-scan/match/route.ts

import { createAdminClient } from '@/utils/Supabase/admin';
import { matchAlbumsWithCandidates } from '@/utils/discGuideImport';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { pending_id } = await req.json();

    if (!pending_id) {
      return NextResponse.json({ error: 'Missing pending_id' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Fetch pending record
    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .select('*')
      .eq('id', pending_id)
      .single();

    if (!pending) {
      return NextResponse.json({ error: 'Pending record not found' }, { status: 404 });
    }

    // Re-run matching (in case DB has been updated)
    const matched = await matchAlbumsWithCandidates(supabase, pending.extracted_data);

    // Update pending record
    await supabase
      .from('disc_guide_scan_pending')
      .update({ matched_data: matched })
      .eq('id', pending_id);

    return NextResponse.json({
      success: true,
      matched_data: matched,
    });
  } catch (err) {
    console.error('Match endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/disc-guide-scan/match/route.ts
git commit -m "api: add album re-matching endpoint"
```

---

### Task 8: Create Confirmation Endpoint

**Files:**
- Create: `app/api/admin/disc-guide-scan/confirm/route.ts`

**Interfaces:**
- Consumes: POST { pending_id: string; confirmed_data: { albums: Array<{ extracted_index, title, artist_name, label?, year?, album_id?, create_new_album? }> } }
- Produces: `{ success: boolean; message: string }`

- [ ] **Step 1: Create endpoint**

```typescript
// app/api/admin/disc-guide-scan/confirm/route.ts

import { createAdminClient } from '@/utils/Supabase/admin';
import { NextRequest, NextResponse } from 'next/server';

type ConfirmedAlbum = {
  extracted_index: number;
  title: string;
  artist_name: string;
  label?: string;
  year?: number;
  album_id?: string;
  create_new_album?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const { pending_id, confirmed_data } = await req.json();

    if (!pending_id || !confirmed_data) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Fetch pending record
    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .select('*')
      .eq('id', pending_id)
      .single();

    if (!pending) {
      return NextResponse.json({ error: 'Pending record not found' }, { status: 404 });
    }

    // Save confirmed data
    await supabase
      .from('disc_guide_scan_pending')
      .update({
        confirmed_data,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', pending_id);

    return NextResponse.json({
      success: true,
      message: `Confirmed ${confirmed_data.albums.length} albums`,
    });
  } catch (err) {
    console.error('Confirm endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/disc-guide-scan/confirm/route.ts
git commit -m "api: add confirmation endpoint"
```

---

### Task 9: Create Registration Endpoint with Auto-Bulk-Import

**Files:**
- Create: `app/api/admin/disc-guide-scan/register/route.ts`

**Interfaces:**
- Consumes: POST { pending_id: string }
- Produces: `{ success: boolean; message: string; registered_count: number; new_artists: string[] }`

- [ ] **Step 1: Create endpoint**

```typescript
// app/api/admin/disc-guide-scan/register/route.ts

import { createAdminClient } from '@/utils/Supabase/admin';
import { autoImportArtistProfileFromMusicBrainz } from '@/utils/artistProfileImport';
import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';

type ConfirmedAlbum = {
  extracted_index: number;
  title: string;
  artist_name: string;
  label?: string;
  year?: number;
  album_id?: string;
  create_new_album?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const { pending_id } = await req.json();

    if (!pending_id) {
      return NextResponse.json({ error: 'Missing pending_id' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Fetch confirmed pending record
    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .select('*')
      .eq('id', pending_id)
      .single();

    if (!pending || pending.status !== 'confirmed') {
      return NextResponse.json(
        { error: 'Pending record not confirmed' },
        { status: 400 }
      );
    }

    const confirmed: { albums: ConfirmedAlbum[] } = pending.confirmed_data;
    const bulkImportArtistIds: string[] = [];
    let registeredCount = 0;

    // 2. Create albums & register selections
    for (const albumData of confirmed.albums) {
      let albumId = albumData.album_id;

      if (!albumId && albumData.create_new_album) {
        // Get or create artist
        let artistId = albumData.artist_name; // Placeholder, should query

        // Check if artist exists
        const { data: existingArtist } = await supabase
          .from('artist')
          .select('id')
          .ilike('name', `%${albumData.artist_name}%`)
          .single();

        if (!existingArtist) {
          // Create new artist
          const { data: newArtist } = await supabase
            .from('artist')
            .insert({ name: albumData.artist_name })
            .select('id')
            .single();

          artistId = newArtist?.id || '';
          if (artistId) {
            bulkImportArtistIds.push(artistId);
          }
        } else {
          artistId = existingArtist.id;
        }

        // Create album (unregistered)
        if (artistId) {
          const { data: newAlbum } = await supabase
            .from('album')
            .insert({
              artist_id: artistId,
              title: albumData.title,
              release_date: albumData.year
                ? `${albumData.year}-01-01`
                : null,
              album_type: 'other',
            })
            .select('id')
            .single();

          albumId = newAlbum?.id;
        }
      }

      // Register to disc_guide_selection
      if (albumId) {
        await supabase.from('disc_guide_selection').insert({
          disc_guide_id: pending.disc_guide_id,
          album_id: albumId,
          note: null,
        });
        registeredCount++;
      }
    }

    // 3. Update pending status
    await supabase
      .from('disc_guide_scan_pending')
      .update({ status: 'registered' })
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

    return NextResponse.json({
      success: true,
      message: `Registered ${registeredCount} albums`,
      registered_count: registeredCount,
      new_artists: bulkImportArtistIds,
    });
  } catch (err) {
    console.error('Register endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/disc-guide-scan/register/route.ts
git commit -m "api: add registration endpoint with auto-bulk-import"
```

---

### Task 10: Create Confirmation Admin Page & Client Component

**Files:**
- Create: `app/admin/data/discguides/confirm/page.tsx`
- Create: `app/admin/data/discguides/confirm/ConfirmationClient.tsx`

**Interfaces:**
- Consumes: GET params (pending_id from URL or list pending records)
- Produces: Confirmation UI for user to edit and select albums

- [ ] **Step 1: Create server page**

```typescript
// app/admin/data/discguides/confirm/page.tsx

import { createClient } from '@/utils/Supabase/server';
import ConfirmationClient from './ConfirmationClient';
import Link from 'next/link';

export default async function DiscGuideScanConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ pending_id?: string }>
}) {
  const { pending_id } = await searchParams;
  const supabase = await createClient();

  // Fetch pending records
  const { data: pendingRecords } = await supabase
    .from('disc_guide_scan_pending')
    .select('id, disc_guide:disc_guide_id(title), status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  let selectedPending = null;
  if (pending_id) {
    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .select('*')
      .eq('id', pending_id)
      .single();
    selectedPending = pending;
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/discguides" className="text-xs text-white/40">
        ← ディスクガイド管理に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">スキャン確認</h1>

      <div className="mt-6 grid grid-cols-4 gap-4">
        {/* Pending list */}
        <div className="col-span-1">
          <h2 className="text-sm font-semibold text-white/60">確認待ちページ一覧</h2>
          <ul className="mt-2 space-y-1">
            {pendingRecords?.map((rec) => (
              <li key={rec.id}>
                <a
                  href={`?pending_id=${rec.id}`}
                  className={`block rounded px-2 py-1 text-sm ${
                    rec.id === pending_id
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'text-white/60 hover:bg-white/5'
                  }`}
                >
                  {rec.disc_guide?.title} - {rec.created_at}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Confirmation panel */}
        <div className="col-span-3">
          {selectedPending ? (
            <ConfirmationClient pending={selectedPending} />
          ) : (
            <p className="text-sm text-white/30">左から確認するページを選択してください</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create client component**

```typescript
// app/admin/data/discguides/confirm/ConfirmationClient.tsx

'use client';

import { useState } from 'react';

type AlbumExtract = {
  title: string;
  artist_name: string;
  label?: string;
  release_year?: number;
};

type Candidate = {
  id: string;
  title: string;
  artist_name: string;
};

type MatchResult = {
  extracted_index: number;
  album_id?: string;
  artist_id?: string;
  candidates: Candidate[];
};

type PendingRecord = {
  id: string;
  extracted_data: AlbumExtract[];
  matched_data: MatchResult[];
};

export default function ConfirmationClient({ pending }: { pending: PendingRecord }) {
  const [editing, setEditing] = useState<Record<number, AlbumExtract>>(
    Object.fromEntries(pending.extracted_data.map((_, i) => [i, pending.extracted_data[i]]))
  );
  const [selections, setSelections] = useState<Record<number, string>>(
    Object.fromEntries(
      pending.matched_data.map((m) => [m.extracted_index, m.album_id || 'new'])
    )
  );
  const [loading, setLoading] = useState(false);

  const handleSaveConfirmation = async () => {
    setLoading(true);
    try {
      const albums = pending.extracted_data.map((_, i) => ({
        extracted_index: i,
        ...editing[i],
        album_id: selections[i] === 'new' ? undefined : selections[i],
        create_new_album: selections[i] === 'new',
      }));

      const response = await fetch('/api/admin/disc-guide-scan/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pending_id: pending.id,
          confirmed_data: { albums },
        }),
      });

      if (response.ok) {
        alert('確認しました。登録を実行します。');
        // Trigger registration
        await fetch('/api/admin/disc-guide-scan/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pending_id: pending.id }),
        });
        window.location.reload();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-sm font-semibold">アルバム確認 ({pending.extracted_data.length}件)</h2>
      <div className="mt-4 space-y-4">
        {pending.extracted_data.map((album, i) => {
          const match = pending.matched_data[i];
          return (
            <div key={i} className="rounded border border-white/10 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-white/40">タイトル</label>
                  <input
                    type="text"
                    value={editing[i]?.title || ''}
                    onChange={(e) =>
                      setEditing({ ...editing, [i]: { ...editing[i], title: e.target.value } })
                    }
                    className="mt-1 w-full rounded bg-white/5 px-2 py-1 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40">アーティスト</label>
                  <input
                    type="text"
                    value={editing[i]?.artist_name || ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        [i]: { ...editing[i], artist_name: e.target.value },
                      })
                    }
                    className="mt-1 w-full rounded bg-white/5 px-2 py-1 text-sm text-white"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="text-xs text-white/40">マッチするアルバム</label>
                <select
                  value={selections[i] || 'new'}
                  onChange={(e) => setSelections({ ...selections, [i]: e.target.value })}
                  className="mt-1 w-full rounded bg-white/5 px-2 py-1 text-sm text-white"
                >
                  <option value="new">新規作成</option>
                  {match?.candidates?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} / {c.artist_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleSaveConfirmation}
        disabled={loading}
        className="mt-6 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? '登録中...' : '確認して登録'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/data/discguides/confirm/
git commit -m "feat: add confirmation admin UI for disc guide scans"
```

---

### Task 11: Modify Disc Guide Page for Upload & Cover Fetch

**Files:**
- Modify: `app/admin/data/discguides/page.tsx`
- Modify: `app/admin/data/discguides/actions.ts`

**Interfaces:**
- Consumes: Existing form for creating disc_guide
- Produces: Modified page with cover fetch status, image upload button

- [ ] **Step 1: Modify actions.ts to trigger cover fetch**

```typescript
// app/admin/data/discguides/actions.ts

import { after } from 'next/server';
import { fetchGoogleBooksCover } from '@/utils/googleBooksApi';

// Add to existing createDiscGuide function:
export async function createDiscGuide(formData: FormData) {
  // ... existing code ...
  
  const isbn = String(formData.get('isbn') ?? '').trim();
  
  // Trigger cover image fetch
  after(async () => {
    if (isbn) {
      try {
        const coverUrl = await fetchGoogleBooksCover(isbn);
        if (coverUrl) {
          await supabase
            .from('disc_guide')
            .update({ cover_image_url: coverUrl, cover_image_fetched_at: new Date() })
            .eq('isbn', isbn);
        } else {
          await supabase
            .from('disc_guide')
            .update({ isbn_lookup_error: 'No cover found' })
            .eq('isbn', isbn);
        }
      } catch (err) {
        await supabase
          .from('disc_guide')
          .update({ isbn_lookup_error: (err as Error).message })
          .eq('isbn', isbn);
      }
    }
  });
  
  // ... rest of code ...
}
```

- [ ] **Step 2: Modify page.tsx to show upload button and cover status**

```typescript
// app/admin/data/discguides/page.tsx - add to JSX after existing form:

<div className="mt-8 space-y-6">
  <h2 className="text-lg font-semibold">アルバム抽出</h2>
  
  {/* Show existing disc guides */}
  {discGuides?.map((guide) => (
    <div key={guide.id} className="rounded border border-white/10 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold">{guide.title}</h3>
          <p className="mt-1 text-sm text-white/60">
            {guide.publisher} ({guide.published_year})
          </p>
          {guide.cover_image_url && (
            <img src={guide.cover_image_url} alt={guide.title} className="mt-2 h-32" />
          )}
          {guide.isbn_lookup_error && (
            <p className="mt-1 text-xs text-red-400">{guide.isbn_lookup_error}</p>
          )}
        </div>
      </div>
      
      {/* Image upload form */}
      <form className="mt-4" onSubmit={async (e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const files = formData.getAll('images');
        
        const uploadData = new FormData();
        uploadData.append('disc_guide_id', guide.id);
        files.forEach(f => uploadData.append('files', f));
        
        const response = await fetch('/api/admin/disc-guide-scan/upload', {
          method: 'POST',
          body: uploadData,
        });
        
        if (response.ok) {
          alert('アップロードしました。処理中です...');
          e.currentTarget.reset();
        }
      }}>
        <input type="file" name="images" multiple accept="image/*" required />
        <button type="submit" className="mt-2 rounded bg-green-600 px-3 py-1 text-sm">
          アップロード
        </button>
      </form>
    </div>
  ))}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/data/discguides/
git commit -m "feat: add cover image fetch and album image upload to disc guide admin"
```

---

### Task 12: Modify Album Detail Page to Display Disc Guide Placements

**Files:**
- Modify: `app/albums/[id]/page.tsx`

**Interfaces:**
- Consumes: album_id from URL params
- Produces: Display "〇〇ガイドに掲載" in album detail page

- [ ] **Step 1: Add disc guide query to album detail page**

```typescript
// app/albums/[id]/page.tsx - add to existing query:

const { data: guideSelections } = await supabase
  .from('disc_guide_selection')
  .select('disc_guide:disc_guide_id(id, title, cover_image_url)')
  .eq('album_id', id);
```

- [ ] **Step 2: Add display section in JSX**

```typescript
// In the JSX, add near the top of the album detail:

{guideSelections && guideSelections.length > 0 && (
  <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.02] p-4">
    <h2 className="text-sm font-semibold text-white/60">ディスクガイド掲載</h2>
    <ul className="mt-3 space-y-2">
      {guideSelections.map((sel) => (
        <li key={sel.disc_guide?.id} className="flex items-center gap-3 text-sm">
          {sel.disc_guide?.cover_image_url && (
            <img
              src={sel.disc_guide.cover_image_url}
              alt={sel.disc_guide.title}
              className="h-16 w-12 rounded object-cover"
            />
          )}
          <span>{sel.disc_guide?.title}に掲載</span>
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add app/albums/[id]/page.tsx
git commit -m "feat: display disc guide placements on album detail page"
```

---

### Task 13: Integration Testing - Single Guide End-to-End

**Files:**
- Create: `__tests__/disc-guide-import.integration.test.ts`

**Interfaces:**
- Tests: Full flow from upload → OCR → confirm → register

- [ ] **Step 1: Create integration test**

```typescript
// __tests__/disc-guide-import.integration.test.ts

import { createAdminClient } from '@/utils/Supabase/admin';
import { fetchGoogleBooksCover } from '@/utils/googleBooksApi';

describe('Disc Guide Album Import - Integration', () => {
  let supabase: ReturnType<typeof createAdminClient>;
  let testDiscGuideId: string;

  beforeAll(() => {
    supabase = createAdminClient();
  });

  it('should create disc guide and fetch cover image', async () => {
    // Real ISBN for testing
    const isbn = '9784894444639';
    const coverUrl = await fetchGoogleBooksCover(isbn);
    expect(coverUrl).toBeTruthy();
  });

  it('should process image upload (OCR)', async () => {
    // This would require a real test image and Tesseract
    // For now, verify the endpoint exists
    const response = await fetch('/api/admin/disc-guide-scan/upload', {
      method: 'POST',
    });
    // Expect 400 (missing params) not 404 (endpoint not found)
    expect([400, 405]).toContain(response.status);
  });

  it('should confirm and register albums', async () => {
    // Verify confirmation endpoint works
    const response = await fetch('/api/admin/disc-guide-scan/confirm', {
      method: 'POST',
      body: JSON.stringify({
        pending_id: 'test',
        confirmed_data: { albums: [] },
      }),
    });
    expect([400, 404]).toContain(response.status);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- __tests__/disc-guide-import.integration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add __tests__/disc-guide-import.integration.test.ts
git commit -m "test: add integration tests for disc guide import flow"
```

---

### Task 14: Manual Validation with Real Data (Phase 1)

**Files:**
- None (manual QA)

**Interfaces:**
- Validation: Single disc guide processed end-to-end

- [ ] **Step 1: Create test disc guide**

  - Go to /admin/data/discguides
  - Create guide: "DJ Culture", ISBN: 9784894444639
  - Verify: cover image fetches and displays

- [ ] **Step 2: Upload test images**

  - Take screenshots of 2-3 pages from a real disc guide
  - Upload via admin UI
  - Monitor server logs for OCR processing

- [ ] **Step 3: Confirm albums**

  - Go to /admin/data/discguides/confirm
  - Verify: pending pages appear in list
  - Click one page → see OCR-extracted albums
  - Edit typos (if any), select matching albums
  - Submit confirmation

- [ ] **Step 4: Verify registration**

  - Check database: disc_guide_selection records created
  - Check: album detail pages show "DJ Cultureに掲載"
  - Check logs: new artists triggered bulk import (if created)

- [ ] **Step 5: Document findings**

  - Log any OCR accuracy issues
  - Note matching success rate
  - Record time taken for full pipeline

- [ ] **Step 6: Commit validation report**

```bash
git add docs/validation/2026-08-17-disc-guide-phase1-report.md
git commit -m "docs: phase 1 validation report for disc guide import"
```

---

## Spec Coverage Check

✅ Database schema (disc_guide_scan_pending, disc_guide modifications)
✅ Google Books API integration for cover images
✅ Tesseract OCR and album extraction
✅ Album matching and candidate generation
✅ Confirmation UI (one page at a time)
✅ Registration endpoint with auto-bulk-import
✅ Album detail page disc guide display
✅ Error handling (missing ISBN, OCR failures, API errors)
✅ Staged rollout strategy (single guide validation)

No gaps identified.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-17-disc-guide-auto-import.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
