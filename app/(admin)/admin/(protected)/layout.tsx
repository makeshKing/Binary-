import { redirect } from 'next/navigation';
import { verifyAdminServerSession } from '@/lib/supabase/admin-server';
import AdminShell from '@/components/admin/AdminShell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifyAdminServerSession('SUPPORT');

  if (!session) {
    redirect('/admin/login');
  }

  return <AdminShell session={session}>{children}</AdminShell>;
}
