import { useEffect } from 'react';
import { ProgressRing, Topbar, useToc } from './chrome.jsx';
import { components } from './components.jsx';
import { DEFAULT_DOC, docs } from './docs.js';
import { startTracking } from './provenance.js';
import { Shell } from './shell.jsx';

function Reader({ slug }) {
  const Doc = docs[slug];
  const { toc, minutes } = useToc();
  useEffect(() => startTracking(slug), [slug]);
  return (
    <>
      <Topbar slug={slug} slugs={Object.keys(docs)} minutes={minutes} />
      <main>
        <Doc components={components} />
      </main>
      <ProgressRing toc={toc} />
      <Shell slug={slug} />
    </>
  );
}

export default function App() {
  const requested = new URLSearchParams(location.search).get('doc');
  return <Reader slug={docs[requested] ? requested : DEFAULT_DOC} />;
}
