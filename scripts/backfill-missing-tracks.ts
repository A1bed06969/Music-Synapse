// scripts/backfill-missing-tracks.ts
//
// track_count(iTunesのアルバム単位メタデータ)は設定されているのに、収録トラック行が
// 1件も無いアルバムを修復する。
//
// 原因: iTunes Search APIは、アルバム単位のlookup(entity=album)ではtrackCountを
// 正しく返すのに、同じcollectionIdへのentity=song lookupではcollection情報だけを
// 返しトラック内訳を1件も返さないことがある(実例: Radio Fabres「春の窓から - Single」で
// 確認、2026年8月時点で472件のアルバムがこの状態)。utils/admin/import/actions.tsの
// syncOneAlbumはこの場合エラーにはならず(空配列を正常系として受け取る)、アルバム行だけ
// track_count付きで作成・トラックは0件のまま残ってしまう。さらに定期リフレッシュ
// (scripts/resync-all-artists.ts)は既存アルバムをスキップするため、一度この状態に
// なると自然には直らない。
//
// 対処:
//   1. 該当アルバムごとにentity=songのlookupを再試行する(一時的な取得漏れなら直る)
//   2. 再試行しても空 かつ track_count=1(シングル)の場合のみ、アルバムタイトルから
//      「 - Single」「 - EP」等の接尾辞を取り除いたものをトラックタイトルとして
//      1件だけ登録する(捏造ではなく、既に持っているコレクション名からの妥当な推定。
//      発売日・時間・プレビューURL等、実際に取得できていない情報は空のままにする)
//   3. track_count>1で再試行後も空の場合は、内訳を安全に推測できないため対象外として
//      報告のみ行う(手動確認が必要)
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-missing-tracks.ts

import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchTracksForAlbum, millisToSeconds } from '@/utils/itunes'

type AlbumRow = {
  id: string
  title: string
  artist_id: string
  track_count: number
  apple_music_album_id: string
}

const SINGLE_SUFFIX_RE = /\s*[-–—]\s*(Single|EP)\s*$/i

async function main() {
  const supabase = createAdminClient()

  // PostgRESTの1回あたり上限(1000件)を超えるため、対象アルバムの母集団取得も
  // ページングする(このスクリプト自身が最初に持っていた不具合: 初回実行時、
  // 対象の絞り込み元がid昇順で先頭1000件に切り詰められ、472件中42件しか
  // 見つけられなかった)
  const albums: AlbumRow[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('album')
      .select('id, title, artist_id, track_count, apple_music_album_id')
      .not('apple_music_album_id', 'is', null)
      .not('track_count', 'is', null)
      .gt('track_count', 0)
      .order('id')
      .range(offset, offset + pageSize - 1)
    const page = (data ?? []) as AlbumRow[]
    albums.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }

  const targets: AlbumRow[] = []
  for (const album of albums) {
    const { count } = await supabase
      .from('track')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', album.id)
    if (!count) targets.push(album)
  }

  console.log(`対象アルバム: ${targets.length}件\n`)

  let recoveredViaRefetch = 0
  let recoveredViaInference = 0
  let stillUnresolved = 0

  for (const album of targets) {
    let tracks
    try {
      const result = await fetchTracksForAlbum(Number(album.apple_music_album_id))
      tracks = result.tracks
    } catch (err) {
      console.error(`取得失敗: ${album.title} (${album.id}):`, err instanceof Error ? err.message : err)
      stillUnresolved++
      continue
    }

    if (tracks.length > 0) {
      for (const t of tracks) {
        const { error } = await supabase.from('track').insert({
          album_id: album.id,
          artist_id: album.artist_id,
          track_no: t.trackNumber ?? null,
          disc_number: t.discNumber ?? null,
          title: t.trackName,
          duration_seconds: millisToSeconds(t.trackTimeMillis),
          apple_music_track_id: String(t.trackId),
          preview_url: t.previewUrl ?? null,
          last_synced_at: new Date().toISOString(),
        })
        if (error) console.error(`トラック登録失敗: ${t.trackName}:`, error.message)
      }
      console.log(`OK(再取得成功) ${album.title} -> ${tracks.length}曲`)
      recoveredViaRefetch++
      continue
    }

    if (album.track_count === 1) {
      const inferredTitle = album.title.replace(SINGLE_SUFFIX_RE, '').trim()
      const { error } = await supabase.from('track').insert({
        album_id: album.id,
        artist_id: album.artist_id,
        track_no: 1,
        disc_number: 1,
        title: inferredTitle || album.title,
      })
      if (error) {
        console.error(`推定タイトルでの登録失敗: ${album.title}:`, error.message)
        stillUnresolved++
      } else {
        console.log(`OK(タイトル推定) ${album.title} -> 「${inferredTitle}」`)
        recoveredViaInference++
      }
      continue
    }

    console.log(`未解決(手動確認が必要) ${album.title} (${album.id}, track_count=${album.track_count})`)
    stillUnresolved++
  }

  console.log(
    `\n完了: 再取得で復旧${recoveredViaRefetch}件 / タイトル推定で復旧${recoveredViaInference}件 / 未解決${stillUnresolved}件`
  )
}

main()
