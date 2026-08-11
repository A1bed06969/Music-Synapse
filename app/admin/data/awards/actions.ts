'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/awards?${result}=${encodeURIComponent(message)}`)
}

export async function createAward(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!name) {
    redirectWith('error', '賞名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('award').insert({
    name,
    country: country || null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `賞の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/awards')
  revalidatePath('/chronology/awards')
  redirectWith('success', `「${name}」を登録しました。`)
}

export async function createAwardEntry(formData: FormData) {
  const awardId = String(formData.get('award_id') ?? '')
  const year = String(formData.get('year') ?? '').trim()
  const category = String(formData.get('category') ?? '').trim()
  const result = String(formData.get('result') ?? '')
  const trackId = String(formData.get('track_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!awardId || !year || !result) {
    redirectWith('error', '賞・年・結果を入力してください。')
  }

  const targetCount = [trackId, albumId, artistId].filter(Boolean).length
  if (targetCount !== 1) {
    redirectWith('error', '対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('award_entry').insert({
    award_id: awardId,
    year: Number(year),
    category: category || null,
    result,
    track_id: trackId || null,
    album_id: albumId || null,
    artist_id: artistId || null,
  })

  if (error) {
    redirectWith('error', `受賞・ノミネートの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/awards')
  revalidatePath('/chronology/awards')
  if (artistId) revalidatePath(`/artists/${artistId}`)
  redirectWith('success', '受賞・ノミネートを登録しました。')
}
