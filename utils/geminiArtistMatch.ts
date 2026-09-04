// utils/geminiArtistMatch.ts
//
// 未マッチのスタブアーティスト(名前のみ)を、Apple Music検索候補の中から
// Geminiに判定させる。candidatesは既存のsearchAppleMusicArtistForStub
// (app/admin/data/artists/unmatched/actions.ts)が返すもの(最大5件)を想定。
//
// 同名・類似名の別人が複数候補に並ぶケース(例: 「Ciel」でヒップホップ/ラップ・
// J-Pop・ロックの別人が同時に出る)が実際にある。名前の一致だけでは区別できない
// ため、articleContext(元記事から抽出した出身地・似ている系統・代表曲)と
// candidateDiscography(各候補自身のApple Music上のデビュー年・代表アルバム名)
// を判定材料として渡す。articleContextが無い場合や、複数候補が実質見分けが
// つかない場合は、確信度を低く返すよう明示的に指示する(同名多数=分からない、
// と正直に言わせるのが安全側の設計)。
import { GoogleGenAI, Type } from '@google/genai'

const MODEL = 'gemini-3.1-flash-lite'

export type MatchCandidate = {
  index: number
  artistName: string
  primaryGenreName?: string
  country: string
  /** 候補自身のApple Music上の最古リリース年(近似デビュー年) */
  earliestReleaseYear: number | null
  /** 候補自身の代表アルバム名(最大5件) */
  albumTitles: string[]
}

export type ArticleContext = {
  from?: string
  forFansOf?: string
  keyTrack?: string
  bioSnippet?: string
}

export type ArtistMatchJudgement = {
  candidateIndex: number | null
  confidence: number
  reasoning: string
}

function buildPrompt(
  targetName: string,
  rankingContext: string,
  articleContext: ArticleContext | null,
  candidates: MatchCandidate[]
): string {
  const contextBlock = articleContext
    ? `対象アーティストについて、選出元記事から分かっている情報:
${articleContext.from ? `- 出身地: ${articleContext.from}` : ''}
${articleContext.forFansOf ? `- 似ている系統のアーティスト: ${articleContext.forFansOf}` : ''}
${articleContext.keyTrack ? `- 代表曲: ${articleContext.keyTrack}` : ''}
${articleContext.bioSnippet ? `- 紹介文: ${articleContext.bioSnippet}` : ''}`
    : '対象アーティストについて、選出元記事からの追加情報はありません(名前のみ)。'

  const candidatesBlock = candidates
    .map((c) => {
      const albums = c.albumTitles.length > 0 ? c.albumTitles.join('、') : '(アルバム情報なし)'
      const year = c.earliestReleaseYear ? `${c.earliestReleaseYear}年頃` : '不明'
      return `[${c.index}] ${c.artistName}${c.primaryGenreName ? ` (${c.primaryGenreName})` : ''} / Apple Music ${c.country} / 活動開始目安: ${year} / 代表作: ${albums}`
    })
    .join('\n')

  return `「${rankingContext}」に選出された新人アーティスト「${targetName}」を、Apple Musicの候補の中から特定してください。

${contextBlock}

候補一覧:
${candidatesBlock}

判定ルール:
- 候補の中に同一または酷似した名前を持つ、明らかに別人と思われるものが複数ある場合、
  出身地・代表曲・活動開始年などの決め手となる情報が無い限り確信度を必ず低くすること
  (0.5未満)。同名多数の状態を「たぶんこれだろう」で高確信度にしてはいけない
- 「新人・注目株」を紹介する企画である前提を踏まえ、既に何年も活動している大御所
  アーティストと同名の候補は、他に決め手が無い限り別人の可能性が高いと考えること
- 選出元記事の出身地・代表曲・紹介文と、候補の情報(活動開始年・代表作)が一致する
  ほど確信度を上げてよい
- 該当する候補が無い、または全候補が明らかに別人の場合はcandidateIndexをnullにする
- reasoningには判定の決め手になった具体的な情報を日本語で簡潔に書く(「名前が一致
  するため」のような理由だけでは不十分)

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
// ため、リトライ回数を増やし指数バックオフにする(utils/geminiArticleContextExtract.tsと同じ対応)
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 3_000

function isRetryableStatus(status: unknown): boolean {
  return status === 503 || status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function judgeArtistMatchWithGemini(
  targetName: string,
  rankingContext: string,
  articleContext: ArticleContext | null,
  candidates: MatchCandidate[]
): Promise<ArtistMatchJudgement> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。')
  }
  if (candidates.length === 0) {
    return { candidateIndex: null, confidence: 0, reasoning: '候補が0件のため判定不可' }
  }

  const ai = new GoogleGenAI({ apiKey })
  const prompt = buildPrompt(targetName, rankingContext, articleContext, candidates)

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
