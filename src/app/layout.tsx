import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kyubi Moderation & API',
  description: 'Backend y panel administrativo de Kyubi',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
