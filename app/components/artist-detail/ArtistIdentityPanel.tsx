import ArtistLinkIcons from '@/app/components/ArtistLinkIcons'

export type ArtistIdentityData = {
  id: string
  name: string
  nameKana: string | null
  nameEn: string | null
  imageUrl: string | null
  bio: string | null
  formedYear: number | null
  disbandedYear: number | null
  activeStatus: string | null
  hometownCountry: string | null
  originPrefecture: string | null
  hometownCity: string | null
  genreNames: string[]
  officialSiteUrl: string | null
  snsXUrl: string | null
  snsInstagramUrl: string | null
  appleMusicArtistId: string | null
  spotifyArtistId: string | null
  externalLinks: { id: string; link_type: string; url: string }[]
}

function activeYearsLabel(data: ArtistIdentityData): string | null {
  if (!data.formedYear) return null
  const end = data.disbandedYear ? String(data.disbandedYear) : data.activeStatus === 'inactive' ? '?' : 'Present'
  return `${data.formedYear} — ${end}`
}

/** アーティスト詳細ページのLEFTカラム。Desktopではstickyで1画面に収まる分量
 * (画像+基本情報+ジャンル+外部リンク+Biography抜粋)だけを表示する。
 * Music Profile文言・Sound/Moodタグはデータが存在しないためv1では出さない
 * (docs/superpowers/specs/2026-09-09-artist-knowledge-interface-design.md 非ゴール参照)。 */
export default function ArtistIdentityPanel({ data }: { data: ArtistIdentityData }) {
  const originLabel = [data.originPrefecture, data.hometownCity, data.hometownCountry].filter(Boolean).join(' / ')
  const activeYears = activeYearsLabel(data)

  return (
    <div className="flex flex-col gap-2">
      <div id="artist-header">
        {/* 幅70%・中央寄せで縮小表示する(バイオグラフィー全文を含めたLEFTカラム全体を
         * スクロール無しで収めるため、画像の専有面積を意図的に抑えている)。 */}
        <div className="mx-auto w-[70%] overflow-hidden rounded-lg bg-white/5">
          {data.imageUrl ? (
            // 実データ上、アーティスト画像は現状すべてApple Music由来の600x600正方形。
            // クロップせず実寸のまま表示する。
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.imageUrl} alt={data.name} className="h-auto w-full" />
          ) : (
            <div className="aspect-square w-full" />
          )}
        </div>

        <div className="mt-3">
          <h1 className="text-2xl font-bold leading-tight">{data.name}</h1>
          {(data.nameKana || data.nameEn) && (
            <p className="mt-1 text-sm text-white/50">{[data.nameKana, data.nameEn].filter(Boolean).join(' / ')}</p>
          )}
        </div>
      </div>

      {(originLabel || activeYears) && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {originLabel && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-white/40">Origin</dt>
              <dd className="mt-0.5 text-white/80">{originLabel}</dd>
            </div>
          )}
          {activeYears && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-white/40">Active</dt>
              <dd className="mt-0.5 text-white/80">{activeYears}</dd>
            </div>
          )}
        </dl>
      )}

      {data.genreNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.genreNames.slice(0, 8).map((name) => (
            <span key={name} className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-white/60">
              {name}
            </span>
          ))}
        </div>
      )}

      <ArtistLinkIcons
        artistName={data.name}
        officialSiteUrl={data.officialSiteUrl}
        snsXUrl={data.snsXUrl}
        snsInstagramUrl={data.snsInstagramUrl}
        appleMusicArtistId={data.appleMusicArtistId}
        spotifyArtistId={data.spotifyArtistId}
        externalLinks={data.externalLinks}
      />

      {data.bio && data.bio.trim() && (
        <div>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Biography</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{data.bio}</p>
        </div>
      )}
    </div>
  )
}
