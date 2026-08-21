# 複数アーティストアルバム対応 設計

## 背景

ディスクガイドの登録フローで、1つの掲載アルバムに複数アーティストが関わる場合(コラボレーション、フィーチャリング、スプリット盤等)、そのアルバムを関係する全アーティストのページに登録したい、というユーザーの要望がきっかけ。

現状調査の結果:
- `album.artist_id`(NOT NULL)がアルバムとアーティストを結ぶ唯一の経路で、アプリ全体(公開アルバムページ、アーティストページのディスコグラフィー、ディスクガイド登録、検索等)がこの1対1関係を前提に書かれている
- DBには`album_artist(id, album_id, artist_id, role, billing_order)`というテーブルが既に存在する(`role`は`CHECK (role IN ('main','featured','split'))`、RLSも`Public read access`ポリシー付きで設定済み)。ただし0件・アプリコードのどこからも参照されておらず、対応する移行ファイルもリポジトリに無い。おそらく将来のために用意されたまま放置されたテーブル
- ディスクガイドのOCR抽出・確認画面・登録処理は、すべて`artist_name`を単一の文字列として扱う設計になっている

## ゴール

- 既存の`album_artist`テーブルを再利用し、1つのアルバムに複数アーティストを紐付けられるようにする
- 紐付けたアーティストそれぞれのディスコグラフィーに、そのアルバムが表示されるようにする
- アルバム詳細ページに、紐付いた全アーティスト名を表示する
- ディスクガイド確認画面から、登録直後にその場で追加アーティストを紐付けられるようにする

## 非ゴール(今回やらないこと)

- トラック単位の複数アーティスト対応(`track.artist_id`は今回変更しない。アルバム単位のみ)
- OCR抽出での自動アーティスト分割("Artist A × Artist B"のような表記を自動でパースして複数エンティティに分ける処理は作らない。表記ゆれが多く誤判定のリスクが高いため、既存の「タイトル/アーティスト名を編集してから登録」フローで1人目を登録し、2人目以降は登録後に手動で紐付ける運用にする)
- `album.artist_id`の廃止・移行。既存の全クエリへの影響を避けるため、代表アーティストとして今まで通り使い続ける

## データの前提(既存DB確認済み)

- `album_artist`: `id bigint PK`, `album_id text NOT NULL REFERENCES album(id) ON DELETE CASCADE`, `artist_id text NOT NULL REFERENCES artist(id) ON DELETE CASCADE`, `role text NOT NULL DEFAULT 'main' CHECK (role IN ('main','featured','split'))`, `billing_order integer NULL`。RLS有効・`Public read access`(`SELECT`のみ、`USING (true)`)ポリシー設定済み。今回は`main`(対等なコラボ)と`featured`(フィーチャリング)の2値だけを使い、`split`は将来スプリット盤等で細分化したくなった場合のために制約上残しておくだけで、今回のUIからは使わない
- `(album_id, artist_id)`のUNIQUE制約は無い(今回追加する)
- `album.artist_id`はNOT NULL。今回もこの列は変更しない

## アーキテクチャ

```
supabase/migrations/20260821_album_artist_unique.sql (新規)
  └─ ALTER TABLE album_artist ADD CONSTRAINT album_artist_album_id_artist_id_key
       UNIQUE (album_id, artist_id);
     (同じアーティストを同じアルバムに重複して紐付けるのを防ぐ。role/RLS/CHECK等
      既存の列・制約はそのまま利用するため他の変更は不要)

app/admin/data/artists/actions.ts (追記) または app/admin/data/albums/actions.ts (新規)
  └─ export async function linkAlbumArtist(formData: FormData)
       album_id, artist_id(追加で紐付けたい方。album.artist_idと同じ場合はエラー)、
       role('featured'=フィーチャリング、'main'=対等なコラボ。album.artist_id側は
       あくまでDB上の代表列としての意味しか持たないため、対等な相手をrole='main'として
       追加で紐付けても矛盾しない)を受け取る。billing_orderは
       「そのalbum_idに既にある album_artist 行数 + 2」を自動採番
       (1は album.artist_id 側の暗黙の代表アーティストの定位置として空けておく)。
       (album_id, artist_id)が既に存在する場合はエラーメッセージを返す
       (UNIQUE制約違反をそのままユーザー向けメッセージに変換)。
  └─ export async function unlinkAlbumArtist(formData: FormData)
       album_artistのid1件を削除するだけの単純なCRUD

app/admin/data/albums/[id]/co-artists/page.tsx (新規)
  └─ 指定アルバムの現在の紐付け一覧(album.artist_idの代表アーティスト表示+
     album_artistの追加アーティスト一覧、削除ボタン付き)と、
     SearchableSelect(searchArtists)+roleのプルダウンでの追加フォームを表示する
     (既存の app/admin/data/albums/[id]/tower-lookup, discogs-lookup と同じ
     「1アルバムに対する個別操作ページ」の構成パターンを踏襲)

app/admin/data/artists/[id]/edit/page.tsx (変更)
  └─ 既存の各アルバム行にある「Tower Records取込 →」「Discogs取込 →」リンクの並びに
     「追加アーティストを紐付け →」リンクを追加し、上記co-artistsページへ遷移させる

app/admin/data/discguides/confirm/ConfirmationClient.tsx (変更)
  └─ 各行の「✓ 登録済み」表示の隣に、登録済みかつalbum_idが判明している行のみ
     「追加アーティストを紐付け →」リンクを表示する(register-one成功時のレスポンスに
     album_idが既に含まれている(utils/discGuideRegister.tsのRegisterOneResult)ため、
     そのidを使って上記co-artistsページへ遷移するリンクを組み立てるだけで、
     register-one/route.ts・registerOneConfirmedAlbum自体への変更は不要)

app/albums/[id]/page.tsx (変更)
  └─ 既存の`album`取得に加えて
       supabase.from('album_artist').select('artist_id, role, billing_order, artist:artist_id(id, name)')
         .eq('album_id', id).order('billing_order', { ascending: true, nullsFirst: false })
     を取得。代表アーティスト(album.artist_idから取得済みのartist)を先頭に、
     album_artistの各行(billing_order順)を後続に並べたリストを作り、
     アーティスト名表示部分を単一の<Link>から、カンマ区切りで複数の<Link>を
     並べる形に変更する(1件のみ=album_artist行が無い場合は今まで通りの見た目)

app/artists/[id]/page.tsx (変更)
  └─ 既存のディスコグラフィー取得(`.from('album')...eq('artist_id', id)`)の前に
       supabase.from('album_artist').select('album_id').eq('artist_id', id)
     を取得し、そのalbum_id一覧が1件以上あれば
       .or(`artist_id.eq.${id},id.in.(${albumIds.join(',')})`)
     に切り替える(0件なら従来通り`.eq('artist_id', id)`のみ)。取得結果に
     album_artist経由のアルバムが混ざるため、既存のalbum_type別グルーピング
     ロジックはそのまま使える(表示上は同じ「アルバム一覧」に混在させる。
     「参加作品」のような別セクションには分けない)
```

## UI

- アルバムページのアーティスト名表示: 現状「アーティスト名」の単一リンクを、複数居る場合は「アーティストA, アーティストB」のように読点無しカンマ区切りで、各名前は個別に自分のアーティストページへリンクする
- co-artists管理ページ: 既存の`tower-lookup`/`discogs-lookup`ページと同じ簡素なフォーム1つ+一覧のレイアウト。role選択は「フィーチャリング」「対等なコラボ」の2択のプルダウン
- ディスクガイド確認画面: 登録済み行にのみ薄いテキストリンクを1本追加するだけで、既存レイアウトは変更しない

## エラーハンドリング

- 追加しようとしたartist_idが、そのアルバムの代表アーティスト(album.artist_id)と同じ場合はエラー(「代表アーティストとして既に登録されています」)
- 既に`album_artist`に同じ組み合わせが存在する場合はUNIQUE制約違反をキャッチし、「既に紐付け済みです」を表示
- co-artists管理ページで代表アーティスト(album.artist_id側)の削除はできない(常にalbum.artist_idの1件は残る。削除したい場合は既存のアルバム編集で代表アーティスト自体を変更する運用とし、今回のスコープ外とする)

## テスト方針

- 新規のDBロジック(`linkAlbumArtist`/`unlinkAlbumArtist`)はサーバーアクションのため、既存の同種アクション(`linkArtistGenre`等)と同様に自動テストは書かず、型チェック+手動確認とする(このアプリの既存のadmin CRUDアクション全般がこの方針)
- `app/artists/[id]/page.tsx`のディスコグラフィークエリ変更、`app/albums/[id]/page.tsx`のアーティスト名表示ロジックは、既存のパターンに合わせて手動でブラウザ確認する(1アルバム・2アーティストの実データを1件作って両アーティストのページ・アルバムページを確認する)
