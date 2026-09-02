// scripts/backfill-radio-station-urls.ts
//
// media.power_play_url を、事前に調査したURLで一括更新する。ラジオ局PP自動収集
// (app/api/admin/radio-power-play-collect)の対象を広げるための一度きりの実行用スクリプト。
// 新しく局のURLが判明するたびに、下記のマッピングに追記して再実行する
// (既存の値を上書きするだけなので、再実行しても安全)。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-radio-station-urls.ts
import { createAdminClient } from '@/utils/Supabase/admin'

// 局名(mediaテーブルのnameと完全一致させる) → パワープレイ/ヘビーローテーション
// ページのURL。判明した局から追記していく(utils/radioScrape.tsの3局は
// 既に動作実績のあるURLをそのまま転記した)。
//
// 重複局に関する注記(2026-09-02、Web検索によるURL調査で判明):
// mediaテーブルには同じ実在局が別名で複数行登録されているケースが他にもあった
// (「エフエム・ノースウェーブ」問題と同種)。履歴のある方(radio_rotation件数が
// 多い方)を正としてそちらにURLを設定し、履歴の少ない方(重複行)には設定しない
// (新規収集が重複行の方に蓄積されるのを防ぐため)。
//   - 「福井エフエム放送」(6件)を正とし、「FM福井」(1件、今回のテストで
//     作られた分のみ)は対象から外した。utils/radioScrape.tsの正規表現パイロット
//     は「FM福井」というstationName文字列をハードコードしているが、これは
//     mediaテーブルとは独立した別の文字列なので影響しない。
//   - 「東北放送」(5件)を正とし、「TBC東北放送」(3件)は対象から外した。
//   - 「ABS秋田放送」と「秋田放送」も同一の重複関係にあるが、どちらもPPページ
//     自体が見つからなかったため今回は対象外。
// これらの重複行そのものの整理(統合)は別途「メディア統合」機能で対応する予定
// (このスクリプトはURLを設定するだけで、mediaテーブルの重複行自体は解消しない)。
//
// 手動登録に倒す局(2026-09-02時点。理由別)。STATION_URLSには入れない:
//   - SNS(X等)のみで公式サイトにページが無い: アール・エフ・ラジオ日本、
//     静岡放送、南日本放送、北陸放送
//   - ページはあるが複数月分がブログ/アーカイブ形式で1ページに混在し、
//     「今月の1件」を自動で確実に切り分けられない: TBSラジオ、エフエム東京
//     (スカレコ~社員のうた~、2023年のコメントアウト残骸も誤抽出した実例あり)、
//     熊本放送(推しSONGS blog.rkk.jp)、エフエム岐阜(Gパワープレイ blog形式)、
//     エフエム京都(索引ページに曲名が無く、個別記事は連番URLで安定しない)
//   - サーバー側のTLS設定が弱く(DH鍵が小さい)、Node.jsのfetchが
//     ERR_SSL_DH_KEY_TOO_SMALLで拒否する(curlでは通る。セキュリティ上、
//     こちら側でTLS基準を緩める対応はしない): エフエム徳島
//   - 重複局として統合済み・PPページ自体が無い: STV札幌テレビ(→STVラジオへ
//     統合)、ABS秋田放送・秋田放送(重複関係だがどちらもPPページ無し)
const STATION_URLS: Record<string, string> = {
  'J-WAVE': 'https://www.j-wave.co.jp/special/sonartrax/',
  '福井エフエム放送': 'https://www.fmfukui.jp/heavyrotation/',
  'エフエム・ノースウエーブ': 'https://www.fmnorth.co.jp/megaplay/',

  // 中国・四国
  'エフエム山口': 'https://www.fmy.co.jp/pushone/',
  'エフエム山陰': 'https://www.fm-sanin.co.jp/powerplay',
  'エフエム愛媛': 'https://www.joeufm.co.jp/heavy/',
  'エフエム香川': 'https://www.fmkagawa.co.jp/prime_tune',
  'エフエム高知': 'https://www.fmkochi.com/topics/415/',
  '岡山エフエム放送': 'https://www.fm-okayama.co.jp/slap_shot/new/index.html',
  '広島エフエム放送': 'https://hfm.jp/program/power-push/',

  // 中部・北陸
  'CBCラジオ': 'https://radichubu.jp/campaignsong/',
  'エフエムラジオ新潟': 'https://www.fmniigata.com/power_play',
  'エフエム愛知': 'https://fma.co.jp/f/prg/alreco/',
  'エフエム石川': 'https://hellofive.jp/pickup/',
  // 当初/music/powerplay/を登録していたが、そちらは更新が止まっている
  // (古い情報のまま)ことが判明。実際の最新情報はホームページの
  // 「POWERPLAY」セクションに掲載されているため、こちらに差し替え。
  '三重エフエム放送': 'https://fmmie.jp/',
  '富山エフエム放送': 'https://www.fmtoyama.co.jp/mpp/',
  '長野エフエム放送': 'https://www.fmnagano.co.jp/pp',

  // 九州・沖縄
  'CROSS FM': 'https://www.crossfm.co.jp/contents/w_main.php?oya_id=3',
  'LOVE FM': 'https://lovefm.co.jp/cool_cuts',
  'エフエム佐賀': 'https://www.fmsaga.co.jp/powerplay/',
  'エフエム大分': 'https://www.fmoita.co.jp/powerplay/',
  'エフエム宮崎': 'https://joyfm.co.jp/powerplay/',
  'エフエム熊本': 'https://fmk.fm/powerwave/',
  'エフエム福岡': 'https://www.fmfukuoka.co.jp/powerplay/',
  'エフエム長崎': 'https://www.fmnagasaki.co.jp/smilecuts/',
  'エフエム鹿児島': 'https://www.myufm.jp/song/',

  // 北海道・東北
  'STVラジオ': 'https://www.stv.jp/radio/music/suisen/index.html',
  '東北放送': 'https://www.tbc-sendai.co.jp/02radio/power/',
  'エフエム仙台': 'https://www.datefm.co.jp/megaplay/',
  'エフエム北海道': 'https://www.air-g.co.jp/powerplay/',
  'エフエム山形': 'https://rfm.co.jp/mhp',
  'エフエム岩手': 'https://www.fmii.co.jp/reps/',
  // 月ごとにURL自体が変わる形式(/monthly-selection/YYYY-M/)。月が変わったら
  // scripts/backfill-radio-station-urls.tsのこの値を更新する必要がある。
  'エフエム秋田': 'https://www.fm-akita.co.jp/monthly-selection/2026-9/',
  '北海道放送': 'https://www.hbc.co.jp/radio/information/list-recom.html',

  // 関東
  'LuckyFM茨城放送': 'https://lucky-ibaraki.com/powerplay/',
  'エフエムナックファイブ': 'https://www.nack5.co.jp/power-play/',
  'エフエム富士': 'https://www.fmfuji.jp/soundf.php',
  'エフエム栃木': 'https://www.berry.co.jp/b-hot/',
  'エフエム群馬': 'https://www.fmgunma.com/powerplay/',
  // JSレンダリングのため、素のfetchでは内容が取得できず抽出0件になる可能性が
  // 高い(utils/geminiFestivalLineupExtract.tsの既知の制約と同じ)。URLとしては
  // 正しいので登録だけしておく。
  'ベイエフエム': 'https://www.bayfm.co.jp/power/',
  '山梨放送': 'https://www.ybs.jp/hits/',

  // 関西
  'FM大阪': 'https://www.fmosaka.net/_tags/%E2%98%85POWER_PLAY',
  'エフエム滋賀': 'https://www.e-radio.co.jp/hotstuff/',
  'ラジオ関西': 'https://jocr.jp/mpsong/',
  '兵庫エフエム放送': 'https://kiss-fm.co.jp/hotraxx/',
  // ユーザー提供のURL。以前の調査ではbot対策で確認不能とされていたが、実際には
  // 取得・抽出できることを確認済み。
  'FM802': 'https://funky802.com/site/heavy',
  // ユーザー提供のURL。抽出動作確認済み(「マンスリーA-MUSIC」という企画名)。
  '関西AM5局': 'https://www.mbs1179.com/mt/',
  // ユーザー提供のURL。抽出動作確認済み(「RUSH HOUR!」という企画名)。
  '東海ラジオ': 'https://www.tokairadio.co.jp/program/p10/',
  // ユーザー提供のURL。抽出動作確認済み(「今月のピックアップキューン!」
  // 「今月のマンスリーエンディング」の2企画)。
  'RSKラジオ': 'https://www.rsk.co.jp/radio/kyun/',
  // ユーザー提供のURL。抽出動作確認済み(「KBC MUSIC SPLASH」)。
  '九州朝日放送': 'https://kbc.co.jp/r-radio/music_splash/',
  // ユーザー提供のURL。ホームページ埋め込みの「RADIO GROOVEイチオシ新着
  // ミュージック」セクション(掲載されない月もある。その場合は抽出0件になる
  // だけで害はない)。抽出動作確認済み。
  'エフエム福島': 'https://www.fmf.co.jp/',
  // ユーザー提供のURL。ホームページ埋め込みの「Monthly On Air」セクション。
  // 抽出動作確認済み。
  'エフエム青森': 'https://afb.co.jp/',
}

async function main() {
  const supabase = createAdminClient()
  let updated = 0
  let notFound = 0

  for (const [stationName, url] of Object.entries(STATION_URLS)) {
    const { data, error } = await supabase
      .from('media')
      .update({ power_play_url: url })
      .eq('name', stationName)
      .select('id')

    if (error) {
      console.error(`❌ ${stationName}: ${error.message}`)
      continue
    }
    if (!data || data.length === 0) {
      console.log(`⚠️ ${stationName}: mediaテーブルに該当局が見つかりませんでした`)
      notFound++
      continue
    }
    console.log(`✅ ${stationName}: ${url}`)
    updated++
  }

  console.log(`\n完了: ${updated}件更新、${notFound}件未発見`)
}

main()
