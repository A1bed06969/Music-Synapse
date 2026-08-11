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
  // 同じ曲がシングル/EP版とアルバム収録版など複数のtrack行に分かれている
  // ことがあるため、track_idは複数選択できる(1回の送信で両方に登録できる)
  const trackIds = formData.getAll('track_id').map(String).filter(Boolean)
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!awardId || !year || !result) {
    redirectWith('error', '賞・年・結果を入力してください。')
  }

  const targetCount = [trackIds.length > 0, Boolean(albumId), Boolean(artistId)].filter(Boolean).length
  if (targetCount !== 1) {
    redirectWith('error', '対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。')
  }

  type AwardEntryRow = {
    award_id: string
    year: number
    category: string | null
    result: string
    track_id: string | null
    album_id: string | null
    artist_id: string | null
  }

  const rows: AwardEntryRow[] =
    trackIds.length > 0
      ? trackIds.map((trackId) => ({
          award_id: awardId,
          year: Number(year),
          category: category || null,
          result,
          track_id: trackId,
          album_id: null,
          artist_id: null,
        }))
      : [
          {
            award_id: awardId,
            year: Number(year),
            category: category || null,
            result,
            track_id: null,
            album_id: albumId || null,
            artist_id: artistId || null,
          },
        ]

  const supabase = createAdminClient()
  const { error } = await supabase.from('award_entry').insert(rows)

  if (error) {
    redirectWith('error', `受賞・ノミネートの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/awards')
  revalidatePath('/chronology/awards')
  if (artistId) revalidatePath(`/artists/${artistId}`)
  for (const trackId of trackIds) {
    revalidatePath(`/tracks/${trackId}`)
  }
  redirectWith('success', `受賞・ノミネートを登録しました(${rows.length}件)。`)
}
