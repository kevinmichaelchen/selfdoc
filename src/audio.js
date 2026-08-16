import { blockKey } from './comments.js';

/**
 * Narration units: the pieces of prose an author must read aloud. A margin
 * note is one unit (not its inner paragraphs); code blocks and headings are
 * exempt. Recordings key on the same content hash as annotations, so
 * rewriting a section orphans its audio — there is no way to keep a
 * recording that no longer matches the prose.
 */
const UNIT_TAGS = new Set(['P', 'UL', 'OL', 'BLOCKQUOTE']);

export function isAudioUnit(el) {
  if (!el) return false;
  if (el.matches('aside.note[data-node-start]')) return true;
  if (!el.matches('[data-edit-start]')) return false;
  if (!UNIT_TAGS.has(el.tagName)) return false;
  if (el.closest('aside.note')) return false;
  return true;
}

export function audioUnits() {
  return [
    ...document.querySelectorAll('main [data-edit-start], main aside.note[data-node-start]'),
  ].filter(isAudioUnit);
}

export async function listRecorded(slug) {
  if (import.meta.env.DEV) {
    try {
      const res = await fetch(`/__audio?doc=${slug}`);
      return res.ok ? await res.json() : [];
    } catch {
      return [];
    }
  }
  return typeof __AUDIO_INDEX__ !== 'undefined' ? (__AUDIO_INDEX__[slug] ?? []) : [];
}

export function audioUrl(slug, key) {
  if (typeof __AUDIO_DATA__ !== 'undefined' && __AUDIO_DATA__) return __AUDIO_DATA__[key];
  return import.meta.env.DEV ? `/__audio/${slug}/${key}` : `audio/${slug}/${key}.webm`;
}

export async function saveRecording(slug, key, blob) {
  const res = await fetch(`/__audio/${slug}/${key}`, { method: 'POST', body: blob });
  return res.ok;
}

export async function deleteRecording(slug, key) {
  const res = await fetch(`/__audio/${slug}/${key}`, { method: 'DELETE' });
  return res.ok;
}

export { blockKey as audioKey };

/** Fired after a recording is saved or deleted so every listener refreshes. */
export const AUDIO_CHANGED = 'selfdoc:audio-changed';
/** Fired before anything mutates a block's DOM (e.g. an edit begins). */
export const STOP_NARRATION = 'selfdoc:stop-narration';

/**
 * Word-sweep support for the playback highlight. Words get wrapped in inert
 * spans only while their section's audio is playing and are unwrapped the
 * moment playback stops — the wrapping must never be visible to the editor's
 * HTML→markdown round-trip, which is why STOP_NARRATION is dispatched
 * (synchronously) before an edit captures a block's innerHTML.
 */
export function wrapWords(el) {
  const textNodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node);
  }
  const spans = [];
  textNodes.forEach((node) => {
    if (!node.data.trim()) return;
    const fragment = document.createDocumentFragment();
    node.data.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (part.trim()) {
        const span = document.createElement('span');
        span.className = 'nw';
        span.textContent = part;
        fragment.appendChild(span);
        spans.push(span);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    });
    node.replaceWith(fragment);
  });
  let total = 0;
  const cums = spans.map((span) => (total += span.textContent.length));
  return { spans, cums, total };
}

export function unwrapWords(root) {
  root.querySelectorAll('span.nw').forEach((span) => {
    span.replaceWith(document.createTextNode(span.textContent));
  });
  root.normalize();
}
