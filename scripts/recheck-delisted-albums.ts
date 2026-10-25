// scripts/recheck-delisted-albums.ts
//
// 再同期で「配信停止の可能性」(streaming_status='none')にされたアルバムを、アルバムIDで日本・米国のストアに直接照会し、
// まだ配信されているものを元に戻す。以前の判定は「アーティスト別の一覧(最大200件・日本のストア)に無い」だけで
// 配信停止とみなしていたため、件数の多いアーティストの旧作や、米国のストアから登録した作品が誤って「配信なし」になっていた。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/recheck-delisted-albums.ts [--dry-run]
import { createAdminClient } from '@/utils/Supabase/admin'
import { lookupExistingCollectionIds } from '@/utils/itunes'

const DRY = process.argv.includes('--dry-run')

async function main() {
  const supabase = createAdminClient()
  const rows: { id: string; apple_music_album_id: string }[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('album')
      .select('id, apple_music_album_id')
      .eq('streaming_status', 'none')
      .not('apple_music_album_id', 'is', null)
      .order('id')
      .range(from, from + 999)
    rows.push(...((data ?? []) as typeof rows))
    if ((data ?? []).length < 1000) break
  }
  const ids = rows.map((r) => r.apple_music_album_id)
  console.log(`対象: ${rows.length}件`)
  const jp = await lookupExistingCollectionIds(ids, 'JP')
  const us = await lookupExistingCollectionIds(
    ids.filter((id) => !jp.has(id)),
    'US'
  )
  const available = rows.filter((r) => jp.has(r.apple_music_album_id) || us.has(r.apple_music_album_id))
  console.log(`配信を確認: 日本 ${jp.size}件 / 米国のみ ${us.size}件 / どちらにも無い ${rows.length - available.length}件`)
  if (DRY) return
  let restored = 0
  for (let i = 0; i < available.length; i += 200) {
    const { error, count } = await supabase
      .from('album')
      .update({ streaming_status: null, apple_music_available: true, streaming_note: null }, { count: 'exact' })
      .in(
        'id',
        available.slice(i, i + 200).map((r) => r.id)
      )
    if (error) console.error(error.message)
    restored += count ?? 0
  }
  console.log(`元に戻した: ${restored}件`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
