'use server'

import { createAdminClient } from '@/utils/Supabase/admin'
import { safeRevalidatePath } from '@/utils/safeRevalidate'
import { resolveMbidByExactName, findArtistMbidByAppleMusicId } from '@/utils/musicbrainz'
import { resolveFeaturedArtistCandidate } from '@/utils/itunes'
import { fetchAppleMusicArtistImage } from '@/utils/appleMusicImage'
import { resolveFeaturedArtistImageFromSpotify } from '@/utils/spotify'
import { dispatchMemberEnrichment } from '@/utils/memberEnrichmentDispatch'

type ActionResult = { success: true } | { success: false; message: string }

/** feat.抽出で作られたartist 1件について、以下の順で解決・肉付けを試みる
 * (confirmFeaturedArtist・autoResolveFeaturedArtistの両方から共有):
 * ①Apple Music(名前の完全一致検索。"Boyish"のように同名候補が複数残る場合は、
 *   元曲のアルバム/シングルが各候補自身のカタログにも掲載されているか
 *   (fetchArtistWithAlbums)で裏取りして絞り込む。2026-09-22、ユーザー報告の
 *   同名多数ケースを受けて追加)→ 一致すればapple_music_artist_id設定。
 * ②画像(2026-09-24、ユーザー要望「featアーティストも画像だけは拾いたい」)。
 *   ①で本人確認できた場合はそのIDから、できなかった場合も
 *   resolveFeaturedArtistCandidateが返す「裏取りできなかった先頭候補」から
 *   ベストエフォートで取得する。誤った人物の写真が付くリスクはあるが、
 *   apple_music_artist_id(本人特定情報)には影響しない別カラムへの反映であり、
 *   名前登録のみで画像が全く無い状態より実用上ましと判断。
 * ③MusicBrainz(①でApple Music IDが取れていればそれで直接引く方が名前検索より
 *   確実なので優先し、取れなければ名前の完全一致検索にフォールバック)→ SNS・
 *   ジャンル・出身地の取込をディスパッチ
 *
 * feat.アーティストはApple Music ID・MusicBrainzプロフィールまでの「登録」に
 * 留め、カタログ同期(dispatchAlbumSync)は世代を問わず一切行わない
 * (2026-09-24、ユーザー方針転換。以前は1世代目のみバルク登録していたが、
 * その運用でカタログの約半分(アルバム6.5万件・トラック23万件)がfeat.発見経由の
 * 副産物になってしまい、遡って全件取り消した。キュレーションコンテンツの
 * アーティストを別途バルク登録する新しい運用に置き換える)。
 * 戻り値のresolvedは①が成功したかどうか(=カタログ照合で裏取りできたか)。
 * これを「人の確認無しに自動確定してよい」の判定材料としてautoResolve側が使う。
 * 画像のベストエフォート取得はresolvedの判定に一切影響しない。 */
async function resolveAndEnrichFeaturedArtist(
  supabase: ReturnType<typeof createAdminClient>,
  review: { artist_id: string; extracted_name: string; track_id: string }
): Promise<{ resolved: boolean }> {
  const { data: artist } = await supabase
    .from('artist')
    .select('musicbrainz_id, apple_music_artist_id, image_url')
    .eq('id', review.artist_id)
    .maybeSingle()
  if (!artist) return { resolved: false }

  let appleMusicArtistId = artist.apple_music_artist_id
  let imageCandidateId: string | null = null

  if (!appleMusicArtistId) {
    try {
      const { data: track } = await supabase.from('track').select('album_id').eq('id', review.track_id).maybeSingle()
      const { data: album } = track
        ? await supabase.from('album').select('apple_music_album_id').eq('id', track.album_id).maybeSingle()
        : { data: null }

      const { confirmedId, bestGuessId } = await resolveFeaturedArtistCandidate(
        review.extracted_name,
        album?.apple_music_album_id ?? null
      )
      imageCandidateId = bestGuessId
      if (confirmedId) {
        appleMusicArtistId = confirmedId
        await supabase.from('artist').update({ apple_music_artist_id: confirmedId }).eq('id', review.artist_id)
      }
    } catch (err) {
      console.error(`Apple Music解決に失敗しました(${review.extracted_name}):`, (err as Error).message)
    }
  }

  if (!artist.image_url) {
    let imageUrl: string | null = null
    const imageSourceId = appleMusicArtistId ?? imageCandidateId
    if (imageSourceId) {
      try {
        imageUrl = await fetchAppleMusicArtistImage(imageSourceId)
      } catch (err) {
        console.error(`Apple Musicでの画像取得に失敗しました(${review.extracted_name}):`, (err as Error).message)
      }
    }
    // Apple Music側で取れなかった場合(レート制限含む)はSpotifyでフォールバックする。
    // SpotifyはAPIレスポンスに画像URLを直接含むため、og:imageスクレイピングより確実。
    if (!imageUrl) {
      try {
        imageUrl = await resolveFeaturedArtistImageFromSpotify(review.extracted_name)
      } catch (err) {
        console.error(`Spotifyでの画像取得に失敗しました(${review.extracted_name}):`, (err as Error).message)
      }
    }
    if (imageUrl) {
      await supabase.from('artist').update({ image_url: imageUrl }).eq('id', review.artist_id)
    }
  }

  if (!artist.musicbrainz_id) {
    try {
      const mbid = appleMusicArtistId
        ? await findArtistMbidByAppleMusicId(appleMusicArtistId).then((r) => r?.mbid ?? null)
        : await resolveMbidByExactName(review.extracted_name)
      if (mbid) {
        await dispatchMemberEnrichment(review.artist_id, review.extracted_name, mbid)
      }
    } catch (err) {
      console.error(`MBID解決に失敗しました(${review.extracted_name}):`, (err as Error).message)
    }
  }

  return { resolved: Boolean(appleMusicArtistId) }
}

/** feat.抽出で自動作成されたアーティストを、人が「問題なし」として確定する。
 * artist行・track_artistリンクはそのまま残し、レビュー待ち一覧から外すだけ。
 * 人が確認済みなので、Apple Music解決が失敗しても確定自体は取り消さない
 * (肉付けはベストエフォート)。 */
export async function confirmFeaturedArtist(reviewId: string): Promise<ActionResult> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('featured_artist_review')
    .update({ confirmed: true, reviewed_at: new Date().toISOString() })
    .eq('id', reviewId)
  if (error) return { success: false, message: error.message }

  const { data: review } = await supabase
    .from('featured_artist_review')
    .select('artist_id, extracted_name, track_id')
    .eq('id', reviewId)
    .maybeSingle()
  if (review?.artist_id) {
    await resolveAndEnrichFeaturedArtist(supabase, review)
  }

  safeRevalidatePath('/admin/data/artists/featured-review')
  return { success: true }
}

/** 人のレビューを介さず、Apple Musicのカタログ照合で裏取りできた場合のみ
 * 自動確定する。半自動化(2026-09-22、ユーザー要望): 曖昧な同名候補が残る
 * ケースでも、元曲が実際にその候補自身のカタログに載っているという実データでの
 * 裏取りができた時点で十分信頼できると判断し、人の確認を待たずに確定する。
 * 解決できなかった場合は何もしない(confirmed=falseのまま、従来通り人のレビュー待ち)。
 * 新規スタブ作成時(linkOrStubFeaturedArtists)と、既存の未レビュー分の一括
 * バックフィルの両方から呼ぶ想定。 */
export async function autoResolveFeaturedArtist(reviewId: string): Promise<{ autoConfirmed: boolean }> {
  const supabase = createAdminClient()
  const { data: review } = await supabase
    .from('featured_artist_review')
    .select('artist_id, extracted_name, track_id, confirmed, rejected')
    .eq('id', reviewId)
    .maybeSingle()
  if (!review?.artist_id || review.confirmed || review.rejected) return { autoConfirmed: false }

  const { resolved } = await resolveAndEnrichFeaturedArtist(supabase, review)
  if (!resolved) return { autoConfirmed: false }

  await supabase
    .from('featured_artist_review')
    .update({ confirmed: true, reviewed_at: new Date().toISOString() })
    .eq('id', reviewId)
  safeRevalidatePath('/admin/data/artists/featured-review')
  return { autoConfirmed: true }
}

/** 誤抽出(カンマ/アンパサンド区切りで単一アーティスト名の一部を分割してしまった等)
 * と判断した場合の取消。自動作成したartist行とtrack_artistリンクを削除し、
 * このレビュー行はrejected=trueのまま記録に残す(何が誤抽出されたかの監査用)。 */
export async function rejectFeaturedArtist(reviewId: string): Promise<ActionResult> {
  const supabase = createAdminClient()

  const { data: review, error: fetchError } = await supabase
    .from('featured_artist_review')
    .select('id, artist_id, track_id')
    .eq('id', reviewId)
    .maybeSingle()
  if (fetchError) return { success: false, message: fetchError.message }
  if (!review) return { success: false, message: 'レビュー対象が見つかりません。' }

  const { error: linkDeleteError } = await supabase
    .from('track_artist')
    .delete()
    .eq('track_id', review.track_id)
    .eq('artist_id', review.artist_id)
  if (linkDeleteError) return { success: false, message: `track_artist削除に失敗しました: ${linkDeleteError.message}` }

  // 他の場所(別トラックのfeat.や手動編集)で既にこのartistが使われていないか確認してから削除する
  const [{ count: trackArtistCount }, { count: albumArtistCount }, { count: ownTrackCount }] = await Promise.all([
    supabase.from('track_artist').select('id', { count: 'exact', head: true }).eq('artist_id', review.artist_id),
    supabase.from('album_artist').select('id', { count: 'exact', head: true }).eq('artist_id', review.artist_id),
    supabase.from('track').select('id', { count: 'exact', head: true }).eq('artist_id', review.artist_id),
  ])
  if (!trackArtistCount && !albumArtistCount && !ownTrackCount) {
    const { error: artistDeleteError } = await supabase.from('artist').delete().eq('id', review.artist_id)
    if (artistDeleteError) {
      console.error(`誤抽出アーティストの削除に失敗しました(${review.artist_id}):`, artistDeleteError.message)
    }
  }

  const { error: reviewUpdateError } = await supabase
    .from('featured_artist_review')
    .update({ rejected: true, reviewed_at: new Date().toISOString() })
    .eq('id', reviewId)
  if (reviewUpdateError) return { success: false, message: reviewUpdateError.message }

  safeRevalidatePath('/admin/data/artists/featured-review')
  return { success: true }
}
