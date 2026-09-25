'use server'

import { createClient } from '@/utils/Supabase/server'
import type { RecentReleaseAlbum } from './RecentReleasesCarousel'

/** 右カラムの新譜一覧でクリックされたアルバム1件の詳細(アーティスト・収録曲・
 * 紹介文)をその場で取得する。月間カレンダーの全アルバムが対象になり得るため
 * (直近20件のみ事前取得している「今週の新譜ピックアップ」とは別枠)、クリック時に
 * 都度取得する方針にしている。 */
export async function getAlbumDetailForCalendar(albumId: string): Promise<RecentReleaseAlbum | null> {
  const supabase = await createClient()

  const { data: album } = await supabase
    .from('album')
    .select('id, title, jacket_url, release_date, album_review, artist:artist_id(id, name, image_url)')
    .eq('id', albumId)
    .maybeSingle()
  if (!album) return null

  const { data: trackRows } = await supabase
    .from('track')
    .select('id, track_no, title')
    .eq('album_id', albumId)
    .order('disc_number', { ascending: true, nullsFirst: true })
    .order('track_no', { ascending: true })

  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist

  return {
    id: album.id,
    title: album.title,
    jacketUrl: album.jacket_url,
    releaseDate: album.release_date as string,
    artistId: artist?.id ?? null,
    artistName: artist?.name ?? '不明',
    artistImageUrl: artist?.image_url ?? null,
    review: album.album_review,
    tracks: (trackRows ?? []).map((t) => ({ id: t.id, trackNo: t.track_no, title: t.title })),
  }
}
