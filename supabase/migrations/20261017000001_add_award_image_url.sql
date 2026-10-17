-- 受賞・ノミネートのカード(アーティスト詳細の AWARDS)に出す、賞のメインビジュアル。
-- 自サイトに保存した画像のパス(/images/awards/...)を入れる(外部URLだとスマホで読めないことがあったため)。
ALTER TABLE award ADD COLUMN IF NOT EXISTS image_url TEXT;
