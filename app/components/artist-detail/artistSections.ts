// アーティスト詳細ページの9セクション(番号・名前・パス・色)。サーバー・ブラウザの両方から使う
import type { ArtistSectionCounts } from '@/utils/artistDetailCounts'

export type NavSection = {
  number: string
  key: keyof ArtistSectionCounts | 'overview'
  label: string
  path: string // artistIdの後に続くパス。空文字はOverview(index)。
  /** セクションの色。トップの6連載の色を基本に、足りない分は近い系統の色を足す */
  color: string
}

export const NAV_SECTIONS: NavSection[] = [
  { number: '01', key: 'overview', label: 'OVERVIEW', path: '', color: '#c8f560' },
  { number: '02', key: 'discography', label: 'DISCOGRAPHY', path: '/discography', color: '#2f9bff' },
  { number: '03', key: 'timeline', label: 'TIMELINE', path: '/timeline', color: '#ffd23f' },
  { number: '04', key: 'live', label: 'FESTIVAL & LIVE', path: '/live', color: '#2fd39a' },
  { number: '05', key: 'network', label: 'NETWORK', path: '/network', color: '#3fd0e0' },
  { number: '06', key: 'media', label: 'MEDIA', path: '/media', color: '#ff8fa3' },
  { number: '07', key: 'ranking', label: 'RANKING', path: '/ranking', color: '#ff4fb4' },
  { number: '08', key: 'awards', label: 'AWARDS', path: '/awards', color: '#f5b942' },
  { number: '09', key: 'radio', label: 'RADIO ROTATION', path: '/radio', color: '#ff7a2f' },
]

export function navSection(key: NavSection['key']): NavSection {
  return NAV_SECTIONS.find((s) => s.key === key)!
}

/** 各セクションページの見出し(SectionHeading)に渡す番号・名前・色 */
export function headingOf(key: NavSection['key']): { number: string; label: string; color: string } {
  const s = navSection(key)
  return { number: s.number, label: s.label, color: s.color }
}

