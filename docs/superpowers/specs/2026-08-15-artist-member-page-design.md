# アーティスト/メンバーページ区分 設計

## 背景

`writeArtistProfileFromMusicBrainzDetails`（`utils/artistProfileImport.ts:145-201`）により、バンドのメンバーはMusicBrainzの`member of band`関係から自動的に`artist`テーブルへ`{name, musicbrainz_id}`のみの空レコードとして昇格し、`artist_relation`に`membership`関係が書き込まれる。この結果、ソロ活動の実績が無いメンバーも、フルアーティストページ（`app/artists/[id]/page.tsx`）と同じテンプレートで表示され、ディスコグラフィー・ライブ・受賞歴などのセクションが軒並み空欄のまま表示されてしまっている。

本来「アーティスト」として一覧・検索に出すべきなのは、本人名義でリリースした（ソロデビューした）人であり、バンドに所属しているだけでリリース実績の無いメンバーは、より軽量な「メンバーページ」として区別して扱いたい。ただし、メンバーであってもプロデュース業・作詞作曲などのクレジット実績を持つ場合があるため、そうした実績はメンバーページ上に表示したい。

## ゴール

- `artist`に本人名義のリリース有無に基づく自動判定＋管理者による手動上書きで「アーティスト/メンバー」を判定する仕組みを追加する
- 判定が「メンバー」のartist行は、URLは変えずに（`/artists/[id]`のまま）軽量なメンバーページテンプレートで表示する。内容: 名前・写真・所属バンド一覧（複数対応）・bio（あれば）・本人名義のクレジット実績（producer/composer/lyricist等、実績があれば）
- 判定が「アーティスト」の場合は現状のフルアーティストページのまま変更しない
- アーティスト一覧・検索から「メンバー」判定のartist行を除外する
- 管理画面（`app/admin/data/artists/[id]/edit/page.tsx`）に、自動判定/アーティスト固定/メンバー固定の3択を設定できるUIを追加する

## 非ゴール

- URLを`/members/[id]`のように分離すること。ソロデビューで判定が切り替わってもリンク切れが起きないよう、あえて`/artists/[id]`に統一する
- 既存データの手動バックフィル。新規列は全て`NULL`（自動判定）で追加し、既存の空メンバー行はリリース実績が無いため自動的に「メンバー」判定になる想定
- クレジット実績（プロデュース業・作詞作曲等）をソロデビュー判定の条件に含めること。判定は本人名義の album/track の有無のみで行い、クレジット実績はページ内の表示情報としてのみ使う
- `credit_person`テーブルとの統合やリンクカラムの追加。既存の`artist_credit.artist_id`をそのまま使えば足りるため、`credit_person`側の変更は不要
- 自動昇格ロジック（`writeArtistProfileFromMusicBrainzDetails`）自体の変更。今回のスコープはあくまで判定・表示・一覧フィルタ・管理画面

## データモデル

```sql
alter table artist add column page_override text;
-- 'artist' | 'member' | null(既定値、自動判定に従う)
```

`album.artist_id`・`track.artist_id`は共に既存の1対多FK（本人名義の作品を表す）。これを「本人名義のリリースがあるか」の判定にそのまま使う。

## アーキテクチャ

```
utils/artistPageKind.ts (新規)
  └─ resolveArtistPageKind(artist: { id, page_override }): Promise<'artist' | 'member'>
       - page_override があればそれを返す
       - なければ album(artist_id=id) または track(artist_id=id) が1件でも
         存在すれば 'artist'、無ければ 'member'

app/artists/[id]/page.tsx (既存に変更)
  └─ 冒頭でresolveArtistPageKindを呼び、kindで分岐
  └─ kind='member'の場合:
       - 現状のフル描画をスキップし、軽量なメンバー用セクションのみ描画
       - 所属バンド一覧: artist_relationのrelation_type='membership'から、
         このartistがartist_id_b側になっている行を全件取得(現状の単一バンド
         バッジ表示を複数バンド対応に拡張)
       - クレジット実績: artist_creditをartist_id=このidで取得し、
         app/people/[id]/page.tsxと同じくrole別にグルーピングして表示。
         0件ならセクションごと非表示
       - ディスコグラフィー/ライブ/受賞歴セクションは描画しない
  └─ kind='artist'の場合: 現状の描画のまま変更なし

一覧・検索 (既存箇所を実装時に洗い出して変更)
  └─ kind='member'と判定されるartist idの集合を除外するフィルタを追加
     (「album/trackを持つid」∪「page_override='artist'のid」から
      「page_override='member'のid」を除いた集合が表示対象)

app/admin/data/artists/[id]/edit/page.tsx (既存に変更)
  └─ page_overrideの編集UI(ラジオ等で「自動判定/アーティストとして表示/
     メンバーとして表示」の3択)を追加
```

バンド側ページの「Members」一覧（アバター表示、`app/artists/[id]/page.tsx`内）は変更不要。リンク先は既存通り`/artists/[id]`のままで、遷移先のkind判定に応じて自動的に描画が切り替わる。

## データフロー

1. 自動昇格スクリプトは変更なし。バンドメンバーは`page_override=null`の空`artist`行として作成され続ける
2. `/artists/[id]`へのアクセス時に`resolveArtistPageKind`で判定し、テンプレートを出し分ける
3. アーティスト一覧・検索は同じ判定ロジックで`member`判定のidを除外する
4. 管理者は編集画面から必要に応じて`page_override`を手動設定し、自動判定を上書きできる（例: リリースがあるのに便宜上メンバー扱いにしたい、逆に空だが将来を見越してアーティスト扱いにしたい、等）

## エラーハンドリング

判定ロジックは常にnull安全（`page_override`未設定時は空配列チェックのみ）で、失敗しうる外部呼び出しを含まないため、特別なエラーハンドリングは不要。

## テスト方針

自動テストは追加しない（既存の検証スタイルに合わせる）。実装後、以下を実機確認する:

- リリース実績のあるメンバー（例: バンド脱退後にソロデビューした人）が'artist'判定になり、フルページ・一覧・検索に出ること
- リリース実績の無いメンバーが'member'判定になり、軽量ページで表示され、一覧・検索から除外されること
- プロデュース/作詞作曲のクレジットを持つがリリース実績の無いメンバーで、メンバーページにクレジット実績セクションが正しく表示されること
- 管理画面から`page_override`を手動設定し、判定が上書きされること
