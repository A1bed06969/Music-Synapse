'use client'

import { useFormStatus } from 'react-dom'

export default function SubmitButton({ label = '一括更新を実行' }: { label?: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85 disabled:opacity-40"
    >
      {pending ? '更新中...' : label}
    </button>
  )
}
