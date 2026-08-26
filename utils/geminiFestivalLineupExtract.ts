// utils/geminiFestivalLineupExtract.ts
//
// フェス公式サイトのページから、出演者(ラインナップ)候補をGeminiで抽出する。
// utils/geminiDiscGuideExtract.tsと同じ方針(無料枠内で収まるgemini-3.1-flash-lite)。
// サイト構造は完全にバラバラなため、Glastonbury専用スクレイパー(utils/festivalScrape.ts)
// のような正規表現ベースの構造化抽出は現実的ではなく、可視テキストをまるごとLLMに
// 読ませて抽出する。JSレンダリングのサイトはfetchで空のHTMLシェルしか取得できず
// 抽出0件になる(既知の制約。ラジオ局PP収集と同じ方針でLLM抽出を採用しつつも、
// 動的サイトへの対応はスコープ外)。
import { GoogleGenAI, Type } from '@google/genai'

const MODEL = 'gemini-3.1-flash-lite'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

export type FestivalLineupCandidate = {
  artist_name: string
  stage?: string
  /** 開催日・出演時刻など、ページ上に見つかった時間関連の表記をそのまま保持する
   * (例: "DAY1 19:00-19:40"、"7/25 (金)")。正確な日付・時刻への変換はしない
   * (サイトごとに表記が違いすぎて誤変換のリスクが高いため、参考情報として
   * そのまま出演情報の確認画面に表示するだけに留める) */
  day_or_time_label?: string
}

export async function fetchFestivalPageHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`ページ取得に失敗しました (${res.status})`)
  }
  return res.text()
}

/** og:image / twitter:image をHTMLから抽出する(LLMではなく確定的な正規表現で行う。
 * LLMにURLを書き写させると1文字違いのハルシネーションが起きやすいため) */
export function extractOgImage(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ]
  for (const re of patterns) {
    const match = html.match(re)
    if (match?.[1]) return match[1]
  }
  return null
}

/** HTMLからscript/styleを除去し、タグを取り除いた可視テキストに変換する。
 * Geminiへの入力トークンを抑えるため、一定の長さで打ち切る。 */
export function stripHtmlToText(html: string, maxLength = 15000): string {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  const text = withoutScripts
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return text.slice(0, maxLength)
}

const PROMPT = `以下は音楽フェスティバルの公式サイトページから抽出したテキストです。
出演アーティスト(ラインナップ)の一覧を抽出してください。

以下のルールに従ってください:
- 実際に出演者として記載されている名前のみを抽出する(スポンサー名、主催者名、
  スタッフ名、ナビゲーションメニューの項目は含めない)
- ステージ名が明記されていればstageに入れる(不明なら省略)
- 開催日・出演時刻に関する表記がアーティスト名の近くにあれば、そのままの表記で
  day_or_time_labelに入れる(例: "DAY1 19:00-19:40"。正確な日付形式への変換はしない)
- 同じアーティストが複数箇所に出てくる場合は1回だけ含める
- 出演者情報が見つからない場合は空の配列を返す`

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      artist_name: { type: Type.STRING },
      stage: { type: Type.STRING },
      day_or_time_label: { type: Type.STRING },
    },
    required: ['artist_name'],
  },
}

type GeminiEntry = {
  artist_name?: unknown
  stage?: unknown
  day_or_time_label?: unknown
}

const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 2_000

function isRetryableStatus(status: unknown): boolean {
  return status === 503 || status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function extractFestivalLineupWithGemini(pageText: string): Promise<FestivalLineupCandidate[]> {
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
        contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\n---\n${pageText}` }] }],
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

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return (parsed as GeminiEntry[])
    .filter((e) => typeof e?.artist_name === 'string' && e.artist_name.trim())
    .map((e) => ({
      artist_name: (e.artist_name as string).trim(),
      stage: typeof e.stage === 'string' && e.stage.trim() ? e.stage.trim() : undefined,
      day_or_time_label:
        typeof e.day_or_time_label === 'string' && e.day_or_time_label.trim() ? e.day_or_time_label.trim() : undefined,
    }))
}
