export type HandGesture = 'idle' | 'sending' | 'picking'
export type HandPart = 'thumb' | 'fingers'

const HAND_IMAGE = '/images/record-digging/hand.png'

// hand.png(300x340)の中で「親指」が占める輪郭を、clip-pathのパーセンテージ
// 座標として切り出したもの(実写を目でトレースして採った近似ポリゴン)。
// 親指はジャケットの手前に、それ以外(指・手の甲)はジャケットの奥に隠れて
// こそ「つまんでいる」ように見えるため、呼び出し側でジャケットのz-indexを
// 挟んだ2枚(fingers→z低め、thumb→z高め)として重ねて使う。fingers側は
// 全体からこの輪郭を除いた領域。
const THUMB_POINTS = '0% 51.47%, 0% 100%, 58.33% 100%, 50% 85.29%, 43.33% 70.59%, 36.67% 55.88%, 28.33% 45.59%, 20% 42.65%, 10% 45.59%'
const FINGERS_POINTS = `0% 0%, 100% 0%, 100% 100%, 58.33% 100%, 50% 85.29%, 43.33% 70.59%, 36.67% 55.88%, 28.33% 45.59%, 20% 42.65%, 10% 45.59%, 0% 51.47%`

/** モーダル内でジャケットの左端をつまむ手。実写トレースの線画(背景透過PNG、
 * public/images/record-digging/hand.png)を使用。partで親指/それ以外の
 * どちらを描画するかを切り替える(呼び出し側でジャケットを挟んで重ねるため)。
 * gesture='sending'/'picking'に応じたアニメーションはglobals.cssの
 * animate-hand-send/animate-hand-pickを呼び出し側のclassNameで適用する。 */
export default function RecordDiggingHand({ part, className = '' }: { part: HandPart; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={HAND_IMAGE}
      alt=""
      className={`h-auto w-full ${className}`}
      style={{ clipPath: `polygon(${part === 'thumb' ? THUMB_POINTS : FINGERS_POINTS})` }}
      draggable={false}
    />
  )
}
