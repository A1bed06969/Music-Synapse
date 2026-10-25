// scripts/trial-isrc-musicbrainz.ts
/**
 * ISRCをMusicBrainzから集める試験(何も書き込まない)。
 * 無作為に選んだアルバムについて、MusicBrainzのリリースをタイトル完全一致で探し、そのリリースの録音(ISRCと、曲ごとのアーティスト表記つき)を取って、
 * うちの曲とタイトルで突き合わせる。「リリースが見つかった割合」「曲に対してISRCが取れた割合」「featuringのアーティストが構造化されて取れた割合」を数える。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/trial-isrc-musicbrainz.ts [--albums=100]
 */
import { writeFileSync } from 'fs'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchRelease } from '@/utils/musicbrainz'

const N = Number(process.argv.find((a) => a.startsWith('--albums='))?.split('=')[1] ?? 100)
const UA = 'music-synapse/1.0 (a1bed069star@gmail.com)'
const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
let last = 0
async function mb(path: string): Promise<any> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = last + 1200 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, { headers: { 'User-Agent': UA } })
    if (res.ok) return res.json()
    if (res.status === 503 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 10000 * attempt))
      continue
    }
    throw new Error(`MusicBrainz ${res.status}`)
  }
  throw new Error('MusicBrainz: retries exhausted')
}

async function main() {
  const supabase = createAdminClient()
  // 無作為のアルバム(曲が6曲以上、1990年以降)。orderでrandomは使えないので、日付の範囲を無作為に選んで取る
  const picked: { id: string; title: string; artistName: string }[] = []
  const seen = new Set<string>()
  while (picked.length < N) {
    const offset = Math.floor(Math.random() * 400000)
    const { data } = await supabase
      .from('album')
      .select('id, title, artist:artist_id(name)')
      .not('apple_music_album_id', 'is', null)
      .is('primary_album_id', null)
      .gte('release_date', '1990-01-01')
      .range(offset, offset + 4)
    for (const a of data ?? []) {
      const artist = Array.isArray(a.artist) ? a.artist[0] : a.artist
      if (!artist || seen.has(a.id)) continue
      seen.add(a.id)
      picked.push({ id: a.id, title: a.title, artistName: artist.name })
      if (picked.length >= N) break
    }
  }

  const tally = { albums: 0, releaseFound: 0, tracks: 0, matchedTracks: 0, withIsrc: 0, withFeat: 0 }
  const rows: unknown[] = []
  for (const a of picked) {
    tally.albums++
    const { data: tracks } = await supabase.from('track').select('id, title').eq('album_id', a.id)
    if (!tracks?.length) continue
    tally.tracks += tracks.length
    let results
    try {
      results = await searchRelease(a.title, a.artistName)
    } catch {
      continue
    }
    const exact = results.find((r) => norm(r.title) === norm(a.title))
    if (!exact) {
      rows.push({ album: a.title, artist: a.artistName, release: null })
      continue
    }
    tally.releaseFound++
    const rec = await mb(`recording?release=${exact.mbid}&inc=isrcs+artist-credits&fmt=json&limit=100`)
    const byTitle = new Map<string, any>()
    for (const r of rec.recordings ?? []) byTitle.set(norm(r.title), r)
    let matched = 0
    let isrc = 0
    let feat = 0
    for (const t of tracks) {
      const r = byTitle.get(norm(t.title))
      if (!r) continue
      matched++
      if (r.isrcs?.length) isrc++
      if ((r['artist-credit'] ?? []).filter((c: any) => c.artist?.id).length > 1) feat++
    }
    tally.matchedTracks += matched
    tally.withIsrc += isrc
    tally.withFeat += feat
    rows.push({ album: a.title, artist: a.artistName, release: exact.mbid, tracks: tracks.length, matched, isrc, feat })
    if (tally.albums % 10 === 0) console.log(JSON.stringify(tally))
  }
  writeFileSync('/private/tmp/isrc-trial.json', JSON.stringify({ tally, rows }, null, 1))
  console.log('=== 結果 ===', JSON.stringify(tally))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
