export type HandGesture = 'idle' | 'sending' | 'picking'

const HAND_IMAGE = '/images/record-digging/hand.png'

/** モーダル内でジャケットの右端をつまみ上げる手。実写トレースの線画
 * (背景透過PNG、public/images/record-digging/hand.png)を使用。手前・奥に
 * 分割してジャケットの背後に隠す表現も試したが、指の一部しか見えず
 * 「持ち上げている」ことが伝わりにくかったため、手全体をジャケットの手前に
 * 1枚で表示する形に戻している。gesture='sending'/'picking'に応じた
 * アニメーションはglobals.cssのanimate-hand-send/animate-hand-pickを
 * 呼び出し側のclassNameで適用する。 */
export default function RecordDiggingHand({ className = '' }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={HAND_IMAGE} alt="" className={`h-auto w-full ${className}`} draggable={false} />
  )
}
