'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/sync?${result}=${encodeURIComponent(message)}`)
}

export async function createSyncWork(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  const workType = String(formData.get('work_type') ?? '')
  const companyOrStudio = String(formData.get('company_or_studio') ?? '').trim()
  const yearRaw = String(formData.get('year') ?? '').trim()

  if (!title) {
    redirectWith('error', '作品名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('sync_work').insert({
    title,
    work_type: workType || null,
    company_or_studio: companyOrStudio || null,
    year: yearRaw ? Number(yearRaw) : null,
  })

  if (error) {
    redirectWith('error', `作品の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/sync')
  revalidatePath('/media/sync')
  redirectWith('success', `作品「${title}」を登録しました。`)
}

export async function createSyncEntry(formData: FormData) {
  const syncWorkId = String(formData.get('sync_work_id') ?? '')
  // 同じ曲がシングル/EP版とアルバム収録版など複数のtrack行に分かれている
  // ことがあるため、track_idは複数選択できる(1回の送信で両方に登録できる)
  const trackIds = formData.getAll('track_id').map(String).filter(Boolean)
  const usageDetail = String(formData.get('usage_detail') ?? '').trim()

  if (!syncWorkId || trackIds.length === 0) {
    redirectWith('error', '作品とトラックを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('sync_entry').insert(
    trackIds.map((trackId) => ({
      sync_work_id: syncWorkId,
      track_id: trackId,
      usage_detail: usageDetail || null,
    }))
  )

  if (error) {
    redirectWith('error', `起用楽曲の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/sync')
  revalidatePath(`/media/sync/${syncWorkId}`)
  for (const trackId of trackIds) {
    revalidatePath(`/tracks/${trackId}`)
  }
  redirectWith('success', `起用楽曲を登録しました(${trackIds.length}件)。`)
}
