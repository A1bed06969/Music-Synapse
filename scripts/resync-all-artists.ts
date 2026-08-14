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
 * GitHub Actionsから月2回(1日・15日)実行する想定。
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistWithAlbums } from '@/utils/itunes'
import { refreshArtistCatalog } from '@/app/admin/import/actions'
import { autoImportArtistProfileFromMusicBrainz } from '@/utils/artistProfileImport'

// カタログがこの件数を超えたら、1回の実行では全件を処理せず
// last_synced_atが古い順にこの件数だけ処理する(自然にローテーションする)
const MAX_ARTISTS_PER_RUN = 500

async function main() {
  const supabase = createAdminClient()

  const { data: artists } = await supabase
    .from('artist')
    .select('id, name, apple_music_artist_id, musicbrainz_id')
    .not('apple_music_artist_id', 'is', null)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(MAX_ARTISTS_PER_RUN)

  if (!artists || artists.length === 0) {
    console.log('対象アーティストが見つかりませんでした。')
    return
  }

  console.log(`対象アーティスト: ${artists.length}件\n`)

  let newAlbumsTotal = 0
  let newTracksTotal = 0
  let profileResolvedCount = 0

  for (const [index, artist] of artists.entries()) {
    console.log(`\n[${index + 1}/${artists.length}] ${artist.name}`)

    let itunesAlbums
    try {
      const result = await fetchArtistWithAlbums(artist.apple_music_artist_id as string)
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
      artist.apple_music_artist_id as string
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
