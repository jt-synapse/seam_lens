import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDbPool } from '@/lib/db';
import { resolveCatalogMediaUrl } from '@/lib/supabase/server';
import { requireAtelierAdmin } from '../../access';
import { getEditor } from '@/modules/admin/cockpit-repo';
import { DELIVERY_FORMATS,SKILL_LEVELS,SUBSTRATE_COMPATIBILITIES } from '@/modules/taxonomy/construction-profile';
import { Shell } from '../../Shell';
import ActionForm from '../../ActionForm';
import { curationAction,mergeAction,publishAction } from '../../actions';
import { label } from '../fields';
import { BandFields } from './BandFields';
import { ProfileFields } from './ProfileFields';
import { ImageViewer } from './ImageViewer';

export const metadata = {title:'Pattern editor'};
export default async function EditorPage({params}: {params:Promise<{id:string}>}) {
  const db = getDbPool();
  await requireAtelierAdmin(db);
  const editor = await getEditor(db,(await params).id);
  if (!editor) notFound();
  const {view,bands,sources,targets} = editor;
  const images = [
    {label:'Front flat',url:resolveCatalogMediaUrl(view.flat_front_image_path)},
    {label:'Back flat',url:resolveCatalogMediaUrl(view.flat_back_image_path)},
    {label:'Styled cover',url:resolveCatalogMediaUrl(view.cover_image_path)},
  ].filter((image):image is {label:string;url:string} => !!image.url);
  const flags = [...new Set(sources.flatMap(source=>source.review_flags))];
  return <Shell section="patterns" title={view.title} description={view.maker_name+' · '+view.view_label}>
    <Link href="/admin/patterns">← Curation queue</Link>
    <div className="admin-split"><aside aria-label="Reference material">
      <ImageViewer images={images} title={view.title}/>
      <details className="admin-panel"><summary>Import sources and size charts</summary>
        {sources.length ? sources.map((source,i)=><section key={i}><h3>{source.source_descriptor}</h3>
          {source.raw_payload.descriptionHtml && <details><summary>Original listing description</summary>
            <pre>{source.raw_payload.descriptionHtml}</pre></details>}
          {!!source.raw_payload.sizeBands?.length && <div className="admin-table-wrap"><table>
            <caption>Source size chart · inches</caption><thead><tr><th>Edition</th><th>Bust min / max</th><th>Hip min / max</th></tr></thead>
            <tbody>{source.raw_payload.sizeBands.map((band,index)=><tr key={index}>
              <td>{band.bandLabel}<small>{band.designerSizeLabel}</small></td>
              <td>{band.bustMinIn ?? '—'} / {band.bustMaxIn ?? '—'}</td>
              <td>{band.hipMinIn ?? '—'} / {band.hipMaxIn ?? '—'}</td>
            </tr>)}</tbody></table></div>}
          <details><summary>All source fields</summary><pre>{JSON.stringify(source.raw_payload,null,2)}</pre></details>
        </section>) : <p>No import source recorded.</p>}
      </details>
      <section className="admin-panel"><h2>Catalog visibility</h2>
        <p>Pattern status <strong>{label(view.status)}</strong></p>
        <p className="admin-note">This affects every view of the pattern.</p>
        <ActionForm action={publishAction}><input type="hidden" name="patternId" value={view.pattern_id}/>
          <div className="admin-buttons">{(['published','unpublished','takedown'] as const).map((status,i)=>
            <button type="submit" key={status} name="status" value={status} disabled={status===view.status}
              className={i===2?'admin-danger':i===1?'admin-secondary':undefined}>
              {['Publish','Unpublish','Takedown'][i]}</button>)}</div>
        </ActionForm>
      </section>
      {targets.length>0 && view.status==='draft' && bands.length===1 && bands[0].id && <details className="admin-panel">
        <summary>Merge this edition</summary><p>Move this draft’s size band to another design by {view.maker_name}.</p>
        <ActionForm action={mergeAction}><input type="hidden" name="patternId" value={view.pattern_id}/>
          <label>Destination pattern<select name="targetId" defaultValue="" required><option disabled value="">Choose a pattern</option>
            {targets.map(p=><option value={p.id} key={p.id}>{p.title}</option>)}</select></label>
          <label>Band label on destination<input name="bandLabel" defaultValue={bands[0].bandLabel} required/></label>
          <button type="submit">Merge size band</button></ActionForm></details>}
    </aside>
    <section className="admin-panel"><h2>Construction and sizing</h2>
      <p>{view.human_verified ? 'Human verified' : 'Awaiting verification'} · AI confidence {view.confidence===null?'unavailable':Math.round(view.confidence*100)+'%'}</p>
      {flags.length>0 && <p>{flags.map(flag=><span key={flag} className="admin-chip admin-warning">{label(flag)}</span>)}</p>}
      <ActionForm action={curationAction}><div key={view.revision}>
        <input type="hidden" name="viewId" value={view.id}/><input type="hidden" name="revision" value={view.revision}/>
        <ProfileFields profile={view.construction_profile}/>
        <h3>Pattern details</h3><div className="admin-grid">
          <label>Pattern substrate<select name="substrateType" defaultValue={view.substrate_type}>{SUBSTRATE_COMPATIBILITIES.map(v=>
            <option key={v} value={v}>{label(v)}</option>)}</select></label>
          <label>Skill level<select name="skillLevel" defaultValue={view.skill_level}>{SKILL_LEVELS.map(v=>
            <option key={v} value={v}>{label(v)}</option>)}</select></label>
        </div><fieldset className="admin-options"><legend>Delivery formats</legend>{DELIVERY_FORMATS.map(v=>
          <label key={v} className="admin-check"><input type="checkbox" name="formats" value={v} defaultChecked={view.formats.includes(v)}/>{label(v)}</label>)}</fieldset>
        <BandFields bands={bands}/>
        <button type="submit" className="admin-save">Save &amp; Re-Embed</button>
      </div></ActionForm>
    </section></div>
  </Shell>;
}
