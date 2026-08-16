import { useEffect, useState } from 'react';
import { ProgressRing, Topbar, useToc } from './chrome.jsx';
import { components } from './components.jsx';
import { docMeta, docs } from './docs.js';
import { NarrationRail } from './player.jsx';
import { formatDuration, getProvenance, startTracking } from './provenance.js';
import { Shell } from './shell.jsx';

function Reader({ slug }) {
  const Doc = docs[slug];
  const { toc, minutes } = useToc();
  useEffect(() => startTracking(slug), [slug]);

  // Pick up where you left off. Restore waits a beat for fonts to settle the
  // layout; near-top positions aren't worth restoring.
  useEffect(() => {
    const key = `selfdoc:${slug}:pos`;
    const saved = Number(localStorage.getItem(key));
    const settle = setTimeout(() => {
      if (saved > 400 && window.scrollY < 50) window.scrollTo({ top: saved });
    }, 350);
    let timer;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => localStorage.setItem(key, String(Math.round(window.scrollY))), 300);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(settle);
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [slug]);
  return (
    <>
      <Topbar slug={slug} minutes={minutes} />
      <main>
        <Doc components={components} />
      </main>
      <ProgressRing toc={toc} />
      <NarrationRail slug={slug} />
      <Shell slug={slug} />
    </>
  );
}

function DocCard({ slug }) {
  const { title, excerpt, minutes } = docMeta(slug);
  const [prov, setProv] = useState(null);
  useEffect(() => {
    getProvenance(slug).then((data) => {
      if (data?.readingMs) setProv(data);
    });
  }, [slug]);
  return (
    <a className="doc-card" href={`?doc=${slug}`}>
      <strong>{title}</strong>
      <p>{excerpt}</p>
      <span className="doc-card-meta">
        {minutes} min read
        {prov && ` · ✍ ${formatDuration(prov.readingMs)} · ${prov.edits ?? 0} edits`}
      </span>
    </a>
  );
}

function Home() {
  const slugs = Object.keys(docs);
  return (
    <>
      <Topbar />
      <main className="home">
        <h1>Documents</h1>
        <div className="doc-grid">
          {slugs.map((slug) => (
            <DocCard key={slug} slug={slug} />
          ))}
        </div>
      </main>
    </>
  );
}

export default function App() {
  const requested = new URLSearchParams(location.search).get('doc');
  const slugs = Object.keys(docs);
  if (docs[requested]) return <Reader slug={requested} />;
  // A single-doc build (per-doc export) has no home to go to.
  if (slugs.length === 1) return <Reader slug={slugs[0]} />;
  return <Home />;
}
