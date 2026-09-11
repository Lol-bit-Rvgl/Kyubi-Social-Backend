import AdminSidebar from '@/components/admin/AdminSidebar';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col md:flex-row min-h-screen bg-[#07070b] text-slate-100 overflow-x-hidden">
      {/* Ambient background glow / radial gradient mesh */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 w-[700px] h-[500px] bg-violet-600/10 rounded-full blur-[140px] mix-blend-screen" />
        <div className="absolute top-1/3 -right-40 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[160px] mix-blend-screen" />
        <div className="absolute -bottom-40 left-1/3 w-[500px] h-[500px] bg-pink-600/5 rounded-full blur-[150px] mix-blend-screen" />
      </div>

      <AdminSidebar />
      {/* pt-16 en móvil deja sitio al topbar fijo del sidebar */}
      <main className="relative z-10 w-full flex-1 overflow-x-hidden pt-16 md:pt-0 p-4 sm:p-6 md:p-8">
        {children}
      </main>
    </div>
  );
}
