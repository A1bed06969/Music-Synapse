import Tesseract from 'tesseract.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AlbumExtract = {
  title: string;
  artist_name: string;
  label?: string;
  release_year?: number;
};

export type MatchResult = {
  extracted_index: number;
  album_id?: string;
  artist_id?: string;
  candidates: Array<{
    id: string;
    title: string;
    artist_name: string;
  }>;
};

export async function performOCR(imageUrl: string): Promise<{
  text: string;
  confidence: number;
}> {
  try {
    const result = await Tesseract.recognize(imageUrl, 'jpn+eng', {
      logger: (m: any) => {
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

// CJK文字(ひらがな・カタカナ・漢字・半角カタカナ)の範囲。OCRがこの文字種の
// 間に余計な空白を挿入することがあるため、正規化で除去する対象を判定するのに使う。
const CJK_CHAR = '぀-ヿ㐀-鿿ｦ-ﾟ';
const CJK_ADJACENT_SPACE = new RegExp(`([${CJK_CHAR}])\\s+(?=[${CJK_CHAR}])`, 'gu');

// OCR出力のクリーンアップ。全角数字・全角括弧・全角英数字を半角に統一し(NFKC)、
// CJK文字同士の間に挟まった空白(Tesseractが縦書き日本語で挿入しがち)を除去する。
// 英単語間のスペース(例: "Solid State")はCJK文字が隣接しないため保持される。
export function normalizeOcrText(raw: string): string {
  let normalized = raw.normalize('NFKC');
  normalized = normalized.replace(CJK_ADJACENT_SPACE, '$1');
  normalized = normalized.replace(/[ \t]+/g, ' ').trim();
  return normalized;
}

export async function parseOCRToAlbums(text: string): Promise<AlbumExtract[]> {
  // Simple heuristic parser: split by newlines and detect patterns
  const lines = text
    .split('\n')
    .map((l) => normalizeOcrText(l))
    .filter((l) => l.length > 0);
  const albums: AlbumExtract[] = [];

  let current: Partial<AlbumExtract> = {};

  for (const line of lines) {
    let working = line;

    // Detect year pattern (YYYY) and strip it from the line so it doesn't
    // end up baked into title/artist_name (e.g. "Solid State Survivor (1979)"
    // would never match the DB title "Solid State Survivor" otherwise).
    const yearMatch = working.match(/\((\d{4})\)/);
    if (yearMatch) {
      current.release_year = parseInt(yearMatch[1], 10);
      working = working.replace(yearMatch[0], '').trim();
    }

    if (!working) continue; // line was only a year marker; nothing left to assign

    // Detect artist pattern (usually before title, shorter line)
    if (working.length < 50 && !current.artist_name && !current.title) {
      current.artist_name = working;
    } else if (!current.title && current.artist_name && working.length < 100) {
      current.title = working;
    } else if (working.length < 50) {
      current.label = working;
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

// Calculate similarity score between two strings (0-1, where 1 is exact match)
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;

  // Simple similarity: based on how many characters match
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  const editDistance = levenshteinDistance(longer, shorter);
  return 1 - editDistance / longer.length;
}

// Calculate Levenshtein distance between two strings
function levenshteinDistance(str1: string, str2: string): number {
  const track = Array(str2.length + 1)
    .fill(null)
    .map(() => Array(str1.length + 1).fill(0));

  for (let i = 0; i <= str1.length; i++) track[0][i] = i;
  for (let j = 0; j <= str2.length; j++) track[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }

  return track[str2.length][str1.length];
}

export async function matchAlbumsWithCandidates(
  supabase: SupabaseClient,
  extracted: AlbumExtract[]
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];

  for (let i = 0; i < extracted.length; i++) {
    const album = extracted[i];

    // Query albums with title matching
    const { data: albums, error } = await supabase
      .from('album')
      .select('id, title, artist:artist_id(id, name)')
      .ilike('title', `%${album.title}%`)
      .limit(100); // Get more candidates initially to filter

    if (error) {
      console.error(`Error querying albums for "${album.title}":`, error);
      results.push({
        extracted_index: i,
        candidates: [],
      });
      continue;
    }

    // Filter by artist match and calculate similarity
    const candidates = (albums || [])
      .filter((a: any) => {
        const artistName = a.artist?.name || '';
        // Flexible artist matching: check if extracted artist name appears in DB artist name or vice versa
        const s1 = album.artist_name.toLowerCase();
        const s2 = artistName.toLowerCase();
        return (
          s1.includes(s2) ||
          s2.includes(s1) ||
          calculateSimilarity(s1, s2) > 0.7
        );
      })
      .map((a: any) => ({
        id: a.id,
        title: a.title,
        artist_name: a.artist?.name || '',
        similarity: calculateSimilarity(album.title, a.title),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)
      .map(({ similarity, ...c }) => c);

    // Primary match is the first candidate
    const primaryMatch = candidates[0];

    results.push({
      extracted_index: i,
      album_id: primaryMatch?.id,
      artist_id: primaryMatch ? (albums?.find(a => a.id === primaryMatch.id) as any)?.artist?.id : undefined,
      candidates,
    });
  }

  return results;
}
