# アルバム版統合(Edition Grouping)設計

## 背景・目的

同じアルバムでも、Apple Musicのカタログ上は「通常版」「Deluxe版」「Bonus Edition」「地域別版」「Live版」などが別々のカタログID(`apple_music_album_id`)として配信されていることが多く、iTunes一括インポートはこれらを別々の`album`行として正しく取り込んでいる(実データで確認済み: Cardi Bの"AM I THE DRAMA?"は11行に分かれており、いずれも異なる`apple_music_album_id`を持つ正規のカタログエントリで、誤重複登録ではない)。

この結果、アーティストのディスコグラフィー・年表、サイト全体のアルバム一覧・検索が同じ作品の版違いで埋め尽くされる。最初にリリースされた版を代表として1件だけ表示し、そこから他の版(Apple Musicの「その他のバージョン」相当)を辿れるようにする。

## ゴール

- `album_type`が`Album`/`EP`/`Live`のアルバムを対象に、タイトルの版表記(Deluxe/Bonus/地域名/Mix等)を除いた正規化タイトルが同じ・同一アーティストのものを1グループにまとめる。
- グループ内で最も早い`release_date`のものを代表版として、ディスコグラフィー・年表・サイト全体のアルバム一覧・検索には代表版のみを表示する。
- アルバム詳細ページに、Apple Musicの「その他のバージョン」相当のセクションを新設し、同グループの他の版へ横スクロールで辿れるようにする。

## 非ゴール

- シングルのリミックス/インストゥルメンタル/ラジオエディット版はグループ化の対象外(曲自体が別物と見なせるケースが多く、判定が難しいため今回は見送り)。
- ジャケット画像の視覚的な類似度比較は行わない(タイトルの正規化マッチングのみで判定する)。
- 完全な自動化ではなく、判定ミスを管理画面から人手で修正できる仕組みとセットで提供する(自動適用+事後修正、というアプローチは既にユーザーと合意済み)。

## データモデル

```sql
ALTER TABLE album ADD COLUMN primary_album_id TEXT REFERENCES album(id) ON DELETE SET NULL;
ALTER TABLE album ADD COLUMN edition_group_manual_override BOOLEAN NOT NULL DEFAULT false;
```

- `primary_album_id`が`NULL`: この行は代表版、または他の版が見つかっていない単独作品。値がある場合: その`id`が指す行が代表版で、この行はその「版」。
- 1グループ全体の取得は `SELECT * FROM album WHERE id = :primaryId OR primary_album_id = :primaryId` で完結する。新しいテーブルは不要(既存の`geo_boundary`等と違い、多対多の関係ではなく単純な「代表1件+その他」の木構造で表現できるため)。
- 自己参照なので、代表版自身が誤って`primary_album_id`を持つ(グループがループする)ことは、後述のグループ化ロジックが「代表版は常にNULLのまま」という不変条件を守る限り発生しない。
- `edition_group_manual_override`は、管理画面から人手でグループを外した/組んだ行に立てるフラグ(詳細は「管理画面での修正」節)。自動バックフィルはこのフラグが`true`の行を対象から除外し、人手での修正を上書きしない。

## 正規化タイトル・グループ化ロジック

新しい純粋関数 `normalizeAlbumTitleForGrouping(title: string): string` を用意する:

1. `title.trim().normalize('NFKC')`(既存の`utils/textNormalize.ts`の`normalizeVenueName`と同じ正規化)。
2. 末尾の括弧`(...)`または`[...]`のうち、中に版表記キーワード(大文字小文字を区別しない単語境界マッチ: `edition`, `version`, `deluxe`, `bonus`, `remaster`, `remastered`, `anniversary`, `extended`, `expanded`, `complete`, `definitive`, `special`, `mix`, `live`, `explicit`, `clean`, `exclusive`, `international`, `target`, `walmart`)を含むものを繰り返し取り除く(複数の括弧が連続する場合に対応するため、マッチしなくなるまでループする)。
3. 前後の空白を再度trimする。

この関数を使い、`groupAlbumsForEditionMerge(albums: { id, artistId, title, releaseDate, albumType }[]): { primaryId: string; editionIds: string[] }[]` という純粋関数を作る。同一`artistId`・同一`albumType ∈ {Album, EP, Live}`・正規化タイトルが一致するものをグループ化し、各グループの`release_date`最小のものを代表とする(同日の場合は`id`の辞書順などタイブレークを決める。実装時に具体的な安定順序を決める)。1件しかないグループは「グループ化なし」として結果に含めない(誰にも`primary_album_id`をセットしない)。

**「Vol. 1」「Vol. 2」のような正当な別作品**は、末尾に上記キーワードを含む括弧が無いため正規化しても別タイトルのままとなり、誤ってまとまらない。

## バックフィル・継続運用

新しいスクリプト `scripts/backfill-album-edition-groups.ts` を作る(このセッションで作成してきた他のバックフィルスクリプトと同じ、`npx tsx --env-file=.env.local`で手動実行する一回限りではなく「安全に再実行できる」設計):

- `album_type IN ('Album','EP','Live')` かつ `primary_album_id IS NULL` の全アルバムを対象に取得。
- `groupAlbumsForEditionMerge`でグループ化し、各グループの非代表版に`primary_album_id`を書き込む。
- 既に`primary_album_id`が設定済みの行(前回実行分)は対象から自然に外れるため、iTunesインポートで新しい版が追加された後も定期的に再実行すれば追いつける。管理画面から手動でグループ解除された行(後述)は、再実行時に同じロジックで再度まとめ直されてしまわないよう、手動解除フラグの扱いを次の「管理画面」節で定める。

## 管理画面での修正

`app/admin/data/albums/edition-groups/`(新設、レーベル統合ツール`app/admin/data/labels/page.tsx`と同系統のUI)を作り、以下を提供する:

- 自動グループ化された一覧をアーティスト別に表示し、代表版と版一覧を確認できる。
- 誤ってまとめられたグループから特定の版を外す操作(`primary_album_id`をNULLに戻す)。外した行は、自動バックフィルの対象条件(`primary_album_id IS NULL`)に再び合致してしまうため、手動で外した行だけは再グループ化の対象から除外する目印が必要。`album`に新しい真偽値カラム`edition_group_manual_override`(デフォルト`false`)を追加し、管理画面から外した行はこれを`true`にセットする。バックフィルスクリプトは対象取得条件に`.eq('edition_group_manual_override', false)`を加える。
- まとめ漏れているアルバム(タイトル表記の揺れなどで自動判定に掛からなかったもの)を、同一アーティストの他のアルバムから選んで手動グループ化する操作(`primary_album_id`を任意にセット、この場合も上記の手動フラグを立てる)。
- 代表版を別の版に変更する操作(旧代表版に`primary_album_id`をセットし直し、新代表版はNULLにする)。

## UI変更箇所

- **アーティスト詳細ページのディスコグラフィー** (`app/artists/[id]/page.tsx`): アルバム取得クエリに`.is('primary_album_id', null)`を追加し、代表版のみ表示する。
- **アーティスト年表**(`utils/artistTimeline.ts`とその呼び出し元の`app/artists/[id]/page.tsx`・`app/artists/[id]/timeline/page.tsx`): 同様に代表版のみを年表の元データとして渡す。
- **サイト全体のアルバム一覧** (`app/albums/page.tsx`の`fetchAllAlbums`): クエリに同条件を追加。
- **検索** (`app/search/actions.ts`の`search()`): 同条件を追加。
- **アルバムカレンダー** (`app/albums/calendar/`): 同条件を追加(実装時に現状のクエリを確認して反映する)。
- **アルバム詳細ページ** (`app/albums/[id]/page.tsx`): トラックリストの下に「その他のバージョン」セクションを新設。そのアルバムが代表版(`primary_album_id IS NULL`)なら`primary_album_id = このアルバムのid`の行を、版(`primary_album_id`が設定済み)なら代表版と兄弟版(同じ`primary_album_id`を持つ他の行、代表版自身も含む)を横スクロールのジャケット+タイトルのリストとして表示する(Apple Musicの「その他のバージョン」と同じ体裁)。件数が1件も無ければセクション自体を表示しない。

## テスト方針

- `normalizeAlbumTitleForGrouping`と`groupAlbumsForEditionMerge`は純粋関数として`node --test`でユニットテストする。実データ由来の固定ケース("AM I THE DRAMA?"系列、"Gangsta Bitch Music, Vol. 1/2"が別グループのままであること等)を使う。
- バックフィルスクリプトと管理画面アクションは、このセッションで確立した手順(ローカルdev + 実データでのcurl確認、本番デプロイ後の再確認)で検証する。

## 実装への申し送り事項

- 版表記キーワードのリストは実データに基づくベストエフォートであり、将来「Japan Version」のような未対応表記が出てきた場合はキーワードリストを拡張するか、管理画面から手動グループ化で対応する(過検出(誤って別作品をまとめる)より過小検出(まとめ漏れ)を優先する設計方針)。
- 代表版選定の同日タイブレーク条件は実装時に決める。
