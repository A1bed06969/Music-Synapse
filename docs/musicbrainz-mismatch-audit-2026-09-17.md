# MusicBrainz誤マッチ監査(2026-09-17)

**背景**: 「雨のパレード」がSuedeのMusicBrainzデータと誤って紐付いていた事故([data-registration-guidelines.md](./data-registration-guidelines.md)ルール1参照)を受け、同様の事故が他にもないか診断した。

## 診断方法

- 対象: `musicbrainz_id`が設定済みで、アーティスト名が日本語(ひらがな/カタカナ/漢字)のアーティスト
- 対象総数: 約1400件のうち、Supabaseのデフォルト行数上限(1000件)により**1000件のみチェック**。残り約400件は未チェックのまま
- 各アーティストのMusicBrainz ID(mbid)を`https://musicbrainz.org/ws/2/artist/{mbid}?fmt=json`で直接取得し、`country`が`JP`でないものを機械的に抽出(country不明のnullも含む)
- 抽出条件に該当したのは**333件**(スクリプト: `/tmp/diagnose-musicbrainz-mismatches.mts`、生ログ: `/tmp/mb-diagnose.log`)
- 333件を1件ずつ目視で精査し、「正しいカタカナ表記(海外アーティストの日本語名)」と「明らかな誤マッチ」に分類

## 結果の規模

- 333件中、**約71件(21%)が明らかな誤マッチ**と判断される
- 残りの大半(約260件)は、日本語名が海外アーティストの正しい表記であるだけで、country/areaのメタデータが単に未設定・不完全なだけの正常なデータだった

これは「雨のパレード」が孤立した一回限りの事故ではなく、修正前の`resolveArtistMbid`(2026-09-16修正)のロジックが**広範囲に誤マッチを生んでいた**ことを示す。

## 確信度「高」(明らかに無関係な別人・別バンド) — 52件

| 登録名 | 誤って紐付いたMusicBrainz上の名前 | country |
|---|---|---|
| BBマック | Kat Vinter | AU |
| RCサクセション | Bernie Senensky | CA |
| アゲインスト・ザ・カレント | The Farewell Circuit | US |
| アデル | Uakti | BR |
| アリアナ・グランデ | Broke For Free | US |
| アンドレア・マーティン | David Walter Foster | CA |
| イマーニ・コッポラ | Hola Ghost | DK |
| インキュバス | Caledonian Sleeper | null |
| エヴァネッセンス | Virtual Server | null |
| エミリア | Scott Miller | US |
| オリヴィア・ディーン | Jingo | GB |
| カジヒデキ | Mini Skirt | AU |
| キーン | Soma Cake | MX |
| クラムボン | Jessica Pratt | US |
| ケニー・ラティモア | The Mispers | GB |
| ザ・チックス | Arrested Cougar | null |
| サイプレス・ヒル | Rain910 | null |
| シアターブルック | Mike Nock | NZ |
| ジェイソン・チャンピオン | Paul van Dyk | DE |
| ジェイムス・イングラム | Black Affair | null |
| ジャッキー・グラハム | Magazine | GB |
| スーパーカー | フォーク・ドリーマーズ | null |
| ダイアン・バーチ | Dawn La Rue's Near Death Experience | null |
| ダコタ・ムーン | Little Big Town | US |
| ダナ・グローヴァー | Dale Thompson | US |
| チディー・バン | Ludacris | US |
| ティアゴ・イオルク | Old Shoe | US |
| デイヴ・マシューズ・バンド | Tim Jones | CL |
| デルフィック | Caledonian | FI |
| トータス松本 | Chris Stapleton | US |
| ドゥウェレ | Aldo Nova | CA |
| トクマルシューゴ | Rotten Sound | FI |
| ニーナ・シモン | Dimitri Tiomkin | UA |
| バステッド | Cheap Trick | US |
| パッション・ピット | Lake Komo | null |
| ビッケブランカ | Acrania | MX |
| フラワー・トラベリン・バンド | Étienne Jaumet | FR |
| ポール・サイモン | Steve Adamyk BAND | CA |
| ぼくのりりっくのぼうよみ | Truth | NZ |
| ホセ・ジェイムス | Alpha & Omega | GB |
| マリーナ・アンド・ザ・ダイアモンズ | Snapdragon | null |
| ミーガン・ジー・スタリオン | Samantha Preis | GB |
| リトル・ミックス | Per Vers | DK |
| ルーク・マクマスター | Track Dogs | ES |
| レイ ハラカミ | Henry Cow | GB |
| レミー・シャンド | John Patton | US |
| レリッシュ | Tom Petty | US |
| 一十三十一 | Johannes Falk | DE |
| 今井美樹 | Rachid | US |
| 小澤ちひろ | Zakir Hussain | IN |
| 東田トモヒロ | Samifati | FR |
| 松本英子 | Chance the Rapper | US |
| 林 明日香 | ONEW | KR |
| 林田健司 | Abul Mogard | IT |

## 確信度「中」(要確認、判断材料不足) — 19件

| 登録名 | 誤って紐付いたMusicBrainz上の名前 | country |
|---|---|---|
| エレクトリック グラス バルーン | Thee Attacks | DK |
| ガブリエル・カヴァッサ | Captain Mustache | null |
| クリスティーナ | Tyran' Pace | DE |
| クルーウェラ | Felix Project | BE |
| クロムレイリー | Cloud Mac | GB |
| ゴールド・フィールズ | Stealing the Bride | DE |
| ザ・モーグリス | Salt of the Sound | HK |
| さらさ | Reaching 62 F | DE |
| ステレオガール | Pink Luminous Invocation | DK |
| ソロ | dc Talk | US |
| ソン | Terrible Feelings | SE |
| デイヴィッド・ボイルズ | Big Brovaz | GB |
| デズリー | Kelli Hand | US |
| ハード・ライフ | Sonic Surf City | SE |
| ボーン・クレイン | Drop City | AU |
| ムーチャ・ブエナ | The Answer to All Your Questions | null |
| 伊東洋平 | Skyler Loyd | US |
| 南壽あさ子 | 6Cyclemind | PH |
| 東京Qチャンネル(T.Q.C.) | Poobah | US |

## 重要な副次的発見: 重複アーティスト行の疑い

**サイプレス・ヒル**・**ミーガン・ジー・スタリオン**・**リトル・ミックス**の3件は、今回のセッション中に別の作業(YouTube MVバックフィル)で正しくMusicBrainzと紐付け済みだったはず。それにもかかわらず今回の診断では誤マッチとして検出された。

これは、同一アーティストが**複数のアーティスト行として重複登録されており、片方は正しく・もう片方は誤ってMusicBrainzと紐付いている**可能性を示す。単純な誤マッチ修正(正しいmbidへの張り替え)だけでなく、重複行の統合も必要になる可能性が高い。

## 対応方針(現時点)

- 本番DBが障害で書き込み不能なため、**現時点では修正を実行しない**。復旧、またはローカル環境でのデータ再構築の際に対応する
- 未チェックの残り約400件についても、DBアクセスが可能になり次第、同じ診断を再実行する
- 再発防止策は[data-registration-guidelines.md](./data-registration-guidelines.md)のルール6〜8として追記済み
