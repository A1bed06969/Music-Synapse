'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistDetails } from '@/utils/musicbrainz'

function redirectWith(artistId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/artists/${artistId}/musicbrainz?${result}=${encodeURIComponent(message)}`)
}

export async function importMusicBrainzData(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const mbid = String(formData.get('mbid') ?? '')

  if (!artistId || !mbid) {
    redirect('/admin/data')
  }

  let details
  try {
    details = await fetchArtistDetails(mbid)
  } catch (err) {
    console.error('MusicBrainz詳細取得に失敗しました:', err)
    redirectWith(artistId, 'error', 'MusicBrainzからの取得に失敗しました。')
  }

  const supabase = createAdminClient()

  const { data: currentArtist } = await supabase
    .from('artist')
    .select('official_site_url, sns_x_url, sns_instagram_url, musicbrainz_id')
    .eq('id', artistId)
    .single()

  const fieldUpdate: Record<string, string> = {}
  if (!currentArtist?.musicbrainz_id) {
    fieldUpdate.musicbrainz_id = mbid
  }
  if (!currentArtist?.official_site_url && details.officialHomepage) {
    fieldUpdate.official_site_url = details.officialHomepage
  }
  if (!currentArtist?.sns_x_url && details.twitterUrl) {
    fieldUpdate.sns_x_url = details.twitterUrl
  }
  if (!currentArtist?.sns_instagram_url && details.instagramUrl) {
    fieldUpdate.sns_instagram_url = details.instagramUrl
  }
  if (Object.keys(fieldUpdate).length > 0) {
    const { error } = await supabase.from('artist').update(fieldUpdate).eq('id', artistId)
    if (error) {
      redirectWith(artistId, 'error', `プロフィールの更新に失敗しました: ${error.message}`)
    }
  }

  if (details.links.length > 0) {
    const { error } = await supabase
      .from('artist_external_link')
      .upsert(
        details.links.map((link) => ({ artist_id: artistId, link_type: link.type, url: link.url })),
        { onConflict: 'artist_id,link_type,url', ignoreDuplicates: true }
      )
    if (error) {
      redirectWith(artistId, 'error', `外部リンクの保存に失敗しました: ${error.message}`)
    }
  }

  let genresLinked = 0
  for (const genreName of details.genres) {
    // Case-insensitive lookup: MusicBrainz returns lowercase genre names
    // (e.g. "j-pop") but this app's existing genres may be title-cased
    // (e.g. "J-POP") — an exact match would otherwise create duplicates.
    const { data: existingGenre } = await supabase.from('genre').select('id').ilike('name', genreName).maybeSingle()
    let genreId = existingGenre?.id as string | undefined
    if (!genreId) {
      const { data: createdGenre, error: createError } = await supabase
        .from('genre')
        .insert({ name: genreName })
        .select('id')
        .single()
      if (createError) {
        console.error(`ジャンル「${genreName}」の作成に失敗しました:`, createError)
        continue
      }
      genreId = createdGenre.id
    }
    const { error: linkError } = await supabase.from('artist_genre').upsert({ artist_id: artistId, genre_id: genreId })
    if (linkError) {
      console.error(`ジャンル「${genreName}」の紐付けに失敗しました:`, linkError)
    } else {
      genresLinked += 1
    }
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)

  const linkCount = details.links.length
  const profileFieldCount = Object.keys(fieldUpdate).length
  redirectWith(
    artistId,
    'success',
    `外部リンク${linkCount}件・ジャンル${genresLinked}件を取り込みました(プロフィール${profileFieldCount}件を更新)`
  )
}
