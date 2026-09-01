import type { SupabaseClient } from '@supabase/supabase-js'

type Supabase = SupabaseClient<any, any, any>

export const MIN_SHELF_ALBUMS = 8
export const NEW_ARRIVALS_DAYS = 30
export const NEW_ARRIVALS_KEY = 'new-arrivals'
export const NEW_ARRIVALS_LABEL = 'New Arrival'

export type DiggingShelf = {
  key: string
  label: string
  isGenre: boolean
  albumCount: number | null
  sampleJacketUrl: string | null
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

export type ArtistExternalLink = { id: string; link_type: string; url: string }

export type RecordDetail = {
  labelName: string | null
  catalogNumber: string | null
  artistName: string
  officialSiteUrl: string | null
  snsXUrl: string | null
  snsInstagramUrl: string | null
  appleMusicArtistId: string | null
  spotifyArtistId: string | null
  discogsUrl: string | null
  externalLinks: ArtistExternalLink[]
}

// サーバーはUTCで動くため、JSTの「今日からN日前」を単純な日数引き算ではなく
// UTC基準のDate.UTCで組み立てる(utils/homeCards.tsのtomorrowJSTと同じ考え方)
export function daysAgoJST(days: number): string {
  const todayJST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [y, m, d] = todayJST.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
}

// 今日のJST日付を返す（daysAgoJST(0)と同義だが、意図を明確にするためのヘルパー）
export function todayJST(): string {
  return daysAgoJST(0)
}

type ShelfAlbumRow = {
  album_id: string
  title: string
  jacket_url: string
  artist_id: string
  artist_name: string
  release_date: string | null
  first_track_id: string | null
  first_track_preview_url: string | null
}

function mapShelfRow(r: ShelfAlbumRow): DiggingRecord {
  return {
    id: r.album_id,
    title: r.title,
    jacketUrl: r.jacket_url,
    artistId: r.artist_id,
    artistName: r.artist_name,
    releaseDate: r.release_date,
    firstTrackId: r.first_track_id,
    firstTrackPreviewUrl: r.first_track_preview_url,
  }
}

/** 「CHOOSE YOUR SHELF」ピッカー用に、新着棚の代表ジャケット1枚を軽量に取得する
 * (record_digging_new_arrivals RPCをフル呼び出しせず、直近1件だけ引く)。 */
async function fetchNewArrivalsSampleJacket(supabase: Supabase): Promise<string | null> {
  const { data, error } = await supabase
    .from('album')
    .select('jacket_url')
    .not('jacket_url', 'is', null)
    .gte('release_date', daysAgoJST(NEW_ARRIVALS_DAYS))
    .lte('release_date', todayJST())
    .order('release_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('新着棚のサンプルジャケット取得に失敗しました:', error.message)
    return null
  }
  return data?.jacket_url ?? null
}

/** 棚として採用できるジャンル一覧(MIN_SHELF_ALBUMS枚以上のジャケット付き
 * アルバムを持つジャンルのみ)を、先頭に「新着」を付けて返す。棚選択UIで
 * 実カタログのジャケットをサムネイル表示するため、各棚の代表ジャケットも
 * 合わせて返す。 */
export async function fetchEligibleGenreShelves(supabase: Supabase): Promise<DiggingShelf[]> {
  const [{ data, error }, newArrivalsSample] = await Promise.all([
    supabase.rpc('record_digging_eligible_genres', { min_albums: MIN_SHELF_ALBUMS }),
    fetchNewArrivalsSampleJacket(supabase),
  ])

  const newArrivalsShelf: DiggingShelf = {
    key: NEW_ARRIVALS_KEY,
    label: NEW_ARRIVALS_LABEL,
    isGenre: false,
    albumCount: null,
    sampleJacketUrl: newArrivalsSample,
  }

  if (error) {
    console.error('棚候補ジャンルの取得に失敗しました:', error.message)
    return [newArrivalsShelf]
  }

  const genreShelves: DiggingShelf[] = (data ?? []).map(
    (row: { genre_id: string; genre_name: string; album_count: number; sample_jacket_url: string | null }) => ({
      key: row.genre_id,
      label: row.genre_name,
      isGenre: true,
      albumCount: row.album_count,
      sampleJacketUrl: row.sample_jacket_url,
    })
  )

  return [newArrivalsShelf, ...genreShelves]
}

/** モーダル右パネル(現在再生中の詳細)向けに、レーベル/カタログ番号と
 * アーティストの外部リンク群をまとめて取得する。棚のスワイプ本体には不要な
 * 情報のため、現在のレコードが変わった時だけ個別に取得する(棚ロード時に
 * 全件分をまとめて取ると重くなるため)。 */
export async function fetchRecordDetail(supabase: Supabase, albumId: string, artistId: string): Promise<RecordDetail | null> {
  const [albumResult, artistResult, linksResult] = await Promise.all([
    supabase.from('album').select('catalog_number, label:label_id(name)').eq('id', albumId).maybeSingle(),
    supabase
      .from('artist')
      .select('name, official_site_url, sns_x_url, sns_instagram_url, apple_music_artist_id, spotify_artist_id')
      .eq('id', artistId)
      .maybeSingle(),
    supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', artistId),
  ])

  if (artistResult.error || !artistResult.data) {
    console.error('レコード詳細(アーティスト情報)の取得に失敗しました:', artistResult.error?.message)
    return null
  }

  const label = albumResult.data?.label as { name: string } | { name: string }[] | null
  const labelName = Array.isArray(label) ? (label[0]?.name ?? null) : (label?.name ?? null)
  const externalLinks: ArtistExternalLink[] = linksResult.data ?? []
  const discogsUrl = externalLinks.find((l) => l.link_type === 'discogs')?.url ?? null

  return {
    labelName,
    catalogNumber: albumResult.data?.catalog_number ?? null,
    artistName: artistResult.data.name,
    officialSiteUrl: artistResult.data.official_site_url,
    snsXUrl: artistResult.data.sns_x_url,
    snsInstagramUrl: artistResult.data.sns_instagram_url,
    appleMusicArtistId: artistResult.data.apple_music_artist_id,
    spotifyArtistId: artistResult.data.spotify_artist_id,
    discogsUrl,
    externalLinks,
  }
}

/** 指定した棚に属するレコード一覧を返す。'new-arrivals'はジャンル不問で
 * 直近NEW_ARRIVALS_DAYS日以内にリリースされたアルバムを返す。各アルバムの
 * 1曲目はRPC側のLEFT JOIN LATERALで同時に取得するため、別クエリは不要。
 * RPC 結果は 1000 行制限があるため、.range() でページネーションする。 */
export async function fetchShelfRecords(supabase: Supabase, shelfKey: string): Promise<DiggingRecord[]> {
  const pageSize = 1000

  if (shelfKey === NEW_ARRIVALS_KEY) {
    let allData: ShelfAlbumRow[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase.rpc('record_digging_new_arrivals', {
        since_date: daysAgoJST(NEW_ARRIVALS_DAYS),
        until_date: todayJST(),
      }).range(offset, offset + pageSize - 1)

      if (error) {
        console.error('新着棚の取得に失敗しました:', error.message)
        return []
      }

      if (!data || data.length === 0) {
        hasMore = false
        break
      }

      allData = allData.concat(data as ShelfAlbumRow[])

      if (data.length < pageSize) {
        hasMore = false
      } else {
        offset += pageSize
      }
    }

    return allData.map(mapShelfRow)
  }

  let allData: ShelfAlbumRow[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase.rpc('record_digging_shelf_albums', { target_genre_id: shelfKey }).range(offset, offset + pageSize - 1)

    if (error) {
      console.error(`棚(${shelfKey})の取得に失敗しました:`, error.message)
      return []
    }

    if (!data || data.length === 0) {
      hasMore = false
      break
    }

    allData = allData.concat(data as ShelfAlbumRow[])

    if (data.length < pageSize) {
      hasMore = false
    } else {
      offset += pageSize
    }
  }

  return allData.map(mapShelfRow)
}
