'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchLabel, type MusicBrainzLabelSearchResult } from '@/utils/musicbrainz'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/labels?${result}=${encodeURIComponent(message)}`)
}

export async function createLabel(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const nameKana = String(formData.get('name_kana') ?? '').trim()
  const foundedYearRaw = String(formData.get('founded_year') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!name) {
    redirectWith('error', 'レーベル名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('label').insert({
    name,
    name_kana: nameKana || null,
    founded_year: foundedYearRaw ? Number(foundedYearRaw) : null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `レーベルの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/labels')
  redirectWith('success', `レーベル「${name}」を登録しました。`)
}

export async function linkArtistLabel(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const labelId = String(formData.get('label_id') ?? '')
  const startDate = String(formData.get('start_date') ?? '').trim()

  if (!artistId || !labelId) {
    redirectWith('error', 'アーティストとレーベルを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('artist_label').insert({
    artist_id: artistId,
    label_id: labelId,
    start_date: startDate || null,
  })

  if (error) {
    redirectWith('error', `レーベルの紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/labels')
  redirectWith('success', 'アーティストにレーベルを紐付けました。')
}

export async function linkAlbumLabel(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const labelId = String(formData.get('label_id') ?? '')

  if (!albumId || !labelId) {
    redirectWith('error', 'アルバムとレーベルを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('album').update({ label_id: labelId }).eq('id', albumId)

  if (error) {
    redirectWith('error', `アルバムのレーベル紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/labels')
  revalidatePath(`/labels/${labelId}`)
  revalidatePath(`/albums/${albumId}`)
  redirectWith('success', 'アルバムにレーベルを紐付けました。')
}

export async function searchMusicBrainzLabel(name: string): Promise<MusicBrainzLabelSearchResult[]> {
  return searchLabel(name)
}

/** MusicBrainzの検索候補からレーベルを作成する。同名レーベルが既に存在する場合は
 * 新規作成せず、founded_yearが未設定なら補完するだけに留める(upsertArtistFromItunes
 * の重複防止と同じ考え方)。 */
export async function createLabelFromMusicBrainz(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const foundedYearRaw = String(formData.get('founded_year') ?? '').trim()
  const foundedYear = foundedYearRaw ? Number(foundedYearRaw) : null

  if (!name) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { data: existingRows } = await supabase
    .from('label')
    .select('id, founded_year')
    .eq('name', name)
    .limit(1)
  const existing = existingRows?.[0]

  if (existing) {
    if (!existing.founded_year && foundedYear) {
      await supabase.from('label').update({ founded_year: foundedYear }).eq('id', existing.id)
    }
    revalidatePath('/admin/data/labels')
    redirectWith('success', `「${name}」は既に登録されています(設立年が未設定だった場合は補完しました)。`)
  }

  const { error } = await supabase.from('label').insert({ name, founded_year: foundedYear })
  if (error) {
    redirectWith('error', `レーベルの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/labels')
  redirectWith('success', `レーベル「${name}」をMusicBrainzから登録しました。`)
}
