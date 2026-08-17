// app/admin/data/discguides/confirm/page.tsx

import Link from 'next/link'
import { createAdminClient } from '@/utils/Supabase/admin'
import ConfirmationClient from './ConfirmationClient'

type GuideRef = { title: string } | { title: string }[] | null

function guideTitle(ref: GuideRef): string {
  const guide = Array.isArray(ref) ? ref[0] : ref
  return guide?.title ?? '(書籍不明)'
}

export default async function DiscGuideScanConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ pending_id?: string }>
}) {
  const { pending_id } = await searchParams
  // disc_guide_scan_pending は RLS 有効・ポリシー無しの管理専用テーブルのため、
  // anon クライアントでは 0 件になる。service_role で読む。
  const supabase = createAdminClient()

  // Fetch pending records
  const { data: pendingRecords } = await supabase
    .from('disc_guide_scan_pending')
    .select('id, disc_guide:disc_guide_id(title), status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  let selectedPending = null
  if (pending_id) {
    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .select('*')
      .eq('id', pending_id)
      .single()
    selectedPending = pending
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/discguides" className="text-xs text-white/40 hover:text-white/70">
        ← ディスクガイド管理に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">スキャン確認</h1>

      <div className="mt-6 grid grid-cols-4 gap-4">
        {/* Pending list */}
        <div className="col-span-1">
          <h2 className="text-sm font-semibold text-white/60">確認待ちページ一覧</h2>
          {(!pendingRecords || pendingRecords.length === 0) && (
            <p className="mt-2 text-xs text-white/30">確認待ちのページはありません。</p>
          )}
          <ul className="mt-2 space-y-1">
            {pendingRecords?.map((rec) => (
              <li key={rec.id}>
                <a
                  href={`?pending_id=${rec.id}`}
                  className={`block rounded px-2 py-1 text-sm ${
                    rec.id === pending_id
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'text-white/60 hover:bg-white/5'
                  }`}
                >
                  {guideTitle(rec.disc_guide)} — {new Date(rec.created_at).toLocaleString('ja-JP')}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Confirmation panel */}
        <div className="col-span-3">
          {selectedPending ? (
            <ConfirmationClient pending={selectedPending} />
          ) : (
            <p className="text-sm text-white/30">左から確認するページを選択してください</p>
          )}
        </div>
      </div>
    </div>
  )
}
