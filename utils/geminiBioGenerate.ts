// アーティスト紹介文(bio)の自動生成。utils/geminiRadioPickMatch.ts等と同じ
// gemini-3.1-flash-lite + リトライ構成を流用するが、判定(候補から選ぶ)ではなく
// 生成タスクのため確信度スコアという概念は無く、成功/情報不足の2値のみを扱う。
// ハルシネーション対策として、渡した事実・ソーステキストに無い情報を書き加えない
// よう明示的に指示し、情報が薄すぎる場合はGemini自身に"INSUFFICIENT"を返させる。
import { GoogleGenAI, Type } from '@google/genai'

const MODEL = 'gemini-3.1-flash-lite'

export type BioGenerationFacts = {
  artistName: string
  genreNames: string[]
  formedYear: number | null
  originPrefecture: string | null
  hometownCity: string | null
}

export type BioGenerationResult = { status: 'generated'; bio: string } | { status: 'declined' }

// 分量・トーンの実例(藤井風、386字→165字に手動短縮・承認済み)。目標文字数を
// 具体的に示すため、プロンプトにそのまま埋め込む。
const EXAMPLE_BIO =
  '岡山県里庄町出身のシンガーソングライター/ピアニスト。幼少期からピアノに親しみ、YouTubeのカバー動画で注目を集めた。2019年「何なんw」で活動を本格化し、2020年に1stアルバム『HELP EVER HURT NEVER』を発表。卓越した演奏と岡山弁を交えた歌詞、ジャンルを横断するサウンドで国内外から支持を集めている。'

function buildBioPrompt(facts: BioGenerationFacts, sourceText: string, sourceType: 'article_context' | 'wikidata'): string {
  const genreLine = facts.genreNames.length > 0 ? `ジャンル: ${facts.genreNames.join('、')}` : null
  const formedLine = facts.formedYear ? `活動開始/結成年: ${facts.formedYear}年` : null
  const originLine = facts.originPrefecture
    ? `出身: ${facts.originPrefecture}`
    : facts.hometownCity
      ? `出身: ${facts.hometownCity}`
      : null
  const factsBlock =
    [genreLine, formedLine, originLine].filter((line): line is string => line !== null).join('\n') || '(構造化データなし)'
  const sourceLabel = sourceType === 'article_context' ? '編集部が抽出した紹介記事の断片' : 'Wikipediaの冒頭説明'

  return `音楽データベースサイトに掲載する、アーティスト「${facts.artistName}」の紹介文を書いてください。

参考にできる情報は以下の2種類だけです。ここに書かれていない情報を、一般的な知識や推測で補って書き加えることは絶対にしないでください。

【データベース上の既知の事実】
${factsBlock}

【${sourceLabel}】
${sourceText}

執筆ルール:
- 日本語で150〜200字程度(厳密でなくてよいが大きく外れないこと)
- 経歴と特徴を簡潔にまとめる文体。以下は分量・トーンの実例です:
  「${EXAMPLE_BIO}」
- 見出しや箇条書きは使わず、地の文のみ
- 上記の情報だけでは150字に満たない紹介文しか書けない、あるいは経歴の実態が分からない場合は、無理に書かずstatusを"INSUFFICIENT"にしてください

statusが"GENERATED"の場合のみbioに紹介文を入れてください。`
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ['GENERATED', 'INSUFFICIENT'] },
    bio: { type: Type.STRING, nullable: true },
  },
  required: ['status'],
}

export function parseGeminiBioResponse(text: string): BioGenerationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { status: 'declined' }
  }
  const p = parsed as { status?: unknown; bio?: unknown }
  if (p.status === 'GENERATED' && typeof p.bio === 'string' && p.bio.trim().length > 0) {
    return { status: 'generated', bio: p.bio.trim() }
  }
  return { status: 'declined' }
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

export async function generateArtistBioWithGemini(
  facts: BioGenerationFacts,
  sourceText: string,
  sourceType: 'article_context' | 'wikidata'
): Promise<BioGenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。')
  }

  const ai = new GoogleGenAI({ apiKey })
  const prompt = buildBioPrompt(facts, sourceText, sourceType)

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
  if (!text) return { status: 'declined' }
  return parseGeminiBioResponse(text)
}
