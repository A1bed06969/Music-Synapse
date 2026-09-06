// utils/geminiRadioPickMatch.ts
//
// ラジオ/TV番組のパワープレイ選曲(artist_name+track_title)を、Apple Music候補の
// 中からGeminiに判定させる。utils/geminiAlbumMatch.tsと同じ閾値運用(0.9以上で
// 自動適用、0.5〜0.89は要確認)。
//
// アルバムマッチングと違い、選出には局名・番組名・選出日・国内外フラグという
// 文脈情報が必ず揃っているため、これを判断材料として明示的に渡す。ただし
// is_domesticは番組側の入力(表記ゆれ・誤入力もありうる)なので、これだけを
// 理由に候補を除外しないよう明示的に指示する。
import { GoogleGenAI, Type } from '@google/genai'

const MODEL = 'gemini-3.1-flash-lite'

export type RadioPickCandidate = {
  index: number
  trackId?: number
  collectionId: number
  trackName?: string
  collectionName: string
  artistName: string
  artworkUrl?: string
}

export type RadioPickContext = {
  stationName: string
  campaignName: string | null
  isDomestic: boolean | null
  pickedDate: string
}

export type RadioPickJudgement = {
  candidateIndex: number | null
  confidence: number
  reasoning: string
}

function buildPrompt(artistName: string, trackTitle: string, candidates: RadioPickCandidate[], context: RadioPickContext): string {
  const candidatesBlock = candidates.map((c) => `[${c.index}] 「${c.trackName ?? c.collectionName}」 / ${c.artistName}`).join('\n')

  const domesticLabel = context.isDomestic === true ? '国内' : context.isDomestic === false ? '海外' : '不明'

  return `ラジオ/TV番組の選曲情報を、Apple Musicの候補の中から特定してください。

選出情報:
- 局・番組: ${context.stationName}${context.campaignName ? `(${context.campaignName})` : ''}
- 選出日: ${context.pickedDate}
- 国内/海外区分(番組側の分類。入力ミスの可能性もある参考情報): ${domesticLabel}
- アーティスト名: ${artistName}
- 曲名: ${trackTitle}

候補一覧:
${candidatesBlock}

判定ルール:
- アーティスト名・曲名が対象と明確に別人・別表記(空似)の候補は確信度を必ず低くすること(0.5未満)
- 国内/海外区分は番組側の入力ミスもありうる参考情報に過ぎないため、これだけを理由に
  候補を除外しない。ただし他の材料と合わせて矛盾が大きい場合の判断材料にはしてよい
- ライブ音源・リミックス・カバー等、候補のタイトル表記に(Live)(Remix)等の
  別バージョンを示す語が明記されている場合は、それが選出内容だと明確でない限り
  確信度を下げること
- 該当する候補が無い、または全候補が明らかに別物の場合はcandidateIndexをnullにする
- reasoningには判定の決め手になった具体的な情報を日本語で簡潔に書く

confidenceは0.0〜1.0の数値で返してください。`
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    candidateIndex: { type: Type.INTEGER, nullable: true },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ['confidence', 'reasoning'],
}

// gemini-3.1-flash-liteは高負荷時に503(UNAVAILABLE)を頻繁に返す実態が確認できた
// ため、リトライ回数を増やし指数バックオフにする(utils/geminiAlbumMatch.tsと同じ対応)
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 3_000

function isRetryableStatus(status: unknown): boolean {
  return status === 503 || status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function judgeRadioPickMatchWithGemini(
  artistName: string,
  trackTitle: string,
  candidates: RadioPickCandidate[],
  context: RadioPickContext
): Promise<RadioPickJudgement> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。')
  }
  if (candidates.length === 0) {
    return { candidateIndex: null, confidence: 0, reasoning: '候補が0件のため判定不可' }
  }

  const ai = new GoogleGenAI({ apiKey })
  const prompt = buildPrompt(artistName, trackTitle, candidates, context)

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
    return { candidateIndex: null, confidence: 0, reasoning: 'Geminiから応答がありませんでした' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { candidateIndex: null, confidence: 0, reasoning: 'Geminiの応答をJSONとして解釈できませんでした' }
  }

  const p = parsed as { candidateIndex?: unknown; confidence?: unknown; reasoning?: unknown }
  const candidateIndex =
    typeof p.candidateIndex === 'number' && candidates.some((c) => c.index === p.candidateIndex) ? p.candidateIndex : null
  const confidence = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0
  const reasoning = typeof p.reasoning === 'string' && p.reasoning.trim() ? p.reasoning.trim() : '(理由の取得に失敗)'

  return { candidateIndex, confidence, reasoning }
}
