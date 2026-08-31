import type { SupabaseClient } from '@supabase/supabase-js'

type Supabase = SupabaseClient<any, any, any>

export const MIN_SHELF_ALBUMS = 8
export const NEW_ARRIVALS_DAYS = 30
export const NEW_ARRIVALS_KEY = 'new-arrivals'
export const NEW_ARRIVALS_LABEL = '新着'

export type DiggingShelf = {
  key: string
  label: string
  isGenre: boolean
}

export type DiggingRecord = {
  id: string
  title: string
  jacketUrl: string
  artistId: string
  artistName: string
  releaseDate: string | null
  firstTrackId: string | null
  firstTrackPreviewUrl: string | null
}

// サーバーはUTCで動くため、JSTの「今日からN日前」を単純な日数引き算ではなく
// UTC基準のDate.UTCで組み立てる(utils/homeCards.tsのtomorrowJSTと同じ考え方)
function daysAgoJST(days: number): string {
  const todayJST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [y, m, d] = todayJST.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
}

type ShelfAlbumRow = {
  album_id: string
  title: string
  jacket_url: string
  artist_id: string
  artist_name: string
  release_date: string | null
}

/** 各アルバムの最初の収録曲(disc_number→track_no昇順で先頭)を取得し、
 * DiggingRecordへ組み立てる。preview_urlが無い曲でもfirstTrackIdは設定する
 * (試聴不可の表示に使うのはfirstTrackPreviewUrlの有無で判定するため)。 */
async function attachFirstTracks(supabase: Supabase, rows: ShelfAlbumRow[]): Promise<DiggingRecord[]> {
  if (rows.length === 0) return []

  const albumIds = rows.map((r) => r.album_id)
  const { data: tracks } = await supabase
    .from('track')
    .select('id, album_id, track_no, disc_number, preview_url')
    .in('album_id', albumIds)
    .order('disc_number', { ascending: true, nullsFirst: true })
    .order('track_no', { ascending: true, nullsFirst: true })

  const firstTrackByAlbum = new Map<string, { id: string; preview_url: string | null }>()
  for (const t of tracks ?? []) {
    if (!firstTrackByAlbum.has(t.album_id)) {
      firstTrackByAlbum.set(t.album_id, { id: t.id, preview_url: t.preview_url })
    }
  }

  return rows.map((r) => {
    const firstTrack = firstTrackByAlbum.get(r.album_id)
    return {
      id: r.album_id,
      title: r.title,
      jacketUrl: r.jacket_url,
      artistId: r.artist_id,
      artistName: r.artist_name,
      releaseDate: r.release_date,
      firstTrackId: firstTrack?.id ?? null,
      firstTrackPreviewUrl: firstTrack?.preview_url ?? null,
    }
  })
}

/** 棚として採用できるジャンル一覧(MIN_SHELF_ALBUMS枚以上のジャケット付き
 * アルバムを持つジャンルのみ)を、先頭に「新着」を付けて返す。 */
export async function fetchEligibleGenreShelves(supabase: Supabase): Promise<DiggingShelf[]> {
  const { data, error } = await supabase.rpc('record_digging_eligible_genres', { min_albums: MIN_SHELF_ALBUMS })
  if (error) {
    console.error('棚候補ジャンルの取得に失敗しました:', error.message)
    return [{ key: NEW_ARRIVALS_KEY, label: NEW_ARRIVALS_LABEL, isGenre: false }]
  }

  const genreShelves: DiggingShelf[] = (data ?? []).map((row: { genre_id: string; genre_name: string }) => ({
    key: row.genre_id,
    label: row.genre_name,
    isGenre: true,
  }))

  return [{ key: NEW_ARRIVALS_KEY, label: NEW_ARRIVALS_LABEL, isGenre: false }, ...genreShelves]
}

/** 指定した棚に属するレコード一覧を返す。'new-arrivals'はジャンル不問で
 * 直近NEW_ARRIVALS_DAYS日以内にリリースされたアルバムを返す。 */
export async function fetchShelfRecords(supabase: Supabase, shelfKey: string): Promise<DiggingRecord[]> {
  if (shelfKey === NEW_ARRIVALS_KEY) {
    const { data, error } = await supabase.rpc('record_digging_new_arrivals', {
      since_date: daysAgoJST(NEW_ARRIVALS_DAYS),
    })
    if (error) {
      console.error('新着棚の取得に失敗しました:', error.message)
      return []
    }
    return attachFirstTracks(supabase, (data ?? []) as ShelfAlbumRow[])
  }

  const { data, error } = await supabase.rpc('record_digging_shelf_albums', { target_genre_id: shelfKey })
  if (error) {
    console.error(`棚(${shelfKey})の取得に失敗しました:`, error.message)
    return []
  }
  return attachFirstTracks(supabase, (data ?? []) as ShelfAlbumRow[])
}
