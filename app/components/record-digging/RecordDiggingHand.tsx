export type HandGesture = 'idle' | 'sending' | 'picking'

/** モーダル内でジャケットの上端をつまむ手。参考画像に合わせ、塗りのない
 * 琥珀色の細い線画(アウトラインのみ)にしている。形状自体は角丸長方形
 * (rx=高さ/2のカプセル形)をrotateで傾ける方式のままで、輪郭の滑らかさは
 * 保っている。gesture='sending'/'picking'に応じたアニメーションは
 * globals.cssのanimate-hand-send/animate-hand-pickを呼び出し側のclassName
 * で適用する。 */
export default function RecordDiggingHand({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="-46 -46 96 76" className={className} aria-hidden>
      <g fill="none" stroke="#f2b25a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* 手の甲・手首(左上へオフキャンバス) */}
        <rect x="-32" y="-41" width="48.4" height="22" rx="11" transform="rotate(29.7 -32 -30)" />

        {/* 親指(人差し指の下敷きになるよう先に描く) */}
        <rect x="2" y="-9" width="32.9" height="10" rx="5" transform="rotate(19.6 2 -4)" />

        {/* 人差し指(ジャケットの上端をつまむ) */}
        <rect x="14" y="-12.5" width="34" height="9" rx="4.5" transform="rotate(24 14 -8)" />

        {/* 指の関節ジワ */}
        <line x1="26.3" y1="-6.4" x2="23.5" y2="0" strokeWidth="1.1" opacity="0.7" />
        <line x1="37.2" y1="-1.5" x2="34.3" y2="4.9" strokeWidth="1.1" opacity="0.7" />
      </g>
    </svg>
  )
}
