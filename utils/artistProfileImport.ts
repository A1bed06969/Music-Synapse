import type { SupabaseClient } from '@supabase/supabase-js'
import { searchReleaseByTitle, fetchArtistDetails, type MusicBrainzArtistDetails } from '@/utils/musicbrainz'
import { normalizeAlbumTitle } from '@/utils/creditImport'
import { resolveArtistImageByName } from '@/utils/appleMusicImage'
import { fetchOriginCoordinates, fetchRecordLabels } from '@/utils/wikidata'
import { searchArtist, fetchArtistWithAlbums } from '@/utils/itunes'
import { dispatchAlbumSync } from '@/utils/albumSyncDispatch'
import { dispatchMemberEnrichment } from '@/utils/memberEnrichmentDispatch'

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
 * skipMembershipsは、バンドメンバーのスタブ作成直後にそのメンバー自身のプロフィールを
 * 肉付けする際、そのメンバーが所属する他のバンド(無関係な別プロジェクト等)の
 * メンバー一覧まで芋づる式に作成してしまわないようにするためのガード(詳細は
 * enrichNewlyCreatedMemberのコメント参照)
 */
export async function writeArtistProfileFromMusicBrainzDetails(
  supabase: SupabaseClient,
  artistId: string,
  mbid: string,
  details: MusicBrainzArtistDetails,
  options?: { skipMemberships?: boolean }
): Promise<{
  profileFieldCount: number
  linkCount: number
  genresLinked: number
  membershipsWritten: number
  membershipsUnresolved: string[]
  originResolved: boolean
  labelsLinked: number
}> {
  const { data: currentArtist } = await supabase
    .from('artist')
    .select('official_site_url, sns_x_url, sns_instagram_url, musicbrainz_id, origin_latitude')
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

  // 出身地座標(app/admin/data/artists/geoの一括ツールと同じロジック)。
  // MusicBrainzの外部リンクにWikidataがあれば、そのQIDから人間の確認無しで
  // 自動取得する(既に設定済みなら上書きしない)
  let originResolved = false
  const wikidataLink = details.links.find((link) => link.type === 'wikidata')
  const qidMatch = wikidataLink?.url.match(/\/(Q\d+)$/)
  if (qidMatch && currentArtist?.origin_latitude == null) {
    try {
      const coords = await fetchOriginCoordinates(qidMatch[1])
      if (coords) {
        const { error } = await supabase
          .from('artist')
          .update({ origin_latitude: coords.latitude, origin_longitude: coords.longitude })
          .eq('id', artistId)
        if (error) {
          console.error(`出身地座標の保存に失敗しました(${artistId}):`, error.message)
        } else {
          originResolved = true
        }
      }
    } catch (err) {
      console.error(`出身地座標の取得に失敗しました(${artistId}):`, err)
    }
  }

  // レーベル所属(WikidataのP264: record label)。同じQIDから人間の確認無しで
  // 自動取得する。加入日はWikidata側にほぼ無いため取れた場合のみ設定し、
  // 取れなければnullのままにする(既存の(artist_id, label_id)組は重複登録しない)
  let labelsLinked = 0
  if (qidMatch) {
    try {
      const wikidataLabels = await fetchRecordLabels(qidMatch[1])
      if (wikidataLabels.length > 0) {
        const { data: existingArtistLabels } = await supabase
          .from('artist_label')
          .select('label_id')
          .eq('artist_id', artistId)
        const existingLabelIds = new Set((existingArtistLabels ?? []).map((r) => r.label_id))

        for (const wl of wikidataLabels) {
          const { data: existingLabelRows } = await supabase
            .from('label')
            .select('id')
            .eq('name', wl.name)
            .limit(1)
          let labelId = existingLabelRows?.[0]?.id as string | undefined

          if (!labelId) {
            const { data: created, error } = await supabase
              .from('label')
              .insert({ name: wl.name })
              .select('id')
              .single()
            if (error || !created) continue
            labelId = created.id
          }

          if (existingLabelIds.has(labelId)) continue

          // Wikidataに加入日が無い場合、自分のDB側で「このアーティストがこの
          // レーベルの下でリリースした最も古いアルバム」の発売日を加入日の
          // 目安として使う(このレーベル紐付け処理はアルバム同期時の
          // レーベル自動反映(utils/creditImport.tsのautoImportFromMusicBrainz)
          // より後に走る想定のため、既にlabel_idが入っている可能性がある)
          let startDate = wl.startYear ? `${wl.startYear}-01-01` : null
          if (!startDate) {
            const { data: earliestAlbum } = await supabase
              .from('album')
              .select('release_date')
              .eq('artist_id', artistId)
              .eq('label_id', labelId)
              .not('release_date', 'is', null)
              .order('release_date', { ascending: true })
              .limit(1)
              .maybeSingle()
            startDate = earliestAlbum?.release_date ?? null
          }

          const { error: linkError } = await supabase.from('artist_label').insert({
            artist_id: artistId,
            label_id: labelId,
            start_date: startDate,
          })
          if (!linkError) {
            labelsLinked++
            existingLabelIds.add(labelId)
          }
        }
      }
    } catch (err) {
      console.error(`レーベル所属の取得に失敗しました(${artistId}):`, err)
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
  for (const membership of options?.skipMemberships ? [] : details.memberships) {
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
    // 持たないため画像・SNS・カタログが空になりがち。名前検索で確度の高い
    // (完全一致1件のみ)候補が見つかった場合に限り画像を補完する
    // (ベストエフォート、失敗しても処理は続行)
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
    // 画像だけでなく、SNS/ジャンル/出身地とカタログ(アルバム・トラック)も肉付けしたいが、
    // この場でawaitして直列に行うと、メンバーの多いバンド(実例:
    // Deerhoofの現役+元メンバー計9名)でVercelの60秒タイムアウトに引っかかり、
    // 誰も肉付けされないまま関数ごと強制終了される不具合を実際に確認した。
    // メンバーごとに独立したリクエストへ切り離してディスパッチする
    // (utils/albumSyncDispatch.ts等と同じ理由・同じパターン)
    await dispatchMemberEnrichment(otherArtistId!, membership.name, membership.mbid)

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
    originResolved,
    labelsLinked,
  }
}

/**
 * バンドメンバーとして新規作成/再利用されたartist行(名前+MBIDだけの薄い状態の
 * ことが多い)を、そのメンバー自身のMBIDを使って肉付けする:
 * ①SNS・公式サイト・ジャンル・出身地(writeArtistProfileFromMusicBrainzDetailsを
 *   skipMemberships:trueで再帰的に呼ぶ。trueにする理由: このメンバーが
 *   所属する他の無関係なバンド(別プロジェクト等)のメンバー一覧まで
 *   芋づる式に作成してしまうのを防ぐため)
 * ②iTunesカタログ(名前検索で確度の高い(完全一致1件のみ)候補が見つかった場合に
 *   限りapple_music_artist_idを補完し、アルバム・トラックを一括同期する)
 * 呼び出し元(writeArtistProfileFromMusicBrainzDetailsのメンバーシップループ)で
 * バンドメンバーが見つかるたび毎回呼ばれるが、既に十分な情報を持つメンバー
 * (他のバンド経由で既に肉付け済み等)は内部で早期リターンし、無駄なAPI呼び出しを
 * しない。ベストエフォートで、失敗してもメンバーシップ登録自体には影響させない
 */
export async function enrichNewlyCreatedMember(
  supabase: SupabaseClient,
  memberArtistId: string,
  memberName: string,
  memberMbid: string
): Promise<void> {
  const { data: current } = await supabase
    .from('artist')
    .select('official_site_url, sns_x_url, apple_music_artist_id')
    .eq('id', memberArtistId)
    .single()
  if (!current) return

  if (!current.official_site_url && !current.sns_x_url) {
    try {
      const details = await fetchArtistDetails(memberMbid)
      await writeArtistProfileFromMusicBrainzDetails(supabase, memberArtistId, memberMbid, details, {
        skipMemberships: true,
      })
    } catch (err) {
      console.error(`メンバー「${memberName}」のプロフィール取込に失敗しました:`, err)
    }
  }

  if (!current.apple_music_artist_id) {
    try {
      const candidates = await searchArtist(memberName)
      const normalize = (s: string) => s.trim().toLowerCase()
      const exactMatches = candidates.filter((c) => normalize(c.artistName) === normalize(memberName))
      if (exactMatches.length === 1) {
        const appleArtistId = String(exactMatches[0].artistId)
        await supabase.from('artist').update({ apple_music_artist_id: appleArtistId }).eq('id', memberArtistId)
        const { artist: itunesArtist, albums: itunesAlbums } = await fetchArtistWithAlbums(appleArtistId)
        if (itunesArtist) {
          await dispatchAlbumSync(memberArtistId, itunesArtist.artistName, appleArtistId, itunesAlbums)
        }
      }
    } catch (err) {
      console.error(`メンバー「${memberName}」のカタログ照合に失敗しました:`, err)
    }
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
  const originNote = result.originResolved ? '・出身地座標取込' : ''
  const labelNote = result.labelsLinked > 0 ? `・レーベル${result.labelsLinked}件` : ''
  return `MBプロフィール取込: リンク${result.linkCount}件・ジャンル${result.genresLinked}件・メンバーシップ${result.membershipsWritten}件${unresolvedNote}${originNote}${labelNote}(プロフィール${result.profileFieldCount}件更新)`
}
