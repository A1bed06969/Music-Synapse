'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/discguides?${result}=${encodeURIComponent(message)}`)
}

export async function createDiscGuide(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  const publisher = String(formData.get('publisher') ?? '').trim()
  const publishedYearRaw = String(formData.get('published_year') ?? '').trim()
  const isbn = String(formData.get('isbn') ?? '').trim()

  if (!title) {
    redirectWith('error', '書籍名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('disc_guide').insert({
    title,
    publisher: publisher || null,
    published_year: publishedYearRaw ? Number(publishedYearRaw) : null,
    isbn: isbn || null,
  })

  if (error) {
    redirectWith('error', `書籍の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/discguides')
  redirectWith('success', `「${title}」を登録しました。`)
}

export async function createDiscGuideSelection(formData: FormData) {
  const discGuideId = String(formData.get('disc_guide_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!discGuideId || !albumId) {
    redirectWith('error', '書籍とアルバムを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('disc_guide_selection').insert({
    disc_guide_id: discGuideId,
    album_id: albumId,
    note: note || null,
  })

  if (error) {
    redirectWith('error', `掲載データの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/discguides')
  revalidatePath(`/albums/${albumId}`)
  redirectWith('success', '掲載データを登録しました。')
}
