'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/tieups?${result}=${encodeURIComponent(message)}`)
}

export async function createTieUp(formData: FormData) {
  const trackId = String(formData.get('track_id') ?? '')
  const category = String(formData.get('category') ?? '')
  const workTitle = String(formData.get('work_title') ?? '').trim()
  const yearRaw = String(formData.get('year') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!trackId || !category || !workTitle) {
    redirectWith('error', '楽曲・種別・作品名は必須です。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('tie_up').insert({
    track_id: trackId,
    category,
    work_title: workTitle,
    year: yearRaw ? Number(yearRaw) : null,
    note: note || null,
  })

  if (error) {
    redirectWith('error', `タイアップの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/tieups')
  redirectWith('success', `「${workTitle}」のタイアップを登録しました。`)
}
