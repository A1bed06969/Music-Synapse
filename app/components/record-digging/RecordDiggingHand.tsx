export type HandGesture = 'idle' | 'sending' | 'picking'

/** モーダル内でジャケットの上端をつまむ手。指輪なし。フリーハンドの曲線だと
 * 輪郭が崩れやすいため、手の甲/手首と指を「角丸の長方形(rx=高さ/2のカプセル形)
 * をrotateで傾ける」方式で組み立て、輪郭を常に一定の滑らかさに保っている。
 * 親指を先に描画し、人差し指を上に重ねることでつまむ手前関係を表現。
 * gesture='sending'/'picking'に応じたアニメーションはglobals.cssの
 * animate-hand-send/animate-hand-pickを呼び出し側のclassNameで適用する。 */
export default function RecordDiggingHand({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="-46 -46 96 76" className={className} aria-hidden>
      <defs>
        <linearGradient id="rdh-skin" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#f2c39c" />
          <stop offset="100%" stopColor="#d69a6c" />
        </linearGradient>
        <linearGradient id="rdh-skin-shadow" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#dda876" />
          <stop offset="100%" stopColor="#b6825a" />
        </linearGradient>
      </defs>

      {/* 手の甲・手首(左上へオフキャンバス) */}
      <rect
        x="-32" y="-41" width="48.4" height="22" rx="11"
        fill="url(#rdh-skin)"
        stroke="#8a5a3d" strokeOpacity="0.3" strokeWidth="0.7"
        transform="rotate(29.7 -32 -30)"
      />

      {/* 親指(人差し指の下敷きになるよう先に描く) */}
      <rect
        x="2" y="-9" width="32.9" height="10" rx="5"
        fill="url(#rdh-skin-shadow)"
        stroke="#8a5a3d" strokeOpacity="0.3" strokeWidth="0.7"
        transform="rotate(19.6 2 -4)"
      />

      {/* 人差し指(ジャケットの上端をつまむ) */}
      <rect
        x="14" y="-12.5" width="34" height="9" rx="4.5"
        fill="url(#rdh-skin)"
        stroke="#8a5a3d" strokeOpacity="0.3" strokeWidth="0.7"
        transform="rotate(24 14 -8)"
      />

      {/* 指の関節ジワ */}
      <line x1="26.3" y1="-6.4" x2="23.5" y2="0" stroke="#a06b45" strokeOpacity="0.4" strokeWidth="0.8" strokeLinecap="round" />
      <line x1="37.2" y1="-1.5" x2="34.3" y2="4.9" stroke="#a06b45" strokeOpacity="0.4" strokeWidth="0.8" strokeLinecap="round" />

      {/* 爪 */}
      <ellipse cx="42" cy="4" rx="2.6" ry="1.8" fill="#f4d9bd" opacity="0.85" transform="rotate(24 42 4)" />
    </svg>
  )
}
