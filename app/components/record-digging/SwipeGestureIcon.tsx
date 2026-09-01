import { Pointer } from 'lucide-react'

/** 操作説明カードに添える、中心から上下左右へ矢印が伸びるスワイプ操作イラスト。
 * 参考画像(青ベースの4方向矢印+指アイコン)をJunkie Digのアンバー基調に
 * 置き換えたもの。1つの「上矢印」パスをrotateで4方向に複製している。 */
export default function SwipeGestureIcon({ className = '' }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="swipe-arrow-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fcd34d" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
        </defs>
        <g stroke="url(#swipe-arrow-grad)" strokeWidth="7" strokeLinecap="round" fill="url(#swipe-arrow-grad)">
          {[0, 90, 180, 270].map((deg) => (
            <g key={deg} transform={`rotate(${deg} 60 60)`}>
              <line x1="60" y1="50" x2="60" y2="26" />
              <path d="M 47 30 L 73 30 L 60 11 Z" />
            </g>
          ))}
        </g>
        <circle cx="60" cy="60" r="9" fill="url(#swipe-arrow-grad)" />
      </svg>
      <Pointer
        size={34}
        strokeWidth={1.75}
        className="absolute -bottom-1 -left-1 rotate-[-18deg] text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
      />
    </div>
  )
}
