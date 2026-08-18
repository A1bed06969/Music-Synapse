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

/** 重複レーベル(source)をcanonical(target)へ統合する。label_idを参照している
 * 3テーブル(album/artist_label/label_founder)を付け替えたのちsourceを削除する。
 * artist_label/label_founderは、target側に既に同じ組み合わせの行があれば
 * 付け替えず削除する(重複防止)。取り消せない操作。 */
export async function mergeLabel(formData: FormData) {
  const sourceId = String(formData.get('source_label_id') ?? '')
  const targetId = String(formData.get('target_label_id') ?? '')

  if (!sourceId || !targetId || sourceId === targetId) {
    redirectWith('error', '統合元と統合先には異なるレーベルを選んでください。')
  }

  const supabase = createAdminClient()

  const { data: source } = await supabase
    .from('label')
    .select('name, name_kana, founded_year, description')
    .eq('id', sourceId)
    .single()
  const { data: target } = await supabase
    .from('label')
    .select('id, name, name_kana, founded_year, description')
    .eq('id', targetId)
    .single()

  if (!source || !target) {
    redirectWith('error', '指定のレーベルが見つかりませんでした。')
  }

  // メタデータ補完(統合先が未設定の項目のみ、統合元の値で埋める)
  const metaFill: Record<string, string | number> = {}
  if (!target!.name_kana && source!.name_kana) metaFill.name_kana = source!.name_kana
  if (!target!.founded_year && source!.founded_year) metaFill.founded_year = source!.founded_year
  if (!target!.description && source!.description) metaFill.description = source!.description
  if (Object.keys(metaFill).length > 0) {
    await supabase.from('label').update(metaFill).eq('id', targetId)
  }

  // album.label_id はUNIQUE制約に関わる組み合わせが無いため単純に付け替えるだけでよい
  const { error: albumError } = await supabase.from('album').update({ label_id: targetId }).eq('label_id', sourceId)
  if (albumError) {
    redirectWith('error', `アルバムの付け替えに失敗しました: ${albumError.message}`)
  }

  // artist_label: (artist_id, target)が既にあれば重複させず削除、無ければ付け替え
  const { data: sourceArtistLabels } = await supabase
    .from('artist_label')
    .select('id, artist_id')
    .eq('label_id', sourceId)
  const { data: targetArtistLabels } = await supabase.from('artist_label').select('artist_id').eq('label_id', targetId)
  const targetArtistIds = new Set((targetArtistLabels ?? []).map((r) => r.artist_id))
  for (const row of sourceArtistLabels ?? []) {
    if (targetArtistIds.has(row.artist_id)) {
      await supabase.from('artist_label').delete().eq('id', row.id)
    } else {
      await supabase.from('artist_label').update({ label_id: targetId }).eq('id', row.id)
    }
  }

  // label_founder: (person_id, target)が既にあれば重複させず削除、無ければ付け替え
  const { data: sourceFounders } = await supabase.from('label_founder').select('id, person_id').eq('label_id', sourceId)
  const { data: targetFounders } = await supabase.from('label_founder').select('person_id').eq('label_id', targetId)
  const targetFounderPersonIds = new Set((targetFounders ?? []).map((r) => r.person_id))
  for (const row of sourceFounders ?? []) {
    if (targetFounderPersonIds.has(row.person_id)) {
      await supabase.from('label_founder').delete().eq('id', row.id)
    } else {
      await supabase.from('label_founder').update({ label_id: targetId }).eq('id', row.id)
    }
  }

  const { error: deleteError } = await supabase.from('label').delete().eq('id', sourceId)
  if (deleteError) {
    redirectWith('error', `統合元レーベルの削除に失敗しました(付け替えは完了しています): ${deleteError.message}`)
  }

  revalidatePath('/admin/data/labels')
  revalidatePath(`/labels/${targetId}`)
  redirectWith('success', `「${source!.name}」を「${target!.name}」へ統合しました。`)
}
