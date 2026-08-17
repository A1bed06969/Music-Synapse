# Disc Guide Auto-Import — Phase 1 Validation Report

**Date:** 2026-08-17
**Scope:** Tasks 1–13 of `docs/superpowers/plans/2026-08-17-disc-guide-auto-import.md`
**Verdict:** Pipeline is **structurally working end-to-end**, but **not yet fit for real disc guides**.
Two blocking defects in extraction/matching must be fixed before ingesting a real book.

---

## What was actually exercised

Validation was performed against the live Supabase project (`ftvhglfthbcxhgnoninv`) and a local
`npm run dev` server, using a **synthetic disc guide page** rendered to PNG (900px wide, three
entries in the artist / title+year layout the parser expects). All test rows were deleted afterwards.

A real printed disc guide scan was **not** available in this session — see "Outstanding manual steps".

| Step | Method | Result |
|---|---|---|
| Create disc guide | direct insert + admin action | OK |
| Cover fetch by ISBN | `fetchGoogleBooksCover('9784894444639')` | **FAILED — quota** |
| Image upload → OCR → pending | `POST /api/admin/disc-guide-scan/upload` | OK, ~3s for one page |
| OCR accuracy | Tesseract `jpn+eng` on synthetic page | 0.89 confidence, Japanese degraded |
| Album matching | `matchAlbumsWithCandidates` vs live DB | **0 candidates on realistic input** |
| Confirm → register | integration test, full HTTP round trip | OK, `pending → confirmed → registered` |
| New artist + album creation | integration test (destructive mode) | OK **after fixing a blocking bug** |

---

## Defects found

### 1. `album_type: 'other'` violated a CHECK constraint — FIXED (commit `15e4c73`)

`app/api/admin/disc-guide-scan/register/route.ts` hardcoded `album_type: 'other'` when creating a
new album. The constraint is:

```
CHECK (album_type = ANY (ARRAY['Album','EP','Single','Live','Compilation','Best']))
```

Every insert failed with SQLSTATE `23514`. Because the route discarded the insert `error`, the
failure was silent: no album was created, no `disc_guide_selection` row was written, and the endpoint
still returned HTTP 200 with `registered_count: 0`. **The entire create-new-album path — the main
reason this feature exists — could never have worked.**

Fixed by defaulting to `'Album'` and logging artist/album insert errors. Verified by the integration
test, which now creates artist + album + selection and reports `new_artists`.

### 2. The parser leaves the year in the title, which guarantees a matching miss — OPEN

`parseOCRToAlbums` extracts `release_year` from a `(YYYY)` pattern but never strips it from the
title. Real pipeline output:

```json
{ "title": "Solid State Survivor (1979)", "artist_name": "YMO", "release_year": 1979 }
```

`matchAlbumsWithCandidates` then queries `.ilike('title', '%' + title + '%')`, so the DB title would
have to literally contain `"Solid State Survivor (1979)"`. It never does.

### 3. The matcher has no fuzzy recall — OPEN

The Levenshtein similarity function is only used to **rank** rows already returned by the substring
query. It cannot widen the search, so any OCR noise drops recall to zero. Measured against albums
that are genuinely in the database:

| Input | Candidates | Result |
|---|---|---|
| `The Vertigo of Bliss` (exact) | 2 | HIT |
| `The Vertigo of Bliss (2003)` (what the parser actually emits) | 0 | MISS |
| `The Vertigo of Bl iss` (one injected space) | 0 | MISS |
| `The Vertigo of Blise` (one wrong char) | 0 | MISS |
| `Last Time Around` (exact) | 1 | HIT |

**Only exact substrings match.** Combined with defect 2, the realistic match rate on OCR output is
effectively **0%** — every album would be routed to "新規作成", silently duplicating albums that
already exist and firing needless MusicBrainz imports.

Suggested fix: strip the trailing `(YYYY)` and normalise whitespace before querying, and add a
trigram/`pg_trgm` similarity search (or fetch a candidate pool by artist and rank locally) so
near-misses surface as candidates rather than vanishing.

### 4. Japanese OCR inserts spurious spaces and drops/invents characters — OPEN

On a clean, high-contrast, 34px synthetic render — far easier than a real scan:

| Expected | OCR output |
|---|---|
| `風街ろまん` | `風 街 ろ る まん` (spaces + hallucinated `る`) |
| `空中キャンプ` | `空中 キャ ンプ` (spaces) |
| `Happy End`, `Solid State Survivor`, `Fishmans` | correct |

Latin text was perfect; Japanese was not. Since the target corpus is Japanese disc guides, whitespace
normalisation (stripping spaces between CJK characters) is required before matching.

### 5. Tesseract logs `Failed loading language ''` — OPEN, cosmetic but suspicious

Every OCR run prints:

```
Error opening data file ./.traineddata
Please make sure the TESSDATA_PREFIX environment variable is set to your "tessdata" directory.
Failed loading language ''
```

Recognition still succeeds at 0.89 confidence, so a fallback is loading, but the `'jpn+eng'` argument
is evidently not reaching Tesseract intact under tesseract.js v7. The repo-root `jpn.traineddata` /
`eng.traineddata` are not being used. Worth confirming which model actually ran — Japanese accuracy
in defect 4 may simply be the wrong model.

### 6. Google Books cover fetch is quota-blocked without an API key — OPEN

```
HTTP 429 — Quota exceeded for quota metric 'Queries' and limit 'Queries per day'
of service 'books.googleapis.com' for consumer 'project_number:624717413613'
```

`fetchGoogleBooksCover` calls the API unauthenticated, so it shares an anonymous project quota that
is already exhausted. Cover fetching **did not succeed even once** during validation.

Worse, the util collapses every non-2xx into `null`, so `createDiscGuide` records
`isbn_lookup_error: 'No cover found'` — which misreports a transient rate limit as a permanent
"this book has no cover". An API key and a distinct message for 429 are both needed.

### 7. `upload` returns `pending_ids: []` — OPEN, known

Confirmed in practice: the endpoint responded in 16ms with

```json
{"success":true,"message":"1 images queued for processing","pending_ids":[]}
```

The IDs are populated inside `after()`, which runs after the response is serialised, so the array is
always empty. The pending row appeared ~3s later. Callers must poll the pending list rather than
trust this field; the confirmation UI does exactly that, so nothing is broken today, but the field is
misleading and should either be removed or the work made synchronous.

---

## Timings

| Stage | Time |
|---|---|
| Upload HTTP response | 16 ms |
| Upload → pending row visible (1 page, OCR + parse + match) | ~3 s |
| Full confirm → register round trip | ~2.8 s |
| Integration suite (non-destructive) | ~5.3 s |

One page in roughly 3 seconds means a 100-page guide is ~5 minutes of OCR — acceptable for a
background job, but it runs in `after()` on a single request, so a large upload risks exceeding the
platform's function lifetime. Batching per page is advisable.

---

## Outstanding manual steps (require a human)

These need a physical book and could not be completed in this session:

1. Scan 2–3 pages from a **real** Japanese disc guide and upload them via
   `/admin/data/discguides`. Real pages have multi-column layouts, review prose, catalogue numbers
   and star ratings — none of which the current `parseOCRToAlbums` heuristic (first short line =
   artist, next = title) is designed for. Expect this to be the largest source of error.
2. Confirm on `/admin/data/discguides/confirm` and check that the candidate dropdown offers useful
   options **after** defects 2–4 are fixed.
3. Obtain a Google Books API key and re-verify cover fetch (defect 6).
4. Verify the "〇〇ガイドに掲載" block with a real cover thumbnail on an album page.

---

## Recommendation

**Do not ingest a real disc guide yet.** Defects 2, 3 and 4 compound: the pipeline would create a
duplicate album and a duplicate artist for essentially every row on the page, and each new artist
triggers a MusicBrainz import. Fix title normalisation and matcher recall first, then re-run this
validation against a real scan.

The plumbing either side of extraction — upload, staging, confirmation, registration, bulk-import
trigger, album-page display — is sound and verified.
