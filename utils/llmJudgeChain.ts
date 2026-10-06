// utils/llmJudgeChain.ts
//
// utils/gemini*Match.ts各ファイルが個別に持っていた「Geminiを呼ぶ→503はリトライ→
// ダメならエラーを投げる」というほぼ同一のコードを1箇所に集約し、無料枠を
// 使い切った際のフォールバック先を追加する(2026-10-01、ユーザーから「パワープレイ/
// ディスクガイド/キュレーションがGemini頼りなので無料で拡張したい」という要望)。
//
// フォールバック順序:
//   1. gemini-3.5-flash-lite(主力。2026-10-01、ベンチマーク比較で3.1より明確に
//      精度が高いと確認できたため主力に切り替え。SWE-Bench Pro 54.2% vs 38.3%、
//      Terminal-Bench 2.1 54% vs 31%、GDM-MRCR v2 72.2% vs 60.1%)
//   2. gemini-3.1-flash-lite(旧主力。別モデル名 = Google側で別の無料枠バケツとして
//      カウントされるため、1の枠を使い切った後の追加分として使う。2026-10-01時点で
//      API経由のモデル一覧を実際に取得して確認済み — "gemini-3.1-flash"のような
//      素直な名前は存在せず、無印flashの系譜は3.5/3.6/3.7/3.8にジャンプしている。
//      gemini-2.5-flash-liteは新規ユーザー向けには既に廃止済み)
//   3. Groq(Llama 3.3 70B Versatile、完全無料・カード登録不要)
//
// 判定ルール: 503(一時的な過負荷)は同じモデルに対してのみ指数バックオフで
// リトライする。429は「その日の無料枠を使い切った」状態であり、待っても
// その場では回復しないため(2026-09-30の一括検証で26件連続429を確認済み)、
// リトライせず即座に次の層へ進む。
//
// プロンプト構築・レスポンスJSONの解釈(どのフィールドをどう検証するか)は
// 各utils/gemini*Match.tsの責務のまま残す。ここが持つのは「テキストを1つ
// 返す」ところまで。
import { GoogleGenAI, type Schema } from '@google/genai'

const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
// Groqはモデルごとに別々の無料枠(1日のトークン/リクエスト上限)を持つため、上から順に使い、
// 1日の上限に達したモデルは飛ばして次へ進む
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']
// 1日の上限に達したモデルは、この時間が経つまで試さない(長時間動くスクリプトで毎回429を待たないため)
const GROQ_EXHAUSTED_SKIP_MS = 60 * 60_000
const groqExhaustedAt = new Map<string, number>()

class GroqDailyLimitError extends Error {}
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 3_000

/** 設定済みの全プロバイダ(Gemini全モデル+Groq)を試しても応答を得られなかった
 * 状態。呼び出し側は既存のutils/geminiYoutubeChannelMatch.tsのGeminiQuotaExceededError
 * と同じ扱い(「判定に失敗した」ではなく「そもそも試せていない」として、
 * 永続ログに書き込まず処理を打ち切る)にすること。 */
export class AllProvidersExhaustedError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function generateWithGeminiModel(apiKey: string, model: string, prompt: string, schema: Schema): Promise<string | null> {
  const ai = new GoogleGenAI({ apiKey })
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      })
      return response.text ?? null
    } catch (err) {
      const status = (err as { status?: unknown })?.status
      if (status === 503 && attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt)
        continue
      }
      // 429(日次クォータ切れ)はリトライしても回復しないため、ここでこのモデルを
      // 諦めて次の層(呼び出し元のループ)に進む。503もリトライを使い切った場合は
      // 同様に次の層へ。いずれもnullを返すだけで例外にしない(呼び出し元が
      // 次のモデル/プロバイダを試せるようにするため)
      return null
    }
  }
  return null
}

async function generateWithGroq(apiKey: string, model: string, prompt: string): Promise<string> {
  const groqPrompt = `${prompt}\n\n必ず有効なJSONオブジェクトのみで回答してください。説明文やコードブロックのマークダウンは付けないこと。`
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: groqPrompt }],
          response_format: { type: 'json_object' },
          temperature: 0,
          // gpt-oss系は推論トークンも1日の上限に数えられるため、推論を浅くして消費を抑える
          ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
        }),
      })
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        const text = data.choices?.[0]?.message?.content
        if (typeof text === 'string' && text.trim()) return text
        throw new Error('Groqから空の応答が返されました')
      }
      const body = await res.text().catch(() => '')
      if (res.status === 429 && /per day/i.test(body)) {
        throw new GroqDailyLimitError(`Groq ${model}の1日の上限に達しました`)
      }
      if ((res.status === 429 || res.status === 503) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RETRY_DELAY_MS * attempt)
        continue
      }
      throw new Error(`Groq API error ${res.status}: ${body.slice(0, 200)}`)
    } catch (err) {
      if (err instanceof GroqDailyLimitError) throw err
      lastErr = err
      if (attempt >= MAX_ATTEMPTS) throw err
    }
  }
  throw lastErr
}

/** プロンプト1件をGemini(flash-lite→flash)→Groqの順に試し、最初に成功した
 * レスポンステキスト(JSON文字列)を返す。GEMINI_API_KEY未設定ならGeminiを
 * 丸ごとスキップしてGroqから試す。全て失敗した場合はAllProvidersExhaustedError。 */
export async function generateJudgementText(prompt: string, geminiSchema: Schema): Promise<string> {
  const geminiApiKey = process.env.GEMINI_API_KEY
  if (geminiApiKey) {
    for (const model of GEMINI_MODELS) {
      const text = await generateWithGeminiModel(geminiApiKey, model, prompt, geminiSchema)
      if (text) return text
    }
  }

  const groqApiKey = process.env.GROQ_API_KEY
  if (!groqApiKey) {
    throw new AllProvidersExhaustedError(
      `Gemini無料枠(${GEMINI_MODELS.join('/')})を使い切り、GROQ_API_KEYも未設定のため判定できませんでした。`
    )
  }
  const errors: string[] = []
  for (const model of GROQ_MODELS) {
    const exhaustedAt = groqExhaustedAt.get(model)
    if (exhaustedAt && Date.now() - exhaustedAt < GROQ_EXHAUSTED_SKIP_MS) continue
    try {
      return await generateWithGroq(groqApiKey, model, prompt)
    } catch (err) {
      if (err instanceof GroqDailyLimitError) groqExhaustedAt.set(model, Date.now())
      errors.push(`${model}: ${(err as Error).message}`)
    }
  }
  throw new AllProvidersExhaustedError(
    `Gemini無料枠を使い切り、Groqフォールバックも失敗しました: ${errors.join(' / ') || '全Groqモデルが1日の上限に到達済み'}`
  )
}
