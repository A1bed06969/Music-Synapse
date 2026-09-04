// utils/geminiAlbumMatch.ts
//
// 未マッチのスタブアルバム(タワレコメン・これは聴いておきたい不滅の名盤・
// ディスクガイド由来)を、matchAlbumsWithCandidates(utils/discGuideImport.ts)が
// 返す候補の中からGeminiに判定させる。
//
// アーティストマッチング(utils/geminiArtistMatch.ts)と異なり、これらの企画は
// 元記事のような追加コンテキスト(出身地・代表曲等)を持たない。代わりに
// matchAlbumsWithCandidates側で既に計算済みのsimilarity(タイトル/アーティスト名の
// トライグラム類似度、または簡易文字列一致による0.35/0.6/0.9の3段階スコア)を
// 判定材料として渡す。類似度だけでは誤マッチが起きる実例があった
// (「1999」のような短い/ありふれたタイトルで無関係な作品が高スコアになった
// 「1999」誤登録事故)ため、類似度が高くてもアーティスト名が明確に違う場合は
// 確信度を下げるよう明示的に指示する。
import { GoogleGenAI, Type } from '@google/genai'

const MODEL = 'gemini-3.1-flash-lite'

export type AlbumMatchCandidate = {
  index: number
  id: string
  title: string
  artistName: string
  similarity: number
  source: 'local' | 'apple_music'
}

export type AlbumMatchJudgement = {
  candidateIndex: number | null
  confidence: number
  reasoning: string
}

export type AlbumMatchContext = {
  label?: string
  releaseYear?: number
}

function buildPrompt(
  targetTitle: string,
  targetArtistName: string,
  rankingContext: string,
  candidates: AlbumMatchCandidate[],
  context?: AlbumMatchContext
): string {
  const candidatesBlock = candidates
    .map((c) => {
      const sourceLabel = c.source === 'local' ? '自社DB既存' : 'Apple Music'
      return `[${c.index}] 「${c.title}」 / ${c.artistName} / 出典: ${sourceLabel} / 文字列類似度: ${(c.similarity * 100).toFixed(0)}%`
    })
    .join('\n')

  const contextBlock =
    context?.label || context?.releaseYear
      ? `対象について分かっている情報:
${context.label ? `- レーベル: ${context.label}` : ''}
${context.releaseYear ? `- 発売年: ${context.releaseYear}年` : ''}

`
      : ''

  return `「${rankingContext}」に選出されたアルバム「${targetTitle}」(アーティスト: ${targetArtistName})を、候補の中から特定してください。

${contextBlock}候補一覧:
${candidatesBlock}

判定ルール:
- 文字列類似度はタイトル・アーティスト名の表記の近さを機械的に測った参考値に
  過ぎない。類似度が高くても、アーティスト名が対象と明確に別人・別表記(空似)の
  場合は誤マッチの可能性が高いので確信度を必ず低くすること(0.5未満)
- 特に対象のタイトルが「1999」「Love」のような短い/ありふれた語の場合、
  類似度スコアだけでは無関係な別作品と誤って高スコアになりやすいので、
  アーティスト名の一致を最優先の判断材料にすること
- 発売年が分かっている場合、候補のタイトルに「リマスター」「Remaster」
  「Deluxe Edition」等の版違いを示す語が無くても、あまりに年代がかけ離れた
  再発盤・ベスト盤である可能性を考慮すること(確実に別物と言い切れる場合のみ
  確信度を下げる。年式情報だけで機械的に除外はしない)
- 該当する候補が無い、または全候補が明らかに別作品の場合はcandidateIndexをnullにする
- reasoningには判定の決め手になった具体的な情報(アーティスト名の一致度・
  類似度・出典等)を日本語で簡潔に書く

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
// ため、リトライ回数を増やし指数バックオフにする(utils/geminiArtistMatch.tsと同じ対応)
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 3_000

function isRetryableStatus(status: unknown): boolean {
  return status === 503 || status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function judgeAlbumMatchWithGemini(
  targetTitle: string,
  targetArtistName: string,
  rankingContext: string,
  candidates: AlbumMatchCandidate[],
  context?: AlbumMatchContext
): Promise<AlbumMatchJudgement> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。')
  }
  if (candidates.length === 0) {
    return { candidateIndex: null, confidence: 0, reasoning: '候補が0件のため判定不可' }
  }

  const ai = new GoogleGenAI({ apiKey })
  const prompt = buildPrompt(targetTitle, targetArtistName, rankingContext, candidates, context)

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

  return { candidateIndex: candidateIndex ?? null, confidence, reasoning }
}
