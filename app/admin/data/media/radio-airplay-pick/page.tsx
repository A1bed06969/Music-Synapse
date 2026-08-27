import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import RadioPickMatcher from './RadioPickMatcher'
import { clearPickCandidate, registerPickToRotation } from './actions'

type ViewState = 'unmatched' | 'matched' | 'registered'

const VIEW_CONDITIONS: Record<ViewState, { column: string; operator: string; value: null }[]> = {
  unmatched: [{ column: 'candidate_track_id', operator: 'is', value: null }],
  matched: [
    { column: 'candidate_track_id', operator: 'not.is', value: null },
    { column: 'registered_rotation_id', operator: 'is', value: null },
  ],
  registered: [{ column: 'registered_rotation_id', operator: 'not.is', value: null }],
}

const VIEW_LABEL: Record<ViewState, string> = {
  unmatched: '未マッチ',
  matched: 'マッチ済み・未登録',
  registered: '本登録済み',
}

export default async function RadioAirplayPickAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; success?: string; error?: string }>
}) {
  const { view, q, success, error } = await searchParams
  const viewState: ViewState = view === 'matched' ? 'matched' : view === 'registered' ? 'registered' : 'unmatched'
  const query = (q ?? '').trim()
  const supabase = await createClient()

  const selectCols =
    'id, region, station_name, campaign_name, picked_date, artist_name, track_title, candidate_track_name, candidate_artist_name, candidate_artwork_url'

  let qb = supabase
    .from('radio_airplay_pick')
    .select(selectCols, { count: 'exact' })
    .not('artist_name', 'is', null)
    .not('track_title', 'is', null)
  for (const cond of VIEW_CONDITIONS[viewState]) {
    qb = qb.filter(cond.column, cond.operator, cond.value)
  }
  // queryが空でも%${''}%は全件にマッチするため、常に適用してよい
  qb = qb.or(`artist_name.ilike.%${query}%,track_title.ilike.%${query}%`)

  const { data: picks, count } = await qb.order('picked_date', { ascending: false }).limit(200)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/media" className="text-xs text-white/40 hover:text-white/70">
        ← メディア&オンエアに戻る
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">HRPP 手動マッチング</h1>
        <div className="flex gap-3 text-xs">
          {(['unmatched', 'matched', 'registered'] as ViewState[]).map((v) => (
            <Link
              key={v}
              href={v === 'unmatched' ? '/admin/data/media/radio-airplay-pick' : `/admin/data/media/radio-airplay-pick?view=${v}`}
              className={viewState === v ? 'text-white' : 'text-white/40 hover:text-white/70'}
            >
              {VIEW_LABEL[v]}
            </Link>
          ))}
        </div>
      </div>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>}

      <p className="mt-2 text-sm text-white/50">
        {viewState === 'registered'
          ? `パワープレイ&ヘビロテ(/media/on-air)に反映済みの${count ?? 0}件です。`
          : viewState === 'matched'
            ? `Apple Musicの候補が付いた${count ?? 0}件です。「登録」でカタログ登録(未登録アーティスト/トラックは自動作成)とパワープレイ&ヘビロテへの反映を行います。誤マッチがあれば「解除」で未マッチに戻せます。`
            : `自動マッチング(scripts/backfill-radio-pick-itunes-candidates.ts)で候補が見つからなかった${count ?? 0}件を、Apple Musicカタログから手動で検索して候補を設定できます。あくまで候補としての保存であり、artist/track本体への自動登録は行いません。`}
      </p>

      <form className="mt-4 flex gap-2" action="">
        {viewState !== 'unmatched' && <input type="hidden" name="view" value={viewState} />}
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="アーティスト名・曲名で絞り込み"
          className="w-full max-w-xs rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
        <button type="submit" className="rounded-md border border-white/15 px-3 py-2 text-xs text-white/60 hover:text-white">
          絞り込む
        </button>
      </form>
      {count !== null && count !== undefined && count > (picks?.length ?? 0) && (
        <p className="mt-2 text-xs text-white/30">
          該当{count}件中{picks?.length ?? 0}件を表示しています。絞り込んで目的の項目を探してください。
        </p>
      )}

      <ul className="mt-8 space-y-2">
        {(picks ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {p.artist_name} — {p.track_title}
              </p>
              <p className="truncate text-xs text-white/40">
                {p.station_name}
                {p.campaign_name ? `(${p.campaign_name})` : ''} / {p.picked_date}
              </p>
            </div>
            {viewState === 'unmatched' && (
              <div className="w-full max-w-xs shrink-0">
                <RadioPickMatcher pickId={p.id} />
              </div>
            )}
            {viewState === 'matched' && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-white/60">
                  {p.candidate_artwork_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.candidate_artwork_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                  )}
                  <span className="max-w-[220px] truncate">
                    {p.candidate_track_name} — {p.candidate_artist_name}
                  </span>
                </div>
                <form action={registerPickToRotation}>
                  <input type="hidden" name="pick_id" value={p.id} />
                  <button type="submit" className="shrink-0 text-xs text-emerald-400/80 hover:text-emerald-400">
                    登録
                  </button>
                </form>
                <form action={clearPickCandidate}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="shrink-0 text-xs text-red-400/70 hover:text-red-400">
                    解除
                  </button>
                </form>
              </div>
            )}
            {viewState === 'registered' && (
              <div className="flex items-center gap-2 text-xs text-white/60">
                {p.candidate_artwork_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.candidate_artwork_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                )}
                <span className="max-w-[220px] truncate">
                  {p.candidate_track_name} — {p.candidate_artist_name}
                </span>
              </div>
            )}
          </li>
        ))}
        {(picks ?? []).length === 0 && (
          <p className="text-xs text-white/30">
            {viewState === 'registered'
              ? '本登録済みの候補はまだありません。'
              : viewState === 'matched'
                ? 'マッチ済み・未登録の候補はありません。'
                : '未マッチの候補はありません。'}
          </p>
        )}
      </ul>
    </div>
  )
}
