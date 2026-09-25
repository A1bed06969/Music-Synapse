// scripts/backfill-radio-station-urls.ts
//
// ラジオ局(media, media_type='radio')を、局名・エリア・パワープレイ/ヘビー
// ローテーションページURLの一覧から作成/更新する。局名で既存行を探し、
// 無ければ新規作成、あれば(area/power_play_urlを)更新する(再実行しても安全)。
// ラジオ局PP自動収集(app/api/admin/radio-power-play-collect)の対象を広げるための
// スクリプト。新しく局のURLが判明するたびに、下記のマッピングに追記して再実行する。
//
// 以前は3局(J-WAVE・福井エフエム放送・エフエム・ノースウエーブ)だけ正規表現
// スクレイピング(utils/radioScrape.ts)による別レーン("パイロット")で扱っていたが、
// 2026-09-18に廃止し、他局と同じくGemini抽出(utils/geminiRadioPickExtract.ts)に
// 一本化した。
//
// 局名・エリア・コーナー名は、ユーザーが運用してきたHR/PP管理スプレッドシートから
// 2026-09-18に抽出した(68局)。タワーレコード(②キュレーションの「タワレコメン」と
// 同一、scripts/import-towerecomen.ts側で別途扱う)・スペースシャワーTV・MTV・
// MUSIC ON! TVの4件はラジオ局ではないためこのスクリプトの対象から除外している。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-radio-station-urls.ts
import { createAdminClient } from '@/utils/Supabase/admin'

type StationInfo = { area: string; url?: string; corner?: string }

// 局名 → { エリア(都道府県。2県以上にまたがる/合同局はその旨を表す値), URL(無ければ
// 手動運用のみの局。16局が該当), corner(コーナー名。HR/PPシートより) }。
//
// cornerはmediaテーブルには保存しない(コーナー名はページの内容が変われば変わる
// ため、実際の値は収集のたびにGeminiがそのページから都度読み取り、
// radio_airplay_pick.campaign_nameへ直接入る)。ここではあくまで「初回収集時に
// 抽出結果が正しく取れているかを確認するための参考情報」として持たせるのみ。
// シート上の企画名と、実際のページで確認できた見出しが完全一致しない局が数局
// あった(例: エフエム福島はシート上「Prime Music」、実際のページ見出しは
// 「RADIO GROOVEイチオシ新着ミュージック」)。企画のブランド名とページ上の
// セクション見出しが別物であるだけで、矛盾ではない。
//
// 重複局に関する注記(2026-09-02、Web検索によるURL調査時点で判明):
// mediaテーブルには同じ実在局が別名で複数行登録されているケースがあった。
// 今回はゼロから作り直すため重複自体は発生しないが、当時の判断を踏襲し
// 以下を正式名として採用する: 「福井エフエム放送」(「FM福井」ではなく)、
// 「東北放送」(「TBC東北放送」ではなく)。なお「秋田放送」(AM)と「エフエム秋田」
// (FM)は別名ではなく実在の別局なので、両方をそのまま採用する。
const STATIONS: Record<string, StationInfo> = {
  // 関東
  // SONAR TRAXは企画終了と判断(2026-09-19確認。ページが2025年6月のまま更新
  // されておらず、J-WAVE公式サイトのトップページにも導線が無い)。URLは設定しない。
  'J-WAVE': { area: '東京' },
  'LuckyFM茨城放送': { area: '茨城', url: 'https://lucky-ibaraki.com/powerplay/', corner: 'パワープレイ' },
  'エフエムナックファイブ': { area: '埼玉', url: 'https://www.nack5.co.jp/power-play/', corner: 'パワープレイ' },
  'エフエム富士': { area: '静岡', url: 'https://www.fmfuji.jp/soundf.php', corner: 'Sound Forest' },
  'エフエム栃木': { area: '栃木', url: 'https://www.berry.co.jp/b-hot/', corner: 'B-HOT!/B-HOT! Rookies' },
  '栃木放送': { area: '栃木', corner: 'Deli POPS おすすめ曲' },
  'エフエム群馬': { area: '群馬', url: 'https://www.fmgunma.com/powerplay/', corner: 'POWER PLAY' },
  'ベイエフエム': { area: '千葉', url: 'https://www.bayfm.co.jp/power/', corner: 'POWER PLAY' },
  '山梨放送': { area: '山梨', url: 'https://www.ybs.jp/hits/', corner: '909 weekly tune' },
  'TBSラジオ': { area: '東京', corner: '推薦曲' },
  'エフエム東京': { area: '東京', corner: 'スカレコ' },
  'アール・エフ・ラジオ日本': { area: '神奈川', corner: 'パワーチューン' },

  // 関西
  'FM大阪': { area: '大阪', url: 'https://www.fmosaka.net/_tags/%E2%98%85POWER_PLAY', corner: 'POWER PLAY/E∞Tracks' },
  'エフエム滋賀': { area: '滋賀', url: 'https://www.e-radio.co.jp/hotstuff/', corner: 'HOT STUFF' },
  'ラジオ関西': { area: '兵庫', url: 'https://jocr.jp/mpsong/', corner: 'オススメ/A-MUSIC' },
  '兵庫エフエム放送': { area: '兵庫', url: 'https://kiss-fm.co.jp/hotraxx/', corner: 'HOTRAXX' },
  'FM802': { area: '大阪', url: 'https://funky802.com/site/heavy', corner: 'ヘビーローテーション' },
  '関西AM5局': { area: '近畿広域', url: 'https://www.mbs1179.com/mt/', corner: 'マンスリーA-MUSIC' },
  'エフエム京都': { area: '京都', corner: 'HELLO!KYOTO POWER MUSIC/SPLASH GROOVE/SMASH BREAK' },

  // 中部・北陸
  'CBCラジオ': { area: '愛知', url: 'https://radichubu.jp/campaignsong/', corner: 'いっしょに歌お！/マンプレ' },
  'エフエムラジオ新潟': { area: '新潟', url: 'https://www.fmniigata.com/power_play', corner: 'POWER PLAY' },
  // 2026-09-19、「tomato」全国36局パワープレイの告知で存在が判明(HR/PPシート
  // 抽出時には未把握だった局)。URLは未調査
  '新潟放送': { area: '新潟', corner: 'ウィークリーチューン' },
  'エフエム愛知': { area: '愛知', url: 'https://fma.co.jp/f/prg/alreco/', corner: 'monthly album recommend（アルバム単位）' },
  'エフエム石川': { area: '石川', url: 'https://hellofive.jp/pickup/', corner: 'MUSIC PICKUP/NEXUS' },
  '三重エフエム放送': { area: '三重', url: 'https://fmmie.jp/', corner: 'POWER PLAY' },
  '富山エフエム放送': { area: '富山', url: 'https://www.fmtoyama.co.jp/mpp/', corner: 'MUSIC POWER PLAY' },
  '長野エフエム放送': { area: '長野', url: 'https://www.fmnagano.co.jp/pp', corner: 'MONTHLY POWER PLAY' },
  '信越放送': { area: '長野', corner: 'Weekly power play' },
  '東海ラジオ': { area: '愛知', url: 'https://www.tokairadio.co.jp/program/p10/', corner: 'POWER PLAY RUSH HOUR！' },
  '福井エフエム放送': { area: '福井', url: 'https://www.fmfukui.jp/heavyrotation/', corner: 'Heavy Rotation' },
  '北陸放送': { area: '石川', corner: '音どけ' },
  '静岡エフエム放送': { area: '静岡', corner: 'MEGA PUSH TRACK' },
  '静岡放送': { area: '静岡', corner: 'マンスリーパワープレイ' },
  'エフエム岐阜': { area: '岐阜', corner: 'Ｇパワープレイ' },

  // 中国・四国
  'エフエム山口': { area: '山口', url: 'https://www.fmy.co.jp/pushone/', corner: 'PUSH ONE' },
  'エフエム山陰': { area: '鳥取・島根', url: 'https://www.fm-sanin.co.jp/powerplay', corner: 'V-airツキ押し/ゴーイブ マンスリープッシュ & ふらきん マンスリープッシュ' },
  '山陰放送': { area: '鳥取', corner: 'Mポイント' },
  'エフエム愛媛': { area: '愛媛', url: 'https://www.joeufm.co.jp/heavy/', corner: 'HEAVY ROTATION' },
  'エフエム香川': { area: '香川', url: 'https://www.fmkagawa.co.jp/prime_tune', corner: 'プライムチューン' },
  'エフエム高知': { area: '高知', url: 'https://www.fmkochi.com/topics/415/', corner: 'Monthly Power Play' },
  '岡山エフエム放送': { area: '岡山', url: 'https://www.fm-okayama.co.jp/slap_shot/new/index.html', corner: 'SLAP SHOT' },
  '広島エフエム放送': { area: '広島', url: 'https://hfm.jp/program/power-push/', corner: 'HFM POWER PUSH' },
  'RSKラジオ': { area: '岡山', url: 'https://www.rsk.co.jp/radio/kyun/', corner: 'キューン！ミュージック' },
  'エフエム徳島': { area: '徳島', corner: 'POWER PLAY' },

  // 九州・沖縄
  'CROSS FM': { area: '福岡', url: 'https://www.crossfm.co.jp/contents/w_main.php?oya_id=3', corner: 'heavy rotation' },
  'LOVE FM': { area: '福岡', url: 'https://lovefm.co.jp/cool_cuts', corner: 'Cool Cuts' },
  'エフエム佐賀': { area: '佐賀', url: 'https://www.fmsaga.co.jp/powerplay/', corner: 'パワープレイ' },
  'エフエム大分': { area: '大分', url: 'https://www.fmoita.co.jp/powerplay/', corner: 'パワープレイ' },
  'エフエム宮崎': { area: '宮崎', url: 'https://joyfm.co.jp/powerplay/', corner: 'パワープレイ' },
  'エフエム熊本': { area: '熊本', url: 'https://fmk.fm/powerwave/', corner: 'POWER WAVE' },
  '熊本放送': { area: '熊本', corner: '推しSONG' },
  'エフエム福岡': { area: '福岡', url: 'https://www.fmfukuoka.co.jp/powerplay/', corner: 'POWER PLAY' },
  'エフエム長崎': { area: '長崎', url: 'https://www.fmnagasaki.co.jp/smilecuts/', corner: 'Smile Cuts' },
  // 2026-09-19、「tomato」全国36局パワープレイの告知で存在が判明。URLは未調査
  'NBC長崎放送': { area: '長崎', corner: 'NBCミューズハーツNEO' },
  'エフエム鹿児島': { area: '鹿児島', url: 'https://www.myufm.jp/song/', corner: 'Bran’μ Song/HYPER Bran’μ Song' },
  '九州朝日放送': { area: '福岡', url: 'https://kbc.co.jp/r-radio/music_splash/', corner: 'MUSIC SPLASH' },
  '南日本放送': { area: '鹿児島', corner: 'ジャンプアップミュージック' },
  'エフエム沖縄': { area: '沖縄', corner: 'パワープレイ' },

  // 北海道・東北
  'STVラジオ': { area: '北海道', url: 'https://www.stv.jp/radio/music/suisen/index.html', corner: '推薦曲' },
  '東北放送': { area: '宮城', url: 'https://www.tbc-sendai.co.jp/02radio/power/', corner: 'イチオシパワープレイ' },
  // 旧URLはdatefm.jpへ301リダイレクト(2026-09-19確認)。リダイレクト先も
  // JSレンダリングのため選曲リストの自動取得はできない。URLだけ更新しておく
  'エフエム仙台': { area: '宮城', url: 'https://datefm.jp/megaplay/', corner: 'Date fm Mega Play' },
  'エフエム北海道': { area: '北海道', url: 'https://www.air-g.co.jp/powerplay/', corner: 'POWER PLAY' },
  'エフエム山形': { area: '山形', url: 'https://rfm.co.jp/mhp', corner: 'Power Push!' },
  'エフエム岩手': { area: '岩手', url: 'https://www.fmii.co.jp/reps/', corner: 'POWER PLAY' },
  'エフエム秋田': { area: '秋田', url: 'https://www.fm-akita.co.jp/monthly-selection/2026-9/', corner: 'MONTHLY SELECTION' },
  '秋田放送': { area: '秋田', corner: 'ウィークリーレコメンド' },
  '北海道放送': { area: '北海道', url: 'https://www.hbc.co.jp/radio/information/list-recom.html', corner: '推薦曲' },
  'エフエム福島': { area: '福島', url: 'https://www.fmf.co.jp/', corner: 'Prime Music' },
  'エフエム青森': { area: '青森', url: 'https://afb.co.jp/', corner: 'Monthly On Air' },
  'エフエム・ノースウエーブ': { area: '北海道', url: 'https://www.fmnorth.co.jp/megaplay/', corner: 'MEGA PLAY/POWER PUSH' },
}

// areaから正式な都道府県名(prefecture)を導く。/media/on-airの都道府県別マップ
// (app/components/PrefectureMap.tsx、geolonia/japanese-prefecturesの正式名称
// 「東京都」「大阪府」「北海道」「◯◯県」を前提)はprefecture列だけを見ており、
// area列だけ設定してprefectureを設定していなかったため地図が常に空になっていた
// (2026-09-19発覚)。近畿広域・鳥取島根(2局合同/複数県にまたがる)は単一の
// 都道府県に決められないためnullのままにする。
function toPrefecture(area: string): string | null {
  if (area === '近畿広域' || area === '鳥取・島根') return null
  if (area === '北海道') return '北海道'
  if (area === '東京') return '東京都'
  if (area === '大阪') return '大阪府'
  if (area === '京都') return '京都府'
  return `${area}県`
}

async function main() {
  const supabase = createAdminClient()
  let created = 0
  let updated = 0
  let failed = 0

  for (const [name, info] of Object.entries(STATIONS)) {
    const prefecture = toPrefecture(info.area)
    const suffix = `${info.area}${info.url ? ` / ${info.url}` : ''}${info.corner ? ` / コーナー名(参考): ${info.corner}` : ''}`
    const { data: existing } = await supabase.from('media').select('id').eq('name', name).maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('media')
        .update({ area: info.area, prefecture, power_play_url: info.url ?? null })
        .eq('id', existing.id)
      if (error) {
        console.error(`❌ ${name}(更新): ${error.message}`)
        failed++
        continue
      }
      console.log(`✅ ${name}(更新): ${suffix}`)
      updated++
    } else {
      const { error } = await supabase
        .from('media')
        .insert({ name, media_type: 'radio', area: info.area, prefecture, power_play_url: info.url ?? null })
      if (error) {
        console.error(`❌ ${name}(新規作成): ${error.message}`)
        failed++
        continue
      }
      console.log(`✅ ${name}(新規作成): ${suffix}`)
      created++
    }
  }

  console.log(`\n完了: 新規作成${created}件、更新${updated}件、失敗${failed}件`)
}

main()
