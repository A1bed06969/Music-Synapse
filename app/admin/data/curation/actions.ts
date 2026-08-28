'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/curation?${result}=${encodeURIComponent(message)}`)
}

export async function createRanking(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const mediaId = String(formData.get('media_id') ?? '')
  const source = String(formData.get('source') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const listType = String(formData.get('list_type') ?? 'ranked').trim()

  if (!name) {
    redirectWith('error', '企画名を入力してください。')
  }
  if (listType !== 'ranked' && listType !== 'selection') {
    redirectWith('error', '企画種別が不正です。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('ranking').insert({
    name,
    media_id: mediaId || null,
    source: source || null,
    description: description || null,
    list_type: listType,
  })

  if (error) {
    redirectWith('error', `企画の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/curation')
  revalidatePath('/media/features')
  redirectWith('success', `企画「${name}」を登録しました。`)
}

export async function createRankingEntry(formData: FormData) {
  const rankingId = String(formData.get('ranking_id') ?? '')
  const rank = String(formData.get('rank') ?? '').trim()
  const periodDate = String(formData.get('period_date') ?? '').trim()
  const metricValue = String(formData.get('metric_value') ?? '').trim()
  const metricLabel = String(formData.get('metric_label') ?? '').trim()
  const trackId = String(formData.get('track_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!rankingId || !periodDate) {
    redirectWith('error', '企画・日付を入力してください。')
  }

  const targetCount = [trackId, albumId, artistId].filter(Boolean).length
  if (targetCount !== 1) {
    redirectWith('error', '対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。')
  }

  const supabase = createAdminClient()

  const { data: ranking } = await supabase.from('ranking').select('list_type').eq('id', rankingId).maybeSingle()
  if (!ranking) {
    redirectWith('error', '指定の企画が見つかりませんでした。')
  }
  if (ranking!.list_type === 'ranked' && !rank) {
    redirectWith('error', '順位あり企画には順位を入力してください。')
  }

  const { error } = await supabase.from('ranking_entry').insert({
    ranking_id: rankingId,
    // 選出企画(順不同)は順位を持たせない。順位あり企画のみ数値を保存する
    rank: ranking!.list_type === 'ranked' && rank ? Number(rank) : null,
    period_date: periodDate,
    metric_value: metricValue ? Number(metricValue) : null,
    metric_label: metricLabel || null,
    track_id: trackId || null,
    album_id: albumId || null,
    artist_id: artistId || null,
  })

  if (error) {
    redirectWith('error', `ランクインデータの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/curation')
  revalidatePath(`/media/features/${rankingId}`)
  redirectWith('success', 'ランクインデータを登録しました。')
}
