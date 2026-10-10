// アーティスト画像が無い人の代わりの表示用に、ジャケット画像を探す。DBのimage_urlには保存しない
// (表示のたびに判断するので、後で本人の画像が入れば自動でそちらに切り替わる)。
// 自分の作品があれば最新作のジャケット、無ければ参加曲(feat.等)が入ったアルバムのジャケットを使う。
import type { SupabaseClient } from '@supabase/supabase-js'

const CHUNK = 150

type AlbumJacket = { jacket_url: string | null; release_date: string | null }
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

export async function fetchFallbackJackets(supabase: SupabaseClient, artistIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const ids = [...new Set(artistIds)]

  // 自分の作品(新しい順)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await supabase
      .from('album')
      .select('artist_id, jacket_url, release_date')
      .in('artist_id', ids.slice(i, i + CHUNK))
      .not('jacket_url', 'is', null)
      .order('release_date', { ascending: false, nullsFirst: false })
      .limit(1000)
    for (const a of data ?? []) {
      if (!result.has(a.artist_id as string)) result.set(a.artist_id as string, a.jacket_url as string)
    }
  }

  // 自分の作品が無い人は、参加曲が入ったアルバム
  const rest = ids.filter((id) => !result.has(id))
  for (let i = 0; i < rest.length; i += CHUNK) {
    const { data } = await supabase
      .from('track_artist')
      .select('artist_id, track:track_id(album:album_id(jacket_url, release_date))')
      .in('artist_id', rest.slice(i, i + CHUNK))
      .limit(1000)
    const best = new Map<string, AlbumJacket>()
    for (const row of data ?? []) {
      type TrackJoin = { album: AlbumJacket | AlbumJacket[] | null }
      const album = one(one(row.track as unknown as TrackJoin | TrackJoin[] | null)?.album)
      if (!album?.jacket_url) continue
      const prev = best.get(row.artist_id as string)
      if (!prev || (album.release_date ?? '') > (prev.release_date ?? '')) best.set(row.artist_id as string, album)
    }
    for (const [id, album] of best) result.set(id, album.jacket_url as string)
  }
  return result
}
