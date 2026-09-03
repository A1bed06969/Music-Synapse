'use client'

import { useState, useTransition } from 'react'
import SearchableSelect from '../../SearchableSelect'
import type { PickerItem } from '../radio-airplay-pick/actions'

/** 自動抽出が0件だった局(または手動専用局)向けに、局サイトを見て確認した
 * 選曲をその場で追加できるようにする。Apple Music検索を第一の入り口にし
 * (radio-airplay-pickのRadioPickMatcherと同じ検索を流用)、選んだ候補で
 * candidate_*列まで最初から埋まった状態で保存する。見つからない場合はURL
 * 指定、それでも無ければ手入力、と段階的にフォールバックする。追加後も
 * ボタンは再度表示されるので、複数企画がある局でも続けて追加できる。 */
export default function AddPickRow({
  stationName,
  region,
  monthKey,
  programs,
  searchAction,
  addFromSearchAction,
  addFromUrlAction,
  addManualAction,
}: {
  stationName: string
  region: string
  monthKey: string
  /** この局に既に登録されている番組名(media_program.program_name)。番組選択欄の
   * 候補として出す。新しい番組名をその場で入力することもできる。 */
  programs: string[]
  searchAction: (query: string) => Promise<PickerItem[]>
  addFromSearchAction: (
    stationName: string,
    region: string,
    monthKey: string,
    trackId: string,
    campaignName: string | null
  ) => Promise<{ success: boolean; message: string }>
  addFromUrlAction: (
    stationName: string,
    region: string,
    monthKey: string,
    url: string,
    campaignName: string | null
  ) => Promise<{ success: boolean; message: string }>
  addManualAction: (
    stationName: string,
    region: string,
    monthKey: string,
    artistName: string,
    trackTitle: string,
    campaignName: string | null
  ) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [campaignDraft, setCampaignDraft] = useState('')
  const [url, setUrl] = useState('')
  const [artistDraft, setArtistDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const datalistId = `programs_${stationName}`

  const inputClass =
    'min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'

  function reset() {
    setAdding(false)
    setManualMode(false)
    setCampaignDraft('')
    setUrl('')
    setArtistDraft('')
    setTitleDraft('')
    setError(null)
  }

  const campaignName = campaignDraft.trim() || null

  if (!adding) {
    return (
      <button type="button" onClick={() => setAdding(true)} className="mt-1 text-xs text-white/30 hover:text-white/60">
        + 手動で追加
      </button>
    )
  }

  return (
    <div className="mt-1 rounded-md border border-white/15 bg-white/5 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-white/30">番組(任意):</span>
        <input
          list={datalistId}
          value={campaignDraft}
          onChange={(e) => setCampaignDraft(e.target.value)}
          placeholder={programs.length > 0 ? '既存の番組から選ぶ、または新しく入力' : '番組名(任意)'}
          className="w-full max-w-xs min-w-0 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
        <datalist id={datalistId}>
          {programs.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
      {!manualMode ? (
        <>
          <SearchableSelect
            searchAction={searchAction}
            name={`add_${stationName}`}
            placeholder="Apple Musicでトラックを検索..."
            onSelect={(item) => {
              if (!item) return
              setError(null)
              startTransition(async () => {
                const result = await addFromSearchAction(stationName, region, monthKey, item.id, campaignName)
                if (result.success) reset()
                else setError(result.message)
              })
            }}
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="shrink-0 text-[11px] text-white/30">またはURLで指定:</span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !url.trim()) return
                e.preventDefault()
                setError(null)
                startTransition(async () => {
                  const result = await addFromUrlAction(stationName, region, monthKey, url.trim(), campaignName)
                  if (result.success) reset()
                  else setError(result.message)
                })
              }}
              placeholder="https://music.apple.com/jp/album/...?i=..."
              className="w-full min-w-0 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
            />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setError(null)
                setManualMode(true)
              }}
              className="text-[11px] text-white/30 hover:text-white/60"
            >
              Apple Musicに無い場合は手入力で登録
            </button>
            <button type="button" onClick={reset} className="text-[11px] text-white/30 hover:text-white/60">
              キャンセル
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={artistDraft}
            onChange={(e) => setArtistDraft(e.target.value)}
            placeholder="アーティスト名"
            className={inputClass}
          />
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder="曲名"
            className={inputClass}
          />
          <button
            type="button"
            disabled={isPending || !artistDraft.trim() || !titleDraft.trim()}
            onClick={() =>
              startTransition(async () => {
                await addManualAction(stationName, region, monthKey, artistDraft, titleDraft, campaignName)
                reset()
              })
            }
            className="shrink-0 text-xs text-emerald-400/80 hover:text-emerald-400 disabled:opacity-40"
          >
            追加
          </button>
          <button type="button" onClick={reset} className="shrink-0 text-xs text-white/40 hover:text-white/70">
            キャンセル
          </button>
        </div>
      )}

      {isPending && <p className="mt-1 text-xs text-white/40">保存中...</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}
