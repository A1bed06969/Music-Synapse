'use server'

import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistWithAlbums } from '@/utils/itunes'
import { syncAlbumsAndTracksForArtist } from '@/app/admin/import/actions'
import { autoImportArtistProfileFromMusicBrainz } from '@/utils/artistProfileImport'

function redirectWith(artistId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/artists/${artistId}/itunes-merge?${result}=${encodeURIComponent(message)}`)
}

/** 既存のartist行(通常はMusicBrainz経由のスタブ)にiTunesのアーティストを紐付け、
 * ディスコグラフィー・画像を取り込む。app/admin/import/actionsのupsertArtistFromItunes
 * と違い、新規行を作らず必ず既存のartistIdをUPDATEする(重複行を防ぐため) */
export async function mergeItunesArtist(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const appleArtistId = String(formData.get('apple_artist_id') ?? '')

  if (!artistId || !appleArtistId) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()

  // apple_music_artist_idにDB側のunique制約が無いため、他の行が既にこのIDを
  // 使っていないかをアプリ側で確認する(二重紐付け防止)
  const { data: conflictingArtist } = await supabase
    .from('artist')
    .select('id, name')
    .eq('apple_music_artist_id', appleArtistId)
    .neq('id', artistId)
    .maybeSingle()

  if (conflictingArtist) {
    redirectWith(artistId, 'error', `このApple Music IDは既に別のアーティスト「${conflictingArtist.name}」に紐付けられています。`)
  }

  const { artist: itunesArtist, albums: itunesAlbums } = await fetchArtistWithAlbums(appleArtistId)
  if (!itunesArtist) {
    redirectWith(artistId, 'error', '指定のIDに該当するアーティストがiTunesで見つかりませんでした。')
  }

  const { data: currentArtist } = await supabase
    .from('artist')
    .select('name, official_site_url')
    .eq('id', artistId)
    .single()

  const { error: updateError } = await supabase
    .from('artist')
    .update({
      apple_music_artist_id: appleArtistId,
      // 手動編集・MusicBrainz取込で設定済みの値は上書きしない(空のときだけ埋める)
      official_site_url: currentArtist?.official_site_url ?? (itunesArtist.artistLinkUrl ?? null),
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', artistId)

  if (updateError) {
    redirectWith(artistId, 'error', `統合に失敗しました: ${updateError.message}`)
  }

  const artistName = currentArtist?.name ?? itunesArtist.artistName

  // アルバム数が多いと取込に数十秒〜かかるため、本体の紐付けだけ先に完了させて
  // すぐ結果を返し、アルバム・トラックの取込はレスポンス後にバックグラウンド実行する
  // (app/admin/import/actions.tsのimportOneArtistと同じ対策)
  after(async () => {
    try {
      await syncAlbumsAndTracksForArtist(supabase, artistId, artistName, itunesAlbums, appleArtistId)
    } catch (err) {
      console.error(`アルバム・トラック取込に失敗しました(${artistName}):`, err)
    }

    try {
      await autoImportArtistProfileFromMusicBrainz(supabase, artistId)
    } catch (err) {
      console.error(`MusicBrainzプロフィール取込に失敗しました(${artistName}):`, err)
    }

    revalidatePath(`/artists/${artistId}`)
  })

  revalidatePath('/admin/data')
  redirectWith(
    artistId,
    'success',
    `「${itunesArtist.artistName}」に統合しました(アルバム${itunesAlbums.length}件は裏で取込中です)。`
  )
}
