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

export async function updateSyncWork(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const workType = String(formData.get('work_type') ?? '')
  const companyOrStudio = String(formData.get('company_or_studio') ?? '').trim()
  const yearRaw = String(formData.get('year') ?? '').trim()

  if (!id || !title) {
    redirectWith('error', '作品名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('sync_work')
    .update({
      title,
      work_type: workType || null,
      company_or_studio: companyOrStudio || null,
      year: yearRaw ? Number(yearRaw) : null,
    })
    .eq('id', id)

  if (error) {
    redirectWith('error', `作品の更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/sync')
  revalidatePath(`/media/sync/${id}`)
  redirectWith('success', `作品「${title}」を更新しました。`)
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

export async function updateSyncEntry(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const syncWorkId = String(formData.get('sync_work_id') ?? '')
  const trackId = String(formData.get('track_id') ?? '')
  const usageDetail = String(formData.get('usage_detail') ?? '').trim()
  const previousTrackId = String(formData.get('previous_track_id') ?? '')

  if (!id || !syncWorkId || !trackId) {
    redirectWith('error', '作品とトラックを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('sync_entry')
    .update({ sync_work_id: syncWorkId, track_id: trackId, usage_detail: usageDetail || null })
    .eq('id', id)

  if (error) {
    redirectWith('error', `更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/sync')
  revalidatePath(`/media/sync/${syncWorkId}`)
  revalidatePath(`/tracks/${trackId}`)
  if (previousTrackId && previousTrackId !== trackId) revalidatePath(`/tracks/${previousTrackId}`)
  redirectWith('success', '起用楽曲を更新しました。')
}

export async function deleteSyncEntry(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const trackId = String(formData.get('track_id') ?? '')
  const syncWorkId = String(formData.get('sync_work_id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('sync_entry').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/sync')
  if (syncWorkId) revalidatePath(`/media/sync/${syncWorkId}`)
  if (trackId) revalidatePath(`/tracks/${trackId}`)
  redirectWith('success', '起用楽曲を削除しました。')
}
