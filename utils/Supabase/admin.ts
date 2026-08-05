// utils/Supabase/admin.ts
// service_role key を使う管理者用クライアント。
// RLSを無視するため、サーバー側の管理者操作(バルク登録等)以外では絶対に使わないこと。
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}