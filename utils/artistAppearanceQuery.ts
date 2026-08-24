import type { SupabaseClient, PostgrestResponse } from '@supabase/supabase-js'

/** アーティストのフェス/イベント出演(event_appearance)を、単独出演+コラボ名義
 * (event_appearance_artist経由)の両方を含めて取得する。アーティスト詳細ページと
 * 全リリース年表ページ(/artists/[id]/timeline)の両方が同じ集合を必要とするため
 * buildArtistAlbumQueryと同じ方針で共通化する。
 * event_appearance_artistは既存の全event_appearance行(単独出演含む)を
 * バックフィル済みのため、album_artistと違いOR/フォールバックは不要——
 * このテーブル経由のIN句だけで単独出演もコラボ出演も両方拾える。
 * columns/Rowはalbum版と同じ理由で呼び出し元が指定する。 */
export async function buildArtistAppearanceQuery<Row>(
  supabase: SupabaseClient,
  artistId: string,
  columns: string
): Promise<PostgrestResponse<Row>> {
  const { data: links } = await supabase.from('event_appearance_artist').select('event_appearance_id').eq('artist_id', artistId)
  const appearanceIds = [...new Set((links ?? []).map((r) => r.event_appearance_id))]

  if (appearanceIds.length === 0) {
    return { data: [], error: null, count: null, status: 200, statusText: 'OK' } as unknown as PostgrestResponse<Row>
  }

  const result = await supabase.from('event_appearance').select(columns).in('id', appearanceIds)
  return result as unknown as PostgrestResponse<Row>
}
