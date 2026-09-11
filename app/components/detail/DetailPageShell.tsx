import type { ReactNode } from 'react'
import SiteFooter from '@/app/components/SiteFooter'

// SiteHeaderの実測高さ(border込み)。app/artists/[id]/layout.tsxの
// --artist-shell-h と同じ値・同じ理由(デスクトップのLEFT/RIGHTカラムを
// この下に固定するための基準値)。
const HEADER_HEIGHT_PX = 57

/** アルバム・トラック詳細ページ共通の3カラムシェル。アーティストページの
 * layout.tsx(app/artists/[id]/layout.tsx)で確立した固定高さ3カラム
 * パターン(LEFT/RIGHTは高さ固定・独立スクロール、CENTERだけが伸びる、
 * フッターはCENTERの中だけ)をアルバム・トラック向けに一般化したもの。
 * ページ内ナビゲーションの概念は持たない、純粋なレイアウト用コンポーネント。
 * アーティストページのlayout.tsxはこのコンポーネントを使わない
 * (意図的に別実装のまま。docs/superpowers/specs/2026-09-11-album-track-3col-design.md参照)。 */
export default function DetailPageShell({
  left,
  center,
  right,
}: {
  left: ReactNode
  center: ReactNode
  right: ReactNode
}) {
  return (
    <div
      className="lg:flex lg:flex-row lg:overflow-hidden"
      style={{ ['--detail-shell-h' as string]: `calc(100vh - ${HEADER_HEIGHT_PX}px)` }}
    >
      {/* Mobile(lg:未満): 通常のページスクロール、LEFT→CENTER→RIGHTの縦積み */}
      <div className="px-6 lg:hidden">
        <div className="pt-3">{left}</div>
        <div className="mt-8 min-w-0">{center}</div>
        <div className="mt-8 min-w-0 pb-8">{right}</div>
      </div>
      <div className="lg:hidden">
        <SiteFooter />
      </div>

      {/* Desktop(lg:以上): LEFT/RIGHTは固定、CENTERだけが独立スクロールし
          フッターもCENTERの中にだけ表示する。 */}
      <div className="hidden lg:block lg:h-[var(--detail-shell-h)] lg:w-[32%] lg:min-w-[320px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-white/5">
        <div className="px-8 pt-3">{left}</div>
      </div>
      <div className="hidden lg:block lg:h-[var(--detail-shell-h)] lg:min-w-0 lg:flex-1 lg:overflow-y-auto">
        <div className="px-8 pt-4 pb-8">{center}</div>
        <SiteFooter />
      </div>
      <div className="hidden lg:block lg:h-[var(--detail-shell-h)] lg:w-[26%] lg:min-w-[260px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-white/5">
        <div className="px-8 pt-4">{right}</div>
      </div>
    </div>
  )
}
