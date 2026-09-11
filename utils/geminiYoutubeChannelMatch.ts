// utils/geminiYoutubeChannelMatch.ts
//
// YouTubeのチャンネル検索候補から、指定アーティスト本人が運営する公式チャンネルを
// Geminiに判定させる。utils/geminiRadioPickMatch.tsと同じ閾値運用の考え方だが、
// こちらは候補が「本人の公式チャンネルかどうか」の二択に近い判定のため、
// needs_review的な中間状態は設けず、確信度が閾値未満なら呼び出し側で
// 「候補なし」として扱う(スクリプト側の閾値と合わせてutils/youtubeMvMatch.tsは
// 関与しない、チャンネル特定だけの判定)。
import { GoogleGenAI, Type } from '@google/genai'
import type { YoutubeChannelDetail } from './youtubeChannelSearch'

const MODEL = 'gemini-3.1-flash-lite'

export type YoutubeChannelJudgement = {
  channelIndex: number | null
  confidence: number
  reasoning: string
}

function buildPrompt(artistName: string, candidates: YoutubeChannelDetail[]): string {
  const candidatesBlock = candidates
    .map(
      (c, i) =>
        `[${i}] チャンネル名: 「${c.title}」 / 登録者数: ${c.subscriberCount ?? '非公開'} / 概要: ${c.description.slice(0, 200) || '(概要なし)'}`
    )
    .join('\n')

  return `音楽アーティスト「${artistName}」本人(またはそのレコード会社・マネジメント)が運営する
公式YouTubeチャンネルを、以下の候補の中から特定してください。ミュージックビデオの
有無ではなく「本人の公式チャンネルかどうか」で判定してください。

候補一覧:
${candidatesBlock}

判定ルール:
- チャンネル名がアーティスト名と一致・ほぼ一致していても、ファンが運営する二次チャンネルや
  カバー専門チャンネル、全く無関係な同名チャンネルである可能性を考慮すること
- 概要欄に公式サイトへのリンクや「Official」「Vevo」等の記載があれば確信度を上げる材料にする
- 該当する候補が無い、またはどれも公式と断定できない場合はchannelIndexをnullにすること
- reasoningには判定の決め手になった具体的な情報を日本語で簡潔に書く

confidenceは0.0〜1.0の数値で返してください。`
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    channelIndex: { type: Type.INTEGER, nullable: true },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ['confidence', 'reasoning'],
}

// gemini-3.1-flash-liteは高負荷時に503(UNAVAILABLE)を頻繁に返す実態が確認できた
// ため、既存のgeminiRadioPickMatch.ts等と同じリトライ回数・指数バックオフにする
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 3_000

function isRetryableStatus(status: unknown): boolean {
  return status === 503 || status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function judgeYoutubeChannelWithGemini(
  artistName: string,
  candidates: YoutubeChannelDetail[]
): Promise<YoutubeChannelJudgement> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。')
  }
  if (candidates.length === 0) {
    return { channelIndex: null, confidence: 0, reasoning: '候補が0件のため判定不可' }
  }

  const ai = new GoogleGenAI({ apiKey })
  const prompt = buildPrompt(artistName, candidates)

  let lastErr: unknown
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
        await sleep(RETRY_DELAY_MS * attempt)
        continue
      }
      throw err
    }
  }
  if (!response) throw lastErr

  const text = response.text
  if (!text) {
    return { channelIndex: null, confidence: 0, reasoning: 'Geminiから応答がありませんでした' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { channelIndex: null, confidence: 0, reasoning: 'Geminiの応答をJSONとして解釈できませんでした' }
  }

  const p = parsed as { channelIndex?: unknown; confidence?: unknown; reasoning?: unknown }
  const channelIndex =
    typeof p.channelIndex === 'number' && p.channelIndex >= 0 && p.channelIndex < candidates.length
      ? p.channelIndex
      : null
  const confidence = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0
  const reasoning = typeof p.reasoning === 'string' && p.reasoning.trim() ? p.reasoning.trim() : '(理由の取得に失敗)'

  return { channelIndex, confidence, reasoning }
}
