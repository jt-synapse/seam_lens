import type { ReactNode } from 'react';
import './admin.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: {default:'Atelier Admin · SeamLens Studio', template:'%s · Atelier Admin'}, robots:{index:false,follow:false} };

export default function AdminLayout({children}: {children: ReactNode}) {
  return <div className="atelier-admin">{children}</div>;
}
