import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import UnmatchedArtistListClient from './UnmatchedArtistListClient'

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** apple_music_artist_id未設定の「名前だけの手動スタブ」アーティストを一覧化し、
 * Apple Musicを検索してその場で紐付けられるようにする管理画面。フェス出演者
 * 登録(festival-pilot)等で、確証が持てず正直な名前のみスタブとして残した
 * アーティストを、後からまとめて解決するために使う。
 *
 * artistテーブル全体をapple_music_artist_id IS NULLで素朴に絞ると、MusicBrainzの
 * 「バンドメンバー」自動登録等に由来する無関係なスタブも含めて1000件超になり
 * (Supabaseのデフォルト行数上限にも達する)、実質使い物にならない一覧になってしまう。
 * ここではevent_appearance_artist(実際にどこかのイベントに出演者として登録されている)
 * を起点にして、そこから辿れるスタブだけに絞る。 */
export default async function UnmatchedArtistsPage() {
  const supabase = await createClient()

  const { data: links } = await supabase
    .from('event_appearance_artist')
    .select(
      'artist:artist_id!inner(id, name, created_at, apple_music_artist_id), event_appearance:event_appearance_id(event_edition:event_edition_id(year, event:event_id(name)))'
    )
    .is('artist.apple_music_artist_id', null)

  const stubById = new Map<string, { id: string; name: string; createdAt: string }>()
  const contextByArtistId = new Map<string, string[]>()

  for (const link of links ?? []) {
    const artist = firstOf(link.artist)
    if (!artist) continue
    stubById.set(artist.id, { id: artist.id, name: artist.name, createdAt: artist.created_at })

    const appearance = firstOf(link.event_appearance)
    const edition = appearance ? firstOf(appearance.event_edition) : null
    const event = edition ? firstOf(edition.event) : null
    if (!event) continue
    const label = `出演: ${event.name}${edition?.year ? `(${edition.year})` : ''}`
    const list = contextByArtistId.get(artist.id) ?? []
    if (!list.includes(label)) list.push(label)
    contextByArtistId.set(artist.id, list)
  }

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
        Apple Musicで確証が持てず、名前のみの手動スタブとして登録されているアーティスト{artists.length}件が対象です。
        検索して本人を見つけたら、そのまま紐付け(アルバム・トラックの取込も含む)できます。
      </p>

      <UnmatchedArtistListClient artists={artists} />
    </div>
  )
}
