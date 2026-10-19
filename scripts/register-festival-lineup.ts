// scripts/register-festival-lineup.ts
/**
 * フェスの出演者リスト(JSON: [{ name, aliases?, stage?, startTime?, appleId? }])を、開催回の出演情報として登録する。
 * register-haziketemazare-lineup.ts と同じ方針:
 *   1. カタログに同名のアーティストがいればそれを使う(同名が複数いるときはアルバムを持つ方)
 *   2. いなければ Apple Music(JP)を検索し、名前が正規化して完全一致する候補が1件だけのときに限り取り込む
 *      (曖昧なものは登録せず、最後に一覧で報告する。誤った別人に紐づけないため)
 * 何度実行しても、登録済みの出演は重複して作らない。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/register-festival-lineup.ts <開催回のid> <出演者JSON> [--dry-run] [--no-itunes]
 *   --no-itunes: カタログに無い人はApple Musicを検索せず「未登録」として報告する(iTunesを他の処理が使っている間に)
 */
import { readFileSync } from 'fs'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchAllRows } from '@/utils/fetchAllRows'
import { searchArtist, fetchArtistWithAlbums } from '@/utils/itunes'
import { upsertArtistFromItunes } from '@/app/admin/import/actions'
import { dispatchAlbumSync } from '@/utils/albumSyncDispatch'

const [EDITION_ID, JSON_PATH] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const DRY_RUN = process.argv.includes('--dry-run')
const NO_ITUNES = process.argv.includes('--no-itunes')

type Pick = { name: string; aliases?: string[]; stage?: string | null; startTime?: string | null; appleId?: number }

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/^the\s+/, '').replace(/[\s'’".,!?・&\-_/()[\]]/g, '')
}

async function main() {
  if (!EDITION_ID || !JSON_PATH) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/register-festival-lineup.ts <開催回のid> <出演者JSON> [--dry-run] [--no-itunes]')
    process.exit(1)
  }
  const picks: Pick[] = JSON.parse(readFileSync(JSON_PATH, 'utf-8'))
  const supabase = createAdminClient()

  const { data: edition } = await supabase.from('event_edition').select('id, year, event:event_id(name)').eq('id', EDITION_ID).maybeSingle()
  if (!edition) throw new Error(`開催回 ${EDITION_ID} が見つかりません。`)
  const eventName = Array.isArray(edition.event) ? edition.event[0]?.name : (edition.event as { name: string } | null)?.name
  console.log(`対象: ${eventName} ${edition.year}(${EDITION_ID}) / 出演者 ${picks.length}組${DRY_RUN ? ' / dry-run' : ''}${NO_ITUNES ? ' / カタログのみ' : ''}\n`)

  const allArtists = await fetchAllRows<{ id: string; name: string }>(supabase, 'artist', 'id, name', 'id')
  const albumOwners = await fetchAllRows<{ artist_id: string | null }>(supabase, 'album', 'artist_id', 'id')
  const hasAlbum = new Set(albumOwners.map((r) => r.artist_id))
  const byName = new Map<string, { id: string; name: string }>()
  for (const a of allArtists ?? []) {
    const k = norm(a.name)
    const cur = byName.get(k)
    if (!cur || (!hasAlbum.has(cur.id) && hasAlbum.has(a.id))) byName.set(k, a)
  }

  const unresolved: string[] = []
  const registered: string[] = []
  const alreadyThere: string[] = []

  for (const pick of picks) {
    const keys = [pick.name, ...(pick.aliases ?? [])].map(norm)
    let artist = keys.map((k) => byName.get(k)).find(Boolean) ?? null
    let via = 'カタログ'

    if (!artist) {
      if (NO_ITUNES) {
        unresolved.push(`${pick.name}(カタログに無い。Apple Musicからの取込は未実施)`)
        continue
      }
      let results: Awaited<ReturnType<typeof searchArtist>> = []
      try {
        results = await searchArtist(pick.name)
      } catch (err) {
        console.error(`  Apple Music検索失敗(${pick.name}):`, (err as Error).message)
      }
      const exactAll = results.filter((r) => keys.includes(norm(r.artistName)))
      const exact = pick.appleId ? exactAll.filter((r) => r.artistId === pick.appleId) : exactAll
      if (exact.length === 1) {
        if (DRY_RUN) {
          console.log(`[取込予定] ${pick.name} → Apple Music「${exact[0].artistName}」(${exact[0].artistId})`)
          registered.push(pick.name)
          continue
        }
        const { artist: itunesArtist, albums } = await fetchArtistWithAlbums(String(exact[0].artistId))
        if (!itunesArtist) {
          unresolved.push(`${pick.name}(Apple Musicの詳細取得に失敗)`)
          continue
        }
        const { artistId, errorMessage } = await upsertArtistFromItunes(supabase, itunesArtist)
        if (!artistId) {
          unresolved.push(`${pick.name}(取込失敗: ${errorMessage})`)
          continue
        }
        artist = { id: artistId, name: itunesArtist.artistName }
        via = 'Apple Musicから取込'
        dispatchAlbumSync(artistId, itunesArtist.artistName, String(itunesArtist.artistId), albums).catch((e) =>
          console.error(`  アルバム取込の起動に失敗(${pick.name}):`, (e as Error).message)
        )
      } else {
        if (exact.length > 1) console.log(`  候補(${pick.name}): ` + exact.map((r) => `${r.artistName}[${r.primaryGenreName ?? '-'}]#${r.artistId}`).join(' | '))
        unresolved.push(`${pick.name}(${exact.length === 0 ? 'Apple Musicに完全一致なし' : `完全一致が${exact.length}件で特定できない`})`)
        continue
      }
    }

    if (DRY_RUN) {
      console.log(`[登録予定] ${pick.name} → ${artist.name}(${artist.id}、${via})`)
      registered.push(pick.name)
      continue
    }

    const { data: existing } = await supabase.from('event_appearance').select('id').eq('event_edition_id', EDITION_ID).eq('artist_id', artist.id).maybeSingle()
    let appearanceId = existing?.id as string | undefined
    if (!appearanceId) {
      const { data: inserted, error } = await supabase
        .from('event_appearance')
        .insert({
          event_edition_id: EDITION_ID,
          artist_id: artist.id,
          stage: pick.stage ?? null,
          venue: null,
          start_time: pick.startTime ?? null,
          end_time: null,
          is_headliner: false,
        })
        .select('id')
        .single()
      if (error || !inserted) {
        unresolved.push(`${pick.name}(出演登録失敗: ${error?.message})`)
        continue
      }
      appearanceId = inserted.id
      registered.push(`${pick.name}(${via})`)
    } else {
      alreadyThere.push(pick.name)
    }
    const { data: link } = await supabase.from('event_appearance_artist').select('id').eq('event_appearance_id', appearanceId!).eq('artist_id', artist.id).maybeSingle()
    if (!link) await supabase.from('event_appearance_artist').insert({ event_appearance_id: appearanceId, artist_id: artist.id, billing_order: 0 })
  }

  console.log(`\n=== 結果${DRY_RUN ? '(dry-run)' : ''} ===`)
  console.log(`登録${DRY_RUN ? '予定' : ''}: ${registered.length}件`, registered.join(' / '))
  if (alreadyThere.length) console.log(`登録済み(飛ばした): ${alreadyThere.length}件`, alreadyThere.join(' / '))
  console.log(`特定できず未登録: ${unresolved.length}件`)
  for (const u of unresolved) console.log(`  - ${u}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
