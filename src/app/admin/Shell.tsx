import Link from 'next/link';
import ActionForm from './ActionForm';
import {logoutAction} from './actions';
import type {ReactNode} from 'react';

const sections = [
  ['patterns','Curation queue'],['imports','Imports'],['makers','Makers'],['telemetry','Telemetry'],
] as const;

export function Shell({section,title,description,children}: {
  section: typeof sections[number][0]; title:string; description?:string; children:ReactNode;
}) {
  return <>
    <a className="admin-skip" href="#admin-content">Skip to content</a>
    <header className="admin-bar"><Link href="/admin" className="admin-brand">SeamLens <i>Studio</i></Link>
      <span className="admin-workspace">Atelier Admin</span>
      <nav aria-label="Atelier Admin">{sections.map(([key,name]) =>
        <Link key={key} href={'/admin/'+key} aria-current={key === section ? 'page' : undefined}>{name}</Link>)}</nav>
      <ActionForm action={logoutAction}><button type="submit" className="admin-signout">Sign out</button></ActionForm>
    </header>
    <main id="admin-content" className="admin-main"><header className="admin-heading">
      <h1>{title}</h1>{description && <p>{description}</p>}</header>{children}</main>
  </>;
}
