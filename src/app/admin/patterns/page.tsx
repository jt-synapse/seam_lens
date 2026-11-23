import Link from 'next/link';
import { getDbPool } from '@/lib/db';
import { requireAtelierAdmin } from '../access';
import { listQueue } from '@/modules/admin/cockpit-repo';
import { Shell } from '../Shell';
import { label } from './fields';

export const metadata = {title:'Curation queue'};
export default async function QueuePage({searchParams}: {searchParams:Promise<{filter?:string;merged?:string}>}) {
  const db = getDbPool();
  await requireAtelierAdmin(db);
  const [queue,query] = await Promise.all([listQueue(db),searchParams]);
  const needsReview = queue.filter(row => row.flags.length || !row.human_verified);
  const review = query.filter === 'review';
  const rows = review ? needsReview : queue;
  return <Shell section="patterns" title="Curation queue" description="Review construction, measurements and publication status for each garment view.">
    {query.merged === '1' && <p role="status" className="admin-success">Size band merged into the selected pattern.</p>}
    <nav className="admin-tabs" aria-label="Filter curation queue">
      <Link href="/admin/patterns" aria-current={!review?'page':undefined}>All views ({queue.length})</Link>
      <Link href="/admin/patterns?filter=review" aria-current={review?'page':undefined}>Needs review ({needsReview.length})</Link>
    </nav>
    {rows.length ? <div className="admin-table-wrap"><table><thead><tr>
      <th>Pattern view</th><th>Maker</th><th>Review</th><th>AI confidence</th><th>Catalog status</th>
    </tr></thead><tbody>{rows.map(row=><tr key={row.id}>
      <td><Link className="admin-row-title" href={'/admin/patterns/'+row.id}>{row.title}<small>{row.view_label}</small></Link></td>
      <td>{row.maker_name}</td><td>{row.flags.length ? row.flags.map(flag=>
        <span className="admin-chip admin-warning" key={flag}>{label(flag)}</span>) :
        row.human_verified ? 'Verified' : 'Awaiting review'}</td>
      <td>{row.confidence === null ? 'Unavailable' : Math.round(row.confidence*100)+'%'}</td><td>{label(row.status)}</td>
    </tr>)}</tbody></table></div> : <p>{review?'No views need review.':'No patterns yet. Import a catalog to start the queue.'}</p>}
  </Shell>;
}
