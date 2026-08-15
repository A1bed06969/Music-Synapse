import type { SupabaseClient } from '@supabase/supabase-js'
import { CREDIT_ROLE_LABEL } from '@/utils/format'
import { searchRelease as searchMbRelease, fetchReleaseCreditsAndInstruments } from '@/utils/musicbrainz'
import { searchRelease as searchDiscogsRelease, fetchReleaseCredits as fetchDiscogsCredits } from '@/utils/discogs'

export type UnifiedCreditInput = {
  personName: string
  personSourceId: string
  source: 'musicbrainz' | 'discogs'
  role: string
  sourceUrl: string
  trackId: string | null
  instrumentName: string | null
}

export type WriteAlbumCreditsResult = {
  relationsWritten: number
  creditsWritten: number
  instrumentsWritten: number
  failureCount: number
}

/**
 * クレジット1件分をDBへ反映する共通ロジック。
 * 管理画面のフォーム送信(app/admin/data/albums/[id]/credits/actions.ts)と
 * 一括取込スクリプト(scripts/bulk-import-credits.ts)の両方から呼ばれる。
 */
export async function writeAlbumCredits(
  supabase: SupabaseClient,
  artistId: string,
  albumId: string,
  credits: UnifiedCreditInput[]
): Promise<WriteAlbumCreditsResult> {
  let relationsWritten = 0
  let creditsWritten = 0
  let instrumentsWritten = 0
  let failureCount = 0

  for (const credit of credits) {
    const { personName, personSourceId, source, role, sourceUrl, trackId, instrumentName } = credit
    if (!personName || !personSourceId || !role) continue
    if (!(role in CREDIT_ROLE_LABEL)) continue

    // MusicBrainzはartist.musicbrainz_id、Discogsはartist.discogs_artist_idで
    // 既存アーティストと照合する(ソースごとにID体系が別物のため)
    const artistMatchColumn = source === 'discogs' ? 'discogs_artist_id' : 'musicbrainz_id'
    const personMatchColumn = source === 'discogs' ? 'discogs_id' : 'musicbrainz_id'

    // ミュージシャンロールは、カタログとの人物一致状況に関わらず
    // 「この楽器が使われた」という記録を別途残す(instrument_idはartist_creditにも
    // 付与し、後で「誰が何を演奏したか」を表示できるようにする)
    let instrumentId: string | undefined
    if (role === 'musician' && instrumentName) {
      const { data: existingInstrument } = await supabase
        .from('instrument')
        .select('id')
        .ilike('name', instrumentName)
        .maybeSingle()

      instrumentId = existingInstrument?.id as string | undefined
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

      // track_instrument(トラック↔楽器の一覧表示用)はトラックが特定できる場合のみ書き込む
      if (instrumentId && trackId) {
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
      .eq(artistMatchColumn, personSourceId)
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
      .eq(personMatchColumn, personSourceId)
      .maybeSingle()

    let creditPersonId = existingPerson?.id as string | undefined
    if (!creditPersonId) {
      const { data: createdPerson, error: createError } = await supabase
        .from('credit_person')
        .insert({ name: personName, [personMatchColumn]: personSourceId })
        .select('id')
        .single()
      if (createError) {
        console.error(`人物「${personName}」の作成に失敗しました:`, createError)
        failureCount += 1
        continue
      }
      creditPersonId = createdPerson.id
    }

    // artist_creditのユニーク制約は(artist_id, album_id, track_id, credit_person_id,
    // role, source, instrument_id)だが、track_id/instrument_idがNULLの場合(アルバム単位の
    // 作曲/作詞クレジット等)、PostgreSQLの仕様上NULL同士は一致とみなされずON CONFLICTが
    // 発火しないため、upsertのignoreDuplicatesが実質無効化されて同じクレジットが
    // 際限なく重複登録されてしまう。そのためNULLを明示的に扱えるSELECTで
    // 事前に存在確認してから挿入する(この関数は1アルバムずつ直列に呼ばれるため
    // 競合状態の心配はない)
    let existingCreditQuery = supabase
      .from('artist_credit')
      .select('id')
      .eq('artist_id', artistId)
      .eq('album_id', albumId)
      .eq('credit_person_id', creditPersonId)
      .eq('role', role)
      .eq('source', source)
    existingCreditQuery = trackId
      ? existingCreditQuery.eq('track_id', trackId)
      : existingCreditQuery.is('track_id', null)
    existingCreditQuery = instrumentId
      ? existingCreditQuery.eq('instrument_id', instrumentId)
      : existingCreditQuery.is('instrument_id', null)

    const { data: existingCredit } = await existingCreditQuery.maybeSingle()
    if (existingCredit) {
      continue // 既に同じクレジットが登録済み
    }

    const { data: creditData, error: creditError } = await supabase
      .from('artist_credit')
      .insert({
        artist_id: artistId,
        album_id: albumId,
        track_id: trackId,
        credit_person_id: creditPersonId,
        role,
        source,
        source_url: sourceUrl || null,
        instrument_id: instrumentId ?? null,
      })
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

  return { relationsWritten, creditsWritten, instrumentsWritten, failureCount }
}

/** アルバムの収録曲一覧から、クレジットの録音タイトルに対応するtrack_idを解決する */
export function buildTrackIdResolver(albumTracks: { id: string; title: string }[]): (trackTitle: string | null) => string | null {
  const normalizeTitle = (title: string) => title.trim().toLowerCase()
  const trackIdByTitle = new Map(albumTracks.map((t) => [normalizeTitle(t.title), t.id]))
  return (trackTitle) => (trackTitle ? (trackIdByTitle.get(normalizeTitle(trackTitle)) ?? null) : null)
}

export function normalizeAlbumTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Discogsの検索結果タイトルは "Artist - Title" 形式で返ってくるため、
// アーティスト名プレフィックスを除去してからアルバムタイトルと比較する
function stripDiscogsArtistPrefix(resultTitle: string, artistName: string): string {
  const prefix = `${artistName} - `
  if (resultTitle.startsWith(prefix)) return resultTitle.slice(prefix.length)
  const idx = resultTitle.indexOf(' - ')
  return idx >= 0 ? resultTitle.slice(idx + 3) : resultTitle
}

export type AlbumForCreditImport = { id: string; title: string }

async function resolveAlbumTracks(
  supabase: SupabaseClient,
  album: AlbumForCreditImport,
  albumTracks?: { id: string; title: string }[]
): Promise<{ id: string; title: string }[]> {
  if (albumTracks) return albumTracks
  const { data } = await supabase.from('track').select('id, title').eq('album_id', album.id)
  return data ?? []
}

/**
 * MusicBrainzでアルバムを検索し、タイトルが完全一致(正規化後)した場合のみ
 * クレジットを自動取込する。人間の確認を挟まないため、一致しない場合は
 * 何もせず理由文字列を返すだけにする(誤マッチ防止)。
 * 一括バックフィルスクリプトとiTunesバルク登録の自動クレジット取込の両方から使う。
 */
export async function autoImportFromMusicBrainz(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string,
  album: AlbumForCreditImport,
  albumTracks?: { id: string; title: string }[]
): Promise<string> {
  let results
  try {
    results = await searchMbRelease(album.title, artistName)
  } catch (err) {
    return `MB検索失敗: ${(err as Error).message}`
  }

  const exact = results.find((r) => normalizeAlbumTitle(r.title) === normalizeAlbumTitle(album.title))
  if (!exact) return 'MB一致なし'

  let mbCredits
  try {
    const result = await fetchReleaseCreditsAndInstruments(exact.mbid)
    mbCredits = result.credits
  } catch (err) {
    return `MBクレジット取得失敗: ${(err as Error).message}`
  }
  if (mbCredits.length === 0) return 'MB一致(クレジット0件)'

  const resolveTrackId = buildTrackIdResolver(await resolveAlbumTracks(supabase, album, albumTracks))

  const unified: UnifiedCreditInput[] = mbCredits.map((c) => ({
    personName: c.personName,
    personSourceId: c.personMbid,
    source: 'musicbrainz',
    role: c.role,
    sourceUrl: c.sourceUrl,
    trackId: resolveTrackId(c.trackTitle),
    instrumentName: c.instrumentName ?? null,
  }))

  const r = await writeAlbumCredits(supabase, artistId, album.id, unified)
  return `MB取込: 関係${r.relationsWritten}/クレジット${r.creditsWritten}/楽器${r.instrumentsWritten}(失敗${r.failureCount})`
}

/** Discogs版のautoImportFromMusicBrainz。挙動・方針は同じ */
export async function autoImportFromDiscogs(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string,
  album: AlbumForCreditImport,
  albumTracks?: { id: string; title: string }[]
): Promise<string> {
  let results
  try {
    results = await searchDiscogsRelease(album.title, artistName)
  } catch (err) {
    return `Discogs検索失敗: ${(err as Error).message}`
  }

  const exact = results.find(
    (r) => normalizeAlbumTitle(stripDiscogsArtistPrefix(r.title, artistName)) === normalizeAlbumTitle(album.title)
  )
  if (!exact) return 'Discogs一致なし'

  let discogsCredits
  try {
    const result = await fetchDiscogsCredits(exact.discogsId)
    discogsCredits = result.credits
  } catch (err) {
    return `Discogsクレジット取得失敗: ${(err as Error).message}`
  }
  if (discogsCredits.length === 0) return 'Discogs一致(クレジット0件)'

  const resolveTrackId = buildTrackIdResolver(await resolveAlbumTracks(supabase, album, albumTracks))

  const unified: UnifiedCreditInput[] = discogsCredits.map((c) => ({
    personName: c.personName,
    personSourceId: c.personDiscogsId,
    source: 'discogs',
    role: c.role,
    sourceUrl: c.sourceUrl,
    trackId: resolveTrackId(c.trackTitle),
    instrumentName: c.instrumentName ?? null,
  }))

  const r = await writeAlbumCredits(supabase, artistId, album.id, unified)
  return `Discogs取込: 関係${r.relationsWritten}/クレジット${r.creditsWritten}/楽器${r.instrumentsWritten}(失敗${r.failureCount})`
}
