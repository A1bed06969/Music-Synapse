'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

export async function markArtistUnreleased(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')

  if (!artistId) {
    redirect('/admin/data/artists/unreleased')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('artist').update({ streaming_status: 'none' }).eq('id', artistId)

  if (error) {
    redirect(
      `/admin/data/artists/unreleased?run=1&error=${encodeURIComponent(`更新に失敗しました: ${error.message}`)}`
    )
  }

  revalidatePath('/admin/data/artists/unreleased')
  revalidatePath(`/artists/${artistId}`)
  redirect(`/admin/data/artists/unreleased?run=1&success=${encodeURIComponent('配信なしとして確定しました。')}`)
}
