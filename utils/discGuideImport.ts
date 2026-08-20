import Tesseract from 'tesseract.js';
import os from 'node:os';
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchAlbums, type ItunesAlbum } from './itunes.ts';

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
    // title_similarityとartist_similarityの平均(0-1)。実データでの実測:
    // 正しいマッチ(表記ゆれ込み)は0.79〜1.0、無関係なマッチは0.15〜0.17前後
    // まで下がるため、確認UI側で「要確認」判定のしきい値として使える。
    similarity: number;
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

// 年号パターン(YYYY)を検出し、見つかった場合は年数とその部分を取り除いた
// 文字列を返す。年号が無ければyearはundefined、workingは元の文字列のまま。
function extractYear(line: string): { working: string; year: number | undefined } {
  const yearMatch = line.match(/\((\d{4})\)/);
  if (!yearMatch) return { working: line, year: undefined };
  return { working: line.replace(yearMatch[0], '').trim(), year: parseInt(yearMatch[1], 10) };
}

// 1エントリ分のブロック(空行区切り)から、先頭2〜3行(アーティスト/タイトル/
// レーベル+年号)だけを読んでメタデータを組み立てる。ブロックにそれ以降の行
// (段組みで折り返されたレビュー文)が続いていても無視する — これにより、
// レビュー文の各行が次のエントリのメタデータとして誤読されるのを防ぐ。
//
// タイトル行自体に年号が付いているかどうかで2行形式/3行形式を判定する:
// 付いていれば2行形式(アーティスト/「タイトル (年)」)としてその場で確定、
// 付いていなければ3行形式(アーティスト/タイトル/「レーベル (年)」)とみなし
// 3行目をレーベルとして読む。
function parseEntryFromBlock(lines: string[]): AlbumExtract | null {
  if (lines.length < 2) return null; // アーティスト名だけでは不完全

  const artist_name = lines[0];
  const { working: title, year: titleYear } = extractYear(lines[1]);
  if (!title) return null;

  if (titleYear !== undefined) {
    return { artist_name, title, release_year: titleYear };
  }

  if (lines.length < 3) {
    return { artist_name, title }; // レーベル行が無い(年号も無い)エントリ
  }

  const { working: label, year: labelYear } = extractYear(lines[2]);
  return {
    artist_name,
    title,
    // レビュー文の書き出しがそのまま3行目に来ている場合はレーベルとして
    // 採用しない(labelはマッチングに使わないフィールドなので実害は小さい)
    label: label && label.length < 100 ? label : undefined,
    release_year: labelYear,
  };
}

export async function parseOCRToAlbums(text: string): Promise<AlbumExtract[]> {
  // 実際の誌面では各エントリの前後に視覚的な余白があり、Tesseractのプレーン
  // テキスト出力ではこれが空行として現れる。まず空行でブロックに分割し、
  // 各ブロックを1エントリとして扱う(実データ検証: 空行を使わない行単位パーサー
  // は、レビュー文が挟まる実際のページで23件中59件を誤抽出していた)。
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((l) => normalizeOcrText(l))
        .filter((l) => l.length > 0)
    )
    .filter((block) => block.length > 0);

  const albums: AlbumExtract[] = [];
  for (const block of blocks) {
    const entry = parseEntryFromBlock(block);
    if (entry) albums.push(entry);
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
      .map((r) => ({
        id: r.id,
        title: r.title,
        artist_name: r.artist_name,
        similarity: (r.title_similarity + r.artist_similarity) / 2,
      }));

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

function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * OCRで読み取ったアーティスト名・タイトルをもとに、iTunes上の実カタログエントリを
 * 検索する(管理画面で「既存カタログに一致なし・新規登録」と判断された行を、
 * 裸のinsertではなく実データ(トラック・画像込み)で登録できるようにするため)。
 * OCRの誤読を考慮し、タイトル完全一致(正規化後)かつアーティスト名が部分一致する
 * 候補が1件だけ見つかった場合のみ採用する(過検出より過小検出を優先する方針、
 * album-edition-groupingなどこのアプリの他の自動照合と同じ考え方)。
 */
export async function findAppleMusicAlbumMatch(artistName: string, title: string): Promise<ItunesAlbum | null> {
  let candidates: ItunesAlbum[]
  try {
    candidates = await searchAlbums(`${artistName} ${title}`, 10)
  } catch {
    return null
  }

  const normalizedTitle = normalizeForMatch(title)
  const normalizedArtist = normalizeForMatch(artistName)

  const matches = candidates.filter(
    (c) =>
      normalizeForMatch(c.collectionName) === normalizedTitle &&
      (normalizeForMatch(c.artistName).includes(normalizedArtist) ||
        normalizedArtist.includes(normalizeForMatch(c.artistName)))
  )

  return matches.length === 1 ? matches[0] : null
}
