'use client'

import { useFormStatus } from 'react-dom'

export default function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-40"
    >
      {pending ? '登録中...' : '登録'}
    </button>
  )
}
