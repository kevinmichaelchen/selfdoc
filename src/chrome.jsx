import { useEffect, useState } from 'react';
import { sources } from './docs.js';
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

export function Topbar({ slug, minutes }) {
  return (
    <nav className="topbar" aria-label="Document navigation">
      <span className="topbar-left">
        <a className="topbar-brand" href="./">
          selfdoc
        </a>
      </span>
      {slug && (
        <span className="topbar-right">
          <CopyMarkdown slug={slug} />
          <ProvenanceStamp slug={slug} />
          <span>{minutes} min read</span>
        </span>
      )}
    </nav>
  );
}

/** One click hands the whole source to a reader's agent. */
function CopyMarkdown({ slug }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="prov-stamp"
      title="Copy the document's markdown source"
      onClick={async () => {
        await navigator.clipboard.writeText(sources[slug]);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? '✓ copied' : '⧉ copy md'}
    </button>
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
            <dd>
              {stats.sessions ?? 0}
              {stats.days > 1 ? ` over ${stats.days} days` : ''}
            </dd>
            <dt>active time</dt>
            <dd>{formatDuration(stats.readingMs)}</dd>
            <dt>editing</dt>
            <dd>{formatDuration(stats.editingMs)}</dd>
            <dt>edits landed</dt>
            <dd>{stats.edits ?? 0}</dd>
            <dt>words</dt>
            <dd>
              +{stats.wordsAdded ?? 0} / −{stats.wordsRemoved ?? 0}
            </dd>
            <TypedVsPasted stats={stats} />
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
            Measured, not asserted: idle time doesn't count, and pasting is
            tallied separately from typing.
          </p>
        </div>
      )}
    </span>
  );
}

function TypedVsPasted({ stats }) {
  const typed = stats.typedChars ?? 0;
  const pasted = stats.pastedChars ?? 0;
  if (!typed && !pasted) return null;
  const pct = Math.round((typed / (typed + pasted)) * 100);
  return (
    <>
      <dt>keystrokes</dt>
      <dd className={pct < 50 ? 'prov-bad' : ''}>
        {pct}% typed · {100 - pct}% pasted
      </dd>
    </>
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
