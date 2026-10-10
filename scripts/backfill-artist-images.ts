// scripts/backfill-artist-images.ts
//
// Apple Musicに紐付いているのに画像が無いアーティストへ、Apple Musicのアーティストページの
// サムネイル画像(og:image)を付ける。毎日のカタログ更新で新しく登録される共演者等は、
// 本人の更新の番(60日周期)まで画像が付かないため、画像だけを別に埋める。
// Geminiは使わない。Apple Musicのページは非公式な取得方法のため、Apple側に止められないよう
// 慎重に取得する: 1件ごとに2〜3秒(揺らぎ付き)空け、拒否・制限の応答(429/403)が1回でも
// 返ったら、または画像が取れない状態が続いたら、その日の処理をすぐ止める。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-artist-images.ts [--limit=3000]
import { existsSync, readFileSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { createAdminClient } from '@/utils/Supabase/admin'
import { AppleMusicBlockedError, carefulInterval, fetchArtistImageCarefully } from '@/utils/appleMusicImageCareful'

const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : 3000
const MAX_CONSECUTIVE_MISSES = 15
// Apple Musicに写真もジャケットも無い人(汎用ロゴ)は、30日間は問い合わせ直さない
const RETRY_AFTER_MS = 30 * 24 * 3600_000
const NO_IMAGE_PATH = path.join(os.homedir(), 'Library/Logs/music-synapse/artist-images-none.json')

function loadNoImage(): Record<string, number> {
  try {
    return existsSync(NO_IMAGE_PATH) ? JSON.parse(readFileSync(NO_IMAGE_PATH, 'utf-8')) : {}
  } catch {
    return {}
  }
}

type Row = { id: string; name: string; apple_music_artist_id: string; apple_music_country: string | null }

async function main() {
  const supabase = createAdminClient()
  const noImage = loadNoImage()
  const now = Date.now()

  // 新しく登録された人から順に処理する(サイトに出たばかりの人ほど画像が無いと目立つため)
  const rows: Row[] = []
  for (let from = 0; rows.length < LIMIT; from += 1000) {
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, apple_music_artist_id, apple_music_country')
      .is('image_url', null)
      .not('apple_music_artist_id', 'is', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(`対象の取得に失敗しました: ${error.message}`)
    rows.push(...((data ?? []) as Row[]).filter((r) => !(noImage[r.id] && now - noImage[r.id] < RETRY_AFTER_MS)))
    if ((data ?? []).length < 1000) break
  }
  const targets = rows.slice(0, LIMIT)
  console.log(`${new Date().toISOString()} 画像なし(Apple Music紐付けあり)の対象: ${targets.length}人`)

  let filled = 0
  let notFound = 0
  let consecutiveMisses = 0
  for (const [i, a] of targets.entries()) {
    let url: string | 'none' | null = null
    try {
      url = await fetchArtistImageCarefully(a.apple_music_artist_id, a.apple_music_country ?? 'JP')
    } catch (err) {
      if (err instanceof AppleMusicBlockedError) {
        console.error(`\n${err.message}。今日の処理を止めます(${i}人目まで)。`)
        break
      }
      console.error(`  ${a.name}: ${(err as Error).message}`)
    }
    if (url === 'none') {
      // ページはあるが写真もジャケットも無い(汎用ロゴ)。取得失敗ではないので連続失敗には数えない
      noImage[a.id] = now
      notFound++
      consecutiveMisses = 0
    } else if (url) {
      const { error } = await supabase.from('artist').update({ image_url: url }).eq('id', a.id).is('image_url', null)
      if (error) console.error(`  ${a.name}: 保存に失敗しました: ${error.message}`)
      else filled++
      consecutiveMisses = 0
    } else {
      notFound++
      consecutiveMisses++
      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
        console.error(`\n画像が${MAX_CONSECUTIVE_MISSES}件続けて取れませんでした(制限の可能性)。今日の処理を止めます。`)
        break
      }
    }
    if ((i + 1) % 200 === 0) {
      console.log(`  ${i + 1}/${targets.length}(付与 ${filled})`)
      writeFileSync(NO_IMAGE_PATH, JSON.stringify(noImage))
    }
    await carefulInterval()
  }
  writeFileSync(NO_IMAGE_PATH, JSON.stringify(noImage))
  console.log(`完了: 画像を付けた ${filled}人 / 画像なし・取得できなかった ${notFound}人`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
