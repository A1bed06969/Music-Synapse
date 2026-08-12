'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { CREDIT_ROLE_LABEL } from '@/utils/format'

function redirectWith(albumId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/albums/${albumId}/credits?${result}=${encodeURIComponent(message)}`)
}

export async function importAlbumCredits(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const creditCount = Number(formData.get('credit_count') ?? '0')

  if (!artistId || !albumId || !creditCount) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()

  const { data: album } = await supabase.from('album').select('artist_id').eq('id', albumId).maybeSingle()

  if (!album || album.artist_id !== artistId) {
    redirectWith(albumId, 'error', 'アルバムとアーティストの組み合わせが不正です。')
  }

  let relationsWritten = 0
  let creditsWritten = 0
  let instrumentsWritten = 0
  let failureCount = 0

  for (let i = 0; i < creditCount; i++) {
    if (formData.get(`credit_${i}_include`) !== '1') continue

    const personName = String(formData.get(`credit_${i}_person_name`) ?? '')
    const personMbid = String(formData.get(`credit_${i}_person_mbid`) ?? '')
    const role = String(formData.get(`credit_${i}_role`) ?? '')
    const sourceUrl = String(formData.get(`credit_${i}_source_url`) ?? '')
    const trackId = String(formData.get(`credit_${i}_track_id`) ?? '') || null
    const instrumentName = String(formData.get(`credit_${i}_instrument_name`) ?? '') || null
    if (!personName || !personMbid || !role) continue
    if (!(role in CREDIT_ROLE_LABEL)) continue

    // ミュージシャンロールは、カタログとの人物一致状況に関わらず
    // 「このトラックでこの楽器が使われた」というトラック単位の記録を別途残す
    if (role === 'musician' && trackId && instrumentName) {
      const { data: existingInstrument } = await supabase
        .from('instrument')
        .select('id')
        .ilike('name', instrumentName)
        .maybeSingle()

      let instrumentId = existingInstrument?.id as string | undefined
      if (!instrumentId) {
        const { data: createdInstrument, error: createError } = await supabase
          .from('instrument')
          .insert({ name: instrumentName })
          .select('id')
          .single()
        if (createError) {
          console.error(`楽器「${instrumentName}」の作成に失敗しました:`, createError)
          failureCount += 1
        } else {
          instrumentId = createdInstrument.id
        }
      }

      if (instrumentId) {
        const { data: tiData, error: tiError } = await supabase
          .from('track_instrument')
          .upsert(
            { track_id: trackId, instrument_id: instrumentId },
            { onConflict: 'track_id,instrument_id', ignoreDuplicates: true }
          )
          .select()
        if (tiError) {
          console.error(`楽器「${instrumentName}」の紐付けに失敗しました:`, tiError)
          failureCount += 1
        } else if (tiData && tiData.length > 0) {
          instrumentsWritten += 1
        }
      }
    }

    const { data: matchedArtist } = await supabase
      .from('artist')
      .select('id')
      .eq('musicbrainz_id', personMbid)
      .maybeSingle()

    if (matchedArtist?.id === artistId) {
      // 自分自身がクレジットされているケース(セルフプロデュース等)は記録不要
      continue
    }

    if (matchedArtist) {
      const [artist_id_a, artist_id_b] = [matchedArtist.id, artistId].sort()
      const { data: relationData, error: relationError } = await supabase
        .from('artist_relation')
        .upsert(
          {
            artist_id_a,
            artist_id_b,
            relation_type: 'production',
            relation_style: 'solid',
            description: null,
          },
          { onConflict: 'artist_id_a,artist_id_b,relation_type', ignoreDuplicates: true }
        )
        .select()
      if (relationError) {
        console.error(`関係の保存に失敗しました(${personName}):`, relationError)
        failureCount += 1
        continue
      }
      if (relationData && relationData.length > 0) {
        relationsWritten += 1
      }
      continue
    }

    const { data: existingPerson } = await supabase
      .from('credit_person')
      .select('id')
      .eq('musicbrainz_id', personMbid)
      .maybeSingle()

    let creditPersonId = existingPerson?.id as string | undefined
    if (!creditPersonId) {
      const { data: createdPerson, error: createError } = await supabase
        .from('credit_person')
        .insert({ name: personName, musicbrainz_id: personMbid })
        .select('id')
        .single()
      if (createError) {
        console.error(`人物「${personName}」の作成に失敗しました:`, createError)
        failureCount += 1
        continue
      }
      creditPersonId = createdPerson.id
    }

    const { data: creditData, error: creditError } = await supabase
      .from('artist_credit')
      .upsert(
        {
          artist_id: artistId,
          album_id: albumId,
          track_id: trackId,
          credit_person_id: creditPersonId,
          role,
          source: 'musicbrainz',
          source_url: sourceUrl || null,
        },
        { onConflict: 'artist_id,album_id,track_id,credit_person_id,role,source', ignoreDuplicates: true }
      )
      .select()
    if (creditError) {
      console.error(`クレジット「${personName}」の保存に失敗しました:`, creditError)
      failureCount += 1
      continue
    }
    if (creditData && creditData.length > 0) {
      creditsWritten += 1
    }
  }

  revalidatePath(`/artists/${artistId}`)
  revalidatePath(`/artists/${artistId}/relations`)
  revalidatePath('/relations')

  let message = `アーティスト関係${relationsWritten}件・クレジット${creditsWritten}件・使用楽器${instrumentsWritten}件を取り込みました`
  if (failureCount > 0) {
    message += `、失敗${failureCount}件`
  }

  const severity =
    relationsWritten === 0 && creditsWritten === 0 && instrumentsWritten === 0 && failureCount > 0 ? 'error' : 'success'

  redirectWith(albumId, severity, message)
}
