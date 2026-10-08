import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import QueueCards, { type QueueCard } from './QueueCards'

const PAGE_SIZE = 30

type SourceKey = 'pick' | 'featured' | 'pick-unmatched' | 'discguide' | 'duplicates'

type Source = {
  key: SourceKey
  label: string
  group: string
  count: number | null
  /** カードで処理できない(作業に専用UIが必要な)キューは専用画面へ案内する */
  href?: string
  hint: string
}

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source: sourceParam } = await searchParams
  const supabase = await createClient()

  const count = async (query: PromiseLike<{ count: number | null }>) => (await query).count ?? 0
  const [pick, pickUnmatched, featured, discguide] = await Promise.all([
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
        .from('featured_artist_review')
        .select('id', { count: 'exact', head: true })
        .eq('confirmed', false)
        .eq('rejected', false)
    ),
    count(supabase.from('disc_guide_scan_pending').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
  ])

  const sources: Source[] = [
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
      key: 'discguide',
      label: '読み取り結果の確認',
      group: 'ディスクガイド',
      count: discguide,
      href: '/admin/data/discguides/confirm',
      hint: 'OCRで読み取ったページ。ページ画像と見比べて登録する作業は専用画面で行います。',
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
  ]

  const current = sources.find((s) => s.key === sourceParam) ?? sources.find((s) => !s.href && (s.count ?? 0) > 0) ?? sources[0]
  const total = sources.reduce((n, s) => n + (s.count ?? 0), 0)

  let cards: QueueCard[] = []
  if (current.key === 'pick') {
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
        detailHref: '/admin/data/media/radio-airplay-pick',
      }
    })
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
        detailHref: artist ? `/artists/${artist.id}` : undefined,
      }
    })
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>
      <h1 className="mt-4 text-2xl font-bold">
        作業キュー <span className="font-mono text-base font-normal text-white/40 tabular-nums">{total.toLocaleString()}件</span>
      </h1>
      <p className="mt-1 text-sm text-white/50">確認待ちの作業をまとめた画面です。左で種類を選び、カードごとに採用・却下します。</p>

      <div className="mt-6 grid gap-6 md:grid-cols-[240px_1fr]">
        <nav className="flex flex-col gap-0.5 text-sm" aria-label="キューの種類">
          {Array.from(new Set(sources.map((s) => s.group))).map((group) => (
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
                    <span className={`font-mono text-xs tabular-nums ${s.count ? 'text-amber-300' : 'text-white/30'}`}>
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
              <Link href={current.href} className="rounded-md bg-amber-400 px-3 py-1.5 text-xs font-medium text-black hover:bg-amber-300">
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
              source={current.key as 'pick' | 'featured'}
              cards={cards}
              remaining={current.count ?? 0}
            />
          )}
        </section>
      </div>
    </div>
  )
}
