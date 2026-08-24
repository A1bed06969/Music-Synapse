'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchDiscogsArtistInfo } from '@/utils/discogs'

function redirectWith(artistId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/artists/${artistId}/discogs-lookup?${result}=${encodeURIComponent(message)}`)
}

export async function applyDiscogsArtistLookup(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const discogsUrl = String(formData.get('discogs_url') ?? '').trim()

  if (!artistId || !discogsUrl) {
    redirect('/admin/data')
  }

  let info
  try {
    info = await fetchDiscogsArtistInfo(discogsUrl)
  } catch (err) {
    redirectWith(artistId, 'error', `取得に失敗しました: ${(err as Error).message}`)
  }

  if (!info.imageUrl && !info.profile) {
    redirectWith(artistId, 'error', 'アーティストページから画像・プロフィールを読み取れませんでした。')
  }

  const supabase = createAdminClient()

  const update: Record<string, unknown> = { discogs_artist_id: String(info.discogsArtistId) }
  if (info.imageUrl) update.image_url = info.imageUrl
  if (info.profile) update.bio = info.profile

  const { error: updateError } = await supabase.from('artist').update(update).eq('id', artistId)

  if (updateError) {
    redirectWith(artistId, 'error', `更新に失敗しました: ${updateError.message}`)
  }

  revalidatePath(`/artists/${artistId}`)
  revalidatePath(`/admin/data/artists/${artistId}/edit`)
  revalidatePath(`/admin/data/artists/${artistId}/discogs-lookup`)
  redirectWith(
    artistId,
    'success',
    `Discogsの情報を反映しました。${info.imageUrl ? '(画像取込)' : ''}${info.profile ? '(プロフィール取込)' : ''}`
  )
}
