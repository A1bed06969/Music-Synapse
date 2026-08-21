import type { SupabaseClient, PostgrestResponse } from '@supabase/supabase-js'

/** アーティストの単独名義(album.artist_id)+album_artist経由の追加アーティスト
 * 名義の両方を含めたアルバムクエリを組み立てる。アーティスト詳細ページの
 * ディスコグラフィーと、全リリース年表ページ(/artists/[id]/timeline)の両方が
 * 同じ集合を必要とするため共通化する(片方だけ拡張すると、要約ページに出た
 * アルバムが「全リリース」ページでは消えるという矛盾が起きるため)。
 * primary_album_id IS NULLで版統合済みの代表版のみに絞り、release_date降順で返す。
 * columnsはSELECT句(呼び出し元ごとに必要な列が違うため引数で受け取る)。
 * Rowは呼び出し元で明示的に指定する型引数(columns文字列はリテラル型ではないため
 * supabase-jsのselect()自体からは列の型を安全に推論できない。ここでは呼び出し元が
 * columnsと一致することを保証する前提で、最終結果を一度だけ明示キャストする)。 */
export async function buildArtistAlbumQuery<Row>(
  supabase: SupabaseClient,
  artistId: string,
  columns: string
): Promise<PostgrestResponse<Row>> {
  const { data: coArtistLinks } = await supabase.from('album_artist').select('album_id').eq('artist_id', artistId)
  const coArtistAlbumIds = (coArtistLinks ?? []).map((r) => r.album_id)

  let query = supabase.from('album').select(columns)
  query =
    coArtistAlbumIds.length > 0
      ? query.or(`artist_id.eq.${artistId},id.in.(${coArtistAlbumIds.join(',')})`)
      : query.eq('artist_id', artistId)
  const result = await query.is('primary_album_id', null).order('release_date', { ascending: false, nullsFirst: false })
  return result as unknown as PostgrestResponse<Row>
}
