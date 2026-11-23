'use client';
import {useState} from 'react';

export function ImageViewer({images,title}: {images:{label:string;url:string}[];title:string}) {
  const [selected,setSelected] = useState(0);
  const [zoom,setZoom] = useState(false);
  const image = images[selected];
  if (!image) return <p>No reference images available.</p>;
  return <section className="admin-panel"><h2>Image reference</h2>
    <div className="admin-buttons">{images.map((img,i)=><button key={img.label} type="button" className="admin-secondary"
      aria-pressed={selected===i} onClick={()=>{setSelected(i);setZoom(false);}}>{img.label}</button>)}</div>
    <div className={'admin-image'+(zoom?' enlarged':'')} role="region" aria-label={image.label} tabIndex={0}>
      <img alt={title+' · '+image.label} src={image.url}/></div>
    <button className="admin-secondary" type="button" aria-pressed={zoom} onClick={()=>setZoom(!zoom)}>{zoom?'Fit image':'Zoom image'}</button>
  </section>;
}
