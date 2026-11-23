import type { Metadata } from 'next';
import { getDbPool } from '@/lib/db';
import { listActiveArchetypes, type CuratedArchetypeSummary } from '@/modules/catalog/archetypes-repo';
import { UploadDock, ArchetypeGallery } from '@/components/upload-dock';
import { PublicShell } from '@/components/public-shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'SeamLens Studio · Visual sewing pattern search',
  description: 'Find indie sewing patterns that share the cut, neckline and sleeves of a dress or top you love.',
};

export default async function HomePage() {
  let samples: CuratedArchetypeSummary[] = [];
  let catalogUnavailable = false;
  try {
    samples = await listActiveArchetypes(getDbPool());
  } catch {
    catalogUnavailable = true;
  }
  return <PublicShell>
    <main className="studio-frame studio-home">
      <div className="studio-hero">
        <section className="studio-editorial" aria-labelledby="discovery-title">
          <img className="studio-hero-image" src="/atelier/pleated-linen.webp" alt="" fetchPriority="high" width="1200" height="900" />
          <div className="studio-editorial-text">
            <p className="studio-scope">Dress &amp; top patterns</p>
            <h1 id="discovery-title">From a photo<br/>to <em>a pattern.</em></h1>
            <p className="studio-intro">Find indie sewing patterns with the neckline, sleeves and silhouette you love.</p>
          </div>
        </section>
        <UploadDock archetypes={samples}/>
      </div>
      {!samples.length ? <section className="studio-catalog-status" id="archetypes">
        <h2>Sample silhouettes</h2><p>{catalogUnavailable ? 'We couldn’t load the catalog. Refresh this page to try again.' : 'There are no active samples. Add a garment photo to start a search.'}</p>
      </section> : <ArchetypeGallery archetypes={samples}/>}
    </main>
  </PublicShell>;
}
