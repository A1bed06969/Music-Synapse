'use client'

import { formatDate } from '@/utils/format'

export type AlbumListItem = {
  id: string
  title: string
  jacketUrl: string | null
  releaseDate: string
  artistName: string
  genres?: string[]
}

/** 新譜カレンダーの右カラム。日付未選択時は直近の新譜(今日以降)を一覧表示し、
 * カレンダーで日付をクリックするとその日の新譜一覧に切り替わる(state自体は
 * CalendarPageClientが一元管理し、ここは表示専用)。アルバムをクリックすると
 * ページ遷移はせず、左カラムの詳細表示をそのアルバムに切り替える
 * (onSelectAlbum)。 */
export default function AlbumListPanel({
  selectedDate,
  selectedAlbums,
  defaultAlbums,
  selectedAlbumId,
  onClearSelection,
  onSelectAlbum,
}: {
  selectedDate: string | null
  selectedAlbums: AlbumListItem[]
  defaultAlbums: AlbumListItem[]
  selectedAlbumId: string | null
  onClearSelection: () => void
  onSelectAlbum: (albumId: string) => void
}) {
  const isFiltered = selectedDate !== null
  const albums = isFiltered ? selectedAlbums : defaultAlbums

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{isFiltered ? `${formatDate(selectedDate)}の新譜` : '直近の新譜'}</h3>
        {isFiltered && (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-xs text-white/40 transition hover:text-white"
          >
            直近の新譜に戻る
          </button>
        )}
      </div>

      {albums.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">この日の新譜はありません。</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/5">
          {albums.map((album) => {
            const isActive = album.id === selectedAlbumId
            return (
              <li key={album.id}>
                <button
                  type="button"
                  onClick={() => onSelectAlbum(album.id)}
                  className={`flex w-full gap-3 py-3 text-left transition hover:bg-white/5 ${
                    isActive ? 'bg-white/5' : ''
                  }`}
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-white/5">
                    {album.jacketUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={album.jacketUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[9px] text-white/20">
                        No Art
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{album.title}</p>
                    <p className="truncate text-xs text-white/50">{album.artistName}</p>
                    <p className="mt-0.5 text-xs text-white/30">{formatDate(album.releaseDate)}</p>
                    {album.genres && album.genres.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {album.genres.map((g) => (
                          <span key={g} className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                            {g}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
