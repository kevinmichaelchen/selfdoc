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

/**
 * Recorded sections for a doc: a map of key → trim bounds ({t0, t1} seconds,
 * or null for untrimmed legacy takes). Bounds mark where speech starts and
 * ends; playback and the word sweep skip the silence outside them.
 */
export async function listAudio(slug) {
  if (import.meta.env.DEV) {
    try {
      const res = await fetch(`/__audio?doc=${slug}`);
      return res.ok ? await res.json() : {};
    } catch {
      return {};
    }
  }
  return typeof __AUDIO_INDEX__ !== 'undefined' ? (__AUDIO_INDEX__[slug] ?? {}) : {};
}

export function audioUrl(slug, key) {
  if (typeof __AUDIO_DATA__ !== 'undefined' && __AUDIO_DATA__) return __AUDIO_DATA__[key];
  return import.meta.env.DEV ? `/__audio/${slug}/${key}` : `audio/${slug}/${key}.webm`;
}

export async function saveRecording(slug, key, blob, bounds) {
  const query = bounds ? `?t0=${bounds.t0}&t1=${bounds.t1}` : '';
  const res = await fetch(`/__audio/${slug}/${key}${query}`, { method: 'POST', body: blob });
  return res.ok;
}

/**
 * Find where speech starts and ends in a take (windowed RMS over the decoded
 * samples), so leading/trailing silence is cut without re-encoding: the trim
 * is stored as bounds and honored at playback.
 */
export async function findSpeechBounds(blob) {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const WINDOW = 1024;
    const THRESHOLD = 0.015;
    const MIN_GAP_S = 0.9;
    let firstSample = -1;
    let lastSample = -1;
    let gapStart = -1;
    const gaps = [];
    const round = (n) => Math.round(n * 100) / 100;
    for (let i = 0; i < data.length; i += WINDOW) {
      const end = Math.min(i + WINDOW, data.length);
      let sum = 0;
      for (let j = i; j < end; j++) sum += data[j] * data[j];
      const loud = Math.sqrt(sum / (end - i)) > THRESHOLD;
      if (loud) {
        if (firstSample < 0) firstSample = i;
        // Close out an interior silent run: long pauses become skip ranges,
        // compressed to a natural beat rather than removed entirely.
        if (gapStart >= 0 && (i - gapStart) / sampleRate > MIN_GAP_S) {
          gaps.push([round(gapStart / sampleRate + 0.3), round(i / sampleRate - 0.1)]);
        }
        gapStart = -1;
        lastSample = end;
      } else if (lastSample > 0 && gapStart < 0) {
        gapStart = i;
      }
    }
    if (firstSample < 0) {
      return { t0: 0, t1: round(buffer.duration), duration: buffer.duration, silent: true, gaps: [] };
    }
    return {
      t0: round(Math.max(0, firstSample / sampleRate - 0.08)),
      t1: round(Math.min(buffer.duration, lastSample / sampleRate + 0.15)),
      duration: buffer.duration,
      silent: false,
      gaps: gaps.filter(([s, e]) => e > s),
    };
  } finally {
    ctx.close();
  }
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
const textNodesOf = (el) => {
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node);
  }
  return nodes;
};

/**
 * The section's word tokens, in exactly the order wrapWords will create
 * spans — alignment timestamps are stored per token, so the two tokenizers
 * must never drift apart.
 */
export function tokensOf(el) {
  const tokens = [];
  textNodesOf(el).forEach((node) => {
    if (!node.data.trim()) return;
    node.data.split(/(\s+)/).forEach((part) => {
      if (part.trim()) tokens.push(part);
    });
  });
  return tokens;
}

export function wrapWords(el) {
  const spans = [];
  textNodesOf(el).forEach((node) => {
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
