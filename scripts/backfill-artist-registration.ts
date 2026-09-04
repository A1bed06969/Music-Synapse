// scripts/backfill-artist-registration.ts
//
// apple_music_artist_idは設定済みだが、まだ自分のアルバムが1件も登録されていない
// アーティストを対象に、フルの登録処理(アルバム・トラック同期→版統合→
// MusicBrainzプロフィール自動照合→画像補完)を実行する。
//
// 背景: NME 100/Fender NEXT/Future of Music/RADAR: Early Noiseの各キュレーション
// インポートスクリプト(scripts/import-*.ts)のresolveArtistIdは、Apple Music検索で
// アーティストIDを特定してupsertArtistFromItunesでリンクするだけで、実際のアルバム
// 取得(dispatchAlbumSync相当)を一度も呼んでいなかった。結果、名前とapple_music_
// artist_idだけが登録され、アルバム・トラック・bio等が空のままのアーティストが
// 1400件超残っている(2026-09-04時点)。
//
// クレジット取込(MusicBrainz→Discogs)はここでは省略する(album-sync APIルートと
// 同じ方針。理由はそちらのコメント参照)。別途稼働中のscripts/backfill-album-credits.ts
// が全アルバムを対象に拾うため、ここで重複して行う必要が無い。
//
// Apple Music側を再取得しても0件のアーティスト(自分名義の作品が本当に無い)は
// 更新せずログにIDを出力するだけに留める。カタログを持たないアーティストの扱い
// (credit_person化するか等)は別途判断が必要なため、ここでは自動変換しない。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-artist-registration.ts [--limit=N]
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistWithAlbums } from '@/utils/itunes'
import { registerSingleAlbum, flagDelistedAlbums, fillMissingArtistImage } from '@/app/admin/import/actions'
import { applyEditionGrouping } from '@/utils/applyEditionGrouping'
import { autoImportArtistProfileFromMusicBrainz } from '@/utils/artistProfileImport'

const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined

async function main() {
  const supabase = createAdminClient()

  // PostgRESTのデフォルト行数上限(1000件)に達する規模のため、
  // 両方のクエリともページネーションして全件取得する
  const PAGE_SIZE = 1000

  type ArtistCandidate = { id: string; name: string; apple_music_artist_id: string; apple_music_country: string | null }
  const candidates: ArtistCandidate[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, apple_music_artist_id, apple_music_country')
      .not('apple_music_artist_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    candidates.push(...(data as ArtistCandidate[]))
    if (data.length < PAGE_SIZE) break
  }

  const artistIdsWithAlbums = new Set<string>()
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from('album').select('artist_id').range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const row of data) artistIdsWithAlbums.add(row.artist_id as string)
    if (data.length < PAGE_SIZE) break
  }

  let targets = candidates.filter((a) => !artistIdsWithAlbums.has(a.id))
  if (LIMIT) targets = targets.slice(0, LIMIT)

  console.log(`対象アーティスト: ${targets.length}件\n`)

  let registeredCount = 0
  let newAlbumsTotal = 0
  let newTracksTotal = 0
  let profileResolvedCount = 0
  const noCatalog: { id: string; name: string; appleMusicArtistId: string }[] = []
  const failed: { id: string; name: string; reason: string }[] = []

  for (const [index, artist] of targets.entries()) {
    console.log(`[${index + 1}/${targets.length}] ${artist.name}`)
    const country = (artist.apple_music_country as string) || 'JP'

    let itunesAlbums
    try {
      const result = await fetchArtistWithAlbums(artist.apple_music_artist_id as string, country)
      if (!result.artist) {
        failed.push({ id: artist.id, name: artist.name, reason: 'iTunesでアーティストが見つかりませんでした' })
        console.log('  → iTunesでアーティストが見つかりませんでした')
        continue
      }
      itunesAlbums = result.albums
    } catch (err) {
      failed.push({ id: artist.id, name: artist.name, reason: (err as Error).message })
      console.error('  → iTunes取得に失敗しました:', (err as Error).message)
      continue
    }

    if (itunesAlbums.length === 0) {
      noCatalog.push({ id: artist.id, name: artist.name, appleMusicArtistId: artist.apple_music_artist_id as string })
      console.log('  → Apple Music上に自分名義のアルバムが0件でした(カタログ無し候補)')
      continue
    }

    await fillMissingArtistImage(supabase, artist.id, artist.apple_music_artist_id as string, country)

    let artistNewAlbums = 0
    let artistNewTracks = 0
    for (const itunesAlbum of itunesAlbums) {
      try {
        const { trackCount } = await registerSingleAlbum(supabase, artist.id, artist.name, itunesAlbum, true, country)
        artistNewAlbums += 1
        artistNewTracks += trackCount
      } catch (err) {
        console.error(`  → アルバム登録に失敗しました(${itunesAlbum.collectionName}):`, (err as Error).message)
      }
    }
    newAlbumsTotal += artistNewAlbums
    newTracksTotal += artistNewTracks
    registeredCount += 1
    console.log(`  → アルバム${artistNewAlbums}件・トラック${artistNewTracks}件を登録`)

    await flagDelistedAlbums(supabase, artist.id, itunesAlbums)
    await applyEditionGrouping(supabase, { artistId: artist.id })

    try {
      const profileResult = await autoImportArtistProfileFromMusicBrainz(supabase, artist.id)
      if (!profileResult.startsWith('MBID自動照合できず')) {
        profileResolvedCount += 1
        console.log(`  → ${profileResult}`)
      }
    } catch (err) {
      console.error('  → MusicBrainzプロフィール照合に失敗しました:', (err as Error).message)
    }
  }

  console.log('\n=== 完了 ===')
  console.log(`カタログ登録: ${registeredCount}件(アルバム${newAlbumsTotal}件・トラック${newTracksTotal}件)`)
  console.log(`MusicBrainzプロフィール解決: ${profileResolvedCount}件`)
  console.log(`iTunes取得失敗: ${failed.length}件`)
  console.log(`カタログ無し候補(要判断): ${noCatalog.length}件`)
  if (noCatalog.length > 0) {
    console.log('\n--- カタログ無し候補一覧 ---')
    for (const c of noCatalog) {
      console.log(`${c.id}\t${c.name}\t${c.appleMusicArtistId}`)
    }
  }
}

main()
