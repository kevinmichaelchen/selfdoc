import { useEffect, useState } from 'react';
import { formatDuration, getProvenance } from './provenance.js';

const READ_WPM = 220;
const words = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const minutesFor = (count) => Math.max(1, Math.round(count / READ_WPM));

/**
 * The reading chrome is derived from the rendered document after mount —
 * nothing is stored, so it can never disagree with the source file.
 */
export function useToc() {
  const [state, setState] = useState({ toc: [], minutes: 0 });
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const toc = [...main.querySelectorAll('h2')].map((heading) => {
      const id = heading.textContent
        .toLowerCase()
        .replace(/[^\w]+/g, '-')
        .replace(/^-+|-+$/g, '');
      heading.id = id;
      let count = 0;
      for (
        let node = heading.nextElementSibling;
        node && node.tagName !== 'H2';
        node = node.nextElementSibling
      ) {
        count += words(node.textContent);
      }
      return { id, text: heading.textContent, minutes: minutesFor(count) };
    });
    setState({ toc, minutes: minutesFor(words(main.textContent)) });
  }, []);
  return state;
}

export function Topbar({ slug, slugs, minutes }) {
  return (
    <nav className="topbar" aria-label="Document navigation">
      <span className="topbar-left">
        <span className="topbar-brand">selfdoc</span>
        {slugs.length > 1 &&
          slugs.map((s) => (
            <a key={s} href={`?doc=${s}`} aria-current={s === slug ? 'page' : undefined}>
              {s}
            </a>
          ))}
      </span>
      <span className="topbar-right">
        <ProvenanceStamp slug={slug} />
        <span>{minutes} min read</span>
      </span>
    </nav>
  );
}

/**
 * The document's watermark: real authoring activity, tracked in dev, stored
 * beside the source, baked into the export. Proof the author showed up.
 */
function ProvenanceStamp({ slug }) {
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getProvenance(slug).then((data) => {
      if (data?.readingMs) setStats(data);
    });
  }, [slug]);

  if (!stats) return null;
  const day = (iso) => new Date(iso).toLocaleDateString();
  return (
    <span className="prov-wrap">
      <button
        type="button"
        className="prov-stamp"
        aria-expanded={open}
        title="Authoring provenance"
        onClick={() => setOpen((v) => !v)}
      >
        ✍ {formatDuration(stats.readingMs)}
      </button>
      {open && (
        <div className="prov-panel">
          <p className="toc-eyebrow">Provenance</p>
          <dl>
            <dt>sessions</dt>
            <dd>{stats.sessions ?? 0}</dd>
            <dt>doc open</dt>
            <dd>{formatDuration(stats.readingMs)}</dd>
            <dt>actively editing</dt>
            <dd>{formatDuration(stats.editingMs)}</dd>
            <dt>edits landed</dt>
            <dd>{stats.edits ?? 0}</dd>
            {stats.firstSeen && (
              <>
                <dt>span</dt>
                <dd>
                  {day(stats.firstSeen)} → {day(stats.lastSeen)}
                </dd>
              </>
            )}
          </dl>
          <p className="prov-note">
            Measured from real authoring activity, stored beside the source.
          </p>
        </div>
      )}
    </span>
  );
}

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressRing({ toc }) {
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 1);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div className="ring-wrap">
      {open && (
        <nav className="toc-pop" aria-label="Contents">
          <p className="toc-eyebrow">Contents</p>
          <ol>
            {toc.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`} onClick={() => setOpen(false)}>
                  <span>{entry.text}</span>
                  <span className="toc-min">{entry.minutes} min</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <button
        type="button"
        className="ring"
        aria-expanded={open}
        aria-label={`Reading progress ${Math.round(progress * 100)}% — open contents`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 36 36" width="46" height="46" aria-hidden="true">
          <circle cx="18" cy="18" r={RADIUS} fill="none" stroke="var(--line)" strokeWidth="2.6" />
          <circle
            cx="18"
            cy="18"
            r={RADIUS}
            fill="none"
            stroke="var(--accent-2)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            transform="rotate(-90 18 18)"
          />
        </svg>
        <span className="ring-pct">{Math.round(progress * 100)}</span>
      </button>
    </div>
  );
}
