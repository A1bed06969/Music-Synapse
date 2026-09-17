-- festival_pilot_dataset/event_link/artist_linkはRLSが無効なまま作成されており、
-- anonキーで誰でも読み書きできる状態だった。書き込みは全てcreateAdminClient
-- (service_role、RLSをバイパス)経由のみで行われているため、公開読み取りだけを
-- 許可するポリシーを付けて有効化する。
ALTER TABLE public.festival_pilot_dataset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.festival_pilot_event_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.festival_pilot_artist_link ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON public.festival_pilot_dataset FOR SELECT USING (true);
CREATE POLICY "public read" ON public.festival_pilot_event_link FOR SELECT USING (true);
CREATE POLICY "public read" ON public.festival_pilot_artist_link FOR SELECT USING (true);
