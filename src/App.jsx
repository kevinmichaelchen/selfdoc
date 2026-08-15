import { ProgressRing, Topbar, useToc } from './chrome.jsx';
import { components } from './components.jsx';
import { DEFAULT_DOC, docs } from './docs.js';
import { Shell } from './shell.jsx';

function Reader({ slug }) {
  const Doc = docs[slug];
  const { toc, minutes } = useToc();
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

function Compare({ slugs }) {
  return (
    <div className="compare">
      {slugs.map((slug) => (
        <iframe
          key={slug}
          className="compare-pane"
          src={`${location.pathname}?doc=${slug}`}
          title={slug}
        />
      ))}
    </div>
  );
}

export default function App() {
  const params = new URLSearchParams(location.search);
  const compare = params.get('compare');
  if (compare) {
    const slugs = compare.split(',').filter((slug) => docs[slug]);
    if (slugs.length >= 2) return <Compare slugs={slugs} />;
  }
  const requested = params.get('doc');
  return <Reader slug={docs[requested] ? requested : DEFAULT_DOC} />;
}
