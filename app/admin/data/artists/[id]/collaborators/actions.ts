'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { importArtistsFromItunes } from '@/app/admin/import/actions'

export async function importSelectedCollaborators(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const count = Number(formData.get('candidate_count') ?? '0')

  const selectedIds: string[] = []
  for (let i = 0; i < count; i++) {
    const value = String(formData.get(`select_${i}`) ?? '')
    if (value) selectedIds.push(value)
  }

  if (selectedIds.length === 0) {
    redirect(
      `/admin/data/artists/${artistId}/collaborators?error=${encodeURIComponent('登録するアーティストを選択してください。')}`
    )
  }

  const results = await importArtistsFromItunes(selectedIds)
  const successCount = results.filter((r) => r.success).length
  const failedMessages = results.filter((r) => !r.success).map((r) => r.message)

  revalidatePath('/admin/data')

  if (successCount === 0) {
    redirect(
      `/admin/data/artists/${artistId}/collaborators?error=${encodeURIComponent(`登録に失敗しました: ${failedMessages.join(' / ')}`)}`
    )
  }

  const successMessage =
    failedMessages.length > 0
      ? `${successCount}件のアーティストを登録しました(${failedMessages.length}件失敗)。`
      : `${successCount}件のアーティストを登録しました。`

  redirect(`/admin/data/artists/${artistId}/collaborators?success=${encodeURIComponent(successMessage)}`)
}
