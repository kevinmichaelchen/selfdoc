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
