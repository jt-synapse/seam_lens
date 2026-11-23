import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource-variable/plus-jakarta-sans/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function PublicShell({ children }: { children: ReactNode }) {
  return <div className="public-studio" id="top">
    <a className="studio-skip" href="#discovery-content">Skip to discovery</a>
    <header className="studio-masthead">
      <div className="studio-frame studio-header-row">
        <Link className="studio-wordmark" href="/" aria-label="SeamLens Studio home">
          <span className="studio-mark" aria-hidden="true"><i/><i/><i/></span>
          <span>Seam<i>Lens</i></span><small>Studio</small>
        </Link>
        <nav aria-label="Discovery">
          <Link href="/#upload">Find a pattern</Link>
          <Link href="/#archetypes">Sample silhouettes</Link>
        </nav>
      </div>
    </header>
    <div id="discovery-content" tabIndex={-1}>{children}</div>
  </div>;
}
