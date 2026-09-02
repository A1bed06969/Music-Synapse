// utils/geminiRadioPickExtract.ts
//
// ラジオ局PP(パワープレイ/ヘビーローテーション)ページから、選曲候補をGeminiで
// 抽出する。utils/geminiFestivalLineupExtract.tsと同じ方針(無料枠内で収まる
// gemini-3.1-flash-lite)。局ごとにサイト構造が異なるため、正規表現ベースの
// 構造化抽出(utils/radioScrape.ts、3局限定パイロット)の対象外の局はこちらを使う。
import { GoogleGenAI, Type } from '@google/genai'
import { stripHtmlToText } from './geminiFestivalLineupExtract.ts'

const MODEL = 'gemini-3.1-flash-lite'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

export type RadioPickCandidate = {
  artistName: string
  trackTitle: string
  campaignName: string | null
}

export async function fetchStationPageHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error(`ページ取得に失敗しました (${res.status})`)
  }
  return res.text()
}

function buildPrompt(stationName: string): string {
  return `以下はラジオ局「${stationName}」の公式サイトから抽出したテキストです。
現在放送中のパワープレイ/ヘビーローテーション(局が今月イチ推しとして選定している楽曲)の一覧を抽出してください。

以下のルールに従ってください:
- 実際に選曲として記載されているアーティスト名・曲名のペアのみを抽出する
  (広告、ナビゲーションメニュー、過去の月の選曲、無関係な特集記事は含めない)
- サイトによって「曲名が先、アーティスト名が後」の順で並んでいる場合と、
  その逆の場合がある。表示順だけで機械的に決めず、リリース情報・プロフィール
  文・活動内容の説明(例:「○○によるソロプロジェクト」「二人組バンド」
  「シンガーソングライター」等)から、どちらが実在の音楽アーティスト/
  グループ/プロジェクト名で、どちらが楽曲のタイトルかを判断してartistName・
  trackTitleに正しく割り当てること
- 「パワープレイ」「ヘビーローテーション」など、ページ上で企画名が判別できれば
  campaignNameに入れる(不明ならnull)
- 同じ組み合わせが複数箇所に出てくる場合は1回だけ含める
- 選曲情報が見つからない場合は空の配列を返す`
}

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      artistName: { type: Type.STRING },
      trackTitle: { type: Type.STRING },
      campaignName: { type: Type.STRING },
    },
    required: ['artistName', 'trackTitle'],
  },
}

type GeminiEntry = {
  artistName?: unknown
  trackTitle?: unknown
  campaignName?: unknown
}

const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 2_000

function isRetryableStatus(status: unknown): boolean {
  return status === 503 || status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Geminiのレスポンステキスト(JSON文字列)を候補配列にパースする、ネットワーク
 * 呼び出しを含まない純粋関数。 */
export function parseRadioPickResponse(text: string): RadioPickCandidate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return (parsed as GeminiEntry[])
    .filter(
      (e) =>
        typeof e?.artistName === 'string' &&
        e.artistName.trim() &&
        typeof e?.trackTitle === 'string' &&
        e.trackTitle.trim()
    )
    .map((e) => ({
      artistName: (e.artistName as string).trim(),
      trackTitle: (e.trackTitle as string).trim(),
      campaignName: typeof e.campaignName === 'string' && e.campaignName.trim() ? e.campaignName.trim() : null,
    }))
}

export async function extractRadioPicksWithGemini(stationName: string, pageText: string): Promise<RadioPickCandidate[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。')
  }
  if (!pageText.trim()) return []

  const ai = new GoogleGenAI({ apiKey })

  let lastErr: unknown
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: `${buildPrompt(stationName)}\n\n---\n${pageText}` }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      })
      break
    } catch (err) {
      lastErr = err
      const status = (err as { status?: unknown })?.status
      if (attempt < MAX_ATTEMPTS && isRetryableStatus(status)) {
        await sleep(RETRY_DELAY_MS)
        continue
      }
      throw err
    }
  }
  if (!response) throw lastErr

  const text = response.text
  if (!text) return []
  return parseRadioPickResponse(text)
}

/** URLからPP選曲候補をまとめて取得する(fetch→テキスト化→Gemini抽出のフルパイプライン)。 */
export async function extractRadioPicksFromUrl(stationName: string, url: string): Promise<RadioPickCandidate[]> {
  const html = await fetchStationPageHtml(url)
  const pageText = stripHtmlToText(html)
  return extractRadioPicksWithGemini(stationName, pageText)
}
