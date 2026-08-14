/**
 * カタログ全アーティスト・全アルバムを対象に、MusicBrainz/Discogs両方から
 * クレジット(プロデューサー/ミックス/マスタリング/作曲/作詞/編曲/アートワーク/
 * ミュージシャン)を一括取込する。
 *
 * 既存の管理画面フロー(app/admin/data/albums/[id]/credits)は人間が候補を
 * 確認してから取り込む設計だが、3,944件全てを人手で確認するのは非現実的なため、
 * このスクリプトはタイトルが完全一致(正規化後)した場合のみ自動採用し、
 * 一致しない場合はスキップしてログに残す(誤マッチ防止)。
 *
 * 1アーティストずつ、そのアーティストの全アルバムに対してMusicBrainz→Discogsの
 * 順で処理する。既にartist_creditが存在するアルバムはスキップする(再実行時の
 * 重複処理防止・中断からの再開に対応)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/bulk-import-credits.ts
 *
 * 所要時間の目安: MusicBrainzは1req/秒の内蔵レート制限があり、Work単位の
 * 追加取得も必要なため全体で数時間規模。バックグラウンド実行を推奨。
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchRelease as searchMbRelease, fetchReleaseCreditsAndInstruments } from '@/utils/musicbrainz'
import { searchRelease as searchDiscogsRelease, fetchReleaseCredits as fetchDiscogsCredits } from '@/utils/discogs'
import { writeAlbumCredits, buildTrackIdResolver, type UnifiedCreditInput } from '@/utils/creditImport'
import type { SupabaseClient } from '@supabase/supabase-js'

function normalize(title: string): string {
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

type AlbumRow = { id: string; title: string }

async function processMusicBrainz(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string,
  album: AlbumRow
): Promise<string> {
  let results
  try {
    results = await searchMbRelease(album.title, artistName)
  } catch (err) {
    return `MB検索失敗: ${(err as Error).message}`
  }

  const exact = results.find((r) => normalize(r.title) === normalize(album.title))
  if (!exact) return 'MB一致なし'

  let mbCredits
  try {
    const result = await fetchReleaseCreditsAndInstruments(exact.mbid)
    mbCredits = result.credits
  } catch (err) {
    return `MBクレジット取得失敗: ${(err as Error).message}`
  }
  if (mbCredits.length === 0) return 'MB一致(クレジット0件)'

  const { data: albumTracks } = await supabase.from('track').select('id, title').eq('album_id', album.id)
  const resolveTrackId = buildTrackIdResolver(albumTracks ?? [])

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

async function processDiscogs(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string,
  album: AlbumRow
): Promise<string> {
  let results
  try {
    results = await searchDiscogsRelease(album.title, artistName)
  } catch (err) {
    return `Discogs検索失敗: ${(err as Error).message}`
  }

  const exact = results.find((r) => normalize(stripDiscogsArtistPrefix(r.title, artistName)) === normalize(album.title))
  if (!exact) return 'Discogs一致なし'

  let discogsCredits
  try {
    const result = await fetchDiscogsCredits(exact.discogsId)
    discogsCredits = result.credits
  } catch (err) {
    return `Discogsクレジット取得失敗: ${(err as Error).message}`
  }
  if (discogsCredits.length === 0) return 'Discogs一致(クレジット0件)'

  const { data: albumTracks } = await supabase.from('track').select('id, title').eq('album_id', album.id)
  const resolveTrackId = buildTrackIdResolver(albumTracks ?? [])

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

async function main() {
  const supabase = createAdminClient()

  const { data: artists } = await supabase.from('artist').select('id, name').order('name')
  if (!artists || artists.length === 0) {
    console.log('アーティストが見つかりませんでした。')
    return
  }

  // 既にクレジットが存在するアルバムはスキップする(再実行時の重複防止)
  const { data: alreadyCreditedRows } = await supabase.from('artist_credit').select('album_id')
  const alreadyCredited = new Set((alreadyCreditedRows ?? []).map((r) => r.album_id as string))

  console.log(`対象アーティスト: ${artists.length}件\n`)

  let albumsProcessed = 0
  let albumsSkippedDone = 0

  for (const [artistIndex, artist] of artists.entries()) {
    const { data: albums } = await supabase.from('album').select('id, title').eq('artist_id', artist.id)
    if (!albums || albums.length === 0) continue

    console.log(`\n[${artistIndex + 1}/${artists.length}] ${artist.name}(${albums.length}アルバム)`)

    for (const album of albums) {
      if (alreadyCredited.has(album.id)) {
        albumsSkippedDone += 1
        continue
      }

      const mbResult = await processMusicBrainz(supabase, artist.id, artist.name, album)
      const discogsResult = await processDiscogs(supabase, artist.id, artist.name, album)
      albumsProcessed += 1

      console.log(`  ${album.title}`)
      console.log(`    MB: ${mbResult}`)
      console.log(`    Discogs: ${discogsResult}`)
    }
  }

  console.log('\n--- 結果サマリー ---')
  console.log(`処理済みアルバム: ${albumsProcessed}件`)
  console.log(`既取込でスキップ: ${albumsSkippedDone}件`)
}

main()
