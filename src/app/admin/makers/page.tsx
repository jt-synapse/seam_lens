import { getDbPool } from '@/lib/db';
import { requireAtelierAdmin } from '../access';
import { listMakers, type Maker } from '@/modules/admin/cockpit-repo';
import { Shell } from '../Shell';
import ActionForm from '../ActionForm';
import { makerAction } from '../actions';

function MakerForm({maker}: {maker?:Maker}) {
  return <ActionForm action={makerAction}>
    {maker && <><input type="hidden" name="id" value={maker.id}/><input type="hidden" name="revision" value={maker.revision}/></>}
    <div className="admin-grid">
      <label>Maker name<input name="name" defaultValue={maker?.name} required maxLength={160}/></label>
      <label>Maker slug<input name="slug" defaultValue={maker?.slug} placeholder="atelier-name" pattern="[a-z0-9]+(-[a-z0-9]+)*" required/></label>
      <label>Storefront URL<input type="url" name="storefront_url" placeholder="https://" defaultValue={maker?.storefront_url} required/></label>
      <label>Platform<select name="platform_type" defaultValue={maker?.platform_type || 'shopify'}>
        <option value="shopify">Shopify</option><option value="woocommerce">WooCommerce</option><option value="custom">Custom</option></select></label>
      <label>UTM campaign<input name="utm_campaign_slug" defaultValue={maker?.utm_campaign_slug || 'seamlens_v1'} required/></label>
      <label>Affiliate query parameters<input name="affiliate_query_param" defaultValue={maker?.affiliate_query_param ?? ''} placeholder="ref=seamlens"/></label>
    </div>
    <label>Opt-in permission evidence<textarea name="permission_evidence_note" rows={3} defaultValue={maker?.permission_evidence_note ?? ''}
      placeholder="Record who granted permission, when and for which listings." maxLength={4000}/></label>
    <label>Vetting status<select name="vetted_status" defaultValue={maker?.vetted_status ?? 'pending'}>
      <option value="pending">Pending</option><option value="approved">Approved</option><option value="suspended">Suspended</option></select></label>
    <p className="admin-note">Approval enables imports. Suspension hides this maker’s catalog from live search.</p>
    <button type="submit">{maker ? 'Save maker' : 'Add maker'}</button>
  </ActionForm>;
}

export const metadata = {title:'Makers'};
export default async function MakersPage() {
  const db = getDbPool();
  await requireAtelierAdmin(db);
  const makers = await listMakers(db);
  return <Shell section="makers" title="Makers" description="Manage permission, attribution and catalog access for each pattern house.">
    <details className="admin-panel"><summary>Add a maker</summary><MakerForm/></details>
    <div className="admin-stack">{makers.map(m => <details key={m.id} className="admin-panel">
      <summary><span>{m.name}</span> <span className="admin-chip">{m.vetted_status}</span></summary>
      <MakerForm maker={m}/></details>)}</div>
  </Shell>;
}
