// トップの連載(01〜11)の名前・色・コピー・リンク先。各連載のページ(3カラム)と右カラムの目次で共有する
export type HubKey = 'discover' | 'fes' | 'nextBreak' | 'planet' | 'discGuide' | 'curation' | 'crown' | 'genreRoots' | 'connect' | 'tieup' | 'sampling'

export type HubContent = {
  key: HubKey
  number: string
  /** 右カラムの目次に出す名前 */
  label: string
  /** 左カラムの大見出し(2行) */
  heading: [string, string]
  tagline: string
  color: string
  href: string
}

export const HUB_CONTENTS: HubContent[] = [
  { key: 'discover', number: '01', label: 'DISCOVER NEW MUSIC', heading: ['Discover', 'New Music'], tagline: '新しい音楽との出会い', color: '#2f9bff', href: '/albums/calendar' },
  { key: 'fes', number: '02', label: 'FES & LIVE FREAK', heading: ['Fes & Live', 'Freak'], tagline: 'この出演者、見逃せない', color: '#2fd39a', href: '/events' },
  { key: 'nextBreak', number: '03', label: 'MONTHLY NEXT BREAK', heading: ['Monthly', 'Next Break'], tagline: '次時代を担うアーティストの一曲', color: '#ff7a2f', href: '/media/on-air' },
  { key: 'planet', number: '04', label: 'MUSIC PLANET TOUR', heading: ['Music Planet', 'Tour'], tagline: 'アーティストの原点を探る', color: '#a27bff', href: '/map' },
  { key: 'discGuide', number: '05', label: 'CLIP DISC-GUIDE', heading: ['Clip', 'Disc-Guide'], tagline: 'ディスクガイドから掘り起こす一枚', color: '#ffd23f', href: '/discguides' },
  { key: 'curation', number: '06', label: 'MEDIA CURATION EXPRESS', heading: ['Media Curation', 'Express'], tagline: 'メディアが選んだ、今聴くべき音楽', color: '#ff4fb4', href: '/media/features' },
  { key: 'crown', number: '07', label: 'CROWN THE WINNERS', heading: ['Crown The', 'Winners'], tagline: '栄冠を手にしたのは誰だ', color: '#ff4d5e', href: '/chronology/awards' },
  { key: 'genreRoots', number: '08', label: 'GENRE ROOTS TAPESTRY', heading: ['Genre Roots', 'Tapestry'], tagline: 'ジャンルの系譜を、一枚の織物に', color: '#3fd0e0', href: '/genres' },
  { key: 'connect', number: '09', label: 'CONNECT THE MUSIC MAKERS', heading: ['Connect The', 'Music Makers'], tagline: '音楽をつくる人たちをつなぐ', color: '#b6f23a', href: '/relations' },
  { key: 'tieup', number: '10', label: 'TIE-UP TIME MACHINE', heading: ['Tie-Up', 'Time Machine'], tagline: 'あの頃の主題歌へ、時間旅行', color: '#d86bff', href: '/media/sync' },
  { key: 'sampling', number: '11', label: 'SAMPLING & MASH-UP ANATOMY', heading: ['Sampling &', 'Mash-Up Anatomy'], tagline: '混ぜ合わさった曲を、解剖する', color: '#52e05f', href: '/sampling' },
]

export function hubContent(key: HubKey): HubContent {
  return HUB_CONTENTS.find((c) => c.key === key)!
}
