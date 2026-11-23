import type { Metadata } from 'next';
import { DiscoveryWorkspace } from '@/components/discovery-workspace';
import { PublicShell } from '@/components/public-shell';

export const metadata: Metadata = {title: 'Pattern matches · SeamLens Studio', robots: {index: false}};
export default async function SearchPage({ searchParams }: { searchParams: Promise<{q?: string | string[]}> }) {
  const { q } = await searchParams;
  return <PublicShell><DiscoveryWorkspace querySessionId={typeof q === 'string' && q ? q : null}/></PublicShell>;
}
