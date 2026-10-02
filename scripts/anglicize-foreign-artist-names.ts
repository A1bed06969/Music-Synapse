/**
 * Apple Music日本ストアのカタカナ音訳名義(例: 「ニルヴァーナ」)で登録されている
 * 海外アーティストを、米国ストアの英語名義(例: "Nirvana")に直す。
 *
 * 全アーティストを一律で米国ストア名義にすると日本人アーティストまで英語化されて
 * しまうため、対象を「カタカナのみの名前」に絞り、さらに出身国で日本/海外を判定して
 * 海外と判定できたものだけを変換する。
 *   1. artist.origin_country_code(DB既存値)
 *   2. MusicBrainzのartist.country(musicbrainz_idがある場合)
 *   3. LLM判定(米国ストア名・ジャンル・アルバム題名を材料に、確信度0.9以上のみ採用)
 * 変換時は元のカタカナ名をname_kanaに退避する(artist.sort_keyがCOALESCE(name_kana,
 * name)なので五十音順の並びも維持され、検索はname_kanaも対象のためカタカナでも引ける)。
 *
 * 実行方法(2段階。まずレポートだけ作って確認 → 問題なければ適用):
 *   npx tsx --env-file=.env.local scripts/anglicize-foreign-artist-names.ts          # 判定してレポート出力のみ
 *   npx tsx --env-file=.env.local scripts/anglicize-foreign-artist-names.ts --apply  # レポートのAUTO分をDBへ反映
 *
 * レポート: .anglicize-report.json(gitignore対象)
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Type } from '@google/genai'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistOrigin } from '@/utils/musicbrainz'
import { AllProvidersExhaustedError, generateJudgementText } from '@/utils/llmJudgeChain'

const REPORT_PATH = join(process.cwd(), '.anglicize-report.json')
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const LOOKUP_BATCH = 100
const ITUNES_INTERVAL_MS = 4000
const LLM_BATCH = 8
const AUTO_CONFIDENCE = 0.9

const KATAKANA_ONLY = /^[ァ-ヿㇰ-ㇿｦ-ﾟ・ー\s]+$/
const HAS_KATAKANA_LETTER = /[ァ-ヶ]/
const COLLAB_LIKE = /[、＆×]/
// 英数字・欧州系ラテン文字・一般的な記号のみ(ハングル・中国語・キリル等の他文字は除外)
const LATIN_NAME = /^[\p{Script=Latin}\p{N}\s.,'’!?&\-_+()/:;"*$#@%·]+$/u
const HAS_LATIN_LETTER = /\p{Script=Latin}/u
const JAPANESE_GENRES = /j-?pop|j-?rock|japanese|anime|アニメ|歌謡|演歌|j-?hip|city pop|enka|kayokyoku|vocaloid|ボーカロイド/i

type Candidate = {
  id: string
  name: string
  origin_country_code: string | null
  musicbrainz_id: string | null
  apple_music_artist_id: string
}

type Decision = 'AUTO' | 'REVIEW' | 'SKIP'

type ReportEntry = {
  id: string
  oldName: string
  newName: string | null
  appleMusicArtistId: string
  usGenre: string | null
  decision: Decision
  basis: string
  confidence: number | null
  reasoning: string | null
  collisionWith: { id: string; name: string; appleMusicArtistId: string | null; musicbrainzId: string | null }[]
  applied?: boolean
  merged?: { id: string; name: string; reason: string }[]
  applyError?: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Supabase = ReturnType<typeof createAdminClient>

async function fetchCandidates(supabase: Supabase): Promise<Candidate[]> {
  const rows: Candidate[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, origin_country_code, musicbrainz_id, apple_music_artist_id')
      .not('apple_music_artist_id', 'is', null)
      .is('name_kana', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`アーティスト取得に失敗: ${error.message}`)
    const page = (data ?? []) as Candidate[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows.filter(
    (r) => KATAKANA_ONLY.test(r.name) && HAS_KATAKANA_LETTER.test(r.name) && !COLLAB_LIKE.test(r.name)
  )
}

type UsArtist = { name: string; genre: string | null }

async function fetchUsArtists(ids: string[]): Promise<Map<string, UsArtist>> {
  const result = new Map<string, UsArtist>()
  for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
    const batch = ids.slice(i, i + LOOKUP_BATCH)
    const res = await fetch(`https://itunes.apple.com/lookup?id=${batch.join(',')}&country=us`, {
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!res.ok) throw new Error(`iTunes lookup失敗 HTTP ${res.status}(${i}件目付近)。時間を置いて再実行してください`)
    const body = (await res.json()) as { results: { wrapperType?: string; artistId?: number; artistName?: string; primaryGenreName?: string }[] }
    for (const r of body.results) {
      if (r.wrapperType === 'artist' && r.artistId && r.artistName) {
        result.set(String(r.artistId), { name: r.artistName, genre: r.primaryGenreName ?? null })
      }
    }
    console.log(`  米国ストア名義取得: ${Math.min(i + LOOKUP_BATCH, ids.length)}/${ids.length}`)
    if (i + LOOKUP_BATCH < ids.length) await sleep(ITUNES_INTERVAL_MS)
  }
  return result
}

async function fetchAlbumTitles(supabase: Supabase, artistIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  for (let i = 0; i < artistIds.length; i += 150) {
    const batch = artistIds.slice(i, i + 150)
    const { data, error } = await supabase
      .from('album')
      .select('artist_id, title')
      .in('artist_id', batch)
      .order('id', { ascending: true })
      .limit(1000)
    if (error) throw new Error(`アルバム取得に失敗: ${error.message}`)
    for (const row of (data ?? []) as { artist_id: string; title: string }[]) {
      const list = map.get(row.artist_id) ?? []
      if (list.length < 3) list.push(row.title)
      map.set(row.artist_id, list)
    }
  }
  return map
}

const JUDGE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      index: { type: Type.INTEGER },
      isJapanese: { type: Type.BOOLEAN },
      confidence: { type: Type.NUMBER },
      reasoning: { type: Type.STRING },
    },
    required: ['index', 'isJapanese', 'confidence', 'reasoning'],
  },
}

type JudgeInput = { index: number; jpName: string; usName: string; genre: string | null; albums: string[] }
type JudgeOutput = { isJapanese: boolean; confidence: number; reasoning: string }

async function judgeJapanese(items: JudgeInput[]): Promise<Map<number, JudgeOutput>> {
  const lines = items
    .map(
      (it) =>
        `[${it.index}] 日本ストア名義: ${it.jpName} / 米国ストア名義: ${it.usName}` +
        `${it.genre ? ` / ジャンル: ${it.genre}` : ''}` +
        `${it.albums.length ? ` / 登録アルバム: ${it.albums.join(' | ')}` : ''}`
    )
    .join('\n')
  const prompt = `以下は、Apple Musicの日本ストアでカタカナ名義になっているアーティストの一覧です。
それぞれについて、日本のアーティスト(日本人・日本を拠点とする、日本語で活動する)かどうかを判定してください。

背景: 日本ストアは海外アーティストの名前をカタカナに音訳することが多い(例: Nirvana→ニルヴァーナ)一方、
日本のアーティストがカタカナ名義を使うことも多い(例: ヨルシカ、サカナクション、ブルーエンカウント)。
米国ストアでは日本のアーティストもローマ字表記になるため、米国ストア名義が英語であること自体は判定材料にならない。

判定ルール:
- 自分が確実に知っているアーティストのみ高い確信度(0.9以上)を付けること
- 知らない・判断材料が乏しい場合は確信度を0.5未満にすること(日本人を誤って英語化するリスクの方が重大)
- 海外アーティストの音訳名なら isJapanese=false、日本のアーティストなら isJapanese=true
- reasoningには決め手を日本語で簡潔に書く

${lines}

全件について index を含めて配列で返してください。`
  const text = await generateJudgementText(prompt, JUDGE_SCHEMA)
  const out = new Map<number, JudgeOutput>()
  if (!text) return out
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return out
  }
  if (!Array.isArray(parsed)) return out
  for (const p of parsed as { index?: unknown; isJapanese?: unknown; confidence?: unknown; reasoning?: unknown }[]) {
    if (typeof p.index !== 'number' || typeof p.isJapanese !== 'boolean') continue
    const confidence = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0
    out.set(p.index, {
      isJapanese: p.isJapanese,
      confidence,
      reasoning: typeof p.reasoning === 'string' ? p.reasoning.trim() : '',
    })
  }
  return out
}

async function findCollisions(supabase: Supabase, entries: ReportEntry[]) {
  for (const e of entries) {
    if (!e.newName) continue
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, apple_music_artist_id, musicbrainz_id')
      .ilike('name', e.newName.replace(/[%_\\]/g, '\\$&'))
      .neq('id', e.id)
      .limit(10)
    if (error) throw new Error(`同名チェックに失敗: ${error.message}`)
    e.collisionWith = ((data ?? []) as { id: string; name: string; apple_music_artist_id: string | null; musicbrainz_id: string | null }[])
      .filter((o) => o.name.toLowerCase() === e.newName!.toLowerCase())
      .map((o) => ({ id: o.id, name: o.name, appleMusicArtistId: o.apple_music_artist_id, musicbrainzId: o.musicbrainz_id }))
  }
}

async function buildReport() {
  const supabase = createAdminClient()
  const candidates = await fetchCandidates(supabase)
  console.log(`カタカナのみの名前: ${candidates.length}件`)

  console.log('米国ストア名義を取得中...')
  const us = await fetchUsArtists(candidates.map((c) => c.apple_music_artist_id))

  const entries: ReportEntry[] = []
  const needJudge: { entry: ReportEntry; cand: Candidate; usName: string; genre: string | null }[] = []

  for (const cand of candidates) {
    const usArtist = us.get(cand.apple_music_artist_id)
    const entry: ReportEntry = {
      id: cand.id,
      oldName: cand.name,
      newName: null,
      appleMusicArtistId: cand.apple_music_artist_id,
      usGenre: usArtist?.genre ?? null,
      decision: 'SKIP',
      basis: '',
      confidence: null,
      reasoning: null,
      collisionWith: [],
    }
    entries.push(entry)

    if (!usArtist) {
      entry.basis = '米国ストアに該当なし(変換せず)'
      continue
    }
    const usName = usArtist.name.trim()
    if (!LATIN_NAME.test(usName) || !HAS_LATIN_LETTER.test(usName)) {
      entry.basis = `米国ストア名義がラテン文字ではない(${usName})`
      continue
    }
    entry.newName = usName

    if (cand.origin_country_code) {
      if (cand.origin_country_code.toLowerCase() === 'jp') {
        entry.basis = '出身国=日本(DB)のため変換しない'
        entry.newName = null
      } else {
        entry.decision = 'AUTO'
        entry.basis = `出身国=${cand.origin_country_code.toUpperCase()}(DB)`
      }
      continue
    }
    needJudge.push({ entry, cand, usName, genre: usArtist.genre })
  }

  // MusicBrainzの国情報
  const withMbid = needJudge.filter((n) => n.cand.musicbrainz_id)
  console.log(`MusicBrainzで出身国を確認中: ${withMbid.length}件`)
  const stillUnknown: typeof needJudge = needJudge.filter((n) => !n.cand.musicbrainz_id)
  let mbDone = 0
  for (const n of withMbid) {
    let code: string | null = null
    try {
      code = (await fetchArtistOrigin(n.cand.musicbrainz_id!)).countryCode
    } catch (err) {
      console.error(`  MusicBrainz取得失敗(${n.cand.name}): ${err instanceof Error ? err.message : err}`)
    }
    mbDone++
    if (mbDone % 20 === 0) console.log(`  ${mbDone}/${withMbid.length}`)
    if (code && !/^X/i.test(code)) {
      if (code.toLowerCase() === 'jp') {
        n.entry.basis = '出身国=日本(MusicBrainz)のため変換しない'
        n.entry.newName = null
      } else {
        n.entry.decision = 'AUTO'
        n.entry.basis = `出身国=${code.toUpperCase()}(MusicBrainz)`
      }
    } else {
      stillUnknown.push(n)
    }
  }

  // LLM判定
  console.log(`LLMで日本/海外を判定中: ${stillUnknown.length}件`)
  const albumTitles = await fetchAlbumTitles(supabase, stillUnknown.map((n) => n.cand.id))
  for (let i = 0; i < stillUnknown.length; i += LLM_BATCH) {
    const batch = stillUnknown.slice(i, i + LLM_BATCH)
    const inputs: JudgeInput[] = batch.map((n, idx) => ({
      index: idx,
      jpName: n.cand.name,
      usName: n.usName,
      genre: n.genre,
      albums: albumTitles.get(n.cand.id) ?? [],
    }))
    let judged: Map<number, JudgeOutput>
    try {
      judged = await judgeJapanese(inputs)
    } catch (err) {
      if (!(err instanceof AllProvidersExhaustedError)) throw err
      console.error(`  LLM無料枠が尽きたため、残りは未判定(REVIEW)としてレポートに出力します: ${err.message}`)
      for (const rest of stillUnknown.slice(i)) {
        rest.entry.decision = 'REVIEW'
        rest.entry.basis = 'LLM未判定(無料枠切れ)。枠の回復後に再実行'
      }
      break
    }
    batch.forEach((n, idx) => {
      const j = judged.get(idx)
      if (!j) {
        n.entry.decision = 'REVIEW'
        n.entry.basis = 'LLM判定の応答が得られなかった'
        return
      }
      n.entry.confidence = j.confidence
      n.entry.reasoning = j.reasoning
      const genreLooksJapanese = n.genre ? JAPANESE_GENRES.test(n.genre) : false
      if (j.isJapanese) {
        n.entry.basis = `LLM判定=日本のアーティスト(確信度${j.confidence.toFixed(2)})のため変換しない`
        n.entry.newName = null
      } else if (j.confidence >= AUTO_CONFIDENCE && !genreLooksJapanese) {
        n.entry.decision = 'AUTO'
        n.entry.basis = `LLM判定=海外アーティスト(確信度${j.confidence.toFixed(2)})`
      } else {
        n.entry.decision = 'REVIEW'
        n.entry.basis = genreLooksJapanese
          ? `LLMは海外判定だが米国ストアのジャンルが日本系(${n.genre})`
          : `LLM判定の確信度が低い(${j.confidence.toFixed(2)})`
      }
    })
    console.log(`  ${Math.min(i + LLM_BATCH, stillUnknown.length)}/${stillUnknown.length}`)
  }

  await findCollisions(supabase, entries)
  writeFileSync(REPORT_PATH, JSON.stringify(entries, null, 2))

  const count = (d: Decision) => entries.filter((e) => e.decision === d).length
  console.log(`\nレポート出力: ${REPORT_PATH}`)
  console.log(`AUTO(自動変換対象): ${count('AUTO')}件 / REVIEW(要確認・未変換): ${count('REVIEW')}件 / SKIP(変換しない): ${count('SKIP')}件`)
  console.log(`うち同名の既存アーティストがある: ${entries.filter((e) => e.newName && e.collisionWith.length > 0).length}件`)
}

type FullRow = Record<string, unknown> & {
  id: string
  name: string
  name_kana: string | null
  apple_music_artist_id: string | null
  musicbrainz_id: string | null
}

const FILL_FIELDS = [
  'image_url', 'bio', 'biography_status', 'official_site_url', 'sns_x_url', 'sns_instagram_url',
  'spotify_artist_id', 'musicbrainz_id', 'discogs_artist_id', 'formed_year', 'artist_type',
  'hometown_country', 'origin_country_code', 'url_latest_mv',
]
// 地図用の位置情報は項目同士が整合している必要があるため、まとめて(全て空の時だけ)コピーする
const GEO_FIELDS = ['origin_latitude', 'origin_longitude', 'origin_region_code', 'origin_muni_code', 'origin_prefecture', 'hometown_city']

/** 統合元(loser)にだけある情報を、統合先(keeper)の空欄へ補う(mergeArtistsは参照の付け替えのみで
 * 項目値は補完しないため)。 */
function buildFill(keeper: FullRow, loser: FullRow): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const f of FILL_FIELDS) {
    if ((keeper[f] === null || keeper[f] === undefined) && loser[f] !== null && loser[f] !== undefined) patch[f] = loser[f]
  }
  const keeperHasGeo = GEO_FIELDS.some((f) => keeper[f] !== null && keeper[f] !== undefined)
  const loserHasGeo = GEO_FIELDS.some((f) => loser[f] !== null && loser[f] !== undefined)
  if (!keeperHasGeo && loserHasGeo) for (const f of GEO_FIELDS) patch[f] = loser[f]
  return patch
}

/** 変換後の英語名と同名の既存行について、統合してよいか(=同一人物と確実に言えるか)を判定する。
 *  - 同じApple Music ID: 同一アーティストの重複行(確実)
 *  - 同じMusicBrainz ID: 同一(確実)
 *  - Apple ID・MBIDとも持たない行: 名前だけで作られたスタブ行(キュレーション等由来)。
 *    取り込み時の既存ロジックと同じく、同名スタブは本体へ吸収する
 *  - それ以外(別のApple ID/MBIDを持つ同名行): 同姓同名の別人の可能性があるため統合しない */
function mergeReason(self: FullRow, other: FullRow): string | null {
  if (other.apple_music_artist_id && other.apple_music_artist_id === self.apple_music_artist_id) return '同一Apple Music ID'
  if (other.musicbrainz_id && other.musicbrainz_id === self.musicbrainz_id) return '同一MusicBrainz ID'
  if (!other.apple_music_artist_id && !other.musicbrainz_id) return '名前のみのスタブ行'
  return null
}

async function applyReport() {
  if (!existsSync(REPORT_PATH)) throw new Error(`${REPORT_PATH} がありません。先に --apply なしで実行してください`)
  const entries = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as ReportEntry[]
  const supabase = createAdminClient()
  const { mergeArtists } = await import('@/app/admin/data/artists/duplicate-review/actions')
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity
  const targets = entries.filter((e) => e.decision === 'AUTO' && e.newName && !e.applied).slice(0, limit)
  console.log(`変換対象: ${targets.length}件`)

  let applied = 0
  let mergedCount = 0
  for (const [i, e] of targets.entries()) {
    const { data: current, error: readError } = await supabase.from('artist').select('*').eq('id', e.id).limit(1)
    if (readError) {
      e.applyError = `現状取得に失敗: ${readError.message}`
      continue
    }
    const self = current?.[0] as FullRow | undefined
    if (!self || self.name !== e.oldName || self.name_kana) {
      e.applyError = 'レポート作成後に行が変更されていたためスキップ'
      continue
    }

    const { data: sameName, error: sameNameError } = await supabase
      .from('artist')
      .select('*')
      .ilike('name', e.newName!.replace(/[%_\\]/g, '\\$&'))
      .neq('id', e.id)
      .limit(20)
    if (sameNameError) {
      e.applyError = `同名チェックに失敗: ${sameNameError.message}`
      continue
    }
    const others = ((sameName ?? []) as FullRow[]).filter((o) => o.name.toLowerCase() === e.newName!.toLowerCase())
    const plans = others.map((o) => ({ other: o, reason: mergeReason(self, o) }))
    const blocked = plans.find((p) => !p.reason)
    if (blocked) {
      e.decision = 'REVIEW'
      e.basis = `同名の別アーティストあり(${blocked.other.id}、別のApple ID/MBIDを持つため同一人物か判断できず統合・変換を保留)`
      e.collisionWith = others.map((o) => ({ id: o.id, name: o.name, appleMusicArtistId: o.apple_music_artist_id, musicbrainzId: o.musicbrainz_id }))
      continue
    }

    let mergeFailed = false
    e.merged = []
    for (const { other, reason } of plans) {
      const patch = buildFill(self, other)
      if (Object.keys(patch).length > 0) {
        const { error: fillError } = await supabase.from('artist').update(patch).eq('id', e.id)
        if (fillError) {
          e.applyError = `統合前の補完に失敗: ${fillError.message}`
          mergeFailed = true
          break
        }
        Object.assign(self, patch)
      }
      const result = await mergeArtists(e.id, [other.id])
      if (!result.success) {
        e.applyError = `統合に失敗(${other.id}): ${result.message}`
        mergeFailed = true
        break
      }
      e.merged.push({ id: other.id, name: other.name, reason: reason! })
      mergedCount++
    }
    if (mergeFailed) continue

    const { error } = await supabase
      .from('artist')
      .update({ name: e.newName, name_kana: e.oldName })
      .eq('id', e.id)
      .eq('name', e.oldName)
    if (error) {
      e.applyError = `${error.code ?? ''} ${error.message}`.trim()
      continue
    }
    e.applied = true
    applied++
    if ((i + 1) % 50 === 0) {
      console.log(`  ${i + 1}/${targets.length}`)
      writeFileSync(REPORT_PATH, JSON.stringify(entries, null, 2))
    }
  }
  writeFileSync(REPORT_PATH, JSON.stringify(entries, null, 2))
  console.log(`反映完了: ${applied}件(うち同名行の統合 ${mergedCount}件) / 保留・スキップ・失敗: ${targets.length - applied}件`)
  for (const e of targets.filter((t) => t.applyError)) console.log(`  ${e.oldName}: ${e.applyError}`)
}

async function main() {
  if (process.argv.includes('--apply')) await applyReport()
  else await buildReport()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
