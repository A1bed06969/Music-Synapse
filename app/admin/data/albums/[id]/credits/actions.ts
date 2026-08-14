'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { writeAlbumCredits, type UnifiedCreditInput } from '@/utils/creditImport'

function redirectWith(albumId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/albums/${albumId}/credits?${result}=${encodeURIComponent(message)}`)
}

export async function importAlbumCredits(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const creditCount = Number(formData.get('credit_count') ?? '0')

  if (!artistId || !albumId || !creditCount) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()

  const { data: album } = await supabase.from('album').select('artist_id').eq('id', albumId).maybeSingle()

  if (!album || album.artist_id !== artistId) {
    redirectWith(albumId, 'error', 'アルバムとアーティストの組み合わせが不正です。')
  }

  const credits: UnifiedCreditInput[] = []
  for (let i = 0; i < creditCount; i++) {
    if (formData.get(`credit_${i}_include`) !== '1') continue

    credits.push({
      personName: String(formData.get(`credit_${i}_person_name`) ?? ''),
      personSourceId: String(formData.get(`credit_${i}_person_source_id`) ?? ''),
      source: String(formData.get(`credit_${i}_source`) ?? '') === 'discogs' ? 'discogs' : 'musicbrainz',
      role: String(formData.get(`credit_${i}_role`) ?? ''),
      sourceUrl: String(formData.get(`credit_${i}_source_url`) ?? ''),
      trackId: String(formData.get(`credit_${i}_track_id`) ?? '') || null,
      instrumentName: String(formData.get(`credit_${i}_instrument_name`) ?? '') || null,
    })
  }

  const { relationsWritten, creditsWritten, instrumentsWritten, failureCount } = await writeAlbumCredits(
    supabase,
    artistId,
    albumId,
    credits
  )

  revalidatePath(`/artists/${artistId}`)
  revalidatePath(`/artists/${artistId}/relations`)
  revalidatePath('/relations')

  let message = `アーティスト関係${relationsWritten}件・クレジット${creditsWritten}件・使用楽器${instrumentsWritten}件を取り込みました`
  if (failureCount > 0) {
    message += `、失敗${failureCount}件`
  }

  const severity =
    relationsWritten === 0 && creditsWritten === 0 && instrumentsWritten === 0 && failureCount > 0 ? 'error' : 'success'

  redirectWith(albumId, severity, message)
}
