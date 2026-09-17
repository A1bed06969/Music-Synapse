-- supabase/migrations/20260819_add_tour_event_type.sql
-- イベント種別に「ツアー」を追加する(既存はfestival/one_off_live/otherのみ)。
ALTER TABLE event DROP CONSTRAINT event_event_type_check;
ALTER TABLE event ADD CONSTRAINT event_event_type_check
  CHECK (event_type = ANY (ARRAY['festival', 'one_off_live', 'tour', 'other']));
