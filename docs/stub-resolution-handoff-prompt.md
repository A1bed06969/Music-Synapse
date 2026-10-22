# 未解決スタブ解消 引き継ぎプロンプト(2026-10-21時点)

以下を新しいセッションにそのまま貼る。

---

あなたは music-synapse(Next.js 16 / ローカルSupabase)の担当です。本番DBは復旧不能で、**ローカルのみで再構築する方針**です(本番の復旧待ちは提案しない)。
目的は、大量に溜まった「未解決スタブ」(アーティスト名だけの行、未照合の候補、確認待ち)を**効率よく・誤紐付けなしで**減らすことです。

## 0. 作業前に守ること
- AGENTS.md: この Next.js は既知のものと違う。コードを書く前に `node_modules/next/dist/docs/` の該当ガイドを読む。
- iTunes を使うプロセスは**同時に1本だけ**(レート制限)。着手前に `ps` で実行中のスクリプトを確認する。待機は `until grep -q marker file` 形式(`pgrep -f` の自己一致ループは禁止)。
- LLM は Gemini 無料枠(約500/日/モデル、日本時間16:00頃リセット)+ Groq フォールバック(`utils/llmJudgeChain.ts` の `generateJudgementText`)。収集スクリプトの終了コード75 = 枠切れ(再開可)。
- 照合は**正規化した完全一致のみ自動採用**。曖昧は review キューへ。ディスクガイドのアルバム照合は人間確認のみ(自動適用しない)。根拠が足りない自動候補付与(`findItunesCandidate` 系)は同名異曲の衝突に注意。
- 画像は外部URLのままにせずローカル保存(`public/images/…`)。mzstatic は `artworkAt(url, px)`。
- 課金: Haiku程度は可。サブスク/Premium系は必ず先に確認。
- 反映手順: `npm run deploy:local`(`.env.local` でビルド→launchctl で :3000 再起動)。手動 `next build` は `.env.production.local`(死んだDB)を読むので使わない。開発確認は :3200。
- コミット: 関連ファイルだけステージ。ユーザーが作業中のファイル(`git status` の M)は巻き込まない。型チェックは HEAD の一時 `git worktree` で。
- 大量書き込みの前にDB容量を確認(docs/data-registration-guidelines.md)。

## 1. コンテンツ別 登録ソース・スキーム

| # | コンテンツ | 登録ソース | 主なスクリプト/画面 | 主なテーブル |
|---|---|---|---|---|
| 01 | ランキング/キュレーション(NME 100、Fender NEXT、Future of Music JP/US、RADAR、タワレコメン、不滅の名盤 等) | 各媒体ページ→Gemini抽出→JSON→取込 | `scripts/extract-future-of-music*.ts`、`import-future-of-music.ts --edition=jp\|us`、`prepare-curation-artists.ts`(Apple Music完全一致1件+名前一致ガード)、`import-towerecomen.ts`、画面 `/admin/data/curation` | ranking / ranking_entry |
| 02 | ディスクガイド | 画像/PDFスキャン→Gemini抽出→ページ単位で人間確認 | `utils/discGuideImport.ts`、`scripts/run-disc-guide-auto-register.ts`、`/admin/data/discguides`、`/admin/data/discguides/confirm` | disc guide 系、最小アルバム(unreleased) |
| 03 | アワード | ネット/Wikipedia、画像は `award.image_url` | `/admin/data/awards` | award / award_entry |
| 04 | フェス/イベント | 公式ラインナップ→`geminiFestivalLineupExtract`→登録 | `scripts/register-festival-lineup.ts`、`extract-merryrockparade-lineup.ts`、`/admin/data/events(/festival-pilot)` | event / event_appearance_artist |
| 05 | ラジオ/TV パワープレイ(ON AIR PUSH MAP) | スプレッドシート(サービスアカウント)・各局サイト | `scripts/extract-tv-power-play.ts`、`extract-spaceshower-recommend.ts`、`import-spaceshower-recommend.ts`、`verify-radio-pick-matches.ts --region=TV`、`match-unmatched-radio-picks.ts`、`backfill-radio-pick-itunes-candidates.ts`、`/admin/data/media/radio-airplay-pick` | media / radio_rotation / radio_airplay_pick |
| 06 | 新譜・カレンダー | iTunes | `/admin/data/albums/pickup`、`/admin/import/search` | album / track |
| 07 | 相関図・ネットワーク | MusicBrainz 等 | `/admin/data/relations`、`/admin/data/artists/musicbrainz-queue` | artist_relation |
| 08 | マップ(ライブハウス/ショップ/会場) | 手動+座標 | `/admin/data/{shops,livehouses,venues}`、`/admin/data/artists/geo` | 各テーブル |
| 09 | ゲーム(ジャケット神経衰弱) | 既存アルバム | `utils/gameData.ts`、`app/game/*` | game_collection / game_play_log |
| 10 | TIE-UP TIME MACHINE | jawiki「◯年のテレビアニメ/テレビドラマ」→主題歌節/基礎情報/スタッフ箇条書き→LLM(4作品/回)→候補→完全一致 | `scripts/collect-sync-candidates.ts`、`match-sync-candidates.ts`、`register-sync-unmatched.ts`、`fix-sync-work-titles.ts`、`run-sync-collection.sh <from> <to>`、画面 `/admin/data/sync/review` | sync_candidate / sync_work / sync_entry |

共通の管理画面: `/admin/data/artists/{review,unmatched,duplicate-review,featured-review,unreleased,musicbrainz-queue}`。

## 2. 現状の未解決(2026-10-21 実測)
- **アーティスト・スタブ**(Apple IDなし・アルバムなし)合計 **87,074**。由来: track_artist 66,603 / ranking_entry 222 / award_entry 101 / event_appearance_artist 22。
  - track_artist 由来の大半は低優先(主にfeat.・クラシック等の付随登録)。**まず ranking_entry/award/event 由来の約345件**から潰す。
- **キュレーション別スタブ**: NME 100 = 127、Fender NEXT = 72、Future of Music US = 19 / JP = 18、RADAR = 2(Gemini照合のバックログは未一括実行)。
- **最小アルバム(未発売扱い)1,002件**: 90s 487 / New Age 101 / HIP HOP 96 / Indie pop 73 ほか。
- **ディスクガイドの確認待ちページ**: Brazil 66(120件)、Asia 89、New Age 83、Indie pop 44、Shoegaze 60、HIP HOP 18、90s 3。
- **タイアップ**: unmatched 約1,199、needs_review 91。範囲収集(2025→2015)がバックグラウンド実行中 → 終了後 `fix-sync-work-titles.ts` を再実行。
- **ラジオ**: HRPP 候補未登録 329、TV 候補未登録 11、TV 候補なし未照合 156。
- Future of Music / RADAR は年次更新でバックログが増えたら再開(保留)。

## 3. 解消の進め方(優先順)
1. **実行中ジョブの確認**(タイアップ連鎖・iTunes使用プロセス)。終わるまで iTunes 系は並走しない。
2. **自動で安全に減らせるもの**: (a) タイアップ unmatched → `register-sync-unmatched.ts`(決定的)→再照合。(b) TV 未照合 → `backfill-radio-pick-itunes-candidates.ts --region=TV`。(c) NME 100/Fender NEXT のスタブ → `prepare-curation-artists.ts`。
3. **人間確認を1画面に集約して高速化**: タイアップ review(`/admin/data/sync/review`)、ディスクガイド確認(Brazil から)。1件1操作で済むよう、候補を確度順に並べ、確度の高いものは一括承認ボタンを検討。
4. **スタブ源ごとの上流対策**: track_artist 由来の増殖(feat.・クラシック)は、登録時に「アルバムを持つ本体のみ」アーティスト化するルールに寄せられないか調査(まず現状の生成経路を特定してから提案)。
5. 各段階で件数を再計測し、増減を報告する。誤紐付けを見つけたら、重複行の有無を先に確認(統合してから修正)。

## 4. 最初にやること
1. `ps` と `/private/tmp/sync-collection.log` で実行中ジョブを確認。
2. 上記の件数を `docker exec supabase_db_music-synapse psql` で再計測し、差分を報告。
3. 2の(a)〜(c)のうち、LLM/iTunes枠の状況に合うものから着手方針を1つ提案して実行。
