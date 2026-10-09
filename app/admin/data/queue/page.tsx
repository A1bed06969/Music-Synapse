import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import QueueCards, { type InlineSource, type QueueCard } from './QueueCards'

const PAGE_SIZE = 30

type SourceKey = InlineSource | 'pick-unmatched' | 'curation-stubs' | 'discguide' | 'duplicates' | 'artist-review'

type Source = {
  key: SourceKey
  label: string
  group: string
  count: number | null
  /** カードで処理できない(作業に専用UIが必要な)キューは専用画面へ案内する */
  href?: string
  hint: string
  /** 件数が膨大な積み残し。見出しの合計件数には含めない */
  backlog?: boolean
}

/** 日本時間の今月1日と来月1日(ファクトチェックは月単位の作業のため) */
function currentMonthRangeJst(): { start: string; end: string; label: string } {
  const now = new Date(Date.now() + 9 * 3600_000)
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { start: `${y}-${String(m).padStart(2, '0')}-01`, end: next, label: `${y}年${m}月` }
}

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source: sourceParam } = await searchParams
  const supabase = await createClient()
  const month = currentMonthRangeJst()

  const count = async (query: PromiseLike<{ count: number | null }>) => (await query).count ?? 0
  const [factcheck, pick, pickUnmatched, curationStubs, discguide, artistMatch, featured, artistReview] = await Promise.all([
    count(
      supabase
        .from('radio_airplay_pick')
        .select('id', { count: 'exact', head: true })
        .is('fact_checked_correct', null)
        .not('artist_name', 'is', null)
        .not('track_title', 'is', null)
        .gte('picked_date', month.start)
        .lt('picked_date', month.end)
    ),
    count(
      supabase
        .from('radio_airplay_pick')
        .select('id', { count: 'exact', head: true })
        .not('candidate_collection_id', 'is', null)
        .is('registered_rotation_id', null)
    ),
    count(
      supabase
        .from('radio_airplay_pick')
        .select('id', { count: 'exact', head: true })
        .is('candidate_collection_id', null)
        .is('registered_rotation_id', null)
    ),
    count(
      supabase
        .from('ranking_entry')
        .select('id, album:album_id!inner(streaming_status, tower_url, discogs_url)', { count: 'exact', head: true })
        .eq('album.streaming_status', 'unreleased')
        .is('album.tower_url', null)
        .is('album.discogs_url', null)
    ),
    count(supabase.from('disc_guide_scan_pending').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
    count(
      supabase
        .from('artist_match_log')
        .select('id', { count: 'exact', head: true })
        .eq('reverted', false)
        .eq('auto_applied', false)
        .not('chosen_artist_name', 'is', null)
    ),
    count(
      supabase
        .from('featured_artist_review')
        .select('id', { count: 'exact', head: true })
        .eq('confirmed', false)
        .eq('rejected', false)
    ),
    count(
      supabase
        .from('artist')
        .select('id', { count: 'exact', head: true })
        .is('apple_music_artist_id', null)
        .is('image_match_skipped_at', null)
    ),
  ])

  const sources: Source[] = [
    {
      key: 'factcheck',
      label: `ファクトチェック(${month.label})`,
      group: 'パワープレイ',
      count: factcheck,
      hint: '自動収集したパワープレイが局サイトの表記と合っているかの確認。「局サイトを開く」で見比べ、合っていれば「正しい」。違う場合は「修正する」から専用画面で直します。',
    },
    {
      key: 'pick',
      label: '候補の確認',
      group: 'パワープレイ',
      count: pick,
      hint: 'Apple Musicの候補が付いているが、まだ本登録していない選出。採用すると本登録、却下すると候補を外して未マッチに戻します。',
    },
    {
      key: 'pick-unmatched',
      label: '候補なし(未マッチ)',
      group: 'パワープレイ',
      count: pickUnmatched,
      href: '/admin/data/media/radio-airplay-pick',
      hint: '候補がまだ無い選出。曲を検索して候補を付ける作業は専用画面で行います。',
    },
    {
      key: 'curation-stubs',
      label: 'Apple Musicに無い作品の照合',
      group: 'キュレーション',
      count: curationStubs,
      href: '/admin/data/curation',
      hint: 'キュレーション企画の作品のうち、Apple Musicで見つからず作品名だけで登録したもの。タワーレコードやDiscogsで照合する作業は企画ごとの専用画面(要マッチング)で行います。',
    },
    {
      key: 'discguide',
      label: '読み取り結果の確認',
      group: 'ディスクガイド',
      count: discguide,
      href: '/admin/data/discguides/confirm',
      hint: 'OCRで読み取ったページ。ページ画像と見比べて登録する作業は専用画面で行います。',
    },
    {
      key: 'artist-match',
      label: 'Apple Musicとの照合',
      group: 'アーティスト',
      count: artistMatch,
      hint: '名前だけで登録されたアーティストに、AIがApple Musicの候補を選んだもの(確信度が中程度)。合っていれば採用して紐付けます。',
    },
    {
      key: 'featured',
      label: 'feat.で作られたアーティスト',
      group: 'アーティスト',
      count: featured,
      hint: '曲名の「feat.」から自動で作られたアーティスト。問題なければ採用、誤抽出なら却下します。',
    },
    {
      key: 'duplicates',
      label: '同名アーティストの重複',
      group: 'アーティスト',
      count: null,
      href: '/admin/data/artists/duplicate-review',
      hint: '同じ名前で複数あるアーティスト。統合するかどうかは専用画面で並べて判断します。',
    },
    {
      key: 'artist-review',
      label: 'Apple Music未紐付けのアーティスト',
      group: '積み残し(時間がある時に)',
      count: artistReview,
      href: '/admin/data/artists/review',
      backlog: true,
      hint: 'Apple Musicと紐付いていないアーティストの一覧。件数が多いため日々の確認とは分け、時間がある時に進めます。',
    },
  ]

  const current =
    sources.find((s) => s.key === sourceParam) ??
    sources.find((s) => !s.href && (s.count ?? 0) > 0) ??
    sources[0]
  const total = sources.filter((s) => !s.backlog).reduce((n, s) => n + (s.count ?? 0), 0)

  let cards: QueueCard[] = []
  if (current.key === 'factcheck') {
    const { data } = await supabase
      .from('radio_airplay_pick')
      .select('id, station_name, campaign_name, picked_date, artist_name, track_title, candidate_artwork_url')
      .is('fact_checked_correct', null)
      .not('artist_name', 'is', null)
      .not('track_title', 'is', null)
      .gte('picked_date', month.start)
      .lt('picked_date', month.end)
      .order('station_name', { ascending: true })
      .order('picked_date', { ascending: true })
      .limit(PAGE_SIZE)
    const stations = Array.from(new Set((data ?? []).map((p) => p.station_name as string)))
    const { data: media } = stations.length
      ? await supabase.from('media').select('name, power_play_url').in('name', stations)
      : { data: [] }
    const urlByStation = new Map((media ?? []).map((m) => [m.name as string, m.power_play_url as string | null]))
    cards = (data ?? []).map((p) => {
      const stationUrl = urlByStation.get(p.station_name)
      return {
        id: p.id,
        context: `${p.station_name}${p.campaign_name ? ` ${p.campaign_name}` : ''} / ${p.picked_date}`,
        from: `抽出: ${p.track_title}`,
        to: p.artist_name ?? '',
        imageUrl: p.candidate_artwork_url ?? undefined,
        confidence: null,
        links: [
          ...(stationUrl ? [{ label: '局サイトを開く', href: stationUrl, external: true }] : []),
          { label: '修正する', href: '/admin/data/media/radio-fact-check' },
        ],
      }
    })
  } else if (current.key === 'pick') {
    const { data } = await supabase
      .from('radio_airplay_pick')
      .select(
        'id, station_name, campaign_name, picked_date, artist_name, track_title, candidate_artist_name, candidate_track_name, candidate_collection_name, candidate_artwork_url'
      )
      .not('candidate_collection_id', 'is', null)
      .is('registered_rotation_id', null)
      .order('picked_date', { ascending: false })
      .limit(PAGE_SIZE)
    const ids = (data ?? []).map((p) => p.id)
    const { data: logs } = ids.length
      ? await supabase
          .from('radio_pick_match_log')
          .select('pick_id, confidence, reasoning, created_at')
          .in('pick_id', ids)
          .order('created_at', { ascending: false })
      : { data: [] }
    const latestLog = new Map<string, { confidence: number | null; reasoning: string | null }>()
    for (const l of logs ?? []) if (!latestLog.has(l.pick_id)) latestLog.set(l.pick_id, l)
    cards = (data ?? []).map((p) => {
      const log = latestLog.get(p.id)
      return {
        id: p.id,
        context: `${p.station_name}${p.campaign_name ? ` ${p.campaign_name}` : ''} / ${p.picked_date}`,
        from: `${p.track_title ?? '?'} — ${p.artist_name ?? '?'}`,
        to: `${p.candidate_track_name ?? p.candidate_collection_name ?? '?'} — ${p.candidate_artist_name ?? '?'}`,
        imageUrl: p.candidate_artwork_url ?? undefined,
        confidence: log?.confidence ?? null,
        reason: log?.reasoning ?? undefined,
        links: [{ label: '専用画面', href: '/admin/data/media/radio-airplay-pick' }],
      }
    })
  } else if (current.key === 'artist-match') {
    const { data } = await supabase
      .from('artist_match_log')
      .select('id, stub_artist_id, stub_artist_name, chosen_artist_name, chosen_apple_music_artist_id, chosen_country, confidence, reasoning')
      .eq('reverted', false)
      .eq('auto_applied', false)
      .not('chosen_artist_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    cards = (data ?? []).map((l) => ({
      id: l.id,
      context: '名前だけで登録されたアーティスト',
      from: l.stub_artist_name ?? '?',
      to: `${l.chosen_artist_name}${l.chosen_country ? `(${l.chosen_country}ストア)` : ''}`,
      confidence: l.confidence ?? null,
      reason: l.reasoning ?? undefined,
      links: [
        ...(l.chosen_apple_music_artist_id
          ? [
              {
                label: 'Apple Musicで見る',
                href: `https://music.apple.com/${(l.chosen_country ?? 'jp').toLowerCase()}/artist/${l.chosen_apple_music_artist_id}`,
                external: true,
              },
            ]
          : []),
        ...(l.stub_artist_id ? [{ label: 'アーティストページ', href: `/artists/${l.stub_artist_id}` }] : []),
      ],
    }))
  } else if (current.key === 'featured') {
    const { data } = await supabase
      .from('featured_artist_review')
      .select('id, extracted_name, source_title, artist:artist_id(id, name), track:track_id(id, title)')
      .eq('confirmed', false)
      .eq('rejected', false)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    cards = (data ?? []).map((r) => {
      const artist = Array.isArray(r.artist) ? r.artist[0] : r.artist
      const track = Array.isArray(r.track) ? r.track[0] : r.track
      return {
        id: r.id,
        context: `曲名: ${r.source_title ?? track?.title ?? '?'}`,
        from: `抽出した名前「${r.extracted_name}」`,
        to: artist ? `アーティスト「${artist.name}」として登録済み` : 'アーティスト未作成',
        confidence: null,
        links: artist ? [{ label: 'アーティストページ', href: `/artists/${artist.id}` }] : [],
      }
    })
  }

  const groups = Array.from(new Set(sources.map((s) => s.group)))

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>
      <h1 className="mt-4 text-2xl font-bold">
        作業キュー{' '}
        <span className="font-mono text-base font-normal text-white/40 tabular-nums">{total.toLocaleString()}件</span>
      </h1>
      <p className="mt-1 text-sm text-white/50">確認待ちの作業をまとめた画面です。左で種類を選び、カードごとに処理します。</p>

      <div className="mt-6 grid gap-6 md:grid-cols-[260px_1fr]">
        <nav className="flex flex-col gap-0.5 text-sm" aria-label="キューの種類">
          {groups.map((group) => (
            <div key={group} className="mb-2">
              <p className="px-3 pb-1 text-[11px] tracking-wider text-white/30">{group}</p>
              {sources
                .filter((s) => s.group === group)
                .map((s) => (
                  <Link
                    key={s.key}
                    href={`?source=${s.key}`}
                    aria-current={s.key === current.key}
                    className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 ${s.key === current.key ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5'}`}
                  >
                    <span>{s.label}</span>
                    <span
                      className={`font-mono text-xs tabular-nums ${s.count && !s.backlog ? 'text-amber-300' : 'text-white/30'}`}
                    >
                      {s.count === null ? '—' : s.count.toLocaleString()}
                    </span>
                  </Link>
                ))}
            </div>
          ))}
        </nav>

        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {current.group} / {current.label}
            </h2>
            {current.href && (
              <Link
                href={current.href}
                className="rounded-md bg-amber-400 px-3 py-1.5 text-xs font-medium text-black hover:bg-amber-300"
              >
                専用画面で作業する →
              </Link>
            )}
          </div>
          <p className="mb-4 text-sm text-white/50">{current.hint}</p>
          {current.href ? (
            <p className="rounded-md border border-dashed border-white/15 p-6 text-sm text-white/50">
              このキューは、作業に専用の画面が必要です。上のボタンから開いてください。
            </p>
          ) : (
            <QueueCards
              key={current.key}
              source={current.key as InlineSource}
              cards={cards}
              remaining={current.count ?? 0}
            />
          )}
        </section>
      </div>
    </div>
  )
}
