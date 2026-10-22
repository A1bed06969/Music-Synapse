import BannerShell from './BannerShell'

const ACCENT = '#52e05f'

/** 11 Sampling & Mash-Up Anatomy のトップのバナー。データが入るまでは、準備中の表示 */
export default function SamplingMashUpAnatomyBanner() {
  return (
    <BannerShell
      index="11"
      titleLines={['Sampling &', 'Mash-Up Anatomy']}
      subtitle="混ぜ合わさった曲を、解剖する"
      dateEyebrow="STATUS"
      dateLabel="準備中"
      eyebrow="ANATOMY"
      eyebrowHref="/sampling"
      accent={ACCENT}
    >
      <div className="grid w-full gap-3">
        <div className="flex items-center gap-3">
          <span className="h-8 flex-1 rounded-md" style={{ background: `repeating-linear-gradient(90deg, ${ACCENT}aa 0 3px, transparent 3px 7px)` }} aria-hidden />
          <span className="text-lg font-black" style={{ color: ACCENT }} aria-hidden>
            →
          </span>
          <span className="grid shrink-0 gap-1" aria-hidden>
            <span className="h-3 w-16 rounded-sm bg-white/25" />
            <span className="h-3 w-12 rounded-sm bg-white/15" />
          </span>
        </div>
        <p className="text-xs leading-relaxed text-white/45">サンプリングの元ネタや、マッシュアップ・リミックスをたどって、1曲を元の曲に分けて見るコンテンツ。準備中です。</p>
      </div>
    </BannerShell>
  )
}
