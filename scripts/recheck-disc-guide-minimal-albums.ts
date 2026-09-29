// scripts/recheck-disc-guide-minimal-albums.ts
//
// ディスクガイド経由で「最小限登録」(streaming_status='unreleased'、ジャケット・
// トラック無し)のまま残っているアルバムを再チェックする。配信解禁やDiscogsへの
// 新規出品で、以前は見つからなかったものが後から見つかることがあるため、
// いつでも再実行できるようにした保守用スクリプト。
//
// 1. iTunesを再検索(findAppleMusicAlbumMatch、タイトル完全一致のみ採用)。
//    見つかれば実データで登録し直す(app/api/admin/disc-guide-scan/
//    upgrade-minimal-album/route.ts、既存)
// 2. iTunesで見つからず、まだジャケットが無い場合はDiscogsを再検索
//    (findDiscogsReleaseMatch、タイトル完全一致のみ採用)。見つかれば
//    ジャケット・発売日・トラックリストを適用する(apply-discogs route、既存)
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/recheck-disc-guide-minimal-albums.ts [--disc-guide-id=MS_DGD_xxx] [--limit=N]
import { createAdminClient } from '@/utils/Supabase/admin'
import { findDiscogsReleaseMatch } from '@/utils/discogs'

const BASE_URL = 'http://localhost:3000'
const authHeader = 'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')

const discGuideIdArg = process.argv.find((a) => a.startsWith('--disc-guide-id='))
const DISC_GUIDE_ID = discGuideIdArg ? discGuideIdArg.split('=')[1] : undefined
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity

async function upgradeViaItunes(discGuideSelectionId: string) {
  const res = await fetch(`${BASE_URL}/api/admin/disc-guide-scan/upgrade-minimal-album`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({ discGuideSelectionId }),
  })
  return (await res.json()) as { success: boolean; upgraded?: boolean; message?: string }
}

async function applyDiscogs(albumId: string, discogsReleaseId: number) {
  const res = await fetch(`${BASE_URL}/api/admin/disc-guide-scan/apply-discogs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({ albumId, discogsReleaseId }),
  })
  return (await res.json()) as { success: boolean; applied?: boolean; message?: string }
}

async function main() {
  const supabase = createAdminClient()

  let query = supabase
    .from('disc_guide_selection')
    .select('id, album:album_id(id, title, artist_id, streaming_status, jacket_url, artist:artist_id(name))')
  if (DISC_GUIDE_ID) query = query.eq('disc_guide_id', DISC_GUIDE_ID)
  const { data: sels } = await query

  const targets = (sels ?? []).filter((s) => {
    const album = Array.isArray(s.album) ? s.album[0] : s.album
    return album?.streaming_status === 'unreleased'
  })
  console.log(`対象(最小限登録): ${targets.length}件\n`)

  let itunesUpgraded = 0
  let discogsApplied = 0
  let stillMinimal = 0
  let processed = 0

  for (const sel of targets) {
    if (processed >= LIMIT) break
    processed++
    const album = Array.isArray(sel.album) ? sel.album[0] : sel.album
    const artistName = (album?.artist as { name?: string } | undefined)?.name
    if (!album || !artistName) continue

    const itunesResult = await upgradeViaItunes(sel.id)
    if (itunesResult.upgraded) {
      itunesUpgraded++
      console.log(`[${processed}/${targets.length}] ✓ iTunesで実データに更新 ${artistName} / ${album.title}`)
      continue
    }

    if (album.jacket_url) {
      // Discogsは既に一度適用済み(ジャケットあり)ならスキップ
      stillMinimal++
      continue
    }

    const discogsMatch = await findDiscogsReleaseMatch(artistName, album.title)
    if (!discogsMatch) {
      stillMinimal++
      continue
    }
    const applyResult = await applyDiscogs(album.id, discogsMatch.discogsId)
    if (applyResult.applied) {
      discogsApplied++
      console.log(`[${processed}/${targets.length}] ✓ Discogsで肉付け ${artistName} / ${album.title}`)
    } else {
      stillMinimal++
    }
  }

  console.log('\n=== 完了 ===')
  console.log(`iTunesで実データに更新: ${itunesUpgraded}件`)
  console.log(`Discogsでジャケット等を新規取得: ${discogsApplied}件`)
  console.log(`今回も見つからず: ${stillMinimal}件`)
}

main()
