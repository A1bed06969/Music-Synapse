// scripts/backfill-track-youtube-mv.ts
//
// トラックのtrack.youtube_video_id(公式MV)を、YouTubeから自動特定してバックフィルする。
//
// 「1曲ごとに検索」はYouTube Data API v3のsearch.listが1回100ユニット(無料枠は1日
// 10,000ユニット=100回分)と高コストなため採用しない。代わりに「1アーティストごとに
// 公式チャンネルを特定し、そのチャンネルの全アップロード動画タイトルを取得して
// ローカルで照合する」方式にする。search.listはアーティスト単位で1回(100ユニット)
// だけ消費し、以降のチャンネル詳細取得・動画一覧取得は合計でも数ユニットしかかからない
// ため、1アーティストに何曲あっても実質1人分のコストで済む
// (2026-09-11のbrainstormingで確定。DB全体で847,718トラックが未設定・6,887アーティスト
// いるため、全トラック個別検索は無料枠で8,000日以上かかる計算だったが、アーティスト単位
// なら1日100人分=約70日で全アーティストを一巡できる)。
//
// 処理フロー(アーティスト単位、未設定トラックが1件以上あるアーティストを対象):
//   1. search.list(type=channel)でアーティスト名から候補チャンネルを検索(100ユニット)。
//      「(アーティスト名) - Topic」という YouTube自動生成チャンネル(音源のみ、本人運営
//      ではない)は候補から除外する
//   2. channels.listで候補の登録者数・アップロード一覧プレイリストIDを取得(1ユニット)
//   3. Geminiに候補一覧を渡し、「本人の公式チャンネルか」を判定させる。確信度が
//      CHANNEL_CONFIDENCE_THRESHOLD未満、または候補が0件ならそのアーティストは
//      スキップ(channel_ambiguous/no_channelとしてログし、次回実行時は再検索しない)
//   4. 確定したチャンネルの全動画タイトルをplaylistItems.listで取得(50件ごとに1ユニット)
//   5. このアーティストの未設定トラックそれぞれについて、utils/youtubeMvMatch.tsの
//      ローカル照合(Lyric/Live/Cover等の別バージョンを除外した上でタイトル一致)を行い、
//      確信を持てたものだけtrack.youtube_video_idを更新する
//   6. 結果(チャンネル特定の成否・マッチ件数)をyoutube_mv_backfill_logに1アーティスト
//      1行で記録する。既にログがあるアーティストは次回実行時にスキップする
//      (同じアーティストへの再検索でユニットを浪費しないため)
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-track-youtube-mv.ts [--limit=N]
//   npx tsx --env-file=.env.local scripts/backfill-track-youtube-mv.ts --artist-id=MS_ART_xxx,MS_ART_yyy
//   npx tsx --env-file=.env.local scripts/backfill-track-youtube-mv.ts --rematch
// --limitは処理するアーティスト数(1人あたり約101ユニット消費。無料枠1日10,000
// ユニットに収めるには --limit=90 程度を目安にする)。省略時は対象アーティスト全員を
// 処理しようとするため、無料枠を超えてAPIエラーになるまで進む点に注意。
// --artist-idはカンマ区切りのアーティストID指定(特定アーティストをすぐ処理したい場合用)。
// 指定時は84万件超の全件スキャンをせずそのアーティストのトラックだけを直接取得し、
// クラシック後回し・既存ログでのスキップも無視して常に処理する(明示指定を優先する)。
// --limitと同時指定はできない。
// --rematchは、既にチャンネルを特定済み(youtube_mv_backfill_log.resolved_channel_id
// が設定済み)のアーティストへ、utils/youtubeMvMatch.tsの現在のロジックだけを
// 新規search.list呼び出しなしで再適用する。マッチングロジックを改善した際、
// 既にチャンネル特定コスト(100ユニット/人)を払い済みのアーティストからやり直しなく
// 追加マッチを拾うために使う。
import { createAdminClient } from '@/utils/Supabase/admin'
import {
  searchChannelsByArtistName,
  fetchChannelDetails,
  fetchUploadedVideos,
} from '@/utils/youtubeChannelSearch'
import { judgeYoutubeChannelWithGemini } from '@/utils/geminiYoutubeChannelMatch'
import { findBestMvMatch } from '@/utils/youtubeMvMatch'

type AdminClient = ReturnType<typeof createAdminClient>

const CHANNEL_CONFIDENCE_THRESHOLD = 0.85

const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined
const artistIdArg = process.argv.find((a) => a.startsWith('--artist-id='))
const ARTIST_IDS = artistIdArg ? artistIdArg.slice('--artist-id='.length).split(',').filter(Boolean) : undefined

type TrackRow = { id: string; artist_id: string; title: string }
type ArtistRow = { id: string; name: string }
type TargetArtist = { artist: ArtistRow; tracks: TrackRow[] }

// クラシック/オーケストラ系は「曲数は多いが公式MVがほぼ存在しない」実態が
// 実行結果(Royal Philharmonic Orchestra等、0/200曲超マッチ)から確認できたため、
// 無料枠を先に使い切らせないよう後回しにする(除外はしない、後回しのみ)。
// ジャンルタグ(genre.name)は表記ゆれ・重複が多いカタログのため正規表現で判定する。
const CLASSICAL_GENRE_PATTERN = /classical|orchestr/i
// ジャンルタグだけでは「名前はOrchestra/Symphonyだがジャンルは別(例: Jazz)」の
// ような楽団を取りこぼす(実際にArtie Shaw and His Orchestraがこのケースだった)ため、
// アーティスト名のパターンでも判定する
const CLASSICAL_NAME_PATTERN = /orchestra|symphony|philharmonic|オーケストラ|交響楽団|管弦楽団|フィルハーモニー/i

// PostgRESTの1リクエストあたり行数上限(既定1000件)を超えるため、range()で
// ページングして全件取得する。youtube_video_idが未設定・artist_idが設定済みの
// トラックだけに絞る(utils/fetchAllRows.tsはフィルタを受け付けないため専用実装)
async function fetchTracksMissingMv(supabase: AdminClient): Promise<TrackRow[]> {
  const rows: TrackRow[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('track')
      .select('id, artist_id, title')
      .is('youtube_video_id', null)
      .not('artist_id', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    const page = (data ?? []) as TrackRow[]
    rows.push(...page)
    // DB全体で84万件超あり、無進捗だと固まって見える(実際にユーザーから
    // 報告があった)ため、1万件ごとに進捗を出す
    if (rows.length % 10000 < pageSize) {
      console.log(`  未設定トラックを読み込み中... ${rows.length}件`)
    }
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function fetchAlreadyProcessedArtistIds(supabase: AdminClient): Promise<Set<string>> {
  const ids = new Set<string>()
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('youtube_mv_backfill_log')
      .select('artist_id')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    const page = (data ?? []) as { artist_id: string }[]
    for (const row of page) ids.add(row.artist_id)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return ids
}

async function fetchArtistNames(supabase: AdminClient, artistIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (let i = 0; i < artistIds.length; i += 500) {
    const { data } = await supabase.from('artist').select('id, name').in('id', artistIds.slice(i, i + 500))
    for (const row of (data ?? []) as ArtistRow[]) names.set(row.id, row.name)
  }
  return names
}

/** --artist-id指定時の直接取得。84万件超の全件スキャンをせず、指定アーティストの
 * 未設定トラックだけを直接取得する。既存ログでのスキップも無視する(明示指定優先)。 */
async function buildDirectTargetArtists(supabase: AdminClient, artistIds: string[]): Promise<TargetArtist[]> {
  const names = await fetchArtistNames(supabase, artistIds)
  const targets: TargetArtist[] = []
  for (const id of artistIds) {
    const name = names.get(id)
    if (!name) {
      console.log(`  ⚠️ アーティストID ${id} が見つかりません。スキップします。`)
      continue
    }
    const { data } = await supabase
      .from('track')
      .select('id, artist_id, title')
      .eq('artist_id', id)
      .is('youtube_video_id', null)
    targets.push({ artist: { id, name }, tracks: (data ?? []) as TrackRow[] })
  }
  return targets
}

/** ジャンルタグがクラシック/オーケストラ系(CLASSICAL_GENRE_PATTERN)に該当する
 * アーティストIDの集合を返す。genreテーブル自体は小さいためまず全件取得し、
 * 該当するgenre_idだけでartist_genreを絞り込む。 */
async function fetchClassicalGenreArtistIds(supabase: AdminClient): Promise<Set<string>> {
  const { data: genres } = await supabase.from('genre').select('id, name')
  const matchingGenreIds = ((genres ?? []) as { id: string; name: string }[])
    .filter((g) => CLASSICAL_GENRE_PATTERN.test(g.name))
    .map((g) => g.id)
  if (matchingGenreIds.length === 0) return new Set()

  const artistIds = new Set<string>()
  for (let i = 0; i < matchingGenreIds.length; i += 500) {
    const { data } = await supabase
      .from('artist_genre')
      .select('artist_id')
      .in('genre_id', matchingGenreIds.slice(i, i + 500))
    for (const row of (data ?? []) as { artist_id: string }[]) artistIds.add(row.artist_id)
  }
  return artistIds
}

/** 未設定トラックを1件以上持つアーティストを、「クラシック/オーケストラ系を後回し」
 * →「その中で未設定トラック数が多い順」の2段階で並べて返す(1アーティストあたりの
 * APIコストが一定のため、件数が多いアーティストを先に処理した方が同じユニット消費で
 * 多くのトラックを埋められるが、クラシック/オーケストラ系は曲数が多い割に公式MVが
 * ほぼ存在しないため、無料枠を先に使い切らせないよう優先度を下げる)。既にログ済みの
 * アーティストは対象外にする(同じ検索を繰り返さない)。 */
async function buildTargetArtists(supabase: AdminClient): Promise<TargetArtist[]> {
  const [missingTracks, processedArtistIds, classicalGenreArtistIds] = await Promise.all([
    fetchTracksMissingMv(supabase),
    fetchAlreadyProcessedArtistIds(supabase),
    fetchClassicalGenreArtistIds(supabase),
  ])

  const tracksByArtist = new Map<string, TrackRow[]>()
  for (const t of missingTracks) {
    if (processedArtistIds.has(t.artist_id)) continue
    const list = tracksByArtist.get(t.artist_id) ?? []
    list.push(t)
    tracksByArtist.set(t.artist_id, list)
  }

  const artistIds = [...tracksByArtist.keys()]
  const names = await fetchArtistNames(supabase, artistIds)

  const isDeprioritized = (id: string): boolean => {
    const name = names.get(id) ?? ''
    return classicalGenreArtistIds.has(id) || CLASSICAL_NAME_PATTERN.test(name)
  }

  const sortedIds = artistIds.sort((a, b) => {
    const deprioritizedDiff = Number(isDeprioritized(a)) - Number(isDeprioritized(b))
    if (deprioritizedDiff !== 0) return deprioritizedDiff
    return (tracksByArtist.get(b)?.length ?? 0) - (tracksByArtist.get(a)?.length ?? 0)
  })

  return sortedIds
    .filter((id) => names.has(id))
    .map((id) => ({ artist: { id, name: names.get(id)! }, tracks: tracksByArtist.get(id)! }))
}

type LogInsert = {
  artist_id: string
  artist_name: string
  status: 'matched' | 'no_channel' | 'channel_ambiguous' | 'error'
  resolved_channel_id?: string | null
  resolved_channel_title?: string | null
  channel_confidence?: number | null
  channel_reasoning?: string | null
  tracks_total: number
  tracks_matched?: number
}

async function processArtist(supabase: AdminClient, target: TargetArtist): Promise<LogInsert> {
  const { artist, tracks } = target
  const baseLog = { artist_id: artist.id, artist_name: artist.name, tracks_total: tracks.length }

  const channelCandidates = await searchChannelsByArtistName(artist.name)
  if (channelCandidates.length === 0) {
    return { ...baseLog, status: 'no_channel' }
  }

  const details = await fetchChannelDetails(channelCandidates.map((c) => c.channelId))
  const detailedCandidates = channelCandidates
    .map((c) => details.get(c.channelId))
    .filter((d): d is NonNullable<typeof d> => d !== undefined)

  if (detailedCandidates.length === 0) {
    return { ...baseLog, status: 'no_channel' }
  }

  const judgement = await judgeYoutubeChannelWithGemini(artist.name, detailedCandidates)
  if (judgement.channelIndex === null || judgement.confidence < CHANNEL_CONFIDENCE_THRESHOLD) {
    return {
      ...baseLog,
      status: 'channel_ambiguous',
      channel_confidence: judgement.confidence,
      channel_reasoning: judgement.reasoning,
    }
  }

  const chosenChannel = detailedCandidates[judgement.channelIndex]
  if (!chosenChannel.uploadsPlaylistId) {
    return {
      ...baseLog,
      status: 'channel_ambiguous',
      resolved_channel_id: chosenChannel.channelId,
      resolved_channel_title: chosenChannel.title,
      channel_confidence: judgement.confidence,
      channel_reasoning: `${judgement.reasoning}(アップロード一覧を取得できませんでした)`,
    }
  }

  // channels.listがuploadsPlaylistIdを返していても、実際にplaylistItems.listすると
  // 404になるチャンネルが一定数存在する(YouTube API側の既知の制限。Steve Reich/
  // Humble Pie/Horace Silverの実チャンネルで確認済み)。ここで拾わずthrowさせると、
  // main()側の汎用catchでchosenChannelの情報が失われ、せっかく特定できた公式
  // チャンネルの記録が消えてしまうため、ここで捕まえてchannel_ambiguous扱いにする
  let videos: Awaited<ReturnType<typeof fetchUploadedVideos>>
  try {
    videos = await fetchUploadedVideos(chosenChannel.uploadsPlaylistId)
  } catch (err) {
    return {
      ...baseLog,
      status: 'channel_ambiguous',
      resolved_channel_id: chosenChannel.channelId,
      resolved_channel_title: chosenChannel.title,
      channel_confidence: judgement.confidence,
      channel_reasoning: `${judgement.reasoning}(動画一覧の取得に失敗: ${(err as Error).message.slice(0, 200)})`,
    }
  }

  let matchedCount = 0
  for (const track of tracks) {
    const match = findBestMvMatch(track.title, videos)
    if (!match) continue
    const { error } = await supabase.from('track').update({ youtube_video_id: match.videoId }).eq('id', track.id)
    if (!error) matchedCount += 1
  }

  return {
    ...baseLog,
    status: 'matched',
    resolved_channel_id: chosenChannel.channelId,
    resolved_channel_title: chosenChannel.title,
    channel_confidence: judgement.confidence,
    channel_reasoning: judgement.reasoning,
    tracks_matched: matchedCount,
  }
}

type RematchTarget = { artistId: string; artistName: string; channelId: string }

/** youtube_mv_backfill_logで既にチャンネルまで特定できている(resolved_channel_idが
 * 設定されている)アーティストを、--rematch用に返す。同じアーティストが複数回
 * ログされていることがあるため、最後の1件(最新の判定)だけを使う。 */
async function fetchRematchTargets(supabase: AdminClient): Promise<RematchTarget[]> {
  const rows: { artist_id: string; artist_name: string; resolved_channel_id: string }[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('youtube_mv_backfill_log')
      .select('artist_id, artist_name, resolved_channel_id')
      .not('resolved_channel_id', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    const page = (data ?? []) as typeof rows
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  const byArtist = new Map<string, RematchTarget>()
  for (const r of rows) {
    byArtist.set(r.artist_id, { artistId: r.artist_id, artistName: r.artist_name, channelId: r.resolved_channel_id })
  }
  return [...byArtist.values()]
}

/** --rematch: 新規にsearch.listを呼ばず(=ユニット消費なし)、既に特定済みのチャンネルの
 * 動画一覧だけを再取得して、utils/youtubeMvMatch.tsの最新ロジックで再照合する。
 * search.listの日次クォータを使い切っていても、channels.list/playlistItems.listは
 * 別枠でまだ使えることが確認できている(2026-09-11、実運用で確認)。 */
async function rematchArtist(
  supabase: AdminClient,
  target: RematchTarget
): Promise<{ tracksMatched: number; tracksRemaining: number } | { error: string }> {
  const { data } = await supabase
    .from('track')
    .select('id, artist_id, title')
    .eq('artist_id', target.artistId)
    .is('youtube_video_id', null)
  const missing = (data ?? []) as TrackRow[]
  if (missing.length === 0) return { tracksMatched: 0, tracksRemaining: 0 }

  const details = await fetchChannelDetails([target.channelId])
  const detail = details.get(target.channelId)
  if (!detail?.uploadsPlaylistId) {
    return { error: 'チャンネル詳細またはアップロード一覧を再取得できませんでした' }
  }

  let videos: Awaited<ReturnType<typeof fetchUploadedVideos>>
  try {
    videos = await fetchUploadedVideos(detail.uploadsPlaylistId)
  } catch (err) {
    return { error: (err as Error).message.slice(0, 200) }
  }

  let matchedCount = 0
  for (const track of missing) {
    const match = findBestMvMatch(track.title, videos)
    if (!match) continue
    const { error } = await supabase.from('track').update({ youtube_video_id: match.videoId }).eq('id', track.id)
    if (!error) matchedCount += 1
  }
  return { tracksMatched: matchedCount, tracksRemaining: missing.length - matchedCount }
}

async function runRematch(supabase: AdminClient) {
  console.log('既にチャンネル特定済みのアーティストへ、修正版マッチングロジックを新規検索なしで再適用します...')
  const targets = await fetchRematchTargets(supabase)
  console.log(`対象: ${targets.length}アーティスト\n`)

  let totalMatched = 0
  for (const [index, target] of targets.entries()) {
    const result = await rematchArtist(supabase, target)
    if ('error' in result) {
      console.log(`[${index + 1}/${targets.length}] ${target.artistName}: ❌ ${result.error}`)
      continue
    }
    totalMatched += result.tracksMatched
    console.log(
      `[${index + 1}/${targets.length}] ${target.artistName}: +${result.tracksMatched}曲(残り未設定${result.tracksRemaining}曲)`
    )
    if (result.tracksMatched > 0) {
      await supabase.from('youtube_mv_backfill_log').insert({
        artist_id: target.artistId,
        artist_name: target.artistName,
        status: 'matched',
        resolved_channel_id: target.channelId,
        channel_reasoning: '修正版マッチングロジックの再適用(新規チャンネル検索なし)',
        tracks_total: result.tracksMatched + result.tracksRemaining,
        tracks_matched: result.tracksMatched,
      })
    }
  }

  console.log(`\n--- 再マッチ結果 ---\n追加マッチ: ${totalMatched}曲`)
}

async function main() {
  // YouTube検索まで進んでから鍵未設定に気付くと、その前段の全件読み込み分の時間が
  // 無駄になるため、起動直後に検証する
  if (!process.env.YOUTUBE_API_KEY) {
    console.error('YOUTUBE_API_KEY が設定されていません。.env.local に追加してください。')
    process.exitCode = 1
    return
  }

  const supabase = createAdminClient()

  if (process.argv.includes('--rematch')) {
    await runRematch(supabase)
    return
  }

  let targets: TargetArtist[]
  let candidatePoolSize: number | null = null
  if (ARTIST_IDS) {
    console.log(`指定アーティスト(${ARTIST_IDS.length}件)を直接取得中...`)
    targets = await buildDirectTargetArtists(supabase, ARTIST_IDS)
  } else {
    console.log('対象アーティストを集計中(トラック件数が多いため数十秒〜数分かかります)...')
    const allTargets = await buildTargetArtists(supabase)
    candidatePoolSize = allTargets.length
    targets = LIMIT ? allTargets.slice(0, LIMIT) : allTargets
  }

  if (targets.length === 0) {
    console.log('対象のアーティストはいません。')
    return
  }
  console.log(
    `対象: ${targets.length}アーティスト${candidatePoolSize !== null ? `(全候補: ${candidatePoolSize}人)` : ''}\n`
  )

  let matchedArtists = 0
  let noChannel = 0
  let ambiguous = 0
  let errors = 0
  let totalTracksMatched = 0

  for (const [index, target] of targets.entries()) {
    console.log(`[${index + 1}/${targets.length}] ${target.artist.name}(未設定${target.tracks.length}曲)`)
    let result: LogInsert
    try {
      result = await processArtist(supabase, target)
    } catch (err) {
      console.log(`  ❌ エラー: ${(err as Error).message}`)
      result = {
        artist_id: target.artist.id,
        artist_name: target.artist.name,
        tracks_total: target.tracks.length,
        status: 'error',
        channel_reasoning: (err as Error).message.slice(0, 500),
      }
    }

    if (result.status === 'matched') {
      matchedArtists += 1
      totalTracksMatched += result.tracks_matched ?? 0
      console.log(`  ✅ ${result.resolved_channel_title} → ${result.tracks_matched}/${target.tracks.length}曲マッチ`)
    } else if (result.status === 'no_channel') {
      noChannel += 1
      console.log('  ⚠️ チャンネルが見つかりませんでした')
    } else if (result.status === 'channel_ambiguous') {
      ambiguous += 1
      console.log(`  ⚠️ チャンネル確信度不足(${Math.round((result.channel_confidence ?? 0) * 100)}%): ${result.channel_reasoning}`)
    } else {
      errors += 1
    }

    await supabase.from('youtube_mv_backfill_log').insert(result)
  }

  console.log('\n--- 結果サマリー ---')
  console.log(`チャンネル特定・反映: ${matchedArtists}アーティスト(${totalTracksMatched}曲)`)
  console.log(`チャンネル見つからず: ${noChannel}アーティスト`)
  console.log(`確信度不足でスキップ: ${ambiguous}アーティスト`)
  console.log(`エラー: ${errors}アーティスト`)
}

main()
