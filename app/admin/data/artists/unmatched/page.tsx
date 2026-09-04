import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import UnmatchedArtistListClient from './UnmatchedArtistListClient'
import GeminiMatchPanel from './GeminiMatchPanel'
import { GeminiReviewQueue, GeminiAutoAppliedList, type ReviewLogRow, type AutoAppliedLogRow } from './GeminiMatchQueues'

type MatchCandidateJson = { artistId: number; artistName: string; imageUrl?: string | null }

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** apple_music_artist_id未設定の「名前だけの手動スタブ」アーティストを一覧化し、
 * Apple Musicを検索してその場で紐付けられるようにする管理画面。フェス出演者
 * 登録(festival-pilot)やキュレーション企画(Fender NEXT等、album_idを持たない
 * アーティスト単体のranking_entry)で、確証が持てず正直な名前のみスタブとして
 * 残したアーティストを、後からまとめて解決するために使う。
 *
 * artistテーブル全体をapple_music_artist_id IS NULLで素朴に絞ると、MusicBrainzの
 * 「バンドメンバー」自動登録等に由来する無関係なスタブも含めて1000件超になり
 * (Supabaseのデフォルト行数上限にも達する)、実質使い物にならない一覧になってしまう。
 * ここではevent_appearance_artist(実際にどこかのイベントに出演者として登録されている)
 * とranking_entry(キュレーション企画に選出されている)を起点にして、そこから
 * 辿れるスタブだけに絞る。/admin/data/curation/{id}/matchはalbum_idを持つ
 * エントリしか見ないため、Fender NEXTのようなアーティスト単体の企画はこの
 * ページでしか拾えない。 */
export default async function UnmatchedArtistsPage() {
  const supabase = await createClient()

  const [{ data: eventLinks }, { data: curationLinks }] = await Promise.all([
    supabase
      .from('event_appearance_artist')
      .select(
        'artist:artist_id!inner(id, name, created_at, apple_music_artist_id), event_appearance:event_appearance_id(event_edition:event_edition_id(year, event:event_id(name)))'
      )
      .is('artist.apple_music_artist_id', null),
    supabase
      .from('ranking_entry')
      .select('artist:artist_id!inner(id, name, created_at, apple_music_artist_id), ranking:ranking_id(id, name)')
      .is('artist.apple_music_artist_id', null)
      .not('artist_id', 'is', null),
  ])

  const stubById = new Map<string, { id: string; name: string; createdAt: string }>()
  const contextByArtistId = new Map<string, string[]>()

  function addContext(artistId: string, label: string) {
    const list = contextByArtistId.get(artistId) ?? []
    if (!list.includes(label)) list.push(label)
    contextByArtistId.set(artistId, list)
  }

  for (const link of eventLinks ?? []) {
    const artist = firstOf(link.artist)
    if (!artist) continue
    stubById.set(artist.id, { id: artist.id, name: artist.name, createdAt: artist.created_at })

    const appearance = firstOf(link.event_appearance)
    const edition = appearance ? firstOf(appearance.event_edition) : null
    const event = edition ? firstOf(edition.event) : null
    if (!event) continue
    addContext(artist.id, `出演: ${event.name}${edition?.year ? `(${edition.year})` : ''}`)
  }

  const rankingGroupCount = new Map<string, { rankingId: string; rankingName: string; stubCount: number }>()
  for (const link of curationLinks ?? []) {
    const artist = firstOf(link.artist)
    if (!artist) continue
    stubById.set(artist.id, { id: artist.id, name: artist.name, createdAt: artist.created_at })

    const ranking = firstOf(link.ranking)
    if (!ranking) continue
    addContext(artist.id, `キュレーション: ${ranking.name}`)

    const group = rankingGroupCount.get(ranking.id) ?? { rankingId: ranking.id, rankingName: ranking.name, stubCount: 0 }
    group.stubCount += 1
    rankingGroupCount.set(ranking.id, group)
  }
  const rankingGroups = Array.from(rankingGroupCount.values()).sort((a, b) => b.stubCount - a.stubCount)

  const { data: logRows } = await supabase
    .from('artist_match_log')
    .select('id, stub_artist_name, chosen_artist_name, chosen_country, confidence, reasoning, candidates_json, auto_applied, reverted, created_at')
    .eq('reverted', false)
    .order('created_at', { ascending: false })
    .limit(200)

  const reviewRows: ReviewLogRow[] = (logRows ?? [])
    .filter((r) => !r.auto_applied && r.chosen_artist_name)
    .map((r) => {
      const candidates = (r.candidates_json as MatchCandidateJson[] | null) ?? []
      const chosen = candidates.find((c) => c.artistName === r.chosen_artist_name)
      return {
        id: r.id,
        stubArtistName: r.stub_artist_name,
        chosenArtistName: r.chosen_artist_name,
        chosenCountry: r.chosen_country,
        confidence: Number(r.confidence),
        reasoning: r.reasoning,
        imageUrl: chosen?.imageUrl ?? null,
        createdAt: r.created_at,
      }
    })

  const autoAppliedRows: AutoAppliedLogRow[] = (logRows ?? [])
    .filter((r) => r.auto_applied)
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      stubArtistName: r.stub_artist_name,
      chosenArtistName: r.chosen_artist_name,
      confidence: Number(r.confidence),
      reasoning: r.reasoning,
      createdAt: r.created_at,
    }))

  const artists = [...stubById.values()]
    .map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      appearanceContext: contextByArtistId.get(s.id) ?? [],
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">未マッチアーティストを検索</h1>
      <p className="mt-2 text-sm text-white/50">
        フェス出演・キュレーション企画でApple Musicの確証が持てず、名前のみの手動スタブとして登録されているアーティスト{artists.length}件が対象です。
        検索して本人を見つけたら、そのまま紐付け(アルバム・トラックの取込も含む)できます。
      </p>

      <GeminiMatchPanel groups={rankingGroups} />
      <GeminiAutoAppliedList rows={autoAppliedRows} />
      <GeminiReviewQueue rows={reviewRows} />

      <div className="mt-8">
        <UnmatchedArtistListClient artists={artists} />
      </div>
    </div>
  )
}
