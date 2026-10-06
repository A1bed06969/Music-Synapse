// キュレーション企画のリスト(アーティスト名/アルバム名が日本語・カタカナ表記のことが多い)を、
// Apple Musicの実アルバムに解決する。タイトル完全一致(findAppleMusicAlbumMatch)で
// 見つからない場合、アーティストをApple Music上で特定し、JP/USストア両方の作品一覧から
// LLMに同一作品を選ばせる。JPに無くUSでのみ配信されている作品(例: マキシマム ザ ホルモン
// 「ぶっ生き返す」= US版「Bu-Ikikaesu」)があるため、USも必ず照合する。
import { Type, type Schema } from '@google/genai'
import { findAppleMusicAlbumMatch } from '@/utils/discGuideImport'
import { fetchArtistWithAlbums, searchArtist, type ItunesAlbum } from '@/utils/itunes'
import { generateJudgementText } from '@/utils/llmJudgeChain'

export type CurationAlbumResolution =
  | { found: true; collectionId: number; country: 'JP' | 'US'; appleArtistId: number; via: 'exact' | 'llm'; confidence: number; reasoning?: string }
  | { found: false; reason: string }

const CONFIDENCE_THRESHOLD = 0.9
const MAX_ARTIST_CANDIDATES = 3
const MAX_ALBUMS_PER_ARTIST = 60

type Candidate = { index: number; album: ItunesAlbum; country: 'JP' | 'US' }

const SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    index: { type: Type.INTEGER },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ['index', 'confidence', 'reasoning'],
}

async function artistCandidates(artistName: string) {
  const seen = new Map<number, string>()
  for (const country of ['JP', 'US'] as const) {
    try {
      for (const a of await searchArtist(artistName, country)) {
        if (!seen.has(a.artistId)) seen.set(a.artistId, a.artistName)
      }
    } catch {
      // 検索失敗は候補なし扱い(次のストアで拾えればよい)
    }
  }
  return [...seen.entries()].slice(0, MAX_ARTIST_CANDIDATES).map(([artistId, name]) => ({ artistId, name }))
}

export async function resolveCurationAlbum(artistName: string, title: string): Promise<CurationAlbumResolution> {
  const exact = await findAppleMusicAlbumMatch(artistName, title)
  if (exact) {
    return { found: true, collectionId: exact.collectionId, country: 'JP', appleArtistId: exact.artistId, via: 'exact', confidence: 1 }
  }

  const artists = await artistCandidates(artistName)
  if (artists.length === 0) return { found: false, reason: 'Apple Musicでアーティストが見つからない' }

  const candidates: Candidate[] = []
  const byCollection = new Map<number, Candidate>()
  for (const artist of artists) {
    for (const country of ['JP', 'US'] as const) {
      let albums: ItunesAlbum[] = []
      try {
        albums = (await fetchArtistWithAlbums(String(artist.artistId), country)).albums
      } catch {
        continue
      }
      // 企画はアルバム単位のため、シングルは候補から外す(一覧の上限がシングルで埋まり、
      // 目的のアルバムが候補に入らない/プロンプトが大きくなりすぎるのを防ぐ)
      const nonSingles = albums.filter((a) => !/ - Single$/.test(a.collectionName))
      for (const album of nonSingles.slice(0, MAX_ALBUMS_PER_ARTIST)) {
        // 同じcollectionIdは両ストア共通。JPで配信されていればJPを優先して登録する
        if (byCollection.has(album.collectionId)) continue
        const c = { index: candidates.length, album, country }
        candidates.push(c)
        byCollection.set(album.collectionId, c)
      }
    }
  }
  if (candidates.length === 0) return { found: false, reason: 'アーティストの作品がApple Musicに無い' }

  const lines = candidates
    .map(
      (c) =>
        `[${c.index}] ${c.album.artistName} / ${c.album.collectionName} (${c.album.releaseDate?.slice(0, 4) ?? '?'}, ${c.country}ストア, ${c.album.trackCount ?? '?'}曲)`
    )
    .join('\n')
  const prompt = `日本の音楽キュレーション企画のリストにある1作品を、Apple Musicの候補アルバムから特定してください。
リストの表記は日本盤の邦題やカタカナ表記のことが多い(例: アヴリル・ラヴィーン「レット・ゴー」= Avril Lavigne "Let Go"、マキシマム ザ ホルモン「ぶっ生き返す」= "Bu-Ikikaesu")。

リストの作品: アーティスト「${artistName}」/ アルバム「${title}」

候補:
${lines}

ルール:
- 同じ作品(オリジナルのアルバム)を指す候補のindexを返す。リマスター盤・通常盤が並ぶ場合は通常盤/リマスター盤を優先し、デラックス盤やライブ盤、シングル、別作品は選ばない
- アーティストが別人の場合や該当が無い場合は index=-1
- 確実に同じ作品と言える場合のみ confidence を0.9以上にする
- reasoning は日本語で簡潔に`

  let parsed: { index?: unknown; confidence?: unknown; reasoning?: unknown }
  try {
    parsed = JSON.parse(await generateJudgementText(prompt, SCHEMA))
  } catch (err) {
    return { found: false, reason: `LLM判定に失敗: ${(err as Error).message}` }
  }
  const index = typeof parsed.index === 'number' ? parsed.index : -1
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : ''
  const picked = candidates[index]
  if (!picked) return { found: false, reason: `該当なし(LLM): ${reasoning}` }
  if (confidence < CONFIDENCE_THRESHOLD) {
    return {
      found: false,
      reason: `確信度不足(${confidence.toFixed(2)}): ${picked.album.artistName} / ${picked.album.collectionName}? ${reasoning}`,
    }
  }
  return {
    found: true,
    collectionId: picked.album.collectionId,
    country: picked.country,
    appleArtistId: picked.album.artistId,
    via: 'llm',
    confidence,
    reasoning,
  }
}
