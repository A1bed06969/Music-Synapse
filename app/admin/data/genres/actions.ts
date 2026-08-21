'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchWikipediaGenre, type WikipediaGenreInfo } from '@/utils/wikipediaGenre'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/genres?${result}=${encodeURIComponent(message)}`)
}

export async function createGenre(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const originYearRaw = String(formData.get('origin_year') ?? '').trim()

  if (!name) {
    redirectWith('error', 'ジャンル名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('genre').insert({
    name,
    origin_year: originYearRaw ? Number(originYearRaw) : null,
  })

  if (error) {
    redirectWith('error', `ジャンルの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/genres')
  redirectWith('success', `ジャンル「${name}」を登録しました。`)
}

export async function linkArtistGenre(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const genreId = String(formData.get('genre_id') ?? '')

  if (!artistId || !genreId) {
    redirectWith('error', 'アーティストとジャンルを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('artist_genre').upsert({ artist_id: artistId, genre_id: genreId })

  if (error) {
    redirectWith('error', `ジャンルの紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/genres')
  revalidatePath('/relations')
  redirectWith('success', 'アーティストにジャンルを紐付けました。')
}

export async function lookupWikipediaGenre(name: string): Promise<WikipediaGenreInfo | null> {
  return searchWikipediaGenre(name)
}

/** Wikipediaから取り込んだ発祥情報を対象ジャンルへ反映し、起源/派生/サブジャンル名を
 * 既存のgenre.nameとilikeで照合する。ilikeで厳密に1件だけ一致した場合のみ
 * genre_lineageへ自動リンクする(0件・2件以上は過剰マッチ回避のためスキップし、
 * 管理画面には未リンクの名前として残す)。 */
export async function applyWikipediaGenreLookup(formData: FormData) {
  const genreId = String(formData.get('genre_id') ?? '')
  const sourceUrl = String(formData.get('source_url') ?? '')
  const originYearRaw = String(formData.get('origin_year') ?? '').trim()
  const originPlace = String(formData.get('origin_place') ?? '').trim()
  const stylisticOrigins: string[] = JSON.parse(String(formData.get('stylistic_origins_json') ?? '[]'))
  const subgenres: string[] = JSON.parse(String(formData.get('subgenres_json') ?? '[]'))
  const derivatives: string[] = JSON.parse(String(formData.get('derivatives_json') ?? '[]'))

  if (!genreId) {
    redirectWith('error', '対象ジャンルを選択してください。')
  }

  const supabase = createAdminClient()

  const update: Record<string, unknown> = { wikipedia_url: sourceUrl || null }
  if (originYearRaw) update.origin_year = Number(originYearRaw)
  if (originPlace) update.origin_country = originPlace

  const { error: updateError } = await supabase.from('genre').update(update).eq('id', genreId)
  if (updateError) {
    redirectWith('error', `ジャンルの更新に失敗しました: ${updateError.message}`)
  }

  let linkedCount = 0
  const unmatched: string[] = []

  async function linkIfUnambiguous(name: string, direction: 'origin' | 'derived') {
    const { data: matches } = await supabase.from('genre').select('id').ilike('name', name).limit(2)
    if (!matches || matches.length !== 1) {
      unmatched.push(name)
      return
    }
    const matchedId = matches[0].id
    if (matchedId === genreId) return // 自己参照は無視
    const parentId = direction === 'origin' ? matchedId : genreId
    const childId = direction === 'origin' ? genreId : matchedId
    const { error } = await supabase
      .from('genre_lineage')
      .upsert({ parent_genre_id: parentId, child_genre_id: childId }, { onConflict: 'parent_genre_id,child_genre_id', ignoreDuplicates: true })
    if (!error) linkedCount++
  }

  for (const name of stylisticOrigins) {
    await linkIfUnambiguous(name, 'origin')
  }
  for (const name of [...subgenres, ...derivatives]) {
    await linkIfUnambiguous(name, 'derived')
  }

  revalidatePath('/admin/data/genres')
  revalidatePath(`/genres/${genreId}`)

  const parts = [`Wikipediaから情報を取り込みました。`]
  if (linkedCount > 0) parts.push(`自動リンク${linkedCount}件。`)
  if (unmatched.length > 0) parts.push(`未登録のジャンル名: ${unmatched.join(', ')}`)
  redirectWith('success', parts.join(''))
}

export async function addGenreHighlight(formData: FormData) {
  const genreId = String(formData.get('genre_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '').trim()
  const albumId = String(formData.get('album_id') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!genreId || (!artistId && !albumId)) {
    redirectWith('error', 'ジャンルと、アーティストまたはアルバムを指定してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('genre_highlight').insert({
    genre_id: genreId,
    artist_id: artistId || null,
    album_id: albumId || null,
    note: note || null,
  })

  if (error) {
    redirectWith('error', `代表アーティスト/作品の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/genres')
  revalidatePath(`/genres/${genreId}`)
  redirectWith('success', '代表アーティスト/作品を登録しました。')
}

export async function deleteGenreHighlight(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const genreId = String(formData.get('genre_id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('genre_highlight').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/genres')
  if (genreId) revalidatePath(`/genres/${genreId}`)
  redirectWith('success', '削除しました。')
}
