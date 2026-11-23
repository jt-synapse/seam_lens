import { redirect } from 'next/navigation';
import { getDbPool } from '@/lib/db';
import { requireAtelierAdmin } from './access';

export default async function AdminHome() {
  await requireAtelierAdmin(getDbPool());
  redirect('/admin/patterns');
}
