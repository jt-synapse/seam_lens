'use client';

import {useState} from 'react';
import type { EditableBand } from '@/modules/admin/cockpit-repo';

const blankBand: EditableBand = {externalProductId:null,bandLabel:'',productUrl:'',isDefault:false,
  priceCents:null,currency:'USD',designerSizeLabel:null,bustMinIn:null,bustMaxIn:null,hipMinIn:null,hipMaxIn:null};

export function BandFields({bands}: {bands:EditableBand[]}) {
  const [rows,setRows] = useState(() => (bands.length ? bands : [{...blankBand,bandLabel:'Standard',isDefault:true}])
    .map((band,i)=>({band,key:band.id ?? 'raw-'+i,added:false})));
  const [defaultKey,setDefaultKey] = useState(rows.find(row => row.band.isDefault)?.key ?? rows[0].key);
  return <section><h3>Size bands</h3><p className="admin-note">Enter body measurements in inches. Dresses need both hip bounds. Tops may leave both blank.</p>
    {rows.map(({band,key,added},i) => {
      const name = (field:string) => 'band.'+key+'.'+field;
      return <fieldset className="admin-band" key={key}><legend>Band {i+1}</legend>
        <input type="hidden" name="bandKey" value={key}/>
        <input type="hidden" name={name('id')} value={band.id || ''}/>
        <input type="hidden" name={name('externalProductId')} value={band.externalProductId || ''}/>
        <div className="admin-grid"><label>Band label<input name={name('bandLabel')} defaultValue={band.bandLabel} required/></label>
        <label>Designer size label<input name={name('designerSizeLabel')} defaultValue={band.designerSizeLabel ?? ''}/></label></div>
        <label>Product URL<input type="url" name={name('productUrl')} defaultValue={band.productUrl} required/></label>
        <div className="admin-grid">
          <label>Price in minor units<input type="number" min="0" max="2147483647" step="1" name={name('priceCents')} defaultValue={band.priceCents ?? ''}/></label>
          <label>Currency<input name={name('currency')} defaultValue={band.currency} pattern="[A-Z]{3}" maxLength={3} required/></label>
          {(['bustMinIn','bustMaxIn','hipMinIn','hipMaxIn'] as const).map((field,j)=>
            <label key={field}>{['Minimum bust','Maximum bust','Minimum hip','Maximum hip'][j]} (in)
              <input type="number" name={name(field)} step="0.1" min="20" max={[90,95,95,100][j]}
                defaultValue={band[field] ?? ''} required={j<2}/></label>)}
        </div>
        <label className="admin-check"><input type="radio" name="defaultBand" value={key} checked={defaultKey===key}
          onChange={()=>setDefaultKey(key)}/>Default edition</label>
        {added && rows.length>1 && <button className="admin-secondary" type="button" onClick={() => {
          const next = rows.filter(r=>r.key!==key);
          setRows(next);
          if(defaultKey===key) setDefaultKey(next[0].key);
        }}>Remove new band</button>}
      </fieldset>;
    })}
    <button className="admin-secondary" type="button" onClick={()=>setRows(current=>[...current,{band:{...blankBand},key:crypto.randomUUID(),added:true}])}>Add size band</button>
  </section>;
}
