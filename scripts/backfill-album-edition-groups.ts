// scripts/backfill-album-edition-groups.ts
/**
 * デラックス版・地域別版・ボーナス版などの「版違い」アルバムを、代表版
 * (最速リリース日)+その他の版、という形にグループ化する。
 * primary_album_idが未設定(NULL)かつedition_group_manual_overrideがfalseの
 * アルバムだけを対象とするため、管理画面から手動修正した行や既にグループ化
 * 済みの行は上書きしない。何度でも安全に再実行できる(新しくインポートされた
 * 版を後から拾うため、定期的な再実行を想定)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-album-edition-groups.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { groupAlbumsForEditionMerge, type AlbumForGrouping } from '@/utils/albumEditionGrouping'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

// PostgRESTはデフォルトで1リクエストあたり最大1000行しか返さないため、
// 対象アルバムが1000件を超える場合に備えてページングして全件取得する。
async function fetchAllTargetAlbums(supabase: SupabaseAdminClient) {
  const pageSize = 1000
  let offset = 0
  const rows: {
    id: string
    artist_id: string
    title: string
    release_date: string | null
    album_type: string | null
  }[] = []

  while (true) {
    const { data, error } = await supabase
      .from('album')
      .select('id, artist_id, title, release_date, album_type')
      .is('primary_album_id', null)
      .eq('edition_group_manual_override', false)
      .in('album_type', ['Album', 'EP', 'Live'])
      .range(offset, offset + pageSize - 1)

    if (error) {
      return { rows: null, error }
    }

    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }

  return { rows, error: null }
}

async function main() {
  const supabase = createAdminClient()

  const { rows: albums, error } = await fetchAllTargetAlbums(supabase)

  if (error) {
    console.error('アルバム取得に失敗しました:', error.message)
    process.exit(1)
  }

  const rows: AlbumForGrouping[] = (albums ?? []).map((a) => ({
    id: a.id,
    artistId: a.artist_id,
    title: a.title,
    releaseDate: a.release_date,
    albumType: a.album_type,
  }))

  const groups = groupAlbumsForEditionMerge(rows)

  if (groups.length === 0) {
    console.log('グループ化対象のアルバムはありません。')
    return
  }

  console.log(`${groups.length}件のグループを検出しました。\n`)

  let updated = 0
  let failed = 0

  for (const group of groups) {
    const { error: updateError } = await supabase
      .from('album')
      .update({ primary_album_id: group.primaryId })
      .in('id', group.editionIds)

    if (updateError) {
      console.error(`  失敗 (primary=${group.primaryId}): ${updateError.message}`)
      failed += 1
      continue
    }
    console.log(`  primary=${group.primaryId} / editions=${group.editionIds.join(', ')}`)
    updated += 1
  }

  console.log(`\n完了: ${updated}件のグループを適用、${failed}件失敗。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
