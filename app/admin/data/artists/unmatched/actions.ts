'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchArtist, fetchArtistWithAlbums, type ItunesArtistSearchResult } from '@/utils/itunes'
import { fetchAppleMusicArtistImage } from '@/utils/appleMusicImage'
import { dispatchAlbumSync } from '@/utils/albumSyncDispatch'

export type ItunesArtistSearchResultWithImage = ItunesArtistSearchResult & { imageUrl: string | null }

/** 未マッチアーティスト(apple_music_artist_id未設定のスタブ)の名前でApple Musicを
 * 検索する。festival-pilot/actions.tsのsearchAppleMusicArtistと同じ方針
 * (候補の顔写真も並行取得し、同名・類似名の別人を判別しやすくする)。 */
export async function searchAppleMusicArtistForStub(name: string): Promise<ItunesArtistSearchResultWithImage[]> {
  const candidates = await searchArtist(name)
  const withImages = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      imageUrl: await fetchAppleMusicArtistImage(String(c.artistId)).catch(() => null),
    }))
  )
  return withImages
}

export type LinkStubResult = { success: true; registeredName: string } | { success: false; message: string }

/**
 * 未マッチのスタブアーティスト(名前のみ・apple_music_artist_id未設定)を、
 * 管理者が確認した特定のApple Musicアーティストへ直接紐付ける。
 *
 * upsertArtistFromItunes(app/admin/import/actions.ts)の名前一致による
 * 自動スタブ再利用は、フェス表記とiTunes側の正式名が食い違う場合
 * (今回まさにこのケース: 「マーシー」の正式表記がiTunes上では別の綴りかもしれない)
 * 発動しないため、ここでは管理者が既に選んだstubArtistIdへ無条件に
 * 紐付ける専用の処理にする(名前一致の推測は行わない)。
 */
export async function linkStubArtistToItunes(stubArtistId: string, appleMusicArtistId: number): Promise<LinkStubResult> {
  const supabase = createAdminClient()

  const { data: stub } = await supabase
    .from('artist')
    .select('id, official_site_url, apple_music_artist_id')
    .eq('id', stubArtistId)
    .maybeSingle()
  if (!stub) {
    return { success: false, message: '対象のアーティストが見つかりません。' }
  }
  if (stub.apple_music_artist_id) {
    return { success: false, message: 'このアーティストは既にApple Musicと紐付け済みです。' }
  }

  const { artist: itunesArtist, albums: itunesAlbums } = await fetchArtistWithAlbums(String(appleMusicArtistId))
  if (!itunesArtist) {
    return { success: false, message: '指定のアーティストがApple Musicに見つかりませんでした。' }
  }

  // 同じApple Music IDが既に別のアーティスト行に紐付いていないか確認
  // (誤って同じ人物を2重登録する事故を防ぐ)
  const { data: existingLinked } = await supabase
    .from('artist')
    .select('id, name')
    .eq('apple_music_artist_id', String(appleMusicArtistId))
    .maybeSingle()
  if (existingLinked) {
    return { success: false, message: `このApple Musicアーティストは既に「${existingLinked.name}」として登録済みです。` }
  }

  const { error } = await supabase
    .from('artist')
    .update({
      name: itunesArtist.artistName,
      apple_music_artist_id: String(itunesArtist.artistId),
      official_site_url: stub.official_site_url ?? (itunesArtist.artistLinkUrl ?? null),
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', stubArtistId)
  if (error) {
    return { success: false, message: `紐付けに失敗しました: ${error.message}` }
  }

  const { data: artistRow } = await supabase.from('artist').select('image_url').eq('id', stubArtistId).single()
  if (!artistRow?.image_url) {
    const imageUrl = await fetchAppleMusicArtistImage(String(itunesArtist.artistId))
    if (imageUrl) {
      await supabase.from('artist').update({ image_url: imageUrl }).eq('id', stubArtistId)
    }
  }

  after(() => dispatchAlbumSync(stubArtistId, itunesArtist.artistName, String(itunesArtist.artistId), itunesAlbums))

  revalidatePath('/admin/data/artists/unmatched')
  revalidatePath(`/artists/${stubArtistId}`)

  return { success: true, registeredName: itunesArtist.artistName }
}
