/**
 * カタログ全アーティストを対象に、MusicBrainzの公式サイト/SNS(X, Instagram)/
 * ストリーミングリンク/ジャンルを一括取込する。
 *
 * artist.musicbrainz_idが既に分かっている場合はそれを使い、未確定の場合は
 * うちのDBにあるアルバムタイトルとのリリース完全一致でMBIDを自動照合する
 * (utils/artistProfileImport.ts の resolveArtistMbid)。人間の確認を挟まない
 * バルク実行のため、複数タイトルで一致が取れた場合のみ採用し、それ以外は
 * スキップしてログに残す(誤マッチ防止)。
 *
 * 既にmusicbrainz_idが設定済み「かつ」外部リンクが1件以上ある場合はスキップする
 * (再実行時の重複処理防止・中断からの再開に対応)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/bulk-import-musicbrainz-profile.ts
 *
 * 所要時間の目安: MusicBrainzは1req/秒の内蔵レート制限がある。MBID未確定の
 * アーティストはアルバムタイトル最大5件分のrelease検索(=最大5秒)+詳細取得が
 * かかる。クレジット一括取込(scripts/bulk-import-credits.ts)と同時実行すると
 * MusicBrainz側のレート制限に競合するため、完了後に実行すること。
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { autoImportArtistProfileFromMusicBrainz } from '@/utils/artistProfileImport'

async function main() {
  const supabase = createAdminClient()

  const { data: artists } = await supabase.from('artist').select('id, name').order('name')
  if (!artists || artists.length === 0) {
    console.log('アーティストが見つかりませんでした。')
    return
  }

  const { data: linkedArtistRows } = await supabase.from('artist_external_link').select('artist_id')
  const alreadyLinked = new Set((linkedArtistRows ?? []).map((r) => r.artist_id as string))

  console.log(`対象アーティスト: ${artists.length}件\n`)

  let processed = 0
  let skippedDone = 0

  for (const [index, artist] of artists.entries()) {
    if (alreadyLinked.has(artist.id)) {
      skippedDone += 1
      continue
    }

    console.log(`\n[${index + 1}/${artists.length}] ${artist.name}`)
    const result = await autoImportArtistProfileFromMusicBrainz(supabase, artist.id)
    processed += 1
    console.log(`  ${result}`)
  }

  console.log('\n--- 結果サマリー ---')
  console.log(`処理済みアーティスト: ${processed}件`)
  console.log(`既取込でスキップ: ${skippedDone}件`)
}

main()
