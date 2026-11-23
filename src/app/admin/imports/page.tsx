import Link from 'next/link';
import { getDbPool } from '@/lib/db';
import { requireAtelierAdmin } from '../access';
import { listBatches,listBatchItems,listMakers } from '@/modules/admin/cockpit-repo';
import { Shell } from '../Shell';
import ActionForm from '../ActionForm';
import { importAction,retryAction } from '../actions';
import { label } from '../patterns/fields';
import BatchRunner from './BatchRunner';

export const metadata = {title:'Imports'};
export default async function ImportsPage({searchParams}: {searchParams:Promise<{batch?:string}>}) {
  const db = getDbPool();
  await requireAtelierAdmin(db);
  const [makers,batches,query] = await Promise.all([listMakers(db),listBatches(db),searchParams]);
  const selected = batches.find(b => b.id === query.batch) ?? batches[0];
  const items = selected ? await listBatchItems(db,selected.id) : [];
  const approved = makers.filter(m => m.vetted_status === 'approved');
  return <Shell section="imports" title="Batch imports" description="Bring permissioned maker listings into the curation queue.">
    {approved.length ? <div className="admin-grid">{(['csv_upload','shopify_json'] as const).map(source => <section key={source} className="admin-panel">
      <h2>{source === 'csv_upload' ? 'CSV upload' : 'Shopify storefront'}</h2><ActionForm action={importAction}>
        <input type="hidden" name="sourceType" value={source}/><label>Approved maker<select name="makerId" required defaultValue="">
          <option value="" disabled>Choose a maker</option>{approved.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        {source === 'csv_upload' ? <label>Catalog CSV · up to 900 KB<input type="file" name="csv" accept=".csv,text/csv" required/></label>
          : <label>Storefront, collection or product URL<input name="source" placeholder="Leave blank for the entire storefront"/></label>}
        <button type="submit">{source === 'csv_upload' ? 'Import CSV' : 'Import from Shopify'}</button>
      </ActionForm></section>)}</div> : <p>Approve a maker in the <Link href="/admin/makers">makers directory</Link> to start an import.</p>}
    <h2>Batch history</h2>{selected ? <div className="admin-imports"><nav aria-label="Import batches" className="admin-batches">
      {batches.map(b=><Link key={b.id} href={'/admin/imports?batch='+b.id} aria-current={b.id===selected.id?'page':undefined}>
        <strong>{b.maker_name}</strong><span>{b.source_descriptor} · {label(b.status)}</span></Link>)}</nav>
      <section className="admin-panel"><h3>{selected.maker_name}</h3><p>{selected.source_descriptor}</p>
        <p>{selected.completed_items} completed / {selected.total_items} total · {selected.failed_items} failed · {label(selected.status)}</p>
        <progress aria-label="Import progress" max={selected.total_items || 1} value={selected.completed_items+selected.failed_items}/>
        <BatchRunner key={selected.id} batchId={selected.id} active={selected.vetted_status==='approved' && ['queued','processing'].includes(selected.status)}/>
        {selected.vetted_status!=='approved' && <p>Processing requires an approved maker.</p>}
        <ul className="admin-list">{items.map(i=><li key={i.id}><div><strong>{i.view_id?<Link href={'/admin/patterns/'+i.view_id}>{i.title}</Link>:i.title}</strong>
          <small>{label(i.stage)} · {i.attempts} attempts</small>{i.error_message && <p>{i.error_message}</p>}</div>
          {i.stage==='failed' && selected.vetted_status==='approved' && <ActionForm action={retryAction}>
            <input type="hidden" name="itemId" value={i.id}/><button type="submit" className="admin-secondary">Retry item</button></ActionForm>}</li>)}</ul>
      </section></div> : <p>No import batches yet.</p>}
  </Shell>;
}
