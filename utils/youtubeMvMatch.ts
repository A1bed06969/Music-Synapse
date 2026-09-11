// utils/youtubeMvMatch.ts
//
// アーティストの公式YouTubeチャンネル内の動画一覧(タイトルのみ)から、
// DB上のトラックタイトルに対応する「本当のMV」らしい動画を探す純粋関数。
// チャンネル自体が確定済み(Geminiで公式と判定済み)という前提のため、
// ここでは「同じ曲の別バージョン(Lyric/Cover/Live等)を取り違えない」
// ことだけに集中する。該当動画が無い/複数あって決め手が無い場合はnullを
// 返し、誤った動画を反映するよりトラックを未設定のままにすることを優先する。

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

// 動画タイトルの末尾に付く装飾(括弧書き)。全角/半角どちらにも対応する。
const BRACKET_SUFFIX = /[(（\[【][^)）\]】]*[)）\]】]\s*$/

function stripTrailingBrackets(title: string): string {
  let t = title
  // 末尾の括弧書きを繰り返し取り除く(例: 「曲名 (Official Video) (4K)」の両方)
  while (BRACKET_SUFFIX.test(t)) {
    t = t.replace(BRACKET_SUFFIX, '').trim()
  }
  return t
}

// 先頭の引用符括弧: 「曲名」MV😵‍💫 のように、曲名側ではなく動画タイトル側の
// 装飾が先頭に来る日本語アーティストのチャンネル慣習(Ado公式チャンネルの実タイトル
// を調査して確認)。末尾括弧の除去だけでは拾えないため別途抽出する。
const LEADING_QUOTE = /^[「『]([^」』]+)[」』]/
// 先頭の隅付き括弧/角括弧: 【Ado】曲名 のような「アーティスト名プレフィックス+曲名」
// 慣習。中身がアーティスト名かどうかは判定せず、機械的に「先頭の括弧を取り除いた残り」
// を曲名候補として扱う(この関数は曲名を知らないため、呼び出し側の完全一致判定に委ねる)。
const LEADING_BRACKET_PREFIX = /^[【[]([^】\]]+)[】\]]\s*(.+)$/

/** 動画タイトルから「曲の核となる部分」の候補を複数抽出する。日本語アーティストの
 * チャンネルは装飾の位置(先頭/末尾)も種類(引用符括弧/隅付き括弧/丸括弧)もまちまち
 * なため、単一の正規化ルールではなく複数パターンを試して候補を集める。 */
function extractCoreCandidates(rawTitle: string): string[] {
  const candidates = new Set<string>()

  candidates.add(normalizeText(stripTrailingBrackets(rawTitle)))

  const leadingQuote = rawTitle.match(LEADING_QUOTE)
  if (leadingQuote) candidates.add(normalizeText(leadingQuote[1]))

  const leadingBracket = rawTitle.match(LEADING_BRACKET_PREFIX)
  if (leadingBracket) candidates.add(normalizeText(stripTrailingBrackets(leadingBracket[2])))

  candidates.delete('')
  return [...candidates]
}

// 公式MVではない別バージョンを示す語。英語表記・日本語表記の両方を見る。
const NEGATIVE_KEYWORDS = [
  'lyric',
  'lyrics',
  '歌詞',
  'cover',
  'カバー',
  'live',
  'ライブ',
  'ライヴ',
  'acoustic',
  'アコースティック',
  'instrumental',
  'インストゥルメンタル',
  'インスト',
  'remix',
  'リミックス',
  'reaction',
  'リアクション',
  'interview',
  'インタビュー',
  'teaser',
  'ティーザー',
  'trailer',
  'トレーラー',
  'karaoke',
  'カラオケ',
  'shorts',
  'spoken',
]

/** 動画タイトルが「別バージョン」を示す語を含むかどうか。大文字小文字を無視する。 */
export function hasNegativeMvKeyword(videoTitle: string): boolean {
  const lower = videoTitle.toLowerCase()
  return NEGATIVE_KEYWORDS.some((kw) => lower.includes(kw))
}

const POSITIVE_KEYWORDS = ['official music video', 'official video', 'official mv', "official m/v", 'mv']

/** 動画タイトルが「公式MV」を明示する語を含むかどうか。 */
function hasPositiveMvKeyword(videoTitle: string): boolean {
  const lower = videoTitle.toLowerCase()
  return POSITIVE_KEYWORDS.some((kw) => lower.includes(kw))
}

export type MvCandidateVideo = { videoId: string; title: string }

/** トラックタイトルと、確定済みチャンネルの動画タイトル一覧を照合し、
 * そのトラックの公式MVと思われる動画を1件だけ返す。複数の動画が核となる
 * タイトルで一致してしまい、かつどちらが公式MVか決め手が無い場合はnullを
 * 返す(誤反映を避けるため、取りこぼしを許容する)。 */
export function findBestMvMatch(trackTitle: string, videos: MvCandidateVideo[]): MvCandidateVideo | null {
  const normalizedTrack = normalizeText(stripTrailingBrackets(trackTitle))
  if (!normalizedTrack) return null

  const candidates = videos.filter((v) => {
    if (hasNegativeMvKeyword(v.title)) return false
    return extractCoreCandidates(v.title).includes(normalizedTrack)
  })

  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // 複数残った場合、「公式MV」を明示する語を持つ候補が1件だけならそれを採用する
  const positiveOnes = candidates.filter((v) => hasPositiveMvKeyword(v.title))
  if (positiveOnes.length === 1) return positiveOnes[0]

  return null
}
