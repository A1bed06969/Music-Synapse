// app/admin/data/discguides/DiscGuideDriveImport.tsx
// Google Driveフォルダから画像を読み込むためのフォーム。ローカルアップロード
// (DiscGuideImageUpload.tsx)と同じdisc_guide_scan_pendingパイプラインに合流する。
// フォームのaction propに直接Server Actionを渡すだけなのでClient Component化は不要。
import { startDriveImport } from './actions'

export default function DiscGuideDriveImport({ discGuideId }: { discGuideId: string }) {
  return (
    <form action={startDriveImport} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="disc_guide_id" value={discGuideId} />
      <input
        type="text"
        name="folder_url"
        placeholder="GoogleDriveフォルダのURL(または共有設定後のフォルダID)"
        required
        className="min-w-[280px] flex-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/30"
      />
      <button
        type="submit"
        className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-700"
      >
        Driveから読み込む
      </button>
    </form>
  )
}
