import type {ConstructionProfileV1} from '@/modules/taxonomy/construction-profile';
import { groups,label } from '../fields';

export function ProfileFields({profile}: {profile:ConstructionProfileV1}) {
  const root = profile as Record<string,unknown>;
  return <>{groups.map(group => {
    const section = (group.section ? root[group.section] : root) as Record<string,unknown>;
    return <details key={group.section} open={group.section === '' || group.section === 'silhouette'} className="admin-editor-group">
      <summary>{group.title}</summary><div className="admin-grid">
      {group.fields.map(field => {
        const name = group.section+'.'+field.key;
        const value = section[field.key];
        if (field.kind==='many') return <fieldset key={name} className="admin-options">
          <legend>{label(field.key)}</legend>{field.options?.map(option=>
            <label className="admin-check" key={option}><input type="checkbox" name={name} value={option}
              defaultChecked={Array.isArray(value) && value.includes(option)}/>{label(String(option))}</label>)}</fieldset>;
        if (field.kind==='boolean') return <label className="admin-check" key={name}>
          <input type="checkbox" name={name} defaultChecked={value===true}/>{label(field.key)}</label>;
        if (field.kind==='note') return <label key={name}>{label(field.key)}
          <textarea name={name} rows={3} defaultValue={String(value ?? '')} maxLength={300}/></label>;
        return <label key={name}>{label(field.key)}<select name={name} defaultValue={String(value)} required>
          {field.options?.map(option=><option key={option} value={option}>{label(String(option))}</option>)}
        </select></label>;
      })}</div></details>;
  })}</>;
}
