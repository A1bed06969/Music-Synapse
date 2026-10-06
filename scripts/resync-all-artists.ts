/**
 * カタログ全アーティストを対象に、新譜検知(新規アルバム・トラックの取込)・
 * 画像未設定分の補完・配信停止検知(既に登録済みだが今回iTunesで確認できなかった
 * アルバムをstreaming_status='none'に更新)を行う定期リフレッシュジョブ。
 * MusicBrainzプロフィール(公式サイト/SNS/ジャンル)も未確定のアーティストがあれば
 * あわせて自動照合を試みる。
 *
 * 既存アルバムは一切触らない(app/admin/import/actions.ts の
 * refreshArtistCatalog参照)ため、カタログが大きくなっても1アーティストあたりの
 * 処理時間は新譜の数に比例するだけで、初回登録時ほど重くならない。
 *
 * 【カタログが大きくなった場合の運用】
 * 1回の実行で処理するアーティスト数を MAX_ARTISTS_PER_RUN で上限を設け、
 * artist.last_synced_at が古い(=最後にリフレッシュしてから時間が経っている)
 * アーティストを優先する。カタログがこの上限以下のうちは実質「毎回全件」になり、
 * 上限を超えて増えてきたら自動的に「まだ確認できていないアーティストから順に
 * ローテーションする」運用に切り替わる(スクリプトの変更は不要)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/resync-all-artists.ts
 *
 * Macのlaunchd(com.musicsynapse.artist-resync)から毎日実行し、--cycle-days(既定30)日で全件を一巡する。
 *   npx tsx --env-file=.env.local scripts/resync-all-artists.ts [--cycle-days=30] [--limit=N] [--max-minutes=N]
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistWithAlbums } from '@/utils/itunes'
import { refreshArtistCatalog } from '@/app/admin/import/actions'
import { autoImportArtistProfileFromMusicBrainz } from '@/utils/artistProfileImport'

// 全対象をCYCLE_DAYS日で一巡させる。1日あたりの件数は「対象人数÷CYCLE_DAYS」を毎回計算するため、
// アーティストが増えても周期は保たれる。last_synced_atが古い順(未同期が先)に処理する
const cycleArg = process.argv.find((a) => a.startsWith('--cycle-days='))
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const CYCLE_DAYS = cycleArg ? Number(cycleArg.split('=')[1]) : 30
const maxMinutesArg = process.argv.find((a) => a.startsWith('--max-minutes='))
// 次回の定時起動と重ならないよう、1回の実行時間に上限を設ける(未処理分は翌日に回る)
const MAX_MINUTES = maxMinutesArg ? Number(maxMinutesArg.split('=')[1]) : Infinity
const PAGE_SIZE = 1000

type TargetArtist = {
  id: string
  name: string
  apple_music_artist_id: string | null
  apple_music_country: string | null
  musicbrainz_id: string | null
}

async function main() {
  const supabase = createAdminClient()

  const { count: total } = await supabase
    .from('artist')
    .select('id', { count: 'exact', head: true })
    .not('apple_music_artist_id', 'is', null)
  const perRun = limitArg ? Number(limitArg.split('=')[1]) : Math.ceil((total ?? 0) / CYCLE_DAYS)

  // PostgRESTは1リクエスト最大1000行のため、ページングして取得する
  const artists: TargetArtist[] = []
  while (artists.length < perRun) {
    const from = artists.length
    const to = Math.min(from + PAGE_SIZE, perRun) - 1
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, apple_music_artist_id, apple_music_country, musicbrainz_id')
      .not('apple_music_artist_id', 'is', null)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, to)
    if (error) throw new Error(`対象アーティストの取得に失敗しました: ${error.message}`)
    if (!data || data.length === 0) break
    artists.push(...(data as TargetArtist[]))
    if (data.length < to - from + 1) break
  }
  console.log(`${new Date().toISOString()} 対象 ${total}人 / ${CYCLE_DAYS}日周期 → 今回 ${artists.length}人`)

  if (!artists || artists.length === 0) {
    console.log('対象アーティストが見つかりませんでした。')
    return
  }

  console.log(`対象アーティスト: ${artists.length}件\n`)

  let newAlbumsTotal = 0
  let newTracksTotal = 0
  let profileResolvedCount = 0

  const startedAt = Date.now()
  for (const [index, artist] of artists.entries()) {
    if (Date.now() - startedAt > MAX_MINUTES * 60_000) {
      console.log(`\n実行時間の上限(${MAX_MINUTES}分)に達したため、${index}人で終了します(残りは次回)。`)
      break
    }
    console.log(`\n[${index + 1}/${artists.length}] ${artist.name}`)

    const country = (artist.apple_music_country as string) || 'JP'
    let itunesAlbums
    try {
      const result = await fetchArtistWithAlbums(artist.apple_music_artist_id as string, country)
      if (!result.artist) {
        console.log('  iTunesでアーティストが見つかりませんでした(削除された可能性)')
        continue
      }
      itunesAlbums = result.albums
    } catch (err) {
      console.error('  iTunes取得に失敗しました:', err)
      continue
    }

    const { newAlbumCount, newTrackCount } = await refreshArtistCatalog(
      supabase,
      artist.id,
      artist.name,
      itunesAlbums,
      artist.apple_music_artist_id as string,
      country
    )
    newAlbumsTotal += newAlbumCount
    newTracksTotal += newTrackCount
    console.log(`  新規アルバム: ${newAlbumCount}件・新規トラック: ${newTrackCount}件`)

    if (!artist.musicbrainz_id) {
      try {
        const result = await autoImportArtistProfileFromMusicBrainz(supabase, artist.id)
        console.log(`  MBプロフィール: ${result}`)
        if (result.startsWith('MBプロフィール取込')) profileResolvedCount++
      } catch (err) {
        console.error('  MBプロフィール取込に失敗しました:', err)
      }
    }

    await supabase.from('artist').update({ last_synced_at: new Date().toISOString() }).eq('id', artist.id)
  }

  console.log('\n--- 結果サマリー ---')
  console.log(`処理アーティスト数: ${artists.length}件`)
  console.log(`新規アルバム: ${newAlbumsTotal}件・新規トラック: ${newTracksTotal}件`)
  console.log(`MBプロフィール新規解決: ${profileResolvedCount}件`)
}

main()
