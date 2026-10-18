// scripts/fix-edition-primary-unavailable.ts
/**
 * 版違いグループの代表版(primary)が「配信なし」なのに、同じグループに配信中の版がある
 * ものを、配信中の版を代表に入れ替える。
 *
 * 代表版はグループ化した時点のリリース日だけで決まり、その後の同期で代表版が
 * 配信停止扱い(apple_music_available=false / streaming_status が none・unreleased)に
 * なっても入れ替わらないため、「配信されているのに未配信」と表示され、配信中の版が
 * 「他のバージョン」に回ってしまう。
 *
 * 新しい代表版 = グループ内の配信中の版のうちリリース日が最も早いもの(同日ならid順)。
 * 旧代表版と既存の子はすべて新しい代表版の子にする(多段チェーンを作らない)。
 * 旧代表版に付いていたディスクガイド掲載・キュレーション選出・ラジオのオンエアは、
 * アルバムページがそのページ自身のIDで探すため、新しい代表版へ付け替える。
 * edition_group_manual_override=true(手動で決めたグループ)は触らない。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/fix-edition-primary-unavailable.ts [--dry-run]
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { moveAlbumReferences } from '@/utils/moveAlbumReferences'

type Row = {
  id: string
  title: string
  release_date: string | null
  streaming_status: string | null
  apple_music_available: boolean | null
  primary_album_id: string | null
  edition_group_manual_override: boolean
}

const isAvailable = (r: Row) => r.apple_music_available === true && !['none', 'unreleased'].includes(r.streaming_status ?? '')

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const supabase = createAdminClient()

  const rows: Row[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('album')
      .select('id, title, release_date, streaming_status, apple_music_available, primary_album_id, edition_group_manual_override')
      .order('id')
      .range(offset, offset + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }

  const byId = new Map(rows.map((r) => [r.id, r]))
  const children = new Map<string, Row[]>()
  for (const r of rows) {
    if (!r.primary_album_id) continue
    const list = children.get(r.primary_album_id) ?? []
    list.push(r)
    children.set(r.primary_album_id, list)
  }

  let fixed = 0
  for (const [primaryId, editions] of children) {
    const primary = byId.get(primaryId)
    if (!primary || primary.edition_group_manual_override || primary.primary_album_id) continue
    if (isAvailable(primary)) continue
    const candidates = editions.filter((e) => isAvailable(e) && !e.edition_group_manual_override)
    if (candidates.length === 0) continue

    candidates.sort((a, b) => (a.release_date ?? '9999-99-99').localeCompare(b.release_date ?? '9999-99-99') || a.id.localeCompare(b.id))
    const next = candidates[0]
    const others = [primary, ...editions.filter((e) => e.id !== next.id)]
    console.log(`${primary.title}: 代表版 ${primary.id}(${primary.streaming_status}) → ${next.id}、子 ${others.length}件を付け替え`)
    if (dryRun) continue

    const { error: e1 } = await supabase.from('album').update({ primary_album_id: null }).eq('id', next.id)
    if (e1) throw new Error(`${next.id}: ${e1.message}`)
    const { error: e2 } = await supabase
      .from('album')
      .update({ primary_album_id: next.id })
      .in('id', others.map((o) => o.id))
    if (e2) throw new Error(`${next.id}の子の付け替えに失敗: ${e2.message}`)
    const refs = await moveAlbumReferences(supabase, primary.id, next.id)
    console.log(`  掲載・選出の付け替え ${refs.moved}件、重複で削除 ${refs.duplicatesRemoved}件`)
    fixed++
  }
  console.log(`\n${dryRun ? '(dry-run)' : '完了'}: ${fixed}グループを入れ替えました。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
