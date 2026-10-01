// scripts/dedupe-artists-by-apple-id.ts
//
// scripts/dedupe-artists.ts(名前完全一致でのグループ化)では捕捉できない、
// 「同じapple_music_artist_idなのに表記ゆれ(大文字小文字・トリム差)だけ違う
// artist行が複数存在する」重複を検出・統合する。2026-09-30、imaseの重複調査の
// 過程で発覚(Geminiの確信度不足フォールバックとは無関係の、単純な既存行検索の
// 大文字小文字不一致によるスタブ再作成が原因)。
//
// コラボクレジット("Artist A, B & C"のような複数名義)はapple_music_artist_idが
// 同じでも意図的な別レコードなので、名前に","/"&"/"feat."/"with "/"×"を含む行は
// 対象から除外する。2026-10-01修正: 当初は「バケツ内に1件でもコラボ名義が
// 混ざっていたらバケツ全体を除外」としていたが、これだと本物のコラボ名義
// ("Foi, X & Y"等)と同じapple_music_artist_idバケツに、無関係な事故的重複
// ("Foi"が7回、のような同一名の量産)が同居しているケースを見逃してしまう
// (imase再発調査で発覚。app/admin/import/actions.tsの.maybeSingle()エラー
// 握りつぶしバグにより、過去1週間で166組もの見逃しが蓄積していた)。
// 正しくは「コラボ名義の行を除いた残りを、正規化名でサブグループ化し、
// 2件以上あるサブグループだけを対象にする」。
//
// 統合先(keeper)はtrack数最大(同数ならalbum数、さらに同数ならcreated_at最古)の
// 行を選ぶ。実際の統合処理はapp/admin/data/artists/duplicate-review/actions.tsの
// mergeArtists(既存の重複統合ツール、imase統合でも使用)を再利用する。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/dedupe-artists-by-apple-id.ts
import { createAdminClient } from '@/utils/Supabase/admin'
import { mergeArtists } from '@/app/admin/data/artists/duplicate-review/actions'

type AdminClient = ReturnType<typeof createAdminClient>
type ArtistRow = { id: string; name: string; apple_music_artist_id: string | null; created_at: string }

async function fetchAllArtistsWithAppleId(supabase: AdminClient): Promise<ArtistRow[]> {
  const rows: ArtistRow[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, apple_music_artist_id, created_at')
      .not('apple_music_artist_id', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`fetchAllArtistsWithAppleId: ${error.message}`)
    const page = (data ?? []) as ArtistRow[]
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

const isCollabish = (name: string) => /[,&]|feat\.|with |×/i.test(name)
const normalize = (name: string) => name.trim().toLowerCase()

async function fetchCatalogCounts(supabase: AdminClient, artistIds: string[]) {
  const albumCountByArtist = new Map<string, number>()
  const trackCountByArtist = new Map<string, number>()
  for (let i = 0; i < artistIds.length; i += 150) {
    const batch = artistIds.slice(i, i + 150)
    const { data: albums, error: albumError } = await supabase.from('album').select('artist_id').in('artist_id', batch)
    if (albumError) throw new Error(`fetchCatalogCounts album: ${albumError.message}`)
    for (const a of albums ?? []) albumCountByArtist.set(a.artist_id, (albumCountByArtist.get(a.artist_id) ?? 0) + 1)
    const { data: tracks, error: trackError } = await supabase.from('track').select('artist_id').in('artist_id', batch)
    if (trackError) throw new Error(`fetchCatalogCounts track: ${trackError.message}`)
    for (const t of tracks ?? []) trackCountByArtist.set(t.artist_id, (trackCountByArtist.get(t.artist_id) ?? 0) + 1)
  }
  return { albumCountByArtist, trackCountByArtist }
}

async function main() {
  const supabase = createAdminClient()

  console.log('apple_music_artist_id付きアーティストを集計中...')
  const allArtists = await fetchAllArtistsWithAppleId(supabase)
  console.log(`  ${allArtists.length}件`)

  const byAppleId = new Map<string, ArtistRow[]>()
  for (const r of allArtists) {
    const key = r.apple_music_artist_id!
    byAppleId.set(key, [...(byAppleId.get(key) ?? []), r])
  }

  const groups: ArtistRow[][] = []
  for (const rows of byAppleId.values()) {
    const nonCollabRows = rows.filter((r) => !isCollabish(r.name))
    const byNormalizedName = new Map<string, ArtistRow[]>()
    for (const r of nonCollabRows) {
      const key = normalize(r.name)
      byNormalizedName.set(key, [...(byNormalizedName.get(key) ?? []), r])
    }
    for (const sameNameRows of byNormalizedName.values()) {
      if (sameNameRows.length >= 2) groups.push(sameNameRows)
    }
  }
  console.log(`対象グループ: ${groups.length}件\n`)

  const allIds = groups.flatMap((rows) => rows.map((r) => r.id))
  const { albumCountByArtist, trackCountByArtist } = await fetchCatalogCounts(supabase, allIds)

  let merged = 0
  let failed = 0
  let touchedKeepers: string[] = []

  for (const [index, rows] of groups.entries()) {
    const sorted = [...rows].sort((a, b) => {
      const trackDiff = (trackCountByArtist.get(b.id) ?? 0) - (trackCountByArtist.get(a.id) ?? 0)
      if (trackDiff !== 0) return trackDiff
      const albumDiff = (albumCountByArtist.get(b.id) ?? 0) - (albumCountByArtist.get(a.id) ?? 0)
      if (albumDiff !== 0) return albumDiff
      return a.created_at.localeCompare(b.created_at)
    })
    const keeper = sorted[0]
    const losers = sorted.slice(1)
    console.log(
      `[${index + 1}/${groups.length}] "${keeper.name}"(apple_id=${keeper.apple_music_artist_id}): keeper=${keeper.id} <- loser${losers.length > 1 ? 's' : ''}=${losers.map((l) => l.id).join(',')}`
    )
    const result = await mergeArtists(keeper.id, losers.map((l) => l.id))
    if (result.success) {
      merged += losers.length
      touchedKeepers.push(keeper.id)
    } else {
      failed += 1
      console.log(`  ❌ 統合失敗: ${result.message}`)
    }
  }

  console.log('\n=== 統合完了 ===')
  console.log(`統合したグループ: ${groups.length - failed}件 / 失敗: ${failed}件`)
  console.log(`削除された重複行: ${merged}件`)

  // imase統合時に発覚した「自己参照的なfeaturedクレジット」の後始末
  // (統合前に重複スタブが本体自身のアルバムへfeaturedとして紐付いていた場合、
  // mergeArtistsのJUNCTION_TABLES処理で本体→本体の自己参照album_artist行に
  // なりうる)。統合先(keeper)ごとに本体自身のアルバムへの自己参照を削除する。
  console.log('\n自己参照的なalbum_artistクレジットを確認中...')
  let selfCreditsDeleted = 0
  const uniqueKeepers = Array.from(new Set(touchedKeepers))
  for (let i = 0; i < uniqueKeepers.length; i += 150) {
    const batch = uniqueKeepers.slice(i, i + 150)
    const { data: albums, error: albumError } = await supabase.from('album').select('id, artist_id').in('artist_id', batch)
    if (albumError) throw new Error(`self-credit cleanup album: ${albumError.message}`)
    const albumIdsByArtist = new Map<string, string[]>()
    for (const a of albums ?? []) albumIdsByArtist.set(a.artist_id, [...(albumIdsByArtist.get(a.artist_id) ?? []), a.id])
    for (const artistId of batch) {
      const albumIds = albumIdsByArtist.get(artistId) ?? []
      if (albumIds.length === 0) continue
      const { error, count } = await supabase
        .from('album_artist')
        .delete({ count: 'exact' })
        .eq('artist_id', artistId)
        .in('album_id', albumIds)
      if (error) {
        console.log(`  ⚠️ ${artistId}の自己参照削除に失敗: ${error.message}`)
        continue
      }
      selfCreditsDeleted += count ?? 0
    }
  }
  console.log(`削除した自己参照album_artist行: ${selfCreditsDeleted}件`)
}

main()
