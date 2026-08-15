/**
 * Authorial provenance: proof of care, measured. Tracked only in dev (the
 * authoring environment):
 *
 * - Time heartbeats count ONLY when there was real input (keys, pointer,
 *   scroll) in the last 30s — an idle tab accrues nothing.
 * - Typed characters and pasted characters are counted separately, so the
 *   record can show how much prose was written vs dumped in.
 * - Words added/removed per edit are computed server-side from the actual
 *   splice, and edit counts bump server-side on saves that landed — the
 *   client only ever reports time and keystrokes.
 *
 * Everything merges additively into content/provenance/<doc>.json — beside
 * the source, git-tracked, accruing across drafts, sessions, and days. The
 * export bakes the stats in for readers.
 */
const HEARTBEAT_MS = 5_000;
const FLUSH_MS = 15_000;
const IDLE_MS = 30_000;

let started = false;
let typedChars = 0;
let pastedChars = 0;

export const recordTyped = (n) => (typedChars += n);
export const recordPasted = (n) => (pastedChars += n);

export function startTracking(slug) {
  if (!import.meta.env.DEV || started) return;
  started = true;

  let readingMs = 0;
  let editingMs = 0;
  // A session is a tab, not a pageload — every save reloads the page.
  let sessions = sessionStorage.getItem('selfdoc-session') ? 0 : 1;
  sessionStorage.setItem('selfdoc-session', '1');

  let lastActivity = Date.now();
  const noteActivity = () => (lastActivity = Date.now());
  for (const event of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) {
    window.addEventListener(event, noteActivity, { passive: true });
  }

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastActivity > IDLE_MS) return;
    readingMs += HEARTBEAT_MS;
    if (document.body.classList.contains('editing')) editingMs += HEARTBEAT_MS;
  }, HEARTBEAT_MS);

  const flush = (useBeacon) => {
    if (!readingMs && !sessions && !typedChars && !pastedChars) return;
    const payload = JSON.stringify({
      doc: slug,
      readingMs,
      editingMs,
      sessions,
      typedChars,
      pastedChars,
    });
    readingMs = 0;
    editingMs = 0;
    sessions = 0;
    typedChars = 0;
    pastedChars = 0;
    if (useBeacon) {
      navigator.sendBeacon('/__provenance', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/__provenance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  };

  setInterval(() => flush(false), FLUSH_MS);
  window.addEventListener('pagehide', () => flush(true));
}

export async function getProvenance(slug) {
  if (import.meta.env.DEV) {
    try {
      const res = await fetch(`/__provenance?doc=${slug}`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }
  // Baked in at build time by the define() in vite.config.mjs.
  return typeof __PROVENANCE__ !== 'undefined' ? (__PROVENANCE__[slug] ?? null) : null;
}

export function formatDuration(ms) {
  if (!ms) return '0m';
  if (ms < 60_000) return '<1m';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
