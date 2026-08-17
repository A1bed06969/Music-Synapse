import Tesseract from 'tesseract.js';
import os from 'node:os';
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
      // Vercelのサーバーレス関数はcwd(デプロイパッケージ)が読み取り専用で、
      // 書き込めるのは/tmpのみ。cachePath未指定だと言語データのキャッシュ書き込みが
      // 毎回失敗し(tesseract.js側では握りつぶされるため落ちはしないが)、
      // 呼び出しのたびに数MBの言語データをCDNから再ダウンロードすることになる。
      // os.tmpdir()を指定してウォーム状態のインスタンス内でキャッシュが効くようにする
      // (実測: キャッシュ無し1017ms → キャッシュあり146ms)。
      cachePath: os.tmpdir(),
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
  // Simple heuristic parser: split by newlines and detect patterns.
  //
  // ディスクガイドのレイアウトは版によって2行(アーティスト/「タイトル (年)」)と
  // 3行(アーティスト/タイトル/「レーベル (年)」)の両方があり得る。タイトル行
  // 自体に年号が付いているかどうかで、このエントリが2行と3行のどちらの形式か
  // を判定する: 付いていれば2行形式としてその場で確定、付いていなければ
  // 3行形式とみなして次の行(ラベル+年号)を読んでから確定する。以前は
  // タイトルが確定した時点で無条件に確定していたため、3行形式のラベル行が
  // 次エントリの「アーティスト名」として誤読され、以降のエントリが1行ずつ
  // ずれていくバグがあった。
  const lines = text
    .split('\n')
    .map((l) => normalizeOcrText(l))
    .filter((l) => l.length > 0);
  const albums: AlbumExtract[] = [];

  let current: Partial<AlbumExtract> = {};
  let awaitingLabel = false;

  function finalize() {
    if (current.title && current.artist_name) {
      albums.push({
        title: current.title,
        artist_name: current.artist_name,
        label: current.label,
        release_year: current.release_year,
      });
    }
    current = {};
    awaitingLabel = false;
  }

  for (const rawLine of lines) {
    // Detect year pattern (YYYY) and strip it from the line so it doesn't
    // end up baked into title/artist_name (e.g. "Solid State Survivor (1979)"
    // would never match the DB title "Solid State Survivor" otherwise).
    const yearMatch = rawLine.match(/\((\d{4})\)/);
    const lineYear = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
    const working = yearMatch ? rawLine.replace(yearMatch[0], '').trim() : rawLine;

    if (!working) continue; // line was only a year marker; nothing left to assign

    if (!current.artist_name) {
      current.artist_name = working;
      continue;
    }

    if (!current.title) {
      current.title = working;
      if (lineYear !== undefined) {
        current.release_year = lineYear;
        finalize(); // 2行形式: タイトル行に年号があったので確定
      } else {
        awaitingLabel = true; // 3行形式: 次の行(ラベル+年号)を待つ
      }
      continue;
    }

    if (awaitingLabel) {
      // レビュー文などの長文が続く場合はラベルとして採用しない(labelは
      // マッチングに使わないフィールドなので、取りこぼしても実害は小さい)
      if (working.length < 100) {
        current.label = working;
      }
      if (lineYear !== undefined) current.release_year = lineYear;
      finalize();
      continue;
    }

    // artist_name・titleが揃っていてラベル待ちでもない場合、この行は
    // 次のエントリの開始とみなす(通常はfinalize()で既にリセットされて
    // いるはずだが、保険として)。
    current = { artist_name: working };
  }

  return albums;
}

type FuzzyAlbumRow = {
  id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  title_similarity: number;
  artist_similarity: number;
};

// タイトルの完全部分一致(ilike)だとOCRの1文字誤読・空白の有無だけで候補0件に
// なってしまう(Phase 1検証で実測: "The Vertigo of Bliss" の表記ゆれ3パターン
// 中2パターンが0件)。pg_trgmのトライグラム類似度によるDB側ファジー検索
// (search_albums_fuzzy, supabase/migrations/20260817_add_fuzzy_album_search.sql)
// に置き換え、多少の表記ゆれがあってもtitle/artist名の近さでランキングする。
export async function matchAlbumsWithCandidates(
  supabase: SupabaseClient,
  extracted: AlbumExtract[]
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];

  for (let i = 0; i < extracted.length; i++) {
    const album = extracted[i];

    const { data: rows, error } = await supabase.rpc('search_albums_fuzzy', {
      search_title: album.title,
      search_artist: album.artist_name,
    });

    if (error) {
      console.error(`Error querying albums for "${album.title}":`, error);
      results.push({
        extracted_index: i,
        candidates: [],
      });
      continue;
    }

    const candidates = ((rows ?? []) as FuzzyAlbumRow[])
      .slice(0, 3)
      .map((r) => ({ id: r.id, title: r.title, artist_name: r.artist_name }));

    // Primary match is the top-ranked candidate.
    const primaryRow = (rows as FuzzyAlbumRow[] | null)?.[0];

    results.push({
      extracted_index: i,
      album_id: primaryRow?.id,
      artist_id: primaryRow?.artist_id,
      candidates,
    });
  }

  return results;
}
