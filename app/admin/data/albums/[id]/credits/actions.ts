'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

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

  let relationsWritten = 0
  let creditsWritten = 0

  for (let i = 0; i < creditCount; i++) {
    if (formData.get(`credit_${i}_include`) !== '1') continue

    const personName = String(formData.get(`credit_${i}_person_name`) ?? '')
    const personMbid = String(formData.get(`credit_${i}_person_mbid`) ?? '')
    const role = String(formData.get(`credit_${i}_role`) ?? '')
    const sourceUrl = String(formData.get(`credit_${i}_source_url`) ?? '')
    if (!personName || !personMbid || !role) continue

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
      const { error: relationError } = await supabase.from('artist_relation').upsert(
        {
          artist_id_a: matchedArtist.id,
          artist_id_b: artistId,
          relation_type: 'production',
          relation_style: 'solid',
          description: null,
        },
        { onConflict: 'artist_id_a,artist_id_b,relation_type', ignoreDuplicates: true }
      )
      if (relationError) {
        console.error(`関係の保存に失敗しました(${personName}):`, relationError)
        continue
      }
      relationsWritten += 1
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
        continue
      }
      creditPersonId = createdPerson.id
    }

    const { error: creditError } = await supabase.from('artist_credit').upsert(
      {
        artist_id: artistId,
        album_id: albumId,
        credit_person_id: creditPersonId,
        role,
        source: 'musicbrainz',
        source_url: sourceUrl || null,
      },
      { onConflict: 'artist_id,album_id,credit_person_id,role,source', ignoreDuplicates: true }
    )
    if (creditError) {
      console.error(`クレジット「${personName}」の保存に失敗しました:`, creditError)
      continue
    }
    creditsWritten += 1
  }

  revalidatePath(`/artists/${artistId}`)
  revalidatePath(`/artists/${artistId}/relations`)
  revalidatePath('/relations')

  redirectWith(albumId, 'success', `アーティスト関係${relationsWritten}件・クレジット${creditsWritten}件を取り込みました`)
}
