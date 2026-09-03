// scripts/recheck-released-stubs.ts
//
// 未解禁(streaming_status: 'unreleased', apple_music_album_id: null)として
// 最小限登録したアルバムのうち、発売日を過ぎたものをApple Musicで再検索し、
// 見つかればその場でカタログを更新する(新着情報の自動反映と同じ考え方を、
// 「登録済みだが未解禁だったもの」にも適用する)。
//
// 対象を絞る理由: streaming_statusが'unreleased'のアルバムには、タワレコメン等
// 過去のインポートでrelease_dateが「年のみ判明・月日不明」のため「YYYY-01-01」を
// 仮の値として入れたものや、そもそも数十年前の廃盤(Apple Musicに来る見込みが薄い)
// も混ざっている。これらまで毎日チェックするのは無駄なAPI呼び出しになるため、
// 「直近の具体的な発売日を過ぎたばかりのもの」だけに絞る(過去90日以内、
// かつ月日が「-01-01」ちょうどではない=仮の値ではなさそうなもの)。
//
// マッチングはutils/creditImport.tsの自動クレジット取込と同じ方針(正規化後の
// タイトル完全一致のみ自動採用、人間の確認を挟まないため誤マッチ防止を優先)。
// 見つかったアルバムは既存の行(id)をそのまま更新する(削除して作り直すと、
// album_credit/ranking_entry/radio_rotation等、albumを参照する14テーブル分の
// 付け替えが必要になり危険なため。詳細はapp/admin/import/actions.tsの
// syncOneAlbumコメント参照)。同じapple_music_album_idの行が既に別に存在する
// 場合(自動一括同期などで先に登録されてしまっていた場合)は、二重登録を避ける
// ため自動処理せず、既存のキュレーション候補マッチング画面での手動対応に委ねる。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/recheck-released-stubs.ts
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchAlbums } from '@/utils/itunes'
import { normalizeAlbumTitle } from '@/utils/creditImport'
import { syncOneAlbum } from '@/app/admin/import/actions'

const RECHECK_WINDOW_DAYS = 90

function daysAgoISO(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const windowStart = daysAgoISO(RECHECK_WINDOW_DAYS)

  const { data: stubs, error } = await supabase
    .from('album')
    .select('id, title, release_date, artist_id, artist:artist_id(name)')
    .eq('streaming_status', 'unreleased')
    .is('apple_music_album_id', null)
    .gte('release_date', windowStart)
    .lte('release_date', today)
    .order('release_date', { ascending: true })

  if (error) {
    console.error('対象アルバムの取得に失敗しました:', error.message)
    process.exit(1)
  }

  // 「YYYY-01-01」は年しか分かっていない仮の発売日のため対象から除外する
  const candidates = (stubs ?? []).filter((row) => !row.release_date.endsWith('-01-01'))

  console.log(`対象: ${candidates.length}件(発売日 ${windowStart} 〜 ${today} のうち、仮の日付を除く)\n`)

  let matched = 0
  let skippedConflict = 0

  for (const stub of candidates) {
    const artist = Array.isArray(stub.artist) ? stub.artist[0] : stub.artist
    const artistName = artist?.name ?? ''

    let results
    try {
      results = await searchAlbums(`${artistName} ${stub.title}`, 10)
    } catch (err) {
      console.error(`  [${stub.title}] iTunes検索失敗: ${(err as Error).message}`)
      continue
    }

    const exact = results.find(
      (r) => normalizeAlbumTitle(r.collectionName) === normalizeAlbumTitle(stub.title) && normalizeAlbumTitle(r.artistName) === normalizeAlbumTitle(artistName)
    )
    if (!exact) {
      console.log(`[${stub.release_date}] ${artistName} - ${stub.title}: 一致なし(引き続き未解禁のまま)`)
      continue
    }

    // 同じapple_music_album_idの行が既に別に存在する場合は、二重登録を避けて
    // 自動処理をスキップする(既存のキュレーション候補マッチング画面で手動対応)
    const { data: conflicting } = await supabase
      .from('album')
      .select('id')
      .eq('apple_music_album_id', String(exact.collectionId))
      .eq('artist_id', stub.artist_id)
      .neq('id', stub.id)
      .maybeSingle()

    if (conflicting) {
      console.log(`[${stub.release_date}] ${artistName} - ${stub.title}: 一致(${exact.collectionName})したが既に別行(${conflicting.id})が存在するためスキップ`)
      skippedConflict++
      continue
    }

    await syncOneAlbum(supabase, stub.artist_id, artistName, exact, stub.id, true)
    await supabase.from('album').update({ streaming_status: null }).eq('id', stub.id)

    console.log(`[${stub.release_date}] ${artistName} - ${stub.title}: 一致(${exact.collectionName})、カタログを更新しました`)
    matched++
  }

  console.log(`\n完了: ${candidates.length}件確認、${matched}件を更新、${skippedConflict}件を重複のためスキップ。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
