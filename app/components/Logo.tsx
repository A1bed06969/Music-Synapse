// ファセット状の六角形(音楽ジャンルの多様性)+ 中央のサウンドウェーブと
// シナプスのノード(音楽同士のつながり)を表現したロゴマーク。
export default function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <pattern id="logoDots" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="1.1" fill="#ffffff" fillOpacity="0.35" />
        </pattern>
      </defs>

      {/* 六角形を構成する6つのファセット */}
      <polygon points="50,50 50,8 86.4,29" fill="#FFC93C" />
      <polygon points="50,50 86.4,29 86.4,71" fill="#FF7A3D" />
      <polygon points="50,50 86.4,71 50,92" fill="#F0396B" />
      <polygon points="50,50 50,92 13.6,71" fill="#8B5CF6" />
      <polygon points="50,50 13.6,71 13.6,29" fill="#3E7BFA" />
      <polygon points="50,50 13.6,29 50,8" fill="#22C7A9" />

      {/* うっすらとしたハーフトーン(網点)テクスチャ */}
      <polygon points="50,8 86.4,29 86.4,71 50,92 13.6,71 13.6,29" fill="url(#logoDots)" opacity="0.5" />

      {/* 中央の暗色コア */}
      <polygon points="50,34 63.9,42 63.9,58 50,66 36.1,58 36.1,42" fill="#0b0b0e" />

      {/* サウンドウェーブ */}
      <g stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round">
        <line x1="38" y1="49.9" x2="38" y2="50.1" />
        <line x1="42" y1="44" x2="42" y2="56" />
        <line x1="46" y1="39" x2="46" y2="61" />
        <line x1="50" y1="35" x2="50" y2="65" />
        <line x1="54" y1="41" x2="54" y2="59" />
        <line x1="58" y1="46" x2="58" y2="54" />
        <line x1="62" y1="49" x2="62" y2="51" />
      </g>

      {/* シナプスのノード */}
      <circle cx="42" cy="44" r="1.6" fill="#FFC93C" />
      <circle cx="54" cy="41" r="1.6" fill="#F0396B" />
      <circle cx="58" cy="54" r="1.6" fill="#3E7BFA" />
    </svg>
  )
}
