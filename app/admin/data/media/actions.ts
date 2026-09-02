'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { PREFECTURE_COORDS } from '@/utils/prefectures'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/media?${result}=${encodeURIComponent(message)}`)
}

export async function createMedia(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const mediaType = String(formData.get('media_type') ?? '').trim()
  const area = String(formData.get('area') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const validPrefecture = PREFECTURE_COORDS.some((p) => p.name === prefecture) ? prefecture : null

  if (!name) {
    redirectWith('error', 'メディア名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('media').insert({
    name,
    media_type: mediaType || null,
    area: area || null,
    prefecture: validPrefecture,
  })

  if (error) {
    redirectWith('error', `メディアの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  redirectWith('success', `メディア「${name}」を登録しました。`)
}

export async function updateMedia(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const mediaType = String(formData.get('media_type') ?? '').trim()
  const area = String(formData.get('area') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const logoUrl = String(formData.get('logo_url') ?? '').trim()
  const validPrefecture = PREFECTURE_COORDS.some((p) => p.name === prefecture) ? prefecture : null

  if (!id || !name) {
    redirectWith('error', 'メディア名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('media')
    .update({
      name,
      media_type: mediaType || null,
      area: area || null,
      prefecture: validPrefecture,
      logo_url: logoUrl || null,
    })
    .eq('id', id)

  if (error) {
    redirectWith('error', `メディアの更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  revalidatePath('/media/on-air')
  redirectWith('success', `メディア「${name}」を更新しました。`)
}

/** 重複登録された局の削除用。media_programがひとつでも紐づいている場合は
 * ON DELETE CASCADEでオンエア実績ごと消えてしまうため、空(番組が1件も
 * 無い)の局に限って削除を許可する。実績がある局を統合したい場合は、
 * 先にmedia_programを目的の局へ付け替えてから削除すること。 */
export async function deleteMedia(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()

  const { data: media } = await supabase.from('media').select('name').eq('id', id).maybeSingle()
  const { count: programCount } = await supabase
    .from('media_program')
    .select('id', { count: 'exact', head: true })
    .eq('media_id', id)

  if ((programCount ?? 0) > 0) {
    redirectWith(
      'error',
      `「${media?.name ?? id}」には番組・オンエア実績が${programCount}件紐づいているため削除できません。統合する場合は先に番組を別の局へ付け替えてください。`
    )
  }

  const { error } = await supabase.from('media').delete().eq('id', id)
  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  redirectWith('success', `メディア「${media?.name ?? id}」を削除しました。`)
}

export async function searchMedia(query: string): Promise<{ id: string; label: string }[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const supabase = createAdminClient()
  const { data } = await supabase.from('media').select('id, name').ilike('name', `%${trimmed}%`).limit(20)
  return (data ?? []).map((m) => ({ id: m.id, label: m.name }))
}

/** 表記違いで別行になってしまった局(例: 「エフエム・ノースウエーブ」と
 * 「エフエム・ノースウェーブ」)を1件へ統合する。mergeArtist(app/admin/data/actions.ts)
 * と同じ方針: 統合先が未設定のプロフィール項目だけ統合元で埋め、外部キーは
 * 全て統合先へ付け替えてから統合元を削除する(取り消せない)。
 *
 * media_id を外部キーに持つテーブルは3つ:
 * - media_program(ON DELETE CASCADE) — 番組名が統合先に同名で既にある場合は
 *   radio_rotationだけ統合先の番組へ付け替えて統合元の番組行を削除し(重複防止)、
 *   同名が無ければ番組行ごと統合先へ付け替える。reassignOrDropDuplicatesと
 *   同じ考え方だが、削除ではなく「子(radio_rotation)を先に付け替えてから
 *   親(media_program)を消す」必要がある点だけ異なる。
 * - news(ON DELETE SET NULL) — 単純に付け替え。
 * - ranking(ON DELETE SET NULL) — 単純に付け替え。
 *
 * radio_airplay_pick.station_name は外部キーではなく自由入力の文字列なので、
 * 統合元の局名の行を統合先の局名へ一括で書き換える。 */
export async function mergeMedia(formData: FormData) {
  const sourceId = String(formData.get('source_media_id') ?? '')
  const targetId = String(formData.get('target_media_id') ?? '')

  if (!sourceId || !targetId || sourceId === targetId) {
    redirectWith('error', '統合元・統合先を正しく選んでください。')
  }

  const supabase = createAdminClient()

  const { data: source } = await supabase.from('media').select('*').eq('id', sourceId).maybeSingle()
  const { data: target } = await supabase.from('media').select('*').eq('id', targetId).maybeSingle()
  if (!source || !target) {
    redirectWith('error', '統合元・統合先のメディアが見つかりませんでした。')
  }

  // プロフィール項目は統合先が未設定のものだけ埋める(既存値は上書きしない)
  const fillFields: Record<string, unknown> = {}
  for (const col of ['media_type', 'area', 'prefecture', 'logo_url', 'power_play_url'] as const) {
    if (target![col] == null && source![col] != null) {
      fillFields[col] = source![col]
    }
  }
  if (Object.keys(fillFields).length > 0) {
    const { error } = await supabase.from('media').update(fillFields).eq('id', targetId)
    if (error) {
      redirectWith('error', `プロフィール項目の統合に失敗しました: ${error.message}`)
    }
  }

  // media_program: 統合先に同名の番組が既にあればradio_rotationだけ付け替えて
  // 統合元の番組行を削除(重複防止)、無ければ番組行ごと付け替える
  const { data: sourcePrograms } = await supabase
    .from('media_program')
    .select('id, program_name')
    .eq('media_id', sourceId)
  const { data: targetPrograms } = await supabase.from('media_program').select('id, program_name').eq('media_id', targetId)
  const targetProgramByName = new Map((targetPrograms ?? []).map((p) => [p.program_name, p.id]))

  for (const program of sourcePrograms ?? []) {
    const existingTargetProgramId = targetProgramByName.get(program.program_name)
    if (existingTargetProgramId) {
      const { error: rotationError } = await supabase
        .from('radio_rotation')
        .update({ media_program_id: existingTargetProgramId })
        .eq('media_program_id', program.id)
      if (rotationError) {
        redirectWith('error', `オンエア実績の付け替えに失敗しました: ${rotationError.message}`)
      }
      await supabase.from('media_program').delete().eq('id', program.id)
    } else {
      const { error: programError } = await supabase
        .from('media_program')
        .update({ media_id: targetId })
        .eq('id', program.id)
      if (programError) {
        redirectWith('error', `番組の付け替えに失敗しました: ${programError.message}`)
      }
      targetProgramByName.set(program.program_name, program.id)
    }
  }

  // news・rankingは単純に付け替え(重複の心配がない参照元カラムのため)
  for (const table of ['news', 'ranking'] as const) {
    const { error } = await supabase.from(table).update({ media_id: targetId }).eq('media_id', sourceId)
    if (error) {
      redirectWith('error', `${table}の付け替えに失敗しました: ${error.message}`)
    }
  }

  // radio_airplay_pick.station_nameは外部キーではなく自由入力の文字列なので、
  // 統合元の局名で記録されている行を統合先の局名へ書き換える
  const { error: pickError } = await supabase
    .from('radio_airplay_pick')
    .update({ station_name: target!.name })
    .eq('station_name', source!.name)
  if (pickError) {
    redirectWith('error', `HRPP候補データの付け替えに失敗しました: ${pickError.message}`)
  }

  const { error: deleteError } = await supabase.from('media').delete().eq('id', sourceId)
  if (deleteError) {
    redirectWith('error', `統合元の削除に失敗しました(データは既に統合先へ付け替え済みです): ${deleteError.message}`)
  }

  revalidatePath('/admin/data/media')
  revalidatePath('/admin/data/media/radio-airplay-pick')
  revalidatePath('/media/on-air')
  redirectWith('success', `「${source!.name}」を「${target!.name}」へ統合しました。`)
}

export async function createMediaProgram(formData: FormData) {
  const mediaId = String(formData.get('media_id') ?? '')
  const programName = String(formData.get('program_name') ?? '').trim()
  const periodType = String(formData.get('period_type') ?? '')

  if (!mediaId || !programName || !periodType) {
    redirectWith('error', 'メディア・番組名・集計周期を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('media_program').insert({
    media_id: mediaId,
    program_name: programName,
    period_type: periodType,
  })

  if (error) {
    redirectWith('error', `番組の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  redirectWith('success', `番組「${programName}」を登録しました。`)
}

export async function createRadioRotation(formData: FormData) {
  const mediaProgramId = String(formData.get('media_program_id') ?? '')
  const periodType = String(formData.get('period_type') ?? '')
  const periodStartDate = String(formData.get('period_start_date') ?? '')
  const musicType = String(formData.get('music_type') ?? '')
  // 同じ曲がシングル/EP版とアルバム収録版など複数のtrack行に分かれている
  // ことがあるため、track_idは複数選択できる(1回の送信で両方に登録できる)
  const trackIds = formData.getAll('track_id').map(String).filter(Boolean)
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!mediaProgramId || !periodType || !periodStartDate || !musicType) {
    redirectWith('error', '番組・集計周期・対象期間・邦楽/洋楽を入力してください。')
  }

  const targetCount = [trackIds.length > 0, Boolean(albumId), Boolean(artistId)].filter(Boolean).length
  if (targetCount !== 1) {
    redirectWith('error', 'プッシュ対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。')
  }

  type RadioRotationRow = {
    media_program_id: string
    period_type: string
    period_start_date: string
    music_type: string
    track_id: string | null
    album_id: string | null
    artist_id: string | null
    note: string | null
  }

  const rows: RadioRotationRow[] =
    trackIds.length > 0
      ? trackIds.map((trackId) => ({
          media_program_id: mediaProgramId,
          period_type: periodType,
          period_start_date: periodStartDate,
          music_type: musicType,
          track_id: trackId,
          album_id: null,
          artist_id: null,
          note: note || null,
        }))
      : [
          {
            media_program_id: mediaProgramId,
            period_type: periodType,
            period_start_date: periodStartDate,
            music_type: musicType,
            track_id: null,
            album_id: albumId || null,
            artist_id: artistId || null,
            note: note || null,
          },
        ]

  const supabase = createAdminClient()
  const { error } = await supabase.from('radio_rotation').insert(rows)

  if (error) {
    redirectWith('error', `オンエアデータの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  revalidatePath('/media/on-air')
  for (const trackId of trackIds) {
    revalidatePath(`/tracks/${trackId}`)
  }
  redirectWith('success', `オンエアデータを登録しました(${rows.length}件)。`)
}

export async function updateRadioRotation(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const mediaProgramId = String(formData.get('media_program_id') ?? '')
  const periodType = String(formData.get('period_type') ?? '')
  const periodStartDate = String(formData.get('period_start_date') ?? '')
  const musicType = String(formData.get('music_type') ?? '')
  const trackId = String(formData.get('track_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  const previousTrackId = String(formData.get('previous_track_id') ?? '')

  if (!id || !mediaProgramId || !periodType || !periodStartDate || !musicType) {
    redirectWith('error', '番組・集計周期・対象期間・邦楽/洋楽を入力してください。')
  }

  const targetCount = [Boolean(trackId), Boolean(albumId), Boolean(artistId)].filter(Boolean).length
  if (targetCount !== 1) {
    redirectWith('error', 'プッシュ対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('radio_rotation')
    .update({
      media_program_id: mediaProgramId,
      period_type: periodType,
      period_start_date: periodStartDate,
      music_type: musicType,
      track_id: trackId || null,
      album_id: albumId || null,
      artist_id: artistId || null,
      note: note || null,
    })
    .eq('id', id)

  if (error) {
    redirectWith('error', `更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  revalidatePath('/media/on-air')
  if (trackId) revalidatePath(`/tracks/${trackId}`)
  if (previousTrackId && previousTrackId !== trackId) revalidatePath(`/tracks/${previousTrackId}`)
  redirectWith('success', 'オンエアデータを更新しました。')
}

export async function deleteRadioRotation(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const trackId = String(formData.get('track_id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('radio_rotation').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  revalidatePath('/media/on-air')
  if (trackId) revalidatePath(`/tracks/${trackId}`)
  redirectWith('success', 'オンエアデータを削除しました。')
}
