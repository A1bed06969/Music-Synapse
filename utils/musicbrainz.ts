const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// MusicBrainz's public API intermittently returns 503 "server is currently
// busy" under load, unrelated to the query itself (confirmed live: the same
// query failed once then succeeded seconds later). Retry a bounded number of
// times before giving up, still respecting the 1 req/sec limit between
// attempts.
async function fetchMusicBrainz(url: string, label: string): Promise<any> {
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(1000)
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (res.ok) {
      return res.json()
    }
    if (res.status === 503 && attempt < maxAttempts) {
      continue
    }
    throw new Error(`MusicBrainz API error (${label}): ${res.status}`)
  }
  throw new Error(`MusicBrainz API error (${label}): retries exhausted`)
}

export type MusicBrainzSearchResult = {
  mbid: string
  name: string
  country: string | null
  type: string | null
  beginYear: number | null
  score: number | null
}

export async function searchArtist(name: string): Promise<MusicBrainzSearchResult[]> {
  const url = `${MUSICBRAINZ_BASE}/artist?query=${encodeURIComponent(name)}&fmt=json&limit=5`
  const data = await fetchMusicBrainz(url, 'artist search')
  return (data.artists ?? []).map((a: any) => ({
    mbid: a.id,
    name: a.name,
    country: a.country ?? null,
    type: a.type ?? null,
    beginYear: a['life-span']?.begin ? Number(String(a['life-span'].begin).slice(0, 4)) : null,
    score: a.score != null && !Number.isNaN(Number(a.score)) ? Number(a.score) : null,
  }))
}

const ALLOWED_LINK_TYPES = new Set([
  'streaming',
  'free streaming',
  'social network',
  'other databases',
  'allmusic',
  'discogs',
  'wikidata',
  'IMDb',
  'youtube',
  'youtube music',
])

export const LINK_TYPE_LABEL: Record<string, string> = {
  streaming: 'ストリーミング',
  'free streaming': '無料ストリーミング',
  'social network': 'SNS',
  'other databases': 'データベース',
  allmusic: 'AllMusic',
  discogs: 'Discogs',
  wikidata: 'Wikidata',
  IMDb: 'IMDb',
  youtube: 'YouTube',
  'youtube music': 'YouTube Music',
}

// Root domain -> recognizable service name, used so visually-identical
// link_type chips (e.g. multiple "streaming" links) can be told apart at a
// glance. Matched against the hostname's own value or as a suffix (so
// subdomains like `open.qobuz.com` or `s.awa.fm` still match `qobuz.com` /
// `awa.fm`).
const DOMAIN_SERVICE_LABEL: Record<string, string> = {
  'apple.com': 'Apple Music',
  'spotify.com': 'Spotify',
  'amazon.com': 'Amazon Music',
  'amazon.co.jp': 'Amazon Music',
  'tidal.com': 'Tidal',
  'qobuz.com': 'Qobuz',
  'awa.fm': 'AWA',
  'line.me': 'LINE Music',
  'discogs.com': 'Discogs',
  'allmusic.com': 'AllMusic',
  'wikidata.org': 'Wikidata',
  'imdb.com': 'IMDb',
}

/**
 * Prefer a recognizable service name derived from the link URL's hostname
 * (so e.g. multiple `streaming`-typed links can be told apart), falling back
 * to the generic link_type label when the host isn't in our small map.
 */
export function getLinkLabel(url: string, linkType: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')

    if (hostname === 'music.youtube.com') return 'YouTube Music'
    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) return 'YouTube'

    for (const [domain, label] of Object.entries(DOMAIN_SERVICE_LABEL)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return label
      }
    }
    return LINK_TYPE_LABEL[linkType] ?? linkType
  } catch {
    return LINK_TYPE_LABEL[linkType] ?? linkType
  }
}

export type MusicBrainzArtistDetails = {
  officialHomepage: string | null
  twitterUrl: string | null
  instagramUrl: string | null
  links: { type: string; url: string }[]
  genres: string[]
}

export async function fetchArtistDetails(mbid: string): Promise<MusicBrainzArtistDetails> {
  const url = `${MUSICBRAINZ_BASE}/artist/${mbid}?inc=url-rels+genres&fmt=json`
  const data = await fetchMusicBrainz(url, 'artist detail')

  let officialHomepage: string | null = null
  let twitterUrl: string | null = null
  let instagramUrl: string | null = null
  const links: { type: string; url: string }[] = []

  for (const rel of data.relations ?? []) {
    const relUrl: string | undefined = rel.url?.resource
    if (!rel.type || !relUrl) continue

    if (rel.type === 'official homepage') {
      officialHomepage = relUrl
      continue
    }

    if (rel.type === 'social network') {
      let host = ''
      try {
        host = new URL(relUrl).hostname
      } catch {
        host = ''
      }
      if (host.includes('twitter.com') || host.includes('x.com')) {
        twitterUrl = relUrl
        continue
      }
      if (host.includes('instagram.com')) {
        instagramUrl = relUrl
        continue
      }
    }

    if (ALLOWED_LINK_TYPES.has(rel.type)) {
      links.push({ type: rel.type, url: relUrl })
    }
  }

  const genres = (data.genres ?? [])
    .map((g: any) => g.name)
    .filter((name: unknown): name is string => Boolean(name))

  return { officialHomepage, twitterUrl, instagramUrl, links, genres }
}
