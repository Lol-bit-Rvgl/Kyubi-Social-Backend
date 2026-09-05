import AdminSidebar from '@/components/admin/AdminSidebar';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#0d0d12] text-slate-100">
      <AdminSidebar />
      {/* pt-14 en móvil deja sitio al topbar fijo del sidebar */}
      <main className="w-full flex-1 overflow-x-hidden pt-14 md:pt-0 p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}
