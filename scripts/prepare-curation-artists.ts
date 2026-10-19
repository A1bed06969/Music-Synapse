// scripts/prepare-curation-artists.ts
/**
 * キュレーション企画(import-future-of-music.ts など)の取り込み前に、CSVのアーティストのうちカタログに無い人を
 * Apple Music(JP)で探して取り込む。名前が正規化して完全一致する候補が1件だけのときに限り取り込み、
 * 曖昧(0件・複数件)なものは取り込まずに最後に一覧で報告する(誤った別人に紐づけないため)。
 * 取り込めなかった人は、企画のインポート時に名前だけのアーティスト(スタブ)になり、あとで手動で照合する。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/prepare-curation-artists.ts <CSVのパス(年度,アーティスト名)> [--dry-run]
 */
import { readFileSync } from 'fs'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchAllRows } from '@/utils/fetchAllRows'
import { searchArtist, fetchArtistWithAlbums } from '@/utils/itunes'
import { upsertArtistFromItunes } from '@/app/admin/import/actions'
import { dispatchAlbumSync } from '@/utils/albumSyncDispatch'

const csvPath = process.argv.slice(2).find((a) => !a.startsWith('--'))
const DRY_RUN = process.argv.includes('--dry-run')

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/^the\s+/, '').replace(/[\s'’".,!?・&\-_/()[\]:]/g, '')
}

async function main() {
  if (!csvPath) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/prepare-curation-artists.ts <CSVのパス> [--dry-run]')
    process.exit(1)
  }
  const names = Array.from(
    new Set(
      readFileSync(csvPath, 'utf-8')
        .trim()
        .split('\n')
        .slice(1)
        .map((l) => l.slice(l.indexOf(',') + 1).replace(/^"|"$/g, '').trim())
        .filter(Boolean)
    )
  )
  const supabase = createAdminClient()
  const all = await fetchAllRows<{ id: string; name: string }>(supabase, 'artist', 'id, name', 'id')
  const inCatalog = new Set(all.map((a) => norm(a.name)))
  const missing = names.filter((n) => !inCatalog.has(norm(n)))
  console.log(`CSV ${names.length}組のうち、カタログに無い ${missing.length}組を Apple Music で探します${DRY_RUN ? '(dry-run)' : ''}\n`)

  const imported: string[] = []
  const unresolved: string[] = []
  for (const name of missing) {
    let results: Awaited<ReturnType<typeof searchArtist>> = []
    try {
      results = await searchArtist(name)
    } catch (err) {
      unresolved.push(`${name}(Apple Music検索失敗: ${(err as Error).message})`)
      continue
    }
    const exact = results.filter((r) => norm(r.artistName) === norm(name))
    if (exact.length !== 1) {
      if (exact.length > 1) console.log(`  候補(${name}): ` + exact.map((r) => `${r.artistName}[${r.primaryGenreName ?? '-'}]#${r.artistId}`).join(' | '))
      unresolved.push(`${name}(${exact.length === 0 ? 'Apple Musicに完全一致なし' : `完全一致が${exact.length}件で特定できない`})`)
      continue
    }
    if (DRY_RUN) {
      console.log(`[取込予定] ${name} → Apple Music「${exact[0].artistName}」[${exact[0].primaryGenreName ?? '-'}](${exact[0].artistId})`)
      imported.push(name)
      continue
    }
    const { artist, albums } = await fetchArtistWithAlbums(String(exact[0].artistId))
    if (!artist) {
      unresolved.push(`${name}(Apple Musicの詳細取得に失敗)`)
      continue
    }
    // 検索結果の名前と、IDで詳細を引いた名前が食い違うことがある(例: 「Xansei」が「Xansei & Leon Fanourakis」を返した)。
    // その場合は別名義の可能性が高いので取り込まない
    if (norm(artist.artistName) !== norm(name)) {
      unresolved.push(`${name}(詳細の名前が「${artist.artistName}」で食い違うため取り込まず)`)
      continue
    }
    const { artistId, errorMessage } = await upsertArtistFromItunes(supabase, artist)
    if (!artistId) {
      unresolved.push(`${name}(取込失敗: ${errorMessage})`)
      continue
    }
    imported.push(`${name}→${artist.artistName}`)
    dispatchAlbumSync(artistId, artist.artistName, String(artist.artistId), albums).catch((e) =>
      console.error(`  アルバム取込の起動に失敗(${name}):`, (e as Error).message)
    )
  }

  console.log(`\n=== 結果${DRY_RUN ? '(dry-run)' : ''} ===`)
  console.log(`取込${DRY_RUN ? '予定' : ''}: ${imported.length}組`, imported.join(' / '))
  console.log(`特定できず未取込: ${unresolved.length}組`)
  for (const u of unresolved) console.log(`  - ${u}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
