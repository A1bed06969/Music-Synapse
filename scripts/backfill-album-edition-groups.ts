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
      .order('id', { ascending: true })
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

// グループの候補に挙がったアルバムのうち、既に他のアルバムから
// primary_album_idで指されている(=既に代表版として子を持っている)ものを
// 調べる。groupAlbumsForEditionMergeはリリース日だけで代表版を選ぶため、
// 既存の代表版がグループ内の日付タイブレークで負けると、その代表版の
// 既存の子はそのままに代表版自身だけが別の代表版の子にされてしまい、
// 「子→旧代表版→新代表版」という多段階チェーンが生まれてしまう
// (一覧・Other Versionsのフィルタは1段階しか辿らないため、旧代表版の
// 既存の子が画面上から消える)。これを検出するための事前チェック。
//
// 対象の子アルバムは(このバッチ時点では)全体でも数百件程度だが、将来的な
// 増加やcandidateIdsの件数に備え、.in()のチャンク分割と.range()でのページング
// の両方を行う(scripts/backfill-track-preview-url.tsのchunk方針 +
// fetchAllTargetAlbumsのページング方針を踏襲)。
async function fetchAlbumIdsWithChildren(
  supabase: SupabaseAdminClient,
  candidateIds: string[]
): Promise<{ ids: Set<string> | null; error: { message: string } | null }> {
  const CHUNK_SIZE = 500
  const pageSize = 1000
  const result = new Set<string>()

  for (let i = 0; i < candidateIds.length; i += CHUNK_SIZE) {
    const batch = candidateIds.slice(i, i + CHUNK_SIZE)
    let offset = 0

    while (true) {
      const { data, error } = await supabase
        .from('album')
        .select('id, primary_album_id')
        .in('primary_album_id', batch)
        .order('primary_album_id', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)

      if (error) {
        return { ids: null, error }
      }

      const page = data ?? []
      for (const row of page) {
        if (row.primary_album_id) result.add(row.primary_album_id)
      }
      if (page.length < pageSize) break
      offset += pageSize
    }
  }

  return { ids: result, error: null }
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

  // rowsは全グループのメンバーを包含する(グループの全メンバーはrowsから
  // 生成されるため)ので、そのまま候補集合として使う。
  const candidateIds = rows.map((r) => r.id)
  const { ids: hasChildrenIds, error: childrenError } = await fetchAlbumIdsWithChildren(supabase, candidateIds)

  if (childrenError || !hasChildrenIds) {
    console.error('既存代表版の子アルバム確認に失敗しました:', childrenError?.message)
    process.exit(1)
  }

  let updated = 0
  let failed = 0
  let skipped = 0

  for (const group of groups) {
    const members = [group.primaryId, ...group.editionIds]
    const membersWithChildren = members.filter((id) => hasChildrenIds.has(id))

    let forcedPrimaryId: string
    if (membersWithChildren.length === 0) {
      forcedPrimaryId = group.primaryId
    } else if (membersWithChildren.length === 1) {
      // 既に子を持つ代表版が1件だけグループに混ざっている場合は、
      // groupAlbumsForEditionMergeの日付タイブレークに関わらず、
      // その既存代表版を代表として維持する(多段階チェーン化の回避)。
      forcedPrimaryId = membersWithChildren[0]
    } else {
      console.warn(
        `  スキップ (既に子を持つ代表版が複数混在): メンバー=${members.join(', ')} / 既に子を持つもの=${membersWithChildren.join(', ')}`
      )
      skipped += 1
      continue
    }

    const targetIds = members.filter((id) => id !== forcedPrimaryId)
    if (targetIds.length === 0) continue

    const { error: updateError } = await supabase
      .from('album')
      .update({ primary_album_id: forcedPrimaryId })
      .in('id', targetIds)

    if (updateError) {
      console.error(`  失敗 (primary=${forcedPrimaryId}): ${updateError.message}`)
      failed += 1
      continue
    }

    const note = forcedPrimaryId !== group.primaryId ? ' (既存代表版を優先)' : ''
    console.log(`  primary=${forcedPrimaryId} / editions=${targetIds.join(', ')}${note}`)
    updated += 1
  }

  console.log(`\n完了: ${updated}件のグループを適用、${skipped}件スキップ、${failed}件失敗。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
