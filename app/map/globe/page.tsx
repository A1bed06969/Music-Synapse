import { redirect } from 'next/navigation'

/** 試作の地球儀は、メインの地図(/map)になった */
export default function GlobePage() {
  redirect('/map')
}
