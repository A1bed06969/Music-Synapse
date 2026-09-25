// キュレーション企画インポート時にiTunes APIのレート制限(403)でスタブ化して
// しまった分の再試行用、一回限りの使い捨てスクリプト。import-*.tsの
// resolveArtistIdと同じ照合ルール(名前完全一致が1件だけの場合のみ採用)を踏襲する。
// 実行: npx tsx --env-file=.env.local scripts/tmp-retry-stub-artists.mts "<ranking name>"
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchArtist } from '@/utils/itunes'
import { upsertArtistFromItunes } from '@/app/admin/import/actions'

function normalizeArtistName(name: string): string {
  return name.trim().toLowerCase().normalize('NFKC').replace(/\s+/g, ' ')
}

async function main() {
  const rankingName = process.argv[2]
  if (!rankingName) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/tmp-retry-stub-artists.mts "<ranking name>"')
    process.exit(1)
  }

  const supabase = createAdminClient()

  const { data: rows } = await supabase
    .from('ranking_entry')
    .select('artist_id, artist:artist_id!inner(id, name, apple_music_artist_id), ranking:ranking_id!inner(name)')
    .eq('ranking.name', rankingName)
    .is('artist.apple_music_artist_id', null)

  const stubs = (rows ?? [])
    .map((r) => (Array.isArray(r.artist) ? r.artist[0] : r.artist))
    .filter((a) => !!a) as { id: string; name: string }[]

  console.log(`対象スタブ(${rankingName}): ${stubs.length}件`)

  let matched = 0
  let stillStub = 0
  let errors = 0

  for (const artist of stubs) {
    try {
      const candidates = await searchArtist(artist.name)
      const exactMatches = candidates.filter((c) => normalizeArtistName(c.artistName) === normalizeArtistName(artist.name))

      if (exactMatches.length === 1) {
        const { artistId, errorMessage } = await upsertArtistFromItunes(supabase, {
          wrapperType: 'artist',
          artistId: exactMatches[0].artistId,
          artistName: exactMatches[0].artistName,
          artistLinkUrl: exactMatches[0].artistLinkUrl,
          primaryGenreName: exactMatches[0].primaryGenreName,
        })
        if (artistId && artistId !== artist.id) {
          await supabase.from('ranking_entry').update({ artist_id: artistId }).eq('artist_id', artist.id)
          await supabase.from('artist').delete().eq('id', artist.id)
          matched++
          console.log(`✅ ${artist.name} → 統合`)
        } else if (artistId === artist.id || (!errorMessage && artistId)) {
          matched++
          console.log(`✅ ${artist.name}`)
        } else {
          stillStub++
          console.log(`⚠️ ${artist.name}: ${errorMessage}`)
        }
      } else {
        stillStub++
      }
    } catch (err) {
      errors++
      console.error(`❌ ${artist.name}: ${(err as Error).message}`)
    }
  }

  console.log(`\n完了: 一致${matched}件、依然スタブ${stillStub}件、エラー${errors}件`)
}

main()
