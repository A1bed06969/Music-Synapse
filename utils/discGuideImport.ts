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
    // 確認画面で候補にジャケットを表示するため。自前DBはalbum.jacket_url、
    // Apple Music候補はartworkUrl100由来(どちらも無ければundefined)。
    artwork_url?: string;
  }>;
};

type FuzzyAlbumRow = {
  id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  title_similarity: number;
  artist_similarity: number;
  jacket_url: string | null;
};

function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// 自前DB(search_albums_fuzzy)には無いアルバムが大半なため、Apple Musicの
// カタログ全体も候補として検索する。曲名・アーティスト名の近さを測る指標が
// 無いため、正規化後タイトル完全一致=0.9、部分一致=0.6、それ以外=0.35という
// 簡易な3段階のスコアで代用する(0.5を「要確認」の境界とする既存UIと整合させる)。
async function searchAppleMusicCandidates(
  artistName: string,
  title: string
): Promise<MatchResult['candidates']> {
  let results: ItunesAlbum[];
  try {
    results = await searchAlbums(`${artistName} ${title}`, 5);
  } catch {
    return [];
  }

  const normalizedTitle = normalizeForMatch(title);

  return results.map((r) => {
    const normalizedCandidateTitle = normalizeForMatch(r.collectionName);
    // 空文字列はどんな文字列に対してもincludes()が常にtrueになるため、
    // タイトルが空(OCR失敗等)の場合に無関係な候補まで0.6点になるのを防ぐ
    let similarity = 0.35;
    if (normalizedTitle && normalizedCandidateTitle === normalizedTitle) {
      similarity = 0.9;
    } else if (
      normalizedTitle &&
      (normalizedCandidateTitle.includes(normalizedTitle) || normalizedTitle.includes(normalizedCandidateTitle))
    ) {
      similarity = 0.6;
    }
    return {
      id: `itunes:${r.collectionId}`,
      title: r.collectionName,
      artist_name: r.artistName,
      similarity,
      artwork_url: r.artworkUrl100,
    };
  });
}

// タイトルの完全部分一致(ilike)だとOCRの1文字誤読・空白の有無だけで候補0件に
// なってしまう(Phase 1検証で実測: "The Vertigo of Bliss" の表記ゆれ3パターン
// 中2パターンが0件)。pg_trgmのトライグラム類似度によるDB側ファジー検索
// (search_albums_fuzzy, supabase/migrations/20260817_add_fuzzy_album_search.sql)
// に置き換え、多少の表記ゆれがあってもtitle/artist名の近さでランキングする。
// さらにApple Musicのカタログ検索も合わせて候補に含める(自前DBはまだ
// registeredなアルバムがごく少数のため、これだけでは大半のエントリが
// 候補0件になってしまう)。
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
    }

    const localCandidates = ((rows ?? []) as FuzzyAlbumRow[]).map((r) => ({
      id: r.id,
      title: r.title,
      artist_name: r.artist_name,
      similarity: (r.title_similarity + r.artist_similarity) / 2,
      artwork_url: r.jacket_url ?? undefined,
    }));
    const appleCandidates = await searchAppleMusicCandidates(album.artist_name, album.title);

    const candidates = [...localCandidates, ...appleCandidates]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    // Primary match is the top-ranked candidate (local DB matches carry a real
    // album_id already; an Apple Music candidate has no local row yet, so it's
    // only usable via the confirm UI's selection, not as a default album_id).
    //
    // ただしprimaryLocalRow(生のsearch_albums_fuzzy結果の1位)は、Apple Music候補と
    // マージ後の上位candidatesに入っているとは限らない(ローカルDBの類似度が低く、
    // Apple Music側の一律0.35点に負けてcandidatesから溢れることがある)。その場合
    // candidatesに存在しないalbum_idを default として返すと、確認画面の<select>は
    // どのoptionとも一致せず先頭の「新規作成」を表示するが、実際のstateは無関係な
    // 既存アルバムのIDのまま残り、気づかず登録すると誤って既存アルバムにリンク
    // されてしまう(実例: 「ハイポジ/Body Meets Sing」がtrigram類似度だけで無関係な
    // 既存アルバム「Body On Me」にマッチしてしまった)。candidatesに実在するIDのみ
    // デフォルト選択として採用する。
    const primaryLocalRow = (rows as FuzzyAlbumRow[] | null)?.[0];
    const defaultMatch =
      primaryLocalRow && candidates.some((c) => c.id === primaryLocalRow.id) ? primaryLocalRow : undefined;

    results.push({
      extracted_index: i,
      album_id: defaultMatch?.id,
      artist_id: defaultMatch?.artist_id,
      candidates,
    });
  }

  return results;
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
  const normalizedTitle = normalizeForMatch(title)
  const normalizedArtist = normalizeForMatch(artistName)

  // 空文字列は他のどんな文字列に対しても String.includes('') が常にtrueを
  // 返すため、artistNameが空/OCRで読み取れなかった場合、下のアーティスト名
  // チェックが実質スルーされ「タイトルの完全一致さえあれば誰の作品でも
  // マッチ扱い」になってしまう(実際に無関係な作品が誤登録される事例で確認)。
  // タイトルもアーティスト名もどちらも空判定にならないようここで弾く。
  if (!normalizedTitle || !normalizedArtist) return null

  let candidates: ItunesAlbum[]
  try {
    candidates = await searchAlbums(`${artistName} ${title}`, 10)
  } catch {
    return null
  }

  const matches = candidates.filter(
    (c) =>
      normalizeForMatch(c.collectionName) === normalizedTitle &&
      (normalizeForMatch(c.artistName).includes(normalizedArtist) ||
        normalizedArtist.includes(normalizeForMatch(c.artistName)))
  )

  return matches.length === 1 ? matches[0] : null
}
