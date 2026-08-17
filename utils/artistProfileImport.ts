import type { SupabaseClient } from '@supabase/supabase-js'
import { searchReleaseByTitle, fetchArtistDetails, type MusicBrainzArtistDetails } from '@/utils/musicbrainz'
import { normalizeAlbumTitle } from '@/utils/creditImport'
import { resolveArtistImageByName } from '@/utils/appleMusicImage'

export type ResolveArtistMbidResult =
  | { matched: true; mbid: string; matchedTitles: string[] }
  | { matched: false; reason: string }

/**
 * 「うちのDBに既にあるアルバムタイトル」を手がかりにMusicBrainz上のアーティストMBIDを
 * 自動照合する。アーティスト名では絞り込まない(searchReleaseByTitle参照: うちの
 * アーティスト名はiTunes JPカタログ由来のカタカナ表記のことが多く、MusicBrainz側の
 * 表記と一致しないため)。各タイトルでタイトル完全一致(正規化後)した結果の
 * artist-creditからMBIDを拾い、複数タイトルで同じMBIDに票が集まった場合のみ
 * 採用する(人間の確認を挟まないため、クレジット取込と同じ
 * 「完全一致のみ自動採用」の考え方を流用)。
 */
export async function resolveArtistMbid(knownAlbumTitles: string[]): Promise<ResolveArtistMbidResult> {
  if (knownAlbumTitles.length === 0) {
    return { matched: false, reason: 'アルバム情報が無く照合できない' }
  }

  // API負荷(1req/秒の内蔵レート制限)を抑えるため、最大5件のタイトルだけで判定する
  const candidateTitles = knownAlbumTitles.slice(0, 5)
  const votes = new Map<string, string[]>()

  for (const title of candidateTitles) {
    let results
    try {
      results = await searchReleaseByTitle(title)
    } catch {
      continue
    }
    const exact = results.find((r) => normalizeAlbumTitle(r.title) === normalizeAlbumTitle(title))
    if (exact?.artistMbid) {
      const titles = votes.get(exact.artistMbid) ?? []
      titles.push(title)
      votes.set(exact.artistMbid, titles)
    }
  }

  let bestMbid: string | null = null
  let bestCount = 0
  for (const [mbid, titles] of votes) {
    if (titles.length > bestCount) {
      bestMbid = mbid
      bestCount = titles.length
    }
  }

  // 確認できたタイトル数が少ない(=1件しか試せなかった)アーティストは1件一致でも許容するが、
  // 複数タイトルを試せた場合は同名異人の誤マッチ防止のため2件以上の一致を必須とする
  const requiredMatches = Math.min(2, candidateTitles.length)
  if (!bestMbid || bestCount < requiredMatches) {
    return {
      matched: false,
      reason: `MusicBrainzでタイトル完全一致するリリースの一致件数不足(最大一致数: ${bestCount}件、必要: ${requiredMatches}件)`,
    }
  }

  return { matched: true, mbid: bestMbid, matchedTitles: votes.get(bestMbid)! }
}

/**
 * 取得済みのMusicBrainzアーティスト詳細をDBへ反映する(プロフィール項目は空欄のみ
 * 埋め、既存の手入力値は上書きしない)。手動確認フロー
 * (app/admin/data/artists/[id]/musicbrainz/actions.ts)と自動取込の両方から使う共通処理。
 */
export async function writeArtistProfileFromMusicBrainzDetails(
  supabase: SupabaseClient,
  artistId: string,
  mbid: string,
  details: MusicBrainzArtistDetails
): Promise<{
  profileFieldCount: number
  linkCount: number
  genresLinked: number
  membershipsWritten: number
  membershipsUnresolved: string[]
}> {
  const { data: currentArtist } = await supabase
    .from('artist')
    .select('official_site_url, sns_x_url, sns_instagram_url, musicbrainz_id')
    .eq('id', artistId)
    .single()

  const fieldUpdate: Record<string, string> = {}
  if (!currentArtist?.musicbrainz_id) {
    fieldUpdate.musicbrainz_id = mbid
  }
  if (!currentArtist?.official_site_url && details.officialHomepage) {
    fieldUpdate.official_site_url = details.officialHomepage
  }
  if (!currentArtist?.sns_x_url && details.twitterUrl) {
    fieldUpdate.sns_x_url = details.twitterUrl
  }
  if (!currentArtist?.sns_instagram_url && details.instagramUrl) {
    fieldUpdate.sns_instagram_url = details.instagramUrl
  }
  if (Object.keys(fieldUpdate).length > 0) {
    const { error } = await supabase.from('artist').update(fieldUpdate).eq('id', artistId)
    if (error) {
      console.error(`アーティストプロフィールの更新に失敗しました(${artistId}):`, error.message)
    }
  }

  if (details.links.length > 0) {
    const { error } = await supabase
      .from('artist_external_link')
      .upsert(
        details.links.map((link) => ({ artist_id: artistId, link_type: link.type, url: link.url })),
        { onConflict: 'artist_id,link_type,url', ignoreDuplicates: true }
      )
    if (error) {
      console.error(`外部リンクの保存に失敗しました(${artistId}):`, error.message)
    }
  }

  let genresLinked = 0
  for (const genreName of details.genres) {
    // Case-insensitive lookup: MusicBrainzは小文字("j-pop")で返すが、既存ジャンルは
    // タイトルケース("J-POP")のことがあるため、完全一致だと重複作成してしまう
    const { data: existingGenre } = await supabase.from('genre').select('id').ilike('name', genreName).maybeSingle()
    let genreId = existingGenre?.id as string | undefined
    if (!genreId) {
      const { data: createdGenre, error: createError } = await supabase
        .from('genre')
        .insert({ name: genreName })
        .select('id')
        .single()
      if (createError) {
        console.error(`ジャンル「${genreName}」の作成に失敗しました:`, createError)
        continue
      }
      genreId = createdGenre.id
    }
    const { error: linkError } = await supabase.from('artist_genre').upsert({ artist_id: artistId, genre_id: genreId })
    if (linkError) {
      console.error(`ジャンル「${genreName}」の紐付けに失敗しました:`, linkError)
    } else {
      genresLinked += 1
    }
  }

  // バンドメンバーシップ(relation_type='membership')。credit_person(artist行を
  // 持たない人物)にはメンバーを登録しない方針のため、バンドメンバーは正式にartist行として
  // 作成する。MusicBrainzの"member of band"はキュレーションされた確定情報(MBIDが
  // 一意に特定できる)なので、アルバムタイトル一致によるMBID自動照合とは違い、
  // 人間の確認を挟まず自動作成してよい確度がある。
  // artist_id_a=バンド、artist_id_b=メンバー、というのはこの関数だけが書き込む
  // membership行の内部的な向きの取り決め(artist_relationテーブル自体には
  // a/bの向きを示す列が無く、他のrelation_type(production等)は一貫していないため)
  let membershipsWritten = 0
  const membershipsUnresolved: string[] = []
  for (const membership of details.memberships) {
    const { data: existingOtherArtist } = await supabase
      .from('artist')
      .select('id')
      .eq('musicbrainz_id', membership.mbid)
      .maybeSingle()

    let otherArtistId = existingOtherArtist?.id as string | undefined
    if (!otherArtistId) {
      // musicbrainz_idでは見つからなかった場合でも、完全一致する名前のartistが
      // 既に存在するなら(iTunes経由の本人名義登録等)、新規作成せずそちらに
      // musicbrainz_idを補完して使う。同名重複artist行の発生を防ぐため
      // (実例: 幾田りら/AAAMYYYがメンバー自動作成と本人名義登録の両方で
      // それぞれ別行になっていた)。musicbrainz_idが既に別の値で設定されている
      // 同名artistは別人の可能性があるため対象外とする
      const { data: sameNameCandidates } = await supabase
        .from('artist')
        .select('id')
        .eq('name', membership.name)
        .is('musicbrainz_id', null)
        .limit(1)

      if (sameNameCandidates && sameNameCandidates.length > 0) {
        const sameNameArtistId = sameNameCandidates[0].id
        const { error: linkError } = await supabase
          .from('artist')
          .update({ musicbrainz_id: membership.mbid })
          .eq('id', sameNameArtistId)
        if (linkError) {
          console.error(`メンバー「${membership.name}」への紐付けに失敗しました:`, linkError.message)
          membershipsUnresolved.push(membership.name)
          continue
        }
        otherArtistId = sameNameArtistId
      } else {
        const { data: createdArtist, error: createArtistError } = await supabase
          .from('artist')
          .insert({ name: membership.name, musicbrainz_id: membership.mbid })
          .select('id')
          .single()
        if (createArtistError || !createdArtist) {
          console.error(`メンバー「${membership.name}」のartist作成に失敗しました:`, createArtistError?.message)
          membershipsUnresolved.push(membership.name)
          continue
        }
        otherArtistId = createdArtist.id
      }
    }

    // MusicBrainz経由で名前だけ作成/再利用されたメンバーはapple_music_artist_idを
    // 持たないため画像が空になりがち。名前検索で確度の高い(完全一致1件のみ)候補が
    // 見つかった場合に限り画像を補完する(ベストエフォート、失敗しても処理は続行)
    const { data: otherArtistRow } = await supabase.from('artist').select('name, image_url').eq('id', otherArtistId).single()
    if (otherArtistRow && !otherArtistRow.image_url) {
      try {
        const imageUrl = await resolveArtistImageByName(otherArtistRow.name)
        if (imageUrl) {
          await supabase.from('artist').update({ image_url: imageUrl }).eq('id', otherArtistId)
        }
      } catch (err) {
        console.error(`メンバー「${otherArtistRow.name}」の画像取得に失敗しました:`, err)
      }
    }

    const bandId = membership.subjectIsBand ? artistId : otherArtistId
    const memberId = membership.subjectIsBand ? otherArtistId : artistId

    const descriptionParts: string[] = []
    if (membership.attributes.length > 0) descriptionParts.push(membership.attributes.join('・'))
    if (membership.begin || membership.end) {
      descriptionParts.push(`${membership.begin ?? '?'}〜${membership.ended ? (membership.end ?? '?') : '現在'}`)
    }

    const { error: membershipError } = await supabase.from('artist_relation').upsert(
      {
        artist_id_a: bandId,
        artist_id_b: memberId,
        relation_type: 'membership',
        relation_style: 'solid',
        description: descriptionParts.length > 0 ? descriptionParts.join('、') : null,
      },
      { onConflict: 'artist_id_a,artist_id_b,relation_type', ignoreDuplicates: true }
    )
    if (membershipError) {
      console.error(`メンバーシップ関係の保存に失敗しました(${artistId} <-> ${otherArtistId}):`, membershipError.message)
    } else {
      membershipsWritten++
    }
  }

  return {
    profileFieldCount: Object.keys(fieldUpdate).length,
    linkCount: details.links.length,
    genresLinked,
    membershipsWritten,
    membershipsUnresolved,
  }
}

/**
 * アーティストのMBIDが未確定の場合は自動照合(resolveArtistMbid)を試み、
 * 確定できたらMusicBrainzの詳細(公式サイト/SNS/ストリーミングリンク/ジャンル)を
 * 取り込む。人間の確認を挟まないバルク実行用のベストエフォート処理で、
 * 照合できない/取得失敗の場合は理由文字列を返すだけで例外は投げない。
 * scripts/bulk-import-musicbrainz-profile.ts とiTunesバルク登録
 * (app/admin/import/actions.ts)の両方から使う。
 */
export async function autoImportArtistProfileFromMusicBrainz(
  supabase: SupabaseClient,
  artistId: string
): Promise<string> {
  const { data: artistRow } = await supabase.from('artist').select('musicbrainz_id').eq('id', artistId).single()

  let mbid = artistRow?.musicbrainz_id as string | null | undefined

  if (!mbid) {
    const { data: albums } = await supabase.from('album').select('title').eq('artist_id', artistId)
    const knownTitles = (albums ?? []).map((a) => a.title as string)

    const resolved = await resolveArtistMbid(knownTitles)
    if (!resolved.matched) {
      return `MBID自動照合できず: ${resolved.reason}`
    }
    mbid = resolved.mbid
  }

  let details
  try {
    details = await fetchArtistDetails(mbid)
  } catch (err) {
    return `MusicBrainz詳細取得失敗: ${(err as Error).message}`
  }

  const result = await writeArtistProfileFromMusicBrainzDetails(supabase, artistId, mbid, details)
  const unresolvedNote =
    result.membershipsUnresolved.length > 0 ? `・未解決メンバー${result.membershipsUnresolved.length}件` : ''
  return `MBプロフィール取込: リンク${result.linkCount}件・ジャンル${result.genresLinked}件・メンバーシップ${result.membershipsWritten}件${unresolvedNote}(プロフィール${result.profileFieldCount}件更新)`
}
