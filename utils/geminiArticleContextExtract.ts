// utils/geminiArticleContextExtract.ts
//
// キュレーション企画(NME 100等)の元記事ページから、アーティストごとの紹介文
// コンテキスト(出身地・似ている系統のアーティスト・代表曲・紹介文)をGeminiで
// 抽出する。utils/geminiFestivalLineupExtract.tsと同じ方針(無料枠内で収まる
// gemini-3.1-flash-lite、可視テキストをまるごとLLMに読ませる)。
//
// NME.com等のNext.js製サイトは、記事本文が<script>self.__next_f.push([...])</script>
// というReact Server Componentsのストリーミングペイロードにエスケープされた文字列
// として埋め込まれており、通常のHTMLタグ除去(script除去を含む)では本文が
// 丸ごと消えてしまう。そのため専用の抽出関数(extractNextJsFlightText)で
// このペイロードだけを先にデコードしてから、通常のタグ除去にかける。
import { GoogleGenAI, Type } from '@google/genai'

const MODEL = 'gemini-3.1-flash-lite'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

export type ArtistArticleContext = {
  artistName: string
  from?: string
  forFansOf?: string
  keyTrack?: string
  bioSnippet?: string
}

export async function fetchArticlePageHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`ページ取得に失敗しました (${res.status})`)
  }
  return res.text()
}

/** Next.jsのReact Server Componentsストリーミングペイロード
 * (self.__next_f.push([行番号, "エスケープされた文字列"]))から、
 * 記事本文として埋め込まれた文字列だけを取り出して連結する。
 * 該当ペイロードが無いページ(旧来のSSR/静的HTML)ではそのまま元のHTMLを返す
 * (呼び出し側のstripArticleTextでどちらも同じくタグ除去にかけられる)。 */
export function extractNextJsFlightText(html: string): string {
  const pattern = /self\.__next_f\.push\(\[(\d+),("(?:[^"\\]|\\.)*")\]\)/g
  const chunks: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    try {
      const decoded = JSON.parse(match[2]) as string
      chunks.push(decoded)
    } catch {
      // 個別チャンクのJSONが壊れていてもスキップして続行する
    }
  }
  return chunks.length > 0 ? chunks.join('\n') : html
}

/** タグ除去・HTMLエンティティのデコードを行い、Geminiへの入力用テキストにする。
 * 記事1本(NME 100は100組分)を丸ごと渡すため、フェス抽出(15000字)より
 * 大きめの上限にする(Geminiの入力コンテキストに対して十分小さい)。 */
export function stripArticleText(html: string, maxLength = 300000): string {
  const flightText = extractNextJsFlightText(html)
  const withoutComments = flightText.replace(/<!--[\s\S]*?-->/g, '')
  const withoutScripts = withoutComments.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  const text = withoutScripts
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return text.slice(0, maxLength)
}

const PROMPT = `以下は音楽メディアの記事ページから抽出したテキストです。
「注目の新人アーティスト」を紹介する記事です。書式は記事によって様々で、
アーティストごとに詳しい紹介文がある形式(出身地・似ている系統・代表曲の
見出し付き)の場合もあれば、「Aziya (UK) Lambrini Girls (UK) Balu Brigada
(New Zealand)」のように名前と出身国だけを列挙しているだけの場合もある。
どちらの形式でも、記事内で選出対象として言及されている全アーティストを
漏れなく対象にすること(数行の紹介がある一部の代表例だけでなく、単純な
列挙部分に出てくる名前も同様に拾う)。

各アーティストについて、分かる範囲で次の情報を抽出してください:

- artistName: アーティスト名(見出しや列挙で使われている表記のまま)
- from: 出身地・出身国(「From:」等の見出しの直後や、名前の後の括弧書き
  "(UK)"のような表記から。分からなければこのフィールド自体を省略する)
- forFansOf: 似ている系統として挙げられているアーティスト名(「For fans of:」
  等の見出しの直後。カンマ区切りの表記のままでよい。分からなければ省略)
- keyTrack: 代表曲として挙げられている曲名(「Key track」等の見出しがあれば。分からなければ省略)
- bioSnippet: 紹介文の本文から、アルバム名・曲名・経歴等が分かる範囲を200字程度で
  抜粋する(丸ごと書き写す必要はない。要約せず、本文にある固有名詞はそのまま残すこと。
  紹介文自体が無い場合は省略)

以下のルールに従ってください:
- 実際にアーティスト紹介・列挙として書かれているものだけを対象にする(ナビゲーション、
  広告、無関係な他記事へのリンク一覧は含めない)
- 同じアーティストが複数箇所に出てくる場合は1回だけ含める
- 各フィールドは、情報が本文に無い場合は「n/a」「不明」等のプレースホルダーを
  入れず、そのフィールド自体を省略すること
- 情報が見つからない場合は空の配列を返す`

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      artistName: { type: Type.STRING },
      from: { type: Type.STRING },
      forFansOf: { type: Type.STRING },
      keyTrack: { type: Type.STRING },
      bioSnippet: { type: Type.STRING },
    },
    required: ['artistName'],
  },
}

type GeminiEntry = {
  artistName?: unknown
  from?: unknown
  forFansOf?: unknown
  keyTrack?: unknown
  bioSnippet?: unknown
}

// gemini-3.1-flash-liteは高負荷時に503(UNAVAILABLE)を頻繁に返す実態が確認できた
// (数千字の短文でも起きうる)ため、リトライ回数を増やし指数バックオフにする
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 3_000

function isRetryableStatus(status: unknown): boolean {
  return status === 503 || status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const PLACEHOLDER_VALUES = new Set(['n/a', 'na', 'unknown', '不明', 'なし', '無し', '-', '—'])

function cleanField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return undefined
  return trimmed
}

export async function extractArticleContextWithGemini(pageText: string): Promise<ArtistArticleContext[]> {
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
        await sleep(RETRY_DELAY_MS * attempt)
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
    .filter((e) => typeof e?.artistName === 'string' && e.artistName.trim())
    .map((e) => ({
      artistName: (e.artistName as string).trim(),
      from: cleanField(e.from),
      forFansOf: cleanField(e.forFansOf),
      keyTrack: cleanField(e.keyTrack),
      bioSnippet: cleanField(e.bioSnippet),
    }))
}

// NME 100等、1記事に100組分の紹介文が含まれるページは全文で20万字を超え、
// 1回のgenerateContent呼び出しでは503(高負荷)が安定して発生することを実測で
// 確認した(数千字程度の短文では問題なく成功する)。そのため一定サイズごとに
// 分割し、アーティスト紹介の境界をまたいでも次のチャンクで拾えるよう
// 少しオーバーラップさせてから個別に抽出し、名前で重複排除して結合する。
const CHUNK_SIZE = 40_000
const CHUNK_OVERLAP = 2_000

function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length)
    chunks.push(text.slice(start, end))
    if (end >= text.length) break
    start = end - CHUNK_OVERLAP
  }
  return chunks
}

/** 長い記事(NME 100等)向けの分割版。stripArticleTextの出力をそのまま渡す。 */
export async function extractArticleContextWithGeminiChunked(pageText: string): Promise<ArtistArticleContext[]> {
  const chunks = splitIntoChunks(pageText)
  const seen = new Map<string, ArtistArticleContext>()
  for (const chunk of chunks) {
    let results: ArtistArticleContext[]
    try {
      results = await extractArticleContextWithGemini(chunk)
    } catch (err) {
      console.error('チャンクの抽出に失敗しました(リトライ上限到達、このチャンクはスキップ):', (err as Error).message)
      continue
    }
    for (const r of results) {
      const key = r.artistName.trim().toUpperCase()
      // 既に(オーバーラップ分の重複等で)拾えているものは、情報がより多い方を残す
      const existing = seen.get(key)
      if (!existing || Object.keys(r).length > Object.keys(existing).length) {
        seen.set(key, r)
      }
    }
  }
  return Array.from(seen.values())
}
