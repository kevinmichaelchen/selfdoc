/**
 * Authorial provenance: how much real time went into a document. Tracked only
 * in dev (the authoring environment) via heartbeats while the tab is visible,
 * split into open time vs active edit-mode time. Deltas flush to the dev
 * server, which merges them into content/provenance/<doc>.json — beside the
 * source, git-tracked. Edit counts are bumped server-side on each save, so the
 * client only ever reports time. The export bakes the stats in for readers.
 */
const HEARTBEAT_MS = 5_000;
const FLUSH_MS = 15_000;

let started = false;

export function startTracking(slug) {
  if (!import.meta.env.DEV || started) return;
  started = true;

  let readingMs = 0;
  let editingMs = 0;
  // A session is a tab, not a pageload — every save reloads the page.
  let sessions = sessionStorage.getItem('selfdoc-session') ? 0 : 1;
  sessionStorage.setItem('selfdoc-session', '1');

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    readingMs += HEARTBEAT_MS;
    if (document.body.classList.contains('editing')) editingMs += HEARTBEAT_MS;
  }, HEARTBEAT_MS);

  const flush = (useBeacon) => {
    if (!readingMs && !sessions) return;
    const payload = JSON.stringify({ doc: slug, readingMs, editingMs, sessions });
    readingMs = 0;
    editingMs = 0;
    sessions = 0;
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
