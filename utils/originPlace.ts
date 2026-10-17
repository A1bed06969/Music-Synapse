// アーティストの出身地の表示名。日本は「都道府県(+市区町村)」、海外は国名(+州・地域名)。
// 国名は日本語表記(Intl.DisplayNames)。市区町村・州の名前は Music Synapse の境界データ(geo_boundary)から引く。
import type { SupabaseClient } from '@supabase/supabase-js'

export const PREFECTURES = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']
const regionNames = new Intl.DisplayNames(['ja'], { type: 'region' })

export function countryNameJa(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

/** 一覧向けの短い表示(日本は都道府県、海外は国名)。DBを引かない */
export function originLabel(country: string | null, muniCode: string | null, regionCode: string | null): string {
  if (!country) return ''
  if (country === 'jp') {
    const pref = muniCode?.slice(0, 2) ?? regionCode?.match(/^JP-(\d{2})$/)?.[1]
    if (pref) return PREFECTURES[Number(pref) - 1] ?? '日本'
  }
  return countryNameJa(country)
}

/** 詳細ページ向けの表示(日本は「岡山県里庄町」、海外は「アメリカ合衆国・Pennsylvania」) */
export async function originPlaceDetail(
  supabase: SupabaseClient,
  country: string | null,
  muniCode: string | null,
  regionCode: string | null
): Promise<string> {
  if (!country) return ''
  const code = country === 'jp' ? muniCode : regionCode
  let name: string | null = null
  if (code) {
    const { data } = await supabase.from('geo_boundary').select('name').eq('code', code).maybeSingle()
    name = (data?.name as string | undefined) ?? null
  }
  if (country === 'jp') {
    const pref = originLabel(country, muniCode, regionCode)
    return name && name !== pref ? `${pref}${name}` : pref
  }
  const nation = countryNameJa(country)
  return name ? `${nation}・${name}` : nation
}
