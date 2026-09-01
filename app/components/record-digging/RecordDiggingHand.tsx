export type HandGesture = 'idle' | 'sending' | 'picking'

/** モーダル内でジャケットの右端をつまむ手。実写トレースの線画(背景透過PNG、
 * public/images/record-digging/hand.png)を左右反転(-scale-x-100)して使用
 * している。反転はこのimg自体にかけている(呼び出し元のsend/pickアニメーション
 * はtransform: translate/rotateをtransformプロパティへ直接設定するkeyframesの
 * ため、同じ要素にscale-x-100を乗せると競合してアニメ中だけ反転が外れてしまう)。
 * gesture='sending'/'picking'に応じたアニメーションはglobals.cssの
 * animate-hand-send/animate-hand-pickを呼び出し側のclassNameで適用する。 */
export default function RecordDiggingHand({ className = '' }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/images/record-digging/hand.png"
      alt=""
      className={`h-auto w-full -scale-x-100 ${className}`}
      draggable={false}
    />
  )
}
