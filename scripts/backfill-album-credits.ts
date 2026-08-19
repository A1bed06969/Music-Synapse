// scripts/backfill-album-credits.ts
/**
 * 大量アルバムの一括同期(app/api/admin/album-sync/route.ts)がホップ数削減のため
 * 省略したクレジット取込(MusicBrainz→Discogs)を、後追いで拾う。
 * credit_import_attempted_atがNULLのアルバムだけを対象にするため、安全に
 * 再実行できる(既に試行済みのアルバムは対象から自然に外れる)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-album-credits.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { autoImportFromMusicBrainz, autoImportFromDiscogs } from '@/utils/creditImport'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

async function fetchAlbumsNeedingCreditImport(supabase: SupabaseAdminClient) {
  const pageSize = 1000
  let offset = 0
  const rows: { id: string; artist_id: string; title: string; artist_name: string }[] = []

  while (true) {
    const { data, error } = await supabase
      .from('album')
      .select('id, artist_id, title, artist:artist_id(name)')
      .is('credit_import_attempted_at', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) {
      return { rows: null, error }
    }

    const page = data ?? []
    for (const row of page) {
      const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
      rows.push({ id: row.id, artist_id: row.artist_id, title: row.title, artist_name: artist?.name ?? '' })
    }
    if (page.length < pageSize) break
    offset += pageSize
  }

  return { rows, error: null }
}

async function main() {
  const supabase = createAdminClient()

  const { rows: albums, error } = await fetchAlbumsNeedingCreditImport(supabase)

  if (error) {
    console.error('アルバム取得に失敗しました:', error.message)
    process.exit(1)
  }

  if (!albums || albums.length === 0) {
    console.log('クレジット取込対象のアルバムはありません。')
    return
  }

  console.log(`対象: ${albums.length}件\n`)

  let matched = 0
  let done = 0

  for (const album of albums) {
    const { data: tracks } = await supabase.from('track').select('id, title').eq('album_id', album.id)
    const albumForCredits = { id: album.id, title: album.title }

    let mbResult = ''
    let discogsResult = ''
    try {
      mbResult = await autoImportFromMusicBrainz(supabase, album.artist_id, album.artist_name, albumForCredits, tracks ?? [])
    } catch (err) {
      mbResult = `エラー: ${err instanceof Error ? err.message : String(err)}`
    }
    try {
      discogsResult = await autoImportFromDiscogs(supabase, album.artist_id, album.artist_name, albumForCredits, tracks ?? [])
    } catch (err) {
      discogsResult = `エラー: ${err instanceof Error ? err.message : String(err)}`
    }

    await supabase.from('album').update({ credit_import_attempted_at: new Date().toISOString() }).eq('id', album.id)

    done++
    const isMatch = !mbResult.includes('一致なし') || !discogsResult.includes('一致なし')
    if (isMatch) matched++

    if (done % 20 === 0 || isMatch) {
      console.log(`[${done}/${albums.length}] ${album.artist_name} - ${album.title}: MB[${mbResult}] Discogs[${discogsResult}]`)
    }
  }

  console.log(`\n完了: ${done}件処理、${matched}件でクレジット一致。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
