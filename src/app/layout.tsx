import './globals.css';
import { DemoImagePreviews } from '@/components/demo-image-preview';
import { DEMO_REFERENCE_URL, DEMO_SHOPIFY_IMAGE_URL } from '@/lib/local-demo-fixtures';
import { isLocalDemo } from '@/lib/local-demo';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'SeamLens Studio' };

export default function RootLayout({ children }: { children: ReactNode }) {
  const demo = isLocalDemo();
  const previews = demo ? Object.fromEntries([DEMO_REFERENCE_URL, DEMO_SHOPIFY_IMAGE_URL].map(source => {
    const preview = new URL(new URL(source).pathname, process.env.NEXT_PUBLIC_SUPABASE_URL);
    preview.searchParams.set('view', '1');
    return [source, preview.href];
  })) : null;
  return <html lang="en"><body style={{margin: 0}}>{demo && (
    <aside className="local-demo-bar" aria-label="Local demonstration">
      <span><strong>Local demo</strong> · Simulated photo analysis</span>
      <nav aria-label="Demo navigation">
        <a href="/">Search</a><a href="/admin">Curator workspace</a>
        <a href={process.env.NEXT_PUBLIC_SUPABASE_URL}>Demo guide</a>
      </nav>
    </aside>
  )}{previews ? <DemoImagePreviews images={previews}>{children}</DemoImagePreviews> : children}</body></html>;
}
