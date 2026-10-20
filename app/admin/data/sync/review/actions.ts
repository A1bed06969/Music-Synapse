'use server'

import { safeRevalidatePath } from '@/utils/safeRevalidate'
import { createAdminClient } from '@/utils/Supabase/admin'

export type TrackHit = { id: string; title: string; artist: string | null; album: string | null; releaseDate: string | null; jacketUrl: string | null }

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

/** 曲名(と任意でアーティスト名)でカタログの曲を探す。確認画面の「紐付け先を探す」用 */
export async function searchTracksForCandidate(title: string, artist?: string): Promise<TrackHit[]> {
  const q = title.trim().replace(/[%_]/g, '')
  if (!q) return []
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('track')
    .select('id, title, artist:artist_id(name), album:album_id(title, release_date, jacket_url)')
    .ilike('title', `%${q}%`)
    .limit(60)
  const a = (artist ?? '').trim().toLowerCase()
  const hits = (data ?? []).map((t) => {
    const al = firstOf(t.album)
    return {
      id: t.id as string,
      title: t.title as string,
      artist: firstOf(t.artist)?.name ?? null,
      album: al?.title ?? null,
      releaseDate: al?.release_date ?? null,
      jacketUrl: al?.jacket_url ?? null,
    }
  })
  // アーティスト名が近いものを先に(絞り込みはしない。表記が違って探せなくなるのを避けるため)
  hits.sort((x, y) => Number((y.artist ?? '').toLowerCase().includes(a) && !!a) - Number((x.artist ?? '').toLowerCase().includes(a) && !!a))
  return hits.slice(0, 20)
}

/** この候補を、選んだ曲に紐付けて、タイアップとして反映する(人が確認したので確信度は1) */
export async function approveCandidate(candidateId: string, trackId: string): Promise<{ ok: boolean; message: string }> {
  const supabase = createAdminClient()
  const { data: c } = await supabase.from('sync_candidate').select('*').eq('id', candidateId).maybeSingle()
  if (!c) return { ok: false, message: '候補が見つかりません。' }

  let workId: string | null = null
  const { data: existing } = await supabase.from('sync_work').select('id').eq('source_key', c.work_key).maybeSingle()
  if (existing) workId = existing.id
  else {
    const title = String(c.work_title).replace(/\s*[（(][^）)]*(?:アニメ|漫画|ドラマ|小説|ゲーム|映画|作品|テレビ)[^）)]*[）)]\s*$/, '').trim()
    const { data: created, error } = await supabase
      .from('sync_work')
      .insert({ title, work_type: c.work_type, year: c.year, source_key: c.work_key, source_url: c.source_url, season_label: c.season_label })
      .select('id')
      .single()
    if (error || !created) return { ok: false, message: `作品の作成に失敗: ${error?.message}` }
    workId = created.id
  }

  const { data: entry, error } = await supabase
    .from('sync_entry')
    .insert({ sync_work_id: workId, track_id: trackId, usage_detail: c.note, role: c.role || null, source_url: c.source_url, match_method: 'manual', confidence: 1, candidate_id: candidateId })
    .select('id')
    .single()
  let entryId = entry?.id as string | undefined
  if (error?.code === '23505') {
    const { data: dup } = await supabase.from('sync_entry').select('id').eq('sync_work_id', workId).eq('track_id', trackId).limit(1).maybeSingle()
    entryId = dup?.id
  } else if (error || !entry) {
    return { ok: false, message: `反映に失敗: ${error?.message}` }
  }
  await supabase
    .from('sync_candidate')
    .update({ status: 'applied', matched_track_id: trackId, match_method: 'manual', match_confidence: 1, match_reason: '確認画面で紐付け', applied_entry_id: entryId ?? null })
    .eq('id', candidateId)
  revalidate()
  return { ok: true, message: '紐付けました。' }
}

/** この候補は採用しない(別の作品の曲・誤抽出など) */
export async function rejectCandidate(candidateId: string): Promise<{ ok: boolean }> {
  const supabase = createAdminClient()
  await supabase.from('sync_candidate').update({ status: 'rejected', match_reason: '確認画面で却下' }).eq('id', candidateId)
  revalidate()
  return { ok: true }
}

/** 確信度の低い自動の紐付けを、確認済みにする */
export async function confirmEntry(entryId: string): Promise<{ ok: boolean }> {
  const supabase = createAdminClient()
  await supabase.from('sync_entry').update({ confidence: 1, match_method: 'manual' }).eq('id', entryId)
  revalidate()
  return { ok: true }
}

/** 誤った自動の紐付けを外す(候補は却下にして、次回以降も自動で付け直されないようにする) */
export async function removeEntry(entryId: string): Promise<{ ok: boolean }> {
  const supabase = createAdminClient()
  const { data: e } = await supabase.from('sync_entry').select('candidate_id').eq('id', entryId).maybeSingle()
  await supabase.from('sync_entry').delete().eq('id', entryId)
  if (e?.candidate_id) await supabase.from('sync_candidate').update({ status: 'rejected', matched_track_id: null, applied_entry_id: null, match_reason: '確認画面で紐付けを外した' }).eq('id', e.candidate_id)
  revalidate()
  return { ok: true }
}

function revalidate() {
  safeRevalidatePath('/admin/data/sync/review')
  safeRevalidatePath('/media/sync')
}
