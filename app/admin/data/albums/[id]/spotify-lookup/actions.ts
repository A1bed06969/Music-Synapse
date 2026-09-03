'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchSpotifyAlbum, parseSpotifyAlbumUrl } from '@/utils/spotify'

function redirectWith(albumId: string, result: 'success' | 'error', message: string, from?: string): never {
  const params = new URLSearchParams({ [result]: message })
  if (from) params.set('from', from)
  redirect(`/admin/data/albums/${albumId}/spotify-lookup?${params.toString()}`)
}

/** Apple Musicのカタログに存在しない(海外インディー・Spotify限定配信等の)
 * アルバムを、SpotifyのアルバムページURLから取り込む。tower-lookup/
 * discogs-lookupと同じ「取り込み専用ページ」パターン(既存アルバム行を
 * その場で更新するだけで、削除・作り直しは一切しない)。 */
export async function applySpotifyLookup(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const spotifyUrl = String(formData.get('spotify_url') ?? '').trim()
  const from = String(formData.get('from') ?? '') || undefined

  if (!albumId || !spotifyUrl) {
    redirect('/admin/data')
  }

  const spotifyAlbumId = parseSpotifyAlbumUrl(spotifyUrl)
  if (!spotifyAlbumId) {
    redirectWith(albumId, 'error', 'SpotifyのアルバムページURL(https://open.spotify.com/album/...)を貼ってください。', from)
  }

  let info
  try {
    info = await fetchSpotifyAlbum(spotifyAlbumId)
  } catch (err) {
    redirectWith(albumId, 'error', `取得に失敗しました: ${(err as Error).message}`, from)
  }

  if (!info) {
    redirectWith(albumId, 'error', 'Spotifyでこのアルバムが見つかりませんでした。URLをご確認ください。', from)
  }

  const supabase = createAdminClient()

  const { data: currentAlbum } = await supabase.from('album').select('jacket_url, release_date, streaming_status').eq('id', albumId).single()

  const update: Record<string, unknown> = {
    spotify_album_id: info.id,
    spotify_available: true,
  }
  // 既存の値(iTunes等から取れているもの)は上書きしない、無い項目だけ埋める
  if (!currentAlbum?.jacket_url && info.imageUrl) update.jacket_url = info.imageUrl
  if (!currentAlbum?.release_date && info.releaseDate) update.release_date = info.releaseDate
  // 「未解禁」扱いだったアルバムがSpotifyで実在確認できた以上、もう未解禁ではない
  if (currentAlbum?.streaming_status === 'unreleased') update.streaming_status = null

  const { error: updateError } = await supabase.from('album').update(update).eq('id', albumId)
  if (updateError) {
    redirectWith(albumId, 'error', `更新に失敗しました: ${updateError.message}`, from)
  }

  // 既にトラックが登録されている場合は重複作成を避けるため、まだ1件も無いときだけ
  // Spotifyの収録内容から取り込む(tower-lookupと同じ方針)
  let tracksAdded = 0
  if (info.tracks.length > 0) {
    const { count: existingTrackCount } = await supabase
      .from('track')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', albumId)

    if (!existingTrackCount) {
      const { data: albumArtist } = await supabase.from('album').select('artist_id').eq('id', albumId).single()
      const { error: trackError } = await supabase.from('track').insert(
        info.tracks.map((t) => ({
          album_id: albumId,
          artist_id: albumArtist?.artist_id ?? null,
          track_no: t.trackNumber,
          disc_number: t.discNumber,
          title: t.name,
          duration_seconds: Math.round(t.durationMs / 1000),
          spotify_track_id: t.id,
          preview_url: t.previewUrl,
        }))
      )
      if (trackError) {
        console.error(`トラックの登録に失敗しました(album_id=${albumId}):`, trackError.message)
      } else {
        tracksAdded = info.tracks.length
      }
    }
  }

  revalidatePath(`/albums/${albumId}`)
  revalidatePath(`/admin/data/albums/${albumId}/spotify-lookup`)
  redirectWith(
    albumId,
    'success',
    `Spotifyの情報を反映しました。${tracksAdded > 0 ? `(トラック${tracksAdded}件を追加)` : ''}`,
    from
  )
}
