import AdminSidebarNav from './AdminSidebarNav'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row">
      <AdminSidebarNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
