// scripts/import-radar-early-noise.ts
//
// Spotify「RADAR: Early Noise」(2017年開始、2020年に世界共通企画「RADAR」と
// 統合)の年別選出アーティストを、キュレーションコンテンツ(ranking/ranking_entry)
// として一括登録する。データはja.wikipedia.org/wiki/Early_Noiseおよび各年の
// Spotify Japan公式発表記事(spotifynewsroom.jp)で年ごとにクロスチェック済み。
//
// アーティスト名だけでのApple Music検索は同名・類似名の別人がヒットしうるため
// (utils/itunes.tsのsearchArtistコメント参照)、「候補が1件だけ、かつ正規化後の
// 名前が完全一致」の場合のみ自動的にリンクする。それ以外(候補0件・複数件・
// 名前不一致)は誤登録より安全側に倒し、Apple Music情報無しの最小限スタブ
// (名前のみ)として登録する(タワレコメン等のアルバムスタブと同じ考え方)。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/import-radar-early-noise.ts
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchArtist } from '@/utils/itunes'
import { upsertArtistFromItunes } from '@/app/admin/import/actions'

const RANKING_NAME = 'RADAR: Early Noise'

// 年ごとの選出アーティスト(発表順)。2017年は制度開始1年目のため後年より
// 選出数が多い(13〜17組)。2019年以降は毎年10組に定着している。
const ROSTER: Record<string, string[]> = {
  '2017': [
    'ビッケブランカ', 'RIRI', 'DYGL', 'The Hotpantz', 'ロザリーナ', 'NOT WONK',
    'あいみょん', 'CHICO CALITO', 'BANANALEMON', '横山リサ', 'Jess Connely',
    'yahyel', '向井太一', 'STUTS',
  ],
  '2018': [
    'CHAI', 'SPiCYSOL', 'evening cinema', 'Awich', 'Scarf & the SuspenderS',
    'あっこゴリラ', 'ものんくる', 'SUNNY CAR WASH', 'SUSHIBOYS', 'カネコアヤノ',
    'odol', 'PAELLAS', '羊文学', 'Official髭男dism', 'フレンズ', '小袋成彬', 'FAKY',
  ],
  '2019': [
    'EMMA WAHLIN', 'Ghost like girlfriend', 'Mega Shinnosuke', '中村佳穂', 'Yo-Sea',
    'ずっと真夜中でいいのに。', 'King Gnu', '秋山黄色', 'SASUKE', 'kitri',
  ],
  '2020': [
    '神山羊', 'Karin.', 'ゲシュタルト乙女', 'Daichi Yamamoto', 'Novelbright',
    'Vaundy', '藤井風', 'Friday Night Plans', 'Maica_n', 'Rina Sawayama',
  ],
  '2021': [
    '映秀。', 'カメレオン・ライム・ウーピーパイ', '(sic)boy', 'Doul', 'chilldspot',
    'Tokimeki Records', 'にしな', 'PEOPLE 1', 'macico', 'LEX',
  ],
  '2022': [
    'ao', '秋山璃月', 'ego apartment', 'CVLTE', '菅原圭', 'tonun', 'Bialystocks',
    'Bleecker Chrome', 'Penthouse', 'WurtS',
  ],
  '2023': [
    'Skaai', 'DURDN', 'Tele', 'TOMOO', 'なとり', '春ねむり', 'Furui Riho',
    'ヤングスキニー', 'LANA', 'れん',
  ],
  '2024': [
    'MFS', '音田雅則', 'サバシスター', 'JUMADIBA', 'jo0ji',
    'CHO CO PA CO CHO CO QUIN QUIN', 'tuki.', '十明', 'First Love is Never Returned', '離婚伝説',
  ],
  '2025': [
    'AKASAKI', 'ziproom', '7co', '乃紫', 'PAS TASTA', 'Billyrrom', 'ブランデー戦記',
    'Lavt', 'reina', 'レトロリロン',
  ],
  '2026': [
    'OSHIKIKEIGO', 'OddRe:', 'kurayamisaka', 'ハク。', 'Maverick Mom', '名誉伝説',
    'LAUSBUB', 'luv', 'Litty', 'Rol3ert',
  ],
}

function normalizeArtistName(name: string): string {
  return name.trim().toLowerCase().normalize('NFKC').replace(/\s+/g, ' ')
}

async function resolveArtistId(supabase: ReturnType<typeof createAdminClient>, name: string): Promise<{ id: string; matched: boolean }> {
  let candidates: Awaited<ReturnType<typeof searchArtist>>
  try {
    candidates = await searchArtist(name)
  } catch (err) {
    console.error(`    検索失敗(${name}): ${(err as Error).message}`)
    candidates = []
  }

  const exactMatches = candidates.filter((c) => normalizeArtistName(c.artistName) === normalizeArtistName(name))

  if (exactMatches.length === 1) {
    const { artistId, errorMessage } = await upsertArtistFromItunes(supabase, {
      wrapperType: 'artist',
      artistId: exactMatches[0].artistId,
      artistName: exactMatches[0].artistName,
      artistLinkUrl: exactMatches[0].artistLinkUrl,
    })
    if (artistId) return { id: artistId, matched: true }
    console.error(`    登録失敗(${name}): ${errorMessage}`)
  }

  // 候補0件・複数件・名前不一致の場合は誤登録を避け、名前のみの最小限スタブにする
  const { data: existingStub } = await supabase.from('artist').select('id').eq('name', name).is('apple_music_artist_id', null).maybeSingle()
  if (existingStub) return { id: existingStub.id, matched: false }

  const { data: inserted, error } = await supabase.from('artist').insert({ name }).select('id').single()
  if (error || !inserted) {
    throw new Error(`スタブ作成失敗(${name}): ${error?.message}`)
  }
  return { id: inserted.id, matched: false }
}

async function main() {
  const supabase = createAdminClient()

  const { data: existingRanking } = await supabase.from('ranking').select('id').eq('name', RANKING_NAME).maybeSingle()
  let rankingId: string
  if (existingRanking) {
    rankingId = existingRanking.id
  } else {
    const { data: created, error } = await supabase
      .from('ranking')
      .insert({
        name: RANKING_NAME,
        source: 'Spotify',
        list_type: 'selection',
        description: 'Spotifyがその年に躍進を期待する国内の新人・次世代アーティストを毎年10組前後選出する企画。2017年に「Early Noise」として開始し、2020年に世界共通企画「RADAR」と統合。',
      })
      .select('id')
      .single()
    if (error || !created) {
      console.error('企画の作成に失敗しました:', error?.message)
      process.exit(1)
    }
    rankingId = created.id
    console.log(`企画「${RANKING_NAME}」を作成しました(${rankingId})\n`)
  }

  let created = 0
  let skippedExisting = 0
  let matchedCount = 0
  let stubCount = 0

  for (const [year, names] of Object.entries(ROSTER)) {
    const periodDate = `${year}-01-01`
    console.log(`\n=== ${year}年(${names.length}組) ===`)

    for (const name of names) {
      const { id: artistId, matched } = await resolveArtistId(supabase, name)

      // 再実行時に同じアーティスト・同じ年のエントリを重複登録しないための確認
      const { data: dupCheck } = await supabase
        .from('ranking_entry')
        .select('id')
        .eq('ranking_id', rankingId)
        .eq('period_date', periodDate)
        .eq('artist_id', artistId)
        .maybeSingle()
      if (dupCheck) {
        console.log(`  [既存] ${name}`)
        skippedExisting++
        continue
      }

      const { error: entryError } = await supabase.from('ranking_entry').insert({
        ranking_id: rankingId,
        period_date: periodDate,
        artist_id: artistId,
      })
      if (entryError) {
        console.error(`  [失敗] ${name}: ${entryError.message}`)
        continue
      }

      console.log(`  [${matched ? '一致' : 'スタブ'}] ${name}`)
      created++
      if (matched) matchedCount++
      else stubCount++
    }
  }

  console.log(`\n完了: 新規${created}件(Apple Music一致${matchedCount}件・スタブ${stubCount}件)、既存${skippedExisting}件スキップ。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
