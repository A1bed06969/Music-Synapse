/** フローティングバナー用の「扇状に広げた3枚のレコードジャケット」アイコン。
 * 特定の作品には依存しない、抽象的なジャケットアート風の装飾(グラデーション+
 * 幾何学模様+奥から覗くレコード盤)。左右の葉は底辺中央を軸に-16°/+16°回転
 * させて広げ、group-hover(親ボタンにgroupクラスが必要)でさらに開く。 */
export default function JacketFanIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 76" className={className} aria-hidden>
      <defs>
        <linearGradient id="jf-left" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#b5502f" />
          <stop offset="100%" stopColor="#7a3018" />
        </linearGradient>
        <linearGradient id="jf-right" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2f7a72" />
          <stop offset="100%" stopColor="#184d47" />
        </linearGradient>
        <linearGradient id="jf-center" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0b25a" />
          <stop offset="100%" stopColor="#c9821f" />
        </linearGradient>
      </defs>

      {/* 左のジャケット */}
      <g
        className="origin-[50px_70px] rotate-[-16deg] transition-transform duration-300 ease-out group-hover:rotate-[-24deg]"
      >
        <circle cx="38" cy="30" r="15" fill="#12100d" opacity="0.55" />
        <rect x="14" y="16" width="40" height="40" fill="url(#jf-left)" />
        <line x1="20" y1="46" x2="48" y2="24" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="46" cy="48" r="4" fill="#ffffff" fillOpacity="0.3" />
      </g>

      {/* 右のジャケット */}
      <g
        className="origin-[50px_70px] rotate-[16deg] transition-transform duration-300 ease-out group-hover:rotate-[24deg]"
      >
        <circle cx="62" cy="30" r="15" fill="#12100d" opacity="0.55" />
        <rect x="46" y="16" width="40" height="40" fill="url(#jf-right)" />
        <path d="M56 46 L78 46" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M56 38 L70 38" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="2.5" strokeLinecap="round" />
      </g>

      {/* 中央のジャケット(最前面・一番大きい・回転なし) */}
      <g>
        <circle cx="50" cy="22" r="16" fill="#0d0b09" opacity="0.6" />
        <rect x="22" y="6" width="56" height="56" fill="url(#jf-center)" />
        <circle cx="50" cy="34" r="11" fill="none" stroke="#12100d" strokeOpacity="0.35" strokeWidth="2.5" />
        <circle cx="50" cy="34" r="3" fill="#12100d" fillOpacity="0.5" />
      </g>
    </svg>
  )
}
