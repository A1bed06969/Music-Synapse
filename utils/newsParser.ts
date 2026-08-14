import { XMLParser } from 'fast-xml-parser'
import type { NewsSource } from './newsFeeds'

export type NewsCategory = 'release' | 'live' | 'interview' | 'other'

export const NEWS_CATEGORY_LABEL: Record<NewsCategory, string> = {
  release: '新譜・リリース',
  live: 'ライブ・イベント',
  interview: 'インタビュー',
  other: 'その他',
}

export type NewsItem = {
  id: string
  source: string
  title: string
  link: string
  thumbnailUrl: string | null
  publishedAt: string // ISO文字列
  author: string | null
  category: NewsCategory
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

// RSS/Atomのタグ構成はソースごとにバラつくため、パース結果は動的な構造として扱う
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = any

const LIVE_KEYWORDS = ['ライブ', 'LIVE', 'ツアー', 'TOUR', 'フェス', 'FES', '来日', '公演', '出演', 'イベント']
const INTERVIEW_KEYWORDS = ['インタビュー', 'INTERVIEW']
const RELEASE_KEYWORDS = ['リリース', '配信開始', '発売', '新譜', 'アルバム', 'シングル', 'EP', 'MV公開', 'ミュージックビデオ']

// fast-xml-parserはタグに属性がある場合(例: <title type="html">...)、
// テキストの代わりに{ '@_type': 'html', '#text': '...' }のようなオブジェクトを返す。
// どちらの形でも文字列として取り出せるようにする。
function textOf(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return String(node)
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)['#text'])
  }
  return String(node)
}

function classifyCategory(title: string, rawCategories: string[]): NewsCategory {
  const haystack = `${title} ${rawCategories.join(' ')}`
  if (INTERVIEW_KEYWORDS.some((k) => haystack.includes(k))) return 'interview'
  if (LIVE_KEYWORDS.some((k) => haystack.includes(k))) return 'live'
  if (RELEASE_KEYWORDS.some((k) => haystack.includes(k))) return 'release'
  return 'other'
}

function extractThumbnail(raw: XmlNode): string | null {
  const mediaThumbnail = raw['media:thumbnail']
  if (mediaThumbnail) {
    if (typeof mediaThumbnail === 'string') return mediaThumbnail
    if (mediaThumbnail['@_url']) return mediaThumbnail['@_url']
  }

  const enclosure = raw.enclosure
  if (enclosure?.['@_url'] && String(enclosure['@_type'] ?? '').startsWith('image')) {
    return enclosure['@_url']
  }

  // media:thumbnail等が無い場合、本文HTML中の最初の<img>から拾う
  const htmlFields = [raw.description, raw['content:encoded'], raw.summary]
  for (const field of htmlFields) {
    if (field == null) continue
    const html = textOf(field)
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (match) return match[1]
  }
  return null
}

function toStringArray(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) return value.map((v) => String(v))
  return [String(value)]
}

function normalizeAtomEntries(feed: XmlNode, sourceName: string): NewsItem[] {
  const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : []

  return entries.map((entry: XmlNode, i: number) => {
    const link = typeof entry.link === 'object' ? entry.link['@_href'] : entry.link
    const publishedAt = entry.updated ?? entry.published ?? new Date().toISOString()
    const title = textOf(entry.title).trim()
    return {
      id: entry.id ?? link ?? `${sourceName}-${i}`,
      source: sourceName,
      title,
      link: String(link ?? ''),
      thumbnailUrl: extractThumbnail(entry),
      publishedAt: new Date(publishedAt).toISOString(),
      // Atomのauthorはフィード発行元(媒体名)であり個々の書き手ではないため表示しない
      author: null,
      category: classifyCategory(title, []),
    }
  })
}

function normalizeRssItems(channel: XmlNode, sourceName: string): NewsItem[] {
  const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : []

  return items.map((item: XmlNode, i: number) => {
    const categories = toStringArray(item.category)
      .map((c) => c.trim())
      .filter((c) => c && !/^\d+$/.test(c))
    const publishedAt = item.pubDate ?? new Date().toISOString()
    const title = textOf(item.title).trim()
    return {
      id: textOf(item.guid) || textOf(item.link) || `${sourceName}-${i}`,
      source: sourceName,
      title,
      link: textOf(item.link),
      thumbnailUrl: extractThumbnail(item),
      publishedAt: new Date(publishedAt).toISOString(),
      author: item['dc:creator'] ? textOf(item['dc:creator']).trim() : null,
      category: classifyCategory(title, categories),
    }
  })
}

export async function fetchNewsFeed(source: NewsSource): Promise<NewsItem[]> {
  const res = await fetch(source.feedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MusicSynapseBot/1.0)' },
    next: { revalidate: 1800 },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error(`RSS取得エラー(${source.name}): ${res.status}`)
  }
  const xml = await res.text()
  const parsed = parser.parse(xml)

  if (parsed.feed) {
    return normalizeAtomEntries(parsed.feed, source.name)
  }
  if (parsed.rss?.channel) {
    return normalizeRssItems(parsed.rss.channel, source.name)
  }
  return []
}

const MAX_ITEMS_PER_SOURCE = 20

export async function fetchAllNews(sources: NewsSource[]): Promise<{ items: NewsItem[]; failedSources: string[] }> {
  const results = await Promise.allSettled(sources.map((s) => fetchNewsFeed(s)))

  const items: NewsItem[] = []
  const failedSources: string[] = []

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value.slice(0, MAX_ITEMS_PER_SOURCE))
    } else {
      console.error(`ニュース取得失敗(${sources[i].name}):`, result.reason)
      failedSources.push(sources[i].name)
    }
  })

  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  return { items, failedSources }
}

export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const diffMinutes = Math.floor(diffMs / 60000)

  if (diffMinutes < 1) return 'たった今'
  if (diffMinutes < 60) return `${diffMinutes}分前`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}時間前`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}日前`

  const d = new Date(isoDate)
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}
