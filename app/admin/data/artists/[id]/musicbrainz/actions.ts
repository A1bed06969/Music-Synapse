'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistDetails } from '@/utils/musicbrainz'
import { writeArtistProfileFromMusicBrainzDetails } from '@/utils/artistProfileImport'

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

  const { profileFieldCount, linkCount, genresLinked, membershipsWritten, membershipsUnresolved } =
    await writeArtistProfileFromMusicBrainzDetails(supabase, artistId, mbid, details)

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)

  const unresolvedNote =
    membershipsUnresolved.length > 0
      ? `(未登録メンバー: ${membershipsUnresolved.join('、')})`
      : ''
  redirectWith(
    artistId,
    'success',
    `外部リンク${linkCount}件・ジャンル${genresLinked}件・メンバーシップ${membershipsWritten}件を取り込みました${unresolvedNote}(プロフィール${profileFieldCount}件を更新)`
  )
}
