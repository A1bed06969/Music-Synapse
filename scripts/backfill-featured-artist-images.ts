// scripts/backfill-featured-artist-images.ts
//
// 曲名の「feat.」から名前だけで登録されたアーティスト(Apple Music未紐付け・画像なし)に、
// アーティスト画像だけを付ける。Apple Music IDの登録・MusicBrainz取込・確認待ちの確定は行わない。
//
// 同名の別人の写真を付けないよう、名前が完全一致するApple Musicのアーティストのうち、
// 元の曲が入ったアルバムを自分のディスコグラフィーに持つ人がちょうど1人の場合だけ採用する
// (候補が1人だけでも必ずアルバムで裏取りする)。Geminiは使わない。
// 画像の取得はApple側に止められないよう慎重に行う(utils/appleMusicImageCareful.ts)。
//
// 一度試して本人を確かめられなかった人は、30日間は試さない(毎日同じ人に問い合わせないため。
// 記録はリポジトリ外の~/Library/Logs/music-synapse/featured-image-attempts.json)。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-featured-artist-images.ts [--limit=1500]
import { existsSync, readFileSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistWithAlbums, searchArtist } from '@/utils/itunes'
import { AppleMusicBlockedError, carefulInterval, fetchArtistImageCarefully } from '@/utils/appleMusicImageCareful'

const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : 1500
const RETRY_AFTER_MS = 30 * 24 * 3600_000
const MAX_CANDIDATES = 3
const ATTEMPTS_PATH = path.join(os.homedir(), 'Library/Logs/music-synapse/featured-image-attempts.json')

type Target = { artistId: string; name: string; trackId: string }

function loadAttempts(): Record<string, number> {
  try {
    return existsSync(ATTEMPTS_PATH) ? JSON.parse(readFileSync(ATTEMPTS_PATH, 'utf-8')) : {}
  } catch {
    return {}
  }
}

const normalize = (s: string) => s.normalize('NFKC').trim().toLowerCase()

/** 名前が完全一致し、かつ元の曲のアルバムをディスコグラフィーに持つApple Musicのアーティストが
 * ちょうど1人ならそのIDを返す。確かめられなければnull */
async function findVerifiedAppleArtist(name: string, sourceAlbumId: string): Promise<string | null> {
  const exact = (await searchArtist(name)).filter((c) => normalize(c.artistName) === normalize(name))
  if (exact.length === 0 || exact.length > MAX_CANDIDATES) return null
  const verified: string[] = []
  for (const c of exact) {
    const { albums } = await fetchArtistWithAlbums(String(c.artistId))
    if (albums.some((a) => String(a.collectionId) === sourceAlbumId)) verified.push(String(c.artistId))
  }
  return verified.length === 1 ? verified[0] : null
}

async function main() {
  const supabase = createAdminClient()
  const attempts = loadAttempts()
  const now = Date.now()

  // 確認待ち(未却下)のfeat.アーティストのうち、Apple Music未紐付け・画像なしの人
  const targets = new Map<string, Target>()
  for (let from = 0; targets.size < LIMIT; from += 1000) {
    const { data, error } = await supabase
      .from('featured_artist_review')
      .select('artist_id, extracted_name, track_id, artist:artist_id!inner(image_url, apple_music_artist_id)')
      .eq('rejected', false)
      .is('artist.image_url', null)
      .is('artist.apple_music_artist_id', null)
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(`対象の取得に失敗しました: ${error.message}`)
    for (const r of data ?? []) {
      if (!r.artist_id || !r.track_id || targets.has(r.artist_id)) continue
      if (attempts[r.artist_id] && now - attempts[r.artist_id] < RETRY_AFTER_MS) continue
      targets.set(r.artist_id, { artistId: r.artist_id, name: r.extracted_name, trackId: r.track_id })
      if (targets.size >= LIMIT) break
    }
    if ((data ?? []).length < 1000) break
  }
  console.log(`${new Date().toISOString()} feat.アーティスト(画像なし)の対象: ${targets.size}人`)

  let filled = 0
  let unverified = 0
  let processed = 0
  try {
    for (const t of targets.values()) {
      processed++
      const { data: track } = await supabase.from('track').select('album:album_id(apple_music_album_id)').eq('id', t.trackId).maybeSingle()
      const album = Array.isArray(track?.album) ? track?.album[0] : track?.album
      const sourceAlbumId = (album as { apple_music_album_id: string | null } | null)?.apple_music_album_id ?? null

      let appleId: string | null = null
      try {
        appleId = sourceAlbumId ? await findVerifiedAppleArtist(t.name, sourceAlbumId) : null
      } catch (err) {
        console.error(`  ${t.name}: 照合に失敗しました: ${(err as Error).message}`)
      }

      const fetched = appleId ? await fetchArtistImageCarefully(appleId) : null
      const imageUrl = fetched === 'none' ? null : fetched
      if (imageUrl) {
        const { error } = await supabase.from('artist').update({ image_url: imageUrl }).eq('id', t.artistId).is('image_url', null)
        if (error) console.error(`  ${t.name}: 保存に失敗しました: ${error.message}`)
        else filled++
        await carefulInterval()
      } else {
        unverified++
        attempts[t.artistId] = now
      }
      if (processed % 100 === 0) {
        console.log(`  ${processed}/${targets.size}(画像を付けた ${filled})`)
        writeFileSync(ATTEMPTS_PATH, JSON.stringify(attempts))
      }
    }
  } catch (err) {
    if (!(err instanceof AppleMusicBlockedError)) throw err
    console.error(`\n${err.message}。今日の処理を止めます(${processed}人目まで)。`)
  } finally {
    writeFileSync(ATTEMPTS_PATH, JSON.stringify(attempts))
  }
  console.log(`完了: 画像を付けた ${filled}人 / 本人を確かめられず見送った ${unverified}人`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
