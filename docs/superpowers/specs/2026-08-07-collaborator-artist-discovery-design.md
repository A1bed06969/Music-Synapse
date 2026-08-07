# コラボアーティストの半自動発見・登録 設計

## 背景

Apple Musicバルク登録([2026-08-07-itunes-jp-import-fix](../plans/))の作業中、フィーチャリング・コラボ作品のアルバムは`artistName`が連名(例:「ACAね(ずっと真夜中でいいのに。), Rin音, Yaffle」)になっていることが分かった。現状のバルク登録は主役アーティスト1人分のURLしか受け付けないため、連名に登場する他のアーティストは個別にURLを探して登録する必要がある。Apple Musicの検索APIで名前から候補を探すことは可能だが、実際に試したところ同名・類似名の別人がヒットすることが確認できたため、自動採用はせず人間の確認を必須とする。

## ゴール

- アーティスト編集ページから、そのアーティストのコラボ作品に登場する連名を自動抽出する
- 抽出した名前ごとにApple Music検索APIで候補を探し、人間が確認・選択できるUIを用意する
- 選択した候補を、既存の一括登録ロジックでそのまま取り込む

## 非ゴール(今回やらないこと)

- トラック単位でのフィーチャリング検出(アルバム単位の連名のみを対象とする)
- 検索結果の自動採用(必ず人間の確認を挟む)
- 全アーティストへの自動一括スキャン(オンデマンド・アーティストごとの起動のみ)

## データの前提(実APIで確認済み)

- Apple Musicの検索API(`itunes.apple.com/search?entity=musicArtist`)は、日本語の名前で検索しても同名・類似名の別人がヒットすることがある(例:「Rin音」で検索すると、「Rin音」という文字列がどこにも表示されない別アーティスト(Rinne、RiNなど)が複数返ってくる)。自動採用は不可能と判断した根拠。
- アルバム一覧取得(`entity=album`)の各アルバムオブジェクトの`artistName`は、コラボ・フィーチャリング作品では連名(カンマ・`&`区切り)になっている。この情報はDBには保存されていない(トラック・アルバムの`artist_id`としては主役アーティスト1人分しか記録しない)ため、抽出のたびにApple側へ再取得が必要。

## アーキテクチャ

```
utils/itunes.ts (既存に追記)
  ├─ searchArtist(name: string): Apple Music検索APIを叩き、候補(id, artistName, primaryGenreName, artistLinkUrl)を返す
  └─ extractCollaboratorNames(primaryArtistName: string, albums: ItunesAlbum[]): string[]
     括弧の外側にある「,」「&」で連名を分解し、本人名義と重複するものを除いた人名候補を返す

app/admin/data/artists/[id]/collaborators/page.tsx (新規)
  └─ 対象アーティストの最新アルバム一覧を再取得 → extractCollaboratorNamesで人名候補を抽出
     → 各名前についてsearchArtist(上位5件、DB既存アーティストと重複するIDは除外)
     → 名前ごとにラジオボタン(候補 or 「登録しない」)のフォームを表示

app/admin/data/artists/[id]/collaborators/actions.ts (新規、またはapp/admin/import/actions.tsに追記)
  └─ importSelectedCollaborators(formData): 選択されたartistIdの配列を、既存の
     importArtistsFromItunes(既にURLでも裸のID文字列でも受け付ける)にそのまま渡して取り込む

app/admin/data/artists/[id]/edit/page.tsx (既存に変更)
  └─ 「コラボアーティストを探す」リンクを追加(/admin/data/artists/{id}/collaboratorsへ)
```

- 検索・候補抽出・確認画面はすべてサーバーコンポーネント+フォームで完結させる(新しいクライアントコンポーネントは不要)。選択→登録は既存の`importArtistsFromItunes`をそのまま再利用し、新しい取込みロジックは作らない。

## コンポーネント

### `utils/itunes.ts`の変更

- `searchArtist(name: string): Promise<{artistId: number; artistName: string; primaryGenreName?: string; artistLinkUrl?: string}[]>`
  `https://itunes.apple.com/search?term={encodeURIComponent(name)}&entity=musicArtist&limit=5&country=JP`を叩き、`wrapperType === 'artist'`の結果を返す。
- `extractCollaboratorNames(primaryArtistName: string, albums: ItunesAlbum[]): string[]`
  各アルバムの`artistName`のうち`primaryArtistName`と完全一致しないものを対象に、括弧の深さを追跡しながら深さ0の「,」「&」で分割。トリムし、`primaryArtistName`と一致する断片を除外し、重複を除いて返す。

### `app/admin/data/artists/[id]/collaborators/page.tsx`(新規)

- 対象アーティストの`apple_music_artist_id`でApple Musicから`entity=album`を再取得(`fetchArtistWithAlbums`を再利用)
- `extractCollaboratorNames`で人名候補を抽出。0件なら「連名の作品が見つかりませんでした。」を表示して終了
- 各名前について`searchArtist`を呼び、結果から`apple_music_artist_id`が既存アーティストと一致する候補を除外
- 全候補が除外された(=既に登録済み)名前は「(登録済み)」の注記付きでスキップ表示、候補が0件(見つからなかった)名前も同様にスキップして一覧の下に「見つからなかった名前: ◯◯、△△」とまとめて表示(検索コストの無駄を可視化する目的、個別エラーにはしない)
- 候補が1件以上ある名前ごとに、ラジオボタングループ(各候補 + デフォルト選択の「登録しない」)を表示。各候補にはアーティスト名・ジャンル・Apple Musicへのリンク(`artistLinkUrl`、新規タブで開く)を表示
- 「選択したアーティストを登録する」ボタンで送信

### `importSelectedCollaborators`(新規サーバーアクション)

- フォームから選択された`artistId`(複数、ラジオボタンで「登録しない」以外が選ばれたもの)を集める
- 0件なら何もせず一覧ページに戻す
- `importArtistsFromItunes(selectedIds.map(String))`を呼び出す(既存関数、裸の数字IDも受け付ける)
- 結果を件数と共に元のアーティスト編集ページへの成功メッセージとして表示

### `app/admin/data/artists/[id]/edit/page.tsx`の変更

- 既存の「← 管理画面に戻る」リンクの近くに「コラボアーティストを探す」リンクを追加(`/admin/data/artists/{id}/collaborators`へ)

## データフロー

1. 管理者がアーティスト編集ページで「コラボアーティストを探す」を押す
2. 候補一覧ページがApple Musicから最新のアルバム一覧を取得し、連名を分解、それぞれ検索して候補を表示
3. 管理者が各名前について正しい候補(またはスキップ)を選び、「登録する」を押す
4. 選択されたアーティストが既存の一括登録ロジックで取り込まれる(アルバム・トラックも含めて通常のバルク登録と同じ結果になる)

## エラーハンドリング

- 対象アーティストの`apple_music_artist_id`が無い場合(通常ありえないが念のため)、候補一覧ページで「Apple Music IDが未設定です。」を表示
- 個々の`searchArtist`呼び出しが失敗した場合、その名前だけ「検索に失敗しました」として候補なし扱いにし、他の名前の処理は続行する
- 選択した候補の取込み自体が失敗した場合は、`importArtistsFromItunes`が返す既存のエラーメッセージ形式をそのまま表示する

## テスト方針

- 自動テストは追加しない(既存の検証スタイルに合わせる)
- 実装後にPlaywrightで実機確認:
  1. Yaffle(既に連名クレジットの実例が確認済み)で「コラボアーティストを探す」を実行し、ACAね・Rin音などの候補が表示されることを確認
  2. 候補のApple Musicリンクが正しいURLになっていることを確認
  3. 既存アーティストの重複除外ロジックを確認する: DB上の既存アーティストのApple Music IDを検索候補に紛れ込ませた状態(実データで自然に発生していればそれを使う。無ければテスト用に一時的なデータで再現する)で、その候補が一覧から除外される、または「登録済み」と表示されることを確認
  4. 候補を1件選んで登録し、`artist`/`album`/`track`テーブルに正しく反映されることを確認(既存の一括登録と同じ検証)
